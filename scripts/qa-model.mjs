import './qa-http.mjs';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
const local=process.argv.includes('--local'),root='http://127.0.0.1:4191';
const report={checks:[],errors:[],mode:local?'real-local-model':'mock'};await mkdir('.impeccable/review',{recursive:true});
let browser,mock,app;
const post=async(path,body)=>{const r=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
try{
  let startupError='',startupOutput='',connectionError='';app=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4191'},stdio:['ignore','pipe','pipe'],windowsHide:true});app.stderr.on('data',c=>{startupError=(startupError+c).slice(-2000);});app.stdout.on('data',c=>{startupOutput=(startupOutput+c).slice(-500);});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(root+'/api/health')).ok){ready=true;break;}}catch(e){connectionError=e.cause?.code||e.message;}if(app.exitCode!==null)break;await new Promise(r=>setTimeout(r,150));}
  if(!ready)throw new Error('Test server unavailable: '+JSON.stringify({exit:app.exitCode,connectionError,output:startupOutput,error:startupError}));
  let calls=[];
  mock=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls.push(body);res.setHeader('Content-Type','application/json');
    const n=calls.length;
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:n===1?'我想看看窗外。':JSON.stringify({say:'开始看窗外。',reason:'目标可达。',action:{type:'look',target:'window',duration:.6}})}}]}));
  });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  await post('/api/config',{baseUrl:'http://127.0.0.1:'+mock.address().port+'/v1',model:'mock-format-correction',apiKey:'',vision:false});
  const corrected=await post('/api/plan',{goal:'自主活动：选择一个活动',observation:{support:'floor'},history:[]});
  if(corrected.status!==200||calls.length!==2||corrected.data.action.type!=='look')throw new Error('HTTP correction flow failed');report.checks.push('HTTP planner corrects prose once and returns a validated action');
  if(local){
    const c=await(await fetch('http://127.0.0.1:4177/api/config')).json(),u=new URL(c.baseUrl);
    if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='1235'||c.hasKey||c.model!=='Qwen3.5-9b')throw new Error('Local configuration changed; refusing a different provider');
    await post('/api/config',{baseUrl:c.baseUrl,model:c.model,apiKey:'',vision:c.vision});report.model=c.model;
  }else calls=[];
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(root);await page.waitForFunction(()=>window.roomDemo?.config.configured,{timeout:30000});
  const planned=page.waitForResponse(r=>r.url()===root+'/api/plan',{timeout:75000});
  await page.locator('#autonomy').check();const response=await planned,data=await response.json();
  if(!response.ok())throw new Error('Autonomy failed: '+data.error);
  await page.waitForFunction(()=>!window.roomDemo.agent.busy,{timeout:5000});
  report.action=data.action;report.planRequests=await page.evaluate(()=>window.roomDemo.agent.turns);
  report.checks.push('Checking the actual autonomy control receives a valid model action');
  await page.locator('#stop').click();await page.waitForTimeout(100);
  const state=await page.evaluate(()=>({auto:window.roomDemo.agent.auto,busy:window.roomDemo.agent.busy,goal:window.roomDemo.agent.goal,current:window.roomDemo.agent.current?.type}));
  if(state.auto||state.busy||state.goal)throw new Error('Stop left autonomy/model work active');report.checks.push('Stop cancels autonomous work');
  await page.screenshot({path:'.impeccable/review/model-autonomy.png',fullPage:true});
}catch(e){report.errors.push(e.message+(e.cause?.code?' ('+e.cause.code+')':''));process.exitCode=1;}finally{
  await browser?.close();app?.kill();if(mock)await new Promise(r=>mock.close(r));await writeFile('.impeccable/review/model-autonomy-report.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report));
