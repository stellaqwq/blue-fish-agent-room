import test from 'node:test';import assert from 'node:assert/strict';
import {BridgeHub,authorizedBridge} from '../bridge.mjs';
import {createObserver,publicText} from '../adapters/deepseek-room.mjs';
import {ActivityDirector} from '../src/director.js';

test('legacy posture entry delegates to the same action scheduler as model actions',()=>{
  const scheduled=[];const agent={auto:true,direct:actions=>scheduled.push(...actions)};
  const director=new ActivityDirector(agent,{},{});director.request('lie');director.request('phone');director.request('sit');
  assert.deepEqual(scheduled,[{type:'lie'},{type:'phone',operation:'pick'},{type:'sit',target:'computer'}]);assert.equal(agent.director,director);assert.equal(agent.auto,false);
});
test('event projection isolates sessions, latches actual tool work and ignores late events after completion',()=>{
  const hub=new BridgeHub();hub.ingest({session:'a',runId:'1',type:'message_received'});assert.equal(hub.snapshot('a').current.computer,false);
  hub.ingest({session:'a',runId:'1',type:'tool_started',tool:'exec_command'});hub.ingest({session:'a',runId:'1',type:'tool_completed',tool:'exec_command'});assert.equal(hub.snapshot('a').current.computer,true);
  hub.ingest({session:'a',runId:'1',type:'reply_complete',text:'done'});hub.ingest({session:'a',runId:'1',type:'response_started'});assert.equal(hub.snapshot('a').current.status,'done');assert.equal(hub.snapshot('b').current,null);
  assert.throws(()=>hub.ingest({session:'a',runId:'2',type:'execute_code'}));assert.equal(authorizedBridge('Bearer key','key'),true);assert.equal(authorizedBridge('Bearer wrong','key'),false);
});
test('DeepSeek adapter consumes official session envelopes, filters a session and emits only public text',async()=>{
  const listeners=new Map(),sent=[],original=globalThis.fetch;
  globalThis.fetch=async(_url,p)=>{sent.push(JSON.parse(p.body));return {ok:true,body:{cancel:async()=>{}}};};
  try{
    const plugin=createObserver({on:(n,f)=>listeners.set(n,f),logger:{warn(){}}},{token:'fixture',sessionId:'selected'}),on=listeners.get('session/event');
    const session={id:'selected',firstLiveSeq:5};let seq=5;
    on({id:'other'},{type:'turn/start',seq:10,data:{turn:1}});on(session,{type:'turn/start',seq:1,data:{turn:1}});
    for(const [type,data] of [['turn/start',{turn:2}],['tool/call',{turn:2,callId:'c',name:'bash',arguments:'secret arguments'}],['assistant/message',{turn:2,message:{content:[{type:'reasoning',text:'private reasoning'},{type:'text',text:'public reply'}]}}],['turn/end',{turn:2,reason:{kind:'completed'}}]])on(session,{type,seq:seq++,data});
    await plugin.flush();assert.deepEqual(sent.map(e=>e.type),['message_received','tool_started','reply_complete']);assert.equal(sent.at(-1).text,'public reply');assert.ok(!JSON.stringify(sent).includes('secret'));assert.ok(!JSON.stringify(sent).includes('private reasoning'));
    assert.equal(publicText({content:'hello'}),'hello');
  }finally{globalThis.fetch=original;}
});
