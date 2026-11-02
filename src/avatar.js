import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRMUtils,VRMSpringBoneCollider,VRMSpringBoneColliderShapePlane} from '@pixiv/three-vrm';
import {addTailRig} from './rig-tail.js';

const v=new THREE.Vector3(),q=new THREE.Quaternion(),inv=new THREE.Quaternion();
export const requiredBones=['hips','spine','head',...['left','right'].flatMap(s=>['UpperArm','LowerArm','Hand','UpperLeg','LowerLeg','Foot'].map(n=>s+n))];
export function resolveAvatarBones(vrm){
  if(!vrm?.humanoid)throw new Error('角色没有可读取的 VRM 人形骨骼。');
  const bones=Object.fromEntries([...requiredBones,'neck','chest'].map(name=>[name,vrm.humanoid.getNormalizedBoneNode(name)]));
  const missing=requiredBones.filter(name=>!bones[name]);
  if(missing.length)throw new Error('该模型缺少必需骨骼：'+missing.join('、')+'，无法驱动行走、注视和手机交互。');
  return bones;
}
export function createBedHairCollider(){
  // The library defaults to +Z: moving that vertical plane down does not
  // disable it. This contact surface must use the room's upward +Y axis.
  const collider=new VRMSpringBoneCollider(new VRMSpringBoneColliderShapePlane({normal:new THREE.Vector3(0,1,0)}));
  collider.position.y=-100;return collider;
}
function orient(bone,child,target){
  const a=bone.getWorldPosition(new THREE.Vector3()),b=child.getWorldPosition(new THREE.Vector3());
  const delta=new THREE.Quaternion().setFromUnitVectors(b.sub(a).normalize(),target.clone().sub(a).normalize());
  const world=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  bone.updateWorldMatrix(false,true);
}
function solveLeg(upper,lower,foot,target,pole){
  const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=foot.getWorldPosition(new THREE.Vector3());
  const l1=a.distanceTo(b),l2=b.distanceTo(c),dir=target.clone().sub(a),d=Math.min(dir.length(),l1+l2-.0001);
  dir.normalize();
  const bend=pole.clone().sub(a).addScaledVector(dir,-pole.clone().sub(a).dot(dir)).normalize();
  const cos=THREE.MathUtils.clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1);
  const knee=a.clone().addScaledVector(dir,l1*cos).addScaledVector(bend,l1*Math.sqrt(1-cos*cos));
  orient(upper,lower,knee);orient(lower,foot,target);
}

