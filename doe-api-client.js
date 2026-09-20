(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_API=api;
})(typeof window!=='undefined'?window:null,function(root){
 'use strict';
 const text=value=>String(value??'').trim();
 const cleanBase=value=>text(value).replace(/\/+$/,'');
 function defaultBaseUrl(){return cleanBase(root?.UCVM_CONFIG?.doeApiBaseUrl||root?.UCVM_DOE_API_BASE_URL||'')}
 async function defaultTokenProvider(){
  const user=root?.firebase?.auth?.().currentUser;
  if(!user?.getIdToken)throw Object.assign(Error('DOE API requires an authenticated Firebase user.'),{code:'AUTH_REQUIRED'});
  return user.getIdToken();
 }
 function createClient({baseUrl=defaultBaseUrl(),tokenProvider=defaultTokenProvider,fetchImpl=root?.fetch?.bind(root)}={}){
  const base=cleanBase(baseUrl);
  if(typeof fetchImpl!=='function'){
   const unavailable=async()=>{throw Object.assign(Error('DOE API transport is unavailable.'),{code:'DOE_API_UNAVAILABLE'})};
   fetchImpl=unavailable;
  }
  async function request(path,{method='GET',body}={}){
   if(!base)throw Object.assign(Error('DOE API is not configured.'),{code:'DOE_API_NOT_CONFIGURED'});
   const token=await tokenProvider();
   const response=await fetchImpl(`${base}${path}`,{
    method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
   });
   const payload=await response.json().catch(()=>({}));
   if(!response.ok){const error=Error(payload.message||'DOE API request failed.');Object.assign(error,payload,{statusCode:response.status});throw error}
   return payload;
  }
  const enc=value=>encodeURIComponent(text(value));
  return Object.freeze({
   request,
   listPolicies:()=>request('/api/doe/policies'),
   listVersions:policyId=>request(`/api/doe/policies/${enc(policyId)}/versions`),
   loadPolicyBundle:policyVersionId=>request(`/api/doe/policy-versions/${enc(policyVersionId)}/bundle`),
   listAudit:policyVersionId=>request(`/api/doe/policy-versions/${enc(policyVersionId)}/audit`),
   getImpactPreview:impactRunId=>request(`/api/doe/impact-runs/${enc(impactRunId)}`),
   getPolicyYear:academicYear=>request(`/api/doe/policy-years/${enc(academicYear)}`),
   copyPolicyYear:(sourceYear,targetYear)=>request(`/api/doe/policy-years/${enc(targetYear)}/copy-from/${enc(sourceYear)}`,{method:'POST'}),
   createPolicyYear:payload=>request('/api/doe/policy-years',{method:'POST',body:payload}),
   cloneAsDraft:policyVersionId=>request(`/api/doe/policy-versions/${enc(policyVersionId)}/clone`,{method:'POST'}),
   validateDraft:policyVersionId=>request(`/api/doe/drafts/${enc(policyVersionId)}/validate`,{method:'POST'}),
   testRule:(policyVersionId,rule,sample)=>request(`/api/doe/drafts/${enc(policyVersionId)}/test-rule`,{method:'POST',body:{rule,sample}}),
   runImpactPreview:policyVersionId=>request(`/api/doe/drafts/${enc(policyVersionId)}/impact-preview`,{method:'POST'}),
   publish:policyVersionId=>request(`/api/doe/drafts/${enc(policyVersionId)}/publish`,{method:'POST'}),
   archive:policyVersionId=>request(`/api/doe/policy-versions/${enc(policyVersionId)}/archive`,{method:'POST'}),
   previewRecalculate:payload=>request('/api/doe/recalculate/preview',{method:'POST',body:payload}),
   runRecalculate:payload=>request('/api/doe/recalculate',{method:'POST',body:payload}),
   saveRule:(policyVersionId,rule)=>request(`/api/doe/drafts/${enc(policyVersionId)}/rules/${enc(rule?.ruleId)}`,{method:'PUT',body:{rule}}),
   saveException:(policyVersionId,exception)=>request(`/api/doe/drafts/${enc(policyVersionId)}/exceptions/${enc(exception?.exceptionId)}`,{method:'PUT',body:{exception}}),
   saveReference:(policyVersionId,reference)=>request(`/api/doe/drafts/${enc(policyVersionId)}/references/${enc(reference?.referenceId)}`,{method:'PUT',body:{reference}}),
   saveReservePolicy:(policyVersionId,reservePolicy)=>request(`/api/doe/drafts/${enc(policyVersionId)}/reserve-policy`,{method:'PUT',body:{reservePolicy}}),
   saveCourseMapping:(policyVersionId,mapping)=>request(`/api/doe/drafts/${enc(policyVersionId)}/course-mappings/${enc(mapping?.mappingId)}`,{method:'PUT',body:{mapping}}),
   saveSubjectMapping:(policyVersionId,mapping)=>request(`/api/doe/drafts/${enc(policyVersionId)}/subject-mappings/${enc(mapping?.mappingId)}`,{method:'PUT',body:{mapping}}),
   getFacultyWorksheet:(facultyId,academicYear)=>request(`/api/doe/faculty/${enc(facultyId)}/worksheet?academicYear=${enc(academicYear)}`),
   saveFacultyTarget:(facultyId,academicYear,override)=>request(`/api/doe/faculty/${enc(facultyId)}/target`,{method:'PUT',body:{academicYear,override:override??null}}),
   listFacultyDoe:academicYear=>request(`/api/doe/list?academicYear=${enc(academicYear)}`),
   previewAssignment:(academicYear,facts)=>request('/api/doe/preview-assignment',{method:'POST',body:{academicYear,facts}}),
   previewSessionChange:payload=>request('/api/doe/session-changes/preview',{method:'POST',body:payload}),
   previewFacultyTransfer:payload=>request('/api/doe/faculty-transfer/preview',{method:'POST',body:payload}),
   saveSessionChange:payload=>request('/api/doe/session-changes',{method:'POST',body:payload}),
   listRoleAssignments:(facultyId,academicYear)=>request(`/api/doe/faculty/${enc(facultyId)}/role-assignments?academicYear=${enc(academicYear)}`),
   saveRoleAssignment:payload=>request('/api/doe/role-assignments',{method:'POST',body:payload}),
   deactivateRoleAssignment:assignmentFactId=>request(`/api/doe/role-assignments/${enc(assignmentFactId)}`,{method:'DELETE'})
  });
 }

 const copySession=value=>value&&typeof value==='object'?{...value,...(Array.isArray(value.assignments)?{assignments:value.assignments.map(row=>({...row}))}:{})}:value;
 const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 const DOE_FIELDS=['doeCredit','doePolicyVersionId','doeRuleId','doeRuleKey','doeCalculationId','doeRate','resultDoe','policyVersionId','ruleId','ruleKey','calculationId'];
 function academicYearForSession(session={}){
  const explicit=text(session?.academicYear);if(explicit)return explicit;
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text(session?.date));
  if(!match)throw Object.assign(Error('A valid session date is required to resolve Academic Year.'),{code:'ACADEMIC_YEAR_REQUIRED'});
  const year=Number(match[1]),month=Number(match[2]),semester=text(session?.semester).toLowerCase();
  const start=semester==='winter'?year-1:(semester==='spring'||semester==='fall'?year:(month<=4?year-1:year));
  return`${start}-${String(start+1).slice(-2)}`;
 }
 function assignmentId(session,assignment,index){return text(assignment?.assignmentId)||`${text(session?.sessionId||session?.id)||'session'}--assignment--${index+1}`}
 function stripAssignmentDoe(assignment={}){const next={...(assignment||{})};for(const field of DOE_FIELDS)delete next[field];return next}
 function durationHours(session={}){
  if(session?.timeUnknown===true)return null;
  const parse=value=>{const match=/^(\d{1,2}):(\d{2})$/.exec(text(value));if(!match)return null;const h=Number(match[1]),m=Number(match[2]);return h>=0&&h<=23&&m>=0&&m<=59?h*60+m:null};
  const start=parse(session.start),end=parse(session.end);return start===null||end===null||end<=start?null:(end-start)/60;
 }
 function prepareQueuedSessionChange({academicYear='',sessionId='',beforeSession=null,afterSession=null,patch=null,trigger='session_updated'}={}){
  const before=beforeSession&&typeof beforeSession==='object'?copySession(beforeSession):null;
  const requested=afterSession&&typeof afterSession==='object'?copySession(afterSession):{...(before||{}),...(patch&&typeof patch==='object'?{...patch}:{})};
  const id=text(sessionId||requested?.sessionId||requested?.id||before?.sessionId||before?.id);
  if(!id)throw Object.assign(Error('Session ID is required.'),{code:'SESSION_ID_REQUIRED'});
  const candidate={...(before||{}),...(requested||{}),id,sessionId:id};
  const beforeAssignments=Array.isArray(before?.assignments)?before.assignments:[],nextAssignments=[];
  for(const [index,raw] of (Array.isArray(candidate.assignments)?candidate.assignments:[]).entries()){
   const clean=stripAssignmentDoe(raw||{}),idValue=assignmentId(candidate,clean,index);
   const previous=beforeAssignments.find(row=>text(row?.assignmentId)&&text(row.assignmentId)===idValue)||beforeAssignments[index]||null;
   clean.assignmentId=idValue;
   if(previous&&same(clean.creditedHours,previous.creditedHours)){
    const oldDuration=durationHours(before||{}),newDuration=durationHours(candidate);
    if(!same(oldDuration,newDuration))clean.creditedHours=newDuration;
   }
   nextAssignments.push(clean);
  }
  const year=text(academicYear)||academicYearForSession(candidate);
  candidate.academicYear=year;
  candidate.assignments=nextAssignments;
  candidate.facultyIds=[...new Set(nextAssignments.map(row=>text(row?.facultyId||row?.ucid)).filter(Boolean))];
  candidate.instructor=nextAssignments.map(row=>text(row?.name)).filter(Boolean).join('; ');
  delete candidate.__id;
  const sourceEntityIds=nextAssignments.map((row,index)=>text(row?.facultyId||row?.ucid)?(text(row?.assignmentId)||`${id}--assignment--${index+1}`):'').filter(Boolean);
  const facultyIds=[...new Set([...candidate.facultyIds,...beforeAssignments.map(row=>text(row?.facultyId||row?.ucid)).filter(Boolean)])];
  return{academicYear:year,session:candidate,calculationRecords:[],doeChanges:[],facultyImpacts:[],queued:true,queue:{sessionId:id,sourceEntityType:'session_assignment',sourceEntityIds,facultyIds,trigger:text(trigger)||'session_updated',previousStart:text(before?.start),previousEnd:text(before?.end),previousTimeUnknown:before?.timeUnknown===true}};
 }
 function canQueueSessionChanges(){return Boolean(root?.firebase?.firestore&&root?.firebase?.auth&&root?.UCVM_CALENDAR_SESSION?.fromSource)}
 async function saveQueuedSessionChange(payload={}){
  if(!canQueueSessionChanges())throw Object.assign(Error('Firebase DOE recalculation queue is unavailable.'),{code:'DOE_QUEUE_UNAVAILABLE'});
  const auth=root.firebase.auth(),user=auth.currentUser;if(!user)throw Object.assign(Error('An authenticated Firebase user is required to queue DOE recalculation.'),{code:'AUTH_REQUIRED'});
  const db=root.firebase.firestore(),id=text(payload.sessionId||payload.afterSession?.sessionId||payload.afterSession?.id);
  if(!id)throw Object.assign(Error('Session ID is required.'),{code:'SESSION_ID_REQUIRED'});
  const sessionRef=db.collection('sessions').doc(id),beforeSnap=await sessionRef.get(),before=beforeSnap.exists?{id:beforeSnap.id,...beforeSnap.data()}:null;
  const prepared=prepareQueuedSessionChange({...payload,sessionId:id,beforeSession:before}),queueNeeded=prepared.queue.sourceEntityIds.length>0;
  const stamp=root.firebase.firestore.FieldValue.serverTimestamp(),actorName=text(user.displayName||user.email);
  const normalized=root?.UCVM_INDEX_MAINTENANCE?.sessionForWrite?root.UCVM_INDEX_MAINTENANCE.sessionForWrite(prepared.session):{...prepared.session};
  const stored={...normalized,updatedBy:user.uid,updatedByName:actorName,updatedAt:stamp};delete stored.__id;delete stored.id;delete stored.sessionId;
  const batch=db.batch();batch.set(sessionRef,stored,{merge:true});batch.set(db.collection('calendar_sessions').doc(id),root.UCVM_CALENDAR_SESSION.fromSource(prepared.session,id));
  let requestId='';
  if(queueNeeded){
   const queueRef=db.collection('doe_recalculation_requests').doc();requestId=queueRef.id;
   batch.set(queueRef,{requestId,academicYear:prepared.academicYear,sessionId:id,sourceEntityType:'session_assignment',sourceEntityIds:prepared.queue.sourceEntityIds,facultyIds:prepared.queue.facultyIds,trigger:prepared.queue.trigger,status:'pending',requestedBy:user.uid,requestedByName:actorName,requestedAt:stamp,previousStart:prepared.queue.previousStart,previousEnd:prepared.queue.previousEnd,previousTimeUnknown:prepared.queue.previousTimeUnknown});
  }
  await batch.commit();
  return{...prepared,session:prepared.session,queued:queueNeeded,recalculationRequestId:requestId};
 }
 let singleton=null;
 const defaultClient=()=>singleton||(singleton=createClient());
 const methods=['listPolicies','listVersions','loadPolicyBundle','listAudit','getImpactPreview','getPolicyYear','copyPolicyYear','createPolicyYear','cloneAsDraft','validateDraft','testRule','runImpactPreview','publish','archive','previewRecalculate','runRecalculate','saveRule','saveException','saveReference','saveReservePolicy','saveCourseMapping','saveSubjectMapping','getFacultyWorksheet','saveFacultyTarget','listFacultyDoe','previewAssignment','previewSessionChange','previewFacultyTransfer','listRoleAssignments','saveRoleAssignment','deactivateRoleAssignment'];
 const api={createClient,isConfigured:()=>Boolean(defaultBaseUrl()),baseUrl:defaultBaseUrl,canQueueSessionChanges,prepareQueuedSessionChange,academicYearForSession,stripAssignmentDoe};
 for(const method of methods)api[method]=(...args)=>defaultClient()[method](...args);
 api.saveSessionChange=payload=>api.isConfigured()?defaultClient().saveSessionChange(payload):saveQueuedSessionChange(payload);
 return Object.freeze(api);
});
