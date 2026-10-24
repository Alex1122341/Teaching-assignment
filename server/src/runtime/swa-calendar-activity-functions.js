'use strict';
function createCalendarActivityFunctions({api}){return async request=>{
 const url=new URL(request.url),path=url.pathname,root='/api/v1/calendar-activities',imports='/api/v1/calendar-activity-imports';
 let method,args=[],verb='GET';
 if(path===root){method='list';args=[Object.fromEntries(url.searchParams)];}
 else if(path===root+'/capabilities')method='capabilities';
 else if(path===imports){method='stage';verb='POST';}
 else{
  const imported=new RegExp('^'+imports+'/([^/]+)(?:/(preview|commit))?$').exec(path),timed=new RegExp('^'+root+'/([^/]+)/time-evidence$').exec(path);
  if(imported){method=imported[2]||'getImport';args=[imported[1]];if(imported[2])verb='POST';}
  else if(timed){method='resolveTime';verb='POST';args=[timed[1]];}
  else return {status:404,jsonBody:{error:{code:'NOT_FOUND',message:'Route not found.'}}};
 }
 if(request.method!==verb)return {status:405,headers:{Allow:verb},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:verb+' required.'}}};
 const allowed=method==='list'?new Set(['start','end','facultyKey','category','cursor','limit','includeFacultyKeys']):new Set();
 if([...url.searchParams.keys()].some(key=>!allowed.has(key)||url.searchParams.getAll(key).length!==1))return {status:400,jsonBody:{error:{code:'INVALID_QUERY',message:'The query contains unsupported or duplicate fields.'}}};
 if(verb==='POST'){try{args.push(await request.json());}catch(_){return {status:400,jsonBody:{error:{code:'INVALID_JSON',message:'Valid JSON is required.'}}};}}
 const authorization=request.headers?.get?.('authorization')||'',token=/^Bearer /i.test(authorization)?authorization.slice(7):'';
 try{const result=await api[method](token,...args);return {status:result.status,jsonBody:result.body};}
 catch(_){return {status:503,jsonBody:{error:{code:'SERVICE_UNAVAILABLE',message:'The Calendar activity service is temporarily unavailable.'}}};}
};}
module.exports={createCalendarActivityFunctions};
