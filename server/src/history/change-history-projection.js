'use strict';
const {calgaryAcademicYear,validYear,yearOfDate,overlapsYear}=require('./history-year');

// These are audit adapters, not a serializer for arbitrary audit JSON. All values
// reaching a browser/export must pass a domain allowlist below.
const PUBLIC_EVENTS=new Set(['session_updated','session_created','session_assignments_replaced','swap_applied','session_deleted']);
const LOOKUP_EVENTS=new Set(['FacultyUpdated','FacultyDeactivated','FacultyRestored','role_periods_updated']);
const TRAINEE_EVENTS=new Set(['trainee_source_refreshed','trainee_source_recovered']);
const AFC_EVENTS=new Set(['afc_form_uploaded','afc_form_linked','afc_record_created','afc_record_cancelled','afc_request_submitted','afc_request_withdrawn','afc_request_recommended','afc_request_approved','afc_request_rejected']);
const DOE_ACTIONS=new Set(['draft_created','draft_updated','working_draft_created','published','archived']);
const PRIVATE_DOE_ENTITIES=new Set(['doe_assignment','faculty_doe_target','manual_doe_assignment']);
const WORK_EVENTS=new Set(['calendar_activity_import_committed','calendar_activity_import_recovered','calendar_activity_time_resolved','ccc_activity_added','ccc_activity_removed']);
const SESSION_FIELDS={courseCode:'Course',courseName:'Course name',topic:'Topic',sessionType:'Session type',date:'Date',startTime:'Start time',endTime:'End time',room:'Room'};
const FACULTY_FIELDS={displayName:'Display name',preferredFirstName:'Preferred first name',preferredLastName:'Preferred last name',ucid:'UCID',email:'Email',recordType:'Record type',stream:'Stream',rank:'Rank',fte:'FTE',active:'Active',reportsToFacultyId:'Reports to faculty record'};
const PROFILE_FIELDS=['teachingArea','professionalCategory','serviceDate','priorYearsExperience','dvmEarnedDate','dvmType','mastersEarnedDate','mastersArea','phdEarnedDate','phdArea','boardCertifiedDate','boardCertification','boardCertificationCount','abvmaLicenseNumber','abvmaMemberType'];
const AFC_FIELDS={startDate:'Start date',endDate:'End date',reasonCode:'Reason',purpose:'Purpose',notes:'Notes',active:'Active',status:'Status',workDays:'Work days'};
const parse=value=>{if(value&&typeof value==='object')return value;try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'?parsed:{};}catch(_){return {};}};
const get=(value,key)=>{if(!value||Array.isArray(value))return undefined;const actual=Object.keys(value).find(k=>k.toLowerCase()===key.toLowerCase());return actual===undefined?undefined:value[actual];};
const id=value=>typeof value==='string'?value.toLowerCase():'';
const scalar=value=>value===undefined?'Not recorded':value===null?'—':typeof value==='boolean'?(value?'Yes':'No'):['string','number'].includes(typeof value)?String(value):'Not recorded';
const array=value=>Array.isArray(value)?value:[];
const unique=values=>[...new Set(values.filter(Boolean))];
function assignments(value){return Array.isArray(value)?value:array(get(value,'assignments'));}
function recordedFaculty(value){
 const direct=get(value,'facultyId');return [...(direct?[{facultyId:direct,displayName:get(value,'displayName')||get(value,'facultyName')}]:[]),...assignments(value)];
}
function assignmentText(value,people){
 return assignments(value).map(a=>{
  const person=people.find(p=>id(get(p,'facultyId'))===id(get(a,'facultyId')));
  const name=get(a,'sourceFacultyName')||get(a,'facultyDisplayName')||get(person,'displayName')||'Faculty name not recorded';
  const role=get(a,'teachingRole');return String(name)+(role?' · '+String(role):'');
 }).sort().join('; ')||'None recorded';
}
function contextValues(before,after,context,key){return unique([get(before,key),get(after,key),get(context,key)].filter(v=>typeof v==='string'));}
function policyRows(book,admin){
 const result={};if(!book||typeof book!=='object')return result;
 const allowed=['ruleKey','category','activityType','ruleLabel','priority','calculationMode','tierStrategy','formulaText','mappingRequirement','resultKind','referenceId','enabled','reviewStatus'];
 const nested={selectors:['field','operator','valueType','valueText','valueNumber','valuesJson'],parameters:['name','valueNumber','valueText'],tiers:['tierOrder','fromValue','toValue','rate','fixedCredit'],inputs:['inputName','source','required']};
 for(const rule of array(get(book,'rules'))){
  const key=get(rule,'ruleKey');if(typeof key!=='string'||!key)continue;
  const dto={};for(const field of allowed){const value=get(rule,field);if(value!==undefined)dto[field]=value;}
  for(const [field,keys] of Object.entries(nested))dto[field]=array(get(rule,field)).filter(row=>admin||!/(faculty|ucid|email)/i.test(String(get(row,'field')||''))).map(row=>Object.fromEntries(keys.filter(k=>get(row,k)!==undefined).map(k=>[k,get(row,k)])));
  result['Rule '+key]=JSON.stringify(dto);
 }
 for(const [field,key,allowedFields] of [
  ['courseMappings','courseCode',['mappingId','courseCode','unitCount','curriculumStage','hiccEligible','referenceId','reviewStatus','enabled']],
  ['subjectMappings','subjectKey',['mappingId','subjectKey','subjectName','curriculumStage','developmentPhase','referenceId','reviewStatus','enabled']],
  ['references','title',['referenceId','title','section','tableName','pageNumber','effectiveDate','sourceReference','documentLink','reviewStatus']]
 ])for(const [index,row] of array(get(book,field)).entries()){
  const label=get(row,key);if(!label)continue;
  const identity=get(row,field==='references'?'referenceId':'mappingId')||'record '+(index+1);
  const fields=admin?[...allowedFields,field==='references'?'notes':'mappingFactsJson']:allowedFields;
  result[field+' '+label+' ['+identity+']']=JSON.stringify(Object.fromEntries(fields.filter(k=>get(row,k)!==undefined).map(k=>[k,get(row,k)])));
 }
 // Exceptions are confidential even on the global published-policy view.
 if(admin)for(const [index,row] of array(get(book,'exceptions')).entries())result['Exception '+(get(row,'exceptionId')||index+1)]=JSON.stringify(Object.fromEntries(['category','scopeType','scopeKey','facultyId','fixedDoe','resultKind','reason','sourceReference','effectiveStart','effectiveEnd','recurring','enabled','reviewStatus'].filter(k=>get(row,k)!==undefined).map(k=>[k,get(row,k)])));
 return result;
}

function projectHistoryEvent(event,auth){
 let before=parse(event.beforeJson),after=parse(event.afterJson);
 const context=parse(event.contextJson),type=event.eventType;
 const recovered=event.source==='work'&&type==='calendar_activity_import_recovered';
 if(recovered){before=Object.keys(before).length?before:after;after={};}
 const metadataOwner=AFC_EVENTS.has(type)?get(parse(event.metadataJson),'facultyId'):null;
 const lookupOwner=type.startsWith('Faculty')&&LOOKUP_EVENTS.has(type)?event.entityId:null;
 const people=[...array(get(context,'affectedFaculty')),...recordedFaculty(context),...recordedFaculty(before),...recordedFaculty(after),...[event.facultyId,metadataOwner,lookupOwner].filter(Boolean).map(facultyId=>({facultyId}))];
 const facultyIds=unique(people.map(p=>id(get(p,'facultyId'))));
 // Directory mapping labels filters only. It cannot add historical membership
 // or populate the recorded affectedFaculty / instructor display names.
 const directory=array(parse(event.directoryFacultyJson)).filter(p=>facultyIds.includes(id(get(p,'facultyId'))));
 const own=Boolean(auth.facultyId&&facultyIds.includes(id(auth.facultyId)));
 const isPublic=event.source!=='doe'&&PUBLIC_EVENTS.has(type);
 let domain;
 if(isPublic){if(auth.scope==='dashboard'||(auth.scope==='mine'&&!own))return [];domain='Teaching';}
 else if(event.source==='work'){
  if(!WORK_EVENTS.has(type)||!['mine','dashboard'].includes(auth.scope)||(!auth.admin&&!own)||(auth.scope==='mine'&&!own))return [];domain='Working schedule';
 }
 else if(auth.scope!=='dashboard')return [];
 else if(TRAINEE_EVENTS.has(type)){
  const owner=id(get(after,'facultyId')||get(before,'facultyId'));
  if(!owner||!auth.admin&&owner!==id(auth.facultyId))return [];domain='Lookup';
 }else if(LOOKUP_EVENTS.has(type)){
  const owner=type.startsWith('Faculty')?id(event.entityId):id(get(context,'facultyId'));
  if(!auth.admin&&(!auth.facultyId||owner!==id(auth.facultyId)))return [];domain='Lookup';
 }else if(AFC_EVENTS.has(type)){
  if(type==='afc_form_uploaded'&&!auth.admin)return [];
  const owner=id(get(before,'facultyId')||get(after,'facultyId')||get(context,'facultyId')||get(parse(event.metadataJson),'facultyId'));
  if(!auth.admin&&(!auth.facultyId||owner!==id(auth.facultyId)))return [];domain='AFC';
 }else if(event.source==='doe'&&PRIVATE_DOE_ENTITIES.has(event.entityType)){
  if(!auth.admin&&(!auth.facultyId||id(event.facultyId)!==id(auth.facultyId)))return [];domain='Lookup';
 }else if(event.source==='doe'&&event.entityType==='doe_policy_version'&&DOE_ACTIONS.has(type)){
  if(!auth.admin&&!(type==='published'||(type==='archived'&&get(context,'wasPublished')===true)))return [];domain='DOE Rule Book';
 }else return [];
 const occurred=event.occurredAtUtc instanceof Date?event.occurredAtUtc.toISOString():event.occurredAtUtc;
 if(typeof occurred!=='string'||!Number.isFinite(Date.parse(occurred)))return [];
 const courses=contextValues(before,after,context,'courseCode'),topics=contextValues(before,after,context,'topic');
 if(domain==='Working schedule')topics.push(...contextValues(before,after,context,'label'));
 const yearEvidence=[get(before,'academicYear'),get(after,'academicYear'),get(context,'academicYear'),event.academicYear].filter(v=>v!==undefined&&v!==null);
 const years=yearEvidence.every(validYear)?unique(yearEvidence):[];
 const hasRecordedYear=yearEvidence.length>0,ranges=[];
 if(!hasRecordedYear&&['AFC','Working schedule'].includes(domain))for(const snapshot of [before,after,context]){
  const start=get(snapshot,'startDate')||get(snapshot,'date'),end=get(snapshot,'endDate')||get(snapshot,'date')||start;
  if(yearOfDate(start)&&yearOfDate(end)&&start<=end)ranges.push([start,end]);
 }
 if(!hasRecordedYear&&domain==='Lookup')years.push(calgaryAcademicYear(occurred));
 const startDate=get(after,'startDate')??get(after,'date')??get(after,'sessionDate')??get(before,'startDate')??get(before,'date')??get(before,'sessionDate')??get(context,'date')??get(context,'startDate')??null;
 const endDate=get(after,'endDate')??get(after,'date')??get(after,'sessionDate')??get(before,'endDate')??get(before,'date')??get(before,'sessionDate')??get(context,'date')??get(context,'endDate')??startDate;
 const subjects=contextValues(before,after,context,'viscSubject');
 const base={eventId:String(event.eventId),changeDate:new Date(occurred).toISOString(),changeType:type,domain,course:courses.at(-1)||null,session:topics.at(-1)||null,academicYear:years.at(-1)||null,viscSubject:subjects.at(-1)||null,affectedFaculty:unique(people.map(p=>get(p,'sourceFacultyName')||get(p,'displayName')||get(p,'facultyDisplayName'))).join('; ')||null,status:scalar(get(after,'status')??get(context,'status')??'Recorded'),_courseValues:courses,_topicValues:topics,_facultyKeys:unique(people.map(p=>get(p,'facultyKey'))),_facultyOptions:people.filter(p=>get(p,'facultyKey')).map(p=>({key:get(p,'facultyKey'),name:get(p,'displayName')||get(p,'sourceFacultyName')||'Recorded faculty'})),_years:unique(years),_subjects:subjects};
 base._years=unique(years.filter(validYear));base._ranges=ranges;
 Object.assign(base,{startDate,endDate,startTime:get(after,'startTime')??get(before,'startTime')??get(context,'startTime')??null,endTime:get(after,'endTime')??get(before,'endTime')??get(context,'endTime')??null});
 if(typeof event.actorName==='string'&&event.actorName.trim()&&!/[@\x00-\x1f]|^[0-9a-f-]{32,36}$|^(?:uid|firebase)[:_-]/i.test(event.actorName)&&event.actorName.length<=260)base.actor=event.actorName.trim();
 base._facultyKeys=unique([...base._facultyKeys,...directory.map(p=>get(p,'facultyKey'))]);
 base._facultyOptions.push(...directory.filter(p=>get(p,'facultyKey')).map(p=>({key:get(p,'facultyKey'),name:(get(p,'displayName')||'Faculty name not recorded')+' (current directory)'})));
 if(recovered)base.status='Removed';
 if(type==='afc_form_uploaded')base.status='Uploaded document';
 if(event.source==='work'&&type==='calendar_activity_import_committed')base.status='Added';
 if(event.source==='work'&&type==='ccc_activity_added')base.status='Added';
 if(event.source==='work'&&type==='ccc_activity_removed')base.status='Removed';
 const rows=[];
 const add=(field,oldValue,newValue)=>{
  if(oldValue===undefined&&newValue===undefined)return;
  if(JSON.stringify(oldValue)===JSON.stringify(newValue))return;
  rows.push({...base,rowId:String(event.eventId)+':'+rows.length,field,previousValue:scalar(oldValue),updatedValue:scalar(newValue)});
 };
 if(isPublic){
  if(type==='session_assignments_replaced'||type==='swap_applied')add('Instructors',assignmentText(before,people),assignmentText(after,people));
  if(type!=='session_assignments_replaced')for(const [key,label] of Object.entries(SESSION_FIELDS)){
   const oldValue=key==='date'?(get(before,'date')??get(before,'sessionDate')):get(before,key);
   const newValue=key==='date'?(get(after,'date')??get(after,'sessionDate')):get(after,key);
   add(label,oldValue,newValue);
  }
  if(type==='session_created'&&assignments(after).length)add('Instructors',undefined,assignmentText(after,people));
 }else if(domain==='Working schedule'){
  const fields=type==='calendar_activity_time_resolved'?{date:'Date',startTime:'Start time',endTime:'End time'}:{label:'Activity',category:'Activity type',startDate:'Start date',endDate:'End date'};
  for(const [key,label] of Object.entries(fields)){
   const oldValue=get(before,key),newValue=get(after,key);
   add(label,recovered?oldValue:type==='calendar_activity_import_committed'&&newValue!==undefined?null:oldValue,recovered&&oldValue!==undefined?null:newValue);
  }
 }else if(domain==='Lookup'){
  if(TRAINEE_EVENTS.has(type)){
   const labels=['Undergraduate','VETM 506','Fourth-year preceptor','IM','Graduate primary','Graduate co-supervisor','Postdoc'];
   for(let i=0;i<labels.length;i++)add(labels[i],get(before,'counts')?.[i],get(after,'counts')?.[i]);
   add('Source supervision DOE',get(before,'sourceDoe'),get(after,'sourceDoe'));add('Source allocation status',get(before,'allocationStatus'),get(after,'allocationStatus'));
  }else if(event.source==='doe'){
   for(const key of ['category','roleType','scopeText','courseCode','subjectKey','doeValue','resultDoe','targetDoe','contractTeachingDoe','overrideDoe','overrideReason','overrideNotes','notes','active','status','reason','revision'])add(key,get(before,key),get(after,key));
  }else
  if(type==='role_periods_updated'){const metadata=parse(event.metadataJson);add('Effective periods',get(metadata,'beforePeriods')===undefined?undefined:JSON.stringify(get(metadata,'beforePeriods')),get(metadata,'afterPeriods')===undefined?undefined:JSON.stringify(get(metadata,'afterPeriods')));}
  else{
   for(const [key,label] of Object.entries(FACULTY_FIELDS))add(label,get(before,key),get(after,key));
   for(const key of PROFILE_FIELDS)add(key,get(get(before,'professionalProfile'),key)??get(before,key),get(get(after,'professionalProfile'),key)??get(after,key));
  }
 }else if(type==='afc_form_uploaded'||type==='afc_form_linked'){for(const [key,label]of Object.entries({fileName:'Archived PDF',pageCount:'Pages',byteLength:'Bytes'}))add(label,undefined,get(after,key));}
 else if(domain==='AFC')for(const [key,label] of Object.entries(AFC_FIELDS))add(label,get(before,key),get(after,key));
 else{
  for(const key of ['revision','versionLabel','sourceReference','status'])add(key,get(before,key),get(after,key));
  const oldBook=type==='published'?get(before,'publishedRuleBook'):get(before,'ruleBook');
  const oldRows=policyRows(oldBook,auth.admin),newRows=policyRows(get(after,'ruleBook'),auth.admin);
  for(const key of unique([...Object.keys(oldRows),...Object.keys(newRows)]))add(key,oldRows[key],newRows[key]);
 }
 if(!rows.length)rows.push({...base,rowId:String(event.eventId)+':0',field:'Event summary',previousValue:'Not recorded',updatedValue:'Details not recorded in the source audit'});
 return rows;
}

function filterHistoryRows(rows,filters){
 const contains=(values,needle)=>!needle||values.some(value=>String(value).toLocaleLowerCase('en-CA').includes(needle.toLocaleLowerCase('en-CA')));
 const terms=String(filters.keyword||'').trim().toLocaleLowerCase('en-CA').split(/\s+/).filter(Boolean);
 return rows.filter(row=>{
  const haystack=[filters.academicYear,...Object.entries(publicHistoryRow(row)).filter(([key])=>key!=='rowId').map(([,value])=>value)].join(' ').toLocaleLowerCase('en-CA');
  return (!filters.domain||row.domain===filters.domain)
   &&(!filters.changeType||row.changeType===filters.changeType)
   &&contains(row._courseValues,filters.course)&&contains(row._topicValues,filters.topic)
   &&(!filters.academicYear||row._years.includes(filters.academicYear)||row._ranges?.some(([start,end])=>overlapsYear(start,end,filters.academicYear)))
   &&(!filters.faculty||row._facultyKeys.includes(filters.faculty))
   &&(!filters.viscSubject||(filters.viscSubject==='__not_recorded__'?!row._subjects.length:contains(row._subjects,filters.viscSubject)))
   &&terms.every(term=>haystack.includes(term));
 });
}
function publicHistoryRow(row){return Object.fromEntries(['rowId','changeDate','changeType','domain','course','session','academicYear','viscSubject','affectedFaculty','status','field','previousValue','updatedValue','startDate','endDate','startTime','endTime','actor'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));}
module.exports={projectHistoryEvent,filterHistoryRows,publicHistoryRow};
