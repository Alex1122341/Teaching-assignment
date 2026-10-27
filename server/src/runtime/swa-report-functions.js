'use strict';
const PREFIX='/api/v1/reports/';
function uniqueJson(raw){
 const result=JSON.parse(raw),stack=[];
 for(const [token] of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\],]/g)){
  if(token==='{')stack.push({keys:new Set(),key:true});else if(token==='[')stack.push(null);
  else if(token==='}'||token===']')stack.pop();else if(token===','){if(stack.at(-1))stack.at(-1).key=true;}
  else if(stack.at(-1)?.key){const frame=stack.at(-1),key=JSON.parse(token);if(frame.keys.has(key))throw Error('Duplicate JSON key');frame.keys.add(key);frame.key=false;}
 }
 return result;
}
function createReportFunctions({api}){
 return async request=>{
  const headers={'Cache-Control':'private, no-store'},error=(status,code,message)=>({status,headers,jsonBody:{error:{code,message}}});
  try{
   const url=new URL(request.url),name=url.pathname.startsWith(PREFIX)?url.pathname.slice(PREFIX.length):'';
   if(!['catalog','query','page','export'].includes(name))return error(404,'NOT_FOUND','Report route not found.');
   const method=name==='query'?'POST':'GET';if(request.method!==method)return {...error(405,'METHOD_NOT_ALLOWED',method+' required.'),headers:{...headers,Allow:method}};
   const allowed=name==='page'?['snapshot','source','offset']:name==='export'?['snapshot','format','source']:[];
   for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)return error(400,'INVALID_REPORT_QUERY','Unsupported report parameters.');
   const authorization=request.headers?.get?.('authorization'),token=authorization&&/^Bearer /i.test(authorization)?authorization.slice(7):'';
   let input=Object.fromEntries(url.searchParams);
   if(name==='query'){
    if(String(request.headers?.get?.('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')return error(415,'JSON_REQUIRED','JSON is required.');
    try{
     if(typeof request.text!=='function')return error(400,'INVALID_REPORT_QUERY','Raw report JSON is required.');
     const text=await request.text();if(Buffer.byteLength(text)>65536)return error(413,'REPORT_LIMIT','The report definition is too large.');input=uniqueJson(text);
    }catch(_){return error(400,'INVALID_REPORT_QUERY','Invalid report JSON.');}
   }
   const response=name==='catalog'?await api.catalog(token):await api[name](token,input);
   return {status:response.status,headers,jsonBody:response.body};
  }catch(_){return error(503,'REPORT_UNAVAILABLE','Reports are temporarily unavailable. Retry shortly.');}
 };
}
module.exports={createReportFunctions};
