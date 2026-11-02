import './qa-http.mjs';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='.impeccable/review/skills',base='http://127.0.0.1:4193',report={checks:[],errors:[],requests:[],states:[]};await mkdir(dir,{recursive:true});
let browser,mock,app;const counts=new Map();
const check=(name,details={})=>{report.checks.push({name,...details});console.log('PASS',name);};
try{
  mock=http.createServer(async(req,res)=>{
    try{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw),input=JSON.parse(body.messages.at(-1).content),n=counts.get(input.goal)||0;counts.set(input.goal,n+1);report.requests.push(input);
      let sequence;
      if(input.goal==='统一技能联动')sequence=[{type:'lie'},{type:'phone',operation:'pick'},{type:'phone',operation:'put'},{type:'sit',target:'computer'},{type:'stand'},{type:'finish'}];
      else if(input.goal.includes('记住以后'))sequence=[{type:'remember',key:'quietMode',value:true},{type:'remember',key:'wakeHour',value:8},{type:'finish'}];
      else sequence=[{type:'wait',duration:6},{type:'finish'}];
      const action=sequence[Math.min(n,sequence.length-1)];res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({say:'',reason:'依据当前真实状态执行下一步',action})}}]}));
    }catch(e){res.writeHead(500);res.end('{}');}
  });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4193'},stdio:'ignore',windowsHide:true});
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'QA server not ready');
  const contract=await(await fetch(base+'/api/skills')).json();assert.equal(contract.version,2);for(const type of ['lie','stand','phone','sit'])for(const key of ['conditions','completion','failures','interrupt'])assert.ok(contract.skills[type][key]);check('Discoverable skill conditions/completion/failure/interruption contracts');
  await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl:'http://127.0.0.1:'+mock.address().port+'/v1',model:'skills-fixture',apiKey:'',vision:false})});
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>Boolean(window.roomDemo),{timeout:45000});await page.locator('[data-camera="bed"]').click();
  await page.evaluate(()=>{window.skillQA={results:[],pauseOn:['lie','phone:pick','phone:put','sit','stand']};window.roomDemo.agent.addEventListener('result',e=>{const key=e.detail.action.type+(e.detail.action.operation?':'+e.detail.action.operation:'');window.skillQA.results.push(e.detail);const i=window.skillQA.pauseOn.indexOf(key);if(e.detail.ok&&i>=0){window.skillQA.pauseOn.splice(i,1);window.roomDemo.agent.paused=true;}});});
  await page.locator('#command').fill('统一技能联动');await page.locator('#send').click();
  for(const key of ['lie','phone:pick','phone:put','sit','stand']){
    await page.waitForFunction(key=>{const a=window.skillQA.results.at(-1)?.action;return window.roomDemo.agent.paused&&a?.type+(a.operation?':'+a.operation:'')===key;},key,{timeout:40000});
    const state=await page.evaluate(()=>window.roomDemo.snapshot());report.states.push({key,...state});assert.equal(state.observation.lastResult.ok,true);assert.equal(state.observation.lastResult.code,'verified');
    if(key==='phone:pick'){assert.equal(state.phone,'hand');assert.equal(state.observation.phone.held,true);assert.ok(state.observation.phone.gripDistance<.16);}if(key==='phone:put')assert.equal(state.phone,'bed');
    await page.screenshot({path:dir+'/'+key.replace(':','-')+'.png',fullPage:true});check('Model protocol executes and verifies '+key,{posture:state.observation.posture,phone:state.phone});await page.evaluate(()=>window.roomDemo.agent.paused=false);
  }
  await page.waitForFunction(()=>window.roomDemo.agent.memory.tasks.at(-1)?.status==='completed',{timeout:10000});
  const sequenceRequests=report.requests.filter(r=>r.goal==='统一技能联动');assert.equal(sequenceRequests[2].observation.phone.owner,'hand');assert.equal(sequenceRequests[2].observation.posture,'lie');assert.equal(sequenceRequests[4].observation.posture,'sit');check('Actual posture and phone ownership reach subsequent planner requests');
  await page.locator('#reset').click();
  await page.evaluate(()=>{const {agent,world}=window.roomDemo;window.restoreLamp=world.setLamp;world.setLamp=()=>{};agent.direct([{type:'move',target:'lamp'},{type:'lamp',enabled:true}],'灯具故障夹具');});
  await page.waitForFunction(()=>!window.roomDemo.agent.current&&!window.roomDemo.agent.queue.length,{timeout:30000});const lamp=await page.evaluate(()=>{const {agent,world}=window.roomDemo;world.setLamp=window.restoreLamp;return agent.observation();});assert.equal(lamp.lastResult.code,'verification_failed');assert.equal(lamp.lampOn,false);check('A no-op lamp setter produces verified failure, never fake completion');
  await page.locator('#reset').click();await page.evaluate(()=>window.roomDemo.agent.direct([{type:'lie'}]));await page.waitForFunction(()=>!window.roomDemo.agent.current&&window.roomDemo.director.stable==='lie',{timeout:30000});
  await page.evaluate(()=>{const {agent,world}=window.roomDemo;window.phoneHome=world.phone.home.clone();world.phone.home.x+=10;world.phone.rest();agent.direct([{type:'phone',operation:'pick'}],'手机不可达夹具');});
  await page.waitForFunction(()=>window.roomDemo.agent.lastResult?.code==='phone_unreachable'&&!window.roomDemo.agent.current,{timeout:10000});const phoneFailure=await page.evaluate(()=>{const {agent,world}=window.roomDemo;const state=agent.observation();world.phone.home.copy(window.phoneHome);world.phone.rest();return state;});assert.equal(phoneFailure.phone.owner,'bed');check('Unreachable real IK phone contact reports its failure reason');
  await page.locator('#reset').click();await page.evaluate(()=>void window.roomDemo.agent.runGoal('打断恢复测试'));await page.waitForFunction(()=>window.roomDemo.agent.current?.type==='wait');await page.locator('[data-action="wave"]').click();await page.waitForFunction(()=>window.roomDemo.agent.memory.tasks.at(-1)?.status==='completed',{timeout:15000});
  const resumed=report.requests.filter(r=>r.goal==='打断恢复测试');assert.equal(resumed.length,2);assert.ok(resumed[1].history.some(h=>h.result.status==='interrupted'));check('Manual gesture interrupts and then replans the original persistent goal');
  await page.evaluate(()=>void window.roomDemo.agent.runGoal('外部消息打断测试'));await page.waitForFunction(()=>window.roomDemo.agent.current?.type==='wait');
  await page.evaluate(()=>{window.externalFixture=status=>({version:1,source:'external',jobs:[],current:{id:'skills-run',status,computer:false}});window.roomDemo.director.snapshot(window.externalFixture('generating'));window.roomDemo.director.snapshot(window.externalFixture('generating'));});
  await page.waitForFunction(()=>window.roomDemo.world.phone.owner==='hand'&&!window.roomDemo.agent.current,{timeout:30000});const message=await page.evaluate(()=>window.roomDemo.agent.observation());assert.equal(message.external.active,true);assert.equal(message.external.unread,false);assert.equal(message.memory.recentEvents.filter(e=>e.type==='message_received'&&e.runId==='skills-run').length,1);check('Real message state is observed once and phone contact marks it read');
  await page.evaluate(()=>{const data=window.externalFixture('generating');data.current.computer=true;window.roomDemo.director.snapshot(data);});await page.waitForFunction(()=>window.roomDemo.director.stable==='sit'&&!window.roomDemo.agent.current,{timeout:15000});assert.equal(await page.evaluate(()=>window.roomDemo.world.phone.owner),'bed');
  await page.evaluate(()=>{const data=window.externalFixture('done');data.current.computer=true;window.roomDemo.director.snapshot(data);});await page.waitForFunction(()=>window.roomDemo.agent.memory.tasks.at(-1)?.status==='completed'&&!window.roomDemo.agent.current,{timeout:20000});assert.equal(report.requests.filter(r=>r.goal==='外部消息打断测试').length,2);check('Computer tool transition uses the same skills and resumes the old goal after cleanup');
  await page.evaluate(()=>void window.roomDemo.agent.runGoal('记住以后安静模式并在早上八点起床'));await page.waitForFunction(()=>window.roomDemo.agent.memory.tasks.at(-1)?.status==='completed');await page.evaluate(()=>void window.roomDemo.agent.runGoal('刷新后继续的任务'));await page.waitForFunction(()=>window.roomDemo.agent.current?.type==='wait');
  await page.reload();await page.waitForFunction(()=>Boolean(window.roomDemo),{timeout:45000});const restored=await page.evaluate(()=>window.roomDemo.agent.observation());assert.equal(restored.memory.preferences.quietMode,true);assert.equal(restored.memory.preferences.wakeHour,8);assert.equal(restored.phone.owner,'bed');assert.equal(restored.support,'floor');assert.equal(restored.posture,'stand');assert.ok(restored.memory.unfinishedTasks.some(t=>t.text==='刷新后继续的任务'&&t.status==='suspended'));assert.equal(await page.evaluate(()=>window.roomDemo.agent.busy),false);check('Reload preserves preferences/unfinished intent, and observes fresh physical state');
  await page.locator('#command').fill('继续');await page.locator('#send').click();await page.waitForFunction(()=>window.roomDemo.agent.memory.tasks.find(t=>t.text==='刷新后继续的任务')?.status==='completed');check('Explicit continue resumes the saved task after reload');
  await page.screenshot({path:dir+'/restored-memory.png',fullPage:true});assert.deepEqual(report.errors,[]);
  if(process.argv.includes('--local')){
    const config=await(await fetch('http://127.0.0.1:4177/api/config')).json(),url=new URL(config.baseUrl);
    assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='1235'&&!config.hasKey&&config.model==='Qwen3.5-9b','Only the already configured, no-key local Qwen is allowed in this fixture');
    await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl:config.baseUrl,model:config.model,apiKey:'',vision:false})});
    await page.reload();await page.waitForFunction(()=>Boolean(window.roomDemo),{timeout:45000});await page.locator('#reset').click();await page.locator('[data-camera="bed"]').click();report.local={model:config.model,actions:[]};
    page.on('response',async response=>{if(response.url()===base+'/api/plan'){try{const data=await response.json(),request=response.request().postDataJSON();report.local.actions.push({action:data.action,error:data.error,observation:{goalStatus:request.observation.goalStatus,posture:request.observation.posture,phone:request.observation.phone,lastResult:request.observation.lastResult}});}catch{}}});
    await page.locator('#command').fill('请先侧躺在床上，然后拿起手机看，确认手机确实在手里后结束目标。只做这件事。');await page.locator('#send').click();
    await page.waitForFunction(()=>['completed','failed'].includes(window.roomDemo.agent.memory.tasks.at(-1)?.status),null,{timeout:150000});const result=await page.evaluate(()=>window.roomDemo.snapshot());report.local.final={task:result.observation.memory.activeGoal,lastResult:result.observation.lastResult,phone:result.phone,posture:result.observation.posture};
    assert.equal(result.phone,'hand');assert.equal(result.observation.posture,'lie');assert.equal(await page.evaluate(()=>window.roomDemo.agent.memory.tasks.at(-1)?.status),'completed');check('Real local Qwen plans, executes and verifies lying/phone skills end to end');await page.screenshot({path:dir+'/local-qwen-phone.png',fullPage:true});
  }
}catch(e){report.errors.push(e.stack||e.message);process.exitCode=1;console.error(e.message);}finally{await browser?.close();app?.kill();if(mock)await new Promise(r=>mock.close(r));await writeFile(dir+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));
