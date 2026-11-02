import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const name='blue-fish-room';
export function publicText(message){
  const content=message?.content;
  return typeof content==='string'?content:Array.isArray(content)?content.filter(b=>b?.type==='text').map(b=>String(b.text||'')).join('\n'):'';
}
export function createObserver(ctx,config={}){
  const endpoint=config.endpoint||'http://127.0.0.1:4177/api/bridge/events';
  const tokenFile=config.tokenFile||fileURLToPath(new URL('../.local/bridge-token.txt',import.meta.url));
  const roomSession=config.roomSession||'deepseek-room';let selected=config.sessionId||'',tail=Promise.resolve(),pending=0,closed=false,lastWarning=0;
  const turns=new Map(),messages=new Map(),calls=new Map();
  function post(data){
    if(closed||pending>=128)return;pending++;
    tail=tail.then(async()=>{if(closed)return;const token=(config.token||await readFile(tokenFile,'utf8')).trim();const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({session:roomSession,...data}),signal:AbortSignal.timeout(1800)});await r.body?.cancel();if(!r.ok)throw new Error('room bridge unavailable');}).catch(()=>{if(Date.now()-lastWarning>30000){lastWarning=Date.now();ctx.logger?.warn?.('3D room bridge is offline; Agent execution continues.');}}).finally(()=>pending--);
  }
  ctx.on('session/event',(session,event)=>{
    if(closed||!session?.id||!event?.type)return;
    if(typeof session.firstLiveSeq==='number'&&event.seq<session.firstLiveSeq)return;
    if(!selected)selected=String(session.id);if(String(session.id)!==selected)return;
    const data=event.data||{};
    if(event.type==='turn/start')turns.set(selected,data.turn);
    const turn=data.turn??turns.get(selected);if(turn===undefined)return;
    const runId=selected+':'+turn;
    if(event.type==='turn/start')post({runId,type:'message_received'});
    else if(event.type==='step/start')post({runId,type:'response_started'});
    else if(event.type==='tool/call'){calls.set(data.callId,data.name);post({runId,type:'tool_started',tool:data.name});}
    else if(event.type==='tool/result'){const callId=data.message?.toolCallId??data.message?.tool_call_id;const tool=calls.get(callId);if(tool){post({runId,type:'tool_completed',tool});calls.delete(callId);}}
    else if(event.type==='assistant/message'){const text=publicText(data.message);if(text)messages.set(runId,text.slice(0,1600));}
    else if(event.type==='turn/end'){
      const kind=data.reason?.kind;
      post({runId,type:kind==='completed'?'reply_complete':kind==='aborted'||kind==='blocked'?'run_cancelled':'run_failed',...(kind==='completed'?{text:messages.get(runId)||''}:{})});messages.delete(runId);calls.clear();
    }
  });
  ctx.effect?.(()=>()=>{closed=true;calls.clear();messages.clear();turns.clear();});
  return {flush:()=>tail};
}
export function apply(ctx,config={}){createObserver(ctx,config);}
