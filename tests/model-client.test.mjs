import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelPlanner} from '../model-client.mjs';
import {parsePlan,completionText} from '../src/protocol.js';

const config={baseUrl:'http://localhost:1235/v1',model:'fixture',apiKey:'fixture-secret',vision:false};
const payload={goal:'自主活动：选择一个小活动',observation:{support:'floor'},history:[]};
const plan={say:'看看窗外。',reason:'窗边可达。',action:{type:'move',target:'window'}};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const completion=(content,extra={})=>response({choices:[{message:{content},finish_reason:'stop',...extra}]});

test('plan parsing handles text blocks, thinking wrappers and quoted braces without accepting ambiguous plans',()=>{
  const content=JSON.stringify({...plan,say:'符号 {、} 和 <think> 都是文字。'});
  assert.equal(parsePlan(content).action.type,'move');
  assert.deepEqual(parsePlan([{type:'reasoning',text:'private'}, {type:'text',text:JSON.stringify(plan)}]),plan);
  assert.deepEqual(parsePlan('<THINK>private {"action":{"type":"finish"}}</THINK>\n```json\n'+JSON.stringify(plan)+'\n```'),plan);
  assert.deepEqual(parsePlan('说明：{"example":true}\n最终：'+JSON.stringify(plan)),plan);
  assert.throws(()=>parsePlan(JSON.stringify([plan,plan])));
  assert.throws(()=>parsePlan(JSON.stringify(plan)+'\n'+JSON.stringify(plan)),/多个/);
  assert.throws(()=>parsePlan('<think>private '+JSON.stringify(plan)),/完整/);
  assert.equal(completionText([{type:'reasoning',text:'private'}]),'');
});
test('planner requests a constrained action schema and validates the actual returned plan',async()=>{
  const calls=[];const planner=new ModelPlanner({fetch:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return completion(JSON.stringify(plan));}});
  assert.deepEqual(await planner.infer(config,payload),plan);
  assert.equal(calls[0].url,'http://localhost:1235/v1/chat/completions');assert.equal(calls[0].body.response_format.type,'json_schema');
  assert.ok(calls[0].body.max_tokens>=2048);assert.equal(calls[0].options.redirect,'error');
  assert.ok(!calls[0].body.messages.some(m=>m.content.includes(config.apiKey)));
});
test('unsupported format parameters negotiate once and cache the working mode',async()=>{
  const modes=[];const planner=new ModelPlanner({fetch:async(_url,options)=>{
    const mode=JSON.parse(options.body).response_format?.type||'prompt';modes.push(mode);
    return mode==='prompt'?completion(JSON.stringify(plan)):response({error:'unsupported response_format '+mode},400);
  }});
  await planner.infer(config,payload);await planner.infer(config,payload);
  assert.deepEqual(modes,['json_schema','json_object','prompt','prompt']);
});
test('local Qwen uses a request-level fast plan while explicit and remote reasoning settings are preserved',async()=>{
  const calls=[];const planner=new ModelPlanner({fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return completion(JSON.stringify(plan));}});
  await planner.infer({...config,model:'Qwen3.5-9b'},payload);
  await planner.infer({...config,model:'Qwen3.5-9b',reasoningEffort:'default'},payload);
  await planner.infer({...config,baseUrl:'https://example.test/v1',model:'Qwen3.5-9b'},payload);
  await planner.infer({...config,reasoningEffort:'high'},payload);
  assert.deepEqual(calls.map(c=>c.reasoning_effort),['none',undefined,undefined,'high']);
});
test('providers rejecting the reasoning parameter retry without it and remember that capability',async()=>{
  const efforts=[];const planner=new ModelPlanner({fetch:async(_url,options)=>{
    const body=JSON.parse(options.body);efforts.push(body.reasoning_effort);
    return body.reasoning_effort?response({error:{param:'reasoning_effort',message:'unsupported'}},400):completion(JSON.stringify(plan));
  }});
  await planner.infer({...config,model:'Qwen3.5-9b'},payload);await planner.infer({...config,model:'Qwen3.5-9b'},payload);
  assert.deepEqual(efforts,['none',undefined,undefined]);
});
test('a plain-chat response gets one correction; invalid output never becomes a fabricated action',async()=>{
  const calls=[];const planner=new ModelPlanner({fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return calls.length===1?completion('我去看窗外。'):completion(JSON.stringify(plan));}});
  assert.deepEqual(await planner.infer(config,payload),plan);assert.equal(calls.length,2);
  assert.equal(JSON.parse(calls[1].messages[1].content).goal,payload.goal);assert.ok(JSON.parse(calls[1].messages[1].content).formatCorrection);
  let count=0;const broken=new ModelPlanner({fetch:async()=>{count++;return completion('不是 JSON');}});
  await assert.rejects(broken.infer(config,payload),/一次格式纠正/);assert.equal(count,2);
});
test('truncated reasoning increases the bounded reply budget without sending reasoning back',async()=>{
  const calls=[];const planner=new ModelPlanner({fetch:async(_url,options)=>{
    calls.push(JSON.parse(options.body));return calls.length===1?completion('',{finish_reason:'length',message:{content:'',reasoning_content:'private reasoning'}}):completion([{type:'text',text:JSON.stringify(plan)}]);
  }});
  assert.deepEqual(await planner.infer(config,payload),plan);assert.deepEqual(calls.map(c=>c.max_tokens),[2048,4096]);
  assert.ok(!JSON.stringify(calls).includes('private reasoning'));
});
test('authentication/rate/server errors and refusals do not trigger format fallbacks or expose provider bodies',async()=>{
  for(const status of [401,429,500]){
    let calls=0;const planner=new ModelPlanner({fetch:async()=>{calls++;return response({error:'provider body '+config.apiKey},status);}});
    await assert.rejects(planner.infer(config,payload),e=>e.message.includes(String(status))&&!e.message.includes(config.apiKey));assert.equal(calls,1);
  }
  let calls=0;const planner=new ModelPlanner({fetch:async()=>{calls++;return completion('',{message:{refusal:'private provider refusal'}});}});
  await assert.rejects(planner.infer(config,payload),/拒绝/);assert.equal(calls,1);
});
test('cancellation stops before a correction request',async()=>{
  const controller=new AbortController();let calls=0;
  const planner=new ModelPlanner({fetch:async()=>{calls++;controller.abort();return completion('not json');}});
  await assert.rejects(planner.infer(config,payload,controller.signal),/中断/);assert.equal(calls,1);
});
