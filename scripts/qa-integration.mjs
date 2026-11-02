import './qa-http.mjs';
import {chromium} from 'playwright-core';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const qqProject=path.resolve(process.env.ROOM_QQ_PROJECT||'../qq-ai-bot-web');
const {createApp}=await import(pathToFileURL(path.join(qqProject,'src/app.mjs')).href);
const {loadConfig}=await import(pathToFileURL(path.join(qqProject,'src/config.mjs')).href);
const delay=ms=>new Promise(r=>setTimeout(r,ms)),root=process.cwd();await mkdir('.local',{recursive:true});await mkdir('.impeccable/review',{recursive:true});
const directory=await mkdtemp(path.join(root,'.local','bridge-qa-')),session=randomUUID();let bot,room,browser;const report={checks:[],errors:[],sentQQ:0,commandOutput:''};
const check=(name,data={})=>{report.checks.push({name,...data});console.log(name,JSON.stringify(data));};
try{
  const config=loadConfig({ONEBOT_ACCESS_TOKEN:randomBytes(32).toString('hex'),ADMIN_ACCESS_TOKEN:randomBytes(32).toString('hex'),SESSION_KEY:randomBytes(32).toString('hex'),DATA_DIR:directory,PORT:'0',QQ_DRIVER:'demo',AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',BOT_ADMIN_IDS:'10001',SEND_INTERVAL_MS:'0',SESSION_INTERVAL_MS:'0'});
  const ai={reply:async(input,_history,_signal,options)=>{
    const finish=options.onModelStep?.(1);await delay(650);finish?.('succeeded');
    if(input.includes('computer-task-fixture')){await options.invokeTool('exec_command',{});return '测试命令已完成，结果为 2。';}
    await delay(1100);return '普通聊天回复完成。';
  }};
  bot=await createApp(config,{ai,log(){}});bot.adapter.on('outgoing',()=>report.sentQQ++);
  const originalTools=bot.agent.tools.bind(bot.agent);
  bot.agent.tools=(event,job,signal)=>{const selected=originalTools(event,job,signal);return {...selected,tools:[...selected.tools,{name:'exec_command',description:'Isolated harmless command fixture',effect:'read',parameters:{type:'object',properties:{},additionalProperties:false},invoke:async()=>{await delay(1200);const r=await promisify(execFile)(process.execPath,['-p','1+1'],{windowsHide:true});report.commandOutput=r.stdout.trim();return {result:{ok:true,output:r.stdout.trim()}};}}]};};
  room=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4188',ROOM_QQ_BASE_URL:'http://127.0.0.1:'+bot.address.port,ROOM_QQ_ADMIN_TOKEN:config.adminToken},stdio:'ignore',windowsHide:true});
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4188/api/health')).ok)break;}catch{}await delay(100);}
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:4188/?source=qq&session='+session);await page.waitForFunction(()=>window.roomDemo?.bridge.connected,{timeout:30000});await page.waitForFunction(()=>window.roomDemo.director.stable==='lie'&&!window.roomDemo.director.transition,{timeout:30000});check('qq-linked-and-resting');
  await page.locator('[data-camera="bed"]').click();
  await page.locator('#command').fill('normal-chat-fixture');await page.locator('#send').click();
  await page.waitForFunction(()=>window.roomDemo.world.phone.owner==='hand'&&!window.roomDemo.director.phoneMotion,{timeout:20000});await delay(250);await page.screenshot({path:'.impeccable/review/qq-phone.png',fullPage:true});check('qq-message-phone-held');
  await page.waitForFunction(()=>window.roomDemo.world.phone.owner==='bed'&&window.roomDemo.director.completed&&!window.roomDemo.director.phoneMotion,{timeout:20000});check('qq-reply-phone-put-back');
  // Submit directly to the original Agent endpoint, as its own UI does.
  const submitted=await fetch('http://127.0.0.1:'+bot.address.port+'/admin/agent/chat',{method:'POST',headers:{Authorization:'Bearer '+config.adminToken,'Content-Type':'application/json'},body:JSON.stringify({session,text:'computer-task-fixture'})});if(!submitted.ok)throw new Error('Original Agent endpoint rejected fixture');
  await page.waitForFunction(()=>window.roomDemo.director.stable==='sit'&&!window.roomDemo.director.transition,{timeout:25000});await delay(250);await page.screenshot({path:'.impeccable/review/qq-computer.png',fullPage:true});
  if(report.commandOutput!=='2')throw new Error('Harmless command fixture did not execute');if(await page.evaluate(()=>window.roomDemo.world.phone.owner)!=='bed')throw new Error('Phone was not put down before computer task');check('actual-tool-trace-seated',{output:report.commandOutput});
  await page.waitForFunction(()=>window.roomDemo.director.stable==='lie'&&!window.roomDemo.director.transition,{timeout:15000});check('completed-task-returns-to-rest');
  const token=(await readFile('.local/bridge-token.txt','utf8')).trim();
  await page.locator('#bridge-settings summary').click();await page.locator('#bridge-source').selectOption('external');await page.locator('#bridge-session').fill('harness-fixture');await page.locator('#bridge-form button[type=submit]').click();await page.waitForFunction(()=>window.roomDemo.bridge.connected);
  const post=async(type,extra={})=>{const r=await fetch('http://127.0.0.1:4188/api/bridge/events',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({session:'harness-fixture',runId:'external-1',type,...extra})});if(!r.ok)throw new Error('External bridge rejected event');};
  const unauthorized=await fetch('http://127.0.0.1:4188/api/bridge/events',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(unauthorized.status!==401)throw new Error('Bridge accepts unauthenticated event');check('external-event-auth');
  await post('message_received');await page.waitForFunction(()=>window.roomDemo.world.phone.owner==='hand',{timeout:20000});await post('tool_started',{tool:'browser_navigate'});await page.waitForFunction(()=>window.roomDemo.director.stable==='sit'&&!window.roomDemo.director.transition,{timeout:20000});await post('reply_complete',{text:'External task complete.'});check('external-harness-transition');
  await page.setViewportSize({width:390,height:844});await delay(300);await page.screenshot({path:'.impeccable/review/linked-mobile.png',fullPage:true});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow');check('mobile-no-overflow');
  if(report.sentQQ!==0)throw new Error('Integration fixture sent QQ messages');
}finally{
  await browser?.close();room?.kill();await bot?.close();await writeFile('.impeccable/review/integration-report.json',JSON.stringify(report,null,2));
  if(path.resolve(directory).startsWith(path.resolve(root,'.local')+path.sep))await rm(directory,{recursive:true,force:true});
}
if(report.errors.length)throw new Error(report.errors.join('\n'));
console.log('Integration passed',JSON.stringify({checks:report.checks.length,sentQQ:report.sentQQ}));
