import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createRoomServer} from '../server.mjs';
import {resolveEndpoint,isPublicAddress,safeModelFetch,HttpError} from '../http-utils.mjs';
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;};
const close=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
test('HTTP policy, credential scoping, methods and missing-avatar behavior',async()=>{
  const captured=[];const server=createRoomServer({config:{baseUrl:'http://localhost:1235/v1',model:'fixture',apiKey:'fixture-secret'},planner:{infer:async config=>{captured.push(config);return {action:{type:'finish'}};}}});const base=await listen(server);
  const post=(route,data,headers={Origin:base})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  try{
    assert.equal((await post('/api/config',{},{})).status,403);
    assert.equal((await post('/api/config',{}, {Origin:'http://localhost:9999'})).status,403);
    assert.equal(await new Promise((resolve,reject)=>http.get(base+'/api/health',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject)),403);
    assert.equal((await post('/api/health',{})).status,405);
    assert.equal((await(await fetch(base+'/api/health')).json()).avatarFound,false);
    assert.equal((await fetch(base+'/assets/avatar.vrm')).status,404);
    assert.equal((await post('/api/config',{baseUrl:'http://169.254.169.254/latest',model:'fixture'})).status,400);
    assert.equal((await post('/api/config',{baseUrl:'http://localhost:1235/v1/',model:'other'})).status,200);
    await post('/api/plan',{goal:'fixture'});assert.equal(captured.at(-1).apiKey,'fixture-secret');
    assert.equal((await post('/api/config',{baseUrl:'http://127.0.0.1:1236/v1',model:'fixture'})).status,200);
    await post('/api/plan',{goal:'fixture'});assert.equal(captured.at(-1).apiKey,'');
    assert.equal((await(await fetch(base+'/api/config')).text()).includes('fixture-secret'),false);
    assert.equal((await post('/api/bridge/events',{},{})).status,401);
  }finally{await close(server);}
});
test('split Chinese UTF-8 is preserved and byte limits return 413',async()=>{
  const goals=[];const server=createRoomServer({planner:{infer:async(_config,data)=>{goals.push(data.goal);return {action:{type:'finish'}};}}});const base=await listen(server);
  const raw=chunks=>new Promise((resolve,reject)=>{
    let responded=false;const request=http.request(base+'/api/plan',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'}},response=>{responded=true;response.resume();resolve(response.statusCode);});request.on('error',error=>{if(!responded)reject(error);});
    (async()=>{for(const chunk of chunks){request.write(chunk);await new Promise(r=>setTimeout(r,2));}request.end();})().catch(reject);
  });
  try{
    const bytes=Buffer.from(JSON.stringify({goal:'测试鲸鱼🐟'})),index=bytes.indexOf(Buffer.from('测'));
    assert.equal(await raw([bytes.subarray(0,index+1),bytes.subarray(index+1,index+2),bytes.subarray(index+2)]),200);assert.equal(goals[0],'测试鲸鱼🐟');
    assert.equal(await raw([Buffer.from([0x7b,0x22,0x61,0x22,0x3a,0x22,0xff,0x22,0x7d])]),400);
    assert.equal(await raw([Buffer.from('{"goal":"'),Buffer.alloc(1_200_001,97),Buffer.from('"}')]),413);
    assert.equal((await fetch(base+'/api/plan',{method:'POST',headers:{Origin:base,'Content-Type':'text/plain'},body:'{}'})).status,415);
  }finally{await close(server);}
});
test('endpoint policy rejects reserved addresses and private DNS answers, keeping explicit loopback',async()=>{
  for(const host of ['0.0.0.0','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.1.1','224.0.0.1','::','::ffff:169.254.169.254','fd00::1','fe80::1','2001:db8::1'])assert.equal(isPublicAddress(host),false,host);
  for(const host of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(isPublicAddress(host),true,host);
  assert.equal((await resolveEndpoint('http://localhost:1235/v1')).address,'127.0.0.1');
  assert.equal((await resolveEndpoint('http://[::1]:1235/v1')).address,'::1');
  await assert.rejects(resolveEndpoint('https://evil.example/v1',{lookup:async()=>[{address:'127.0.0.1',family:4}]}),/内网/);
  await assert.rejects(resolveEndpoint('https://evil.example/v1',{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'169.254.169.254',family:4}]}),/内网/);
  let calls=0;const result=await resolveEndpoint('https://provider.example/v1',{lookup:async()=>{calls++;return [{address:'8.8.8.8',family:4}];}});assert.equal(calls,1);assert.equal(result.address,'8.8.8.8');assert.equal(result.url.hostname,'provider.example');
});

test('trusted DeepSeek HTTPS supports proxy Fake-IP without opening reserved destinations',async()=>{
  const lookup=async()=>[{address:'198.18.0.187',family:4}];
  const target=await resolveEndpoint('https://api.deepseek.com',{lookup});
  assert.equal(target.address,'198.18.0.187');assert.equal(target.url.hostname,'api.deepseek.com');assert.equal(target.url.protocol,'https:');
  assert.equal(isPublicAddress(target.address),false);
  await assert.rejects(resolveEndpoint('https://untrusted.example/v1',{lookup}),/内网或保留/);
  await assert.rejects(resolveEndpoint('https://api.deepseek.com.attacker.example/v1',{lookup}),/内网或保留/);
  await assert.rejects(resolveEndpoint('https://198.18.0.187/v1'),/内网、链路本地或保留/);
  await assert.rejects(resolveEndpoint('http://api.deepseek.com/v1',{lookup}),/HTTPS/);
  for(const address of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.169.254','::ffff:198.18.0.187']){
    await assert.rejects(resolveEndpoint('https://api.deepseek.com/v1',{lookup:async()=>[{address,family:address.includes(':')?6:4}]}),/内网或保留/);
  }
  await assert.rejects(resolveEndpoint('https://api.deepseek.com/v1',{lookup:async()=>[{address:'198.18.0.187',family:4},{address:'169.254.169.254',family:4}]}),/内网或保留/);
  assert.equal((await resolveEndpoint('https://custom.example/v1',{lookup,fakeIpHosts:['custom.example']})).address,'198.18.0.187');
  await assert.rejects(resolveEndpoint('https://api.deepseek.com/v1',{lookup,fakeIpHosts:[]}),/内网或保留/);
});
test('safe HTTP transport preserves JSON, refuses redirects and classifies upstream failures',async()=>{
  const upstream=http.createServer((req,res)=>{if(req.url.includes('redirect')){res.writeHead(302,{Location:'http://169.254.169.254'});res.end();}else{res.setHeader('Content-Type','application/json');res.end('{"ok":true}');}});const base=await listen(upstream);
  const server=createRoomServer({planner:{infer:async()=>{throw new HttpError(504,'fixture timeout');}}});const room=await listen(server);
  try{
    assert.deepEqual(await(await safeModelFetch(base+'/v1',{method:'POST',body:'{}'})).json(),{ok:true});
    await assert.rejects(safeModelFetch(base+'/redirect'),/重定向/);
    assert.equal((await fetch(room+'/api/plan',{method:'POST',headers:{Origin:room,'Content-Type':'application/json'},body:'{}'})).status,504);
  }finally{await close(upstream);await close(server);}
});
