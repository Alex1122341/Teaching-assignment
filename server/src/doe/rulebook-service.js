'use strict';
const crypto=require('node:crypto');
const {ApiError}=require('../http/errors.js');

const text=value=>String(value??'').trim();
const reviewRoles=new Set(['developer','owner','administrator','admin','adfa_general','adfa_regular']);
const rollForwardRoles=new Set(['developer','owner','administrator','admin','adfa_general']);
const reviewedStatuses=new Set(['confirmed_unchanged','updated','new','retired']);

function allowed(role,set){return set.has(text(role).toLowerCase())}
function clone(value){return structuredClone(value)}
function generatedId(kind){return `${kind}-${crypto.randomUUID()}`}
function cleanRow(row,drop=[]){
  const next=clone(row||{});
  for(const key of drop)delete next[key];
  return next;
}
function referenceComplete(row){
  if(!text(row?.referenceId)||!text(row?.title))return false;
  return Boolean(text(row?.section)||text(row?.table)||Number.isFinite(Number(row?.page))||text(row?.documentLink));
}
function mappingMatch(rows,type,key){
  const normalized=text(key).toLowerCase();
  if(!normalized)return null;
  const field=type==='course'?'courseCode':'subjectKey';
  const matches=(Array.isArray(rows)?rows:[]).filter(row=>row?.enabled!==false&&text(row?.[field]).toLowerCase()===normalized);
  if(matches.length>1)throw new ApiError(type==='course'?'COURSE_MAPPING_AMBIGUOUS':'SUBJECT_MAPPING_AMBIGUOUS',`Multiple enabled ${type} mappings match this assignment.`,409,{key});
  return matches[0]||null;
}

