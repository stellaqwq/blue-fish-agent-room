import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RoomMemory} from '../src/cognition.js';
import {RoomAgent,AUTO_DELAY} from '../src/agent.js';
import {FrameGuard} from '../src/frame-guard.js';
import {ActivityDirector} from '../src/director.js';
import {validatePlan} from '../src/protocol.js';
import {verifySkill} from '../src/skills.js';
import {goalConditions} from '../src/goals.js';

const store=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};};
const action=a=>({say:'',reason:'根据真实观察',action:a});
function fixture(plan=async()=>action({type:'finish'})){
  const root=new THREE.Group(),bones=Object.fromEntries(['rightHand','rightUpperArm','rightLowerArm'].map(k=>[k,new THREE.Object3D()]));for(const bone of Object.values(bones))root.add(bone);
  const avatar={root,bones,vrm:{},footRest:{left:{x:.1,z:0},right:{x:-.1,z:0}},setGaze(){},getHead(){return root.position.clone().add(new THREE.Vector3(0,.6,0));},update(){root.updateMatrixWorld(true);}};
  const group=new THREE.Group(),home=new THREE.Vector3(-1,.85,-.6);group.position.copy(home);
  const phone={owner:'bed',group,home,rest(){this.owner='bed';group.position.copy(home);}};
  const world={phone,targets:Object.fromEntries(['bed','desk','window','center','user','lamp'].map(k=>[k,{name:k,position:[0,0,0],look:[0,1,2]}])),nav:{radius:.87,free:()=>true,clear:()=>true,route:()=>[]},bed:{position:{x:-1,z:-.6},heightAt:()=>.8,computerSeat:{x:.37,z:-.12}},lampOn:false,setLamp(v){this.lampOn=v;},setPath(){},updateDebug(){}};
  const agent=new RoomAgent(avatar,world,{plan,storage:store()});const director=new ActivityDirector(agent,world,avatar);return {agent,director,world,avatar};
}
async function tick(f,frames=120){for(let i=0;i<frames;i++){f.director.before(1/60);f.agent.update(1/60);f.director.after();await Promise.resolve();}}

