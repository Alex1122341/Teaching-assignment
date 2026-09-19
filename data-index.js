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
 function managedRoleDOE(faculty){
  return(Array.isArray(faculty?.managedRoles2026_27)?faculty.managedRoles2026_27:[]).reduce((total,row)=>{
   const credit=Math.abs(number(row?.doeCredit)||0);
   return total+(text(row?.action).toLowerCase()==='remove'?-credit:credit);
  },0);
 }
 function normalizedVersionCounts(value){
  const result={};for(const [key,count] of Object.entries(value||{})){const n=Number(count)||0;if(key&&n>0)result[key]=n}return result;
 }
 function legacyEvidenceCount(entry){return(Number(entry?.legacyDoeCount)||0)+(Number(entry?.legacyDoeEvidenceCount)||0)}
 function doeStatus(entry){
  if((Number(entry?.missingDoeCount)||0)>0)return'error';
  const versions=Object.keys(normalizedVersionCounts(entry?.policyVersionCounts)),legacy=legacyEvidenceCount(entry);
  if(versions.length>1||(versions.length&&legacy>0))return'mixed';
  if(versions.length===1)return'policy';
  if(legacy>0)return'legacy';
  return number(entry?.assignedTeachingDOE)!==null?'source':'unavailable';
 }
 function policyVersion(entry){
  const versions=Object.keys(normalizedVersionCounts(entry?.policyVersionCounts)).sort(),legacy=legacyEvidenceCount(entry);
  if(versions.length>1||(versions.length&&legacy>0))return'mixed';
  if(versions.length===1)return versions[0];
  return legacy>0?'legacy':'';
 }
 function recomputeFacultyDoe(entry){
  const next={...(entry||{})},scheduled=number(next.scheduledDOE)??0,fixed=number(next.sourceNonTimetableTeachingDOE),sourceAssigned=number(next.sourceAssignedTeachingDOE),sourceScheduled=number(next.sourceScheduledTeachingDOE),role=number(next.managedRoleDOE)??0;
  let assigned=null;
  if(fixed!==null)assigned=fixed+scheduled+role;
  else if(sourceAssigned!==null)assigned=sourceAssigned+(sourceScheduled!==null?scheduled-sourceScheduled:0)+role;
  else if((Number(next.sessionCount)||0)>0||scheduled!==0||role!==0)assigned=scheduled+role;
  next.assignedTeachingDOE=assigned===null?null:Number(assigned.toFixed(6));
  next.policyVersionCounts=normalizedVersionCounts(next.policyVersionCounts);
  next.policyVersionId=policyVersion(next);
  next.calculationStatus=doeStatus(next);
  const target=number(next.effectiveTargetDOE);
  next.remainingDOE=target!==null&&next.assignedTeachingDOE!==null&&next.calculationStatus!=='error'?Number((target-next.assignedTeachingDOE).toFixed(6)):null;
  return next;
 }
 function facultyEntry(id,faculty,sessionStats={}){
  const f=faculty||{},o=DOE.override(f),target=DOE.effectiveTarget(f),facultyId=text(id||f.__id||f.id||f.ucid),name=text(f.preferredFullName||f.hrFirstLast||f.hrFullName||f.teachingAssignmentName||facultyId);
  const summary=f.facultySummary2026_27,roles=Array.isArray(summary?.roles)?summary.roles:[];
  const legacyRoleRows=Array.isArray(f.managedRoles2026_27)?f.managedRoles2026_27.filter(row=>number(row?.doeCredit)!==null):[];
  const hasLegacySummaryDoe=[summary?.sourceNonTimetableTeachingDOE,summary?.assignedTeachingDOE,summary?.sourceScheduledTeachingDOE].some(value=>number(value)!==null);
  const legacyDoeEvidenceCount=legacyRoleRows.length+(hasLegacySummaryDoe?1:0);
  const base={id:facultyId,name,hrName:text(f.hrFullName),email:text(f.email),rank:text(f.rank||f.currentTitle),appointmentType:text(f.appointmentType),campus:text(f.campus),department:text(f.primaryDepartment||f.department),specialty:text(f.teachingArea||f.teachingAreaEmphasis||f.boardSpecialties),reportsTo:text(f.reportsTo),active:f.active!==false,status:text(f.status||'current'),contractTeachingDOE:DOE.contract(f),overrideDOE:o.value,overrideReason:o.reason,effectiveTargetDOE:target.value,targetSource:target.source,sessionCount:Number(sessionStats.count)||0,scheduledDOE:number(sessionStats.assignedDOE)??0,missingDoeCount:Number(sessionStats.missingDoeCount)||0,legacyDoeCount:Number(sessionStats.legacyDoeCount)||0,legacyDoeEvidenceCount,legacyDoeEvidenceOnly:legacyDoeEvidenceCount>0,policyVersionCounts:normalizedVersionCounts(sessionStats.policyVersionCounts),sourceNonTimetableTeachingDOE:number(summary?.sourceNonTimetableTeachingDOE),sourceAssignedTeachingDOE:number(summary?.assignedTeachingDOE),sourceScheduledTeachingDOE:number(summary?.sourceScheduledTeachingDOE),managedRoleDOE:managedRoleDOE(f),hasSummary:!!(summary&&typeof summary==='object'),hasWorkload:!!(f.workloadPolicy2026_27&&typeof f.workloadPolicy2026_27==='object'),roleTypes:uniqueSorted(roles.map(r=>r?.type)),afcRecordCount:Array.isArray(f.awayFromCampusRecords)?f.awayFromCampusRecords.length:0,searchText:facultySearchText({...f,__id:facultyId})};
  return recomputeFacultyDoe(base);
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
  for(const session of Array.isArray(sessions)?sessions:[])for(const assignment of Array.isArray(session?.assignments)?session.assignments:[]){
   const id=text(assignment?.ucid||assignment?.facultyId);if(!id)continue;
   const row=stats.get(id)||{count:0,assignedDOE:0,missingDoeCount:0,legacyDoeCount:0,policyVersionCounts:{}};row.count++;
   const credit=number(assignment?.doeCredit),version=text(assignment?.doePolicyVersionId);
   if(credit===null)row.missingDoeCount++;else{row.assignedDOE+=credit;if(version)row.policyVersionCounts[version]=(row.policyVersionCounts[version]||0)+1;else row.legacyDoeCount++}
   stats.set(id,row);
  }
  const entries=(Array.isArray(facultyRows)?facultyRows:[]).map(f=>{const id=text(f?.__id||f?.id||f?.ucid);return facultyEntry(id,f,stats.get(id)||{})}).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
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
   publicEntries.push({key,name,aliases,unavailableRanges:safeUnavailableRanges(f)});
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
 return{facultyEntry,facultySearchText,sessionFacultyIds,buildFacultyIndex,recomputeFacultyDoe,scheduleStats,dateChunks,buildFacultySwapIndexes,assessSwapCandidate,swapCandidateDisplay};
});
