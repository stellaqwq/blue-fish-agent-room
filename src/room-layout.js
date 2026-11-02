import * as THREE from 'three';

export const ROOM_BOUNDS={minX:-2.69,maxX:2.17,minZ:-1.70,maxZ:2.29};
export const CHAIR_SHIFT=new THREE.Vector3(.85,0,.67);
export const TARGETS={
  window:{name:'窗外观察点',position:[-1.4,0,1.24],look:[-.65,1.95,-1.65]},
  desk:{name:'书桌前',position:[.08,0,1.36],look:[1.62,1.06,-.44]},
  bed:{name:'床边',position:[-1.15,0,1.28],look:[-1,.88,-.65]},
  center:{name:'房间中央',position:[-.65,0,1.3],look:[-.65,1,2.6]},
  user:{name:'你',position:[-1.4,0,1.36],look:[-3.8,2,6]},
  lamp:{name:'台灯前',position:[.08,0,1.36],look:[1.55,1.25,-1.15]},
};
export const BED_LANDING={x:-1.15,z:-.60};

export function semanticName(o){return (o.userData.semanticName||o.name).replace(/_/g,' ');}
export function roomGroup(o){
  const name=semanticName(o);
  if(/^(Chair ·|Cardigan ·)/.test(name))return 'chair';
  if(name.startsWith('Desk ·'))return 'desk';
  if(name.startsWith('Wastebasket ·'))return 'basket';
  if(/^(Bed ·|Mattress|Fitted sheet|Duvet ·|Pillow|Cotton|Phone ·)/.test(name)||/pillow/i.test(name))return 'bed';
  return null;
}

// Read semantic identity from the original glTF node. GLTFLoader sanitizes its
// Object3D.name, so source strings containing spaces must never select physics.
export function prepareRoom(gltf){
  const room=gltf.scene,groups={bed:[],desk:[],chair:[],basket:[]};let floorHeight=0;
  room.traverse(o=>{
    const node=gltf.parser?.associations.get(o)?.nodes;
    if(node!==undefined)o.userData.semanticName=gltf.parser.json.nodes[node]?.name||o.name;
    if(!o.isMesh)return;
    const id=roomGroup(o);if(id)groups[id].push(o);
    if(id==='chair')o.position.add(CHAIR_SHIFT);
    if(id==='basket')o.position.z+=.88;
    o.receiveShadow=true;o.castShadow=!semanticName(o).startsWith('Floor');
  });
  room.updateMatrixWorld(true);
  room.traverse(o=>{if(o.isMesh&&semanticName(o).startsWith('Floor plank'))floorHeight=Math.max(floorHeight,new THREE.Box3().setFromObject(o,true).max.y);});
  // Prepare a gently flattened area of the soft bedding for this interaction.
  // This is authored geometry, not a claimed cloth simulation. The same edited
  // triangles drive rendering, raycast support and the furniture bounds.
  for(const mesh of groups.bed){
    const name=semanticName(mesh);
    if(!/Duvet|Fitted sheet|pillow/i.test(name))continue;
    let cap=.80;
    if(/Second pillow/i.test(name))cap=/perimeter/i.test(name)?.787:.785;
    else if(/pillow/i.test(name))cap=/perimeter/i.test(name)?.797:.795;
    else if(/Duvet/.test(name)&&!/hand-shaped/.test(name))cap=.805;
    else if(/Fitted sheet/.test(name))cap=.788;
    mesh.geometry=mesh.geometry.clone();
    const a=mesh.geometry.attributes.position,v=new THREE.Vector3(),inverse=mesh.matrixWorld.clone().invert();
    for(let i=0;i<a.count;i++){
      v.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);
      const d=Math.hypot(v.x-BED_LANDING.x,v.z-BED_LANDING.z),u=THREE.MathUtils.clamp((1.06-d)/.16,0,1),weight=u*u*(3-2*u);
      if(v.y>cap&&weight>0){v.y-=(v.y-cap)*weight;v.applyMatrix4(inverse);a.setXYZ(i,v.x,v.y,v.z);}
    }
    a.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
  }
  const phone=groups.bed.filter(o=>semanticName(o).startsWith('Phone ·'));
  if(phone.length){const box=new THREE.Box3();for(const m of phone)box.expandByObject(m,true);const center=box.getCenter(new THREE.Vector3());if(Math.hypot(center.x-BED_LANDING.x,center.z-BED_LANDING.z)<.9&&box.min.y>.807){for(const m of phone)m.position.y-=box.min.y-.807;}}
  room.updateMatrixWorld(true);
  const obstacles=Object.entries(groups).map(([id,meshes])=>{
    if(!meshes.length)throw new Error('场景缺少 '+id+' 的可见几何，不能建立碰撞。');
    const box=new THREE.Box3();for(const mesh of meshes)box.expandByObject(mesh,true);
    return {id,minX:box.min.x,maxX:box.max.x,minY:box.min.y,maxY:box.max.y,minZ:box.min.z,maxZ:box.max.z};
  });
  // Query geometry is a world-space snapshot of the exact prepared render
  // triangles. It has identity transforms and an independent material, so
  // batching/removal/matrix updates cannot change support queries implicitly.
  const surfaces=groups.bed.filter(o=>/^(Duvet · hand|Fitted sheet|Mattress|Main pillow$|Second pillow behind$)/.test(semanticName(o))).map(source=>{
    const surface=new THREE.Mesh(source.geometry.clone().applyMatrix4(source.matrixWorld),source.material.clone());
    surface.name=semanticName(source);surface.matrixAutoUpdate=false;surface.updateMatrixWorld(true);return surface;
  });
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0)),cache=new Map();
  const heightAt=(x,z)=>{
    const key=Math.round(x*100)+','+Math.round(z*100);if(cache.has(key))return cache.get(key);
    ray.ray.origin.set(x,3,z);const hit=ray.intersectObjects(surfaces,false)[0];
    if(!hit)throw new Error('这个位置没有床面支撑。');
    cache.set(key,hit.point.y);return hit.point.y;
  };
  const mattress=groups.bed.find(o=>semanticName(o)==='Mattress');
  const mattressBounds=new THREE.Box3().setFromObject(mattress,true);
  // The user-selected corner is the foot of the bed nearest the laptop,
  // with hips supported just inside the mattress and feet over its +X edge.
  const computerSeat={x:mattressBounds.max.x-.08,z:mattressBounds.max.z-.14};
  return {obstacles,groups,floorHeight,bed:{position:BED_LANDING,heightAt,surfaces,computerSeat}};
}
