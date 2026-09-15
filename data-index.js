(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DATA_INDEX=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const text=v=>String(v??'').trim();
 const number=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
 const uniqueSorted=values=>[...new Set(values.map(text).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 function primitives(value,out=[]){
  if(value===null||value===undefined)return out;
  if(Array.isArray(value)){for(const item of value)primitives(item,out);return out}
  if(typeof value==='object'){for(const item of Object.values(value))primitives(item,out);return out}
  const item=text(value);if(item)out.push(item);return out;
 }
 function facultySearchText(faculty){
  const f=faculty||{},summary=f.facultySummary2026_27||{},workload=f.workloadPolicy2026_27||{};
  return uniqueSorted(primitives([
   f.preferredFullName,f.hrFullName,f.hrFirstLast,f.teachingAssignmentName,f.ucid,f.email,
   f.rank,f.currentTitle,f.appointmentType,f.campus,f.primaryDepartment,f.department,f.reportsTo,
   f.teachingArea,f.teachingAreaEmphasis,f.boardSpecialties,f.boardCertification,
   summary.displayName,summary.traineeSummary,summary.specialProjectText,summary.roles,
   workload.credits,workload.trainee,f.awayFromCampusRecords
  ])).join(' ').toLowerCase();
 }
 function contractTeachingDOE(f){return [f?.doe?.teaching,f?.doeTeaching,f?.teachingDOE,f?.contractTeachingDOE].map(number).find(v=>v!==null)??null}
 function override(f){const raw=f?.doeOverride2026_27;if(raw===null||raw===undefined)return{value:null,reason:''};if(typeof raw==='object')return{value:number(raw.value),reason:text(raw.reason)};return{value:number(raw),reason:''}}
function facultyEntry(id,faculty,sessionStats={}){
  const f=faculty||{},o=override(f),facultyId=text(id||f.__id||f.id||f.ucid),name=text(f.preferredFullName||f.hrFirstLast||f.hrFullName||f.teachingAssignmentName||facultyId);
  const summary=f.facultySummary2026_27,roles=Array.isArray(summary?.roles)?summary.roles:[];
  const scheduled=number(sessionStats.assignedDOE),fixed=number(summary?.sourceNonTimetableTeachingDOE),sourceAssigned=number(summary?.assignedTeachingDOE),assigned=fixed!==null?fixed+(scheduled||0):(sourceAssigned??scheduled);
  return{id:facultyId,name,hrName:text(f.hrFullName),email:text(f.email),rank:text(f.rank||f.currentTitle),appointmentType:text(f.appointmentType),campus:text(f.campus),department:text(f.primaryDepartment||f.department),specialty:text(f.teachingArea||f.teachingAreaEmphasis||f.boardSpecialties),reportsTo:text(f.reportsTo),active:f.active!==false,status:text(f.status||'current'),contractTeachingDOE:contractTeachingDOE(f),assignedTeachingDOE:assigned,overrideDOE:o.value,overrideReason:o.reason,sessionCount:Number(sessionStats.count)||0,hasSummary:!!(summary&&typeof summary==='object'),hasWorkload:!!(f.workloadPolicy2026_27&&typeof f.workloadPolicy2026_27==='object'),roleTypes:uniqueSorted(roles.map(r=>r?.type)),afcRecordCount:Array.isArray(f.awayFromCampusRecords)?f.awayFromCampusRecords.length:0,searchText:facultySearchText({...f,__id:facultyId})};
 }
 function sessionFacultyIds(session){
  const s=session||{},rows=Array.isArray(s.assignments)?s.assignments:[];
  return uniqueSorted([...(Array.isArray(s.facultyIds)?s.facultyIds:[]),...rows.flatMap(a=>[a?.ucid,a?.facultyId])]);
 }
 function scheduleStats(sessions){
  const rows=Array.isArray(sessions)?sessions:[],facultyIds=new Set(),counts=new Map();
  for(const session of rows){for(const id of sessionFacultyIds(session))facultyIds.add(id);const course=text(session?.course);if(course)counts.set(course,(counts.get(course)||0)+1)}
  const courseCounts={};for(const course of [...counts.keys()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})))courseCounts[course]=counts.get(course);
  return{sessionCount:rows.length,assignedFacultyCount:facultyIds.size,courseCounts};
 }
 function dateChunks(values,limit=30){
  const dates=uniqueSorted(values).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00`)));
  const out=[];for(let i=0;i<dates.length;i+=limit)out.push(dates.slice(i,i+limit));return out;
 }
 function buildFacultyIndex(facultyRows,sessions){
  const stats=new Map();
  for(const session of Array.isArray(sessions)?sessions:[])for(const assignment of Array.isArray(session?.assignments)?session.assignments:[]){const id=text(assignment?.ucid||assignment?.facultyId);if(!id)continue;const row=stats.get(id)||{count:0,assignedDOE:0};row.count++;row.assignedDOE+=number(assignment?.doeCredit)||0;stats.set(id,row)}
  const entries=(Array.isArray(facultyRows)?facultyRows:[]).map(f=>{const id=text(f?.__id||f?.id||f?.ucid);return facultyEntry(id,f,stats.get(id)||{})}).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  for(const entry of entries)if(entry.assignedTeachingDOE!==null)entry.assignedTeachingDOE=Number(entry.assignedTeachingDOE.toFixed(6));
  return{schemaVersion:'ucvm-faculty-index-v1',entries};
 }
 return{facultyEntry,facultySearchText,sessionFacultyIds,buildFacultyIndex,scheduleStats,dateChunks};
});
