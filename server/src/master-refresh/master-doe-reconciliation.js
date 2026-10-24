'use strict';
const {randomUUID}=require('node:crypto');
const {manifestHash,academicBounds}=require('./master-source-domain');
const {createDoeCalculationService}=require('../doe/doe-calculation-service');
const {sourceFacts}=require('../doe/doe-recorded-source-impact');
const key=v=>String(v??'').trim().toLowerCase();
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const same=(a,b)=>a!==null&&b!==null&&Math.abs(a-b)<0.000001;
const categories=['Undergraduate Supervision','VETM 506','4th Year Preceptor','IM','Graduate Primary Supervisor','Graduate Co-supervisor','Postdoctoral Fellow'];
const supported=new Set(['HICC','VISC','CCC','Rotation Participant','Designated Rotation Coordinator']);
function factsFor(row,current,year){
 const canonical=current?.facultyId||row.facultyId,id=current?.roleId||null;
 const facts=sourceFacts({academicYear:year,facultyId:canonical},{sourceEntityType:'legacy_role_assignment',sourceEntityId:id,lineId:id,roleType:row.roleType,scopeText:row.scope,facts:{...(row.facts||{}),...(row.roleType==='CCC'?{...(row.shifts!==undefined?{shifts:row.shifts}:{}),...(row.halfDayDeduction!==undefined?{halfDayDeduction:row.halfDayDeduction}:{})}:{} )}});
 return facts;
}
async function compareMasterDoe({source,currentRoles=[],supervision=[],worksheetSources=[],domain,activeBundle,candidateBundle=activeBundle,calculate}={}){
 academicBounds(source?.academicYear);
 if(!activeBundle||!candidateBundle)throw Object.assign(Error('Complete annual engine evidence required.'),{code:'MASTER_ENGINE_REQUIRED'});
 const service=createDoeCalculationService({repository:{loadActivePolicy:async()=>activeBundle}}),preview=calculate||service.previewWithPolicy.bind(service);
 const rows=[],used=new Set();
 const all=[...(source.appointments||[]),...(source.rotations||[]),...(source.cccAllocations||[]).map(r=>({...r,roleType:'CCC',scope:'CCC shifts'}))];
 async function projected(bundle,facts){
  try{const r=await preview({policyBundle:bundle,academicYear:source.academicYear,facts});if(number(r.resultDoe)===null)throw Error();return{value:number(r.resultDoe),ruleKey:r.ruleKey||null};}
  catch(e){return{value:null,issueCode:e.code||'NEEDS_REVIEW'};}
 }
 for(const sourceRow of all){
  const matches=currentRoles.filter(r=>key(r.facultyId)===key(sourceRow.facultyId)&&r.roleType===sourceRow.roleType&&key(r.scope)===key(sourceRow.scope));
  const current=matches.length===1?matches[0]:null;if(current)used.add(current.roleId);
  const row={sourceRef:sourceRow.sourceRef||null,facultyId:current?.facultyId||sourceRow.facultyId,roleId:current?.roleId||null,roleType:sourceRow.roleType,scope:sourceRow.scope,storedDoe:current?number(current.overrideDoe??current.mappedDoe):null,mappedDoe:number(current?.mappedDoe),overrideDoe:number(current?.overrideDoe),overrideReason:current?.overrideReason||null,sourceDoe:number(sourceRow.sourceDoe),activeDoe:null,candidateDoe:null,isNew:!current};
  if(!sourceRow.facultyId||sourceRow.identityStatus&&sourceRow.identityStatus!=='resolved'||matches.length>1){rows.push({...row,status:'unresolved'});continue;}
  if(row.sourceDoe===null&&!current){rows.push({...row,status:'source_missing'});continue;}
  const facts=factsFor(sourceRow,current,source.academicYear),beforeFacts=current?factsFor({...current,facts:{...parse(current.sourceFactsJson),sourceDetails:current.details}},current,source.academicYear):facts,active=await projected(activeBundle,beforeFacts),candidate=await projected(candidateBundle,facts);
  Object.assign(row,{activeDoe:active.value,candidateDoe:candidate.value,activeRuleKey:active.ruleKey||null,candidateRuleKey:candidate.ruleKey||null,issueCode:active.issueCode||candidate.issueCode||null,beforeFacts,facts});
  row.status=row.sourceDoe===null?'source_missing':same(row.sourceDoe,row.activeDoe)&&same(row.sourceDoe,row.candidateDoe)&&(!current||same(row.storedDoe,row.sourceDoe))?'matched':'held_mismatch';
  rows.push(row);
 }
 for(const current of currentRoles)if(supported.has(current.roleType)&&!used.has(current.roleId))rows.push({facultyId:current.facultyId,roleId:current.roleId,roleType:current.roleType,scope:current.scope,storedDoe:number(current.overrideDoe??current.mappedDoe),sourceDoe:null,activeDoe:null,candidateDoe:null,status:'held_removal'});
 for(const item of source.trainees||[]){
  const matches=supervision.filter(s=>key(s.facultyId)===key(item.facultyId)),current=matches.length===1?matches[0]:null;
  const row={sourceRef:item.sourceRef,facultyId:current?.facultyId||item.facultyId,roleType:'Trainee Supervision',scope:'Seven source supervision categories',storedDoe:number(current?.rawDoe),sourceDoe:number(item.sourceDoe),activeDoe:null,candidateDoe:null,isNew:!current};
  if(!item.facultyId||item.identityStatus&&item.identityStatus!=='resolved'||matches.length>1){rows.push({...row,status:'unresolved'});continue;}
  if(!Array.isArray(item.rawCounts)||item.rawCounts.length!==7||item.rawCounts.some(n=>n!==null&&(number(n)===null||number(n)<0))){rows.push({...row,status:'unresolved',issueCode:'SUPERVISION_DATA_UNAVAILABLE'});continue;}
  if(!current&&row.sourceDoe===null){rows.push({...row,status:'source_missing'});continue;}
  const beforeCounts=current?parse(current.evidenceJson).counts:item.rawCounts;
  let active=0,candidate=0,issue=current&&(!Array.isArray(beforeCounts)||beforeCounts.length!==7)?'SUPERVISION_DATA_UNAVAILABLE':null;
  for(let i=0;i<7;i++){
   const facts={academicYear:source.academicYear,facultyId:row.facultyId,category:'supervision',activityType:categories[i],trainees:item.rawCounts[i]??0};
   const a=await projected(activeBundle,{...facts,trainees:beforeCounts?.[i]??0}),c=await projected(candidateBundle,facts);active+=a.value??0;candidate+=c.value??0;issue=issue||a.issueCode||c.issueCode;
  }
  row.activeDoe=issue?null:Number(active.toFixed(6));row.candidateDoe=issue?null:Number(candidate.toFixed(6));row.issueCode=issue||null;
  row.status=row.sourceDoe===null?'source_missing':same(row.sourceDoe,row.activeDoe)&&same(row.sourceDoe,row.candidateDoe)&&(!current||same(row.storedDoe,row.sourceDoe))?'matched':'held_mismatch';rows.push(row);
 }
 const {guardFacultyAggregates}=require('./master-doe-aggregate');
 const facultyImpacts=await guardFacultyAggregates({rows,worksheetSources,academicYear:source.academicYear,domain});
 const doeGuardHash=manifestHash({sourceManifest:source.manifestSha256,currentRoles,supervision,activeBundle,candidateBundle,worksheetSources,domain,rows,facultyImpacts});
 return{rows,facultyImpacts,matching:rows.filter(r=>r.status==='matched'),held:rows.filter(r=>r.status!=='matched'),doeGuardHash};
}
async function prepareMasterPolicyCandidate({source,activeBundle,currentRoles=[],supervision=[],policyRepository,policyService,actorUid,calculate}={}){
 if(activeBundle?.version?.status!=='active'||activeBundle.version.academicYear!==source?.academicYear)throw Object.assign(Error('An Active same-year source is required.'),{code:'ACTIVE_POLICY_REQUIRED'});
 const cloned=await policyRepository.clonePolicy({sourcePolicyVersionId:activeBundle.version.policyVersionId,sourceAcademicYear:source.academicYear,academicYear:source.academicYear,actorUid,includeExceptions:true,reuseWorkingDraft:false});
 if(!cloned?.version?.policyVersionId||cloned.version.policyVersionId===activeBundle.version.policyVersionId||cloned.version.status!=='draft')throw Object.assign(Error('A fresh Draft was not created.'),{code:'MASTER_FRESH_DRAFT_REQUIRED'});
 const courseMappings=structuredClone(cloned.courseMappings||[]),subjectMappings=structuredClone(cloned.subjectMappings||[]),referenceId=randomUUID();
 const reference={referenceId,title:'Owner-approved Teaching Assignments MASTER',sourceReference:`MASTER SHA256 ${source.sourceSha256}`,reviewStatus:'approved'};
 const inputs=[...(source.appointments||[]),...(source.roleDefinitions||[])];
 for(const row of inputs){
  if(row.roleType==='HICC'){
   const code=String(row.scope||'').match(/^(?:VTMD|VETM|Vet Med)\s*(\d+)/i);if(!code)continue;
   const courseCode='VTMD '+code[1],matches=courseMappings.filter(m=>key(m.courseCode)===key(courseCode));if(matches.length>1)continue;
   const old=matches[0],patch={...(old||{mappingId:randomUUID(),courseCode,enabled:true,hiccEligible:true}),referenceId,reviewStatus:'approved',mappingFactsJson:JSON.stringify({...parse(old?.mappingFactsJson),masterSourceRef:row.sourceRef})};
   if(number(row.facts?.units)!==null)patch.unitCount=number(row.facts.units);
   if(old)Object.assign(old,patch);else courseMappings.push(patch);
  }else if(row.roleType==='VISC'){
   const matches=subjectMappings.filter(m=>key(m.subjectKey)===key(row.scope)||key(m.subjectName)===key(row.scope));if(matches.length>1)continue;
   const old=matches[0],patch={...(old||{mappingId:randomUUID(),subjectKey:row.scope,subjectName:row.scope,enabled:true}),referenceId,reviewStatus:'approved',mappingFactsJson:JSON.stringify({...parse(old?.mappingFactsJson),masterSourceRef:row.sourceRef,subjectCount:row.facts?.subjectCount??1})};
   if(old)Object.assign(old,patch);else subjectMappings.push(patch);
  }
 }
 const saved=await policyService.saveDraft({policyVersionId:cloned.version.policyVersionId,expectedRevision:cloned.version.revision,actorUid,patch:{sourceReference:`MASTER SHA256 ${source.sourceSha256}`,references:[...(cloned.references||[]),reference],courseMappings,subjectMappings}});
 const validation=await policyService.validateDraft({policyVersionId:saved.version.policyVersionId,expectedRevision:saved.version.revision,actorUid});
 const comparison=await compareMasterDoe({source,currentRoles,supervision,activeBundle,candidateBundle:saved,calculate});
 return{policyVersionId:saved.version.policyVersionId,revision:saved.version.revision,validation,comparison};
}
function parse(value){try{return typeof value==='string'?JSON.parse(value||'{}'):value||{};}catch(_){return{};}}
module.exports={compareMasterDoe,prepareMasterPolicyCandidate};
