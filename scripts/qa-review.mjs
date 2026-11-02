import './qa-http.mjs';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4194'},stdio:'ignore',windowsHide:true}),report={checks:[],errors:[]};let browser;
try{
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4194/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
  let faults=0;page.on('console',m=>{if(m.type()==='error'&&m.text().includes('房间帧更新已停止'))faults++;});
  await page.goto('http://127.0.0.1:4194');await page.waitForFunction(()=>window.roomDemo,null,{timeout:45000});
  const rate=await page.evaluate(async()=>{const d=window.roomDemo,before={...d.frameMetrics};for(let i=0;i<120;i++)await new Promise(requestAnimationFrame);return {callbacks:d.frameMetrics.callbacks-before.callbacks,rendered:d.frameMetrics.rendered-before.rendered};});assert.equal(rate.callbacks,rate.rendered);assert.ok(rate.rendered>=119);report.checks.push({name:'Every visible rAF renders without rate quantization',...rate});
  const writes=await page.evaluate(async()=>{let writes=0;const observer=new MutationObserver(items=>writes+=items.length);for(const id of ['lamp-button','jump-button'])observer.observe(document.getElementById(id),{childList:true,attributes:true,subtree:true});for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);observer.disconnect();return writes;});assert.equal(writes,0);report.checks.push({name:'Stable action buttons have no repeated DOM writes',writes});
  await page.locator('#jump-button').click();await page.waitForFunction(()=>window.roomDemo.agent.support==='bed'&&!window.roomDemo.agent.current,null,{timeout:30000});
  await page.evaluate(()=>{window.heightBefore=window.roomDemo.world.bed.heightAt;window.roomDemo.world.bed.heightAt=()=>{throw new Error('QA support fault');};});await page.waitForFunction(()=>window.roomDemo.frameGuard.error);await page.waitForTimeout(400);assert.equal(faults,1);assert.equal(await page.evaluate(()=>window.roomDemo.agent.paused),true);report.checks.push({name:'A real bed-height fault stops once instead of throwing every frame',faults});
  await page.evaluate(()=>window.roomDemo.world.bed.heightAt=window.heightBefore);await page.locator('#reset').click();await page.locator('[data-action="wave"]').click();await page.waitForFunction(()=>!window.roomDemo.agent.current&&!window.roomDemo.agent.queue.length,null,{timeout:15000});assert.equal(await page.evaluate(()=>window.roomDemo.frameGuard.error),null);report.checks.push({name:'Reset recovers the frame loop and manual actions'});
  await mkdir('.impeccable/review/code-review',{recursive:true});await page.screenshot({path:'.impeccable/review/code-review/recovered.png',fullPage:true});
}catch(e){report.errors.push(e.stack);process.exitCode=1;}finally{await browser?.close();app.kill();await mkdir('.impeccable/review/code-review',{recursive:true});await writeFile('.impeccable/review/code-review/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