function createRulebookService({repository,engine,idFactory=generatedId,clock=()=>new Date()}={}){
  if(!repository?.getActivePolicyBundle||!repository?.getPolicyBundleByVersion)throw new Error('DOE rulebook repository is required.');
  if(!engine?.validatePolicy||!engine?.matchRule)throw new Error('DOE policy engine is required.');
  const now=()=>{const value=clock();return(value instanceof Date?value:new Date(value)).toISOString()};

  function newId(kind){const value=text(idFactory(kind));if(!value)throw new Error(`ID factory returned an empty ${kind} ID.`);return value}

  async function copyAcademicYear({sourceYear,targetYear,actor={}}={}){
    if(!allowed(actor.role,rollForwardRoles))throw new ApiError('FORBIDDEN','Only ADFA General / Owner can start a new DOE policy year.',403);
    const source=text(sourceYear),target=text(targetYear);
    if(!source||!target||source===target)throw new ApiError('ACADEMIC_YEAR_INVALID','Source and target Academic Years must be different.',422);
    if(await repository.getPolicyForYear(target))throw new ApiError('POLICY_YEAR_EXISTS','A DOE policy already exists for the target Academic Year.',409,{academicYear:target});
    const bundle=await repository.getActivePolicyBundle(source);
    const policyId=newId('policy'),policyVersionId=newId('version'),createdAt=now();
    const referenceIds=new Map(),ruleIds=new Map();
    const references=(bundle.references||[]).map(sourceRow=>{
      const referenceId=newId('reference');referenceIds.set(text(sourceRow.referenceId),referenceId);
      return{...cleanRow(sourceRow,['id']),referenceId,policyVersionId,academicYear:target,reviewStatus:'needs_review',copiedFromReferenceId:text(sourceRow.referenceId)};
    });
    const rules=(bundle.rules||[]).map(sourceRule=>{
      const ruleId=newId('rule');ruleIds.set(text(sourceRule.ruleId),ruleId);
      const base={...cleanRow(sourceRule,['id','selectors','parameters','tiers','inputs']),ruleId,policyVersionId,academicYear:target,reviewStatus:'needs_review',copiedFromRuleId:text(sourceRule.ruleId)};
      if(text(base.referenceId))base.referenceId=referenceIds.get(text(base.referenceId))||'';
      const nested=(rows,kind,idField)=>(rows||[]).map(row=>({...cleanRow(row,['id']),[idField]:newId(kind),ruleId,policyVersionId,academicYear:target,reviewStatus:'needs_review'}));
      return{...base,selectors:nested(sourceRule.selectors,'selector','selectorId'),parameters:nested(sourceRule.parameters,'parameter','parameterId'),tiers:nested(sourceRule.tiers,'tier','tierId'),inputs:nested(sourceRule.inputs,'input','ruleInputId')};
    });
    const remapReference=row=>{
      const next={...cleanRow(row,['id']),policyVersionId,academicYear:target,reviewStatus:'needs_review'};
      if(text(next.referenceId))next.referenceId=referenceIds.get(text(next.referenceId))||'';
      return next;
    };
    const courseMappings=(bundle.courseMappings||[]).map(row=>({...remapReference(row),mappingId:newId('course-mapping'),copiedFromMappingId:text(row.mappingId)}));
    const subjectMappings=(bundle.subjectMappings||[]).map(row=>({...remapReference(row),mappingId:newId('subject-mapping'),copiedFromMappingId:text(row.mappingId)}));
    const exceptions=(bundle.exceptions||[]).filter(row=>row?.recurring===true).map(row=>({...cleanRow(row,['id']),exceptionId:newId('exception'),policyVersionId,academicYear:target,reviewStatus:'needs_review',copiedFromExceptionId:text(row.exceptionId)}));
    const policy={
      ...cleanRow(bundle.policy,['id','currentActiveVersionId','createdAt','createdBy','updatedAt','updatedBy']),
      policyId,academicYear:target,currentActiveVersionId:'',name:text(bundle.policy?.name).replace(source,target)||`UCVM Workload ${target}`,
      createdAt,createdBy:text(actor.uid),createdByName:text(actor.name),copiedFromPolicyId:text(bundle.policy?.policyId)
    };
    const sourceVersion=cleanRow(bundle.version,['id','publicationId','publishedAt','publishedBy','archivedAt','archivedBy','lastImpactRunId','lastImpactChecksum','lastInputDatasetChecksum','lastValidatedRevision','lastValidatedChecksum']);
    if(sourceVersion.reservePolicy&&typeof sourceVersion.reservePolicy==='object'){
      sourceVersion.reservePolicy={...clone(sourceVersion.reservePolicy),reviewStatus:'needs_review'};
      if(text(sourceVersion.reservePolicy.referenceId))sourceVersion.reservePolicy.referenceId=referenceIds.get(text(sourceVersion.reservePolicy.referenceId))||'';
    }
    const version={
      ...sourceVersion,
      policyVersionId,policyId,academicYear:target,versionNumber:1,status:'draft',revision:0,
      name:`${target} annual draft`,clonedFromVersionId:text(bundle.version?.policyVersionId),createdAt,createdBy:text(actor.uid),createdByName:text(actor.name)
    };
    const payload={policy,version,references,rules,courseMappings,subjectMappings,exceptions,publications:[],calculationRecords:[],impactRuns:[]};
    return repository.createPolicyYearDraft(payload,{actor});
  }

  function reviewErrors(bundle){
    const errors=[];
    const groups=[
      ['rule',bundle.rules],['reference',bundle.references],['course_mapping',bundle.courseMappings],['subject_mapping',bundle.subjectMappings],['exception',bundle.exceptions]
    ];
    for(const [kind,rows] of groups)for(const row of rows||[]){
      if(row?.enabled===false||row?.recurring===false&&kind==='exception')continue;
      const status=text(row?.reviewStatus)||'needs_review';
      if(!reviewedStatuses.has(status))errors.push({code:'ANNUAL_REVIEW_REQUIRED',message:'Copied DOE configuration must be reviewed before publication.',entityType:kind,entityId:text(row.ruleId||row.referenceId||row.mappingId||row.exceptionId),reviewStatus:status});
    }
    const reservePolicy=bundle.version?.reservePolicy;
    if(reservePolicy&&typeof reservePolicy==='object'){
      const status=text(reservePolicy.reviewStatus)||'needs_review';
      if(!reviewedStatuses.has(status))errors.push({code:'ANNUAL_REVIEW_REQUIRED',message:'Copied DOE reserve policy must be reviewed before publication.',entityType:'reserve_policy',entityId:text(bundle.version?.policyVersionId),reviewStatus:status});
    }
    return errors;
  }

  function referenceErrors(bundle){
    const errors=[],references=new Map((bundle.references||[]).map(row=>[text(row.referenceId),row]));
    for(const rule of bundle.rules||[]){
      if(rule?.enabled===false)continue;
      const reference=references.get(text(rule.referenceId));
      if(!referenceComplete(reference))errors.push({code:'REFERENCE_REQUIRED',message:'Every enabled DOE rule requires a structured Reference.',ruleId:text(rule.ruleId),referenceId:text(rule.referenceId)});
    }
    const reservePolicy=bundle.version?.reservePolicy;
    if(reservePolicy&&typeof reservePolicy==='object'){
      const reference=references.get(text(reservePolicy.referenceId));
      if(!referenceComplete(reference))errors.push({code:'REFERENCE_REQUIRED',message:'DOE reserve policy requires a structured Reference.',entityType:'reserve_policy',referenceId:text(reservePolicy.referenceId)});
    }
    return errors;
  }

  function requiredRuleErrors(bundle){
    const required=[...(bundle.policy?.requiredRuleKeys||bundle.version?.requiredRuleKeys||[])].map(text).filter(Boolean);
    if(!required.length)return[];
    const present=new Set((bundle.rules||[]).filter(row=>row?.enabled!==false).map(row=>text(row.ruleKey)));
    return required.filter(key=>!present.has(key)).map(ruleKey=>({code:'REQUIRED_RULE_MISSING',message:'A required annual DOE rule is missing.',ruleKey}));
  }

  function factMappingErrors(bundle,dataset){
    const errors=[];
    for(const fact of Array.isArray(dataset?.activeFacts)?dataset.activeFacts:[]){
      let match;
      try{match=engine.matchRule(bundle,{...fact,academicYear:bundle.version.academicYear})}
      catch(error){errors.push({code:error.code||'RULE_MATCH_FAILED',message:error.message,facultyId:text(fact.facultyId),sourceEntityId:text(fact.sourceEntityId)});continue}
      if(match.source!=='rule')continue;
      const requirement=text(match.rule?.mappingRequirement).toLowerCase();
      const inputSources=(match.rule?.inputs||[]).map(input=>text(input?.source));
      const needsCourse=requirement==='course'||inputSources.some(source=>source.startsWith('course_mapping.'));
      const needsSubject=requirement==='subject'||inputSources.some(source=>source.startsWith('subject_mapping.'));
      if(needsCourse&&!mappingMatch(bundle.courseMappings,'course',fact.courseCode||fact.course))errors.push({code:'COURSE_MAPPING_REQUIRED',message:'Course mapping is required for an active DOE assignment.',facultyId:text(fact.facultyId),courseCode:text(fact.courseCode||fact.course)});
      if(needsSubject&&!mappingMatch(bundle.subjectMappings,'subject',fact.subjectKey||fact.subject))errors.push({code:'SUBJECT_MAPPING_REQUIRED',message:'Subject mapping is required for an active DOE assignment.',facultyId:text(fact.facultyId),subjectKey:text(fact.subjectKey||fact.subject)});
    }
    return errors;
  }

  async function editableDraft(policyVersionId,actor={}){
    if(!allowed(actor.role,reviewRoles))throw new ApiError('FORBIDDEN','This account cannot edit DOE policy mappings.',403);
    const id=text(policyVersionId);
    const bundle=await repository.getPolicyBundleByVersion(id);
    if(!bundle)throw new ApiError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',404,{policyVersionId:id});
    if(bundle.version?.status!=='draft')throw new ApiError('POLICY_NOT_DRAFT','Only a Draft DOE policy can be edited.',409,{policyVersionId:id});
    return bundle;
  }

  function normalizedReviewStatus(value){
    const status=text(value)||'updated';
    if(status!=='needs_review'&&!reviewedStatuses.has(status))throw new ApiError('ANNUAL_REVIEW_STATUS_INVALID','Annual review status is invalid.',422,{reviewStatus:status});
    return status;
  }

  async function saveReference({policyVersionId,reference={},actor={}}={}){
    if(!repository.saveDraftReference)throw new ApiError('REFERENCE_WRITE_UNAVAILABLE','DOE Reference writer is unavailable.',503);
    const bundle=await editableDraft(policyVersionId,actor),referenceId=text(reference.referenceId),title=text(reference.title),reviewStatus=normalizedReviewStatus(reference.reviewStatus);
    if(!referenceId||!title)throw new ApiError('REFERENCE_INVALID','Reference requires referenceId and title.',422);
    const row={...clone(reference),referenceId,title,policyVersionId:text(bundle.version.policyVersionId),academicYear:text(bundle.version.academicYear),reviewStatus};
    return repository.saveDraftReference(row,{actor});
  }

  async function saveReservePolicy({policyVersionId,reservePolicy={},actor={}}={}){
    if(!repository.saveDraftReservePolicy)throw new ApiError('RESERVE_POLICY_WRITE_UNAVAILABLE','DOE reserve policy writer is unavailable.',503);
    await editableDraft(policyVersionId,actor);
    const numeric=(name,{min=0,max=Infinity,integer=false}={})=>{const value=Number(reservePolicy[name]);if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new ApiError('RESERVE_POLICY_INVALID',`Reserve policy ${name} is invalid.`,422,{field:name});return value};
    const reviewStatus=normalizedReviewStatus(reservePolicy.reviewStatus),referenceId=text(reservePolicy.referenceId);
    if(!referenceId)throw new ApiError('RESERVE_POLICY_INVALID','Reserve policy Reference is required.',422,{field:'referenceId'});
    const row={...clone(reservePolicy),strategy:text(reservePolicy.strategy)||'flexible_teaching_reserve',splitThreshold:numeric('splitThreshold'),splitRatio:numeric('splitRatio',{min:0,max:1}),highTeachingTraineeCeiling:numeric('highTeachingTraineeCeiling'),teachingFocusedTraineeCeiling:numeric('teachingFocusedTraineeCeiling'),rollingAverageYears:numeric('rollingAverageYears',{min:1,integer:true}),referenceId,reviewStatus};
    return repository.saveDraftReservePolicy(text(policyVersionId),row,{actor});
  }

  async function saveCourseMapping({policyVersionId,mapping={},actor={}}={}){
    if(!repository.saveDraftCourseMapping)throw new ApiError('MAPPING_WRITE_UNAVAILABLE','DOE course mapping writer is unavailable.',503);
    const bundle=await editableDraft(policyVersionId,actor),mappingId=text(mapping.mappingId),courseCode=text(mapping.courseCode).toUpperCase(),unitCount=Number(mapping.unitCount),referenceId=text(mapping.referenceId);
    if(!mappingId||!courseCode||!Number.isFinite(unitCount)||unitCount<=0||!referenceId)throw new ApiError('COURSE_MAPPING_INVALID','Course mapping requires mappingId, courseCode, positive unitCount, and referenceId.',422);
    const reviewStatus=normalizedReviewStatus(mapping.reviewStatus);
    const row={...clone(mapping),mappingId,courseCode,unitCount,referenceId,policyVersionId:text(bundle.version.policyVersionId),academicYear:text(bundle.version.academicYear),reviewStatus,enabled:reviewStatus==='retired'?false:mapping.enabled!==false};
    return repository.saveDraftCourseMapping(row,{actor});
  }

  async function saveSubjectMapping({policyVersionId,mapping={},actor={}}={}){
    if(!repository.saveDraftSubjectMapping)throw new ApiError('MAPPING_WRITE_UNAVAILABLE','DOE subject mapping writer is unavailable.',503);
    const bundle=await editableDraft(policyVersionId,actor),mappingId=text(mapping.mappingId),subjectKey=text(mapping.subjectKey).toLowerCase(),referenceId=text(mapping.referenceId);
    if(!mappingId||!subjectKey||!referenceId)throw new ApiError('SUBJECT_MAPPING_INVALID','Subject mapping requires mappingId, subjectKey, and referenceId.',422);
    const reviewStatus=normalizedReviewStatus(mapping.reviewStatus);
    const row={...clone(mapping),mappingId,subjectKey,referenceId,policyVersionId:text(bundle.version.policyVersionId),academicYear:text(bundle.version.academicYear),reviewStatus,enabled:reviewStatus==='retired'?false:mapping.enabled!==false};
    return repository.saveDraftSubjectMapping(row,{actor});
  }

  async function validateAnnualReview(policyVersionId,datasetOverride,{actor={}}={}){
    if(!allowed(actor.role,reviewRoles))throw new ApiError('FORBIDDEN','This account cannot validate DOE policy drafts.',403);
    const bundle=await repository.getPolicyBundleByVersion(text(policyVersionId));
    if(!bundle)throw new ApiError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',404,{policyVersionId:text(policyVersionId)});
    if(bundle.version?.status!=='draft')throw new ApiError('POLICY_NOT_DRAFT','Only a Draft DOE policy can be validated.',409,{policyVersionId:text(policyVersionId)});
    let dataset=datasetOverride;
    if(dataset===undefined){
      if(!repository.loadAnnualValidationDataset)throw new ApiError('DATASET_PROVIDER_REQUIRED','Annual DOE validation requires an authoritative server-side assignment dataset.',503);
      dataset=await repository.loadAnnualValidationDataset(bundle.version.academicYear);
    }
    const engineReport=engine.validatePolicy(bundle);
    const errors=[...(engineReport.errors||[]),...reviewErrors(bundle),...referenceErrors(bundle),...requiredRuleErrors(bundle),...factMappingErrors(bundle,dataset)];
    const report={valid:errors.length===0,errors,warnings:[...(engineReport.warnings||[])],policyVersionId:text(policyVersionId),academicYear:text(bundle.version.academicYear)};
    if(repository.saveAnnualValidationResult)await repository.saveAnnualValidationResult(policyVersionId,report,{actor});
    return report;
  }

  return Object.freeze({copyAcademicYear,saveReference,saveCourseMapping,saveSubjectMapping,saveReservePolicy,validateAnnualReview});
}

module.exports={createRulebookService};
