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
 let singleton=null;
 const defaultClient=()=>singleton||(singleton=createClient());
 const methods=['listPolicies','listVersions','loadPolicyBundle','getImpactPreview','getPolicyYear','copyPolicyYear','createPolicyYear','cloneAsDraft','validateDraft','testRule','runImpactPreview','publish','archive','previewRecalculate','runRecalculate','saveRule','saveException','saveReference','saveReservePolicy','saveCourseMapping','saveSubjectMapping','getFacultyWorksheet','saveFacultyTarget','listFacultyDoe','previewAssignment','previewSessionChange','previewFacultyTransfer','saveSessionChange','listRoleAssignments','saveRoleAssignment','deactivateRoleAssignment'];
 const api={createClient,isConfigured:()=>Boolean(defaultBaseUrl()),baseUrl:defaultBaseUrl};
 for(const method of methods)api[method]=(...args)=>defaultClient()[method](...args);
 return Object.freeze(api);
});
