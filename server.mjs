import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {completionUrl,PLAN_SCHEMA} from './src/protocol.js';
import {SKILLS} from './src/skills.js';
import {ModelPlanner} from './model-client.mjs';
import {BridgeHub,bridgeSecret,authorizedBridge,validSession,qqFetch} from './bridge.mjs';
import {HttpError,readJsonBody,requestOrigin,checkOrigin,resolveEndpoint,safeModelFetch} from './http-utils.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.vrm':'model/gltf-binary','.png':'image/png','.svg':'image/svg+xml','.map':'application/json'};
const routes={
  '/api/config':['GET','POST'], '/api/plan':['POST'], '/api/health':['GET'], '/api/skills':['GET'],
  '/api/bridge/events':['POST'], '/api/bridge/qq/chat':['POST'], '/api/bridge/qq/state':['GET'], '/api/bridge/stream':['GET']
};
function send(res,status,data){
  if(res.destroyed)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
export function createRoomServer({avatar='',config:initialConfig={},planner=new ModelPlanner({fetch:safeModelFetch}),bridge=new BridgeHub(),bridgeToken='',distDir=path.join(root,'dist')}={}){
  let config={baseUrl:'https://api.deepseek.com/v1',model:'',apiKey:'',vision:false,...initialConfig};
  const publicConfig=()=>({baseUrl:config.baseUrl,model:config.model,hasKey:Boolean(config.apiKey),vision:config.vision,configured:Boolean(config.baseUrl&&config.model)});
  const server=http.createServer(async(req,res)=>{
    try{
      requestOrigin(req); // Reject hostile Host headers, including DNS rebinding.
      const url=new URL(req.url,'http://localhost'),pathname=url.pathname,query=url.searchParams;
      if(pathname.startsWith('/api/')){
        const methods=routes[pathname];
        if(!methods)return send(res,404,{error:'没有这个接口。'});
        if(!methods.includes(req.method)){res.setHeader('Allow',methods.join(', '));return send(res,405,{error:'不支持的请求方式。'});}
        if(pathname==='/api/bridge/events'){
          if(!bridgeToken||!authorizedBridge(req.headers.authorization,bridgeToken))return send(res,401,{error:'事件密钥无效。'});
          return send(res,200,bridge.ingest(await readJsonBody(req)));
        }
        checkOrigin(req,{required:req.method==='POST'});
        if(pathname==='/api/config'&&req.method==='GET')return send(res,200,publicConfig());
        if(pathname==='/api/config'){
          const next=await readJsonBody(req);
          if(typeof next.baseUrl!=='string'||next.baseUrl.length>2048)throw new HttpError(400,'请填写有效接口地址。');
          await resolveEndpoint(next.baseUrl);
          const model=typeof next.model==='string'?next.model.trim():'';
          if(!model||model.length>160)throw new HttpError(400,'请填写模型名称。');
          if(next.apiKey!==undefined&&(typeof next.apiKey!=='string'||next.apiKey.length>8192))throw new HttpError(400,'密钥格式无效。');
          let oldEndpoint='';try{oldEndpoint=completionUrl(config.baseUrl);}catch{}
          const sameEndpoint=oldEndpoint===completionUrl(next.baseUrl);
          config={baseUrl:next.baseUrl.trim(),model,apiKey:next.apiKey===undefined?(sameEndpoint?config.apiKey:''):next.apiKey.trim(),vision:next.vision===true};
          return send(res,200,publicConfig());
        }
        if(pathname==='/api/plan'){
          const payload=await readJsonBody(req),controller=new AbortController();
          res.once('close',()=>{if(!res.writableEnded)controller.abort();});
          return send(res,200,await planner.infer({...config,reasoningEffort:process.env.AGENT_REASONING_EFFORT||'auto'},payload,controller.signal));
        }
        if(pathname==='/api/health')return send(res,200,{ok:true,app:'blue-fish-agent-room',avatarFound:Boolean(avatar&&existsSync(avatar)),plannerVersion:4,skillVersion:2,networkPolicyVersion:2});
        if(pathname==='/api/skills')return send(res,200,{version:2,skills:SKILLS,schema:PLAN_SCHEMA});
        if(pathname==='/api/bridge/qq/chat'){
          const data=await readJsonBody(req);
          if(!/^[a-f0-9-]{36}$/.test(data.session||'')||typeof data.text!=='string'||!data.text.trim()||data.text.length>6000)throw new HttpError(400,'消息或会话编号无效。');
          const response=await qqFetch('/admin/agent/chat',{method:'POST',body:JSON.stringify({session:data.session,text:data.text}),signal:AbortSignal.timeout(10000)});
          return send(res,200,await response.json());
        }
        const session=query.get('session');
        if(pathname==='/api/bridge/qq/state'){
          if(!/^[a-f0-9-]{36}$/.test(session||''))throw new HttpError(400,'QQ 会话编号无效。');
          const response=await qqFetch('/admin/agent/room?session='+encodeURIComponent(session),{signal:AbortSignal.timeout(8000)});
          return send(res,200,await response.json());
        }
        const source=query.get('source');
        if(!validSession(session)||!['qq','external'].includes(source))throw new HttpError(400,'联动来源或会话编号无效。');
        if(source==='qq'){
          if(!/^[a-f0-9-]{36}$/.test(session))throw new HttpError(400,'QQ 会话编号无效。');
          const controller=new AbortController();res.once('close',()=>controller.abort());const timer=setTimeout(()=>controller.abort(),8000);
          try{
            const response=await qqFetch('/admin/agent/room/stream?session='+encodeURIComponent(session),{signal:controller.signal});clearTimeout(timer);
            res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();
            for await(const chunk of response.body){if(res.destroyed)break;if(res.writableLength>1024*1024){res.destroy();break;}res.write(chunk);}
            res.end();
          }finally{clearTimeout(timer);controller.abort();}
          return;
        }
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store'});res.flushHeaders();
        const push=data=>{if(!res.destroyed&&!res.writableEnded){if(res.writableLength>1024*1024){res.destroy();return;}res.write('data: '+JSON.stringify(data)+'\n\n');}};
        bridge.on(session,push);push(bridge.snapshot(session));const timer=setInterval(()=>push(bridge.snapshot(session)),10000);
        res.once('close',()=>{clearInterval(timer);bridge.off(session,push);});return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return send(res,405,{error:'不支持的请求方式。'});}
      const decoded=decodeURIComponent(pathname),base=path.resolve(distDir);
      let file=decoded==='/assets/avatar.vrm'?avatar:path.resolve(base,'.'+(decoded==='/'?'/index.html':decoded));
      if(decoded==='/assets/avatar.vrm'&&!avatar)throw new HttpError(404,'未配置角色模型，请在 .env 设置 AVATAR_PATH 后重启房间。');
      if(decoded!=='/assets/avatar.vrm'&&!file.startsWith(base+path.sep))throw new HttpError(403,'路径不可访问。');
      let size=await stat(file);if(!size.isFile())throw new HttpError(404,'文件不存在。');
      const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
      if(decoded!=='/assets/avatar.vrm'){
        headers.Vary='Accept-Encoding';
        if(/(?:^|,)\s*br(?:\s*;\s*q=(?!0(?:\.0*)?\s*(?:,|$))[0-9.]+)?\s*(?:,|$)/i.test(req.headers['accept-encoding']||'')&&existsSync(file+'.br')){file+='.br';size=await stat(file);headers['Content-Encoding']='br';}
      }
      headers['Content-Length']=size.size;res.writeHead(200,headers);
      if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    }catch(error){
      if(error.status===413){res.setHeader('Connection','close');req.resume();}
      if(!res.headersSent)send(res,error.status|| (error.code==='ENOENT'?404:400),{error:error.code==='ENOENT'?'找不到本地资源。请确认原始 VRM 路径，或设置 AVATAR_PATH。':String(error.message).slice(0,220)});
      else res.end();
    }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;return server;
}
async function start(){
  try{const env=parseEnv(await readFile(path.join(root,'.env'),'utf8'));for(const [key,value]of Object.entries(env))if(process.env[key]===undefined)process.env[key]=value;}catch(error){if(error.code!=='ENOENT')throw error;}
  const server=createRoomServer({avatar:process.env.AVATAR_PATH||'',bridgeToken:await bridgeSecret(root),config:{baseUrl:process.env.AGENT_BASE_URL||'https://api.deepseek.com/v1',model:process.env.AGENT_MODEL||'',apiKey:process.env.AGENT_API_KEY||'',vision:process.env.AGENT_VISION==='true'}});
  const port=Number(process.env.PORT||4177);
  server.listen(port,'127.0.0.1',()=>console.log(`小肥鱼的房间 http://127.0.0.1:${port}`));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`端口 ${port} 已使用。请先关闭旧窗口，或设置 PORT。`:error.message);process.exitCode=1;});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await start();
