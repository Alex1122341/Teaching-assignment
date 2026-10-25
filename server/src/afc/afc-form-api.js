'use strict';
const {createHash}=require('node:crypto');
const { backendFailure } = require('../http/backend-error');
const {validateAuthorizedProfile}=require('../data/data-api'),{isAdministratorRole,isSelfServiceRole}=require('../auth/role-policy');
const {UUID,onlyKeys}=require('../swap/swap-domain'),{writeDisabled}=require('../data/write-gates');
const {validateAfcFormPdf,MAX_FORM_BYTES}=require('./afc-form-pdf');
const id=v=>typeof v==='string'&&UUID.test(v),fail=(status,code,message)=>({status,body:{error:{code,message}}});
const invalid=()=>fail(400,'INVALID_REQUEST','The AFC form request is invalid.');
const metaKeys=['documentId','facultyId','fileName','byteLength','pageCount','sha256','createdAtUtc','idempotentReplay'];
const metadata=value=>Object.fromEntries(metaKeys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
function failure(e){
  const typedFailure = backendFailure(e);
  if (typedFailure) return typedFailure;
 const known={54801:[403,'ROLE_DENIED'],54802:[400,'INVALID_REQUEST'],54803:[404,'NOT_FOUND'],54804:[409,'UPLOAD_KEY_CONFLICT'],54805:[500,'DOCUMENT_INTEGRITY_FAILURE']};
 const entry=known[Number(e?.number??e?.originalError?.info?.number)];if(entry)return fail(...entry,'The AFC document operation could not be completed.');
 if(e?.code==='PDF_BUSY')return fail(429,'PDF_BUSY','PDF validation is busy. Retry shortly.');
 if(['INVALID_PDF','PDF_LIMIT'].includes(e?.code))return fail(422,e.code,'Choose a supported PDF, up to2MiB and100 pages.');
 return fail(503,'SERVICE_UNAVAILABLE','The AFC document service is temporarily unavailable.');
}
function createAfcFormApi({verifyToken,findUser,repository,writeGates={},validatePdf=validateAfcFormPdf}){
 async function run(token,write,fn){
  let decoded;try{decoded=token&&await verifyToken(token);}catch(_){return fail(401,'UNAUTHENTICATED','A valid bearer token is required.');}
  if(typeof decoded?.uid!=='string'||!decoded.uid||decoded.uid.length>128)return fail(401,'UNAUTHENTICATED','A valid bearer token is required.');
  try{
   const p=validateAuthorizedProfile(await findUser(decoded.uid));if(p.status)return p;
   const admin=isAdministratorRole(p.role),self=isSelfServiceRole(p.role)&&id(p.profile.facultyId);
   if(write?!admin:!admin&&!self)return fail(403,'ROLE_DENIED','This account cannot access the requested AFC document.');
   if(write&&writeGates.afcFormUpload!==true)return writeDisabled();
   const scope={admin,facultyId:typeof p.profile.facultyId==='string'?p.profile.facultyId.toLowerCase():null},r=await fn(decoded.uid,scope);
   if(!write&&r.status===200){const latest=validateAuthorizedProfile(await findUser(decoded.uid));if(latest.status)return latest;if(latest.role!==p.role||String(latest.profile.facultyId||'').toLowerCase()!==String(scope.facultyId||''))return fail(403,'ROLE_DENIED','Document permissions changed. Reload before downloading.');}
   return r;
  }catch(e){return failure(e);}
 }
 return Object.freeze({
  capabilities:token=>run(token,false,(_actor,scope)=>({status:200,body:{read:true,upload:scope.admin&&writeGates.afcFormUpload===true,maxBytes:MAX_FORM_BYTES,contentType:'application/pdf'}})),
  list:(token,q={})=>run(token,false,async(actorFirebaseUid,scope)=>{
   if(!onlyKeys(q,['facultyId','cursor','limit'])||!id(q.facultyId)||q.cursor!=null&&!id(q.cursor)||q.limit!=null&&!/^(?:[1-9]\d?|100)$/.test(String(q.limit)))return invalid();
   if(!scope.admin&&q.facultyId.toLowerCase()!==scope.facultyId)return fail(403,'ROLE_DENIED','Only your own AFC documents are available.');
   const r=await repository.list({actorFirebaseUid,facultyId:q.facultyId,cursor:q.cursor??null,limit:Number(q.limit??25)});
   if(!Array.isArray(r.documents)||r.documents.some(d=>typeof d.facultyId!=='string'||d.facultyId.toLowerCase()!==q.facultyId.toLowerCase()))throw Error();return {status:200,body:{documents:r.documents.map(metadata),nextCursor:r.nextCursor??null}};
  }),
  upload:(token,p)=>run(token,true,async actorFirebaseUid=>{
   if(!onlyKeys(p,['requestId','facultyId','fileName','contentType','fileBase64'])||!id(p.requestId)||!id(p.facultyId)||typeof p.fileName!=='string'||!p.fileName||p.fileName.length>180||! /^(?!\s)[^\\/:*?"<>|\x00-\x1f]+\.pdf$/i.test(p.fileName)||p.contentType!=='application/pdf'||typeof p.fileBase64!=='string')return invalid();
   if(p.fileBase64.length>2796204)return fail(413,'DOCUMENT_TOO_LARGE','PDF must be at most2MiB.');
   if(!p.fileBase64||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.fileBase64))return invalid();
   const pdfBytes=Buffer.from(p.fileBase64,'base64');if(!pdfBytes.length||pdfBytes.toString('base64')!==p.fileBase64)return invalid();
   if(pdfBytes.length>MAX_FORM_BYTES)return fail(413,'DOCUMENT_TOO_LARGE','PDF must be at most2MiB.');
   const checked=await validatePdf(pdfBytes);
   const r=await repository.upload({actorFirebaseUid,requestId:p.requestId,facultyId:p.facultyId,fileName:p.fileName,pdfBytes,...checked});
   return {status:r.idempotentReplay?200:201,body:{document:metadata(r)}};
  }),
  get:(token,documentId)=>run(token,false,async(actorFirebaseUid,scope)=>{
   if(!id(documentId))return invalid();const r=await repository.get({actorFirebaseUid,documentId});
   if(!scope.admin&&String(r.facultyId||'').toLowerCase()!==scope.facultyId)return fail(404,'NOT_FOUND','The AFC document is not available.');
   const b=r.pdfBytes;if(!Buffer.isBuffer(b)||!b.length||b.length>MAX_FORM_BYTES||b.length!==r.byteLength||r.documentId.toLowerCase()!==documentId.toLowerCase()||createHash('sha256').update(b).digest('hex')!==r.sha256.toLowerCase())return fail(500,'DOCUMENT_INTEGRITY_FAILURE','The AFC document failed an integrity check.');
   return {status:200,document:{...metadata(r),pdfBytes:b}};
  })
 });
}
module.exports={createAfcFormApi};
