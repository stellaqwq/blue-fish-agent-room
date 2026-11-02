import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {Navigation} from './nav.js';
import {prepareRoom,semanticName,TARGETS} from './room-layout.js';
import {createPhysicsRoom,CHARACTER} from './physics.js';
export {TARGETS} from './room-layout.js';

export async function loadWorld(scene,onProgress){
  const gltf=await new GLTFLoader().loadAsync('/assets/room.glb',onProgress);
  const room=gltf.scene;scene.add(room);
  const physics=prepareRoom(gltf),{obstacles,bed}=physics;
  const dynamics=await createPhysicsRoom(physics);
  let nav=new Navigation(obstacles);
  const phoneParts=physics.groups.bed.filter(o=>semanticName(o).startsWith('Phone ·'));
  const phoneGroup=new THREE.Group();phoneGroup.name='Bed phone';scene.add(phoneGroup);
  const phoneBox=new THREE.Box3();for(const part of phoneParts)phoneBox.expandByObject(part,true);
  phoneGroup.position.copy(phoneBox.getCenter(new THREE.Vector3()));phoneGroup.updateMatrixWorld(true);
  for(const part of phoneParts)phoneGroup.attach(part);
  const phoneHome=new THREE.Vector3(-1.33,bed.heightAt(-1.33,-.62)+.014,-.62);phoneGroup.position.copy(phoneHome);
  const phone={group:phoneGroup,home:phoneHome,homeQuaternion:phoneGroup.quaternion.clone(),size:phoneBox.getSize(new THREE.Vector3()),owner:'bed',rest(){this.owner='bed';this.group.position.copy(this.home);this.group.quaternion.copy(this.homeQuaternion);}};

  scene.background=new THREE.Color('#080f1c');
  scene.add(new THREE.HemisphereLight(0xa8d8ff,0x273649,.85));
  const moon=new THREE.DirectionalLight(0x419cff,1.8);
  moon.position.set(-2.5,4,-2.2);moon.target.position.set(-.5,0,.5);
  moon.castShadow=true;moon.shadow.mapSize.set(2048,2048);
  Object.assign(moon.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.1,far:14});
  moon.shadow.normalBias=.018;moon.shadow.bias=-.00015;moon.shadow.radius=3;
  scene.add(moon,moon.target);
  const fill=new THREE.DirectionalLight(0x9ac9ff,.85);fill.position.set(-3,3,5);scene.add(fill);
  const windowLight=new THREE.PointLight(0x219dff,10,5,2);windowLight.position.set(-.8,1.9,-1.4);scene.add(windowLight);
  const screen=new THREE.PointLight(0x418bff,.65,1.7,2);screen.position.set(1.65,1.12,-.35);scene.add(screen);
  const lamp=new THREE.PointLight(0xffd4a1,0,2.2,2);lamp.position.set(1.53,1.22,-1.18);scene.add(lamp);
  let lampOn=false;
  const lampMaterials=[];
  room.traverse(o=>{if(o.isMesh&&semanticName(o).startsWith('Lamp · inner')){o.material=o.material.clone();lampMaterials.push(o.material);}});
  const setLamp=value=>{lampOn=Boolean(value);lamp.intensity=lampOn?3.4:0;for(const m of lampMaterials){m.emissive.set(lampOn?0xffc482:0x000000);m.emissiveIntensity=lampOn?1.4:0;}};

  // Batch static meshes by actual material and attribute layout. Geometry remains
  // unchanged; semantic navigation bounds stay separate from this render batching.
  room.updateMatrixWorld(true);
  const batches=new Map();
  room.traverse(o=>{
    if(!o.isMesh||Array.isArray(o.material))return;
    const key=o.material.uuid+'|'+o.castShadow+'|'+Object.keys(o.geometry.attributes).sort().join(',');
    if(!batches.has(key))batches.set(key,[]);batches.get(key).push(o);
  });
  for(const list of batches.values()){
    if(list.length<2)continue;
    const clones=list.map(o=>o.geometry.clone().applyMatrix4(o.matrixWorld));
    const geometry=mergeGeometries(clones,false);
    for(const g of clones)g.dispose();
    if(!geometry)continue;
    const mesh=new THREE.Mesh(geometry,list[0].material);mesh.name='Batched room';mesh.castShadow=list[0].castShadow;mesh.receiveShadow=true;
    for(const o of list)o.removeFromParent();room.add(mesh);
  }

  // The authoring room is a cutaway. Inward-facing planes close its two open
  // sides for the avatar's camera while keeping the overview unobstructed.
  const interior=new THREE.Group();interior.name='Interior cutaway walls';scene.add(interior);
  const innerWall=new THREE.MeshStandardMaterial({color:0x223c5a,roughness:.95,side:THREE.FrontSide});
  function plane(name,w,h,x,y,z,angle,material){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),material);m.name=name;m.position.set(x,y,z);m.rotation.y=angle;m.receiveShadow=true;interior.add(m);return m;}
  plane('Front interior wall',4.94,2.8,-.23,1.4,2.29,Math.PI,innerWall);
  plane('Left interior wall',3.96,2.8,-2.69,1.4,.31,Math.PI/2,innerWall);
  const doorMaterial=new THREE.MeshStandardMaterial({color:0x14283e,roughness:.75});
  const frameMaterial=new THREE.MeshStandardMaterial({color:0x34546e,roughness:.7});
  plane('Door frame',1.02,2.25,-1.48,1.125,2.275,Math.PI,frameMaterial);
  plane('Door',.9,2.12,-1.48,1.06,2.263,Math.PI,doorMaterial);
  plane('Door inset',.7,1.5,-1.48,1.16,2.25,Math.PI,innerWall);
  const knob=new THREE.Mesh(new THREE.CircleGeometry(.025,20),new THREE.MeshStandardMaterial({color:0x96b4c5,metalness:.6,roughness:.3}));knob.position.set(-1.13,.9,2.24);knob.rotation.y=Math.PI;interior.add(knob);
  const debug=new THREE.Group();debug.visible=false;scene.add(debug);
  const capsule=new THREE.Mesh(new THREE.CapsuleGeometry(CHARACTER.radius,CHARACTER.height-2*CHARACTER.radius,6,12),new THREE.MeshBasicMaterial({color:0x8ff0b2,wireframe:true,transparent:true,opacity:.65,depthTest:false}));capsule.visible=false;debug.add(capsule);
  for(const o of obstacles){const mesh=new THREE.Mesh(new THREE.BoxGeometry(o.maxX-o.minX,o.maxY-o.minY,o.maxZ-o.minZ),new THREE.MeshBasicMaterial({color:0x70d7e4,wireframe:true,depthTest:false}));mesh.position.set((o.minX+o.maxX)/2,(o.minY+o.maxY)/2,(o.minZ+o.maxZ)/2);debug.add(mesh);}
  let footprint;
  function configureAvatar(radius,height=1.24){
    nav=new Navigation(obstacles,radius);
    footprint?.removeFromParent();footprint=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,48,1,true),new THREE.MeshBasicMaterial({color:0xffd58e,wireframe:true,transparent:true,opacity:.5,depthTest:false}));footprint.userData.height=height;debug.add(footprint);
  }
  const updateDebug=p=>{if(footprint)footprint.position.set(p.x,p.y+footprint.userData.height/2,p.z);capsule.visible=Boolean(dynamics.activeMotor);capsule.position.set(p.x,p.y+CHARACTER.height/2+dynamics.footOffset,p.z);};
  const pathLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x8fdee6,transparent:true,opacity:.8,depthTest:false}));
  pathLine.renderOrder=20;scene.add(pathLine);
  const marker=new THREE.Mesh(new THREE.RingGeometry(.11,.14,40),new THREE.MeshBasicMaterial({color:0x8fdee6,transparent:true,opacity:.75,side:THREE.DoubleSide,depthTest:false}));
  marker.rotation.x=-Math.PI/2;marker.visible=false;marker.renderOrder=20;scene.add(marker);
  function setPath(points){pathLine.geometry.dispose();pathLine.geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,.045,p.z)));pathLine.visible=points.length>1;if(points.length>1){const p=points.at(-1);marker.position.set(p.x,.05,p.z);marker.visible=true;}else marker.visible=false;}
  return {room,phone,physics:dynamics,get nav(){return nav;},bed,targets:TARGETS,obstacles,debug,configureAvatar,updateDebug,setPath,setLamp,get lampOn(){return lampOn;}};
}
