// Browser POSTs carry Origin automatically; native HTTP fixtures must state it.
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.pathname.startsWith('/api/')&&!['GET','HEAD'].includes(options.method||'GET')){
    const headers=new Headers(options.headers);if(!headers.has('Origin'))headers.set('Origin',url.origin);options={...options,headers};
  }
  return nativeFetch(input,options);
};
