'use strict';
function createSwapFunctions({api}){return async request=>{
  const url=new URL(request.url),path=url.pathname.replace(/\/+$/,''),prefix='/api/v1/swaps';
  const header=request.headers?.get?.('authorization')||'',token=/^Bearer /i.test(header)?header.slice(7):'';
  const reply=r=>({status:r.status,jsonBody:r.body});
  const match=new RegExp(`^${prefix}/([^/]+)(?:/(decisions|withdraw))?$`).exec(path);
  let method,args,verb='GET';
  if(path===`${prefix}/capabilities`){method='capabilities';args=[];}
  else if(path===`${prefix}/faculty-preview`){
    const keys=[...url.searchParams.keys()];
    if(new Set(keys).size!==keys.length||keys.some(key=>!['sessionId','assignmentId','candidateKey','snapshotToken'].includes(key))||url.search.length>1024)return {status:400,jsonBody:{error:{code:'INVALID_PREVIEW',message:'Unsupported preview query.'}}};
    method='facultyPreview';args=[Object.fromEntries(url.searchParams)];
  }
  else if(path===`${prefix}/context`){method='context';args=[{sessionId:url.searchParams.get('sessionId')}];}
  else if(path===`${prefix}/queue`){method='queue';args=[];}
  else if(path===prefix){method='create';verb='POST';args=[];}
  else if(match){args=[match[1]];method=match[2]==='decisions'?'decide':match[2]==='withdraw'?'withdraw':request.method==='PUT'?'revise':'detail';verb=match[2]?'POST':method==='revise'?'PUT':'GET';}
  else return {status:404,jsonBody:{error:{code:'NOT_FOUND',message:'Route not found.'}}};
  if(request.method!==verb)return {status:405,headers:{Allow:verb},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:`${verb} required.`}}};
  if(verb!=='GET'){try{args.push(await request.json());}catch(_){return {status:400,jsonBody:{error:{code:'INVALID_JSON',message:'Invalid JSON.'}}};}}
  try{return reply(await api[method](token,...args));}catch(_){return {status:503,jsonBody:{error:{code:'SERVICE_UNAVAILABLE',message:'The SWAP service is unavailable.'}}};}
};}
module.exports={createSwapFunctions};
