(function(root,factory){
 const engine=typeof module==='object'&&module.exports?require('./doe-policy-engine.js'):(root&&root.UCVM_DOE_POLICY_ENGINE);
 const nodeCrypto=typeof module==='object'&&module.exports?require('node:crypto'):null;
 const api=factory(engine,nodeCrypto,root&&root.crypto);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_POLICY_SERVICE=api;
})(typeof window!=='undefined'?window:null,function(DEFAULT_ENGINE,nodeCrypto,webCrypto){
 'use strict';
 if(!DEFAULT_ENGINE)throw new Error('UCVM DOE policy engine is required.');

 class DoeServiceError extends Error{
  constructor(code,message,details={}){
   super(message);
   this.name='DoeServiceError';
   this.code=code;
   Object.assign(this,details);
  }
 }

 const text=value=>String(value??'').trim();
 const role=value=>{
  const raw=text(value&&typeof value==='object'?value.role:value).toLowerCase();
  return({owner:'adfa_general',administrator:'adfa_regular',admin:'adfa_regular',adfa_general:'adfa_general',adfa_regular:'adfa_regular'}[raw]||raw);
 };
 const canEditDraft=actor=>['adfa_general','adfa_regular'].includes(role(actor));
 const canPublish=actor=>role(actor)==='adfa_general';
 const canRecalculate=canPublish;

 function deny(action){
  throw new DoeServiceError('PERMISSION_DENIED',`You do not have permission to ${action} DOE policy.`);
 }

 const VOLATILE_KEYS=new Set([
  'status','revision','createdAt','createdBy','updatedAt','updatedBy',
  'publishedAt','publishedBy','archivedAt','archivedBy',
  'rulesChecksum','lastValidatedRevision','lastValidationPassed','lastValidationErrorCount','lastValidationWarningCount','lastValidatedAt','lastValidatedBy',
  'lastImpactRunId','lastImpactRevision','lastImpactChecksum','lastImpactDatasetChecksum','lastImpactAt','lastImpactBy'
 ]);

 function stripVolatile(value){
  if(Array.isArray(value))return value.map(stripVolatile);
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,item] of Object.entries(value)){
   if(VOLATILE_KEYS.has(key))continue;
   result[key]=stripVolatile(item);
  }
  return result;
 }

 function sortByStableId(rows,keys){
  return[...(Array.isArray(rows)?rows:[])].sort((a,b)=>{
   for(const key of keys){
    const av=a?.[key],bv=b?.[key];
    if(typeof av==='number'||typeof bv==='number'){
     const diff=Number(av||0)-Number(bv||0);
     if(diff)return diff;
    }else{
     const diff=text(av).localeCompare(text(bv));
     if(diff)return diff;
    }
   }
   return 0;
  });
 }

 function canonicalPolicy(bundle={}){
  const rules=sortByStableId(bundle.rules,['ruleId','ruleKey']).map(raw=>{
   const rule=stripVolatile(raw);
   rule.selectors=sortByStableId(rule.selectors,['order','selectorId']).map(stripVolatile);
   rule.parameters=sortByStableId(rule.parameters,['order','parameterId']).map(stripVolatile);
   rule.tiers=sortByStableId(rule.tiers,['tierOrder','tierId']).map(stripVolatile);
   rule.inputs=sortByStableId(rule.inputs,['inputName','ruleInputId']).map(stripVolatile);
   return rule;
  });
  return{
   version:stripVolatile(bundle.version||{}),
   rules,
   exceptions:sortByStableId(bundle.exceptions,['exceptionId']).map(stripVolatile)
  };
 }

 function stableValue(value){
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object'){
   const result={};
   for(const key of Object.keys(value).sort())result[key]=stableValue(value[key]);
   return result;
  }
  return value;
 }

 async function sha256(value){
  const source=typeof value==='string'?value:JSON.stringify(stableValue(value));
  if(nodeCrypto)return nodeCrypto.createHash('sha256').update(source).digest('hex');
  if(webCrypto?.subtle){
   const bytes=new TextEncoder().encode(source);
   const digest=await webCrypto.subtle.digest('SHA-256',bytes);
   return[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  throw new DoeServiceError('CHECKSUM_UNAVAILABLE','SHA-256 support is unavailable.');
 }

 function createService({
  repository,
  engine=DEFAULT_ENGINE,
  actorProvider=()=>({}),
  clock=()=>new Date(),
  datasetChecksumProvider=null
 }={}){
  if(!repository)throw new Error('DOE policy repository is required.');
  if(!engine)throw new Error('DOE policy engine is required.');

  const actor=()=>actorProvider?.()||{};
  const timestamp=()=>{
   const value=clock?.();
   if(value instanceof Date)return value.toISOString();
   const parsed=new Date(value);
   return Number.isNaN(parsed.getTime())?new Date().toISOString():parsed.toISOString();
  };

  async function loadPolicyBundle(policyVersionId){
   const version=await repository.getVersion(policyVersionId);
   if(!version)throw new DoeServiceError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:text(policyVersionId)});
   const rules=await repository.listRules(policyVersionId);
   const hydrated=await Promise.all(rules.map(async rule=>{
    const [selectors,parameters,tiers,inputs]=await Promise.all([
     repository.listSelectors(rule.ruleId),
     repository.listParameters(rule.ruleId),
     repository.listTiers(rule.ruleId),
     repository.listRuleInputs(rule.ruleId)
    ]);
    return{...rule,selectors,parameters,tiers,inputs};
   }));
   const exceptions=await repository.listExceptions(policyVersionId);
   return{version,rules:hydrated,exceptions};
  }

  async function policyChecksum(bundle){
   return sha256(canonicalPolicy(bundle));
  }

  async function validateDraft(policyVersionId){
   const current=actor();
   if(!canEditDraft(current))deny('validate');
   const bundle=await loadPolicyBundle(policyVersionId);
   if(bundle.version.status!=='draft')throw new DoeServiceError('POLICY_NOT_DRAFT','Only a Draft DOE policy can be validated.',{policyVersionId:text(policyVersionId)});
   const validation=engine.validatePolicy(bundle);
   const checksum=await policyChecksum(bundle);
   const version=await repository.saveValidationResult(policyVersionId,{
    revision:Number(bundle.version.revision||0),
    policyChecksum:checksum,
    valid:validation.valid,
    errorCount:validation.errors.length,
    warningCount:validation.warnings.length,
    actor:current
   });
   return{
    ...validation,
    policyVersionId:text(policyVersionId),
    policyRevision:Number(bundle.version.revision||0),
    policyChecksum:checksum,
    version
   };
  }

  async function currentDatasetChecksum(run){
   if(typeof datasetChecksumProvider!=='function')return text(run?.inputDatasetChecksum);
   const value=await datasetChecksumProvider();
   if(typeof value==='string')return text(value);
   return sha256(value);
  }

  async function publish(policyVersionId){
   const current=actor();
   if(!canPublish(current))deny('publish');
   const bundle=await loadPolicyBundle(policyVersionId);
   const version=bundle.version;
   if(version.status!=='draft')throw new DoeServiceError('POLICY_NOT_DRAFT','Only a Draft DOE policy can be published.',{policyVersionId:text(policyVersionId)});
   const runId=text(version.lastImpactRunId);
   if(!runId)throw new DoeServiceError('PREVIEW_REQUIRED','A successful Impact Preview is required before Publish.',{policyVersionId:text(policyVersionId)});
   const run=await repository.getImpactRun(runId);
   if(!run)throw new DoeServiceError('PREVIEW_REQUIRED','The required Impact Preview record was not found.',{impactRunId:runId});
   const checksum=await policyChecksum(bundle);
   const revision=Number(version.revision||0);
   if(
    text(run.policyVersionId)!==text(policyVersionId)||
    Number(run.policyRevision)!==revision||
    text(run.policyChecksum)!==checksum||
    Number(version.lastImpactRevision)!==revision||
    text(version.lastImpactChecksum)!==checksum
   ){
    throw new DoeServiceError('PREVIEW_STALE','Impact Preview is stale for the current Draft revision.',{impactRunId:runId});
   }
   if(run.status!=='passed'||Number(run.errorCount||0)>0){
    throw new DoeServiceError('PREVIEW_FAILED','Impact Preview contains blocking errors.',{impactRunId:runId});
   }
   if(Number(version.lastValidatedRevision)!==revision||text(version.rulesChecksum)!==checksum||version.lastValidationPassed!==true){
    throw new DoeServiceError('VALIDATION_REQUIRED','The current Draft revision must pass validation before Publish.',{policyVersionId:text(policyVersionId)});
   }
   const datasetChecksum=await currentDatasetChecksum(run);
   if(text(run.inputDatasetChecksum)!==datasetChecksum||text(version.lastImpactDatasetChecksum)!==datasetChecksum){
    throw new DoeServiceError('PREVIEW_STALE','The DOE source dataset changed after Impact Preview.',{impactRunId:runId});
   }

   const publishedAt=timestamp();
   const safeTime=publishedAt.replace(/[^0-9]/g,'').slice(0,14);
   const publication={
    publicationId:`publication-${text(policyVersionId)}-${revision}-${safeTime}`,
    policyVersionId:text(policyVersionId),
    policyRevision:revision,
    policyChecksum:checksum,
    impactRunId:runId,
    inputDatasetChecksum:datasetChecksum,
    publishedAt,
    publishedBy:text(current.uid),
    publishedByName:text(current.name),
    summary:{
     facultyCount:Number(run.facultyCount||0),
     calculationCount:Number(run.calculationCount||0),
     changedFacultyCount:Number(run.changedFacultyCount||0),
     errorCount:Number(run.errorCount||0),
     warningCount:Number(run.warningCount||0)
    }
   };
   return repository.publishVersion({
    policyVersionId:text(policyVersionId),
    expectedRevision:revision,
    policyChecksum:checksum,
    impactRunId:runId,
    inputDatasetChecksum:datasetChecksum,
    publication,
    actor:current
   });
  }

  async function createPolicyYear({academicYear,name='',description='',policyId='',policyVersionId=''}={}){
   const current=actor();
   if(!canEditDraft(current))deny('create');
   const year=text(academicYear);
   if(!/^\d{4}-\d{2}$/.test(year))throw new DoeServiceError('ACADEMIC_YEAR_INVALID','Academic Year must use YYYY-YY format.');
   const resolvedPolicyId=text(policyId)||`ucvm-workload-${year}`;
   const resolvedVersionId=text(policyVersionId)||`${resolvedPolicyId}-v1`;
   const createdAt=timestamp();
   const policy=await repository.createPolicy({
    policyId:resolvedPolicyId,academicYear:year,name:text(name)||`UCVM Workload Policy ${year}`,
    description:text(description),currentActiveVersionId:'',createdAt,createdBy:text(current.uid),updatedAt:createdAt,updatedBy:text(current.uid)
   });
   const version=await repository.createVersion({
    policyVersionId:resolvedVersionId,policyId:resolvedPolicyId,academicYear:year,versionNumber:1,status:'draft',revision:0,
    clonedFromVersionId:'',rulesChecksum:'',lastValidatedRevision:null,lastImpactRunId:'',
    createdAt,createdBy:text(current.uid),updatedAt:createdAt,updatedBy:text(current.uid)
   });
   return{policy,version};
  }

  async function archive(policyVersionId){
   const current=actor();
   if(!canPublish(current))deny('archive');
   if(typeof repository.archiveVersion!=='function')throw new DoeServiceError('REPOSITORY_CAPABILITY_MISSING','Repository cannot archive DOE policy versions.');
   return repository.archiveVersion(policyVersionId,current);
  }

  function clonedId(versionId,kind,sourceId){
   const safe=text(sourceId).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||kind;
   return `${versionId}--${kind}--${safe}`;
  }

  function cloneRow(row,overrides,drop=[]){
   const copy={...(row||{})};
   for(const key of [
    'createdAt','createdBy','updatedAt','updatedBy','publishedAt','publishedBy',
    'archivedAt','archivedBy','lastValidatedAt','lastValidatedBy','lastImpactAt','lastImpactBy',
    ...drop
   ])delete copy[key];
   return{...copy,...overrides};
  }

  async function cloneAsDraft(sourceVersionId){
   const current=actor();
   if(!canEditDraft(current))deny('clone');
   const source=await loadPolicyBundle(sourceVersionId);
   const versions=await repository.listVersions(source.version.policyId);
   const nextNumber=Math.max(0,...versions.map(version=>Number(version.versionNumber||0)))+1;
   const targetVersionId=`${source.version.policyId}-v${nextNumber}`;
   const createdAt=timestamp();
   let target=await repository.createVersion({
    policyVersionId:targetVersionId,
    policyId:source.version.policyId,
    academicYear:source.version.academicYear,
    versionNumber:nextNumber,
    status:'draft',
    revision:0,
    clonedFromVersionId:text(sourceVersionId),
    rulesChecksum:'',
    lastValidatedRevision:null,
    lastValidationPassed:false,
    lastImpactRunId:'',
    createdAt,
    createdBy:text(current.uid),
    updatedAt:createdAt,
    updatedBy:text(current.uid)
   });

   let revision=Number(target.revision||0);
   for(const sourceRule of source.rules){
    const newRuleId=clonedId(targetVersionId,'rule',sourceRule.ruleId||sourceRule.ruleKey);
    const rule=cloneRow(sourceRule,{
     ruleId:newRuleId,
     policyVersionId:targetVersionId
    },['selectors','parameters','tiers','inputs']);
    const savedRule=await repository.saveDraftRule(rule,revision,current);
    revision=Number(savedRule.version.revision||0);

    for(const selector of sourceRule.selectors||[]){
     const saved=await repository.saveSelector(cloneRow(selector,{
      selectorId:clonedId(targetVersionId,'selector',selector.selectorId),
      ruleId:newRuleId,
      policyVersionId:targetVersionId
     }),revision,current);
     revision=Number(saved.version.revision||0);
    }
    for(const parameter of sourceRule.parameters||[]){
     const saved=await repository.saveParameter(cloneRow(parameter,{
      parameterId:clonedId(targetVersionId,'parameter',parameter.parameterId),
      ruleId:newRuleId,
      policyVersionId:targetVersionId
     }),revision,current);
     revision=Number(saved.version.revision||0);
    }
    for(const tier of sourceRule.tiers||[]){
     const saved=await repository.saveTier(cloneRow(tier,{
      tierId:clonedId(targetVersionId,'tier',tier.tierId),
      ruleId:newRuleId,
      policyVersionId:targetVersionId
     }),revision,current);
     revision=Number(saved.version.revision||0);
    }
    for(const input of sourceRule.inputs||[]){
     const saved=await repository.saveRuleInput(cloneRow(input,{
      ruleInputId:clonedId(targetVersionId,'input',input.ruleInputId||input.inputName),
      ruleId:newRuleId,
      policyVersionId:targetVersionId
     }),revision,current);
     revision=Number(saved.version.revision||0);
    }
   }

   for(const exception of source.exceptions||[]){
    const saved=await repository.saveException(cloneRow(exception,{
     exceptionId:clonedId(targetVersionId,'exception',exception.exceptionId),
     policyVersionId:targetVersionId
    }),revision,current);
    revision=Number(saved.version.revision||0);
   }

   target=await repository.getVersion(targetVersionId);
   if(typeof repository.appendAudit==='function'){
    await repository.appendAudit({
     auditId:clonedId(targetVersionId,'audit','draft-created'),
     policyVersionId:targetVersionId,
     action:'draft_cloned',
     entityType:'policy_version',
     entityId:targetVersionId,
     sourcePolicyVersionId:text(sourceVersionId),
     changedBy:text(current.uid),
     changedByName:text(current.name),
     changedByEmail:text(current.email),
     changedAt:timestamp()
    });
   }
   return{version:target,sourcePolicyVersionId:text(sourceVersionId)};
  }

  async function activePolicyForYear(academicYear){
   const year=text(academicYear);
   const policies=await repository.listPolicies();
   const policy=policies.find(row=>text(row.academicYear)===year);
   const activeId=text(policy?.currentActiveVersionId);
   if(!policy||!activeId)throw new DoeServiceError('ACTIVE_POLICY_NOT_FOUND','No Active DOE policy exists for the requested Academic Year.',{academicYear:year});
   const bundle=await loadPolicyBundle(activeId);
   if(bundle.version.status!=='active')throw new DoeServiceError('ACTIVE_POLICY_NOT_FOUND','DOE policy active pointer does not reference an Active version.',{academicYear:year,policyVersionId:activeId});
   return{policy,bundle};
  }

  async function calculateSession(context={}){
   const year=text(context.academicYear);
   if(!year)throw new DoeServiceError('ACADEMIC_YEAR_REQUIRED','Academic Year is required for DOE calculation.');
   const {bundle}=await activePolicyForYear(year);
   return engine.calculate(bundle,context);
  }

  function calculationId(metadata,current){
   if(text(metadata?.calculationId))return text(metadata.calculationId);
   const uuid=nodeCrypto?.randomUUID?.()||webCrypto?.randomUUID?.();
   if(uuid)return`calculation-${uuid}`;
   const safeTime=timestamp().replace(/[^0-9]/g,'').slice(0,17);
   const source=text(metadata?.assignmentId||metadata?.sessionId||metadata?.facultyId||current?.uid||'record').replace(/[^A-Za-z0-9._-]+/g,'-');
   return`calculation-${safeTime}-${source}`;
  }

  async function recordCalculation(result,metadata={}){
   const current=actor();
   if(!result||result.ok!==true||!Number.isFinite(Number(result.resultDoe))){
    throw new DoeServiceError('CALCULATION_RESULT_INVALID','A successful finite DOE calculation result is required.');
   }
   const record={
    calculationId:calculationId(metadata,current),
    academicYear:text(result.academicYear||metadata.academicYear),
    policyVersionId:text(result.policyVersionId),
    ruleId:text(result.ruleId),
    ruleKey:text(result.ruleKey),
    exceptionId:text(result.exceptionId),
    source:text(result.source),
    facultyId:text(metadata.facultyId),
    sessionId:text(metadata.sessionId),
    assignmentId:text(metadata.assignmentId),
    sourceEntityType:text(metadata.sourceEntityType),
    sourceEntityId:text(metadata.sourceEntityId),
    inputsSnapshot:{...(result.inputs||{})},
    parametersSnapshot:{...(result.parameters||{})},
    ruleSnapshot:{...(result.ruleSnapshot||{})},
    resultDoe:Number(result.resultDoe),
    trigger:text(metadata.trigger),
    calculatedAt:timestamp(),
    calculatedBy:text(current.uid),
    calculatedByName:text(current.name),
    calculatedByEmail:text(current.email)
   };
   return repository.createCalculationRecord(record);
  }

  return Object.freeze({
   loadPolicyBundle,policyChecksum,validateDraft,publish,createPolicyYear,cloneAsDraft,archive,
   activePolicyForYear,calculateSession,recordCalculation,
   capabilities:()=>({canEditDraft:canEditDraft(actor()),canPublish:canPublish(actor()),canRecalculate:canRecalculate(actor())})
  });
 }

 return{
  DoeServiceError,
  role,
  canEditDraft,
  canPublish,
  canRecalculate,
  canonicalPolicy,
  sha256,
  createService
 };
});
