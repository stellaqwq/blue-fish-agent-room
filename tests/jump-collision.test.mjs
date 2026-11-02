import test from 'node:test';import assert from 'node:assert/strict';
import {createPhysicsRoom} from '../src/physics.js';import {JumpMotor} from '../src/jump.js';
const bed={id:'bed',minX:-2.3,maxX:.45,minY:.1,maxY:.8,minZ:-1.42,maxZ:.02};
const from={x:-1.15,y:0,z:1.28},to={x:-1.15,y:.7825,z:-.6};
async function fixture(withBed=true){const world=await createPhysicsRoom({floorHeight:.0175,obstacles:withBed?[bed]:[]},{bounds:null});return {world,motor:new JumpMotor(world,from,to,'bed')};}
function finish(motor){for(let i=0;i<2000&&!motor.done;i++)motor.advance(1/120);assert.equal(motor.done,true);}
test('a collider inserted after takeoff blocks the live jump instead of following the target path',async()=>{
  const {world,motor}=await fixture();try{
    while(!motor.airborne)motor.advance(1/120);
    world.addBox({minX:-2,maxX:-.3,minY:0,maxY:2.7,minZ:0,maxZ:.012},'late-wall');world.world.step();
    let hit=false;for(let i=0;i<2000&&!motor.done;i++){motor.advance(1/120);hit||=motor.contacts.some(c=>c.id==='late-wall');}
    assert.ok(hit);assert.equal(motor.success,false);assert.equal(motor.grounded,true);assert.equal(motor.support,'floor');assert.ok(motor.position.z>.3);
  }finally{motor.dispose();world.free();}
});
test('a low ceiling cancels upward velocity and the character lands on actual support',async()=>{
  const {world,motor}=await fixture();try{
    world.addBox({minX:-3,maxX:1,minY:1.6,maxY:1.7,minZ:-2,maxZ:2},'low-ceiling');world.world.step();let peak=0,hit=false;
    for(let i=0;i<2000&&!motor.done;i++){motor.advance(1/120);peak=Math.max(peak,motor.position.y);hit||=motor.contacts.some(c=>c.id==='low-ceiling');}
    assert.ok(hit);assert.ok(peak<.5);assert.equal(motor.success,false);assert.equal(motor.grounded,true);assert.equal(motor.support,'floor');
  }finally{motor.dispose();world.free();}
});
test('a missing bed cannot produce a timed fake landing at the requested height',async()=>{
  const {world,motor}=await fixture(false);try{finish(motor);assert.equal(motor.success,false);assert.equal(motor.support,'floor');assert.ok(Math.abs(motor.position.y)<.002);}finally{motor.dispose();world.free();}
});
