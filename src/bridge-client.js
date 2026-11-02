export function setupBridge(director,agent,onSay){
  const $=s=>document.querySelector(s);let stream=null,source='manual',session='',connected=false,generation=0;
  const label=text=>$('#bridge-state').textContent=text;
  const manualHelp=$('#command-help').textContent;
  function close(){generation++;stream?.close();stream=null;connected=false;source='manual';agent.external=null;$('#bridge-source').value='manual';label('未联动，可以预览姿势。');$('#command').disabled=false;$('#send').disabled=false;$('#command-help').textContent=manualHelp;}
  async function connect(){
    stream?.close();stream=null;const revision=++generation;connected=false;const selected=$('#bridge-source').value;if(selected==='manual'){close();return;}
    session=$('#bridge-session').value.trim()||(selected==='qq'?crypto.randomUUID():'deepseek-room');
    $('#bridge-session').value=session;source=selected;director.baselined=false;director.signature='';director.activeRun=null;label('正在连接 Agent…');
    try{
      if(source==='qq'){
        const r=await fetch('/api/bridge/qq/state?session='+encodeURIComponent(session)),data=await r.json();if(revision!==generation)return;if(!r.ok)throw new Error(data.error||'QQ Agent 未连接。');director.snapshot(data);
      }else agent.direct([{type:'lie'}],'等待 harness 事件。',{source:'external'});
      stream=new EventSource('/api/bridge/stream?source='+source+'&session='+encodeURIComponent(session));
      stream.onopen=()=>{if(revision!==generation)return;connected=true;label(source==='qq'?'已联动 QQ Agent 当前会话':'等待 harness 事件 · '+session);};
      stream.onmessage=e=>{if(revision!==generation)return;try{director.snapshot(JSON.parse(e.data));connected=true;label(source==='qq'?'已联动 QQ Agent 当前会话':'已接收 harness 状态 · '+session);}catch{label('收到的状态无法读取。');}};
      stream.onerror=()=>{if(revision!==generation)return;connected=false;label('连接中断，正在重连。');director.disconnected();};
      $('#autonomy').checked=false;agent.auto=false;$('#command').disabled=source==='external';$('#send').disabled=source==='external';
      $('#command-help').textContent=source==='qq'?'消息交给 QQ Agent 处理，房间跟随真实任务状态。':'在 harness 中发起任务，房间跟随接收的事件。';
      try{localStorage.setItem('room-bridge-session',session);}catch{}
    }catch(e){if(revision!==generation)return;close();label(e.message);}
  }
  $('#bridge-form').onsubmit=e=>{e.preventDefault();void connect();};
  $('#bridge-disconnect').onclick=()=>{close();agent.direct([{type:'stand'}],'结束联动，安全起身。');};
  const query=new URLSearchParams(location.search);
  if(['qq','external'].includes(query.get('source'))){$('#bridge-source').value=query.get('source');$('#bridge-session').value=query.get('session')||'';void connect();}
  return {get source(){return source;},get connected(){return connected;},close,async send(text){
    if(source!=='qq')return false;
    const r=await fetch('/api/bridge/qq/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,text})}),data=await r.json();
    if(!r.ok)throw new Error(data.error||'消息提交失败。');label('已提交到 QQ Agent，等待处理。');return true;
  }};
}
