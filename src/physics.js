import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {ROOM_BOUNDS,semanticName} from './room-layout.js';

let initialization;
export const PHYSICS_STEP=1/120;
export const CHARACTER={radius:.32,height:1.14,skin:.008};

export async function createPhysicsRoom(layout,{bounds=ROOM_BOUNDS}={}){
  await(initialization??=RAPIER.init());
  const world=new RAPIER.World({x:0,y:-12,z:0}),labels=new Map();world.timestep=PHYSICS_STEP;
  const floorHeight=layout.floorHeight??0;
  const register=(desc,label)=>{const collider=world.createCollider(desc);labels.set(collider.handle,label);return collider;};
  function addBox(box,label=box.id||'obstacle'){
    return register(RAPIER.ColliderDesc.cuboid((box.maxX-box.minX)/2,(box.maxY-box.minY)/2,(box.maxZ-box.minZ)/2).setTranslation((box.minX+box.maxX)/2,(box.minY+box.maxY)/2,(box.minZ+box.maxZ)/2),label);
  }
  addBox({minX:-20,maxX:20,minY:floorHeight-.2,maxY:floorHeight,minZ:-20,maxZ:20},'floor');
  if(bounds){
    for(const x of [bounds.minX-.05,bounds.maxX+.05])addBox({minX:x-.05,maxX:x+.05,minY:0,maxY:2.8,minZ:bounds.minZ-.1,maxZ:bounds.maxZ+.1},'wall');
    for(const z of [bounds.minZ-.05,bounds.maxZ+.05])addBox({minX:bounds.minX-.1,maxX:bounds.maxX+.1,minY:0,maxY:2.8,minZ:z-.05,maxZ:z+.05},'wall');
    addBox({minX:bounds.minX,maxX:bounds.maxX,minY:2.8,maxY:3,minZ:bounds.minZ,maxZ:bounds.maxZ},'ceiling');
  }
  for(const box of layout.obstacles||[])if(box.id!=='bed')addBox(box);
  let bedTriangles=0;
  // Cook a collision LOD from the renderer's actual surface. The cloth has
  // 400k+ triangles: a game capsule should query a coarse surface, not spend
  // its frame budget colliding with every tiny fabric wrinkle.
  if(layout.bed?.surfaces?.length){
    const vertices=[],indices=[],v=new THREE.Vector3();
    for(const mesh of layout.bed.surfaces){
      const position=mesh.geometry.attributes.position,index=mesh.geometry.index,offset=vertices.length/3;
      for(let i=0;i<position.count;i++){v.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);vertices.push(v.x,v.y,v.z);}
      for(let i=0;i<(index?.count||position.count);i++)indices.push(offset+(index?index.getX(i):i));
    }
    const source=register(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices),new Uint32Array(indices)),'bed-source');
    const bounds=new THREE.Box3();for(let i=0;i<vertices.length;i+=3)bounds.expandByPoint(v.set(vertices[i],vertices[i+1],vertices[i+2]));
    const nx=Math.ceil((bounds.max.x-bounds.min.x)/.04),nz=Math.ceil((bounds.max.z-bounds.min.z)/.04),width=nx+1,points=[],valid=[],triangles=[];
    const ray=new RAPIER.Ray({x:0,y:3,z:0},{x:0,y:-1,z:0});
    for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
      ray.origin.x=bounds.min.x+(bounds.max.x-bounds.min.x)*x/nx;ray.origin.z=bounds.min.z+(bounds.max.z-bounds.min.z)*z/nz;
      const hit=source.castRayAndGetNormal(ray,5,true);valid.push(Boolean(hit));points.push(ray.origin.x,hit?3-hit.timeOfImpact:0,ray.origin.z);
    }
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const a=z*width+x,b=a+1,c=a+width,d=c+1;
      if(valid[a]&&valid[c]&&valid[b])triangles.push(a,c,b);if(valid[b]&&valid[c]&&valid[d])triangles.push(b,c,d);
    }
    // Keep the low-poly mattress shell so its sides remain solid too.
    const mattress=layout.bed.surfaces.find(m=>semanticName(m)==='Mattress');
    if(mattress){const position=mattress.geometry.attributes.position,index=mattress.geometry.index,offset=points.length/3;
      for(let i=0;i<position.count;i++){v.fromBufferAttribute(position,i).applyMatrix4(mattress.matrixWorld);points.push(v.x,v.y,v.z);}
      for(let i=0;i<(index?.count||position.count);i++)triangles.push(offset+(index?index.getX(i):i));
    }
    labels.delete(source.handle);world.removeCollider(source,true);
    register(RAPIER.ColliderDesc.trimesh(new Float32Array(points),new Uint32Array(triangles)),'bed');bedTriangles=triangles.length/3;
  }else for(const box of layout.obstacles||[])if(box.id==='bed')addBox(box);
  world.step();
  return {world,labels,floorHeight,footOffset:floorHeight+CHARACTER.skin,stats:{engine:'Rapier 0.21',step:PHYSICS_STEP,bedGrid:.04,bedTriangles},addBox,rapier:RAPIER,free(){world.free();}};
}
