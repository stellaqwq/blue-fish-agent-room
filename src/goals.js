import {verifySkill} from './skills.js';

// A deliberately small room-command grammar. It handles direct sequential
// requests and pronoun-free object elision, not arbitrary natural-language goals.
export function goalConditions(text){
  if(/如果|要是|或者|否则|\bif\b|\bor\b/i.test(text))return [];
  const conditions=new Map();let topic='';
  const set=(key,value)=>conditions.set(key,{key,value});
  const upright=()=>{set('posture','stand');set('phoneOwner','bed');};
  const bedPose=posture=>{set('posture',posture);set('support','bed');conditions.delete('near');};
  for(const clause of String(text).split(/[，,。.;；！？!?]|然后|之后|接着|随后|再/)){
    // Do not turn a preference, question about past state, or negated request
    // into a positive physical requirement.
    if(/不要|不用|不想|别|记住|偏好|以前|之前|刚才|有没有/.test(clause))continue;
    if(/手机/.test(clause))topic='phone';else if(/灯/.test(clause))topic='lamp';else if(/电脑|窗|门/.test(clause))topic='';
    const effects=[];
    const scan=(pattern,effect)=>{for(const match of clause.matchAll(pattern))effects.push({index:match.index,effect:()=>effect(match)});};
    if(topic==='phone'){
      scan(/拿起|拿着|拿手机|看手机|捡起/g,()=>{bedPose('lie');set('phoneOwner','hand');});
      scan(/放下|放回|放手机/g,()=>set('phoneOwner','bed'));
      scan(/手机.{0,8}(?:在手里|在手中)/g,()=>{bedPose('lie');set('phoneOwner','hand');});
    }
    if(topic==='lamp'){
      scan(/打开|开启|开灯|亮起/g,()=>set('lampOn',true));scan(/关闭|关掉|关灯|熄灭/g,()=>set('lampOn',false));
    }
    scan(/侧躺|躺下|躺在(?:床|被|枕)/g,()=>{bedPose('lie');set('phoneOwner','bed');});
    scan(/坐(?:到|在|回)?.{0,12}(?:床边|床角|电脑旁|电脑边)/g,()=>{bedPose('sit');set('phoneOwner','bed');});
    scan(/起身|站起来|站起|站好|挥手|招手|指向|看向(?:我|你|窗外|书桌|电脑)/g,upright);
    scan(/跳上床|上床/g,()=>{upright();set('support','bed');conditions.delete('near');});
    scan(/跳下(?:床)?|下床/g,()=>{upright();set('support','floor');conditions.delete('near');});
    scan(/(?:去|走到|走向|回到)(窗边|窗前|桌前|书桌前|床边|台灯前|房间中央)/g,m=>{upright();set('support','floor');set('near',({窗边:'window',窗前:'window',桌前:'desk',书桌前:'desk',床边:'bed',台灯前:'lamp',房间中央:'center'})[m[1]]);});
    effects.sort((a,b)=>a.index-b.index);for(const {effect}of effects)effect();
  }
  return [...conditions.values()];
}
const labels={posture:'姿势',phoneOwner:'手机归属',lampOn:'灯光',support:'支撑面',near:'到达目标'};
export function verifyGoal(conditions,agent){
  const d=agent.director,p=agent.avatar.root.position,checks=[];
  for(const condition of conditions||[]){
    const {key,value}=condition;let actual,ok=false;
    if(key==='lampOn'){actual=agent.world.lampOn;ok=actual===value;}
    else if(key==='support'){actual=agent.support;ok=actual===value&&!agent.current?.motor?.airborne;}
    else if(key==='phoneOwner'){actual=agent.world.phone?.owner||'unavailable';ok=actual===value&&verifySkill({type:'phone',operation:value==='hand'?'pick':'put'},agent).ok;}
    else if(key==='posture'){
      actual=d?.transition?'transition':d?.stable||'stand';
      if(value==='stand')ok=verifySkill({type:'stand'},agent).ok;
      else if(d){const pose=d.poseFor(value);ok=d.stable===value&&!d.transition&&!d.phoneMotion&&p.distanceTo(pose.position)<.025&&agent.avatar.root.quaternion.angleTo(pose.quaternion)<.04;}
    }else if(key==='near'){
      const target=agent.world.targets[value];actual=target?+Math.hypot(p.x-target.position[0],p.z-target.position[2]).toFixed(3):null;ok=actual!==null&&actual<.04&&agent.support==='floor';
    }
    checks.push({key,label:labels[key],expected:value,actual,ok});
  }
  return {verifiable:checks.length>0,met:checks.every(c=>c.ok),checks,unmet:checks.filter(c=>!c.ok)};
}
