import './qa-http.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
const dir=path.resolve('.impeccable/review');await mkdir(dir,{recursive:true});
const port=4187,base=`http://127.0.0.1:${port}`;
const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser,mock;
const report={checks:[],errors:[],console:[],mockRequests:[]};
const check=(name,data)=>{report.checks.push({name,...data});console.log(name,JSON.stringify(data));};
try{
  for(let i=0;i<50;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-features=CalculateNativeWinOcclusion']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'||msg.type()==='warning')report.console.push(msg.text().slice(0,300));});
  await page.goto(base);await page.waitForFunction(()=>Boolean(window.roomDemo),{timeout:60000});
  await page.waitForTimeout(1200);
  check('load',await page.evaluate(()=>window.roomDemo.snapshot()));
  await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
  await page.locator('[data-camera="follow"]').click();await page.waitForTimeout(1400);
  await page.screenshot({path:path.join(dir,'character.png'),fullPage:true});
  await page.locator('[data-camera="room"]').click();await page.locator('#home-camera').click();
  await page.locator('[data-action="window"]').click();
  await page.waitForFunction(()=>window.roomDemo.agent.current?.type==='move');
  await page.waitForTimeout(700);await page.locator('#pause').click();
  const before=await page.evaluate(()=>window.roomDemo.snapshot());await page.waitForTimeout(800);
  const after=await page.evaluate(()=>window.roomDemo.snapshot());
  if(JSON.stringify(before.position)!==JSON.stringify(after.position))throw new Error('Movement continued while paused');
  check('pause',{stationary:true,position:after.position});await page.locator('#pause').click();
  await page.waitForFunction(()=>!window.roomDemo.agent.current&&!window.roomDemo.agent.queue.length,{timeout:90000});
  const windowState=await page.evaluate(()=>window.roomDemo.snapshot());
  if(windowState.observation.targets.window.distance>.02)throw new Error('Window route did not finish');
  check('window-route',windowState);
  await page.locator('[data-action="lamp"]').click();await page.waitForFunction(()=>window.roomDemo.world.lampOn,{timeout:30000});
  check('lamp',{on:true});
  await page.locator('#stop').click();await page.locator('#reset').click();await page.locator('[data-camera="follow"]').click();await page.waitForTimeout(1500);await page.locator('[data-action="wave"]').click();await page.waitForTimeout(1400);
  check('wave-pose',await page.evaluate(()=>window.roomDemo.snapshot()));
  await page.screenshot({path:path.join(dir,'wave.png'),fullPage:true});
  await page.locator('#stop').click();await page.locator('#reset').click();
  await page.locator('[data-action="desk"]').click();await page.waitForTimeout(800);await page.locator('#stop').click();
  const stopped=await page.evaluate(()=>window.roomDemo.snapshot());await page.waitForTimeout(500);
  if(JSON.stringify(stopped.position)!==JSON.stringify((await page.evaluate(()=>window.roomDemo.snapshot())).position))throw new Error('Stop did not cancel movement');
  check('stop',{stationary:true});
  await page.locator('#reset').click();await page.locator('[data-camera="first"]').click();await page.waitForTimeout(2600);
  const yawBefore=await page.evaluate(()=>window.roomDemo.avatar.root.rotation.y);
  await page.mouse.move(600,400);await page.mouse.down();await page.mouse.move(625,400,{steps:5});await page.mouse.up();await page.waitForTimeout(300);
  const yawAfter=await page.evaluate(()=>window.roomDemo.avatar.root.rotation.y);if(Math.abs(yawAfter-yawBefore)<.1)throw new Error('First person drag did not turn avatar');check('first-person-turn',{yawBefore,yawAfter});
  await page.screenshot({path:path.join(dir,'first-person.png'),fullPage:true});
  await page.locator('#home-camera').click();

  await page.locator('#reset').click();
  const collision=await page.evaluate(()=>{
    const {world,avatar}=window.roomDemo,chair=world.obstacles.find(o=>o.id==='chair');
    let rejected=false;try{world.nav.route(avatar.root.position,{x:(chair.minX+chair.maxX)/2,z:(chair.minZ+chair.maxZ)/2});}catch{rejected=true;}
    return {chair,rejected,envelope:avatar.measureEnvelope(),radius:world.nav.radius};
  });
  if(!collision.rejected||collision.radius<collision.envelope.radius+.025)throw new Error('Visible chair/full-body collision envelope failed');
  check('visible-chair-collision',collision);
  await page.locator('[data-action="desk"]').click();await page.waitForFunction(()=>!window.roomDemo.agent.current,{timeout:30000});
  await page.locator('.view-settings summary').click();await page.locator('#show-nav').check();
  await page.waitForFunction(()=>window.roomDemo.world.debug.visible);await page.waitForTimeout(250);
  await page.screenshot({path:path.join(dir,'chair-avoidance.png'),fullPage:true});
  await page.locator('#show-nav').uncheck();await page.locator('.view-settings summary').click();
  await page.locator('#reset').click();await page.locator('#jump-button').click();
  await page.waitForFunction(()=>{const c=window.roomDemo.agent.current;if(c?.motor?.airborne&&Math.abs(c.motor.velocity.y)<.6){document.querySelector('#pause').click();return true;}return false;},{timeout:30000});
  const air=await page.evaluate(()=>window.roomDemo.snapshot());
  await page.screenshot({path:path.join(dir,'jump-air.png'),fullPage:true});await page.waitForTimeout(400);
  if(JSON.stringify(air.position)!==JSON.stringify((await page.evaluate(()=>window.roomDemo.snapshot())).position))throw new Error('Airborne pause moved the character');
  check('jump-air-pause',air);await page.locator('#pause').click();
  await page.waitForFunction(()=>window.roomDemo.agent.support==='bed'&&!window.roomDemo.agent.current,{timeout:30000});
  await page.waitForTimeout(250);
  const landed=await page.evaluate(()=>{
    const {avatar,world}=window.roomDemo,snapshot=window.roomDemo.snapshot(),feet={};
    for(const side of ['left','right']){const p=avatar.bones[side+'Foot'].getWorldPosition(avatar.root.position.clone());const expected=world.bed.heightAt(p.x,p.z)+avatar.footRest[side].y-.0175;feet[side]={actual:p.y,expected,error:Math.abs(p.y-expected)};}
    return {...snapshot,feet,envelopeNow:avatar.measureEnvelope()};
  });
  if(landed.position[1]<.5||Object.values(landed.feet).some(f=>f.error>.015))throw new Error('Bed support/foot IK did not settle');
  check('bed-landing-support',landed);await page.screenshot({path:path.join(dir,'on-bed.png'),fullPage:true});
  await page.locator('[data-action="user"]').click();await page.waitForFunction(()=>!window.roomDemo.agent.current);await page.waitForTimeout(250);
  await page.screenshot({path:path.join(dir,'on-bed-front.png'),fullPage:true});
  await page.locator('#jump-button').click();await page.waitForFunction(()=>{const c=window.roomDemo.agent.current;return c?.type==='jump'&&c.elapsed>.6;});
  await page.locator('#stop').click();await page.waitForFunction(()=>!window.roomDemo.agent.current,{timeout:30000});
  const down=await page.evaluate(()=>window.roomDemo.snapshot());if(down.support!=='floor'||Math.abs(down.position[1])>.001)throw new Error('Interrupted jump did not land on floor');check('jump-down-stop',down);

  // This local mock verifies the protocol and feedback loop, not real inference.
  mock=http.createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    const data=JSON.parse(body),user=JSON.parse(data.messages.at(-1).content),h=user.history;
    report.mockRequests.push({goal:user.goal,history:h,observation:user.observation});
    let plan;
    if(user.goal.includes('跳床测试')){
      const jumps=h.filter(e=>e.action.type==='jump');plan={say:'本地跳床协议测试',reason:'根据支撑面与执行反馈选择动作',action:jumps.length<2?{type:'jump',target:jumps.length?'floor':'bed'}:{type:'finish'}};
    }else plan=h.length===0?{say:'测试：先走到床边。',reason:'测试服务返回第一步',action:{type:'move',target:'bed'}}:h.length===1?{say:'测试：已经到达，向你挥手。',reason:'已收到行走完成反馈',action:{type:'wave',duration:.6}}:{say:'测试流程完成。',reason:'已收到挥手完成反馈',action:{type:'finish'}};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]}));
  });await new Promise(r=>mock.listen(4197,'127.0.0.1',r));
  await page.locator('#connect-shortcut').click();await page.locator('#base-url').fill('http://127.0.0.1:4197/v1');await page.locator('#model-name').fill('protocol-test-mock');await page.locator('#save-config').click();
  await page.waitForFunction(()=>window.roomDemo.config.configured);
  await page.locator('#command').fill('测试：去床边，再挥手');await page.locator('#send').click();
  await page.waitForFunction(()=>window.roomDemo.agent.turns===3&&!window.roomDemo.agent.goal&&!window.roomDemo.agent.busy,{timeout:60000});
  if(report.mockRequests.length!==3||report.mockRequests[2].history[1].result.ok!==true)throw new Error('Feedback loop failed');
  check('model-feedback-loop',{requests:3,lastObservation:report.mockRequests.at(-1).observation,scope:'local mock; not a provider test'});
  await page.locator('#command').fill('跳床测试：上床再跳下');await page.locator('#send').click();await page.waitForFunction(()=>window.roomDemo.agent.turns===3&&!window.roomDemo.agent.goal&&!window.roomDemo.agent.busy,{timeout:60000});
  const jumpRequests=report.mockRequests.filter(r=>r.goal.includes('跳床测试'));
  if(jumpRequests.length!==3||jumpRequests[1].observation.support!=='bed'||jumpRequests[2].observation.support!=='floor')throw new Error('Jump planning feedback did not report support changes');check('model-jump-feedback',{requests:3,supports:jumpRequests.map(r=>r.observation.support),scope:'local mock'});
  const secret='qa-placeholder-only';await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl:'http://127.0.0.1:4197/v1',model:'test',apiKey:secret})});
  const publicConfig=await(await fetch(base+'/api/config')).text();if(publicConfig.includes(secret))throw new Error('Key exposed by config endpoint');check('key-redaction',{ok:true});
  await page.evaluate(()=>{window.roomDemo.agent.reset();});
  // Restore honest, unconfigured presentation before final captures.
  await browser.close();browser=null;
  app.kill();await new Promise(r=>app.once('exit',r));
  const clean=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'ignore',windowsHide:true});
  try{
    await new Promise(r=>setTimeout(r,500));browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
    const p=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});await p.goto(base);await p.waitForFunction(()=>Boolean(window.roomDemo),{timeout:60000});await p.waitForTimeout(800);await p.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
    await p.setViewportSize({width:390,height:844});await p.waitForTimeout(300);await p.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    check('mobile',{overflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  }finally{clean.kill();}
}finally{
  if(browser)await browser.close();app.kill();if(mock)await new Promise(r=>mock.close(r));
  await writeFile(path.join(dir,'qa-report.json'),JSON.stringify(report,null,2));
}
if(report.errors.length)throw new Error(report.errors.join('\n'));
console.log('QA finished',JSON.stringify({checks:report.checks.length,errors:report.errors,console:report.console}));
