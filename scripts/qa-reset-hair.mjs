import './qa-http.mjs';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const folder='.impeccable/review/reset-hair',before=process.argv.includes('--before'),tag=before?'before':'after';
await mkdir(folder,{recursive:true});
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4189'},stdio:'ignore',windowsHide:true});
let browser;const report={tag,checks:[],errors:[],states:[]};
try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4189/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:4189');await page.waitForFunction(()=>window.roomDemo,{timeout:30000});await page.waitForTimeout(500);
  async function inspect(label,capture=true){
    const state=await page.evaluate(()=>{
      const {avatar,director,agent,world}=window.roomDemo,root=avatar.root;
      const joints=[...avatar.vrm.springBoneManager.joints].filter(j=>/hair|LiuHai|FaBing/i.test(j.bone.name));
      const angles=joints.map(j=>({name:j.bone.name,angle:j.bone.quaternion.angleTo(j._initialLocalRotation)})).sort((a,b)=>b.angle-a.angle);
      return {rootRotation:root.rotation.toArray().slice(0,3),position:root.position.toArray(),support:agent.support,posture:director.stable,controlled:director.controlled,phone:world.phone.owner,phoneError:director.phoneError,
        hairMax:angles[0].angle,hairTop:angles.slice(0,5),finite:joints.every(j=>j.bone.quaternion.toArray().every(Number.isFinite)),hips:avatar.bones.hips.position.toArray()};
    });report.states.push({label,...state});if(capture)await page.screenshot({path:`${folder}/${tag}-${label}.png`,fullPage:true});return state;
  }
  const initial=await inspect('initial',false);
  await page.locator('#jump-button').click();await page.waitForFunction(()=>window.roomDemo.agent.support==='bed'&&!window.roomDemo.agent.current,{timeout:30000});await page.locator('[data-camera="bed"]').click();await page.waitForTimeout(1000);
  const jumped=await inspect('jump-bed');
  if(jumped.hairMax>initial.hairMax+.3)report.errors.push('Standing hair deforms after jumping onto bed');else report.checks.push('Jump landing preserves standing hair shape');
  await page.locator('[data-posture="lie"]').click();await page.waitForFunction(()=>window.roomDemo.director.stable==='lie'&&!window.roomDemo.director.transition,{timeout:15000});await page.waitForTimeout(1000);await inspect('lying');
  await page.locator('#reset').click();await page.waitForTimeout(500);const reset=await inspect('reset-from-lying');
  if(Math.abs(reset.rootRotation[0])>1e-6||Math.abs(reset.rootRotation[2])>1e-6||reset.controlled||reset.support!=='floor')report.errors.push('Reset preserved lying root rotation');else report.checks.push('Reset from lying returns fully upright on floor');
  if(!before){
    for(const mode of ['phone','sit']){
      await page.locator('[data-posture="'+mode+'"]').click();await page.waitForFunction(m=>{const d=window.roomDemo.director;return m==='phone'?d.held&&!d.phoneMotion:d.stable==='sit'&&!d.transition;},mode,{timeout:30000});
      await page.locator('#pause').click();await page.locator('#reset').click();await page.waitForTimeout(250);const state=await inspect('reset-from-'+mode,false);
      if(Math.abs(state.rootRotation[0])+Math.abs(state.rootRotation[2])>1e-6||state.phone!=='bed'||state.posture!=='stand'||state.controlled)throw new Error('Reset failed from '+mode);
      report.checks.push('Paused '+mode+' reset restores floor, posture and phone');
    }
    await page.locator('[data-posture="lie"]').click();await page.waitForFunction(()=>window.roomDemo.director.transition,{timeout:30000});await page.locator('#reset').click();await page.waitForTimeout(250);const midway=await inspect('reset-mid-transition',false);
    if(Math.abs(midway.rootRotation[0])+Math.abs(midway.rootRotation[2])>1e-6||midway.controlled)throw new Error('Reset failed during transition');report.checks.push('Reset during bed transition restores upright pose');
    await page.locator('[data-posture="lie"]').click();await page.waitForFunction(()=>window.roomDemo.director.stable==='lie'&&!window.roomDemo.director.transition,{timeout:30000});
    await page.locator('#jump-button').click();await page.waitForFunction(()=>!window.roomDemo.director.controlled&&window.roomDemo.agent.support==='floor'&&!window.roomDemo.agent.current,{timeout:30000});await page.waitForTimeout(500);const floor=await inspect('after-lying-jump-down',false);
    if(!floor.finite||floor.hairMax>initial.hairMax+.3||Math.abs(floor.rootRotation[0])+Math.abs(floor.rootRotation[2])>1e-6)throw new Error('Hair/upright transform did not recover after leaving bed pose');report.checks.push('Hair and upright transform recover after lying, standing and jumping down');
    await page.locator('#jump-button').click();await page.waitForFunction(()=>window.roomDemo.agent.support==='bed'&&!window.roomDemo.agent.current,{timeout:30000});await page.locator('[data-camera="bed"]').click();await page.waitForTimeout(800);const again=await inspect('repeat-jump-bed');
    if(!again.finite||again.hairMax>initial.hairMax+.3)throw new Error('Repeat jump damaged standing hair');report.checks.push('Repeated jump keeps hair finite and standing shape stable');
  }
}catch(e){report.errors.push(e.message);}finally{await browser?.close();app.kill();await writeFile(`${folder}/${tag}-report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;
