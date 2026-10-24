'use strict';
const READ_HEADERS=Object.freeze({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
function createCccScheduleFunctions({api}={}){
 if(typeof api?.list!=='function')throw Error('CCC API required.');
 return async request=>{
  const url=new URL(request.url);
  if(url.pathname!=='/api/v1/ccc-schedule')return {status:404,headers:READ_HEADERS,jsonBody:{error:{code:'NOT_FOUND',message:'Route not found.'}}};
  if(request.method!=='GET')return {status:405,headers:{...READ_HEADERS,Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
  if([...url.searchParams.keys()].some(key=>key!=='academicYear'||url.searchParams.getAll(key).length!==1)
    ||!url.searchParams.has('academicYear'))return {status:400,headers:READ_HEADERS,jsonBody:{error:{code:'INVALID_QUERY',message:'Invalid CCC schedule filters.'}}};
  const header=request.headers?.get?.('authorization')||'';
  const token=/^Bearer /i.test(header)?header.slice(7):'';
  try{
   const response=await api.list(token,{academicYear:url.searchParams.get('academicYear')});
   return {status:response.status,headers:READ_HEADERS,jsonBody:response.body};
  }catch(_){return {status:503,headers:READ_HEADERS,jsonBody:{error:{code:'SERVICE_UNAVAILABLE',message:'CCC schedule is temporarily unavailable.'}}};}
 };
}
module.exports={createCccScheduleFunctions};
