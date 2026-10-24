'use strict';
function createSchedulingTaskFunctions({api}){
 return async request=>{
  const url=new URL(request.url),root='/api/v1/scheduling-tasks';
  const match=new RegExp('^'+root+'/([^/]+)/review$').exec(url.pathname);
  if(url.pathname!==root&&!match)return {status:404,jsonBody:{error:{code:'NOT_FOUND',message:'Route not found.'}}};
  const method=match?'POST':'GET';
  if(request.method!==method)return {status:405,headers:{Allow:method},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:method+' required.'}}};
  const keys=['academicYear','start','end','undated','facultyKey','courseCode','type','reviewStatus','cursor','limit'];
  if([...url.searchParams.keys()].some(key=>match||!keys.includes(key)||url.searchParams.getAll(key).length!==1))return {status:400,jsonBody:{error:{code:'INVALID_QUERY',message:'The query contains invalid or duplicate fields.'}}};
  let body;
  if(match){try{body=await request.json();}catch(_){return {status:400,jsonBody:{error:{code:'INVALID_JSON',message:'Valid JSON is required.'}}};}}
  const authorization=request.headers?.get?.('authorization')||'',token=/^Bearer /i.test(authorization)?authorization.slice(7):'';
  try{
   const result=match?await api.review(token,match[1],body):await api.list(token,Object.fromEntries(url.searchParams));
   return {status:result.status,jsonBody:result.body};
  }catch(_){return {status:503,jsonBody:{error:{code:'SERVICE_UNAVAILABLE',message:'The scheduling service is temporarily unavailable.'}}};}
 };
}
module.exports={createSchedulingTaskFunctions};
