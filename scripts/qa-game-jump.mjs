import './qa-http.mjs';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const folder='.impeccable/review/game-jump',base='http://127.0.0.1:4192';await mkdir(folder,{recursive:true});
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4192'},stdio:'ignore',windowsHide:true});
let browser;const report={checks:[],errors:[],states:[],engine:null};
try{
  for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>window.roomDemo,{timeout:60000});await page.waitForTimeout(500);
  await page.evaluate(()=>{const {camera,controls}=window.roomDemo;camera.position.set(1.7,3.8,-.9);controls.target.set(-1.15,1,.34);controls.update();});
  report.engine=await page.evaluate(()=>window.roomDemo.world.physics.stats);
  const capture=async label=>{const state=await page.evaluate(()=>{
    const {agent,avatar,world}=window.roomDemo,m=agent.current?.motor;
    return {observation:agent.observation(),position:avatar.root.position.toArray(),paused:agent.paused,motor:m?{age:m.age,phase:m.phase,steps:m.steps,velocity:{...m.velocity},grounded:m.grounded,support:m.support,contacts:m.contacts}:null,pose:agent.pose,activeBody:Boolean(world.physics.activeMotor)};
  });delete state.pose.supportHeightAt;report.states.push({label,...state});await page.screenshot({path:`${folder}/${label}.png`,fullPage:true});};
  async function pauseAt(phase){await page.waitForFunction(wanted=>{
    const m=window.roomDemo.agent.current?.motor;if(!m)return false;
    const match=wanted==='windup'?m.phase==='windup'&&m.phaseAge>.09:wanted==='apex'?m.airborne&&Math.abs(m.velocity.y)<.65:wanted==='falling'?m.phase==='falling'&&m.velocity.y< -1.2:m.phase==='landing'&&m.phaseAge>.025;
    if(match){document.querySelector('#pause').click();return true;}return false;
  },phase,{timeout:30000});await capture(phase);}
  await page.locator('#jump-button').click();await pauseAt('windup');await page.locator('#pause').click();await pauseAt('apex');
  const frozen=await page.evaluate(()=>window.roomDemo.avatar.root.position.toArray());await page.waitForTimeout(300);
  if(JSON.stringify(frozen)!==JSON.stringify(await page.evaluate(()=>window.roomDemo.avatar.root.position.toArray())))throw new Error('Paused motor moved');report.checks.push('Pause freezes actual capsule position and velocity');
  await page.locator('.view-settings summary').click();await page.locator('#show-nav').check();await page.screenshot({path:`${folder}/capsule-airborne.png`,fullPage:true});await page.locator('#show-nav').uncheck();await page.locator('.view-settings summary').click();
  await page.locator('#pause').click();await pauseAt('falling');await page.locator('#pause').click();await pauseAt('landing');
  if(report.states.find(s=>s.label==='landing').motor.support!=='bed')throw new Error('Landing had no real bed support');report.checks.push('Bed contact triggers landing compression');
  await page.locator('#pause').click();await page.waitForFunction(()=>!window.roomDemo.agent.current&&window.roomDemo.agent.support==='bed');await capture('standing');
  // Record an uninterrupted down/up cycle from the actual canvas and RAF loop.
  await page.evaluate(()=>{
    window.gameJumpTrace=[];window.gameJumpChunks=[];window.gameJumpStream=document.querySelector('canvas.world-canvas').captureStream(30);
    window.gameJumpRecorder=new MediaRecorder(window.gameJumpStream,{mimeType:'video/webm;codecs=vp8'});window.gameJumpRecorder.ondataavailable=e=>{if(e.data.size)window.gameJumpChunks.push(e.data);};window.gameJumpRecorder.start();
    window.gameJumpRecording=true;let previous='';function observe(){if(!window.gameJumpRecording)return;const m=window.roomDemo.agent.current?.motor;if(m){const key=m.age+':'+m.phase;if(key!==previous){previous=key;window.gameJumpTrace.push({age:m.age,phase:m.phase,p:{...m.position},v:{...m.velocity},grounded:m.grounded,support:m.support,steps:m.steps});}}requestAnimationFrame(observe);}requestAnimationFrame(observe);
  });
  await page.locator('#jump-button').click();await page.waitForFunction(()=>!window.roomDemo.agent.current&&window.roomDemo.agent.support==='floor',{timeout:30000});
  await page.locator('#jump-button').click();await page.waitForFunction(()=>!window.roomDemo.agent.current&&window.roomDemo.agent.support==='bed',{timeout:30000});await page.waitForTimeout(250);
  const clip=await page.evaluate(async()=>{
    window.gameJumpRecording=false;const done=new Promise(r=>window.gameJumpRecorder.onstop=r);window.gameJumpRecorder.stop();await done;window.gameJumpStream.getTracks().forEach(t=>t.stop());
    const blob=new Blob(window.gameJumpChunks,{type:'video/webm'}),data=await new Promise(r=>{const reader=new FileReader();reader.onload=()=>r(reader.result.split(',')[1]);reader.readAsDataURL(blob);});return {data,trace:window.gameJumpTrace};
  });await writeFile(`${folder}/game-jump.webm`,Buffer.from(clip.data,'base64'));report.trace=clip.trace;report.videoBytes=Buffer.byteLength(clip.data,'base64');
  if(!clip.trace.some(s=>s.phase==='rising'&&s.p.z<1.1&&s.v.y>0)||!clip.trace.some(s=>s.phase==='falling'&&s.v.y<0))throw new Error('No live rise/fall velocity evidence');
  for(let i=1;i<clip.trace.length;i++){const a=clip.trace[i-1],b=clip.trace[i],dt=b.age-a.age;if(dt>0&&Math.hypot(b.p.x-a.p.x,b.p.y-a.p.y,b.p.z-a.p.z)>8*dt+.01)throw new Error('Recorded physics pose jumped discontinuously');}
  report.checks.push('Continuous down/up uses live rising/falling velocity and ground contacts');
  report.checks.push('Recorded physics positions remain continuous across airborne and contact states');
}catch(e){report.errors.push(e.message);process.exitCode=1;}finally{await browser?.close();app.kill();await writeFile(`${folder}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,engine:report.engine,videoBytes:report.videoBytes}));
