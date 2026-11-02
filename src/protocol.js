import {validatePreference} from './cognition.js';
export const targetIds=['window','desk','bed','center','user','lamp'];
export const actionTypes=['move','look','wave','point','lamp','jump','wait','lie','stand','phone','sit','remember','resume','finish'];
export function validatePlan(value){
  if(!value||typeof value!=='object'||!value.action)throw new Error('模型没有返回有效的 action。');
  const a=value.action;
  if(!actionTypes.includes(a.type))throw new Error('模型返回了尚未实现的动作。');
  const action={type:a.type};
  if(a.type==='phone'){
    if(!['pick','put'].includes(a.operation))throw new Error('手机动作需要 operation=pick 或 put。');
    action.operation=a.operation;
  }
  if(a.type==='sit'){
    if(a.target!=='computer')throw new Error('坐姿只能选择电脑旁的床角。');
    action.target='computer';
  }
  if(a.type==='remember'){action.key=String(a.key??'');action.value=validatePreference(action.key,a.value);}
  if(a.type==='finish'){
    if(a.outcome!==undefined&&!['success','failed'].includes(a.outcome))throw new Error('目标结果需要 success 或 failed。');
    if(a.outcome)action.outcome=a.outcome;
  }
  if(a.type==='jump'){
    if(!['bed','floor'].includes(a.target))throw new Error('跳跃只能选择床面或地面。');
    action.target=a.target;
  }
  if(['move','look','point'].includes(a.type)){
    if(!targetIds.includes(a.target))throw new Error('模型选择了不存在的目标。');
    action.target=a.target;
  }
  if(a.type==='lamp'){
    if(typeof a.enabled!=='boolean')throw new Error('开关灯动作缺少 enabled。');
    action.enabled=a.enabled;
  }
  if(['wave','look','point','wait'].includes(a.type)){
    const d=Number(a.duration??2);
    if(!Number.isFinite(d))throw new Error('动作时长无效。');
    action.duration=Math.max(.5,Math.min(d,6));
  }
  return {say:String(value.say??'').slice(0,160),reason:String(value.reason??'').slice(0,200),action};
}
export class PlanFormatError extends Error{
  constructor(message,code='invalid_plan'){super(message);this.name='PlanFormatError';this.code=code;}
}
export function completionText(content){
  if(Array.isArray(content))return content.filter(p=>p?.type==='text'||p?.type==='output_text').map(p=>typeof p.text==='string'?p.text:'').join('\n');
  return typeof content==='string'?content:'';
}
export function parsePlan(content){
  let text=completionText(content).trim();
  if(!text||text.length>30000)throw new PlanFormatError('模型没有返回可读取的动作内容。','empty');
  const validate=value=>{try{return validatePlan(value);}catch(e){throw new PlanFormatError(e.message,'invalid_action');}};
  // Prefer the whole JSON value; braces or <think> quoted in speech are data.
  try{return validate(JSON.parse(text));}catch(e){if(!(e instanceof SyntaxError))throw e;}
  text=text.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi,'').replace(/<think\b[^>]*>[\s\S]*$/gi,'').trim();
  // Read complete top-level objects, respecting quotes, escapes and nesting.
  const objects=[];let start=-1,depth=0,quoted=false,escaped=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(start<0){if(c==='{'){start=i;depth=1;}continue;}
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){objects.push(text.slice(start,i+1));start=-1;}
  }
  const plans=[];let invalid;
  for(const object of objects){try{plans.push(validate(JSON.parse(object)));}catch(e){invalid=e;}}
  if(plans.length===1)return plans[0];
  if(plans.length>1)throw new PlanFormatError('模型返回了多个动作对象；每次只能决定一个动作。','multiple');
  if(invalid instanceof PlanFormatError)throw invalid;
  throw new PlanFormatError(objects.length?'模型返回的 JSON 无法解析。':'模型尚未返回完整的 JSON 动作。','invalid_json');
}
const fields={type:{type:'string',enum:actionTypes},target:{type:'string',enum:[...targetIds,'floor','computer']},enabled:{type:'boolean'},duration:{type:'number',minimum:.5,maximum:6},operation:{type:'string',enum:['pick','put']},outcome:{type:'string',enum:['success','failed']}};
const branch=(types,extra=[])=>({type:'object',properties:Object.fromEntries(['type',...extra].map(k=>[k,k==='type'?{type:'string',enum:types}:fields[k]])),required:['type',...extra],additionalProperties:false});
const rememberBranch=(key,value)=>({type:'object',properties:{type:{type:'string',enum:['remember']},key:{type:'string',enum:[key]},value},required:['type','key','value'],additionalProperties:false});
export const PLAN_SCHEMA={type:'object',properties:{say:{type:'string'},reason:{type:'string'},action:{anyOf:[branch(['move'],['target']),branch(['look','point'],['target','duration']),branch(['wave','wait'],['duration']),branch(['lamp'],['enabled']),branch(['jump'],['target']),branch(['lie','stand','resume']),branch(['sit'],['target']),branch(['phone'],['operation']),branch(['finish']),branch(['finish'],['outcome']),rememberBranch('restPosture',{type:'string',enum:['lie','sit','stand']}),rememberBranch('quietMode',{type:'boolean'}),...['sleepHour','wakeHour'].map(k=>rememberBranch(k,{type:'integer',minimum:0,maximum:23}))]}},required:['say','reason','action'],additionalProperties:false};
export function completionUrl(base){
  const u=new URL(base);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('请填写 http 或 https 接口地址。');
  u.hash='';u.search='';
  u.pathname=u.pathname.replace(/\/+$/,'');
  if(!u.pathname.endsWith('/chat/completions'))u.pathname+='/chat/completions';
  return u.toString();
}
export const SYSTEM_PROMPT=`你是住在蓝色夜景卧室里的小肥鱼，控制一个真实的 VRM 角色。
你每次收到用户目标、当前世界状态和上一步执行反馈，只决定下一步。先对比当前用户目标和 goalStatus.unmet；goalStatus.met=false 时必须先行动满足缺失的状态，不能 finish success。不要把最近其他任务的完成当作当前目标完成。不要写长推理。reason 只写一句依据可见状态的简短行动说明。
只返回一个 JSON 对象，不要 Markdown、说明文字或多个候选，格式 {"say":"对用户说的话，可为空","reason":"一句行动说明","action":{"type":"move","target":"desk"}}。无论是自主活动、普通聊天还是无法完成的要求，都必须使用同一 JSON 格式。普通聊天可用 finish，不能只返回聊天正文。
可用目标只有 window 窗边、desk 书桌、bed 床边、center 房间中央、user 用户、lamp 台灯。
动作：move(target) 走到地面停靠点；look(target,duration) 注视；wave(duration) 挥手；point(target,duration) 指向；lamp(enabled) 控制台灯，需先 move lamp；jump(target="bed"或"floor") 实际跳跃；wait(duration) 等待；lie() 上床侧躺；stand() 放回手机并起身，留在当前支撑面；phone(operation="pick"或"put") 拿起抬到面前或放回床上原位；sit(target="computer") 坐到电脑旁指定床角。lie、sit、phone pick 自动满足上床等前置条件，move 自动放手机、起身及下床。
support、posture、phone、external、lastResult 和 skills 是实际观察。过渡中不等于姿势完成，phone.owner=hand 才代表真正拿到；结果的 status/code/message/evidence 提供完成或失败依据。不能仅因计时结束、说过一句话就声称达成。其他任意抓取或修改模型暂不支持。
finish(outcome="success"或"failed") 结束当前目标，默认 success；仍有未解决失败时只能说明原因并 finish failed。resume() 继续最近未完成任务，依据当前观察重新规划，不能重放旧坐标。临时打断结束后原目标也会自动恢复。
memory 提供最近活动、挂起任务和用户偏好；needs 是明确的模拟精力/作息，不是真实生理状态。仅当当前用户明确要求记住或表达以后偏好时，使用 remember(key,value)：restPosture=lie/sit/stand、quietMode=布尔、sleepHour/wakeHour=0至23整数。不要从闲聊猜测偏好或把自主想法写成用户偏好。自主活动遵守 quietMode，休息时优先 restPosture；低精力或作息休息时选择适当休息。
角色有很宽的头发和长尾巴，不能穿过床和桌子间的窄缝。窗外和书桌有地面观察点，不能要求硬挤进家具或假装碰到了物件。
桌边与窗边需要先 move 到附近再 look。挥手前可以先 look user。灯具开关为逻辑交互，没有触碰开关的物理动画。
若反馈动作失败，根据 reachable、code 和当前真实状态调整，或明确说明无法完成；不要无变化重复失败动作。目标达成必须返回 finish。每个目标最多 10 步。
自主活动时根据位置、上次活动、空闲时间选择一个小活动（看窗外、走到书桌前、跳上床站一会再跳下、向用户挥手），避免反复重复。只控制场景里提供的能力。
例如目标是拿手机，而 phone.owner=bed 时，先执行 {"type":"phone","operation":"pick"}，执行器会自动上床侧躺；收到手机在手的成功反馈后才 finish。若要求先侧躺，先 lie，再 phone pick。goal_not_met 表示目标还没达成，按 goalStatus.unmet 补做动作。`;
