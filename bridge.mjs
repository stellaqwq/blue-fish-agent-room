import {EventEmitter} from 'node:events';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import path from 'node:path';

export const validSession=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const computerTool=name=>/(?:^|[_./:-])(?:exec(?:ute)?|shell|bash|terminal|command|computer|desktop|browser|playwright|python|run_code|run_command|read_file|file_write|write_file|edit_file|str_replace_editor|apply_patch)(?:$|[_./:-])/i.test(name);
const kinds=new Set(['message_received','response_started','tool_started','tool_completed','reply_complete','run_complete','run_failed','run_cancelled']);
export class BridgeHub extends EventEmitter {
  constructor(){super();this.sessions=new Map();}
  ingest(value){
    const {session,runId,type}=value||{};
    if(!validSession(session)||typeof runId!=='string'||!runId||runId.length>180||!kinds.has(type))throw new Error('事件需要有效的 session、runId 和 type。');
    let jobs=this.sessions.get(session);if(!jobs){if(this.sessions.size>=64)this.sessions.delete(this.sessions.keys().next().value);this.sessions.set(session,jobs=new Map());}
    const old=jobs.get(runId);
    if(old&&['done','failed','cancelled'].includes(old.status))return this.snapshot(session);
    const job=old||{id:runId,status:'generating',computer:false,tools:[],createdAt:Date.now(),reply:''};
    if(type==='tool_started'){
      const name=String(value.tool||'tool').slice(0,160),computer=value.activity==='computer'||computerTool(name);
      job.computer||=computer;job.tools=[...job.tools.filter(t=>t.name!==name),{name,state:'running',computer}].slice(-12);
    }
    if(type==='tool_completed')job.tools=job.tools.map(t=>t.name===value.tool?{...t,state:'succeeded'}:t);
    if(type==='reply_complete'||type==='run_complete'){job.status='done';job.reply=String(value.text||job.reply||'').slice(0,1600);}
    if(type==='run_failed'||type==='run_cancelled'){job.status=type==='run_failed'?'failed':'cancelled';job.reply='';}
    job.updatedAt=Date.now();jobs.set(runId,job);while(jobs.size>16)jobs.delete(jobs.keys().next().value);
    const result=this.snapshot(session);this.emit(session,result);return result;
  }
  snapshot(session){
    if(!validSession(session))throw new Error('会话编号无效。');
    const jobs=[...(this.sessions.get(session)?.values()||[])];
    // Expire abandoned runs so a crashed harness cannot leave the room stuck.
    for(const job of jobs)if(job.status==='generating'&&Date.now()-job.updatedAt>300000)job.status='cancelled';
    return {version:1,source:'external',session,jobs,current:jobs.find(j=>j.status==='generating')||jobs.at(-1)||null};
  }
}
export async function bridgeSecret(root){
  const file=path.join(root,'.local','bridge-token.txt');await mkdir(path.dirname(file),{recursive:true});
  try{const value=(await readFile(file,'utf8')).trim();if(value.length>=32)return value;}catch{}
  const value=randomBytes(32).toString('hex');await writeFile(file,value,{mode:0o600});return value;
}
export const authorizedBridge=(header,token)=>{const value=/^Bearer (.+)$/.exec(header||'')?.[1]||'';return timingSafeEqual(createHash('sha256').update(value).digest(),createHash('sha256').update(token).digest());};
export async function qqConnection(){
  const project=process.env.ROOM_QQ_PROJECT||path.resolve('..','qq-ai-bot-web');
  let env={};try{env=parseEnv(await readFile(path.join(project,'.env'),'utf8'));}catch{}
  const token=process.env.ROOM_QQ_ADMIN_TOKEN||env.ADMIN_ACCESS_TOKEN;
  if(!token)throw new Error('找不到 QQ Agent 管理凭据，请检查本地项目配置。');
  const base=new URL(process.env.ROOM_QQ_BASE_URL||`http://127.0.0.1:${env.PORT||5700}`);
  if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('QQ Agent 联动地址必须是本机服务。');
  return {base,token};
}
export async function qqFetch(route,options={}){
  const {base,token}=await qqConnection();
  const response=await fetch(new URL(route,base),{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token}});
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===404?'请重启 QQ 项目以加载房间接口。':response.status===401?'QQ Agent 管理凭据无效，请检查服务配置。':`QQ Agent 返回 HTTP ${response.status}。`);}
  return response;
}
