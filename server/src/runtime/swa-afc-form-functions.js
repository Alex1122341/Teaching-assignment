'use strict';
const {UUID}=require('../swap/swap-domain');
const { backendFailure } = require('../http/backend-error');
const bad=(status,code,message)=>({status,jsonBody:{error:{code,message}}});
const json=r=>({status:r.status,jsonBody:r.body});
function createAfcFormFunctions({api}){
 return async request=>{
  try{
   const url=new URL(request.url),p=url.pathname,token=(request.headers.get('authorization')||'').replace(/^Bearer /i,'');
   if([...new Set(url.searchParams.keys())].some(k=>url.searchParams.getAll(k).length!==1))return bad(400,'INVALID_REQUEST','Duplicate parameters are not allowed.');
   if(p==='/api/v1/afc-forms/capabilities')return request.method==='GET'&&url.search===''?json(await api.capabilities(token)):bad(405,'METHOD_NOT_ALLOWED','GET required.');
   if(p==='/api/v1/afc-forms'){
    if(request.method==='GET')return json(await api.list(token,Object.fromEntries(url.searchParams)));
    if(request.method==='POST'&&!url.search){let body;try{body=await request.json();}catch(_){return bad(400,'INVALID_JSON','A valid JSON upload is required.');}return json(await api.upload(token,body));}
    return bad(405,'METHOD_NOT_ALLOWED','GET or POST required.');
   }
   const match=/^\/api\/v1\/afc-forms\/([^/]+)\/document$/.exec(p);
   if(!match)return bad(404,'NOT_FOUND','Route not found.');
   if(request.method!=='GET')return bad(405,'METHOD_NOT_ALLOWED','GET required.');
   if(url.search||!UUID.test(match[1]))return bad(400,'INVALID_REQUEST','Invalid document identifier.');
   const r=await api.get(token,match[1]);if(r.status!==200||!r.document)return json(r);
   const bytes=r.document.pdfBytes;
   if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>2097152)return bad(500,'DOCUMENT_INTEGRITY_FAILURE','The document failed an integrity check.');
   return {status:200,binaryBody:bytes,headers:{'Content-Type':'application/pdf','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`attachment; filename="afc-form-${match[1]}.pdf"`}};
  }catch(caught){return bad(503,'SERVICE_UNAVAILABLE','The AFC document service is temporarily unavailable.');}
 };
}
module.exports={createAfcFormFunctions};
