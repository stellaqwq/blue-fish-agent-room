import './qa-http.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';import {spawn} from 'node:child_process';import {mkdir,writeFile} from 'node:fs/promises';
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4195'},stdio:'ignore',windowsHide:true}),tag=process.argv.includes('--before')?'before':'after',out='.impeccable/review/hands';let browser;const report={states:[],checks:[],errors:[]};await mkdir(out,{recursive:true});
try{
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4195/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:4195');await page.waitForFunction(()=>window.roomDemo,null,{timeout:45000});
  for(const mode of ['stand','lie','phone','sit']){
    if(mode!=='stand'){await page.evaluate(mode=>window.roomDemo.director.request(mode),mode);await page.waitForFunction(mode=>{const d=window.roomDemo;return !d.agent.current&&!d.agent.queue.length&&!d.director.transition&&(mode!=='phone'||!d.director.phoneMotion);},mode,{timeout:30000});}
    await page.waitForTimeout(250);
    const state=await page.evaluate(()=>{const {avatar,world}=window.roomDemo,V=avatar.root.position.constructor,v=new V();return {hands:Object.fromEntries(['leftHand','rightHand','leftUpperArm','rightUpperArm'].map(n=>[n,avatar.root.worldToLocal(avatar.bones[n].getWorldPosition(v.clone())).toArray()])),materials:[...new Set((()=>{const a=[];avatar.vrm.scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])a.push(m.name);});return a;})())],phone:world.phone.owner,...window.roomDemo.snapshot()};});report.states.push({...state,pose:mode});
    if(tag==='after'){
      assert.equal(state.phoneError,'');
      if(mode==='stand')for(const side of ['leftHand','rightHand'])assert.ok(Math.abs(state.hands[side][0])>.20,'Resting wrist must clear the skirt sides');
      if(mode==='lie')for(const side of ['leftHand','rightHand'])assert.ok(state.hands[side][2]>.12,'Lying hands must rest in front of clothing');
      if(mode==='sit')for(const side of ['leftHand','rightHand'])assert.ok(state.hands[side][2]>.09,'Sitting hands must clear the torso');
      if(mode==='phone'){assert.equal(state.phone,'hand');assert.ok(state.observation.phone.gripDistance<.16);assert.ok(state.hands.leftHand[2]>.12);}
      report.checks.push(mode+' hand placement and phone contract');
    }
    for(const view of ['front','side']){await page.evaluate(({mode,view})=>{const {avatar,camera,controls}=window.roomDemo,V=avatar.root.position.constructor;const center=avatar.root.localToWorld(new V(0,.36,0));controls.target.copy(center);if(mode==='sit')camera.position.set(...(view==='front'?[1.7,1.9,.8]:[1.4,1.8,1.4]));else camera.position.copy(avatar.root.localToWorld(view==='front'?new V(0,.63,1.65):new V(1.5,.65,.5)));controls.update();},{mode,view});await page.waitForTimeout(150);await page.screenshot({path:out+'/'+tag+'-'+mode+'-'+view+'.png'});}
  }
}catch(e){report.errors.push(e.stack);process.exitCode=1;}finally{await browser?.close();app.kill();await writeFile(out+'/'+tag+'.json',JSON.stringify(report,null,2));}console.log(JSON.stringify({errors:report.errors,states:report.states.map(s=>({mode:s.mode,hands:s.hands,materials:s.materials}))}));
