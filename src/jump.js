import {CHARACTER,PHYSICS_STEP} from './physics.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(v,b));
const moveTowards=(a,b,max)=>a+clamp(b-a,-max,max);

// Game-style kinematic movement: a destination supplies launch intent, never
// an elapsed-time position curve or an unconditional landing.
export class JumpMotor{
  constructor(physics,from,to,target){
    this.physics=physics;this.from={...from};this.target={...to};this.expectedSupport=target;
    this.gravity=12;this.windup=.18;this.recovery=.22;this.maxSpeed=3.8;this.airAcceleration=8;
    this.phase='windup';this.age=0;this.phaseAge=0;this.airTime=0;this.accumulator=0;this.steps=0;
    this.position={...from};this.velocity={x:0,y:0,z:0};this.grounded=false;this.support=null;this.contacts=[];this.impactSpeed=0;this.done=false;this.success=false;
    const rise=target==='bed'?Math.max(1.08,to.y-from.y+.27):.12;
    this.launchSpeed=Math.sqrt(2*this.gravity*rise);
    const discriminant=this.launchSpeed**2-2*this.gravity*(to.y-from.y);
    if(discriminant<0)throw new Error('目标高于当前起跳能力。');
    const estimate=(this.launchSpeed+Math.sqrt(discriminant))/this.gravity,dx=to.x-from.x,dz=to.z-from.z;
    if(Math.hypot(dx,dz)/estimate>this.maxSpeed)throw new Error('目标超出当前跳跃距离，请先靠近。');
    this.launch={x:dx/estimate,y:this.launchSpeed,z:dz/estimate};
    const {world,rapier}=physics;
    this.body=world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(from.x,from.y,from.z));
    this.collider=world.createCollider(rapier.ColliderDesc.capsule(CHARACTER.height/2-CHARACTER.radius,CHARACTER.radius).setTranslation(0,CHARACTER.height/2+physics.footOffset,0),this.body);
    this.controller=world.createCharacterController(CHARACTER.skin);this.controller.setMaxSlopeClimbAngle(Math.PI/4);this.controller.setMinSlopeSlideAngle(Math.PI/3);
    this.controller.setSlideEnabled(true);this.controller.disableAutostep();this.controller.disableSnapToGround();world.step();physics.activeMotor=this;
  }
  get airborne(){return this.phase==='rising'||this.phase==='falling';}
  get sample(){
    const crouch=this.phase==='windup'?Math.sin(clamp(this.phaseAge/this.windup,0,1)*Math.PI/2):this.phase==='landing'?Math.exp(-this.phaseAge*15)*clamp(this.impactSpeed/4,.3,1):0;
    let tuck=this.airborne?clamp((1-Math.abs(this.velocity.y)/this.launchSpeed)*.85+(this.velocity.y>0?.15:0),0,1):0;
    if(this.velocity.y<0&&Number.isFinite(this.footGap))tuck*=clamp(this.footGap/.22,0,1);
    return {position:{...this.position},velocity:{...this.velocity},phase:this.phase,airborne:this.airborne,grounded:this.grounded,support:this.support,crouch,tuck,impact:this.impactSpeed,done:this.done,success:this.success};
  }
  advance(delta){
    if(this.done)return this.sample;this.accumulator+=clamp(delta,0,.2);
    while(this.accumulator+1e-10>=PHYSICS_STEP&&!this.done){this.step(PHYSICS_STEP);this.accumulator-=PHYSICS_STEP;}return this.sample;
  }
  step(dt){
    this.age+=dt;this.phaseAge+=dt;this.steps++;
    if(this.phase==='windup'&&this.phaseAge>=this.windup){
      if(this.grounded){this.velocity={...this.launch};this.phase='rising';this.phaseAge=0;this.grounded=false;this.support=null;}
      else{this.phase='falling';this.phaseAge=0;}
    }
    if(this.airborne&&!this.aborted){
      this.airTime+=dt;
      const remaining=(this.velocity.y+Math.sqrt(Math.max(0,this.velocity.y**2+2*this.gravity*(this.position.y-this.target.y))))/this.gravity;
      if(remaining>.025){
        const dx=this.target.x-this.position.x,dz=this.target.z-this.position.z,dist=Math.hypot(dx,dz),speed=Math.min(this.maxSpeed,dist/remaining);
        this.velocity.x=moveTowards(this.velocity.x,dist>.01?dx/dist*speed:0,this.airAcceleration*dt);this.velocity.z=moveTowards(this.velocity.z,dist>.01?dz/dist*speed:0,this.airAcceleration*dt);
      }
    }else if(this.phase==='landing'){this.velocity.x=moveTowards(this.velocity.x,0,60*dt);this.velocity.z=moveTowards(this.velocity.z,0,60*dt);}
    const beforeVy=this.velocity.y,movement={x:this.velocity.x*dt,y:this.velocity.y*dt-.5*this.gravity*dt*dt,z:this.velocity.z*dt};this.velocity.y-=this.gravity*dt;
    this.controller.computeColliderMovement(this.collider,movement);
    const corrected=this.controller.computedMovement(),contacts=[];let support=null;
    for(let i=0;i<this.controller.numComputedCollisions();i++){
      const hit=this.controller.computedCollision(i),normal=hit.normal1,label=this.physics.labels.get(hit.collider?.handle)||'obstacle';contacts.push({id:label,normal:{...normal}});
      if(normal.y>.65)support=label;
      const into=this.velocity.x*normal.x+this.velocity.y*normal.y+this.velocity.z*normal.z;
      if(into<0&&normal.y<.65){this.velocity.x-=normal.x*into;this.velocity.y-=normal.y*into;this.velocity.z-=normal.z*into;}
    }
    this.contacts=contacts;const p=this.body.translation();this.body.setNextKinematicTranslation({x:p.x+corrected.x,y:p.y+corrected.y,z:p.z+corrected.z});this.physics.world.step();this.position={...this.body.translation()};
    const {world,rapier,footOffset}=this.physics;
    const ray=new rapier.Ray({x:this.position.x,y:this.position.y+footOffset+.05,z:this.position.z},{x:0,y:-1,z:0});
    const ground=world.castRayAndGetNormal(ray,.25,true,undefined,undefined,this.collider,this.body);
    const footGap=ground?ground.timeOfImpact-.05:Infinity;this.footGap=footGap;
    // computedGrounded includes predictive near-ground contacts. A downward
    // probe must also confirm real sole contact, otherwise velocity would be
    // zeroed while the character is still above the mattress.
    this.grounded=this.controller.computedGrounded()&&beforeVy<=0&&ground?.normal.y>.65&&footGap<=CHARACTER.skin+.005;
    if(this.grounded){this.support=this.physics.labels.get(ground.collider.handle)||support||'floor';this.velocity.y=0;if(this.airborne){this.phase='landing';this.phaseAge=0;this.impactSpeed=Math.abs(beforeVy);}}
    else if(this.phase==='rising'&&this.velocity.y<=0)this.phase='falling';
    if(this.phase==='landing'&&!this.grounded){this.phase='falling';this.phaseAge=0;this.support=null;}
    if(this.phase==='landing'&&this.phaseAge>=this.recovery&&Math.hypot(this.velocity.x,this.velocity.z)<.03){this.done=true;this.success=!this.aborted&&this.support===this.expectedSupport&&Math.hypot(this.position.x-this.target.x,this.position.z-this.target.z)<.18;}
    if(this.age>4&&this.airborne){this.aborted=true;this.velocity.x=this.velocity.z=0;}
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.physics.world.removeCharacterController(this.controller);this.physics.world.removeRigidBody(this.body);if(this.physics.activeMotor===this)this.physics.activeMotor=null;}
}
