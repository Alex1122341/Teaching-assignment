'use strict';
const {UUID}=require('../swap/swap-domain');
const { backendFailure } = require('../http/backend-error');
const bad=(status,code)=>({status,jsonBody:{error:{code,message:'Invalid CCC replacement request.'}}});
const json=r=>({status:r.status,jsonBody:r.body});
function createCccReplacementFunctions({api}){
 return async request=>{
  try{
   const url=new URL(request.url),path=url.pathname,token=(request.headers.get('authorization')||'').replace(/^Bearer /i,'');
   if(url.search)return bad(400,'INVALID_REQUEST');
   if(path==='/api/v1/ccc-replacements/capabilities')return request.method==='GET'?json(await api.capabilities(token)):bad(405,'METHOD_NOT_ALLOWED');
   if(path==='/api/v1/ccc-replacements/template')return request.method==='GET'?json(await api.template(token)):bad(405,'METHOD_NOT_ALLOWED');
   const match=/^\/api\/v1\/ccc-replacements\/([^/]+)(?:\/(preview|commit))?$/.exec(path);
   if(path!=='/api/v1/ccc-replacements'&&(!match||!UUID.test(match[1])))return bad(404,'NOT_FOUND');
   const method=path==='/api/v1/ccc-replacements'?'stage':match[2]||'get';
   if(request.method!==(method==='get'?'GET':'POST'))return bad(405,'METHOD_NOT_ALLOWED');
   if(method==='get')return json(await api.get(token,match[1]));
   let payload;try{payload=await request.json();}catch(_){return bad(400,'INVALID_JSON');}
   return json(await (method==='stage'?api.stage(token,payload):api[method](token,match[1],payload)));
  }catch(caught){return bad(503,'SERVICE_UNAVAILABLE');}
 };
}
module.exports={createCccReplacementFunctions};
