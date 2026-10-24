'use strict';

const {randomUUID}=require('node:crypto');
const {validateAuthorizedProfile}=require('../data/data-api');
const {isAdministratorRole}=require('../auth/role-policy');
const {projectHistoryEvent,filterHistoryRows,publicHistoryRow}=require('./change-history-projection');
const {groupDashboardHistory}=require('./change-history-operations');
const {renderHistoryExport}=require('./change-history-export');
const {calgaryAcademicYear,validYear,yearsInRange}=require('./history-year');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUERY_KEYS=new Set(['scope','start','end','course','topic','viscSubject','faculty','changeType','academicYear','domain','keyword']);
const TTL=600000,MAX_BYTES=6*1024*1024,MAX_ROWS=10000,PAGE_SIZE=100;
// Owner-approved archive restoration: existing SQL audits remain immutable.
// Earliest AuditEvent source: 2026-10-05; this stable UTC day avoids the SQL
// reader's ten-year range guard while showing every preserved archive event.
const DASHBOARD_HISTORY_ARCHIVE_START_UTC='2026-10-05T00:00:00.000Z';
const DAY_MS=86400000;
function dashboardReadWindow(filters,now){
 const requestedStart=filters.start+'T00:00:00.000Z';
 const requestedEnd=filters.end+'T00:00:00.000Z';
 // Bound open-ended UI queries to tomorrow UTC for the existing SQL range guard.
 const tomorrow=new Date(now+DAY_MS).toISOString().slice(0,10)+'T00:00:00.000Z';
 return {startUtc:requestedStart>DASHBOARD_HISTORY_ARCHIVE_START_UTC?requestedStart:DASHBOARD_HISTORY_ARCHIVE_START_UTC,
  endUtc:requestedEnd<tomorrow?requestedEnd:tomorrow};
}
const fail=(status,code,message)=>({status,body:{error:{code,message}}});
const ok=body=>({status:200,body});
const invalid=()=>fail(400,'INVALID_HISTORY_QUERY','The history query contains invalid or unsupported fields.');
const expired=()=>fail(409,'HISTORY_REFRESH_REQUIRED','This history snapshot expired or is unavailable. Apply the filters again.');
const historyLimit=()=>fail(413,'HISTORY_LIMIT','Narrow the date range or filters; the complete result exceeds the history limit.');
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.has(key));
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function normalizeFilters(input,now){
 if(!closed(input,QUERY_KEYS)||!['mine','timetable','dashboard'].includes(input.scope))return null;
 if(Object.values(input).some(value=>typeof value!=='string'||value.length>256))return null;
 // Optional changed-on bounds must never silently hide older business-year history.
 // SQL still caps source rows; projection, snapshots and exports retain row/byte limits.
 const start=input.start||'0001-01-01',end=input.end||'9999-12-31';
 if(!validDate(start)||!validDate(end)||start>=end)return null;
 if(input.faculty&&!UUID.test(input.faculty))return null;
 const academicYear=input.academicYear||(input.scope==='dashboard'?'all':calgaryAcademicYear(now));
 if(!(input.scope==='dashboard'&&academicYear==='all')&&!validYear(academicYear))return null;
 if(input.domain&&!['Teaching','Working schedule','Lookup','AFC','DOE Rule Book'].includes(input.domain))return null;
 return {...input,academicYear,start,end};
}
function createChangeHistoryApi({verifyToken,findUser,repository,clock=Date.now,randomId=randomUUID,renderExport=renderHistoryExport}){
 const snapshots=new Map(),queries=new Set();
 let exporting=false;
 const binding=auth=>JSON.stringify([auth.uid,auth.role,auth.facultyId]);
 function purge(){for(const [key,item] of snapshots)if(item.expiresAt<=clock())snapshots.delete(key);}
 async function authorize(token){
  let decoded;try{decoded=typeof token==='string'&&token&&await verifyToken(token);}catch(_){/* fixed error below */}
  if(typeof decoded?.uid!=='string'||!decoded.uid||decoded.uid.length>128)return {response:fail(401,'UNAUTHENTICATED','A valid bearer token is required.')};
  let validated;try{validated=validateAuthorizedProfile(await findUser(decoded.uid));}catch(_){return {response:failure()};}
  if(validated.status){for(const [key,item] of snapshots)if(item.uid===decoded.uid)snapshots.delete(key);return {response:validated};}
  const faculty=typeof validated.profile.facultyId==='string'?validated.profile.facultyId.toLowerCase():null;
  const auth={uid:decoded.uid,role:validated.role,facultyId:faculty,admin:isAdministratorRole(validated.role)};
  // A current identity change also discards that actor's old private cached rows.
  for(const [key,item] of snapshots)if(item.uid===auth.uid&&item.binding!==binding(auth))snapshots.delete(key);
  return auth;
 }
 function failure(error){
  const number=Number(error?.number??error?.originalError?.info?.number);
  if(number===54701)return fail(403,'ROLE_DENIED','This account cannot read the requested history.');
  if(number===54703)return fail(403,'FACULTY_LINK_REQUIRED','My Change History requires a linked faculty profile.');
  if(number===54702)return invalid();
  if(number===54704||error?.code==='HISTORY_LIMIT')return historyLimit();
  return fail(503,'HISTORY_UNAVAILABLE','History is temporarily unavailable. Please retry.');
 }
 function lookup(auth,handle){
  purge();const item=snapshots.get(handle);
  if(!item)return {response:expired()};
  if(item.uid!==auth.uid||item.binding!==binding(auth))return {response:fail(403,'HISTORY_SCOPE_DENIED','This history snapshot belongs to another authorization context.')};
  return item;
 }
 const pageBody=(handle,item,offset)=>({snapshot:handle,total:item.rows.length,offset,pageSize:PAGE_SIZE,rows:item.rows.slice(offset,offset+PAGE_SIZE),expiresAt:new Date(item.expiresAt).toISOString()});
 return Object.freeze({
  async query(token,input={}){
   const auth=await authorize(token);if(auth.response)return auth.response;
   const filters=normalizeFilters(input,clock());if(!filters)return invalid();
   if(filters.scope==='mine'&&!auth.facultyId)return fail(403,'FACULTY_LINK_REQUIRED','My Change History requires a linked faculty profile.');
   if(queries.has(auth.uid)||queries.size>=2)return fail(429,'HISTORY_BUSY','A history query is running. Retry shortly.');
   queries.add(auth.uid);
   try{
    const dashboard=filters.scope==='dashboard';
    const window=dashboard?dashboardReadWindow(filters,clock()):null;
    // Date ranges ending before the original audit archive remain empty.
    const events=dashboard&&window.endUtc<=window.startUtc?[]:await repository.list({
     actorFirebaseUid:auth.uid,scope:filters.scope,start:filters.start,end:filters.end,
     ...(window?{startUtc:window.startUtc,endUtc:window.endUtc}:{})
    });
    if(!Array.isArray(events))throw Error('Invalid history source.');
    if(events.length>MAX_ROWS)return historyLimit();
    const projected=[],operations=[],years=new Set([dashboard?calgaryAcademicYear(clock()):filters.academicYear]);
    // All-years is exclusively a Dashboard option. The My/Calendar scopes
    // retain their existing strict academic-year and faculty-privacy rules.
    const viewFilters=dashboard&&filters.academicYear==='all'?{...filters,academicYear:null}:filters;
    for(const event of events){
     // Defense in depth: any stale adapter output must honor the trusted
     // source-date window before authorization projection and grouping.
     if(dashboard){
      const when=new Date(event?.occurredAtUtc).getTime();
      if(!Number.isFinite(when)||when<Date.parse(window.startUtc)||when>=Date.parse(window.endUtc))continue;
     }
     const available=projectHistoryEvent(event,{...auth,scope:filters.scope});
     for(const row of available){for(const year of row._years)years.add(year);for(const range of row._ranges||[])for(const year of yearsInRange(...range))years.add(year);}
     const matched=filterHistoryRows(available,viewFilters);
     if(filters.scope==='dashboard'){
      // Match a complete, authorized event before grouping: a matching Purpose must
      // not hide Start/End/Faculty detail from that same user submission.
      if(matched.length)operations.push({event,rows:available});
      projected.push(...matched);
     }else projected.push(...matched.map(row=>({...row,academicYear:filters.academicYear})));
     if(projected.length>MAX_ROWS)return historyLimit();
    }
    projected.sort((a,b)=>b.changeDate.localeCompare(a.changeDate)||a.rowId.localeCompare(b.rowId));
    const rows=filters.scope==='dashboard'?groupDashboardHistory(operations):projected.map(publicHistoryRow);
    const bytes=Buffer.byteLength(JSON.stringify(rows));
    if(bytes>MAX_BYTES)return historyLimit();
    const current=await authorize(token);if(current.response)return current.response;
    if(binding(current)!==binding(auth))return fail(403,'HISTORY_SCOPE_DENIED','History permissions changed. Apply the filters again.');
    purge();
    const own=[...snapshots].filter(([,item])=>item.uid===auth.uid);
    while(own.length>=2)snapshots.delete(own.shift()[0]);
    while(snapshots.size>=8)snapshots.delete(snapshots.keys().next().value);
    const handle=randomId(),item={uid:auth.uid,binding:binding(auth),scope:filters.scope,rows,bytes,expiresAt:clock()+TTL};
    snapshots.set(handle,item);
    const facultyOptions=new Map();
    for(const row of projected)for(const option of row._facultyOptions)if(UUID.test(option.key))facultyOptions.set(option.key,option.name);
    return ok({...pageBody(handle,item,0),filters,
     ...(dashboard?{historyArchiveStartUtc:DASHBOARD_HISTORY_ARCHIVE_START_UTC}:{}),facets:{changeTypes:[...new Set(projected.map(row=>row.changeType))].sort(),faculties:[...facultyOptions].map(([key,name])=>({key,name})),academicYears:[...years].filter(Boolean).sort(),viscSubjects:[...new Set(projected.map(row=>row.viscSubject).filter(Boolean))].sort()},coverage:[
     ...(dashboard?['Historical Dashboard operations are restored from '+DASHBOARD_HISTORY_ARCHIVE_START_UTC+' and consolidated by recorded submission. Source SQL audit events remain unchanged.']:[]),
     'Only recorded SQL audits are available. Older events may lack previous values or proof of affected faculty; My Change History excludes unproven membership.',
     'History is limited to the selected academic year: recorded teaching/policy year, AFC/work date ranges, or Calgary change year for global Lookup edits. Missing evidence in other domains is excluded. VISC mappings are not inferred.',
     'Exports contain every row in this filtered snapshot. Refresh after 10 minutes or after permissions change.'
    ]});
   }catch(error){return failure(error);}finally{queries.delete(auth.uid);}
  },
  async page(token,input={}){
   const auth=await authorize(token);if(auth.response)return auth.response;
   if(!closed(input,new Set(['snapshot','offset']))||typeof input.snapshot!=='string'||!UUID.test(input.snapshot))return invalid();
   const raw=input.offset,offset=typeof raw==='number'?raw:typeof raw==='string'&&/^(0|[1-9]\d*)$/.test(raw)?Number(raw):NaN;
   if(!Number.isSafeInteger(offset)||offset<0||offset%PAGE_SIZE!==0)return invalid();
   const item=lookup(auth,input.snapshot);if(item.response)return item.response;
   if(offset!==0&&offset>=item.rows.length)return invalid();
   return ok(pageBody(input.snapshot,item,offset));
  },
  async export(token,input={}){
   const auth=await authorize(token);if(auth.response)return auth.response;
   if(!closed(input,new Set(['snapshot','format']))||typeof input.snapshot!=='string'||!UUID.test(input.snapshot)||!['csv','xlsx'].includes(input.format))return invalid();
   const item=lookup(auth,input.snapshot);if(item.response)return item.response;
   if(exporting)return fail(429,'HISTORY_EXPORT_BUSY','A history export is running. Retry shortly.');
   exporting=true;
   try{
    const file=await renderExport(item.rows,input.format,{grouped:item.scope==='dashboard'});
    // Rendering is asynchronous. Recheck current scope before releasing bytes.
    const current=await authorize(token);if(current.response)return current.response;
    const refreshed=lookup(current,input.snapshot);if(refreshed.response)return refreshed.response;
    return ok({fileName:file.fileName,contentType:file.contentType,fileBase64:file.bytes.toString('base64'),rowCount:item.rows.length});
   }catch(error){return failure(error);}finally{exporting=false;}
  }
 });
}
module.exports={createChangeHistoryApi,normalizeFilters,DASHBOARD_HISTORY_ARCHIVE_START_UTC,dashboardReadWindow};
