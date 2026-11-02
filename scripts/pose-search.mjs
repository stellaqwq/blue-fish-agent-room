import {chromium} from 'playwright-core';import {spawn} from 'node:child_process';
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4188'},stdio:'ignore',windowsHide:true});let browser;
try{await new Promise(r=>setTimeout(r,500));browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:4188');await page.waitForFunction(()=>window.roomDemo);
console.log(JSON.stringify(await page.evaluate(()=>{
  const {avatar,agent,director}=window.roomDemo;director.reset();agent.reset();agent.paused=true;const out=[],v=avatar.root.position.clone();
  for(const angle of [.7,.9,1.1,1.3,Math.PI/2]){
    avatar.root.position.set(-.95,1,-.65);avatar.root.quaternion.set(0,0,Math.sin(angle/2),Math.cos(angle/2));avatar.setGaze(avatar.root.position.clone().set(-2,1.8,4));
    avatar.update(0,0,'idle',{lying:1});avatar.root.updateMatrixWorld(true);let min=Infinity,point,mesh;
    avatar.vrm.scene.traverse(o=>{if(!o.isMesh)return;o.skeleton?.update();for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);if(v.y<min){min=v.y;point=v.toArray();mesh=o.name;}}});
    const upper=avatar.bones.rightUpperArm.getWorldPosition(v.clone());out.push({angle,min,point,mesh,neededY:1+.802-min,upperAfter:upper.y+.802-min,upper:upper.toArray()});
  }return out;
}),null,2));}finally{await browser?.close();app.kill();}
