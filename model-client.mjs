import {completionUrl,completionText,parsePlan,PlanFormatError,PLAN_SCHEMA,SYSTEM_PROMPT} from './src/protocol.js';
import {HttpError} from './http-utils.mjs';

const formats=['json_schema','json_object','prompt'];
const correction='上次未生成完整有效的单步动作。请保留原目标，只返回一个符合系统格式的 JSON 对象；不要输出思考过程、Markdown 或多个动作。';
function unsupportedFormat(status,data){
  if(![400,422].includes(status))return false;
  const detail=JSON.stringify(data).slice(0,12000);
  return /response_format|json_schema|json_object|structured.{0,12}(?:output|response)|response.{0,8}format/i.test(detail);
}
function planningEffort(config,url){
  const setting=config.reasoningEffort||'auto';
  if(setting==='default')return undefined;
  if(setting!=='auto'){
    if(!['none','minimal','low','medium','high','xhigh','max'].includes(setting))throw new Error('AGENT_REASONING_EFFORT 设置无效。');
    return setting;
  }
  // The room asks for one small action, not an extended reasoning task. The
  // local Qwen hybrid models expose this through LM Studio's request field.
  const local=['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
  return local&&/qwen[\s_-]*3(?:[.\s_-]|$)/i.test(config.model)&&!/thinking/i.test(config.model)?'none':undefined;
}
async function readJson(response){
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('模型接口响应过长。');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('模型接口返回的响应无法读取。');}
}
export class ModelPlanner{
  constructor({fetch:fetcher=globalThis.fetch}={}){this.fetch=fetcher;this.support=new Map();}
  async infer(config,payload,signal){
    if(!config.baseUrl||!config.model)throw new Error('请先填写接口地址和模型名称。');
    const url=completionUrl(config.baseUrl),key=url+'\n'+config.model;
    const known=this.support.get(key);let mode=known?.mode||formats[0],repaired=false,budget=2048,effortUnsupported=known?.effortUnsupported||false;
    let effort=effortUnsupported?undefined:planningEffort(config,url);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),65000);
    const interrupted=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',interrupted,{once:true});
    try{
      // Up to three parameter negotiations plus one format correction. No action
      // reaches the executor until the returned object passes validation.
      for(let attempt=0;attempt<5;attempt++){
        controller.signal.throwIfAborted();
        const input={goal:String(payload.goal??'').slice(0,1200),observation:payload.observation,history:Array.isArray(payload.history)?payload.history.slice(-10):[],...(repaired?{formatCorrection:correction}:{})};
        const text=JSON.stringify(input),content=config.vision&&typeof payload.image==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(payload.image)?[{type:'text',text},{type:'image_url',image_url:{url:payload.image,detail:'low'}}]:text;
        const response=await this.fetch(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',...(config.apiKey?{Authorization:'Bearer '+config.apiKey}:{})},
          body:JSON.stringify({model:config.model,messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content}],temperature:.65,max_tokens:budget,stream:false,...(effort===undefined?{}:{reasoning_effort:effort}),
            ...(mode==='json_schema'?{response_format:{type:mode,json_schema:{name:'room_action',strict:true,schema:PLAN_SCHEMA}}}:mode==='json_object'?{response_format:{type:mode}}:{})})});
        const data=await readJson(response);
        if(!response.ok){
          if(effort!==undefined&&[400,422].includes(response.status)&&/reasoning_effort/i.test(JSON.stringify(data).slice(0,12000))){effort=undefined;effortUnsupported=true;continue;}
          if(unsupportedFormat(response.status,data)&&mode!=='prompt'){mode=formats[formats.indexOf(mode)+1];continue;}
          throw new Error(`接口返回 HTTP ${response.status}，请检查地址、模型名和密钥。`);
        }
        if(this.support.size>=32&&!this.support.has(key))this.support.delete(this.support.keys().next().value);this.support.set(key,{mode,effortUnsupported});
        const choice=data.choices?.[0],message=choice?.message||{};
        if(message.refusal||choice?.finish_reason==='content_filter')throw new Error('模型拒绝了本次请求，未执行动作。');
        try{
          if(choice?.finish_reason==='length')throw new PlanFormatError('模型输出达到长度上限，尚未返回完整动作。','truncated');
          if(!completionText(message.content).trim()&&(message.reasoning_content||message.reasoning))throw new PlanFormatError('模型只返回了思考内容，没有最终动作。','reasoning_only');
          return parsePlan(message.content);
        }catch(error){
          if(!(error instanceof PlanFormatError))throw error;
          if(repaired)throw new Error(error.message+' 已尝试一次格式纠正，本次活动已停止。');
          repaired=true;if(['truncated','reasoning_only'].includes(error.code))budget=4096;
          // Never resend or display private reasoning, provider bodies or
          // unvalidated action text as a fabricated successful result.
        }
      }
      throw new Error('模型接口未能返回有效动作，已停止本次活动。');
    }catch(error){
      if(controller.signal.aborted)throw new HttpError(signal?.aborted?499:504,signal?.aborted?'已中断模型请求。':'模型响应超时，请检查本地服务或降低模型思考长度。');
      if(error.status)throw error;
      if(error instanceof TypeError||/^(?:ECONN|ENOTFOUND|EHOST|ENET|ETIMEDOUT)/.test(error.code||''))throw new HttpError(502,'无法访问模型接口，请检查本地服务或网络。');
      throw new HttpError(502,error.message);
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',interrupted);}
  }
}
