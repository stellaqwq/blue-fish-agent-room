import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadWorld} from './world.js';
import {loadAvatar} from './avatar.js';
import {RoomAgent} from './agent.js';
import {ActivityDirector} from './director.js';
import {setupBridge} from './bridge-client.js';
import {FrameGuard} from './frame-guard.js';
import './style.css';

const $=s=>document.querySelector(s),stage=$('#stage');
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.03,80),eye=new THREE.PerspectiveCamera(73,16/9,.035,30);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.domElement.className='world-canvas';stage.prepend(renderer.domElement);
const eyeRenderer=new THREE.WebGLRenderer({canvas:$('#eye-view'),antialias:false,preserveDrawingBuffer:true});
eyeRenderer.setPixelRatio(1);eyeRenderer.setSize(320,180,false);eyeRenderer.toneMapping=THREE.ACESFilmicToneMapping;eyeRenderer.toneMappingExposure=.95;
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=1.5;controls.maxDistance=14;controls.minPolarAngle=.12;controls.maxPolarAngle=1.48;controls.target.set(-.2,.95,-.05);camera.position.set(-4.8,5.5,7.2);controls.update();
let cameraMode='room',world,avatar,agent,director,bridge,config={},ready=false,last=performance.now(),previewTime=0,frameCount=0,frameTime=0,visible=true;
const frameGuard=new FrameGuard(),frameMetrics={callbacks:0,rendered:0};
function frameBedCamera(){const narrow=stage.clientWidth/stage.clientHeight<.9;camera.position.set(...(narrow?[-2.2,3.9,6.8]:[-3.25,2.7,3.2]));controls.target.set(...(narrow?[-.2,1,-.4]:[-.9,1.05,-.55]));controls.update();}
const resize=()=>{const w=stage.clientWidth,h=stage.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);if(cameraMode==='bed')frameBedCamera();};new ResizeObserver(resize).observe(stage);resize();
const home=()=>{cameraMode='room';controls.enabled=true;camera.position.set(-4.8,5.5,7.2);controls.target.set(-.2,.95,-.05);controls.update();document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.camera==='room')));$('#camera-hint').textContent='拖动旋转 · 滚轮缩放 · 双击地面走过去';};
function setCamera(mode){cameraMode=mode;controls.enabled=mode==='room'||mode==='bed';document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.camera===mode)));$('#camera-hint').textContent=mode==='room'||mode==='bed'?'拖动旋转 · 滚轮缩放 · 双击地面走过去':mode==='first'?'拖动画面转身 · 跟随角色头部的虚拟视角':'镜头跟随小肥鱼';if(mode==='bed')frameBedCamera();if(mode==='first'&&agent&&!director?.controlled&&!agent.current&&!agent.busy&&!agent.goal){agent.direct([{type:'look',target:'desk',duration:2}],'看看房间里。');syncPause();}}
document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera)));$('#home-camera').onclick=home;
const stateNames={idle:'在房间里休息',move:'正在走动',look:'正在观察',wave:'在向你挥手',point:'正在指向目标',lamp:'操作台灯',jump:'正在跳跃',wait:'安静待一会儿',lie:'准备侧躺休息',stand:'正在起身',phone:'正在拿放手机',sit:'坐到电脑旁',thinking:'正在决定下一步',error:'行动已停止'};
function modeText(){if(!agent)return;const text=bridge?.source==='qq'?'QQ Agent 联动':bridge?.source==='external'?'Harness 事件联动':agent.mode==='offline-auto'?'离线规则漫游':agent.mode==='llm-auto'?'模型自主活动':agent.mode==='llm'?'模型执行指令':director?.controlled?'床上姿势预览':'手动控制';if($('#mode').textContent!==text)$('#mode').textContent=text;}
function log({text,kind,time}){const li=document.createElement('li');li.dataset.kind=kind;const t=document.createElement('time');t.textContent=time;li.append(t,document.createTextNode(text));$('#log').append(li);while($('#log').children.length>45)$('#log').firstChild.remove();$('#log').scrollTop=$('#log').scrollHeight;}
function syncPause(){const p=agent?.paused;$('#pause').textContent=p?'继续':'暂停';$('#pause').setAttribute('aria-pressed',String(Boolean(p)));}
function syncAutonomy(){$('#autonomy').checked=Boolean(agent?.auto);}
function configUi(){if(agent)agent.configured=config.configured;$('#connection-label').textContent=config.configured?'已配置':'未配置';$('#connect-shortcut').textContent=config.configured?'连接设置':'连接模型';$('#auto-description').textContent=config.configured?'由模型决定下一次活动':'未连接时使用离线漫游';$('#command-help').textContent=config.configured?'每做完一步，她会观察结果，再决定下一步。':'连接模型后，可以用一句话安排多个动作。';$('#base-url').value=config.baseUrl||'https://api.deepseek.com/v1';$('#model-name').value=config.model||'';$('#vision').checked=Boolean(config.vision);$('#api-key').placeholder=config.hasKey?'已设置，留空保留原密钥':'本地模型可留空';}
$('#connect-shortcut').onclick=()=>{$('#settings').open=true;$('#settings').scrollIntoView({behavior:'smooth',block:'nearest'});$('#model-name').focus();};
async function saveConfig(){
  if(!$('#config-form').reportValidity())throw new Error('请填写接口地址和模型名称。');
  const apiKey=$('#api-key').value;
  const data={baseUrl:$('#base-url').value,model:$('#model-name').value,vision:$('#vision').checked,...(apiKey||!config.hasKey?{apiKey}:{})};
  const response=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),result=await response.json();if(!response.ok)throw new Error(result.error);
  config=result;$('#api-key').value='';configUi();$('#config-result').dataset.error='false';$('#config-result').textContent='设置已应用。密钥仅保存在本次服务内存中。';return result;
}
$('#config-form').onsubmit=async e=>{e.preventDefault();try{await saveConfig();}catch(err){$('#config-result').dataset.error='true';$('#config-result').textContent=err.message;}};
$('#test-config').onclick=async()=>{
  const b=$('#test-config');b.disabled=true;b.textContent='测试中…';
  try{await saveConfig();const r=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({goal:'仅测试连接：请返回 finish，say 写一句简短问候。不要移动。',observation:agent?.observation()||{},history:[]})}),data=await r.json();if(!r.ok)throw new Error(data.error);$('#config-result').dataset.error='false';$('#config-result').textContent='连接成功，已收到模型的有效动作响应。';$('#connection-label').textContent='连接成功';}
  catch(err){$('#config-result').dataset.error='true';$('#config-result').textContent=err.message;}finally{b.disabled=false;b.textContent='测试连接';}
};
$('#show-nav').onchange=e=>{if(world)world.debug.visible=e.target.checked;};$('#show-perception').onchange=e=>{$('#perception').hidden=!e.target.checked;stage.classList.toggle('no-perception',!e.target.checked);};
$('#clear-log').onclick=()=>$('#log').replaceChildren();$('#reload').onclick=()=>location.reload();

