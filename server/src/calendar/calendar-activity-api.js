'use strict';
const {validateAuthorizedProfile,normalizedRange}=require('../data/data-api');
const { backendFailure } = require('../http/backend-error');
const {isAdministratorRole}=require('../auth/role-policy');
const {UUID,onlyKeys}=require('../swap/swap-domain');
const {writeDisabled}=require('../data/write-gates');
const {approvedActivityImportPolicy}=require('./activity-import-policy');
const {parseActivityWorkbook}=require('./activity-workbook');
const {publicActivity}=require('../data/sql-calendar-activity-repository');
const fail=(status,code,message)=>({status,body:{error:{code,message}}});
const ok=(body,status=200)=>({status,body});
const version=value=>typeof value==='string'&&/^[0-9a-f]{16}$/i.test(value);
const id=value=>typeof value==='string'&&UUID.test(value);
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const time=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const categories=new Set(['ccc','rotation_participant','clinical_day','vetm581_rounds','vetm571_clinical_pharmacology','vetm591_presentations','teaching_excellence','remote_work']);
const sqlErrors=new Map([
 [53801,[403,'ROLE_DENIED','This account cannot access this activity operation.']],
 [53802,[400,'INVALID_REQUEST','The activity request contains invalid fields.']],
 [53803,[404,'NOT_FOUND','The activity or import was not found.']],
 [53804,[409,'ACTIVITY_CONFLICT','The activity or import changed. Reload and obtain a fresh preview.']],
 [53805,[409,'PREVIEW_EXPIRED','The import preview expired. Refresh it before confirming.']],
 [53806,[409,'MANIFEST_CONFLICT','The approved source manifest changed. Obtain a fresh preview.']],
 [53807,[409,'IMPORT_REPLAY_CONFLICT','The request key does not match this import outcome.']],
 [53808,[409,'PROTECTED_REFERENCE','Referenced or newer records prevent this operation.']],
 [53809,[409,'AVAILABILITY_BUSY','Faculty availability is busy. Reload and retry.']]
]);
function failure(error){
  const typedFailure = backendFailure(error);
  if (typedFailure) return typedFailure;
 const known=sqlErrors.get(Number(error?.number??error?.originalError?.info?.number));if(known)return fail(...known);
 if(error?.code==='IMPORT_LIMIT')return fail(413,'IMPORT_LIMIT','The workbook exceeds the import limits.');
 if(error?.code==='IMPORT_BUSY')return fail(429,'IMPORT_BUSY','The workbook parser is busy. Retry shortly.');
 if(['INVALID_SOURCE','APPROVED_SOURCE_REQUIRED'].includes(error?.code))return fail(400,error.code,'The workbook could not be validated against the approved source.');
 return fail(503,'SERVICE_UNAVAILABLE','The Calendar activity service is temporarily unavailable.');
}
function createCalendarActivityApi({verifyToken,findUser,repository,parseWorkbook=parseActivityWorkbook,writeGates={}}){
 async function authorize(token,adminOnly=false,gate=null){
  let decoded;try{decoded=token&&await verifyToken(token);}catch(_){return {response:fail(401,'UNAUTHENTICATED','A valid bearer token is required.')};}
  if(typeof decoded?.uid!=='string'||!decoded.uid||decoded.uid.length>128)return {response:fail(401,'UNAUTHENTICATED','A valid bearer token is required.')};
  let validated;try{validated=validateAuthorizedProfile(await findUser(decoded.uid));}catch(_){return {response:failure()};}
  if(validated.status)return {response:validated};
  const admin=isAdministratorRole(validated.role);
  if(adminOnly&&!admin)return {response:fail(403,'ROLE_DENIED','Administrator permission is required.')};
  if(gate&&writeGates[gate]!==true)return {response:writeDisabled()};
  return {uid:decoded.uid,admin,facultyScoped:validated.facultyScoped};
 }
 async function run(token,adminOnly,gate,operation){const auth=await authorize(token,adminOnly,gate);if(auth.response)return auth.response;try{return await operation(auth);}catch(error){return failure(error);}}
 const invalid=()=>fail(400,'INVALID_REQUEST','The activity request contains invalid fields.');
 return Object.freeze({
  capabilities:token=>run(token,false,null,auth=>ok({readCapabilities:{calendarActivities:true,scope:auth.facultyScoped?'self':'authorized'},writeCapabilities:Object.fromEntries(['calendarActivityStage','calendarActivityCommit','calendarActivityTime'].map(key=>[key,auth.admin&&writeGates[key]===true]))})),
  list:(token,query={})=>run(token,false,null,async auth=>{
   if(!onlyKeys(query,['start','end','facultyKey','category','cursor','limit','includeFacultyKeys']))return invalid();
   if(query.includeFacultyKeys!=null&&![true,false,'true','false'].includes(query.includeFacultyKeys))return invalid();
   const includeFacultyKeys=query.includeFacultyKeys===true||query.includeFacultyKeys==='true';
   if(includeFacultyKeys&&!auth.admin)return fail(403,'ROLE_DENIED','Administrator permission is required for faculty key mapping.');
   const range=normalizedRange(query),limit=query.limit==null?100:Number(query.limit);
   if(!range?.start||!range.end||!Number.isInteger(limit)||limit<1||limit>100||! /^(?:[1-9]\d?|100)$/.test(String(query.limit??100))
    ||query.facultyKey!=null&&!id(query.facultyKey)||query.category!=null&&!categories.has(query.category)
    ||query.cursor!=null&&(typeof query.cursor!=='string'||query.cursor.length!==47||!date(query.cursor.slice(0,10))||query.cursor[10]!=='|'||!id(query.cursor.slice(11))))return invalid();
   const result=await repository.list({actorFirebaseUid:auth.uid,...range,facultyKey:query.facultyKey??null,category:query.category??null,cursor:query.cursor??null,limit,includeFacultyKeys});
   if(!Array.isArray(result?.activities))throw Error('Invalid activity response');
   return ok({activities:result.activities.map(publicActivity),nextCursor:result.nextCursor??null,...(includeFacultyKeys?{facultyKeys:(result.facultyKeys||[]).map(value=>({facultyId:value.facultyId,facultyKey:value.facultyKey}))}:{})});
  }),
  stage:(token,payload)=>run(token,true,'calendarActivityStage',async auth=>{
   if(!onlyKeys(payload,['requestId','sourceSha256','fileName','fileBase64'])||!id(payload.requestId)||!sha(payload.sourceSha256)
    ||typeof payload.fileName!=='string'||payload.fileName.length>256||!/^[^\\/:*?"<>|\x00-\x1f]+\.xlsx$/i.test(payload.fileName)||typeof payload.fileBase64!=='string')return invalid();
   const policy=approvedActivityImportPolicy(payload.sourceSha256);
   if(payload.fileBase64.length>699052)return fail(413,'IMPORT_LIMIT','The workbook exceeds the import limits.');
   if(!payload.fileBase64||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.fileBase64))return invalid();
   const buffer=Buffer.from(payload.fileBase64,'base64');
   if(!buffer.length||buffer.length>524288)return fail(413,'IMPORT_LIMIT','The workbook exceeds the import limits.');
   if(buffer.toString('base64')!==payload.fileBase64)return invalid();
   const parsed=await parseWorkbook(buffer,policy);
   if(parsed?.sourceSha256!==policy.sourceSha256)throw Error('Invalid parser binding');
   return ok(await repository.stage({actorFirebaseUid:auth.uid,parsed,requestId:payload.requestId}),201);
  }),
  getImport:(token,batchId)=>run(token,true,null,async auth=>id(batchId)?ok(await repository.getImport({actorFirebaseUid:auth.uid,batchId})):invalid()),
  preview:(token,batchId,payload)=>run(token,true,'calendarActivityStage',async auth=>{
   if(!id(batchId)||!onlyKeys(payload,['expectedVersion'])||!version(payload.expectedVersion))return invalid();
   return ok(await repository.preview({actorFirebaseUid:auth.uid,batchId,expectedVersion:payload.expectedVersion}));
  }),
  commit:(token,batchId,payload)=>run(token,true,'calendarActivityCommit',async auth=>{
   if(!id(batchId)||!onlyKeys(payload,['expectedVersion','manifestSha256','sourceSha256','idempotencyKey','confirm'])||!version(payload.expectedVersion)
    ||!sha(payload.manifestSha256)||!sha(payload.sourceSha256)||!id(payload.idempotencyKey)||payload.confirm!==true)return invalid();
   let policy;try{policy=approvedActivityImportPolicy(payload.sourceSha256);}catch(_){return invalid();}
   const result=await repository.commit({actorFirebaseUid:auth.uid,batchId,...payload,sourceSha256:policy.sourceSha256});
   return ok(Object.fromEntries(['receiptId','batchId','sourceSha256','manifestSha256','insertedCount','deletedAfcCount','committedAtUtc','idempotentReplay'].map(key=>[key,result[key]])));
  }),
  resolveTime:(token,activityId,payload)=>run(token,true,'calendarActivityTime',async auth=>{
   if(!id(activityId)||!onlyKeys(payload,['expectedVersion','date','startTime','endTime','evidenceRef','evidenceNote'])||!version(payload.expectedVersion)||!date(payload.date)
    ||!time(payload.startTime)||!time(payload.endTime)||payload.startTime>=payload.endTime||typeof payload.evidenceRef!=='string'||!payload.evidenceRef.trim()||payload.evidenceRef.length>512
    ||typeof payload.evidenceNote!=='string'||!payload.evidenceNote.trim()||payload.evidenceNote.length>1000)return invalid();
   return ok(publicActivity(await repository.resolveTime({actorFirebaseUid:auth.uid,activityId,...payload})));
  })
 });
}
module.exports={createCalendarActivityApi};
