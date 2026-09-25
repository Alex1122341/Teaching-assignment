'use strict';
window.UCVM_TIMETABLE_SELECTION=(()=>{
 const scheduling=window.UCVM_SCHEDULING;
 if(!scheduling)throw new Error('UCVM scheduling core is required.');
 const text=value=>String(value??'').trim();
 const isReadOnlySynthetic=row=>Boolean(row?.isCcc||row?.isUniversityClosure);
 const facultyId=assignment=>text(assignment?.facultyId||assignment?.ucid);
 const facultyIds=row=>[...new Set((Array.isArray(row?.facultyIds)&&row.facultyIds.length?row.facultyIds:(row?.assignments||[]).map(facultyId)).map(text).filter(Boolean))];
 const clone=value=>JSON.parse(JSON.stringify(value??null));
 const canonical=value=>{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value};
 const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 const AUDIT_FIELDS={academicYear:'Academic Year',date:'Date',year:'Year',course:'Course',subjectKey:'Subject',type:'Type',start:'Start time',end:'End time',topic:'Topic',room:'Room',labGroupIds:'LAB groups',teachingAssignmentGroupId:'Teaching Assignment group',responsibleHiccResponsibilityId:'Responsible HICC responsibility',teachingAssignmentSubmissionId:'Teaching Assignment package'};
 const OWNERSHIP_FIELDS=['teachingAssignmentGroupId','responsibleHiccResponsibilityId','teachingAssignmentSubmissionId'];
 const OWNERSHIP_IDENTITY_FIELDS=['academicYear',...OWNERSHIP_FIELDS];
 const REVIEW_FIELDS=['course','subjectKey','date','start','end','timeUnknown','type','room','topic',...OWNERSHIP_IDENTITY_FIELDS];
 // The sanitized calendar contains only year/group/responsibility. Resolve its
 // canonical package ID in memory; never persist that locator in the calendar.
 function packageLocator(row){
  if(text(row?.teachingAssignmentSubmissionId))return text(row.teachingAssignmentSubmissionId);
  if(!row?.academicYear||!row?.teachingAssignmentGroupId||!row?.responsibleHiccResponsibilityId)return '';
  try{return window.UCVM_TEACHING_RESPONSIBILITY.submissionDocumentId(row.academicYear,row.teachingAssignmentGroupId,row.responsibleHiccResponsibilityId)}catch{return ''}
 }
 function workingRevisionChange(before,after,actor,timestamp,increment){
  const id=packageLocator(after);
  if(!id||!REVIEW_FIELDS.some(field=>!equal(before?.[field],after?.[field])))return null;
  if(typeof increment!=='function')throw Error('Teaching Assignment content requires an atomic package revision. Reload before saving.');
  return{id,data:{workingRevision:increment(1),workingChange:{kind:'session',id:text(after.id||before?.id)},updatedBy:text(actor?.uid),updatedAt:timestamp}};
 }
 const ownershipChanged=(before,after)=>OWNERSHIP_IDENTITY_FIELDS.some(field=>text(before?.[field])!==text(after?.[field]));
 const EDIT_FIELDS=['date','year','course','subjectKey','type','start','end','topic','room','faculty','labGroups','teachingAssignmentGroupId','responsibleHiccResponsibilityId'];
 // Field ownership comes from the canonical modules only. This function must not
 // invent a second, contradictory scope definition: office capabilities decide
 // which fields an office may edit, and the canonical workflow engine decides
 // what type of session is being edited.
 function editPolicy(role,row={},options={}){
  role=text(role).toLowerCase();
  const fields=Object.fromEntries(EDIT_FIELDS.map(field=>[field,false]));
  if(isReadOnlySynthetic(row))return{canSelect:false,fields};
  const caps=window.UCVM_OFFICE_CAPABILITIES,workflow=window.UCVM_SESSION_WORKFLOW;
  // Fail closed when the canonical policy modules are unavailable.
  if(!caps||!workflow)return{canSelect:false,fields};
  const access=caps.forRole(role),sessionType=workflow.sessionType(row);
  if(access.canEditCourseFields)for(const field of ['date','year','course','subjectKey','type','start','end','room'])fields[field]=true;
  if(role==='developer'||options.allowTeachingAssignmentOwnership===true){fields.teachingAssignmentGroupId=true;fields.responsibleHiccResponsibilityId=true}
  // ADC owns Topic for LEC / SRL. LAB owns Topic for LAB sessions only.
  fields.topic=sessionType==='LAB'?Boolean(access.canEditLabTopic):Boolean(access.canEditCourseFields);
  // Only ADFA (and Developer) may make the official Faculty assignment.
  fields.faculty=Boolean(access.canEditInstructor);
  fields.labGroups=sessionType==='LAB'&&Boolean(access.canEditLabGroups);
  return{canSelect:Boolean(access.canSelectSessions||options.allowTeachingAssignmentOwnership===true),fields};
 }
 const assignmentNames=row=>(row?.assignments||[]).map(item=>text(item?.name)||facultyId(item)).filter(Boolean);
 function auditChanges(before,after){
  const out=[];
  for(const [field,label] of Object.entries(AUDIT_FIELDS))if(!equal(before?.[field],after?.[field]))out.push({field,label,before:before?.[field]??null,after:after?.[field]??null});
  const beforeFaculty=assignmentNames(before),afterFaculty=assignmentNames(after);
  if(!equal(beforeFaculty,afterFaculty))out.push({field:'assignments',label:'Faculty',before:beforeFaculty,after:afterFaculty});
  return out;
 }
 function createViewFlow(){
  let origin='week';
  return{
   begin(view){origin=text(view)||'week';return origin},
   review(){return'list'},
   finish(){return origin}
  };
 }
 function editable(row){
  const ids=facultyIds(row),assignments=clone(Array.isArray(row?.assignments)?row.assignments:[]).map((assignment,index)=>{
   const id=facultyId(assignment)||ids[index]||'';
   return{...assignment,ucid:id||null,facultyId:id||null,name:text(assignment.name),role:text(assignment.role||row?.type)};
  });
  const instructor=assignments.map(item=>item.name).filter(Boolean).join('; ')||text(row?.instructor);
  return{academicYear:text(row?.academicYear),date:text(row?.date),week:Number(row?.week),semester:text(row?.semester),year:Number(row?.year),course:text(row?.course),courseName:text(row?.courseName),subjectKey:text(row?.subjectKey),type:text(row?.type),start:text(row?.start),end:text(row?.end),topic:text(row?.topic),room:text(row?.room),timeUnknown:Boolean(row?.timeUnknown),assignments,facultyIds:ids,instructor,labDetails:Array.isArray(row?.labDetails)?clone(row.labDetails):[],labGroupIds:[...new Set((Array.isArray(row?.labGroupIds)?row.labGroupIds:[]).map(text).filter(Boolean))],teachingAssignmentGroupId:text(row?.teachingAssignmentGroupId),responsibleHiccResponsibilityId:text(row?.responsibleHiccResponsibilityId),teachingAssignmentSubmissionId:packageLocator(row)};
 }
 function onlySubjectChanged(before,after){
  const oldFields=editable(before),newFields=editable(after);
  return oldFields.subjectKey!==newFields.subjectKey&&Object.keys(oldFields).every(field=>field==='subjectKey'||equal(oldFields[field],newFields[field]));
 }
 function onlyNonDoeMetadataChanged(before,after){
  const oldFields=editable(before),newFields=editable(after),safe=new Set(['subjectKey',...OWNERSHIP_IDENTITY_FIELDS]),changed=Object.keys(oldFields).filter(field=>!equal(oldFields[field],newFields[field]));
  return changed.length>0&&changed.every(field=>safe.has(field));
 }
 function validatedOwnership(row,options={}){
  const groupId=text(row?.teachingAssignmentGroupId),hiccId=text(row?.responsibleHiccResponsibilityId);
  if(!groupId&&!hiccId)return{teachingAssignmentGroupId:'',responsibleHiccResponsibilityId:'',teachingAssignmentSubmissionId:''};
  if(!groupId||!hiccId)throw Error('Teaching Assignment group and responsible HICC responsibility must be set together.');
  const groupsApi=window.UCVM_TEACHING_ASSIGNMENT_GROUPS;
  if(!groupsApi)throw Error('Teaching Assignment group policy is unavailable.');
  const groups=Array.isArray(options.teachingAssignmentGroups)?options.teachingAssignmentGroups:[],responsibilities=Array.isArray(options.teachingResponsibilities)?options.teachingResponsibilities:[];
  const group=groups.find(item=>text(item?.id)===groupId);
  if(!group)throw Error('Choose an active Teaching Assignment group.');
  groupsApi.validateGroupResponsibilities(group,{responsibilities});
  const academicYear=academicYearForSession(row),ownership=groupsApi.sessionOwnership({academicYear,teachingAssignmentGroupId:groupId,responsibleHiccResponsibilityId:hiccId});
  if(!groupsApi.ownershipMatchesGroup(group,{academicYear,...ownership}))throw Error('Responsible HICC responsibility does not belong to the selected Teaching Assignment group.');
  return{academicYear,...ownership};
 }
 function create(max=200){
  const selected=new Set();
  return{
   toggle(id){id=text(id);if(!id)throw Error('A session ID is required.');if(selected.has(id)){selected.delete(id);return false}if(selected.size>=max)throw Error(`Select at most ${max} sessions.`);selected.add(id);return true},
   has:id=>selected.has(text(id)),clear:()=>selected.clear(),ids:()=>[...selected],get size(){return selected.size}
  };
 }
 function validateRow(row,rowNumber,facultyById,options={}){
  const prefix=`Row ${rowNumber}: `,errors=[],ids=facultyIds(row),timing=scheduling.validateSessionTiming(row);
  if(!scheduling.normalizeDate(row?.date))errors.push(prefix+'date must be a valid YYYY-MM-DD value.');
  if(![1,2,3,4].includes(Number(row?.year)))errors.push(prefix+'year must be 1, 2, 3, or 4.');
  if(!text(row?.course))errors.push(prefix+'course is required.');
  if(!text(row?.type))errors.push(prefix+'type is required.');
  const interval=timing.reason==='invalid_date'?scheduling.validateInterval(row?.start,row?.end,{timeUnknown:row?.timeUnknown===true}):timing;
  if(interval.status==='invalid')errors.push(prefix+'end time must be after start time and use a valid timetable time.');
  const known=id=>typeof facultyById?.has==='function'?facultyById.has(id):Boolean(facultyById?.[id]);
  if(options.requireFaculty!==false&&(!ids.length||ids.some(id=>!known(id))))errors.push(prefix+'assigned faculty must contain at least one valid faculty record.');
  if(options.requireLabGroups===true&&(!Array.isArray(row?.labGroupIds)||!row.labGroupIds.some(id=>text(id))))errors.push(prefix+'at least one LAB group is required.');
  return errors;
 }
 function selectedRows(source,ids){
  const byId=new Map((source||[]).filter(row=>!isReadOnlySynthetic(row)).map(row=>[text(row.id),row]));
  return(ids||[]).map(id=>byId.get(text(id))).filter(Boolean);
 }
 function planChanges(originals,rows,actor,timestamp,facultyById,options={}){
  const originalById=new Map((originals||[]).map(row=>[text(row.id),row])),errors=[],role=text(options.role||actor?.role).toLowerCase();
  const workflow=window.UCVM_SESSION_WORKFLOW;
  const roleLabel={adc:'ADC/DVM',lab:'LAB',adfa:'ADFAD'}[workflow?.stageForRole?.(role)]||role.toUpperCase();
  (rows||[]).forEach((row,index)=>{
   const policy=role?editPolicy(role,row,{allowTeachingAssignmentOwnership:options.allowTeachingAssignmentOwnership===true}):{canSelect:true,fields:{faculty:true,teachingAssignmentGroupId:true,responsibleHiccResponsibilityId:true}};
   const original=originalById.get(text(row.id));
   // LAB works from the Work Queue on LAB sessions only. General selection is not
   // the gate; the session type is.
   const isLabSession=workflow?workflow.sessionType(row)==='LAB':Boolean(policy.fields.topic);
   if(role==='lab'&&!isLabSession)errors.push(`Row ${index+1}: LAB accounts can edit LAB sessions only.`);
   errors.push(...validateRow(row,index+1,facultyById||new Map(facultyIds(row).map(id=>[id,true])),{requireFaculty:!role||policy.fields.faculty===true,requireLabGroups:role==='lab'&&isLabSession}));
   if(!text(row.id)||!originalById.has(text(row.id)))errors.push(`Row ${index+1}: session does not exist.`);
   // A field the role does not own is refused explicitly rather than silently
   // ignored, so a locked field can never be smuggled through a stale form.
   if(role&&original){
    const attempted=[];
    if(!equal(text(original.academicYear),text(row.academicYear)))attempted.push('academicYear');
    if(!policy.fields.faculty){
     const facultyChanged=!equal(facultyIds(original),facultyIds(row))||!equal(assignmentNames(original),assignmentNames(row));
     if(facultyChanged)attempted.push('faculty assignment');
    }
    if(!policy.fields.labGroups&&!equal(original.labGroupIds||[],row.labGroupIds||[]))attempted.push('LAB groups');
    for(const field of ['date','year','course','subjectKey','type','start','end','room','topic']){
     if(policy.fields[field])continue;
     // ADC converting a session to LAB forces Topic to TBD, so that is not an attempt.
     if(role==='adc'&&field==='topic'&&text(row.type).toUpperCase()==='LAB')continue;
     if(field==='subjectKey' ? text(original[field])!==text(row[field]) : !equal(original[field],row[field]))attempted.push(field);
    }
    for(const field of OWNERSHIP_FIELDS){
     const trusted=field!=='teachingAssignmentSubmissionId'&&policy.fields[field]===true;
     if(!trusted&&text(original[field])!==text(row[field]))attempted.push(field);
    }
    if(policy.fields.teachingAssignmentGroupId&&policy.fields.responsibleHiccResponsibilityId){
     if(OWNERSHIP_FIELDS.some(field=>text(original[field]))&&!text(row.teachingAssignmentGroupId)&&!text(row.responsibleHiccResponsibilityId))errors.push(`Row ${index+1}: cannot clear Teaching Assignment ownership. Choose a valid group and responsibility.`);
     try{validatedOwnership(row,options)}catch(error){errors.push(`Row ${index+1}: ${error.message}`)}
    }
    if(policy.fields.subjectKey&&!equal(text(original.subjectKey),text(row.subjectKey))){
     const catalog=window.UCVM_SUBJECT_CATALOG,key=text(row.subjectKey),active=Array.isArray(options.activeSubjectKeys)?options.activeSubjectKeys:[];
     if(key&&(!catalog||catalog.normalizeKey(key)!==key||!active.includes(key)))errors.push(`Row ${index+1}: choose an active Subject from the catalog.`);
    }
    if(attempted.length)errors.push(`Row ${index+1}: ${roleLabel} cannot change ${attempted.join(', ')}.`);
   }
  });
  if(errors.length)return{updates:[],logs:[],errors};
  const updates=[],logs=[];
  for(const [index,row] of (rows||[]).entries()){
   const original=originalById.get(text(row.id)),before=editable(original),candidate=editable(row),policy=role?editPolicy(role,candidate,{allowTeachingAssignmentOwnership:options.allowTeachingAssignmentOwnership===true}):null;
   let after=candidate,data=candidate;
   if(policy){
    after={...before};
    const publicFields=['date','year','course','subjectKey','type','start','end','topic','room'],derivedFields=['week','semester','courseName','timeUnknown'],facultyFields=['assignments','facultyIds','instructor','labDetails'];
    for(const field of publicFields)if(policy.fields[field])after[field]=candidate[field];
    if(policy.fields.date||policy.fields.start||policy.fields.end){after.week=candidate.week;after.semester=candidate.semester;after.timeUnknown=candidate.timeUnknown}
    if(policy.fields.course)after.courseName=candidate.courseName;
    if(policy.fields.faculty)for(const field of facultyFields)after[field]=candidate[field];
    if(policy.fields.labGroups)after.labGroupIds=candidate.labGroupIds;
    if(policy.fields.teachingAssignmentGroupId&&policy.fields.responsibleHiccResponsibilityId){
     const ownership=validatedOwnership(candidate,options);
     for(const field of OWNERSHIP_FIELDS)after[field]=ownership[field];
     if(ownership.academicYear)after.academicYear=ownership.academicYear;
    }
    if(role==='adc'){
     if(text(after.type).toUpperCase()==='LAB'&&text(before.type).toUpperCase()!=='LAB')after.topic='TBD';
     after.instructor=before.instructor;
    }
    if(role==='lab')after.instructor=before.instructor;
    data={};
    for(const field of publicFields)if(!equal(before[field],after[field]))data[field]=after[field];
    for(const field of derivedFields)if(!equal(before[field],after[field]))data[field]=after[field];
    if(policy.fields.faculty)for(const field of facultyFields)if(!equal(before[field],after[field]))data[field]=after[field];
    if(policy.fields.labGroups&&!equal(before.labGroupIds,after.labGroupIds))data.labGroupIds=after.labGroupIds;
    if(policy.fields.teachingAssignmentGroupId&&policy.fields.responsibleHiccResponsibilityId)for(const field of OWNERSHIP_IDENTITY_FIELDS)if(!equal(before[field],after[field]))data[field]=after[field];
   }
   if(equal(before,after))continue;
   if(ownershipChanged(before,after)&&Object.keys(before).some(field=>!OWNERSHIP_IDENTITY_FIELDS.includes(field)&&!equal(before[field],after[field]))){errors.push(`Row ${index+1}: save Teaching Assignment ownership separately from other changes.`);continue}
   updates.push({id:text(row.id),data,after});
   logs.push({sessionId:text(row.id),action:'batch_update',changedBy:text(actor?.uid),changedByEmail:text(actor?.email),changedByName:text(actor?.name),changedAt:timestamp,before,after,changes:auditChanges(before,after),course:after.course,date:after.date,topic:after.topic,rowNumber:index+1});
  }
  return errors.length?{updates:[],logs:[],errors}:{updates,logs,errors:[]};
 }
 function createOwnershipAdapter({db,actor,configurationReady,calendarFromSource,sessionCollection='sessions',logCollection='session_change_log'}={}){
  const ref=(collection,id)=>db.collection(collection).doc(id);
  const packageRef=id=>ref('teaching_assignment_submissions',id);
  const snapshotData=snapshot=>snapshot?.exists?snapshot.data():null;
  const hasOwnership=row=>OWNERSHIP_FIELDS.some(field=>text(row?.[field]));
  const mutable=row=>['draft','changes_requested','visc_approved'].includes(row?.status);
  function locator(row){
   const id=window.UCVM_TEACHING_RESPONSIBILITY.submissionDocumentId(text(row.academicYear),text(row.teachingAssignmentGroupId),text(row.responsibleHiccResponsibilityId));
   if(id!==row.teachingAssignmentSubmissionId)throw Error('Teaching Assignment ownership locator is incomplete or stale. Reopen the selection; an Owner may need to repair its calendar projection.');
   return id;
  }
  async function currentContext(transaction,row){
   const id=locator(row),group=snapshotData(await transaction.get(ref('teaching_assignment_groups',row.teachingAssignmentGroupId)));
   if(!group||group.active!==true||group.id!==row.teachingAssignmentGroupId||!window.UCVM_TEACHING_ASSIGNMENT_GROUPS.groupContainsHicc(group,row.responsibleHiccResponsibilityId))throw Error('Choose an active Teaching Assignment group containing the responsibility.');
   const hicc=snapshotData(await transaction.get(ref('teaching_responsibilities',row.responsibleHiccResponsibilityId))),visc=snapshotData(await transaction.get(ref('teaching_responsibilities',group.leaderViscResponsibilityId)));
   if(hicc?.active!==true||hicc.kind!=='hicc'||hicc.id!==row.responsibleHiccResponsibilityId||hicc.groupId!==group.id||visc?.active!==true||visc.kind!=='visc'||visc.id!==group.leaderViscResponsibilityId)throw Error('Teaching Assignment responsibility configuration is no longer active. Reopen the selection.');
   const academic=window.UCVM_ACADEMIC_RESPONSIBILITY;
   if(academic.normalizeCourse(row.course)!==row.course||!academic.hasScope({role:'hicc',academicScopeTokens:hicc.academicScopeTokens},'hicc',row))throw Error('Responsible HICC does not cover this exact Course/Subject.');
   return{id,academicYearKey:row.academicYear,groupId:group.id,hiccResponsibilityId:hicc.id,viscResponsibilityId:visc.id};
  }
  function validatePackage(row,identity){
   if(!row||Object.keys(identity).some(key=>row[key]!==identity[key]))throw Error('Teaching Assignment package identity is missing or stale. Reopen the selection.');
   if(!mutable(row))throw Error('Teaching Assignment package is frozen during review or after final submission.');
   if(!Number.isSafeInteger(row.workingRevision)||row.workingRevision<0||row.workingRevision>=Number.MAX_SAFE_INTEGER-1)throw Error('Teaching Assignment working revision is invalid.');
  }
  async function readContext(transaction,update,log){
   if(typeof configurationReady!=='function'||configurationReady()!==true)throw Error('Teaching Assignment configuration is unavailable. Reload before saving ownership.');
   const profile=snapshotData(await transaction.get(ref('users',text(actor?.uid)))),general=window.UCVM?.general?.(profile)===true;
   if(profile?.active!==true||profile.mustChangePassword===true||(!general&&!window.UCVM_OFFICE_CAPABILITIES.hasOfficeAccess(profile,'adc')))throw Error('Teaching Assignment ownership permission is required.');
   const calendar=snapshotData(await transaction.get(ref('calendar_sessions',update.id)));
   if(!calendar)throw Error('The calendar projection is missing. An Owner must repair it before saving ownership.');
   // ADC never reads the private session source. Its transaction uses the safe
   // calendar projection; rules prove the ownership patch against the source.
   const source=general?snapshotData(await transaction.get(ref(sessionCollection,update.id))):{...calendar,teachingAssignmentSubmissionId:packageLocator(calendar)};
   const before=general?editable(source):calendarFromSource(source,update.id),expected=general?editable(log.before):calendarFromSource(log.before,update.id);
   if(!source||!equal(before,expected))throw Error('This session changed after it was loaded. Reopen the selection before saving.');
   const after={...source,...Object.fromEntries(OWNERSHIP_IDENTITY_FIELDS.map(key=>[key,update.after[key]]))};
   const identity=await currentContext(transaction,after),target=snapshotData(await transaction.get(packageRef(identity.id)));
   if(target)validatePackage(target,identity);
   const packages=target?[target]:[];
   if(hasOwnership(source)&&locator(source)!==identity.id){
    const oldIdentity=await currentContext(transaction,source),old=snapshotData(await transaction.get(packageRef(oldIdentity.id)));validatePackage(old,oldIdentity);packages.push(old);
   }
   return{calendar,source,after,identity,target,packages};
  }
  async function save(update,log){
   try{
    if(!ownershipChanged(log.before,log.after)||!update.after||!hasOwnership(update.after))throw Error('Cannot clear Teaching Assignment ownership. Choose a valid group and responsibility.');
    const allowed=new Set([...OWNERSHIP_IDENTITY_FIELDS,'updatedBy','updatedByName','updatedAt']);
    if(Object.keys(update.data).some(key=>!allowed.has(key))||Object.keys(editable(log.before)).some(key=>!OWNERSHIP_IDENTITY_FIELDS.includes(key)&&!equal(editable(log.before)[key],editable(log.after)[key])))throw Error('Save Teaching Assignment ownership separately from other changes.');
    const meta={updatedBy:text(actor?.uid),updatedAt:log.changedAt};
    // An empty draft is a separate initialization. It never claims a content
    // revision; a failed later attachment can leave only this harmless draft.
    const initialized=await db.runTransaction(async transaction=>{
     const context=await readContext(transaction,update,log);
     if(context.target)return 0;
     transaction.set(packageRef(context.identity.id),{...context.identity,status:'draft',revision:0,workingRevision:0,submittedWorkingRevision:null,viscApprovedWorkingRevision:null,reviewFingerprint:'',viscApprovedFingerprint:'',viscReviewComment:'',submittedForReviewAt:null,viscReviewedAt:null,finalSubmittedAt:null,...meta});return 1;
    });
    const logRef=ref(logCollection);
    const operations=await db.runTransaction(async transaction=>{
     const context=await readContext(transaction,update,log);
     if(!context.target)throw Error('Teaching Assignment package disappeared. Reopen the selection.');
     const patch={...Object.fromEntries(OWNERSHIP_IDENTITY_FIELDS.map(key=>[key,context.after[key]])),...meta};
     if(typeof update.data.updatedByName==='string')patch.updatedByName=update.data.updatedByName;
     const projected=calendarFromSource(context.after,update.id);
     projected.instructorNames=context.calendar.instructorNames;
     transaction.update(ref(sessionCollection,update.id),patch);
     transaction.set(ref('calendar_sessions',update.id),projected);
     transaction.set(logRef,{...log,changedBy:meta.updatedBy,changedAt:meta.updatedAt});
     for(const row of context.packages)transaction.update(packageRef(row.id),{workingRevision:row.workingRevision+1,workingChange:{kind:'session',id:update.id},...meta});
     return 3+context.packages.length;
    });
    return{operations:initialized+operations};
   }catch(error){error.ownershipSave=true;if(error.code==='permission-denied')error.message='Ownership could not be verified. Reload the selection; an Owner may need to repair legacy calendar ownership metadata.';throw error}
  }
  return Object.freeze({save});
 }
 async function commitPlan(plan,store,options={}){
  if(plan.errors?.length||!plan.updates?.length)return{committed:false,operations:0,completedRows:0,errors:[...(plan.errors||[])]};
  if(plan.updates.length!==plan.logs?.length)throw Error('Each session update must have one audit log.');
  const chunkSize=Number.isInteger(options.chunkSize)&&options.chunkSize>0?options.chunkSize:plan.updates.length;
  const resumeFrom=Math.max(0,Math.min(Number(options.resumeFrom)||0,plan.updates.length));
  let completedRows=resumeFrom,operations=0,batchIndex=0;
  for(let start=resumeFrom;start<plan.updates.length;){
   const ownership=ownershipChanged(plan.logs[start].before,plan.logs[start].after);
   let end=ownership?start+1:Math.min(start+chunkSize,plan.updates.length);
   for(let index=start+1;index<end;index++)if(ownershipChanged(plan.logs[index].before,plan.logs[index].after)){end=index;break}
   if(ownership){
    try{
     if(typeof store.commitOwnership!=='function')throw Error('Teaching Assignment ownership requires its trusted transaction adapter.');
     if(typeof store.stageExtraWrites==='function')throw Error('Save Teaching Assignment ownership separately from LAB roster changes.');
     const result=await store.commitOwnership(plan.updates[start],plan.logs[start]);operations+=Number(result?.operations)||0;
    }catch(error){error.partialCommit=completedRows>0;error.completedRows=completedRows;error.resumeFrom=completedRows;throw error}
   }else{
   const batch=store.batch(),packages=new Map();
   for(let index=start;index<end;index++){
    const update=plan.updates[index],log=plan.logs[index];
    batch.update(store.sessionRef(update.id),update.data);operations++;
    if(store.calendarRef&&store.calendarFromSource){batch.set(store.calendarRef(update.id),store.calendarFromSource(update.after||update.data,update.id));operations++}
    batch.set(store.logRef(),log);operations++;
    // The existing ADC/LAB editor remains usable after trusted ownership is
    // attached. Firestore evaluates the increment and witness with this batch;
    // no package read (or private source read) is granted to an office writer.
    const packageId=packageLocator(log.after);
    if(packageId&&REVIEW_FIELDS.some(field=>!equal(log.before?.[field],log.after?.[field]))&&!packages.has(packageId))packages.set(packageId,log);
    if(!onlyNonDoeMetadataChanged(log.before,log.after)&&typeof store.queueRef==='function'&&typeof store.queueData==='function'){
     const queueRef=store.queueRef(update,log),queueData=queueRef?store.queueData(update,log,queueRef):null;
     if(queueRef&&queueData){batch.set(queueRef,queueData);operations++}
    }
    if(typeof store.stageExtraWrites==='function'){const extra=Number(store.stageExtraWrites({batch,update,log,index})||0);if(Number.isFinite(extra)&&extra>0)operations+=extra}
    const calculationRecords=Array.isArray(update.calculationRecords)?update.calculationRecords:[];
    if(calculationRecords.length)throw Error('DOE calculation evidence must be persisted by the server-side DOE API.');
   }
   for(const [id,log] of packages){
    if(typeof store.packageRef!=='function'||typeof store.increment!=='function')throw Error('Teaching Assignment content requires an atomic package revision. Reload before saving.');
    const change=workingRevisionChange(log.before,{...log.after,id:log.sessionId},{uid:log.changedBy},log.changedAt,store.increment);
    batch.update(store.packageRef(id),change.data);operations++;
   }
   try{await batch.commit()}catch(error){error.partialCommit=completedRows>0;error.completedRows=completedRows;error.resumeFrom=completedRows;throw error}
   }
   completedRows=end;
   const progress={completedRows,totalRows:plan.updates.length,batchIndex:++batchIndex,batchTotal:Math.ceil((plan.updates.length-resumeFrom)/chunkSize)};
   if(typeof store.onProgress==='function')store.onProgress(progress);
   try{if(typeof store.afterBatch==='function')await store.afterBatch({start,end,updates:plan.updates.slice(start,end),logs:plan.logs.slice(start,end),progress})}
   catch(error){error.committed=true;error.partialCommit=true;error.completedRows=completedRows;error.resumeFrom=completedRows;throw error}
   start=end;
  }
  try{if(typeof store.afterCommit==='function')await store.afterCommit()}catch(error){error.committed=true;error.partialCommit=true;error.completedRows=completedRows;error.resumeFrom=completedRows;throw error}
  return{committed:true,operations,completedRows,errors:[]};
 }
 function academicYearForSession(session={}){
  const explicit=text(session?.academicYear);
  if(explicit)return explicit;
  const date=text(session?.date),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if(!match)throw Error('A valid session date is required to resolve Academic Year.');
  const year=Number(match[1]),month=Number(match[2]),semester=text(session?.semester).toLowerCase();
  const start=semester==='winter'?year-1:(semester==='spring'||semester==='fall'?year:(month<=4?year-1:year));
  return`${start}-${String(start+1).slice(-2)}`;
 }
 function stableAssignmentId(session,assignment,index){
  const existing=text(assignment?.assignmentId);
  if(existing)return existing;
  const sessionId=text(session?.id)||'session';
  return`${sessionId}--assignment--${Number(index)+1}`;
 }
 function stripAssignmentDoeForApi(assignment={}){
  const next={...assignment};
  for(const field of ['doeCredit','doePolicyVersionId','doeRuleId','doeRuleKey','doeCalculationId','doeRate','resultDoe','policyVersionId','ruleId','ruleKey','calculationId'])delete next[field];
  return next;
 }
 function createDoeApiAdapter({api}={}){
  if(!api||typeof api.previewSessionChange!=='function')throw Error('DOE API previewSessionChange is required.');
  async function prepareSession(before,after,{trigger='session_updated'}={}){
   const payload={academicYear:academicYearForSession(after),sessionId:text(after?.id||after?.sessionId||before?.id||before?.sessionId),beforeSession:clone(before),afterSession:clone(after),trigger};
   if(payload.afterSession&&Array.isArray(payload.afterSession.assignments))payload.afterSession.assignments=payload.afterSession.assignments.map(stripAssignmentDoeForApi);
   return api.previewSessionChange(payload);
  }
  return Object.freeze({prepareSession,academicYearForSession});
 }
 function createDoeAdapter({service,engine}={}){
  if(!service||typeof service.activePolicyForYear!=='function')throw Error('DOE policy service is required.');
  if(!engine||typeof engine.calculate!=='function')throw Error('DOE policy engine is required.');
  if(typeof service.buildCalculationRecord!=='function')throw Error('DOE calculation record builder is required.');
  const activeBundles=new Map();
  async function bundleForYear(year){
   if(!activeBundles.has(year))activeBundles.set(year,Promise.resolve(service.activePolicyForYear(year)).then(result=>result.bundle));
   return activeBundles.get(year);
  }
  function assignmentHours(session,assignment){
   if(assignment?.creditedHours!==null&&assignment?.creditedHours!==undefined&&assignment?.creditedHours!=='')return Number(assignment.creditedHours);
   return scheduling.durationHours(session?.start,session?.end,{timeUnknown:session?.timeUnknown===true});
  }
  function assignmentContext(session,assignment,index){
   const assignmentId=stableAssignmentId(session,assignment,index),faculty=text(assignment?.facultyId||assignment?.ucid),role=text(assignment?.role||session?.type);
   return{
    academicYear:academicYearForSession(session),category:'teaching',activityType:text(session?.type),teachingRole:role,role,
    hours:assignmentHours(session,assignment),shifts:1,course:text(session?.course),date:text(session?.date),topic:text(session?.topic),
    semester:text(session?.semester),week:Number(session?.week),facultyId:faculty,sessionId:text(session?.id),assignmentId,
    assignment:text(assignment?.assignment||assignment?.assignmentLabel)
   };
  }
  function relevantFields(bundle){
   const fields=new Set();
   for(const rule of Array.isArray(bundle?.rules)?bundle.rules:[]){
    if(rule?.enabled===false||text(rule?.category)!=='teaching')continue;
    for(const selector of Array.isArray(rule?.selectors)?rule.selectors:[])if(text(selector?.field))fields.add(text(selector.field));
    for(const input of Array.isArray(rule?.inputs)?rule.inputs:[]){const name=typeof input==='string'?text(input):text(input?.inputName);if(name)fields.add(name)}
   }
   for(const exception of Array.isArray(bundle?.exceptions)?bundle.exceptions:[]){
    if(exception?.enabled===false)continue;
    if(text(exception?.facultyId))fields.add('facultyId');
    if(text(exception?.effectiveStart)||text(exception?.effectiveEnd))fields.add('date');
    const scope=text(exception?.scopeType).toLowerCase();
    if(scope==='assignment'){fields.add('assignmentId');fields.add('assignment')}
    else if(scope==='faculty')fields.add('facultyId');
    else if(scope==='session')fields.add('sessionId');
    else if(scope==='course')fields.add('course');
    else if(scope==='role')fields.add('roleType');
   }
   return fields;
  }
  function hasRelevantChange(bundle,beforeSession,beforeAssignment,afterSession,afterAssignment,index){
   if(!beforeSession||!beforeAssignment)return true;
   if(academicYearForSession(beforeSession)!==academicYearForSession(afterSession))return true;
   const before=assignmentContext(beforeSession,beforeAssignment,index),after=assignmentContext(afterSession,afterAssignment,index);
   for(const field of relevantFields(bundle))if(!equal(before[field],after[field]))return true;
   return false;
  }
  async function prepareSession(before,after,{trigger='session_updated'}={}){
   const session=clone(after)||{},records=[],doeChanges=[],assignments=[],beforeAssignments=Array.isArray(before?.assignments)?before.assignments:[];
   const year=academicYearForSession(session),bundle=await bundleForYear(year),fields=relevantFields(bundle);
   for(const [index,raw] of (Array.isArray(session.assignments)?session.assignments:[]).entries()){
    const assignment={...(raw||{})},assignmentId=stableAssignmentId(session,assignment,index);
    const previous=beforeAssignments.find(item=>text(item?.assignmentId)&&text(item.assignmentId)===assignmentId)||beforeAssignments[index]||null;
    assignment.assignmentId=assignmentId;
    if(previous&&fields.has('hours')&&equal(assignment.creditedHours,previous.creditedHours)){
     const beforeDuration=scheduling.durationHours(before?.start,before?.end,{timeUnknown:before?.timeUnknown===true});
     const afterDuration=scheduling.durationHours(session?.start,session?.end,{timeUnknown:session?.timeUnknown===true});
     if(!equal(beforeDuration,afterDuration))assignment.creditedHours=afterDuration;
    }
    if(previous&&!hasRelevantChange(bundle,before,previous,session,assignment,index)){
     for(const field of ['doeCredit','doePolicyVersionId','doeRuleId','doeRuleKey','doeCalculationId']){
      if(Object.prototype.hasOwnProperty.call(previous,field))assignment[field]=previous[field];else delete assignment[field];
     }
     if(Object.prototype.hasOwnProperty.call(previous,'doeRate'))assignment.doeRate=previous.doeRate;else delete assignment.doeRate;
     assignments.push(assignment);continue;
    }
    const context=assignmentContext(session,assignment,index),result=engine.calculate(bundle,context);
    const record=service.buildCalculationRecord(result,{
     academicYear:year,facultyId:context.facultyId,sessionId:context.sessionId,assignmentId,
     sourceEntityType:'session_assignment',sourceEntityId:assignmentId,trigger
    });
    const next={...assignment,creditedHours:context.hours,doeCredit:Number(result.resultDoe),
     doePolicyVersionId:text(result.policyVersionId),doeRuleId:text(result.ruleId),doeRuleKey:text(result.ruleKey),
     doeCalculationId:text(record.calculationId),source:'DOE policy engine'};
    delete next.doeRate;
    assignments.push(next);records.push(record);
    doeChanges.push({
     assignmentId,facultyId:context.facultyId,
     oldDoeCredit:Number.isFinite(Number(previous?.doeCredit))?Number(previous.doeCredit):null,newDoeCredit:Number(result.resultDoe),
     oldPolicyVersionId:text(previous?.doePolicyVersionId),newPolicyVersionId:text(result.policyVersionId),
     oldCalculationId:text(previous?.doeCalculationId),newCalculationId:text(record.calculationId),
     ruleId:text(result.ruleId),ruleKey:text(result.ruleKey)
    });
   }
   session.assignments=assignments;
   return{session,calculationRecords:records,doeChanges};
  }
  return Object.freeze({prepareSession,academicYearForSession,bundleForYear});
 }
 return{create,createViewFlow,editPolicy,validateRow,selectedRows,planChanges,commitPlan,createOwnershipAdapter,workingRevisionChange,onlySubjectChanged,onlyNonDoeMetadataChanged,validatedOwnership,createDoeAdapter,createDoeApiAdapter,academicYearForSession};
})();
