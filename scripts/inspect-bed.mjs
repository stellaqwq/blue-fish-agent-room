import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4188'},stdio:'ignore',windowsHide:true});let browser;
try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4188/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:4188');await page.waitForFunction(()=>Boolean(window.roomDemo));await page.locator('#jump-button').click();await page.waitForFunction(()=>window.roomDemo.agent.support==='bed'&&!window.roomDemo.agent.current);
  const audit=async label=>{
    const result=await page.evaluate(()=>{
      const {avatar,world,agent}=window.roomDemo;agent.paused=true;avatar.root.updateMatrixWorld(true);
      const bins=new Map(),v=avatar.root.position.clone();
      avatar.vrm.scene.traverse(o=>{if(!o.isMesh)return;o.skeleton?.update();for(let i=0;i<o.geometry.attributes.position.count;i++){
        o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);if(v.y>avatar.root.position.y+.38)continue;
        const key=Math.round(v.x*20)+','+Math.round(v.z*20),old=bins.get(key);if(!old||old.y>v.y)bins.set(key,{x:v.x,y:v.y,z:v.z,mesh:o.name});
      }});
      const points=[];for(const p of bins.values()){try{const surface=world.bed.heightAt(p.x,p.z);points.push({...p,surface,penetration:surface-p.y});}catch{}}
      points.sort((a,b)=>b.penetration-a.penetration);return {root:avatar.root.position.toArray(),yaw:avatar.root.rotation.y,points:points.slice(0,15),samples:points.length};
    });console.log(label,JSON.stringify(result));return result;
  };
  const a=await audit('window-heading');await page.locator('[data-action="user"]').click();await page.waitForFunction(()=>!window.roomDemo.agent.current);await page.waitForTimeout(500);const b=await audit('user-heading');
  await writeFile('.impeccable/review/bed-contact-audit.json',JSON.stringify({a,b},null,2));await page.screenshot({path:'.impeccable/review/bed-front.png',fullPage:true});
}finally{await browser?.close();app.kill();}
