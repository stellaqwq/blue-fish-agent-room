// Small, bounded local memory. Physical state is always observed afresh.
const KEY='blue-fish-memory-v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const text=(value,max=200)=>String(value??'').slice(0,max);
const cleanConditions=value=>(Array.isArray(value)?value:[]).filter(c=>c&&(['posture','support','phoneOwner','near'].includes(c.key)&&typeof c.value==='string'||c.key==='lampOn'&&typeof c.value==='boolean')).slice(0,5).map(c=>({key:c.key,value:c.value}));
export const preferenceRules={restPosture:['lie','sit','stand'],quietMode:'boolean',sleepHour:'hour',wakeHour:'hour'};
export function validatePreference(key,value){
  const rule=preferenceRules[key];
  if(!rule)throw new Error('尚不支持这个偏好项。');
  if(Array.isArray(rule)?!rule.includes(value):rule==='boolean'?typeof value!=='boolean':!Number.isInteger(value)||value<0||value>23)throw new Error('偏好值无效。');
  return value;
}
export class RoomMemory{
  constructor({storage,now=()=>Date.now()}={}){
    this.storage=storage;this.now=now;this.serial=0;this.tasks=[];this.currentId=null;this.activities=[];this.events=[];this.preferences={restPosture:'lie',quietMode:false,sleepHour:23,wakeHour:7};this.energy=80;this.elapsed=0;this.sinceSave=0;this.storageError='';
    try{
      const raw=storage?.getItem(KEY);if(raw&&raw.length<80000){const data=JSON.parse(raw);
        if(data.version===1){
          for(const [key,value]of Object.entries(data.preferences||{})){try{this.preferences[key]=validatePreference(key,value);}catch{}}
          this.energy=Number.isFinite(data.energy)?Math.max(0,Math.min(100,data.energy)):80;
          this.tasks=(Array.isArray(data.tasks)?data.tasks:[]).slice(-8).filter(t=>t&&typeof t.id==='string'&&typeof t.text==='string'&&['active','suspended','failed','completed','cancelled'].includes(t.status)).map(t=>({id:text(t.id,80),text:text(t.text,1200),source:t.source==='auto'?'auto':'user',status:t.status==='active'?'suspended':t.status,reason:t.status==='active'?'页面已重新加载，等待继续。':text(t.reason),steps:Math.min(10,Math.max(0,Number(t.steps)||0)),history:(Array.isArray(t.history)?t.history:[]).slice(-10),failures:(Array.isArray(t.failures)?t.failures:[]).slice(-8),conditions:cleanConditions(t.conditions),updatedAt:Number(t.updatedAt)||0}));
          this.activities=(Array.isArray(data.activities)?data.activities:[]).slice(-12);this.events=(Array.isArray(data.events)?data.events:[]).slice(-8);
        }
      }
    }catch{this.storageError='本地记忆暂时无法读取，将使用本次会话记忆。';}
  }
  get active(){return this.tasks.find(t=>t.id===this.currentId&&t.status==='active')||null;}
  save(){
    try{this.storage?.setItem(KEY,JSON.stringify({version:1,preferences:this.preferences,energy:+this.energy.toFixed(2),tasks:this.tasks,activities:this.activities,events:this.events}));}
    catch{this.storageError='本地记忆暂时无法保存，当前会话仍可继续。';}
  }
  event(type,detail={}){const event={type,at:this.now(),...detail};this.events.push(event);this.events=this.events.slice(-8);this.save();return event;}
  begin(goal,source='user',conditions=[]){
    this.suspend('被新的目标暂时打断。');
    const task={id:this.now().toString(36)+'-'+(++this.serial),text:text(goal,1200),source:source==='auto'?'auto':'user',status:'active',reason:'',steps:0,history:[],failures:[],conditions:cleanConditions(conditions),updatedAt:this.now()};
    this.tasks.push(task);this.currentId=task.id;
    // Keep unfinished goals ahead of completed historical entries.
    while(this.tasks.length>8){const i=this.tasks.findIndex(t=>['completed','cancelled'].includes(t.status));this.tasks.splice(i>=0?i:0,1);}
    this.save();return task;
  }
  suspend(reason){const task=this.active;if(task){task.status='suspended';task.reason=reason;task.updatedAt=this.now();this.currentId=null;this.save();}return task;}
  settle(status,reason=''){const task=this.active;if(task){task.status=status;task.reason=text(reason);task.updatedAt=this.now();this.currentId=null;this.save();}return task;}
  resume(id,{includeFailed=false}={}){
    const task=[...this.tasks].reverse().find(t=>(!id||t.id===id)&&(t.status==='suspended'||includeFailed&&t.status==='failed'));
    if(!task)return null;this.suspend('等待当前目标结束。');const reason=task.reason;task.status='active';task.reason='';task.updatedAt=this.now();if(includeFailed)task.steps=0;this.currentId=task.id;this.event('goal_resumed',{taskId:task.id,reason});return task;
  }
  cancel(reason){for(const task of this.tasks)if(['active','suspended','failed'].includes(task.status)){task.status='cancelled';task.reason=text(reason);task.updatedAt=this.now();}this.currentId=null;this.save();}
  record(action,result,{task=this.active}={}){
    const clean=Object.fromEntries(Object.entries(action||{}).filter(([k])=>['type','target','enabled','duration','operation','key','value'].includes(k)));
    const item={action:clean,result:clone(result),at:this.now()};this.activities.push(item);this.activities=this.activities.slice(-12);
    if(task){task.history.push(item);task.history=task.history.slice(-10);const key=JSON.stringify(clean);
      if(result.status==='failed')task.failures=[...task.failures.filter(f=>f.key!==key),{key,action:clean,code:result.code,message:result.message}].slice(-8);
      if(result.status==='succeeded')task.failures=task.failures.filter(f=>f.key!==key);
      task.updatedAt=this.now();
    }this.save();return item;
  }
  remember(key,value){this.preferences[key]=validatePreference(key,value);this.event('preference_changed',{key,value});}
  tick(dt,{resting=false,active=false}={}){this.elapsed+=dt;this.sinceSave+=dt;this.energy=Math.max(0,Math.min(100,this.energy+dt*(resting?.04:active?-.06:-.008)));if(this.sinceSave>=30){this.sinceSave=0;this.save();}}
  observation(){
    const hour=new Date(this.now()).getHours(),{sleepHour,wakeHour}=this.preferences,night=sleepHour===wakeHour?false:sleepHour>wakeHour?hour>=sleepHour||hour<wakeHour:hour>=sleepHour&&hour<wakeHour;
    return {activeGoal:this.active?clone(this.active):null,unfinishedTasks:clone(this.tasks.filter(t=>['suspended','failed'].includes(t.status))),recentActivities:clone(this.activities),recentEvents:clone(this.events),preferences:{...this.preferences},persistence:this.storageError||'仅保存在当前浏览器本地',needs:{kind:'simulation',energy:+this.energy.toFixed(1),elapsedSeconds:Math.round(this.elapsed),routine:{localHour:hour,sleepHour,wakeHour,restTime:night}}};
  }
}