test('new skills reject malformed operations, destinations and arbitrary memory fields',()=>{
  for(const a of [{type:'phone',operation:'throw'},{type:'sit',target:'chair'},{type:'remember',key:'apiKey',value:'secret'},{type:'remember',key:'quietMode',value:'yes'},{type:'remember',key:'wakeHour',value:25},{type:'finish',outcome:'pretend'}])assert.throws(()=>validatePlan(action(a)));
  for(const a of [{type:'lie'},{type:'stand'},{type:'phone',operation:'pick'},{type:'phone',operation:'put'},{type:'sit',target:'computer'},{type:'remember',key:'wakeHour',value:8}])assert.deepEqual(validatePlan(action(a)).action,a);
});
test('bounded memory restores unfinished intent and preferences, never physical pose or active execution',()=>{
  const storage=store();let at=1000;const memory=new RoomMemory({storage,now:()=>++at});memory.begin('看窗外再休息');memory.remember('quietMode',true);
  for(let i=0;i<20;i++)memory.record({type:'wait',duration:.5},{ok:true,status:'succeeded',code:'verified',message:'完成'});
  const loaded=new RoomMemory({storage,now:()=>++at});assert.equal(loaded.active,null);assert.equal(loaded.tasks[0].status,'suspended');assert.equal(loaded.preferences.quietMode,true);assert.equal(loaded.activities.length,12);assert.equal(loaded.tasks[0].history.length,10);assert.equal(loaded.observation().needs.kind,'simulation');assert.equal('posture' in loaded.observation(),false);
  for(let i=0;i<14;i++){loaded.begin('任务'+i);loaded.settle('completed');}assert.equal(loaded.tasks.length,8);assert.ok(loaded.tasks.some(t=>t.text==='看窗外再休息'));
  assert.throws(()=>loaded.remember('apiKey','secret'));assert.equal(JSON.stringify(loaded).includes('secret'),false);
});
test('manual interruption resumes original goal by replanning with an interrupted result',async()=>{
  const requests=[];const f=fixture(async p=>{requests.push(structuredClone(p));return action(p.history.length?{type:'finish'}:{type:'wait',duration:5});});
  await f.agent.runGoal('等一会再完成');assert.equal(f.agent.current.type,'wait');f.agent.direct([{type:'wave',duration:.5}]);await tick(f,80);
  assert.equal(requests.length,2);assert.equal(requests[1].goal,'等一会再完成');assert.equal(requests[1].history[0].result.status,'interrupted');assert.equal(f.agent.goal,null);assert.equal(f.agent.memory.tasks[0].status,'completed');
});
test('a newer user goal completes before the suspended goal resumes',async()=>{
  const order=[];const f=fixture(async p=>{order.push(p.goal);return action(p.goal==='原目标'&&!p.history.length?{type:'wait',duration:5}:{type:'finish'});});
  await f.agent.runGoal('原目标');await f.agent.runGoal('临时指令');await tick(f,2);
  assert.deepEqual(order,['原目标','临时指令','原目标']);assert.equal(f.agent.memory.tasks.filter(t=>t.status==='completed').length,2);
});
test('a late model response cannot take control after a posture interruption',async()=>{
  let resolveOld;let calls=0;const f=fixture(()=>++calls===1?new Promise(r=>resolveOld=r):new Promise(()=>{}));f.agent.support='bed';f.avatar.root.position.copy(f.director.poseFor('stand').position);
  const pending=f.agent.runGoal('旧灯光目标');f.director.request('lie');assert.equal(f.agent.busy,false);assert.equal(f.agent.memory.tasks[0].status,'suspended');resolveOld(action({type:'lamp',enabled:true}));await pending;await tick(f,100);
  assert.equal(f.world.lampOn,false);assert.equal(f.director.stable,'lie');assert.equal(f.agent.busy,true);assert.equal(calls,2);f.agent.stop();
});
test('lamp failure is observed, false finish is rejected, and a later verified retry clears the failure',async()=>{
  const requests=[],speech=[];let writes=0;const f=fixture(async p=>{requests.push(structuredClone(p));return {say:'已经完成',reason:'测试验证',action:[{type:'lamp',enabled:true},{type:'finish'},{type:'lamp',enabled:true},{type:'finish'}][requests.length-1]};});
  f.world.setLamp=v=>{if(++writes>1)f.world.lampOn=v;};f.agent.addEventListener('say',e=>speech.push(e.detail));await f.agent.runGoal('测试动作结果');await tick(f,80);
  assert.equal(requests[1].observation.lastResult.code,'verification_failed');assert.equal(requests[2].observation.lastResult.code,'unresolved_failure');assert.equal(requests[1].observation.lampOn,false);assert.equal(f.world.lampOn,true);assert.equal(f.agent.memory.tasks[0].status,'completed');assert.equal(speech.length,2);
});
test('unresolved physical failure can end honestly as failed and stay resumable',async()=>{
  const f=fixture(async p=>action(p.history.length?{type:'finish',outcome:'failed'}:{type:'lamp',enabled:true}));f.world.setLamp=()=>{};await f.agent.runGoal('开灯');await tick(f,30);
  assert.equal(f.agent.memory.tasks[0].status,'failed');assert.equal(f.agent.memory.tasks[0].reason,'动作未通过真实状态校验。');assert.equal(f.agent.observation().memory.unfinishedTasks.length,1);
});
test('preferences need explicit user intent and quiet mode constrains autonomous lamp changes',async()=>{
  const f=fixture(async p=>action(p.history.length?{type:'finish',outcome:p.history[0].result.ok?'success':'failed'}:{type:'remember',key:'quietMode',value:true}));
  await f.agent.runGoal('去看看窗外');await tick(f,3);assert.equal(f.agent.memory.preferences.quietMode,false);assert.equal(f.agent.memory.tasks[0].history[0].result.code,'preference_not_requested');
  await f.agent.runGoal('记住，以后使用安静模式');await tick(f,3);assert.equal(f.agent.memory.preferences.quietMode,true);
  f.agent.plan=async p=>action(p.history.length?{type:'finish',outcome:'failed'}:{type:'lamp',enabled:true});await f.agent.runGoal('自主活动','auto');await tick(f,3);assert.equal(f.world.lampOn,false);assert.equal(f.agent.memory.tasks.at(-1).history[0].result.code,'preference_conflict');
});
test('stable labels alone cannot verify a seated pose or a phone held far from the hand',()=>{
  const f=fixture();f.agent.support='bed';f.director.stable='sit';assert.equal(verifySkill({type:'sit',target:'computer'},f.agent).ok,false);
  const pose=f.director.poseFor('sit');f.avatar.root.position.copy(pose.position);f.avatar.root.quaternion.copy(pose.quaternion);assert.equal(verifySkill({type:'sit',target:'computer'},f.agent).ok,true);
  f.director.stable='lie';f.director.held=true;f.world.phone.owner='hand';f.world.phone.group.position.set(10,10,10);assert.equal(verifySkill({type:'phone',operation:'pick'},f.agent).ok,false);
  f.world.phone.group.position.copy(f.avatar.bones.rightHand.getWorldPosition(new THREE.Vector3()));assert.equal(verifySkill({type:'phone',operation:'pick'},f.agent).ok,true);
});
test('external messages suspend once, reveal actual tool state, and release the original goal after cleanup',async()=>{
  const requests=[];const f=fixture(async p=>{requests.push(p.goal);return action(p.history.length?{type:'finish'}:{type:'wait',duration:5});});f.agent.support='bed';f.avatar.root.position.copy(f.director.poseFor('stand').position);f.agent.memory.preferences.restPosture='stand';
  await f.agent.runGoal('原来在做的事');const snapshot=status=>({version:1,jobs:[],source:'external',current:{id:'run-1',status,computer:true}});
  f.director.snapshot(snapshot('generating'));f.director.snapshot(snapshot('generating'));assert.equal(f.agent.memory.events.filter(e=>e.type==='message_received').length,1);assert.equal(f.agent.observation().external.computer,true);await tick(f,85);assert.equal(f.director.stable,'sit');assert.equal(requests.length,1);
  f.director.snapshot(snapshot('done'));await tick(f,410);assert.deepEqual(requests,['原来在做的事','原来在做的事']);assert.equal(f.agent.memory.tasks[0].status,'completed');
});
test('stop cancels suspended work and paused simulation does not accumulate energy or time',async()=>{
  const f=fixture(async()=>action({type:'wait',duration:5}));await f.agent.runGoal('原目标');f.agent.direct([{type:'wait',duration:5}]);f.agent.auto=true;f.agent.paused=true;const before={time:f.agent.time,energy:f.agent.memory.energy};await tick(f,120);assert.equal(f.agent.time,before.time);assert.equal(f.agent.memory.energy,before.energy);
  f.agent.stop();f.agent.paused=false;await tick(f,400);assert.equal(f.agent.goal,null);assert.equal(f.agent.auto,false);assert.equal(f.agent.memory.tasks[0].status,'cancelled');assert.equal(f.agent.current,null);
});
test('a planner response arriving while paused executes once after resuming',async()=>{
  let release;let calls=0;const f=fixture(()=>++calls===1?new Promise(r=>release=r):Promise.resolve(action({type:'finish'})));
  const pending=f.agent.runGoal('暂停中收到动作');f.agent.paused=true;release(action({type:'wait',duration:.5}));await pending;await tick(f,30);assert.equal(f.agent.current,null);assert.equal(f.agent.queue.length,1);
  f.agent.paused=false;await tick(f,40);assert.equal(calls,2);assert.equal(f.agent.memory.tasks[0].status,'completed');assert.equal(f.agent.memory.tasks[0].history.length,1);
});
test('memory storage errors preserve the session and report loss of persistence',()=>{
  const memory=new RoomMemory({storage:{getItem(){throw new Error('unavailable');},setItem(){throw new Error('quota');}}});memory.begin('仍要完成');memory.remember('restPosture','sit');assert.equal(memory.active.text,'仍要完成');assert.equal(memory.preferences.restPosture,'sit');assert.match(memory.observation().persistence,/无法保存/);
});
test('premature finish cannot complete a physical goal without satisfying the actual final state',async()=>{
  const requests=[];const f=fixture(async p=>{requests.push(structuredClone(p));return action([{type:'finish'},{type:'lamp',enabled:true},{type:'finish'}][requests.length-1]);});
  await f.agent.runGoal('打开台灯');await tick(f,30);assert.equal(requests[1].observation.lastResult.code,'goal_not_met');assert.equal(requests[1].observation.goalStatus.met,false);assert.equal(requests[1].observation.goalStatus.unmet[0].expected,true);assert.equal(f.world.lampOn,true);assert.equal(f.agent.memory.tasks[0].status,'completed');assert.equal(f.agent.lastResult.taskId,f.agent.memory.tasks[0].id);
});
test('goal final-state rules follow sequential commands, elided objects and explicit negatives',()=>{
  const values=s=>Object.fromEntries(goalConditions(s).map(c=>[c.key,c.value]));
  assert.deepEqual(values('先侧躺在床上，然后拿起手机看，确认手机确实在手里后结束目标。'),{posture:'lie',support:'bed',phoneOwner:'hand'});
  assert.equal(values('拿起手机然后放回').phoneOwner,'bed');assert.equal(values('打开台灯然后关闭').lampOn,false);
  assert.equal(values('跳上床看看，再跳下来向我挥手').support,'floor');assert.equal(values('去床边，再跳上床').near,undefined);
  assert.deepEqual(values('不要开灯'),{});assert.deepEqual(values('如果有消息就拿起手机'),{});assert.deepEqual(values('记住以后安静模式'),{});
});
test('late active snapshots cannot reopen a completed external task',async()=>{
  const f=fixture();f.agent.external={runId:'done-run',active:false,status:'done',computer:false};const generation=f.agent.generation;
  f.agent.receiveExternal({version:1,jobs:[],current:{id:'done-run',status:'generating',computer:true}});assert.equal(f.agent.generation,generation);assert.equal(f.agent.external.active,false);assert.equal(f.agent.external.status,'done');
});
test('repeated disconnect notifications cannot keep interrupting a recovered goal',()=>{
  const f=fixture();f.agent.external={runId:'disconnect-run',active:true,status:'generating'};f.agent.externalDisconnected();const generation=f.agent.generation;f.agent.externalDisconnected();assert.equal(f.agent.generation,generation);assert.equal(f.agent.memory.events.filter(e=>e.type==='agent_disconnected').length,1);
});
test('idle mode and autonomy deadlines have one completion policy',async()=>{
  const f=fixture();await f.agent.runGoal('普通聊天');assert.equal(f.agent.mode,'manual');assert.equal(f.agent.nextAuto,f.agent.time+AUTO_DELAY);
  f.agent.direct([{type:'wait',duration:.5}],'offline',{mode:'offline-auto'});assert.equal(f.agent.mode,'offline-auto');await tick(f,40);assert.equal(f.agent.mode,'manual');assert.equal(f.agent.nextAuto,f.agent.idleSince+AUTO_DELAY);
});
test('frame faults latch once and reset permits recovery without recurring errors',()=>{
  const f=fixture(),guard=new FrameGuard();let reports=0;
  for(let i=0;i<5;i++)guard.run(()=>{throw new Error('fixture');},error=>{reports++;f.agent.failRuntime(error);});
  assert.equal(reports,1);assert.equal(f.agent.paused,true);assert.equal(f.agent.auto,false);guard.reset();assert.equal(guard.run(()=>{},()=>{}),true);
});