const progress=label=>event=>{if(event.total)$('#loading-text').textContent=`${label} ${Math.round(event.loaded/event.total*100)}%`;};
try{
  [world,avatar,config]=await Promise.all([loadWorld(scene,progress('房间')),loadAvatar(scene,progress('角色')),fetch('/api/config').then(r=>r.json())]);
  world.configureAvatar(avatar.collisionRadius,avatar.envelope.maxY+.07);
  if(!world.nav.free(avatar.root.position))throw new Error('角色初始位置没有足够的通行空间。');
  agent=new RoomAgent(avatar,world);configUi();
  director=new ActivityDirector(agent,world,avatar);
  director.addEventListener('state',e=>{$('#activity').textContent=e.detail;modeText();});
  director.addEventListener('say',e=>{$('#speech-text').textContent=e.detail;});
  director.addEventListener('log',e=>agent.log(e.detail,'system'));
  director.addEventListener('error',e=>{agent.log(e.detail,'error');$('#speech-text').textContent=e.detail;});
  bridge=setupBridge(director,agent);
  const normalAction=fn=>{bridge.close();try{fn();}catch(error){agent.log(error.message,'error');$('#speech-text').textContent=error.message;}};
  document.querySelectorAll('[data-posture]').forEach(b=>b.onclick=()=>{bridge.close();director.completed=false;director.request(b.dataset.posture);syncAutonomy();syncPause();modeText();});
  agent.addEventListener('log',e=>{log(e.detail);modeText();syncAutonomy();});
  agent.addEventListener('say',e=>{$('#speech-text').textContent=e.detail;});
  agent.addEventListener('state',e=>{$('#activity').textContent=stateNames[e.detail]||e.detail;$('#activity-dot').dataset.error=String(e.detail==='error');modeText();});
  agent.addEventListener('error',e=>{$('#speech-text').textContent=e.detail;syncAutonomy();});
  agent.addEventListener('model-success',()=>{$('#connection-label').textContent='连接成功';});
  agent.capture=()=>config.vision?capture():undefined;
  const actions={window:[{type:'move',target:'window'},{type:'look',target:'window',duration:3}],desk:[{type:'move',target:'desk'},{type:'look',target:'desk',duration:3}],bed:[{type:'move',target:'bed'},{type:'look',target:'bed',duration:3}],user:[{type:'look',target:'user',duration:2}],wave:[{type:'look',target:'user',duration:.7},{type:'wave',duration:3}]};
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{normalAction(()=>{const type=b.dataset.action;const sequence=type==='jump'?[{type:'jump',target:agent.support==='bed'?'floor':'bed'}]:type==='lamp'?[{type:'move',target:'lamp'},{type:'lamp',enabled:!world.lampOn},{type:'look',target:'lamp',duration:2}]:actions[type];agent.direct(sequence,b.textContent);syncPause();});});
  $('#pause').onclick=()=>{agent.paused=!agent.paused;syncPause();$('#activity').textContent=agent.paused?'已暂停':stateNames[agent.current?.type||'idle'];if(!agent.paused&&!agent.current){if(agent.queue.length)agent.startNext();else if(agent.goal&&!agent.busy)agent.think();}};
  $('#stop').onclick=()=>{normalAction(()=>{agent.auto=false;agent.stop();agent.paused=false;syncPause();syncAutonomy();});};
  $('#reset').onclick=()=>{bridge.close();director.reset();agent.reset();frameGuard.reset();home();syncPause();syncAutonomy();$('#speech-text').textContent='回到原点了。接下来想做点什么？';};
  $('#autonomy').onchange=e=>{const enabled=e.target.checked;normalAction(()=>{agent.auto=enabled;agent.scheduleAuto(1);agent.log(agent.auto?(config.configured?'自主活动已开启，由模型选择目标。':'离线漫游已开启，使用内置规则。'):'自主活动已关闭。','system');syncAutonomy();});};
  $('#command-form').onsubmit=async e=>{
    e.preventDefault();const text=$('#command').value.trim();if(!text)return;
    if(bridge.source==='qq'){try{await bridge.send(text);$('#command').value='';}catch(error){$('#speech-text').textContent=error.message;agent.log(error.message,'error');}return;}
    if(!config.configured){$('#speech-text').textContent='先连接模型，我才能理解和规划这句话。你也可以用上面的按钮测试动作。';$('#settings').open=true;$('#model-name').focus();return;}
    normalAction(()=>agent.runGoal(text));$('#command').value='';syncPause();
  };
  $('#command').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#command-form').requestSubmit();}};
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),floor=new THREE.Plane(new THREE.Vector3(0,1,0),-.025);
  let pointer=null,manualPitch=0;
  renderer.domElement.addEventListener('pointerdown',e=>{if(cameraMode==='first'){pointer={id:e.pointerId,x:e.clientX,y:e.clientY,started:false};renderer.domElement.setPointerCapture(e.pointerId);}});
  renderer.domElement.addEventListener('pointermove',e=>{
    if(!pointer||cameraMode!=='first'||director.controlled)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.x=e.clientX;pointer.y=e.clientY;
    if(!pointer.started&&Math.abs(dx)+Math.abs(dy)>2){agent.auto=false;agent.stop('手动转身，已中断当前行动。');agent.paused=false;pointer.started=true;syncPause();syncAutonomy();}
    if(!pointer.started)return;
    avatar.root.rotation.y-=dx*.008;manualPitch=THREE.MathUtils.clamp(manualPitch+dy*.006,-.65,.45);
    const direction=new THREE.Vector3(Math.sin(avatar.root.rotation.y)*Math.cos(manualPitch),-Math.sin(manualPitch),Math.cos(avatar.root.rotation.y)*Math.cos(manualPitch));avatar.setGaze(avatar.getHead().addScaledVector(direction,4));
  });
  const release=()=>{pointer=null;};renderer.domElement.addEventListener('pointerup',release);renderer.domElement.addEventListener('pointercancel',release);
  renderer.domElement.addEventListener('dblclick',e=>{
    if(cameraMode!=='room'&&cameraMode!=='bed')return;
    const r=renderer.domElement.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(ndc,camera);const point=new THREE.Vector3();if(!ray.ray.intersectPlane(floor,point))return;
    // A floor click is an explicit manual target, never sent to the model.
    try{normalAction(()=>agent.goToPoint(point));syncPause();}catch(err){agent.log(err.message,'error');}
  });
  $('#loading').hidden=true;$('#activity').textContent=stateNames.idle;ready=true;
  agent.log('房间和角色已载入，可以开始动作测试。','system');
  window.roomDemo={agent,world,avatar,director,bridge,camera,controls,scene,frameGuard,frameMetrics,get config(){return {...config};},snapshot:()=>({observation:agent.observation(),paused:agent.paused,auto:agent.auto,mode:agent.mode,support:agent.support,posture:director.stable,phone:world.phone.owner,phoneError:director.phoneError,position:avatar.root.position.toArray(),cameraMode,colliderRadius:world.nav.radius,envelope:avatar.envelope,renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},bones:Object.fromEntries(['hips','head','leftFoot','rightFoot','leftHand','rightHand'].map(n=>[n,avatar.bones[n].getWorldPosition(new THREE.Vector3()).toArray()]))})};
}catch(e){console.error(e);$('#loading-title').textContent='房间还没准备好';$('#loading-text').textContent=e.message;$('.loader').hidden=true;$('#reload').hidden=false;$('#activity').textContent='资源载入失败';}

