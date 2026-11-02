import * as THREE from 'three';

// This avatar has a long tail in the body skin but no tail joint. Add a runtime
// joint under the existing hips; the source VRM file remains untouched.
export function addTailRig(vrm,root){
  const mesh=(()=>{let body;vrm.scene.traverse(o=>{if(o.isSkinnedMesh&&o.name==='body')body=o;});return body;})();
  const hips=vrm.humanoid.getRawBoneNode('hips');if(!mesh||!hips)return {update(){},vertices:0};
  root.updateMatrixWorld(true);mesh.skeleton.update();
  const hipIndex=mesh.skeleton.bones.indexOf(hips);if(hipIndex<0)return {update(){},vertices:0};
  const pivot=root.localToWorld(new THREE.Vector3(0,.17,-.15));
  const bone=new THREE.Bone();bone.name='RoomTail';bone.position.copy(hips.worldToLocal(pivot));
  bone.quaternion.copy(hips.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(root.getWorldQuaternion(new THREE.Quaternion())));
  hips.add(bone);bone.updateMatrix();bone.updateWorldMatrix(true,false);const rest=bone.quaternion.clone();
  const inverse=bone.matrix.clone().invert().multiply(mesh.skeleton.boneInverses[hipIndex]);
  const original=mesh.skeleton,tailIndex=original.bones.length;
  const geometry=mesh.geometry.clone(),indices=geometry.attributes.skinIndex.clone(),weights=geometry.attributes.skinWeight.clone();
  const p=new THREE.Vector3();let count=0;
  for(let i=0;i<geometry.attributes.position.count;i++){
    mesh.getVertexPosition(i,p);p.applyMatrix4(mesh.matrixWorld);root.worldToLocal(p);
    const u=THREE.MathUtils.smoothstep(-p.z,.13,.29)*(1-THREE.MathUtils.smoothstep(p.y,.29,.43));
    if(u<=0)continue;
    const pairs=[];for(let j=0;j<4;j++){const w=weights.getComponent(i,j)*(1-u);if(w>0)pairs.push([indices.getComponent(i,j),w]);}pairs.push([tailIndex,u]);pairs.sort((a,b)=>b[1]-a[1]);const top=pairs.slice(0,4),sum=top.reduce((n,v)=>n+v[1],0);
    for(let j=0;j<4;j++){indices.setComponent(i,j,top[j]?.[0]||0);weights.setComponent(i,j,(top[j]?.[1]||0)/sum);}count++;
  }
  geometry.setAttribute('skinIndex',indices);geometry.setAttribute('skinWeight',weights);mesh.geometry=geometry;
  mesh.skeleton=new THREE.Skeleton([...original.bones,bone],[...original.boneInverses.map(q=>q.clone()),inverse]);
  return {bone,vertices:count,update(lie=0,sit=0,jumpPitch=0){bone.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(sit*.5+jumpPitch,lie*.16,-lie*Math.PI/2)));}};
}
