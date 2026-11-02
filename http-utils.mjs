import http from 'node:http';
import https from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import {completionUrl} from './src/protocol.js';

export class HttpError extends Error{
  constructor(status,message){super(message);this.status=status;}
}
export const BODY_LIMIT=1_200_000;
export async function readJsonBody(req,limit=BODY_LIMIT){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'请求需要 application/json。');
  if(Number(req.headers['content-length'])>limit)throw new HttpError(413,'请求内容过长。');
  const chunks=[];let size=0;
  for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size<=limit)chunks.push(chunk);}
  if(size>limit)throw new HttpError(413,'请求内容过长。');
  try{
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))||'{}');
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;
  }catch{throw new HttpError(400,'请求需要有效的 UTF-8 JSON 对象。');}
}
export function requestOrigin(req){
  let url;try{url=new URL('http://'+req.headers.host);}catch{throw new HttpError(403,'请求主机无效。');}
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.port!==String(req.socket.localPort)||url.username||url.password||url.pathname!=='/')throw new HttpError(403,'仅接受当前本地房间地址。');
  return url.origin;
}
export function checkOrigin(req,{required=false}={}){
  const expected=requestOrigin(req),origin=req.headers.origin;
  if((required&&!origin)||(origin&&origin!==expected)||req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'仅接受当前房间页面的同源请求。');
}
export function isPublicAddress(address){
  const family=isIP(address);
  if(family===4){
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
  }
  if(family===6){const canonical=new URL('http://['+address+']/').hostname.slice(1,-1);return /^[23][0-9a-f]{3}:/i.test(canonical)&&!/^2001:(?:0:|db8:|10:|20:)|^2002:/i.test(canonical);}
  return false;
}
function trustedFakeIpHosts(){
  // Fake-IP DNS used by local TUN proxies commonly maps public hostnames into
  // 198.18.0.0/15. Permit that mapping only for exact, trusted HTTPS hosts;
  // never reclassify the reserved range as public or accept it as a URL IP.
  return ['api.deepseek.com',...(process.env.ROOM_MODEL_FAKE_IP_HOSTS||'').split(/[\s,]+/)]
    .map(host=>host.toLowerCase().replace(/\.$/,''))
    .filter(host=>host.includes('.')&&!isIP(host)&&/^[a-z0-9.-]+$/.test(host));
}
function isProxyFakeIp(address){
  if(isIP(address)!==4)return false;
  const [a,b]=address.split('.').map(Number);return a===198&&(b===18||b===19);
}
export async function resolveEndpoint(base,{lookup=dnsLookup,signal,fakeIpHosts=trustedFakeIpHosts()}={}){
  const url=new URL(completionUrl(base)),hostname=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
  if(['localhost','127.0.0.1','::1'].includes(hostname))return {url,address:hostname==='::1'?'::1':'127.0.0.1',family:hostname==='::1'?6:4};
  if(url.protocol!=='https:')throw new HttpError(400,'远程模型需要 HTTPS；HTTP 仅支持本机 localhost、127.0.0.1 或 ::1。');
  if(isIP(hostname)){
    if(!isPublicAddress(hostname))throw new HttpError(400,'模型地址不能指向内网、链路本地或保留地址。');
    return {url,address:hostname,family:isIP(hostname)};
  }
  if(!hostname.includes('.')||/\.(?:local|localhost|internal|lan)$/.test(hostname))throw new HttpError(400,'请使用本机回环地址或公网 HTTPS 域名。');
  signal?.throwIfAborted();let timer,onAbort;
  try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new HttpError(400,'模型域名解析超时。')),5000);timer.unref?.();});
    const aborted=new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal?.addEventListener('abort',onAbort,{once:true});});
    const answers=await Promise.race([lookup(hostname,{all:true,verbatim:true}),timeout,aborted]);
    const proxyHost=fakeIpHosts.includes(hostname);
    if(!answers.length||answers.some(a=>!isPublicAddress(a.address)&&!(proxyHost&&isProxyFakeIp(a.address))))throw new HttpError(400,'模型域名解析到了内网或保留地址。');
    return {url,...(answers.find(a=>a.family===4)||answers[0])};
  }catch(e){if(e.status||signal?.aborted)throw e;throw new HttpError(400,'模型接口域名无法解析。');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
// Resolve once per request, validate every answer, and pin the connection to a
// checked IP. Preserve the URL hostname for Host, TLS SNI and certificate checks.
export async function safeModelFetch(base,options={}){
  const target=await resolveEndpoint(base,{signal:options.signal});
  return new Promise((resolve,reject)=>{
    const request=(target.url.protocol==='https:'?https:http).request(target.url,{
      method:options.method||'GET',headers:{...options.headers,'Accept-Encoding':'identity'},signal:options.signal,agent:false,
      lookup:(_host,opts,callback)=>opts.all?callback(null,[{address:target.address,family:target.family}]):callback(null,target.address,target.family)
    },response=>{
      if(response.statusCode>=300&&response.statusCode<400){response.resume();reject(new HttpError(502,'模型接口重定向已拒绝，请填写最终接口地址。'));return;}
      const headers=new Headers();for(const [key,value]of Object.entries(response.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
      resolve(new Response(response.statusCode===204?null:Readable.toWeb(response),{status:response.statusCode,headers}));
    });
    request.on('error',reject);request.end(options.body);
  });
}
