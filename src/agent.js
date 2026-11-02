import * as THREE from 'three';
import {validatePlan,actionTypes} from './protocol.js';
import {JumpMotor} from './jump.js';
import {RoomMemory} from './cognition.js';
import {SKILLS,bedSkills,verifySkill} from './skills.js';
import {goalConditions,verifyGoal} from './goals.js';
export const AUTO_DELAY=15;

export class RoomAgent extends EventTarget{
  constructor(avatar,world,options={}){
    super();this.avatar=avatar;this.world=world;this.current=null;this.queue=[];this.path=[];this.speed=0;this.gesture='idle';this.paused=false;this.mode='manual';this.auto=false;this.busy=false;this.request=null;this.generation=0;this.time=0;this.idleSince=0;this.history=[];this.lastActivity='尚未活动';this.nextAuto=AUTO_DELAY;this.configured=false;this.support='floor';this.pose={};this.goal=null;this.external=null;
    let storage=options.storage;if(storage===undefined){try{storage=globalThis.localStorage;}catch{}}
    this.memory=new RoomMemory({...options,storage});this.lastResult=this.memory.activities.at(-1)?.result||null;this.turns=0;
    this.plan=options.plan||(async payload=>{const response=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},signal:this.request.signal,body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw new Error(data.error||'模型请求失败。');return data;});
  }
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  log(text,kind='action'){this.emit('log',{text,kind,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})});}
  scheduleAuto(delay=AUTO_DELAY){this.nextAuto=this.time+delay;}
  failRuntime(error){
    this.generation++;this.request?.abort();this.request=null;this.busy=false;this.auto=false;this.paused=true;this.mode='manual';
    try{this.current?.motor?.dispose();}catch{}
    this.current=null;this.queue=[];this.path=[];this.speed=0;this.gesture='idle';this.goal=null;
    this.memory.settle('failed','场景更新错误：'+String(error.message).slice(0,160));
    try{this.world.setPath([]);}catch{}
    const message='场景更新出错，已停止。点击“重置”可重试。';this.log(message,'error');this.emit('state','error');this.emit('error',message);
  }
  observation(){
    const p=this.avatar.root.position,m=this.memory.observation(),d=this.director?.observation(),task=m.activeGoal;
    if(task)delete task.history;m.unfinishedTasks=m.unfinishedTasks.map(({history,...entry})=>entry);
    return {timeSeconds:Math.round(this.time),position:{x:+p.x.toFixed(3),y:+p.y.toFixed(3),z:+p.z.toFixed(3)},support:this.support,jumpPhase:this.current?.motor?.phase||null,grounded:this.current?.motor?.grounded??true,jumpVelocity:this.current?.motor?{...this.current.motor.velocity}:null,collisionRadius:this.world.nav.radius,yaw:+this.avatar.root.rotation.y.toFixed(2),state:this.current?.type||'idle',posture:d?.posture||'stand',postureTarget:d?.target||'stand',phone:d?.phone||{owner:this.world.phone?.owner||'unavailable'},paused:this.paused,lampOn:this.world.lampOn,lastActivity:this.lastActivity,lastResult:this.lastResult,goalStatus:verifyGoal(this.memory.active?.conditions,this),idleSeconds:Math.round(this.time-this.idleSince),external:this.external?{...this.external}:null,memory:{...m,needs:undefined},needs:m.needs,
      targets:Object.fromEntries(Object.entries(this.world.targets).map(([id,t])=>{let reachable=true;try{const start=this.support==='bed'?{x:this.world.targets.bed.position[0],z:this.world.targets.bed.position[2]}:p;this.world.nav.route(start,{x:t.position[0],z:t.position[2]});}catch{reachable=false;}return[id,{name:t.name,distance:+Math.hypot(t.position[0]-p.x,t.position[2]-p.z).toFixed(2),reachable}];})),perception:'结构化场景状态；可选角色相机图片',capabilities:actionTypes,skills:Object.fromEntries(Object.entries(SKILLS).map(([type,contract])=>[type,{...contract,available:!bedSkills.includes(type)||type==='stand'||Boolean(this.director&&this.world.phone)}]))};
  }
  interrupt(reason,{preserve=true,force=false}={}){
    const task=this.memory.active,c=this.current,landing=!force&&c?.type==='jump'&&c.motor.phase!=='windup';
    this.generation++;this.request?.abort();this.request=null;this.busy=false;
    if(c&&!c.interrupted){this.record(c,false,reason,'interrupted','interrupted',task);c.interrupted=true;}
    if(preserve)this.memory.suspend(reason);this.goal=null;this.history=[];this.queue=[];
    if(!landing){c?.motor?.dispose();this.current=null;this.gesture='idle';this.pose={};}
    this.path=[];this.speed=0;this.world.setPath([]);return landing;
  }
  stop(reason='已停止，等待你的下一条指令。',force=false){
    this.auto=false;const landing=this.interrupt(reason||'行动已取消。',{preserve:false,force});this.memory.cancel(reason||'用户取消。');this.external=null;
    if(!force&&this.director?.controlled)this.director.request('stand',{managed:true});
    this.mode='manual';this.scheduleAuto();
    this.emit('state',landing?'jump':'idle');if(reason)this.log(landing?'已取消后续行动，将先安全落地。':reason,'system');
  }
  reset(){this.auto=false;this.stop('已回到初始位置。',true);this.director?.reset();this.presentation=null;this.support='floor';this.paused=false;this.avatar.root.position.set(-.7,0,1.3);this.avatar.root.rotation.set(0,-.36,0);this.avatar.root.updateMatrixWorld(true);this.avatar.setGaze(new THREE.Vector3(-3,1.5,5));if(this.avatar.reset)this.avatar.reset();else this.avatar.vrm.springBoneManager?.reset();this.world.setLamp(false);this.mode='manual';this.lastActivity='尚未活动';this.idleSince=this.time;}
  async runGoal(goal,source='user'){
    if(!String(goal).trim())return;
    if(source==='user'&&/^(继续|继续之前的任务|继续原来的任务|resume)[。.!！\s]*$/i.test(String(goal).trim())&&!this.memory.active){this.paused=false;return this.resumeGoal(undefined,true);}
    this.interrupt('被新的'+(source==='auto'?'自主目标':'用户指令')+'暂时打断。');this.paused=false;this.memory.begin(goal,source,source==='user'?goalConditions(goal):[]);this.activateGoal();
    this.log(source==='auto'?'开始一次自主活动':'目标：'+this.goal,'goal');if(!this.current)await this.think();
  }
  activateGoal(){const task=this.memory.active;this.goal=task?.text||null;this.history=task?.history||[];this.turns=task?.steps||0;this.mode=task?.source==='auto'?'llm-auto':'llm';}
  resumeGoal(id,explicit=false){
    if(this.external?.active)return false;
    const task=this.memory.resume(id,{includeFailed:explicit});if(!task){if(explicit)this.log('没有可继续的未完成任务。','system');return false;}
    this.activateGoal();this.log('继续之前的目标：'+this.goal,'goal');if(!this.current&&!this.paused)void this.think();return true;
  }
  async think(){
    if(!this.goal||this.busy||this.paused||this.current||this.external?.active)return;
    const task=this.memory.active;if(!task)return;
    this.turns=++task.steps;
    if(task.steps>10){this.memory.settle('failed','已达到单个目标的 10 步上限，等待用户继续。');this.goal=null;this.log('已达到单个目标的 10 步上限，目标保留为未完成。','error');this.auto=false;return;}
    this.memory.save();const generation=this.generation;this.busy=true;this.emit('state','thinking');this.request=new AbortController();
    try{
      const data=await this.plan({goal:this.goal,observation:this.observation(),history:this.history,image:this.capture?.()});
      if(generation!==this.generation)return;
      const plan=validatePlan(data);this.log(plan.reason||'模型选择了 '+plan.action.type,'decision');
      this.emit('model-success',null);this.busy=false;this.queue=[{...plan.action,say:plan.say}];if(!this.paused)this.startNext();
    }catch(e){if(generation!==this.generation)return;this.busy=false;this.memory.settle('failed',e.message);this.goal=null;this.auto=false;this.emit('state','error');this.log(e.name==='AbortError'?'模型请求已取消。':e.message,'error');this.emit('error',e.message);}
  }
  direct(actions,label='手动动作',{source='manual',mode=source==='external'?'external':'manual'}={}){
    const checked=actions.map(a=>validatePlan({action:a}).action);
    this.interrupt(source==='external'?'收到外部 Agent 消息，暂时挂起目标。':'被手动操作暂时打断。');this.paused=false;this.mode=mode;this.queue=checked;this.lastActivity=label;this.log(label,'goal');this.emit('say',label);if(!this.current)this.startNext();
  }
  goToPoint(point){
    const from=this.support==='bed'?{x:this.world.targets.bed.position[0],z:this.world.targets.bed.position[2]}:this.avatar.root.position;
    this.world.nav.route(from,point);this.interrupt('被手动地面目标暂时打断。');this.paused=false;this.mode='manual';this.queue=[{type:'move',point:{x:point.x,z:point.z}}];this.log('走向你选择的地面位置。');if(!this.current)this.startNext();
  }
  bedHeight(yaw=this.avatar.root.rotation.y){const p=this.world.bed.position,heights=Object.values(this.avatar.footRest).map(f=>this.world.bed.heightAt(p.x+f.x*Math.cos(yaw)+f.z*Math.sin(yaw),p.z-f.x*Math.sin(yaw)+f.z*Math.cos(yaw)));return Math.max(...heights)-.0175;}
  startNext(){
    if(this.paused||this.current)return;
    let action=this.queue.shift();
    if(!action){this.gesture='idle';this.idleSince=this.time;this.emit('state','idle');if(this.goal)void this.think();else if(this.external?.active)this.mode='external';else if(!this.resumeGoal()){this.mode='manual';this.scheduleAuto();}return;}
    try{
      if(![...bedSkills,'wait','remember','resume','finish'].includes(action.type)&&this.director?.controlled){this.queue.unshift(action);action={type:'stand'};}
      if(['lie','sit'].includes(action.type)||action.type==='phone'&&action.operation==='pick'){
        if(!this.director||!this.world.phone)throw Object.assign(new Error('当前场景没有可用的床上技能执行器或手机。'),{code:'director_unavailable'});
        if(!['hand','bed'].includes(this.world.phone.owner))throw Object.assign(new Error('手机不在已知可交互位置。'),{code:'phone_unavailable'});
        if(this.support!=='bed'){this.queue.unshift(action);action={type:'jump',target:'bed'};}
      }
      if(action.type==='move'&&this.support==='bed'){this.queue.unshift(action);action={type:'jump',target:'floor'};}
      if(action.type==='jump'){
        if(action.target===this.support){this.complete(true,'实际已在目标支撑面上。',action);return;}
        const launch=this.world.targets.bed.position,root=this.avatar.root;
        if(action.target==='bed'&&Math.hypot(root.position.x-launch[0],root.position.z-launch[2])>.025){this.queue.unshift(action);action={type:'move',target:'bed'};}
        else{
          const to=action.target==='bed'?{...this.world.bed.position,y:this.bedHeight(Math.PI)}:{x:launch[0],y:0,z:launch[2]};
          this.current={...action,elapsed:0,startedAt:this.time,taskId:this.memory.active?.id,motor:new JumpMotor(this.world.physics,{x:root.position.x,y:root.position.y,z:root.position.z},to,action.target),fromYaw:root.rotation.y,toYaw:action.target==='bed'?Math.PI:0};
          this.log(action.target==='bed'?'在床边蓄力，准备跳上床。':'准备从床上跳回地面。');this.emit('state','jump');return;
        }
      }
      this.current={...action,elapsed:0,startedAt:this.time,taskId:this.memory.active?.id};
      if(action.type==='finish'){
        const task=this.memory.active;
        const goalStatus=verifyGoal(task?.conditions,this);
        if(action.outcome!=='failed'&&!goalStatus.met){this.complete(false,'目标状态尚未达成：'+goalStatus.unmet.map(c=>c.label+'需要 '+c.expected+'，实际 '+c.actual).join('；'),this.current,'goal_not_met');return;}
        if(action.outcome!=='failed'&&task?.failures.length){this.complete(false,'仍有未解决的动作失败，请调整行动或明确结束为失败。',this.current,'unresolved_failure');return;}
        this.record(this.current,action.outcome!=='failed',action.outcome==='failed'?'目标未完成，已保留原因。':'目标已完成。',action.outcome==='failed'?'goal_failed':'verified');
        this.memory.settle(action.outcome==='failed'?'failed':'completed',action.outcome==='failed'?(task?.failures.at(-1)?.message||'模型报告无法完成。'):'');if(action.say)this.emit('say',action.say);this.lastActivity=this.goal||this.lastActivity;this.goal=null;this.history=[];this.current=null;this.log(action.outcome==='failed'?'目标未完成，可在之后继续。':'目标已完成。','system');this.startNext();return;
      }
      if(action.type==='resume'){
        const candidate=[...this.memory.tasks].reverse().find(t=>['suspended','failed'].includes(t.status));
        if(!candidate){this.complete(false,'没有可继续的未完成任务。',this.current,'no_unfinished_task');return;}
        this.record(this.current,true,'已选择之前的任务。','verified');this.memory.settle('completed');this.goal=null;this.current=null;this.resumeGoal(candidate.id,true);return;
      }
      if(action.type==='remember'){
        const task=this.memory.active;if(task?.source!=='user'||!/记住|以后|偏好|喜欢|希望|不要|起床|睡觉|remember|prefer/i.test(task.text))throw Object.assign(new Error('只有当前用户明确提出的偏好才能保存。'),{code:'preference_not_requested'});
        this.memory.remember(action.key,action.value);this.complete(true,'已保存用户明确提出的偏好。');return;
      }
      if(bedSkills.includes(action.type)){
        if(action.type==='phone'&&action.operation==='put'&&this.world.phone?.owner==='bed'){this.complete(true,'手机已在床上原位。');return;}
        if(action.type==='stand'&&!this.director?.controlled){this.complete(true,'已经直立站好。');return;}
        if(!this.director)throw Object.assign(new Error('床上技能执行器未连接。'),{code:'director_unavailable'});
        this.current.skill=true;this.director.request(action.type==='phone'?(action.operation==='pick'?'phone':'lie'):action.type,{managed:true});
      }else if(action.type==='move'){
        const t=action.point?{name:'选择的位置',position:[action.point.x,0,action.point.z]}:this.world.targets[action.target];this.path=this.world.nav.route(this.avatar.root.position,{x:t.position[0],z:t.position[2]});this.world.setPath([{x:this.avatar.root.position.x,z:this.avatar.root.position.z},...this.path]);this.log('走向'+t.name);
      }else if(action.type==='lamp'){
        const p=this.world.targets.lamp.position;if(this.support!=='floor'||Math.hypot(this.avatar.root.position.x-p[0],this.avatar.root.position.z-p[2])>.3)throw Object.assign(new Error('需要先走到台灯前，才能操作灯具。'),{code:'out_of_reach'});
        if(this.memory.active?.source==='auto'&&this.memory.preferences.quietMode&&this.world.lampOn!==action.enabled)throw Object.assign(new Error('安静模式下，自主活动不改变灯光。'),{code:'preference_conflict'});
        this.world.setLamp(action.enabled);
      }else if(action.type==='look'||action.type==='point')this.avatar.setGaze(new THREE.Vector3(...this.world.targets[action.target].look));
      else if(action.type==='wave')this.avatar.setGaze(new THREE.Vector3(...this.world.targets.user.look));
      this.emit('state',action.type);
    }catch(e){this.complete(false,e.message,this.current||action,e.code||'blocked');}
  }
  record(action,ok,message,code='verified',status=ok?'succeeded':'failed',task=undefined,evidence=undefined){
    if(task===undefined)task=action?.taskId?this.memory.tasks.find(t=>t.id===action.taskId):this.memory.active;
    const ownerTaskId=task?.id||null;
    if(action.type==='finish')task=null;
    const result={action:Object.fromEntries(Object.entries(action).filter(([key])=>['type','target','enabled','operation','key','value'].includes(key))),taskId:ownerTaskId,ok,status,code,message,startedAt:action?.startedAt??this.time,endedAt:this.time,evidence:evidence||verifySkill(action,this).evidence};
    this.lastResult=result;this.memory.record(action,result,{task});if(this.memory.active)this.history=this.memory.active.history;this.emit('result',{action:{type:action.type,target:action.target,operation:action.operation},...result});return result;
  }
  complete(ok=true,message='完成',action=this.current,code='verified'){
    if(!action)return;action.motor?.dispose();const verification=verifySkill(action,this);
    if(ok&&!verification.ok){ok=false;message='动作未通过真实状态校验。';code='verification_failed';}
    if(!action.interrupted)this.record(action,ok,message,code,ok?'succeeded':'failed',undefined,verification.evidence);
    if(ok&&action.say)this.emit('say',action.say);
    this.current=null;this.speed=0;this.gesture='idle';this.pose=this.support==='bed'?{supportHeightAt:this.world.bed.heightAt}:{};this.world.setPath([]);
    if(!ok){this.queue=[];this.log(message,'error');if(!this.goal)this.emit('error',message);}
    this.startNext();
  }
  receiveExternal(data){
    if(data?.version!==1||!Array.isArray(data.jobs))return;
    const job=data.current;if(!job){if(!this.external){this.external={runId:null,status:'idle',active:false,unread:false};this.direct([{type:'lie'}],'联动等待中，回床上休息。',{source:'external'});}return;}
    const active=['queued','generating','ready','sending'].includes(job.status),same=this.external?.runId===job.id;
    if(same&&active&&['done','failed','cancelled','ignored','uncertain'].includes(this.external.status))return;
    if(same&&this.external.status===job.status&&this.external.computer===Boolean(job.computer))return;
    if(!same){
      this.external={runId:String(job.id).slice(0,180),status:job.status,computer:Boolean(job.computer),active,unread:active,receivedAt:this.memory.now()};this.memory.event('message_received',{runId:this.external.runId,source:data.source||'agent'});
      this.direct(active?[{type:job.computer?'sit':'phone',...(job.computer?{target:'computer'}:{operation:'pick'})}]:[{type:'lie'}],'收到 Agent 任务。',{source:'external'});
    }else{
      const computerChanged=!this.external.computer&&Boolean(job.computer);Object.assign(this.external,{status:job.status,computer:Boolean(job.computer),active});
      if(computerChanged)this.direct([{type:'sit',target:'computer'}],'真实工具调用：切换到电脑任务姿势。',{source:'external'});
    }
    if(!active){
      if(job.reply)this.emit('say',String(job.reply).slice(0,1600));this.memory.event('agent_finished',{runId:this.external.runId,status:job.status});
      this.queue.push({type:'wait',duration:job.computer?3.2:2.6},{type:'phone',operation:'put'},{type:this.memory.preferences.restPosture,...(this.memory.preferences.restPosture==='sit'?{target:'computer'}:{})});if(!this.current)this.startNext();
    }
  }
  externalDisconnected(){if(this.external&&this.external.status!=='disconnected'){this.external.active=false;this.external.status='disconnected';this.memory.event('agent_disconnected',{runId:this.external.runId});this.direct([{type:'phone',operation:'put'},{type:'stand'}],'联动连接已断开，安全结束当前姿势。',{source:'external'});}}
  update(dt){
    if(this.paused){this.avatar.update(0,0,this.gesture,this.pose);this.world.updateDebug(this.avatar.root.position);return;}
    this.time+=dt;this.memory.tick(dt,{resting:this.director?.stable==='lie'&&!this.director.transition&&!this.director.held,active:Boolean(this.current&&!['wait','lie'].includes(this.current.type))});
    if(!this.current&&!this.busy){if(this.queue.length)this.startNext();else if(this.goal&&!this.external?.active)void this.think();}
    if(this.presentation){const p=this.presentation;this.avatar.root.position.copy(p.position);this.avatar.root.quaternion.copy(p.quaternion);}
    const c=this.current,root=this.avatar.root;this.gesture=c?.type==='jump'?'jump':c?.type==='wave'?'wave':c?.type==='point'?'point':this.busy?'speak':'idle';this.pose=this.presentation?.pose||(this.support==='bed'?{supportHeightAt:this.world.bed.heightAt}:{});
    if(this.support==='bed'&&!this.presentation&&c?.type!=='jump')root.position.y=this.bedHeight();
    if(c){
      c.elapsed+=dt;
      if(c.type==='jump'){
        const sample=c.motor.advance(dt);root.position.set(sample.position.x,sample.position.y,sample.position.z);const turn=THREE.MathUtils.clamp(c.motor.age/c.motor.windup,0,1),delta=Math.atan2(Math.sin(c.toYaw-c.fromYaw),Math.cos(c.toYaw-c.fromYaw));root.rotation.set(0,c.fromYaw+delta*turn,0);if(sample.grounded&&sample.support)this.support=sample.support;
        this.pose={airborne:sample.airborne,tuck:sample.tuck,crouch:sample.crouch,jumpPhase:sample.phase,verticalSpeed:sample.velocity.y,impact:sample.impact,...(sample.grounded&&sample.support==='bed'?{supportHeightAt:this.world.bed.heightAt}:{})};this.avatar.setGaze(new THREE.Vector3(c.motor.target.x,c.motor.target.y+.65,c.motor.target.z+(c.target==='bed'?-.4:.4)));
        if(sample.done)this.complete(sample.success,sample.success?'接触目标支撑面并站稳。':'碰撞使跳跃未到达目标，已在实际支撑面站稳。',c,sample.success?'verified':'jump_failed');
      }else if(c.skill){
        if(this.director.phoneError)this.complete(false,this.director.phoneError,c,'phone_unreachable');else if(verifySkill(c,this).ok){if(c.type==='phone'&&c.operation==='pick'&&this.external)this.external.unread=false;this.complete(true,'已通过姿势与物件状态校验。');}else if(c.elapsed>14)this.complete(false,'技能执行超时，实际状态未达到目标。',c,'timeout');
      }else if(c.type==='move'){
        const next=this.path[0];if(!next)this.complete();else{
          const dx=next.x-root.position.x,dz=next.z-root.position.z,d=Math.hypot(dx,dz),remaining=this.path.reduce((sum,p,i)=>{const a=i?this.path[i-1]:root.position;return sum+Math.hypot(p.x-a.x,p.z-a.z);},0);this.speed=THREE.MathUtils.damp(this.speed,Math.min(.52,Math.sqrt(2*1.2*remaining)),7,dt);const step=Math.min(d,this.speed*dt);
          if(d<.002)this.path.shift();else{const p={x:root.position.x+dx/d*step,z:root.position.z+dz/d*step};if(!this.world.nav.clear(root.position,p))this.complete(false,'路径被阻挡，已停止。',c,'blocked');else{root.position.x=p.x;root.position.z=p.z;const yaw=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(yaw-root.rotation.y),Math.cos(yaw-root.rotation.y));root.rotation.y+=THREE.MathUtils.clamp(delta,-dt*4,dt*4);this.avatar.setGaze(new THREE.Vector3(next.x,1.05,next.z));if(d<=step+.001)this.path.shift();}}
          if(this.current===c&&c.elapsed>35)this.complete(false,'行走超时，已停止。',c,'timeout');
        }
      }else if(c.type==='look'){
        const t=this.world.targets[c.target].look,yaw=Math.atan2(t[0]-root.position.x,t[2]-root.position.z),delta=Math.atan2(Math.sin(yaw-root.rotation.y),Math.cos(yaw-root.rotation.y));root.rotation.y+=THREE.MathUtils.clamp(delta,-dt*2.5,dt*2.5);if(c.elapsed>c.duration)this.complete();
      }else if(c.elapsed>(c.type==='lamp'?.35:c.duration??2))this.complete();
    }else if(!this.busy&&this.auto&&!this.external?.active&&this.time>=this.nextAuto){
      this.scheduleAuto();
      if(!this.resumeGoal()){
        if(this.configured)void this.runGoal('自主活动：结合当前状态、模拟精力、作息、用户偏好和最近活动，选择一个小活动，完成后结束。','auto');
        else{const t=['bed','window','desk','user'][Math.floor(this.time/12)%4],rest=this.memory.energy<30,sequence=rest?[{type:'lie'},{type:'wait',duration:6}]:t==='bed'?[{type:'jump',target:'bed'},{type:'look',target:'user',duration:2},{type:'wait',duration:2},{type:'jump',target:'floor'}]:[{type:'move',target:t},{type:'look',target:t,duration:3}];this.direct(sequence,rest?'离线活动：休息恢复模拟精力。':t==='bed'?'离线漫游：跳上床看看':'离线漫游：去'+this.world.targets[t].name,{mode:'offline-auto'});}
      }
    }
    this.avatar.update(dt,this.speed,this.gesture,this.pose);this.world.updateDebug(root.position);
  }
}
