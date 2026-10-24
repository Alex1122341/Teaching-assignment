'use strict';
const {validateAuthorizedProfile}=require('../data/data-api'),{canonicalAcademicYear}=require('../data/academic-year');
const {isAdministratorRole}=require('../auth/role-policy'),{UUID,onlyKeys}=require('../swap/swap-domain'),{writeDisabled}=require('../data/write-gates');
const {parseCccWorkbook}=require('./ccc-workbook');
const {renderCccTemplate}=require('./ccc-template');
const fail=(status,code,message)=>({status,body:{error:{code,message}}}),ok=(body,status=200)=>({status,body});
const id=v=>typeof v==='string'&&UUID.test(v),sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/i.test(v),version=v=>typeof v==='string'&&/^[0-9a-f]{16}$/i.test(v);
const year=v=>{try{return typeof v==='string'&&/^\d{4}-\d{2}$/.test(v)&&canonicalAcademicYear(v)===v&&Number(v.slice(0,4))>=1900&&Number(v.slice(0,4))<=9998;}catch(_){return false;}};
const errors=new Map([[54901,[403,'ROLE_DENIED']],[54902,[400,'INVALID_REQUEST']],[54903,[404,'NOT_FOUND']],[54904,[409,'PREVIEW_CONFLICT']],[54905,[409,'PREVIEW_EXPIRED']],[54906,[409,'INVALID_SOURCE']],[54907,[409,'REPLAY_CONFLICT']],[54908,[409,'PROTECTED_REFERENCE']],[54909,[409,'AVAILABILITY_BUSY']]]);
function publicCccBatch(value){
 const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(v||{},k)).map(k=>[k,v[k]]));
 const result=pick(value,['batchId','academicYear','dataset','sourceSha256','status','previewVersion','manifestSha256','expiresAtUtc']);
 if(value?.preview){
  const p=value.preview;
  if(!Array.isArray(p.rows)||!Array.isArray(p.targets)||!Array.isArray(p.issues))throw Error('Invalid CCC preview');
  result.preview=pick(p,['academicYear','dataset','formatVersion','sourceManifestSha256','sourcePayloadManifestSha256','sourceRowsSha256','issues']);
  if(p.slotCounts)result.preview.slotCounts=pick(p.slotCounts,['total','assigned','unassigned']);
  const row=v=>{
   const r=pick(v,['activityId','facultyKey','facultyId','displayName','facultySourceName','sourceRow','label','startDate','endDate','courseCode','timeStatus','version','identityDigest','issues','staffingKind','staffingLabel','blockLabel','slotKey']);
   if(v.sourceRef)r.sourceRef=pick(v.sourceRef,['row','column']);
   if(Array.isArray(v.timeEvidence))r.timeEvidence=v.timeEvidence.map(t=>pick(t,['date','startTime','endTime']));
   return r;
  };
  result.preview.rows=p.rows.map(row);result.preview.targets=p.targets.map(row);
 }
 return result;
}
function failure(e){
 const known=errors.get(Number(e?.number??e?.originalError?.info?.number));if(known)return fail(...known,'The CCC replacement could not proceed. Refresh the preview and resolve any blocking issues.');
 if(e?.code==='IMPORT_LIMIT')return fail(413,'IMPORT_LIMIT','The workbook exceeds the import limits.');
 if(e?.code==='IMPORT_BUSY')return fail(429,'IMPORT_BUSY','The workbook parser is busy. Retry shortly.');
 if(['INVALID_CCC_SOURCE','IMPORT_PARSE_TIMEOUT'].includes(e?.code))return fail(400,'INVALID_CCC_SOURCE','Use the CCC template with one visible CCC worksheet.');
 return fail(503,'SERVICE_UNAVAILABLE','The CCC replacement service is temporarily unavailable.');
}
function createCccReplacementApi({verifyToken,findUser,repository,parseWorkbook=parseCccWorkbook,writeGates={}}){
 async function run(token,gate,fn){
  let decoded;try{decoded=token&&await verifyToken(token);}catch(_){return fail(401,'UNAUTHENTICATED','A valid bearer token is required.');}
  if(typeof decoded?.uid!=='string'||!decoded.uid||decoded.uid.length>128)return fail(401,'UNAUTHENTICATED','A valid bearer token is required.');
  try{const profile=validateAuthorizedProfile(await findUser(decoded.uid));if(profile.status)return profile;if(!isAdministratorRole(profile.role))return fail(403,'ROLE_DENIED','Administrator permission is required.');if(gate&&writeGates[gate]!==true)return writeDisabled();return await fn(decoded.uid);}catch(e){return failure(e);}
 }
 const invalid=()=>fail(400,'INVALID_REQUEST','The replacement request contains invalid fields.');
 return Object.freeze({
  template:token=>run(token,null,async()=>ok(await renderCccTemplate())),
  capabilities:token=>run(token,null,()=>ok({writeCapabilities:{cccReplaceStage:writeGates.cccReplaceStage===true,cccReplaceCommit:writeGates.cccReplaceCommit===true}})),
  stage:(token,p)=>run(token,'cccReplaceStage',async actorFirebaseUid=>{
   if(!onlyKeys(p,['requestId','sourceSha256','academicYear','dataset','fileName','fileBase64'])||!id(p.requestId)||!sha(p.sourceSha256)||!year(p.academicYear)||p.dataset!=='ccc-calendar'||typeof p.fileName!=='string'||p.fileName.length>180||!/^[^\\/:*?"<>|\x00-\x1f]+\.xlsx$/i.test(p.fileName)||typeof p.fileBase64!=='string')return invalid();
   if(p.fileBase64.length>699052)return fail(413,'IMPORT_LIMIT','The workbook exceeds the import limits.');
   if(!p.fileBase64||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.fileBase64))return invalid();
   const bytes=Buffer.from(p.fileBase64,'base64');if(!bytes.length||bytes.length>524288)return fail(413,'IMPORT_LIMIT','The workbook exceeds the import limits.');if(bytes.toString('base64')!==p.fileBase64)return invalid();
   const parsed=await parseWorkbook(bytes,p.academicYear);if(parsed.sourceSha256!==p.sourceSha256.toUpperCase()||parsed.academicYear!==p.academicYear||parsed.dataset!=='ccc-calendar')return invalid();
   return ok(publicCccBatch(await repository.stage({actorFirebaseUid,parsed,requestId:p.requestId,fileName:p.fileName,byteLength:bytes.length})),201);
  }),
  get:(token,batchId)=>run(token,null,async actorFirebaseUid=>id(batchId)?ok(publicCccBatch(await repository.get({actorFirebaseUid,batchId}))):invalid()),
  preview:(token,batchId,p)=>run(token,'cccReplaceStage',async actorFirebaseUid=>id(batchId)&&onlyKeys(p,['expectedVersion'])&&version(p.expectedVersion)?ok(publicCccBatch(await repository.preview({actorFirebaseUid,batchId,expectedVersion:p.expectedVersion}))):invalid()),
  commit:(token,batchId,p)=>run(token,'cccReplaceCommit',async actorFirebaseUid=>{
   if(!id(batchId)||!onlyKeys(p,['academicYear','dataset','expectedVersion','manifestSha256','sourceSha256','idempotencyKey','confirm','completeDataset'])||!year(p.academicYear)||p.dataset!=='ccc-calendar'||!version(p.expectedVersion)||!sha(p.manifestSha256)||!sha(p.sourceSha256)||!id(p.idempotencyKey)||p.confirm!==true||p.completeDataset!==true)return invalid();
   const r=await repository.commit({actorFirebaseUid,batchId,...p});return ok(Object.fromEntries(['receiptId','deletedCount','insertedCount','committedAtUtc','idempotentReplay'].map(key=>[key,r[key]])));
  })
 });
}
module.exports={createCccReplacementApi};
