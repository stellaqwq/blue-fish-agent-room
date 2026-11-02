import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4188'},stdio:'ignore',windowsHide:true});
let browser;
try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4188/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:4188');await page.waitForFunction(()=>Boolean(window.roomDemo));
  const result=await page.evaluate(()=>{
    const {avatar,world}=window.roomDemo;window.roomDemo.agent.paused=true;
    avatar.root.position.set(0,0,0);avatar.root.rotation.y=0;avatar.update(0,0);avatar.root.updateMatrixWorld(true);
    const p=avatar.root.position.clone(),result={radius:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],meshes:[]};
    avatar.vrm.scene.traverse(o=>{if(!o.isMesh)return;o.skeleton?.update();let maxR=0;
      const v=p.clone();for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);maxR=Math.max(maxR,Math.hypot(v.x,v.z));for(let k=0;k<3;k++){const n=v.getComponent(k);result.min[k]=Math.min(result.min[k],n);result.max[k]=Math.max(result.max[k],n);}}
      result.radius=Math.max(result.radius,maxR);result.meshes.push({name:o.name,radius:maxR});
    });return {...result,obstacles:world.obstacles};
  });
  await mkdir('.impeccable/review',{recursive:true});await writeFile('.impeccable/review/collision-diagnosis.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();app.kill();}
