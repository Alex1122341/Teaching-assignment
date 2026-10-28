'use strict';
const names=require('../domain/person-name');
const {REPORT_LIMITS,limit}=require('./report-definition');
const text=value=>value==null?'':String(value).trim(),key=value=>text(value).toLowerCase();
const number=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const time=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
const timeText=value=>value?.endsWith(':00')&&value.length===8?value.slice(0,5):value;
const unavailable=()=>Object.assign(Error('A selected report source could not be read completely.'),{code:'REPORT_SOURCE_UNAVAILABLE',status:503});
const categories={ccc:'CCC',rotation_participant:'Rotation participant',clinical_day:'Clinical day / PPVM',vetm581_rounds:'VETM581 clinical rounds',vetm571_clinical_pharmacology:'VETM571 clinical pharmacology',vetm591_presentations:'VETM591 IM presentations',teaching_excellence:'Teaching excellence'};
function bounded(rows){if(!Array.isArray(rows))throw unavailable();if(rows.length>REPORT_LIMITS.sourceRows)throw limit();return rows;}
function sourceAssignments(row){
 try{const rows=Array.isArray(row.assignments)?row.assignments:JSON.parse(row.assignmentsJson);if(!Array.isArray(rows))throw Error();return rows;}catch(_){throw unavailable();}
}
function workTime(row){
 const evidence=new Map();for(const value of Array.isArray(row.timeEvidence)?row.timeEvidence:[]){if(date(value.date)&&value.date>=row.startDate&&value.date<=row.endDate&&time(value.startTime)&&time(value.endTime)&&value.startTime<value.endTime)evidence.set(value.date,value);}
 const days=(Date.parse(row.endDate)-Date.parse(row.startDate))/86400000+1,complete=evidence.size===days;
 const entries=[...evidence.values()].sort((a,b)=>a.date.localeCompare(b.date)),unique=[...new Set(entries.map(e=>timeText(e.startTime)+'–'+timeText(e.endTime)))];
 return {timeDisplay:!entries.length?'08:30–16:30 · Default time':complete&&unique.length===1?unique[0]:'Varies · see recorded time evidence',timeEvidence:entries.length?entries.map(e=>e.date+' '+timeText(e.startTime)+'–'+timeText(e.endTime)).join('; '):null,timeStatus:complete?'Time verified':entries.length?'Needs Review · other dates default08:30–16:30':'Needs Review · default time'};
}
function historyBounds(requested){
 const bounds={};if(requested.match!=='all')return bounds;
 const following=value=>{const next=new Date(Date.parse(value)+86400000).toISOString().slice(0,10);return date(next)?next:null;};
 const lower=value=>{if(value&&(!bounds.start||value>bounds.start))bounds.start=value;},upper=value=>{if(value&&(!bounds.end||value<bounds.end))bounds.end=value;};
 for(const filter of requested.filters){
  if(filter.field!=='changedOn')continue;
  if(filter.op==='eq'){lower(filter.value);upper(following(filter.value));}
  if(filter.op==='gte')lower(filter.value);if(filter.op==='gt')lower(following(filter.value));
  if(filter.op==='lt')upper(filter.value);if(filter.op==='lte')upper(following(filter.value));
  if(filter.op==='between'){lower(filter.value[0]);upper(following(filter.value[1]));}
 }
 return bounds;
}
function createReportSources({dashboard,sessions,activities,worksheetService,historyApi}){
 async function load({definition,uid,token}){
  const {academicYear,start,end}=definition,cache=new Map(),tables={},coverage=[];let expiresAt;
  const once=(name,read)=>{if(!cache.has(name))cache.set(name,Promise.resolve().then(read));return cache.get(name);};
  const roster=()=>once('roster',async()=>bounded(await dashboard.reportFaculty()));
  const sessionRows=()=>once('sessions',async()=>bounded(await sessions.list({academicYear,includeAssignmentTargets:true,includeUnresolvedAssignmentLabels:true})).filter(row=>row.academicYear===academicYear));
  const roleRows=()=>once('roles',async()=>bounded(await dashboard.roles({academicYear})).filter(row=>row.academicYear===academicYear));
  const work=()=>once('work',async()=>{
   const rows=[],mapping=new Map(),seen=new Set(),cursors=new Set();let cursor=null;
   do{
    const page=await activities.list({actorFirebaseUid:uid,start,end,cursor,limit:100,includeFacultyKeys:true});
    for(const value of bounded(page.activities)){
     if(!text(value.activityId)||!date(value.startDate)||!date(value.endDate)||value.startDate>value.endDate)throw unavailable();
     if(value.category!=='remote_work'&&!Object.hasOwn(categories,value.category))throw unavailable();
     if(seen.has(key(value.activityId)))throw unavailable();seen.add(key(value.activityId));
     if(value.startDate<end&&value.endDate>=start&&Object.hasOwn(categories,value.category))rows.push(value);
     if(rows.length>REPORT_LIMITS.sourceRows)throw limit();
    }
    if(!Array.isArray(page.facultyKeys))throw unavailable();
    for(const pair of page.facultyKeys){const k=key(pair.facultyKey),id=key(pair.facultyId);if(!k||!id||mapping.has(k)&&mapping.get(k)!==id)throw unavailable();mapping.set(k,id);}
    cursor=page.nextCursor??null;
    if(cursor!==null){if(typeof cursor!=='string'||!cursor||cursor.length>128||cursors.has(cursor))throw unavailable();cursors.add(cursor);if(cursors.size>=100)throw limit();}
   }while(cursor!==null);
   return {rows,mapping};
  });
  const facultyMap=async()=>new Map((await roster()).map(row=>[key(row.facultyId),row]));
  const facultyLabel=(id,fallback,map)=>map.has(key(id))?names.format(map.get(key(id))):names.format(fallback)||null;
  for(const requested of definition.datasets){
   if(requested.source==='workload'){
    const [people,teaching,worksheets,scheduled,roles,working]=await Promise.all([roster(),once('teachingSummary',async()=>bounded(await dashboard.teachingSummary({academicYear}))),once('worksheets',async()=>bounded(await worksheetService.listFacultyDoe({academicYear}))),sessionRows(),roleRows(),work()]);
    const byId=rows=>new Map(rows.map(row=>[key(row.facultyId),row])),summaryById=byId(teaching),worksheetById=byId(worksheets.filter(row=>row.academicYear===academicYear));
    const unmapped=working.rows.filter(row=>row.staffingKind!=='unassigned'&&!working.mapping.has(key(row.facultyKey))).length;
    const teachingByPerson=new Map(),appointmentsByPerson=new Map(),workByPerson=new Map();
    for(const session of scheduled)for(const assignment of sourceAssignments(session)){const id=key(assignment.facultyId);if(!id)continue;if(!teachingByPerson.has(id))teachingByPerson.set(id,new Set());teachingByPerson.get(id).add(key(session.id));}
    for(const role of roles){const id=key(role.facultyId);if(!appointmentsByPerson.has(id))appointmentsByPerson.set(id,new Set());appointmentsByPerson.get(id).add(key(role.roleAssignmentId));}
    for(const activity of working.rows){const id=working.mapping.get(key(activity.facultyKey));if(!id)continue;if(!workByPerson.has(id))workByPerson.set(id,{cccCount:0,rotationCount:0,otherWorkCount:0});workByPerson.get(id)[activity.category==='ccc'?'cccCount':activity.category==='rotation_participant'?'rotationCount':'otherWorkCount']++;}
    const rows=people.filter(row=>row.active===true).map(person=>{
     const id=key(person.facultyId),summary=summaryById.get(id)||{},worksheet=worksheetById.get(id)||{},counts={cccCount:0,rotationCount:0,otherWorkCount:0};
     Object.assign(counts,workByPerson.get(id));const teachingIds=teachingByPerson.get(id)||new Set(),appointmentIds=appointmentsByPerson.get(id)||new Set();
     const values={facultyName:names.format(person),rank:text(person.rank)||null,stream:text(person.stream)||null,fte:number(person.fte),academicYear,...counts,teachingCount:teachingIds.size,appointmentCount:appointmentIds.size,
      contractTeachingDoe:number(worksheet.target?.contractTeachingDoe),status:text(worksheet.status)||'needs_review',calculationBasis:text(worksheet.calculationBasis)||null,policyReference:text(worksheet.targetPolicyVersionLabel)||null,sourceReference:text(worksheet.workloadSourceReference)||null,
      recordedTeachingDoe:number(summary.recordedTeachingDoe),recordedRoleDoe:number(summary.recordedRoleDoe),recordedDoeTotal:number(summary.recordedDoeTotal),effectiveRecordedDoeTotal:number(summary.effectiveDoeTotal)};
     for(const name of ['effectiveTargetDoe','scheduledTeachingDoe','roleDoe','rawSupervisionDoe','appliedSupervisionDoe','adjustmentDoe','assignedTeachingDoe','remainingDoe'])values[name]=number(worksheet[name]);
     return values;
    });
    tables.workload={rows,coverage:['Active faculty roster; recorded and Worksheet DOE have distinct source columns. Counts are source records, not credited days/hours.',`${unmapped} work records have unmapped faculty keys and are excluded from per-faculty counts; no name matching is used.`,`${working.rows.filter(row=>row.staffingKind==='unassigned').length} unassigned work records remain in the detail source, not a person workload.`]};
   }else if(requested.source==='schedule'){
    const [scheduled,working,map]=await Promise.all([sessionRows(),work(),facultyMap()]);
    const teaching=scheduled.map(row=>{
     const assigned=sourceAssignments(row),labels=[...new Set(assigned.map(value=>facultyLabel(value.facultyId,value.displayName||value.sourceFacultyName,map)).filter(Boolean))];
     const known=time(row.startTime)&&time(row.endTime)&&row.startTime<row.endTime;
     return {facultyName:labels.join('; ')||names.formatList(row.instructorNames)||null,sourceKind:'Teaching',curriculumYear:text(row.curriculumYear)||null,courseCode:text(row.courseCode)||null,courseName:text(row.courseName)||null,type:text(row.sessionType)||null,topic:text(row.topic)||null,startDate:date(row.date)?row.date:null,endDate:date(row.date)?row.date:null,timeDisplay:known?timeText(row.startTime)+'–'+timeText(row.endTime):null,timeEvidence:row.startTime||row.endTime?`${row.startTime||'Not provided'}–${row.endTime||'Not provided'}`:null,timeStatus:known?'Source time':'Needs Review · time not provided',room:text(row.room)||null,academicYear};
    });
    const ranges=working.rows.map(row=>({facultyName:row.staffingKind==='unassigned'?'Locum':facultyLabel(working.mapping.get(key(row.facultyKey)),row.facultyDisplayName,map),sourceKind:'Work',curriculumYear:null,courseCode:text(row.courseCode)||null,courseName:null,type:categories[row.category],topic:text(row.label)||null,startDate:row.startDate,endDate:row.endDate,...workTime(row),room:null,academicYear}));
    tables.schedule={rows:bounded([...teaching,...ranges]),coverage:['Teaching is one row per session; work is one row per original inclusive range, including weekends. Missing work times are display defaults only; source evidence, SWAP availability and DOE remain unchanged.']};
   }else if(requested.source==='roles'){
    const [roles,map]=await Promise.all([roleRows(),facultyMap()]);const rows=[];
    roles.forEach((row,index)=>{
     const recorded=Array.isArray(row.validityPeriods)?row.validityPeriods:[{startDate:row.effectiveDate||null,endDate:row.expirationDate||null}];
     const periods=recorded.length?recorded:[{none:true}];
     for(const [periodIndex,period] of periods.entries()){
      if(!period||typeof period!=='object')throw unavailable();
      const first=date(period.startDate)?period.startDate:null,last=date(period.endDate)?period.endDate:null,invalid=period.startDate&&!first||period.endDate&&!last||first&&last&&first>last;
      if(!invalid&&(first&&first>=end||last&&last<start))continue;
      rows.push({facultyName:facultyLabel(row.facultyId,row.displayName,map),roleType:text(row.roleType)||null,roleCategory:text(row.roleCategory)||null,area:text(row.courseOrSubjectOrRotation)||null,courseName:text(row.courseName)||null,details:text(row.details)||null,startDate:first,endDate:last,periodStatus:period.none?'No effective periods':invalid?'Needs Review · invalid dates':!first?'Start date not provided':!last?'Recorded period · no end date':'Recorded period',appointment:'Appointment '+(index+1),period:period.none?null:periodIndex+1,recordedDoe:number(row.doeMappedValue),overrideDoe:number(row.doeOverrideValue),effectiveDoe:number(row.effectiveDoe),basis:text(row.doeSource)||null,status:text(row.doeCalculationStatus)||'needs_review',academicYear});
     }
    });
    tables.roles={rows:bounded(rows),coverage:['Each row is a recorded validity period. Whole-appointment DOE repeats across its periods and must not be added across those rows; period gaps remain inactive. No dates or DOE values are inferred.']};
   }else if(requested.source==='history'){
    const bounds=historyBounds(requested),rows=[];
    if(bounds.start&&bounds.end&&bounds.start>=bounds.end){tables.history={rows,coverage:['Changed-on date filters do not overlap.']};continue;}
    const read=response=>{
     if(response?.status!==200){const status=[401,403,409,413,429].includes(response?.status)?response.status:503;throw Object.assign(Error(status===503?'Recorded history could not be read.':response.body?.error?.message||'Refresh the history report.'),{status,code:response.body?.error?.code||'REPORT_SOURCE_UNAVAILABLE'});}
     return response.body;
    };
    const initial=read(await historyApi.query(token,{scope:'dashboard',academicYear,...bounds}));
    if(!text(initial.snapshot)||!Number.isSafeInteger(initial.total)||initial.total<0||initial.total>REPORT_LIMITS.sourceRows||!Number.isInteger(initial.pageSize)||initial.pageSize<1||initial.pageSize>100||!Number.isFinite(Date.parse(initial.expiresAt)))throw unavailable();
    expiresAt=initial.expiresAt;
    let page=initial,offset=0;
    do{
     if(page.snapshot!==initial.snapshot||page.total!==initial.total||page.pageSize!==initial.pageSize||page.offset!==offset||!Array.isArray(page.rows)||page.rows.length!==Math.min(page.pageSize,page.total-offset))throw unavailable();
     for(const operation of page.rows){
      if(!Array.isArray(operation.records))throw unavailable();
      for(const record of operation.records){
       if(!Array.isArray(record.changes))throw unavailable();
       for(const change of record.changes){
        const evidence=value=>value==null?null:typeof value==='string'?value:JSON.stringify(value);
        rows.push({changedAt:text(operation.changeDate)||null,changedOn:date(text(operation.changeDate).slice(0,10))?text(operation.changeDate).slice(0,10):null,operation:text(operation.title)||null,domain:text(operation.domain)||null,changeType:text(operation.changeType)||null,facultyName:names.formatList(record.affectedFaculty)||null,courseCode:text(record.course)||null,session:text(record.session)||null,field:text(change.field)||null,fromValue:evidence(change.previousValue),toValue:evidence(change.updatedValue),startDate:date(record.startDate)?record.startDate:null,endDate:date(record.endDate)?record.endDate:null,actor:names.format(operation.actor)||null,academicYear});
        if(rows.length>REPORT_LIMITS.sourceRows)throw limit();
       }
      }
     }
     offset+=page.rows.length;if(offset>=initial.total)break;
     page=read(await historyApi.page(token,{snapshot:initial.snapshot,offset}));
    }while(true);
    tables.history={rows,coverage:Array.isArray(initial.coverage)?initial.coverage.filter(value=>typeof value==='string'):['Recorded authorized history only.']};
   }
   else throw unavailable();
  }
  return {tables,coverage,...(expiresAt?{expiresAt}:{})};
 }
 return Object.freeze({load});
}
module.exports={createReportSources};