export async function loadAvatar(scene,onProgress){
  const health=await fetch('/api/health').then(r=>r.json());
  if(!health.avatarFound)throw new Error('未找到角色模型。请在房间目录的 .env 中设置 AVATAR_PATH，然后重启房间。');
  const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
  const gltf=await loader.loadAsync('/assets/avatar.vrm',onProgress),vrm=gltf.userData.vrm;
  const bones=resolveAvatarBones(vrm);
  VRMUtils.rotateVRM0(vrm);
  const root=new THREE.Group();root.name='AgentRoot';scene.add(root);root.add(vrm.scene);
  vrm.humanoid.resetNormalizedPose();
  const bounds=new THREE.Box3().setFromObject(vrm.scene);
  const height=bounds.max.y-bounds.min.y,scale=1.14/height;
  if(!Number.isFinite(height)||height<=0)throw new Error('角色模型没有有效的可见尺寸。');
  vrm.scene.scale.setScalar(scale);vrm.scene.position.y=-bounds.min.y*scale+.025;
  vrm.scene.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.castShadow=true;o.receiveShadow=true;}});
  root.position.set(-.7,0,1.3);root.rotation.y=-.36;root.updateMatrixWorld(true);
  const baseHips=bones.hips.position.clone();
  const tailRig=addTailRig(vrm,root);
  const bedHairCollider=createBedHairCollider();scene.add(bedHairCollider);
  const bedHairGroup={name:'Bed contact',colliders:[bedHairCollider]};
  for(const joint of vrm.springBoneManager?.joints||[])if(/hair|LiuHai|FaBing/i.test(joint.bone.name))joint.colliderGroups.push(bedHairGroup);
  const footRest={};for(const s of ['left','right'])footRest[s]=root.worldToLocal(bones[s+'Foot'].getWorldPosition(new THREE.Vector3()));
  const armDown={};for(const s of ['left','right']){
    const upper=bones[s+'UpperArm'],lower=bones[s+'LowerArm'];
    armDown[s]=new THREE.Quaternion().setFromUnitVectors(lower.position.clone().normalize(),new THREE.Vector3(s==='left'?.08:-.08,-1,.025).normalize());
  }
  let phase=0,elapsed=0,speedBlend=0,wave=0,point=0,secondaryResetPending=true,wasAirborne=false;
  const gaze=new THREE.Vector3(-3,1.5,5),gazeTarget=gaze.clone();
  const eyeTarget=new THREE.Object3D();scene.add(eyeTarget);
  if(vrm.lookAt){vrm.lookAt.target=eyeTarget;vrm.lookAt.autoUpdate=true;}
  function update(dt,speed=0,gesture='idle',pose={}){
    elapsed+=dt;speedBlend=THREE.MathUtils.damp(speedBlend,Math.min(speed/.52,1),9,dt);
    phase+=dt*Math.max(.2,speed/.52)*7.3;
    wave=THREE.MathUtils.damp(wave,gesture==='wave'?1:0,8,dt);
    point=THREE.MathUtils.damp(point,gesture==='point'?1:0,8,dt);
    const walk=Math.sin(phase)*speedBlend;
    const lying=pose.lying||0,sitting=pose.sitting||0;
    bones.hips.position.copy(baseHips);bones.hips.position.y+=(Math.sin(elapsed*2)*.002+Math.abs(Math.sin(phase))*.006*speedBlend-(pose.crouch||0)*.045)/scale;
    bones.hips.position.x-=lying*.20/scale;
    for(const s of ['left','right']){
      const sign=s==='left'?1:-1,upper=bones[s+'UpperArm'],lower=bones[s+'LowerArm'];
      upper.quaternion.copy(armDown[s]);
      upper.quaternion.premultiply(q.setFromEuler(new THREE.Euler(sign*walk*.18,0,sign*Math.sin(elapsed*1.5)*.018)));
      lower.quaternion.setFromEuler(new THREE.Euler(-.12-(gesture==='jump'?(pose.tuck||0)*.65:0),0,0));
      bones[s+'Hand'].quaternion.identity();
      if(gesture==='jump'){const swing=pose.jumpPhase==='windup'?.4*(pose.crouch||0):pose.airborne?-.9+(pose.tuck||0)*.25:-.2*(pose.crouch||0);upper.quaternion.premultiply(q.setFromEuler(new THREE.Euler(swing,0,sign*.22)));}
    }
    if(point>.001){
      const local=gaze.clone();root.worldToLocal(local);local.sub(root.worldToLocal(bones.rightUpperArm.getWorldPosition(new THREE.Vector3()))).normalize();
      const pose=new THREE.Quaternion().setFromUnitVectors(bones.rightLowerArm.position.clone().normalize(),local);
      bones.rightUpperArm.quaternion.slerp(pose,point);bones.rightLowerArm.quaternion.identity();
    }
    gaze.lerp(gazeTarget,1-Math.exp(-5*dt));eyeTarget.position.copy(gaze);
    const head=bones.head.getWorldPosition(v),local=gaze.clone().sub(head).applyQuaternion(inv.copy(root.quaternion).invert());
    const yaw=THREE.MathUtils.clamp(Math.atan2(local.x,local.z),-.65,.65),pitch=THREE.MathUtils.clamp(-Math.atan2(local.y,Math.hypot(local.x,local.z)),-.75,.5);
    bones.neck?.quaternion.setFromEuler(new THREE.Euler(pitch*.55,yaw*.45,0));
    bones.head.quaternion.setFromEuler(new THREE.Euler(pitch*.45,yaw*.5,0));
    bones.spine.quaternion.setFromEuler(new THREE.Euler((pose.crouch||0)*.28+(pose.airborne?.08:0)+sitting*.08,Math.sin(elapsed*.8)*.015,-lying*.45+Math.sin(elapsed*1.1)*.012));
    root.updateMatrixWorld(true);
    // The chibi skirt is much wider than the torso. Straight-down arms put
    // both hands inside it even though the wrist bones are valid. Pose the
    // full arm chain outside the silhouette; bed poses bring hands forward.
    for(const side of ['left','right']){
      if(side==='right'&&point>.001)continue;
      const sign=side==='left'?1:-1,upper=bones[side+'UpperArm'],lower=bones[side+'LowerArm'],hand=bones[side+'Hand'];
      const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=hand.getWorldPosition(new THREE.Vector3()),length=a.distanceTo(b)+b.distanceTo(c),shoulder=root.worldToLocal(a.clone());
      const direction=new THREE.Vector3(sign*THREE.MathUtils.lerp(.68,.22,lying),THREE.MathUtils.lerp(-.68,-.20,lying),THREE.MathUtils.lerp(.27,.95,lying));
      if(sitting>.01)direction.lerp(new THREE.Vector3(sign*.55,-.45,.70),sitting);
      direction.z+=sign*walk*.22*(1-lying)*(1-sitting);
      if(gesture==='jump')direction.z-=pose.jumpPhase==='windup'?.25*(pose.crouch||0):pose.airborne?-.4:0;
      direction.normalize().multiplyScalar(length*.95);
      const target=root.localToWorld(shoulder.clone().add(direction)),pole=root.localToWorld(shoulder.clone().add(new THREE.Vector3(sign*.65,-.2,.4)));
      solveLeg(upper,lower,hand,target,pole);
    }
    if(wave>.001){
      const upper=bones.rightUpperArm,lower=bones.rightLowerArm,hand=bones.rightHand;
      const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=hand.getWorldPosition(new THREE.Vector3());
      const length=a.distanceTo(b)+b.distanceTo(c),shoulder=root.worldToLocal(a.clone());
      // The chibi head and hair cover the shoulders. Bring the hand forward,
      // bend the elbow outwards and wave the palm in front of the hair.
      const offset=new THREE.Vector3(-.6,.45,.65).normalize().multiplyScalar(length*.94);
      offset.x+=Math.sin(elapsed*7)*.012;
      const target=root.localToWorld(shoulder.clone().add(offset)).lerp(c,1-wave);
      const pole=root.localToWorld(shoulder.clone().add(new THREE.Vector3(-.6,.03,.18)));
      solveLeg(upper,lower,hand,target,pole);
      const handWorld=root.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,.18+Math.sin(elapsed*9)*.3)));
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handWorld));
    }
    for(const s of ['left','right']){
      if(lying>.01||sitting>.01){
        const bend=s==='left'?.2:0;
        bones[s+'UpperLeg'].quaternion.setFromEuler(new THREE.Euler(-sitting*1.05-lying*(.6+bend),0,0));
        bones[s+'LowerLeg'].quaternion.setFromEuler(new THREE.Euler(sitting*1.2+lying*.95,0,0));
        bones[s+'Foot'].quaternion.setFromEuler(new THREE.Euler(-.2*sitting,0,0));continue;
      }
      const opposite=s==='left'?0:Math.PI,p=phase+opposite;
      const foot=footRest[s].clone();
      foot.z+=Math.cos(p)*.13*speedBlend;foot.y+=Math.max(0,Math.sin(p))*.065*speedBlend;
      if(pose.airborne){foot.y+=(pose.tuck||0)*.09;foot.z-=(pose.tuck||0)*.055;}
      const target=root.localToWorld(foot),pole=root.localToWorld(new THREE.Vector3(footRest[s].x,.25,.65));
      if(pose.supportHeightAt&&!pose.airborne)target.y=pose.supportHeightAt(target.x,target.z)+footRest[s].y-.0175;
      solveLeg(bones[s+'UpperLeg'],bones[s+'LowerLeg'],bones[s+'Foot'],target,pole);
      const desiredWorld=root.quaternion.clone();
      bones[s+'Foot'].quaternion.copy(bones[s+'Foot'].parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredWorld));
    }
    if(pose.handTarget){
      const upperBefore=bones.rightUpperArm.quaternion.clone(),lowerBefore=bones.rightLowerArm.quaternion.clone();
      root.updateMatrixWorld(true);const target=new THREE.Vector3(...pose.handTarget),pole=root.localToWorld(new THREE.Vector3(-.35,.4,.5));
      solveLeg(bones.rightUpperArm,bones.rightLowerArm,bones.rightHand,target,pole);
      if(pose.handWeight!==undefined){bones.rightUpperArm.quaternion.slerpQuaternions(upperBefore,bones.rightUpperArm.quaternion.clone(),pose.handWeight);bones.rightLowerArm.quaternion.slerpQuaternions(lowerBefore,bones.rightLowerArm.quaternion.clone(),pose.handWeight);}
      if(pose.handQuaternion){const world=new THREE.Quaternion(...pose.handQuaternion);bones.rightHand.quaternion.copy(bones.rightHand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));}
    }
    const blinkPhase=elapsed%4.6,blink=blinkPhase<.14?Math.sin(blinkPhase/.14*Math.PI):0;
    vrm.expressionManager?.setValue('blink',blink);
    vrm.expressionManager?.setValue('happy',.12+wave*.35);
    vrm.expressionManager?.setValue('aa',gesture==='speak'?.12*(.5+.5*Math.sin(elapsed*16)):0);
    const supportedPose=lying>.01||sitting>.01;
    bedHairCollider.position.y=supportedPose?.85:-100;bedHairCollider.updateWorldMatrix(true,false);
    tailRig.update(lying,sitting,(pose.crouch||0)*.3+(pose.tuck||0)*.35);
    const airborne=Boolean(pose.airborne);
    if(secondaryResetPending||airborne!==wasAirborne){
      // Retarget the new normalized pose first. Resetting springs against the
      // previous raw head/body matrices carries stale tail positions forward.
      vrm.update(0);root.updateMatrixWorld(true);vrm.springBoneManager?.reset();secondaryResetPending=false;
    }
    wasAirborne=airborne;vrm.update(Math.min(dt,.04));
  }
  function reset(){
    phase=elapsed=speedBlend=wave=point=0;wasAirborne=false;secondaryResetPending=true;
    vrm.humanoid.resetNormalizedPose();gaze.copy(gazeTarget);update(0);
  }
  const getHead=()=>bones.head.getWorldPosition(new THREE.Vector3());
  function measureEnvelope(){
    root.updateMatrixWorld(true);let radius=0,minY=Infinity,maxY=-Infinity;
    const vertex=new THREE.Vector3();
    vrm.scene.traverse(o=>{if(!o.isMesh||!o.visible)return;o.skeleton?.update();
      for(let i=0;i<o.geometry.attributes.position.count;i++){
        o.getVertexPosition(i,vertex);vertex.applyMatrix4(o.matrixWorld);root.worldToLocal(vertex);
        radius=Math.max(radius,Math.hypot(vertex.x,vertex.z));minY=Math.min(minY,vertex.y);maxY=Math.max(maxY,vertex.y);
      }
    });return {radius,minY,maxY};
  }
  update(0);
  const envelope=measureEnvelope(),collisionRadius=Math.ceil((envelope.radius+.07)*100)/100;
  return {root,vrm,bones,tailRig,scale,footRest,envelope,collisionRadius,measureEnvelope,update,reset,resetSecondaryMotion:()=>{secondaryResetPending=true;},getHead,setGaze:p=>gazeTarget.copy(p),get gaze(){return gaze.clone();},metadata:vrm.meta};
}
