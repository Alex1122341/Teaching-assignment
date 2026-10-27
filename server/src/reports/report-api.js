'use strict';
const {randomUUID}=require('node:crypto');
const {validateAuthorizedProfile}=require('../data/data-api');
const {isAdministratorRole}=require('../auth/role-policy');
const {catalog:reportCatalog,validateDefinition,runTable,REPORT_LIMITS,invalid,limit}=require('./report-definition');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const fail=(status,code,message)=>({status,body:{error:{code,message}}}),ok=body=>({status:200,body});
const expired=()=>fail(409,'REPORT_REFRESH_REQUIRED','This report preview expired or is unavailable. Preview the report again.');
const failure=error=>error&&[400,401,403,409,413,429].includes(error.status)&&/^(?:INVALID_REPORT_QUERY|REPORT_[A-Z_]+|HISTORY_[A-Z_]+|UNAUTHENTICATED|ROLE_DENIED|PROFILE_REQUIRED|PASSWORD_CHANGE_REQUIRED)$/.test(error.code||'')?fail(error.status,error.code,error.message):fail(503,'REPORT_UNAVAILABLE','Reports are temporarily unavailable. Retry shortly.');
function createReportApi({verifyToken,findUser,loadSources,clock=Date.now,randomId=randomUUID,renderExport}){
 const snapshots=new Map(),queries=new Set();let exporting=false;
 const binding=auth=>JSON.stringify([auth.uid,auth.role]);
 function clearActor(uid,keepBinding){for(const [handle,item] of snapshots)if(item.uid===uid&&item.binding!==keepBinding)snapshots.delete(handle);}
 function purge(){for(const [handle,item] of snapshots)if(item.expiresAt<=clock())snapshots.delete(handle);}
 async function authorize(token){
  purge();let decoded;
  try{decoded=typeof token==='string'&&token&&await verifyToken(token);}catch(_){/* fixed identity error below */}
  if(typeof decoded?.uid!=='string'||!decoded.uid||decoded.uid.length>128)return {response:fail(401,'UNAUTHENTICATED','A valid bearer token is required.')};
  let validated;try{validated=validateAuthorizedProfile(await findUser(decoded.uid));}catch(_){return {response:failure()};}
  if(validated.status){clearActor(decoded.uid);return {response:validated};}
  const auth={uid:decoded.uid,role:validated.role};clearActor(auth.uid,binding(auth));
  if(!isAdministratorRole(auth.role)){clearActor(auth.uid);return {response:fail(403,'ROLE_DENIED','Owner or administrator access is required for reports.')};}
  return auth;
 }
 function lookup(auth,handle){
  purge();const item=snapshots.get(handle);if(!item)return {response:expired()};
  if(item.uid!==auth.uid||item.binding!==binding(auth))return {response:fail(403,'REPORT_SCOPE_DENIED','This report belongs to another authorization context.')};
  return item;
 }
 const tablePage=(table,offset)=>({...table,columns:table.columns.map(column=>({...column,operators:column.operators?.slice()})),coverage:table.coverage.slice(),offset,pageSize:REPORT_LIMITS.pageSize,rows:table.rows.slice(offset,offset+REPORT_LIMITS.pageSize).map(row=>row.slice())});
 return Object.freeze({
  async catalog(token){const auth=await authorize(token);return auth.response||ok(reportCatalog());},
  async query(token,input){
   const auth=await authorize(token);if(auth.response)return auth.response;
   let definition;try{definition=validateDefinition(input);}catch(error){return failure(error);}
   if(queries.has(auth.uid)||queries.size>=2)return fail(429,'REPORT_BUSY','A report query is running. Retry shortly.');
   queries.add(auth.uid);const startedAt=clock();
   try{
    const loaded=await loadSources({definition,uid:auth.uid,token});
    const tables=definition.datasets.map(dataset=>{
     const source=loaded?.tables?.[dataset.source];if(!source)throw Error('Missing report source');
     return {...runTable(dataset.source,source.rows,dataset),coverage:Array.isArray(source.coverage)?source.coverage.filter(value=>typeof value==='string'):[]};
    });
    const rows=tables.reduce((sum,table)=>sum+table.total,0),cells=tables.reduce((sum,table)=>sum+table.total*table.columns.length,0),bytes=Buffer.byteLength(JSON.stringify({definition,tables}));
    if(rows>REPORT_LIMITS.totalRows||cells>REPORT_LIMITS.cells||bytes>REPORT_LIMITS.bytes)throw limit();
    const current=await authorize(token);if(current.response)return current.response;
    if(binding(current)!==binding(auth))return fail(403,'REPORT_SCOPE_CHANGED','Report permissions changed. Preview again.');
    const now=clock(),sourceExpiry=loaded.expiresAt===undefined?Infinity:Date.parse(loaded.expiresAt);
    if(Number.isNaN(sourceExpiry))throw Error('Invalid source expiry');
    const expiresAt=Math.min(now+REPORT_LIMITS.ttlMs,sourceExpiry);if(expiresAt<=now)return expired();
    const snapshot=randomId();if(!UUID.test(snapshot)||snapshots.has(snapshot))throw Error('Invalid snapshot identity');
    purge();const own=[...snapshots].filter(([,item])=>item.uid===auth.uid);while(own.length>=2)snapshots.delete(own.shift()[0]);while(snapshots.size>=8)snapshots.delete(snapshots.keys().next().value);
    const item={uid:auth.uid,binding:binding(auth),definition,tables,expiresAt,createdAt:new Date(now).toISOString(),sourceReadStartedAt:new Date(startedAt).toISOString()};snapshots.set(snapshot,item);
    return ok({snapshot,academicYear:definition.academicYear,definition:JSON.parse(JSON.stringify(definition)),createdAt:item.createdAt,sourceReadStartedAt:item.sourceReadStartedAt,expiresAt:new Date(expiresAt).toISOString(),tables:tables.map(table=>tablePage(table,0))});
   }catch(error){return failure(error);}finally{queries.delete(auth.uid);}
  },
  async page(token,input){
   const auth=await authorize(token);if(auth.response)return auth.response;
   if(!closed(input,['snapshot','source','offset'])||typeof input.snapshot!=='string'||!UUID.test(input.snapshot)||typeof input.source!=='string')return failure(invalid());
   const offset=typeof input.offset==='number'?input.offset:typeof input.offset==='string'&&/^(0|[1-9]\d*)$/.test(input.offset)?Number(input.offset):NaN;
   if(!Number.isSafeInteger(offset)||offset<0||offset%REPORT_LIMITS.pageSize!==0)return failure(invalid());
   const item=lookup(auth,input.snapshot);if(item.response)return item.response;
   const table=item.tables.find(value=>value.source===input.source);if(!table)return fail(403,'REPORT_SOURCE_DENIED','This source is not included in the report preview.');
   if(offset!==0&&offset>=table.total)return failure(invalid());
   return ok({snapshot:input.snapshot,...tablePage(table,offset),expiresAt:new Date(item.expiresAt).toISOString()});
  },
  async export(token,input){
   const auth=await authorize(token);if(auth.response)return auth.response;
   if(!closed(input,['snapshot','format','source'])||typeof input.snapshot!=='string'||!UUID.test(input.snapshot)||!['csv','xlsx'].includes(input.format)||input.format==='csv'&&typeof input.source!=='string'||input.format==='xlsx'&&Object.hasOwn(input,'source'))return failure(invalid());
   const item=lookup(auth,input.snapshot);if(item.response)return item.response;
   const tables=input.format==='csv'?item.tables.filter(table=>table.source===input.source):item.tables;
   if(!tables.length)return fail(403,'REPORT_SOURCE_DENIED','This source is not included in the report preview.');
   if(exporting)return fail(429,'REPORT_EXPORT_BUSY','A report export is running. Retry shortly.');
   exporting=true;
   try{
    const render=renderExport||require('./report-export').renderReportExport;
    const file=await render(tables,{format:input.format,academicYear:item.definition.academicYear});
    if(!Buffer.isBuffer(file?.bytes)||!/^paws-reports[-a-z0-9]*\.(?:csv|xlsx)$/.test(file.fileName||'')||!file.fileName.endsWith('.'+input.format)||typeof file.contentType!=='string'||file.contentType.split(';')[0]!== (input.format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))throw Error('Invalid report artifact');
    if(file.bytes.length>REPORT_LIMITS.bytes)throw limit();
    const current=await authorize(token);if(current.response)return current.response;
    const refreshed=lookup(current,input.snapshot);if(refreshed.response)return refreshed.response;
    return ok({snapshot:input.snapshot,fileName:file.fileName,contentType:file.contentType,fileBase64:file.bytes.toString('base64'),rowCounts:Object.fromEntries(tables.map(table=>[table.source,table.total])),rowCount:tables.reduce((sum,table)=>sum+table.total,0)});
   }catch(error){return failure(error);}finally{exporting=false;}
  }
 });
}
module.exports={createReportApi};
