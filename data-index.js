(function(root,factory){
 const doe=typeof module==='object'&&module.exports?require('./faculty-doe.js'):root?.UCVM_FACULTY_DOE;
 const scheduling=typeof module==='object'&&module.exports?require('./scheduling-core.js'):root?.UCVM_SCHEDULING;
 const api=factory(doe,scheduling);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DATA_INDEX=api;
})(typeof window!=='undefined'?window:null,function(DOE,scheduling){
 'use strict';
 if(!scheduling)throw Error('UCVM_SCHEDULING must load before data-index.js.');
 if(!DOE||typeof DOE.override!=='function'||typeof DOE.contract!=='function')throw Error('UCVM_FACULTY_DOE must load before data-index.js.');
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
 function facultyEntry(id,faculty,sessionStats={}){
  const f=faculty||{},o=DOE.override(f),facultyId=text(id||f.__id||f.id||f.ucid),name=text(f.preferredFullName||f.hrFirstLast||f.hrFullName||f.teachingAssignmentName||facultyId);
  const summary=f.facultySummary2026_27,roles=Array.isArray(summary?.roles)?summary.roles:[];
  const scheduled=number(sessionStats.assignedDOE),fixed=number(summary?.sourceNonTimetableTeachingDOE),sourceAssigned=number(summary?.assignedTeachingDOE),assigned=fixed!==null?fixed+(scheduled||0):(sourceAssigned??scheduled);
  return{id:facultyId,name,hrName:text(f.hrFullName),email:text(f.email),rank:text(f.rank||f.currentTitle),appointmentType:text(f.appointmentType),campus:text(f.campus),department:text(f.primaryDepartment||f.department),specialty:text(f.teachingArea||f.teachingAreaEmphasis||f.boardSpecialties),reportsTo:text(f.reportsTo),active:f.active!==false,status:text(f.status||'current'),contractTeachingDOE:DOE.contract(f),assignedTeachingDOE:assigned,overrideDOE:o.value,overrideReason:o.reason,sessionCount:Number(sessionStats.count)||0,hasSummary:!!(summary&&typeof summary==='object'),hasWorkload:!!(f.workloadPolicy2026_27&&typeof f.workloadPolicy2026_27==='object'),roleTypes:uniqueSorted(roles.map(r=>r?.type)),afcRecordCount:Array.isArray(f.awayFromCampusRecords)?f.awayFromCampusRecords.length:0,searchText:facultySearchText({...f,__id:facultyId})};
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
 function swapAliases(f){
  const summary=f?.facultySummary2026_27||{};
  const values=[f?.preferredFullName,f?.hrFirstLast,f?.hrFullName,f?.teachingAssignmentName,summary?.displayName];
  if(f?.firstName&&f?.lastName)values.push(`${f.firstName} ${f.lastName}`);
  return uniqueSorted(values);
 }
 function safeUnavailableRanges(f){
  const seen=new Set(),out=[];
  for(const record of Array.isArray(f?.awayFromCampusRecords)?f.awayFromCampusRecords:[]){
   const startDate=text(record?.startDate).slice(0,10),endDate=text(record?.endDate).slice(0,10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)continue;
   const key=`${startDate}|${endDate}`;if(seen.has(key))continue;seen.add(key);out.push({startDate,endDate});
  }
  return out.sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.endDate.localeCompare(b.endDate));
 }
// The sanitized swap projection is readable by any ready non-office account, so
// its entry shape is pinned in code. Firestore rules can pin the document
// envelope but cannot iterate a list, so this guard is the per-entry control.
const SWAP_ENTRY_FIELDS=Object.freeze(['key','name','aliases','unavailableRanges']);
const PRIVATE_LOOKING=/(?:@|^\d{6,}$)/;
function assertSanitizedSwapEntry(entry){
  for(const field of Object.keys(entry))if(!SWAP_ENTRY_FIELDS.includes(field))throw Error(`Swap index entry contains a field outside the sanitized projection: ${field}`);
  for(const value of [entry.name,...(Array.isArray(entry.aliases)?entry.aliases:[])])if(PRIVATE_LOOKING.test(String(value||'')))throw Error('Swap index entry contains an address or identifier outside the sanitized projection.');
  return entry;
}
 function buildFacultySwapIndexes(facultyRows,previousMap={},keyFactory){
  if(typeof keyFactory!=='function')throw Error('A swap candidate key factory is required.');
  const previous=new Map((Array.isArray(previousMap?.entries)?previousMap.entries:[]).map(row=>[text(row?.facultyId),text(row?.key)]).filter(([id,key])=>id&&key));
  const used=new Set(previous.values()),publicEntries=[],privateEntries=[];
  const rows=(Array.isArray(facultyRows)?facultyRows:[]).filter(f=>f&&f.active!==false).map(f=>({f,id:text(f.__id||f.id||f.ucid)})).filter(x=>x.id);
  for(const {f,id} of rows){
   let key=previous.get(id)||'';
   if(!key){for(let i=0;i<20&&!key;i++){const candidate=text(keyFactory());if(candidate&&!used.has(candidate))key=candidate}if(!key)throw Error(`Could not allocate an opaque swap key for ${id}.`)}
   used.add(key);
   const aliases=swapAliases(f),name=text(f.preferredFullName||f.hrFirstLast||f.hrFullName||f.teachingAssignmentName||aliases[0]||'Faculty');
   publicEntries.push(assertSanitizedSwapEntry({key,name,aliases,unavailableRanges:safeUnavailableRanges(f)}));
   privateEntries.push({key,facultyId:id});
  }
  publicEntries.sort((a,b)=>a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
  const order=new Map(publicEntries.map((row,i)=>[row.key,i]));privateEntries.sort((a,b)=>(order.get(a.key)??0)-(order.get(b.key)??0));
  return{publicIndex:{schemaVersion:'ucvm-faculty-swap-index-v1',entries:publicEntries},privateMap:{schemaVersion:'ucvm-faculty-swap-map-v1',entries:privateEntries}};
 }
 function swapNorm(v){return text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
 function sessionNames(session){
  const names=[];for(const a of Array.isArray(session?.assignments)?session.assignments:[])if(a?.name)names.push(a.name);
  if(!names.length)for(const name of text(session?.instructor).split(';').map(x=>x.trim()).filter(Boolean))names.push(name);
  return names;
 }
 function assessSwapCandidate(candidate,sessions,targetSession){
  const date=text(targetSession?.date).slice(0,10),targetId=text(targetSession?.id),aliases=new Set((Array.isArray(candidate?.aliases)?candidate.aliases:[]).concat(candidate?.name||'').map(swapNorm).filter(Boolean));
  const afcUnavailable=(Array.isArray(candidate?.unavailableRanges)?candidate.unavailableRanges:[]).some(r=>text(r?.startDate)<=date&&date<=text(r?.endDate));
  const check=scheduling.findFacultyConflicts({date,start:targetSession?.start,end:targetSession?.end,timeUnknown:targetSession?.timeUnknown===true,
   sessions,excludeSessionId:targetId,isAssigned:session=>sessionNames(session).some(name=>aliases.has(swapNorm(name)))});
  const safe=session=>({course:text(session?.course)||'Course',start:text(session?.start),end:text(session?.end)});
  const conflicts=check.conflicts.map(safe),possible=check.possibleConflicts.map(safe);
  return{available:(afcUnavailable||check.status==='conflict')?false:(check.status==='check_needed'?null:true),afcUnavailable,conflicts,possible};
 }
 function conflictText(row){const time=row.start&&row.end?` ${row.start}-${row.end}`:'';return `${row.course||'Course'}${time}`}
 function swapCandidateDisplay(assessment){
  const a=assessment||{};
  if(Array.isArray(a.conflicts)&&a.conflicts.length)return{label:'Unavailable',detail:`Conflict: ${a.conflicts.map(conflictText).join('; ')}`};
  if(a.afcUnavailable)return{label:'Unavailable',detail:''};
  if(Array.isArray(a.possible)&&a.possible.length)return{label:'Check needed',detail:`Possible conflict: ${a.possible.map(conflictText).join('; ')}`};
  if(a.available===null)return{label:'Check needed',detail:'Session timing is not confirmed.'};
  return{label:'Available',detail:''};
 }
 return{facultyEntry,facultySearchText,sessionFacultyIds,buildFacultyIndex,scheduleStats,dateChunks,buildFacultySwapIndexes,assessSwapCandidate,swapCandidateDisplay};
});
