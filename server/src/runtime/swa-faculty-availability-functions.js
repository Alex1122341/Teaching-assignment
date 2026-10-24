'use strict';
function createFacultyAvailabilityFunctions({api}={}){
 return async request=>{
  const url=new URL(request.url);
  const match=/^\/api\/v1\/faculty\/([^/]+)\/availability$/.exec(url.pathname);
  if(!match)return {status:404,jsonBody:{error:{code:'NOT_FOUND',message:'Route not found.'}}};
  if(request.method!=='GET')return {status:405,headers:{Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
  if([...url.searchParams.keys()].some(k=>!['mode','startDate','endDate','kind','cursor','limit'].includes(k)||url.searchParams.getAll(k).length!==1))
   return {status:400,jsonBody:{error:{code:'INVALID_QUERY',message:'Invalid availability filters.'}}};
  const header=request.headers?.get?.('authorization')||'',token=/^Bearer /i.test(header)?header.slice(7):'';
  try{
   const result=await api.list(token,match[1],Object.fromEntries(url.searchParams));
   return {status:result.status,jsonBody:result.body};
  }catch(_){return {status:503,jsonBody:{error:{code:'SERVICE_UNAVAILABLE',message:'Availability cannot be verified.'}}};}
 };
}
module.exports={createFacultyAvailabilityFunctions};