function updateEye(){
  const head=avatar.getHead(),rotation=avatar.bones.head.getWorldQuaternion(new THREE.Quaternion()),direction=new THREE.Vector3(0,0,1).applyQuaternion(rotation);
  eye.position.copy(head).add(new THREE.Vector3(0,.055,0)).addScaledVector(direction,.08);eye.lookAt(eye.position.clone().add(direction));eye.updateMatrixWorld(true);
}
function renderEye(){const prior=avatar.root.visible,debug=world.debug.visible;try{avatar.root.visible=false;world.debug.visible=false;eyeRenderer.render(scene,eye);}finally{world.debug.visible=debug;avatar.root.visible=prior;}}
function capture(){if(!ready)return undefined;updateEye();renderEye();return $('#eye-view').toDataURL('image/jpeg',.65);}
document.addEventListener('visibilitychange',()=>{visible=!document.hidden;last=performance.now();});
function frame(now){
  requestAnimationFrame(frame);
  if(!visible)return;
  const delta=(now-last)/1000;last=now;const dt=Math.min(delta,.1);
  if(ready){
    frameMetrics.callbacks++;
    frameGuard.run(()=>{
    director.before(dt);agent.update(dt);director.after();avatar.root.updateMatrixWorld(true);updateEye();modeText();
    if(cameraMode==='follow'){
      const p=avatar.root.position,target=p.clone().add(new THREE.Vector3(0,.7,0));camera.position.lerp(p.clone().add(new THREE.Vector3(-1.8,1.8,3)),1-Math.exp(-3*dt));camera.lookAt(target);
    }else if(cameraMode==='room'||cameraMode==='bed')controls.update();
    if(cameraMode==='first'){const prior=avatar.root.visible;avatar.root.visible=false;const aspect=eye.aspect;eye.aspect=camera.aspect;eye.updateProjectionMatrix();renderer.render(scene,eye);eye.aspect=aspect;eye.updateProjectionMatrix();avatar.root.visible=prior;}
    else renderer.render(scene,camera);
    if($('#show-perception').checked&&now-previewTime>200){renderEye();previewTime=now;}
    frameMetrics.rendered++;
    const lampLabel=world.lampOn?'关闭台灯':'打开台灯',jumping=agent.current?.type==='jump',jumpLabel=jumping?'跳跃中…':agent.support==='bed'?'跳下床':'跳上床';
    if($('#lamp-button').textContent!==lampLabel)$('#lamp-button').textContent=lampLabel;
    if($('#jump-button').textContent!==jumpLabel)$('#jump-button').textContent=jumpLabel;
    if($('#jump-button').disabled!==jumping)$('#jump-button').disabled=jumping;
    frameCount++;frameTime+=delta;if(frameTime>2){$('#performance').textContent=`${Math.round(frameCount/frameTime)} FPS · ${Math.round(renderer.info.render.triangles/1000)}k 三角面`;frameCount=0;frameTime=0;}
    },error=>{console.error('房间帧更新已停止：',error);agent.failRuntime(error);syncPause();syncAutonomy();});
  }else renderer.render(scene,camera);
}
requestAnimationFrame(frame);
