import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Navigation} from '../src/nav.js';
import {TARGETS} from '../src/world.js';
import {validatePlan,parsePlan,completionUrl} from '../src/protocol.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {prepareRoom,CHAIR_SHIFT} from '../src/room-layout.js';
import {JumpMotor} from '../src/jump.js';
import {createPhysicsRoom} from '../src/physics.js';
import {RoomAgent} from '../src/agent.js';
import {createBedHairCollider,resolveAvatarBones,requiredBones} from '../src/avatar.js';

const bytes=await readFile(new URL('../public/assets/room.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const chairBefore=new THREE.Box3();gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse(o=>{if(o.isMesh&&/^(Chair|Cardigan)_/.test(o.name))chairBefore.expandByObject(o,true);});
const physics=prepareRoom(gltf),{obstacles}=physics;
const nav=new Navigation(obstacles);
const dynamics=await createPhysicsRoom(physics);after(()=>dynamics.free());
test('sanitized glTF names still move the visible chair and cardigan with their collider',()=>{
  const chair=obstacles.find(o=>o.id==='chair');
  assert.ok(physics.groups.chair.length>10);
  assert.ok(Math.abs(chair.minX-chairBefore.min.x-CHAIR_SHIFT.x)<.002);
  assert.ok(Math.abs(chair.maxZ-chairBefore.max.z-CHAIR_SHIFT.z)<.002);
  for(const mesh of physics.groups.chair){const box=new THREE.Box3().setFromObject(mesh,true);assert.ok(box.min.x>=chair.minX-.001&&box.max.z<=chair.maxZ+.001);}
  assert.equal(nav.free({x:(chair.minX+chair.maxX)/2,z:(chair.minZ+chair.maxZ)/2}),false);
  // The old root-point route through the narrow bed/desk gap is no longer legal.
  assert.equal(nav.free({x:.88,z:-.57}),false);
});
test('all activity locations connect without crossing furniture, both directions',()=>{
  const locations=[{x:-.7,z:1.3},...Object.values(TARGETS).map(t=>({x:t.position[0],z:t.position[2]}))];
  for(const a of locations)for(const b of locations){
    const path=nav.route(a,b);let previous=a;
    for(const p of path){assert.ok(nav.clear(previous,p),JSON.stringify({a,b,p}));previous=p;}
    assert.ok(Math.hypot(previous.x-b.x,previous.z-b.z)<.001);
  }
});
test('swept collision rejects a thin-obstacle crossing and inaccessible goals',()=>{
  const n=new Navigation([{minX:0,maxX:.02,minZ:-1,maxZ:1}],.1);
  assert.equal(n.clear({x:-1,z:0},{x:1,z:0}),false);
  assert.throws(()=>nav.route({x:-.7,z:1.3},{x:-1,z:-.6}));
});
test('model actions are checked before execution',()=>{
  assert.throws(()=>validatePlan({action:{type:'eval',code:'alert(1)'}}));
  assert.throws(()=>validatePlan({action:{type:'move',target:'outside'}}));
  assert.throws(()=>validatePlan({action:{type:'lamp',enabled:'false'}}));
  assert.equal(validatePlan({action:{type:'wait',duration:1000}}).action.duration,6);
  assert.equal(validatePlan({action:{type:'jump',target:'bed'}}).action.target,'bed');
  assert.throws(()=>validatePlan({action:{type:'jump',target:'window'}}));
  assert.equal(parsePlan('```json\n{"action":{"type":"finish"},"say":"你好"}\n```').say,'你好');
  assert.throws(()=>parsePlan('not json'));
});
test('fixed-step capsule jumps land on the actual bedding/floor consistently across render rates',()=>{
  const floor={x:-1.15,y:0,z:1.28},bed={x:-1.15,y:physics.bed.heightAt(-1.15,-.6)-physics.floorHeight,z:-.6};
  for(const [from,to,target]of[[floor,bed,'bed'],[bed,floor,'floor']]){
    const results=[];
    for(const dt of [1/15,1/30,1/60,1/144]){
      const motor=new JumpMotor(dynamics,from,to,target);let peak=from.y,translatedDuringRise=false;
      for(let i=0;i<2000&&!motor.done;i++){motor.advance(dt);peak=Math.max(peak,motor.position.y);if(motor.phase==='rising'&&Math.hypot(motor.position.x-from.x,motor.position.z-from.z)>.2)translatedDuringRise=true;}
      assert.equal(motor.success,true);assert.equal(motor.grounded,true);assert.equal(motor.support,target);assert.ok(translatedDuringRise);
      assert.ok(Math.abs(motor.position.y-to.y)<.015);assert.ok(Math.hypot(motor.position.x-to.x,motor.position.z-to.z)<.15);
      assert.ok(peak<1.15);results.push({...motor.position,steps:motor.steps});motor.dispose();
    }
    for(const result of results){assert.equal(result.steps,results[0].steps);assert.ok(Math.hypot(result.x-results[0].x,result.y-results[0].y,result.z-results[0].z)<1e-5);}
  }
});
function fixture(){
  const root=new THREE.Group();root.position.set(-1.15,0,1.28);
  const avatar={root,footRest:{left:new THREE.Vector3(.1,.09,0),right:new THREE.Vector3(-.1,.09,0)},vrm:{},update(){},setGaze(){}};
  const world={...physics,physics:dynamics,nav,targets:TARGETS,setPath(){},updateDebug(){},setLamp(){},lampOn:false};
  return new RoomAgent(avatar,world);
}
test('reset removes the full bed rotation and presentation before returning to the floor',()=>{
  const agent=fixture();agent.avatar.root.rotation.set(.2,1.15,Math.PI/2);agent.support='bed';agent.presentation={pose:{lying:1}};agent.paused=true;
  let restored=false;agent.avatar.reset=()=>{restored=true;};agent.reset();
  assert.equal(agent.presentation,null);assert.equal(agent.support,'floor');assert.equal(agent.paused,false);assert.equal(restored,true);
  assert.ok(agent.avatar.root.quaternion.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-.36,0)))<1e-7);
});
test('hair bed contact is horizontal across the bed and moving it down truly disables contact',()=>{
  const collider=createBedHairCollider(),normal=new THREE.Vector3();collider.position.y=.85;collider.updateWorldMatrix(true,false);
  for(const z of [-1.2,-.6,.6]){
    assert.ok(collider.shape.calculateCollision(collider.colliderMatrix,new THREE.Vector3(-1,1,z),0,normal)>0);
    assert.ok(collider.shape.calculateCollision(collider.colliderMatrix,new THREE.Vector3(-1,.8,z),0,normal)<0);
    assert.ok(normal.distanceTo(new THREE.Vector3(0,1,0))<1e-9);
  }
  collider.position.y=-100;collider.updateWorldMatrix(true,false);
  assert.ok(collider.shape.calculateCollision(collider.colliderMatrix,new THREE.Vector3(-1,0,-.6),0,normal)>0);
});
test('pause freezes an airborne jump; stop completes a safe landing and cancels queued actions',()=>{
  const agent=fixture();agent.direct([{type:'jump',target:'bed'},{type:'wave',duration:2}]);
  for(let i=0;i<38;i++)agent.update(1/60);
  assert.equal(agent.current.type,'jump');const p=agent.avatar.root.position.clone();assert.ok(p.y>.5);
  agent.paused=true;agent.update(.5);assert.ok(agent.avatar.root.position.equals(p));
  agent.stop();agent.paused=false;for(let i=0;i<160;i++)agent.update(1/60);
  assert.equal(agent.support,'bed');assert.equal(agent.current,null);assert.equal(agent.queue.length,0);assert.ok(agent.avatar.root.position.y>.5);
  agent.direct([{type:'move',target:'center'}]);for(let i=0;i<500;i++)agent.update(1/60);
  assert.equal(agent.support,'floor');assert.ok(Math.abs(agent.avatar.root.position.y)<.001);assert.ok(nav.free(agent.avatar.root.position));
});
test('compatible API base paths stay intact',()=>{
  assert.equal(completionUrl('https://api.deepseek.com/v1/'),'https://api.deepseek.com/v1/chat/completions');
  assert.equal(completionUrl('http://127.0.0.1:1234/v1/chat/completions'),'http://127.0.0.1:1234/v1/chat/completions');
  assert.throws(()=>completionUrl('file:///secret'));
});
test('required avatar bones fail early while neck and chest remain optional',()=>{
  const nodes=Object.fromEntries(requiredBones.map(n=>[n,new THREE.Object3D()]));
  const vrm={humanoid:{getNormalizedBoneNode:n=>nodes[n]}};assert.equal(resolveAvatarBones(vrm).neck,undefined);delete nodes.head;assert.throws(()=>resolveAvatarBones(vrm),/head/);
});
test('bed query snapshots survive detach and matrix recomputation independently of render hierarchy',()=>{
  const a=physics.bed.heightAt(-1.12,-.62);
  for(const surface of physics.bed.surfaces){surface.removeFromParent();surface.updateMatrixWorld(true);}
  gltf.scene.updateMatrixWorld(true);
  assert.ok(Math.abs(physics.bed.heightAt(-1.121,-.621)-a)<.01);
});
