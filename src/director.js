import * as THREE from 'three';
const ease=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
const qEuler=(x,y,z)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z));
const copy=p=>({position:p.position.clone(),quaternion:p.quaternion.clone(),pose:{...p.pose}});

export class ActivityDirector extends EventTarget{
  constructor(agent,world,avatar){super();Object.assign(this,{agent,world,avatar});agent.director=this;this.desired='stand';this.stable='stand';this.controlled=false;this.transition=null;this.phoneMotion=null;this.held=false;this.wantPhone=false;this.completed=false;this.age=0;this.activeRun=null;this.baselined=false;this.releaseCallback=null;this.phoneError='';}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  status(text){if(this.label!==text){this.label=text;this.emit('state',text);}}
  request(mode,{managed=false}={}){
    if(!['lie','phone','sit','stand'].includes(mode))return;
    if(!managed){this.agent.auto=false;return this.agent.direct([{type:mode,...(mode==='phone'?{operation:'pick'}:mode==='sit'?{target:'computer'}:{})}],'床上动作：'+mode);}
    this.desired=mode==='phone'?'lie':mode;this.wantPhone=mode==='phone';this.controlled=mode!=='stand'||this.controlled;
    this.age=0;this.phoneError='';
  }
  observation(){
    const phone=this.world.phone,hand=this.avatar.bones.rightHand?.getWorldPosition(new THREE.Vector3());
    return {posture:this.transition?'transition':this.stable,target:this.desired,controlled:this.controlled,phone:{owner:phone.owner,held:this.held,motion:this.phoneMotion?.phase||null,gripDistance:hand?+hand.distanceTo(phone.group.position).toFixed(3):null,homeDistance:+phone.home.distanceTo(phone.group.position).toFixed(3),error:this.phoneError||null}};
  }
  snapshot(data){
    if(data?.version!==1||!Array.isArray(data.jobs))return;
    this.baselined=true;this.activeRun=data.current?.id;this.completed=Boolean(data.current&&!['queued','generating','ready','sending'].includes(data.current.status));this.agent.receiveExternal(data);
  }
  disconnected(){this.emit('log','联动连接已断开，等待重连。');this.signature='';this.completed=true;this.agent.externalDisconnected();}
  release(callback){this.completed=false;this.wantPhone=false;this.desired='stand';this.releaseCallback=callback;this.agent.auto=false;this.agent.paused=false;}
  reset(){this.controlled=false;this.agent.presentation=null;this.transition=null;this.phoneMotion=null;this.held=false;this.wantPhone=false;this.completed=false;this.baselined=false;this.signature='';this.activeRun=null;this.age=0;this.label='';this.phoneError='';this.desired=this.stable='stand';this.releaseCallback=null;this.world.phone.rest();}
  poseFor(mode){
    if(mode==='lie')return {position:new THREE.Vector3(-.95,1.215,-.65),quaternion:qEuler(0,0,Math.PI/2),pose:{lying:1,sitting:0}};
    if(mode==='sit'){const {x,z}=this.world.bed.computerSeat,y=this.world.bed.heightAt(x,z)-.145,yaw=Math.atan2(1.67-x,-.44-z);return {position:new THREE.Vector3(x,y,z),quaternion:qEuler(0,yaw,0),pose:{lying:0,sitting:1}};}
    return {position:new THREE.Vector3(this.world.bed.position.x,this.agent.bedHeight(Math.PI),this.world.bed.position.z),quaternion:qEuler(0,Math.PI,0),pose:{lying:0,sitting:0,supportHeightAt:this.world.bed.heightAt}};
  }
  before(dt){
    if(!this.controlled||this.agent.paused)return;
    this.age+=dt;
    if(!this.agent.presentation){
      if(this.agent.current&&!this.agent.current.skill)return;
      if(this.agent.support!=='bed'){this.status('等待安全到达床上');return;}
      this.agent.presentation={position:this.avatar.root.position.clone(),quaternion:this.avatar.root.quaternion.clone(),pose:{lying:0,sitting:0,supportHeightAt:this.world.bed.heightAt}};this.stable='stand';
    }
    let next=this.desired;if(this.held||this.phoneMotion)next='lie';
    if(!this.transition&&this.stable!==next)this.transition={from:copy(this.agent.presentation),to:this.poseFor(next),mode:next,time:0};
    if(this.transition){
      const t=this.transition;t.time+=dt;const u=ease(t.time/1.2),p=this.agent.presentation;
      p.position.lerpVectors(t.from.position,t.to.position,u);p.quaternion.slerpQuaternions(t.from.quaternion,t.to.quaternion,u);
      p.pose={lying:THREE.MathUtils.lerp(t.from.pose.lying||0,t.to.pose.lying||0,u),sitting:THREE.MathUtils.lerp(t.from.pose.sitting||0,t.to.pose.sitting||0,u)};
      this.status(t.mode==='lie'?'慢慢侧躺下':t.mode==='sit'?'坐到床边':'从床上起身');
      if(u>=1){this.stable=t.mode;if(t.mode==='sit')this.sitSince=this.age;this.agent.presentation=copy(t.to);this.transition=null;this.avatar.resetSecondaryMotion?.();}
    }
    const p=this.agent.presentation;
    if(!this.transition){
      if(this.stable==='lie')this.updatePhone(dt,p);
      else if(this.stable==='sit')this.status('坐在床边看电脑');
      else if(this.desired==='stand'&&!this.held&&!this.phoneMotion){
        // Hand the upright transform back in the walk controller's yaw-only
        // Euler convention; a Y=PI quaternion can otherwise become X=Z=PI.
        this.avatar.root.position.copy(p.position);this.avatar.root.rotation.set(0,Math.PI,0);this.avatar.root.updateMatrixWorld(true);this.avatar.resetSecondaryMotion?.();
        this.agent.presentation=null;this.controlled=false;this.agent.support='bed';this.stable='stand';const callback=this.releaseCallback;this.releaseCallback=null;callback?.();return;
      }
    }
    if(this.stable==='sit')this.avatar.setGaze(new THREE.Vector3(1.67,1.15,-.44));
    else if(this.held)this.avatar.setGaze(this.world.phone.group.position.clone());
    else this.avatar.setGaze(new THREE.Vector3(-2,1.8,4));
  }
  updatePhone(dt,p){
    if(this.wantPhone&&!this.held&&!this.phoneMotion&&!this.phoneError)this.phoneMotion={phase:'pick',time:0,from:this.avatar.bones.rightHand.getWorldPosition(new THREE.Vector3())};
    if(!this.wantPhone&&this.held&&!this.phoneMotion&&!this.phoneError)this.phoneMotion={phase:'put',time:0,from:this.avatar.bones.rightHand.getWorldPosition(new THREE.Vector3())};
    const motion=this.phoneMotion;
    if(motion){
      motion.time+=dt;const home=this.world.phone.home.clone().add(new THREE.Vector3(-.03,.02,-.015));
      const upper=this.avatar.bones.rightUpperArm.getWorldPosition(new THREE.Vector3()),lower=this.avatar.bones.rightLowerArm.getWorldPosition(new THREE.Vector3()),hand=this.avatar.bones.rightHand.getWorldPosition(new THREE.Vector3());
      const length=upper.distanceTo(lower)+lower.distanceTo(hand),heldTarget=upper.clone().addScaledVector(new THREE.Vector3(-.15,.65,.75).normalize(),length*.90);
      const target=motion.phase==='raise'?heldTarget:home;p.pose.handTarget=motion.from.clone().lerp(target,ease(motion.time/.75)).toArray();
      this.status(motion.phase==='pick'?'伸手拿起手机':motion.phase==='put'?'把手机放回床上':'拿到面前看手机');
      if(motion.time>.8){
        if(motion.phase==='pick'&&hand.distanceTo(home)<.04){this.held=true;this.gripOffset=this.world.phone.home.clone().sub(hand);this.world.phone.owner='hand';this.phoneMotion={phase:'raise',time:0,from:hand.clone()};}
        else if(motion.phase==='raise'){this.phoneMotion=null;this.heldTarget=heldTarget;this.heldSince=this.age;}
        else if(motion.phase==='put'&&hand.distanceTo(home)<.04){this.held=false;this.phoneMotion=null;this.world.phone.rest();delete p.pose.handTarget;}
        else if(motion.time>2){this.phoneError='手暂时够不到手机，请检查姿势接触。';this.emit('error',this.phoneError);this.phoneMotion=null;this.wantPhone=false;}
      }
    }else if(this.held){
      const upper=this.avatar.bones.rightUpperArm.getWorldPosition(new THREE.Vector3()),lower=this.avatar.bones.rightLowerArm.getWorldPosition(new THREE.Vector3()),hand=this.avatar.bones.rightHand.getWorldPosition(new THREE.Vector3());
      const length=upper.distanceTo(lower)+lower.distanceTo(hand);p.pose.handTarget=upper.addScaledVector(new THREE.Vector3(-.15,.65,.75).normalize(),length*.9).toArray();this.status('侧躺着看手机');
    }else{delete p.pose.handTarget;this.status('侧躺在床上休息');}
  }
  after(){
    if(this.held){
      const hand=this.avatar.bones.rightHand.getWorldPosition(new THREE.Vector3()),offset=new THREE.Vector3(-.025,.025,.09),motion=this.phoneMotion;
      if(motion?.phase==='raise')offset.lerpVectors(this.gripOffset,offset,ease(motion.time/.75));
      if(motion?.phase==='put')offset.lerp(this.world.phone.home.clone().sub(hand),ease(motion.time/.75));
      this.world.phone.group.position.copy(hand).add(offset);const direction=this.avatar.getHead().sub(this.world.phone.group.position).normalize();this.world.phone.group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
    }
  }
}
