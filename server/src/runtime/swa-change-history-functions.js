'use strict';

function createChangeHistoryFunctions({api}){
 return async request=>{
  const url=new URL(request.url),root='/api/v1/change-history';
  const method=url.pathname===root?'query':url.pathname===root+'/page'?'page':url.pathname===root+'/export'?'export':null;
  const error=(status,code,message)=>({status,jsonBody:{error:{code,message}}});
  if(!method)return error(404,'NOT_FOUND','Route not found.');
  if(request.method!=='GET')return {...error(405,'METHOD_NOT_ALLOWED','GET required.'),headers:{Allow:'GET'}};
  const allowed=new Set(method==='query'?['scope','start','end','course','topic','viscSubject','faculty','changeType','academicYear','domain','keyword']:method==='page'?['snapshot','offset']:['snapshot','format']);
  if([...url.searchParams.keys()].some(key=>!allowed.has(key)||url.searchParams.getAll(key).length!==1))return error(400,'INVALID_HISTORY_QUERY','The query contains unsupported or duplicate fields.');
  const header=request.headers?.get?.('authorization')||'',token=/^Bearer /i.test(header)?header.slice(7):'';
  try{
   const result=await api[method](token,Object.fromEntries(url.searchParams));
   return {status:result.status,jsonBody:result.body,headers:{'Cache-Control':'private, no-store'}};
  }catch(_){return error(503,'HISTORY_UNAVAILABLE','History is temporarily unavailable. Please retry.');}
 };
}
module.exports={createChangeHistoryFunctions};
