import './qa-http.mjs';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4188'},stdio:'ignore',windowsHide:true});let browser;const report={errors:[],poses:[],checks:[]};
try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4188/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>{report.errors.push(e.message);console.log('PAGE ERROR',e.message);});await page.goto('http://127.0.0.1:4188');await page.waitForFunction(()=>Boolean(window.roomDemo),{timeout:30000});
  await mkdir('.impeccable/review',{recursive:true});await page.locator('[data-camera="bed"]').click();
  const captureMobile=async label=>{await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await page.screenshot({path:'.impeccable/review/mobile-'+label+'.png',fullPage:true});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile pose overflow');await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(250);};
  const inspect=async label=>{const data=await page.evaluate(()=>{
    const {avatar,world,director}=window.roomDemo,v=avatar.root.position.clone(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    avatar.root.updateMatrixWorld(true);avatar.vrm.scene.traverse(o=>{if(!o.isMesh)return;o.skeleton?.update();for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);for(let k=0;k<3;k++){min[k]=Math.min(min[k],v.getComponent(k));max[k]=Math.max(max[k],v.getComponent(k));}}});
    const hand=avatar.bones.rightHand.getWorldPosition(v.clone()),upper=avatar.bones.rightUpperArm.getWorldPosition(v.clone()),lower=avatar.bones.rightLowerArm.getWorldPosition(v.clone());
    return {...window.roomDemo.snapshot(),min,max,tailVertices:avatar.tailRig.vertices,phonePosition:world.phone.group.position.toArray(),hand:hand.toArray(),upper:upper.toArray(),reach:upper.distanceTo(lower)+lower.distanceTo(hand),home:world.phone.home.toArray(),gripDistance:hand.distanceTo(world.phone.home),phase:director.phoneMotion?.phase,computerSeat:world.bed.computerSeat};
  });report.poses.push({label,...data});console.log(label,JSON.stringify(data));await page.screenshot({path:'.impeccable/review/'+label+'.png',fullPage:true});await captureMobile(label);};
  await page.locator('[data-posture="lie"]').click();await page.waitForFunction(()=>window.roomDemo.director.stable==='lie'&&!window.roomDemo.director.transition,{timeout:30000});await page.waitForTimeout(400);await inspect('lying');
  await page.locator('[data-posture="phone"]').click();await page.waitForFunction(()=>window.roomDemo.director.held&&!window.roomDemo.director.phoneMotion||window.roomDemo.director.phoneError,{timeout:15000});await page.waitForTimeout(350);await inspect('phone-reading');
  await page.locator('[data-posture="sit"]').click();await page.waitForFunction(()=>window.roomDemo.director.stable==='sit'&&!window.roomDemo.director.transition,{timeout:15000});await page.waitForTimeout(400);await inspect('bed-computer');
  await page.locator('#home-camera').click();await page.evaluate(()=>window.roomDemo.camera.position.set(3.8,4.6,6.3));await page.waitForTimeout(300);await page.screenshot({path:'.impeccable/review/bed-computer-overview.png',fullPage:true});await page.locator('[data-camera="bed"]').click();
  await page.locator('[data-posture="phone"]').click();await page.waitForFunction(()=>window.roomDemo.director.held&&!window.roomDemo.director.phoneMotion,{timeout:15000});
  await page.locator('#pause').click();const frozen=await page.evaluate(()=>window.roomDemo.world.phone.group.position.toArray());await page.waitForTimeout(300);
  if(JSON.stringify(frozen)!==JSON.stringify(await page.evaluate(()=>window.roomDemo.world.phone.group.position.toArray())))throw new Error('Held phone moved while paused');
  report.checks.push('paused phone stays still');
  await page.locator('[data-action="desk"]').click();await page.waitForFunction(()=>!window.roomDemo.director.controlled&&!window.roomDemo.agent.current&&!window.roomDemo.agent.queue.length,{timeout:30000});
  const manual=await page.evaluate(()=>window.roomDemo.snapshot());
  if(manual.support!=='floor'||manual.phone!=='bed'||manual.paused||manual.observation.targets.desk.distance>.02)throw new Error('Paused bed pose did not safely yield to manual walking');
  report.checks.push('paused phone pose yields: put phone, stand, jump down, walk to desk');
}finally{await browser?.close();app.kill();await writeFile('.impeccable/review/pose-report.json',JSON.stringify(report,null,2));}
if(report.errors.length||report.poses.some(p=>p.phoneError))process.exitCode=1;
