/* Stable Teaching Assignment responsibilities with time-bounded assignees.
 * A responsibility is the durable HICC/VISC position. People may rotate through
 * that position without changing package/session identity.
 */
(function(root,factory){
 const temporal=typeof module==='object'&&module.exports?require('./temporal-role-assignment.js'):root?.UCVM_TEMPORAL_ROLE_ASSIGNMENT;
 const academic=typeof module==='object'&&module.exports?require('./academic-responsibility.js'):root?.UCVM_ACADEMIC_RESPONSIBILITY;
 const api=factory(temporal,academic);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_TEACHING_RESPONSIBILITY=api;
})(typeof window!=='undefined'?window:null,function(temporal,academic){
 'use strict';
 if(!temporal||!academic)throw Error('Teaching responsibility requires temporal-role-assignment and academic-responsibility.');
 const TYPES=Object.freeze(['hicc','visc']);
 const ID=/^[a-z][a-z0-9_-]{0,63}$/;
 const text=value=>String(value??'').trim();
 function responsibilityId(value,field='responsibilityId'){
  const id=text(value);
  if(!ID.test(id))throw Error(`${field} must be a canonical lowercase slug.`);
  return id;
 }
 function academicYearKey(value){
  const year=text(value);
  if(temporal.startYear(year)===null)throw Error('Academic Year must use YYYY-YY.');
  return year;
 }
 function uid(value){
  const id=text(value);
  if(!id||id.length>256||/[\/\u0000-\u001f\u007f]/.test(id))throw Error('Assignee UID is invalid.');
  return id;
 }
 function canonicalHiccToken(value){
  const raw=text(value),parts=raw.split('|');
  if(parts.length!==3||parts[0].toLowerCase()!=='hicc')throw Error('HICC responsibility scope token is invalid.');
  const token=academic.scopeToken('hicc',parts[1],parts[2]);
  if(!token)throw Error('HICC responsibility scope token is invalid.');
  return token;
 }
 function createResponsibility(input={}){
  const id=responsibilityId(input.id),kind=text(input.kind).toLowerCase();
  if(!TYPES.includes(kind))throw Error('Teaching responsibility kind must be hicc or visc.');
  const groupId=kind==='hicc'?responsibilityId(input.groupId,'groupId'):'',label=text(input.label);
  if(label.length>120)throw Error('Teaching responsibility label exceeds 120 characters.');
  const scopes=[...new Set((Array.isArray(input.academicScopeTokens)?input.academicScopeTokens:[]).map(canonicalHiccToken))];
  if(kind==='hicc'&&!scopes.length)throw Error('HICC responsibility requires at least one exact Course/Subject scope.');
  if(kind==='visc'&&scopes.length)throw Error('VISC group leadership does not use HICC Course/Subject scope tokens.');
  return Object.freeze({id,kind,groupId,label,academicScopeTokens:kind==='hicc'?scopes:[],active:input.active!==false});
 }
 function assigneePath(responsibility,year,assigneeUid){
  const id=responsibilityId(responsibility),academicYear=academicYearKey(year),actor=uid(assigneeUid);
  return`teaching_responsibilities/${id}/years/${academicYear}/assignees/${actor}`;
 }
 function normalizeWindow(input={}){
  const normalized=temporal.normalizeWindow(input);
  return Object.freeze({
   activeDate:normalized.activeDate,
   expirationDate:normalized.expirationDate,
   sourceDoeAssignmentFactId:text(input.sourceDoeAssignmentFactId)
  });
 }
 function normalizeAssigneeSchedule(input={}){
  const id=responsibilityId(input.responsibilityId),year=academicYearKey(input.academicYearKey),assigneeUid=uid(input.assigneeUid);
  const facultyId=text(input.facultyId),raw=Array.isArray(input.windows)?input.windows:[];
  if(!raw.length||raw.length>4)throw Error('Responsibility assignee schedule requires 1 to 4 date windows.');
  const windows=raw.map(row=>normalizeWindow({...row,academicYear:year})).sort((a,b)=>a.activeDate.localeCompare(b.activeDate)||a.expirationDate.localeCompare(b.expirationDate));
  for(let i=1;i<windows.length;i++){
   if(temporal.dateParts(windows[i].activeDate).ms<temporal.dateParts(windows[i-1].expirationDate).ms)throw Error('Responsibility assignee windows may not overlap.');
  }
  return Object.freeze({responsibilityId:id,academicYearKey:year,assigneeUid,facultyId,enabled:input.enabled!==false,windows:Object.freeze(windows)});
 }
 function windowActiveAt(window,date){
  const at=temporal.dateParts(date);if(!at)throw Error('Responsibility status date must use YYYY-MM-DD.');
  return at.ms>=temporal.dateParts(window.activeDate).ms&&at.ms<temporal.dateParts(window.expirationDate).ms;
 }
 function scheduleActiveAt(schedule,date){
  return Boolean(schedule?.enabled)&&Array.isArray(schedule?.windows)&&schedule.windows.some(window=>windowActiveAt(window,date));
 }
 function validateResponsibilitySchedule(responsibility,schedules=[]){
  const r=createResponsibility(responsibility),rows=(Array.isArray(schedules)?schedules:[]).map(normalizeAssigneeSchedule);
  for(const row of rows)if(row.responsibilityId!==r.id)throw Error('Assignee schedule belongs to another responsibility.');
  const years=new Set(rows.map(row=>row.academicYearKey));if(years.size>1)throw Error('Validate one Academic Year responsibility schedule at a time.');
  const all=[];
  for(const row of rows)if(row.enabled)for(const window of row.windows)all.push({assigneeUid:row.assigneeUid,...window});
  all.sort((a,b)=>a.activeDate.localeCompare(b.activeDate)||a.expirationDate.localeCompare(b.expirationDate)||a.assigneeUid.localeCompare(b.assigneeUid));
  for(let i=1;i<all.length;i++){
   if(temporal.dateParts(all[i].activeDate).ms<temporal.dateParts(all[i-1].expirationDate).ms)throw Error('Teaching responsibility cannot have overlapping effective assignees.');
  }
  return Object.freeze({responsibility:r,academicYearKey:rows[0]?.academicYearKey||'',schedules:Object.freeze(rows)});
 }
 function effectiveAssignee(schedules,date){
  const active=(Array.isArray(schedules)?schedules:[]).filter(row=>scheduleActiveAt(row,date));
  if(active.length>1)throw Error('Teaching responsibility has ambiguous overlapping assignees.');
  return active[0]||null;
 }
 function scopeProfile(responsibility){
  const row=createResponsibility(responsibility);
  return row.kind==='hicc'?{role:'hicc',academicScopeTokens:[...row.academicScopeTokens]}:{role:'visc',academicScopeTokens:[]};
 }
 function encode(value){return encodeURIComponent(value).replace(/_/g,'%5F')}
 function submissionDocumentId(year,group,hiccResponsibilityId){
  const academicYear=academicYearKey(year),groupId=responsibilityId(group,'groupId'),hiccId=responsibilityId(hiccResponsibilityId);
  const id=`ta-sub-v2__${encode(academicYear)}__${encode(groupId)}__${encode(hiccId)}`;
  if(id.length>1500)throw Error('Teaching Assignment submission identity exceeds 1500 bytes.');
  return id;
 }
 return Object.freeze({TYPES,createResponsibility,normalizeAssigneeSchedule,validateResponsibilitySchedule,
  assigneePath,scheduleActiveAt,effectiveAssignee,scopeProfile,submissionDocumentId});
});
