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

 function migrationNumber(value){
  if(value===null||value===undefined||value==='')return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
 }

 function roundedDoe(value){
  const numeric=Number(value);
  return Number.isFinite(numeric)?Number(numeric.toFixed(6)):0;
 }

 function migrationExceptionId(row,index){
  const stableParts=[row?.migrationId,row?.facultyId,row?.category,row?.assignment,row?.sourceReference].map(text);
  const source=stableParts.some(Boolean)?stableParts.join('|'):`row-${index}`;
  let hash=2166136261;
  for(let offset=0;offset<source.length;offset++){
   hash^=source.charCodeAt(offset);
   hash=Math.imul(hash,16777619);
  }
  return`migration-exception-${(hash>>>0).toString(16).padStart(8,'0')}`;
 }

 function planMigrationExceptions(rows,{policyVersionId=''}={}){
  const generalRuleRecords=[],exceptions=[],reviewErrors=[];
  const safeClassifications=new Set(['safe_general_rule','general_rule']);
  const exceptionClassifications=new Set(['fixed','prorated','source_reconciled']);

  for(const [index,raw] of (Array.isArray(rows)?rows:[]).entries()){
   const row=raw&&typeof raw==='object'?raw:{};
   const classification=text(row.classification).toLowerCase().replace(/[\s-]+/g,'_');
   if(safeClassifications.has(classification)){
    generalRuleRecords.push({...row});
    continue;
   }
   if(exceptionClassifications.has(classification)){
    const required={
     facultyId:text(row.facultyId),category:text(row.category),assignment:text(row.assignment),
     fixedDoe:migrationNumber(row.fixedDoe),reason:text(row.reason),sourceReference:text(row.sourceReference)
    };
    const missing=Object.entries(required).filter(([,value])=>value===null||value==='').map(([key])=>key);
    if(missing.length){
     reviewErrors.push({
      code:'MIGRATION_EXCEPTION_INVALID',message:'Migration Exception requires faculty, category, assignment, fixed DOE, reason, and source reference.',
      migrationId:text(row.migrationId),missing
     });
     continue;
    }
    exceptions.push({
     exceptionId:migrationExceptionId(row,index),policyVersionId:text(policyVersionId),
     facultyId:required.facultyId,category:required.category,assignment:required.assignment,
     fixedDoe:required.fixedDoe,reason:required.reason,sourceReference:required.sourceReference,
     scopeType:'assignment',scopeKey:text(row.assignmentId)||required.assignment,
     resultKind:text(row.resultKind)||'credit',priority:migrationNumber(row.priority)??500,
     enabled:true,migrationClassification:classification
    });
    continue;
   }
   reviewErrors.push({
    code:classification==='unresolved'?'MIGRATION_CLASSIFICATION_UNRESOLVED':'MIGRATION_CLASSIFICATION_REQUIRED',
    message:classification==='unresolved'?'Migration source remains unresolved and requires authorized review.':'Migration source must be explicitly classified; a formula is never inferred from observed values.',
    migrationId:text(row.migrationId),facultyId:text(row.facultyId),category:text(row.category),assignment:text(row.assignment)
   });
  }

  return{
   policyVersionId:text(policyVersionId),generalRuleRecords,exceptions,reviewErrors,
   accepted:reviewErrors.length===0
  };
 }

 function buildShadowParityReport(rows,{tolerance=.01}={}){
  const numericTolerance=migrationNumber(tolerance);
  const effectiveTolerance=numericTolerance===null||numericTolerance<0?.01:numericTolerance;
  const groups=new Map();
  for(const raw of Array.isArray(rows)?rows:[]){
   const facultyId=text(raw?.facultyId);
   if(!groups.has(facultyId))groups.set(facultyId,{facultyId,oldTotal:0,engineTotal:0,ruleExplainedAmount:0,exceptionExplainedAmount:0,unresolvedAmount:0});
   const group=groups.get(facultyId),oldDoe=migrationNumber(raw?.oldDoe),engineDoe=migrationNumber(raw?.engineDoe);
   const oldValue=oldDoe??0,engineValue=engineDoe??0,delta=roundedDoe(engineValue-oldValue);
   group.oldTotal=roundedDoe(group.oldTotal+oldValue);
   group.engineTotal=roundedDoe(group.engineTotal+engineValue);
   const classification=text(raw?.classification).toLowerCase().replace(/[\s-]+/g,'_');
   if(oldDoe===null||engineDoe===null){
    group.unresolvedAmount=roundedDoe(group.unresolvedAmount+delta);
   }else if(classification==='rule'){
    group.ruleExplainedAmount=roundedDoe(group.ruleExplainedAmount+delta);
   }else if(classification==='exception'&&text(raw?.reason)&&text(raw?.sourceReference)&&approvedMigrationDifference(raw?.approval)){
    group.exceptionExplainedAmount=roundedDoe(group.exceptionExplainedAmount+delta);
   }else{
    group.unresolvedAmount=roundedDoe(group.unresolvedAmount+delta);
   }
  }

  const faculty=[...groups.values()].sort((a,b)=>a.facultyId.localeCompare(b.facultyId)).map(group=>{
   const difference=roundedDoe(group.engineTotal-group.oldTotal);
   const unresolvedAmount=roundedDoe(difference-group.ruleExplainedAmount-group.exceptionExplainedAmount);
   return{
    facultyId:group.facultyId,oldTotal:group.oldTotal,engineTotal:group.engineTotal,difference,
    ruleExplainedAmount:group.ruleExplainedAmount,exceptionExplainedAmount:group.exceptionExplainedAmount,
    unresolvedAmount,accepted:Math.abs(unresolvedAmount)<=effectiveTolerance
   };
  });
  const blockingFacultyIds=faculty.filter(row=>!row.accepted).map(row=>row.facultyId);
  return{tolerance:effectiveTolerance,accepted:blockingFacultyIds.length===0,blockingFacultyIds,faculty};
 }

 function approvedMigrationDifference(approval={}){
  const approvedAt=text(approval?.approvedAt);
  return Boolean(
   text(approval?.approvedBy)&&
   role(approval?.approvedByRole)==='adfa_general'&&
   approvedAt&&!Number.isNaN(Date.parse(approvedAt))&&
   text(approval?.approvalReference)
  );
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
  datasetProvider=null,
  datasetChecksumProvider=null,
  previewReviewThreshold=5,
  recalculationWriter=null,
  derivedIndexRefresh=null,
  recalculationChunkSize=200
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

  function previewRelevantFields(bundle={}){
   const fields=new Set([
    'academicYear','category','facultyId','sessionId','assignmentId','sourceEntityId','sourceEntityType',
    'course','roleType','date'
   ]);
   for(const rule of Array.isArray(bundle.rules)?bundle.rules:[]){
    for(const selector of Array.isArray(rule?.selectors)?rule.selectors:[]){
     const field=text(selector?.field);if(field)fields.add(field);
    }
    for(const input of Array.isArray(rule?.inputs)?rule.inputs:[]){
     const name=text(typeof input==='string'?input:input?.inputName);if(name)fields.add(name);
    }
   }
   return fields;
  }

  function previewDatasetProjection(bundle,dataset={}){
   const relevant=previewRelevantFields(bundle);
   const raw=Array.isArray(dataset?.calculations)?dataset.calculations:Array.isArray(dataset?.items)?dataset.items:[];
   const rows=raw.map(item=>{
    const source=item&&typeof item==='object'?item:{};
    const sourceContext=source.context&&typeof source.context==='object'&&!Array.isArray(source.context)?source.context:{};
    const context={};
    for(const field of [...relevant].sort()){
     const value=Object.prototype.hasOwnProperty.call(sourceContext,field)?sourceContext[field]:source[field];
     if(value!==undefined&&value!==null&&value!=='')context[field]=stableValue(value);
    }
    const currentDoe=Number(source.currentDoe);
    return{
     sourceEntityType:text(source.sourceEntityType),
     sourceEntityId:text(source.sourceEntityId||source.assignmentId||source.sessionId),
     sessionId:text(source.sessionId),
     assignmentId:text(source.assignmentId),
     facultyId:text(source.facultyId),
     currentDoe:Number.isFinite(currentDoe)?currentDoe:null,
     context
    };
   });
   rows.sort((a,b)=>
    a.facultyId.localeCompare(b.facultyId)||
    a.sourceEntityType.localeCompare(b.sourceEntityType)||
    a.sourceEntityId.localeCompare(b.sourceEntityId)||
    a.assignmentId.localeCompare(b.assignmentId)||
    a.sessionId.localeCompare(b.sessionId)
   );
   return{academicYear:text(dataset?.academicYear||bundle?.version?.academicYear),calculations:rows};
  }

  async function previewDatasetChecksum(bundle,dataset={}){
   return sha256(previewDatasetProjection(bundle,dataset));
  }

  function previewRunId(policyVersionId,revision){
   const uuid=nodeCrypto?.randomUUID?.()||webCrypto?.randomUUID?.();
   if(uuid)return`impact-${text(policyVersionId)}-${uuid}`;
   return`impact-${text(policyVersionId)}-${Number(revision||0)}-${timestamp().replace(/[^0-9]/g,'').slice(0,17)}`;
  }

  function previewError(error,item){
   return{
    code:text(error?.code)||'CALCULATION_ERROR',
    message:text(error?.message||error)||'DOE calculation failed.',
    sourceEntityType:text(item?.sourceEntityType),
    sourceEntityId:text(item?.sourceEntityId),
    facultyId:text(item?.facultyId)
   };
  }

  function calculationBundleForItem(bundle,item){
   const category=text(item?.context?.category);
   if(!category)return bundle;
   return{
    ...bundle,
    rules:(bundle.rules||[]).filter(rule=>text(rule?.category)===category),
    exceptions:(bundle.exceptions||[]).filter(exception=>!text(exception?.category)||text(exception?.category)===category)
   };
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

  async function currentDatasetChecksum(run,bundle){
   if(typeof datasetChecksumProvider==='function'){
    const value=await datasetChecksumProvider();
    if(typeof value==='string')return text(value);
    return sha256(value);
   }
   if(typeof datasetProvider==='function'){
    const value=await datasetProvider(bundle);
    return previewDatasetChecksum(bundle,value);
   }
   return text(run?.inputDatasetChecksum);
  }

  async function runImpactPreview(policyVersionId,dataset){
   const current=actor();
   if(!canEditDraft(current))deny('preview');
   const bundle=await loadPolicyBundle(policyVersionId);
   const version=bundle.version;
   if(version.status!=='draft')throw new DoeServiceError('POLICY_NOT_DRAFT','Impact Preview requires a Draft DOE policy.',{policyVersionId:text(policyVersionId)});

   const revision=Number(version.revision||0);
   const policy=await repository.getPolicy(version.policyId);
   if(!policy)throw new DoeServiceError('POLICY_NOT_FOUND','DOE policy was not found.',{policyId:text(version.policyId)});
   const activeVersionIdAtPreview=text(policy.currentActiveVersionId);
   const checksum=await policyChecksum(bundle);
   const validation=engine.validatePolicy(bundle);
   const validationCurrent=
    validation.valid===true&&
    Number(version.lastValidatedRevision)===revision&&
    version.lastValidationPassed===true&&
    text(version.rulesChecksum)===checksum;
   if(!validationCurrent){
    throw new DoeServiceError('VALIDATION_REQUIRED','Validate the current DOE Draft revision successfully before running Impact Preview.',{
     policyVersionId:text(policyVersionId),policyRevision:revision,errors:validation.errors
    });
   }

   const sourceDataset=dataset===undefined?(typeof datasetProvider==='function'?await datasetProvider(bundle):null):dataset;
   if(!sourceDataset)throw new DoeServiceError('PREVIEW_DATASET_REQUIRED','DOE Impact Preview requires the current Faculty/Timetable dataset.');
   const projection=previewDatasetProjection(bundle,sourceDataset);
   const inputDatasetChecksum=await sha256(projection);
   const impactRunId=previewRunId(policyVersionId,revision);
   const groups=new Map();
   const errors=[];

   for(const item of projection.calculations){
    const facultyId=text(item.facultyId)||'unassigned';
    if(!groups.has(facultyId))groups.set(facultyId,{
     facultyId,
     currentDoe:0,
     draftDoe:0,
     calculationCount:0,
     affectedRules:new Set(),
     errors:[]
    });
    const group=groups.get(facultyId);
    group.calculationCount+=1;
    if(Number.isFinite(item.currentDoe))group.currentDoe+=item.currentDoe;
    const context={
     ...(item.context||{}),
     academicYear:text(version.academicYear),
     facultyId:text(item.facultyId),
     sessionId:text(item.sessionId),
     assignmentId:text(item.assignmentId),
     sourceEntityId:text(item.sourceEntityId),
     sourceEntityType:text(item.sourceEntityType)
    };
    try{
     const result=engine.calculate(calculationBundleForItem(bundle,{...item,context}),context);
     group.draftDoe+=Number(result.resultDoe);
     if(text(result.ruleKey))group.affectedRules.add(text(result.ruleKey));
     else if(text(result.exceptionId))group.affectedRules.add(`Exception: ${text(result.exceptionId)}`);
    }catch(error){
     const detail=previewError(error,item);
     group.errors.push(detail);
     errors.push(detail);
    }
   }

   const threshold=Math.abs(Number(previewReviewThreshold))||5;
   let changedFacultyCount=0,largeIncreaseCount=0,largeDecreaseCount=0,warningCount=0;
   const rows=[...groups.values()].sort((a,b)=>a.facultyId.localeCompare(b.facultyId)).map(group=>{
    const rowErrors=group.errors.slice();
    const draftDoe=rowErrors.length?null:group.draftDoe;
    const difference=draftDoe===null?null:draftDoe-group.currentDoe;
    const warnings=[];
    if(difference!==null&&difference>threshold){
     warnings.push({code:'LARGE_INCREASE',message:`Draft DOE increases by more than ${threshold.toFixed(2)} percentage points.`});
     largeIncreaseCount+=1;
    }else if(difference!==null&&difference<-threshold){
     warnings.push({code:'LARGE_DECREASE',message:`Draft DOE decreases by more than ${threshold.toFixed(2)} percentage points.`});
     largeDecreaseCount+=1;
    }
    if(difference!==null&&Math.abs(difference)>1e-9)changedFacultyCount+=1;
    warningCount+=warnings.length;
    return{
     impactRowId:`${impactRunId}--faculty--${group.facultyId.replace(/[^A-Za-z0-9._-]+/g,'-')}`,
     impactRunId,
     policyVersionId:text(policyVersionId),
     facultyId:group.facultyId,
     currentDoe:group.currentDoe,
     draftDoe,
     difference,
     calculationCount:group.calculationCount,
     affectedRules:[...group.affectedRules].sort(),
     warnings,
     errors:rowErrors
    };
   });

   const status=errors.length?'failed':'passed';
   const completedAt=timestamp();
   const run={
    impactRunId,
    policyVersionId:text(policyVersionId),
    policyRevision:revision,
    policyChecksum:checksum,
    inputDatasetChecksum,
    activeVersionIdAtPreview,
    status,
    facultyCount:rows.length,
    calculationCount:projection.calculations.length,
    changedFacultyCount,
    largeIncreaseCount,
    largeDecreaseCount,
    errorCount:errors.length,
    warningCount,
    startedAt:completedAt,
    completedAt,
    runBy:text(current.uid),
    runByName:text(current.name)
   };
   await repository.createImpactRun(run);
   if(rows.length)await repository.saveImpactRows(impactRunId,rows);
   if(status==='passed'){
    await repository.saveImpactEvidence(policyVersionId,{
     revision,
     impactRunId,
     policyChecksum:checksum,
     inputDatasetChecksum,
     actor:current
    });
   }
   return{...run,rows,errors,warnings:rows.flatMap(row=>row.warnings.map(warning=>({...warning,facultyId:row.facultyId})))};
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
   const policy=await repository.getPolicy(version.policyId);
   if(!policy)throw new DoeServiceError('POLICY_NOT_FOUND','DOE policy was not found.',{policyId:text(version.policyId)});
   const expectedActiveVersionId=text(run.activeVersionIdAtPreview);
   if(
    text(run.policyVersionId)!==text(policyVersionId)||
    Number(run.policyRevision)!==revision||
    text(run.policyChecksum)!==checksum||
    Number(version.lastImpactRevision)!==revision||
    text(version.lastImpactChecksum)!==checksum||
    !expectedActiveVersionId||
    text(policy.currentActiveVersionId)!==expectedActiveVersionId
   ){
    throw new DoeServiceError('PREVIEW_STALE','Impact Preview is stale for the current Draft revision.',{impactRunId:runId});
   }
   if(run.status!=='passed'||Number(run.errorCount||0)>0){
    throw new DoeServiceError('PREVIEW_FAILED','Impact Preview contains blocking errors.',{impactRunId:runId});
   }
   if(Number(version.lastValidatedRevision)!==revision||text(version.rulesChecksum)!==checksum||version.lastValidationPassed!==true){
    throw new DoeServiceError('VALIDATION_REQUIRED','The current Draft revision must pass validation before Publish.',{policyVersionId:text(policyVersionId)});
   }
   const datasetChecksum=await currentDatasetChecksum(run,bundle);
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
    activeVersionIdAtPreview:expectedActiveVersionId,
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
    expectedActiveVersionId,
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

  function buildCalculationRecord(result,metadata={}){
   const current=actor();
   if(!result||result.ok!==true||!Number.isFinite(Number(result.resultDoe))){
    throw new DoeServiceError('CALCULATION_RESULT_INVALID','A successful finite DOE calculation result is required.');
   }
   return{
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
    recalculationBatchId:text(metadata.recalculationBatchId),
    calculatedAt:timestamp(),
    calculatedBy:text(current.uid),
    calculatedByName:text(current.name),
    calculatedByEmail:text(current.email)
   };
  }

  async function recordCalculation(result,metadata={}){
   return repository.createCalculationRecord(buildCalculationRecord(result,metadata));
  }

  function recalculationBatchId(value,academicYear,policyVersionId){
   if(text(value))return text(value);
   const uuid=nodeCrypto?.randomUUID?.()||webCrypto?.randomUUID?.();
   if(uuid)return`recalc-${text(academicYear)}-${uuid}`;
   return`recalc-${text(academicYear)}-${text(policyVersionId)}-${timestamp().replace(/[^0-9]/g,'').slice(0,17)}`;
  }

  function recalculationScopeMatches(item,scope){
   if(!scope||scope==='all')return true;
   const context=item?.context&&typeof item.context==='object'?item.context:{};
   if(typeof scope==='string')return text(context.category)===text(scope);
   if(typeof scope!=='object')return true;
   const includes=(values,value)=>!Array.isArray(values)||!values.length||values.map(text).includes(text(value));
   return includes(scope.facultyIds,item?.facultyId)
    &&includes(scope.categories,context.category)
    &&includes(scope.sourceEntityTypes,item?.sourceEntityType)
    &&includes(scope.sourceEntityIds,item?.sourceEntityId);
  }

  async function recalculationPlan({academicYear,policyVersionId,scope='all'}={}){
   const year=text(academicYear);
   if(!year)throw new DoeServiceError('ACADEMIC_YEAR_REQUIRED','Academic Year is required for DOE recalculation.');
   const selectedId=text(policyVersionId);
   if(!selectedId)throw new DoeServiceError('POLICY_VERSION_REQUIRED','Policy Version is required for DOE recalculation.');
   const {policy,bundle}=await activePolicyForYear(year);
   if(text(bundle.version.policyVersionId)!==selectedId||text(policy.currentActiveVersionId)!==selectedId){
    throw new DoeServiceError('ACTIVE_POLICY_REQUIRED','Administrative DOE recalculation must use the current Active policy version.',{academicYear:year,policyVersionId:selectedId,activePolicyVersionId:text(policy.currentActiveVersionId)});
   }
   if(typeof datasetProvider!=='function')throw new DoeServiceError('DATASET_PROVIDER_REQUIRED','DOE recalculation requires an authoritative dataset provider.');
   const dataset=await datasetProvider(bundle);
   const raw=Array.isArray(dataset?.calculations)?dataset.calculations:Array.isArray(dataset?.items)?dataset.items:[];
   const items=raw.filter(item=>recalculationScopeMatches(item,scope)).sort((a,b)=>
    text(a?.facultyId).localeCompare(text(b?.facultyId))||
    text(a?.sourceEntityType).localeCompare(text(b?.sourceEntityType))||
    text(a?.sourceEntityId).localeCompare(text(b?.sourceEntityId))||
    text(a?.assignmentId).localeCompare(text(b?.assignmentId))
   );
   const rows=[],errors=[],warnings=[];
   const facultyIds=new Set(),oldVersions=new Set();
   let changedDoeCount=0,roleSupervisionAffected=0;
   for(const item of items){
    const context={...(item?.context||{}),academicYear:year};
    for(const key of ['facultyId','sessionId','assignmentId'])if(!text(context[key])&&text(item?.[key]))context[key]=text(item[key]);
    const category=text(context.category);
    if(['role','supervision'].includes(category))roleSupervisionAffected+=1;
    if(text(item?.facultyId))facultyIds.add(text(item.facultyId));
    if(text(item?.currentPolicyVersionId))oldVersions.add(text(item.currentPolicyVersionId));
    try{
     const result=engine.calculate(calculationBundleForItem(bundle,item),context);
     const currentDoe=Number(item?.currentDoe),hasCurrent=Number.isFinite(currentDoe),nextDoe=Number(result.resultDoe);
     const changed=!hasCurrent||Math.abs(nextDoe-currentDoe)>1e-9;
     if(changed)changedDoeCount+=1;
     if(!hasCurrent)warnings.push({code:'CURRENT_DOE_MISSING',message:'Current DOE is unavailable; recalculation will establish a canonical value.',sourceEntityType:text(item?.sourceEntityType),sourceEntityId:text(item?.sourceEntityId),facultyId:text(item?.facultyId)});
     rows.push({
      sourceEntityType:text(item?.sourceEntityType),sourceEntityId:text(item?.sourceEntityId),sessionId:text(item?.sessionId),assignmentId:text(item?.assignmentId),facultyId:text(item?.facultyId),
      category,currentDoe:hasCurrent?currentDoe:null,currentPolicyVersionId:text(item?.currentPolicyVersionId),
      resultDoe:nextDoe,policyVersionId:text(result.policyVersionId),ruleId:text(result.ruleId),ruleKey:text(result.ruleKey),exceptionId:text(result.exceptionId),source:text(result.source),
      context:{...(item?.context||{})},changed,_calculationResult:result
     });
    }catch(error){
     errors.push(previewError(error,item));
    }
   }
   return{
    bundle,rows,
    preview:{academicYear:year,policyVersionId:selectedId,scope,facultyAffected:facultyIds.size,assignmentsAffected:rows.length+errors.length,roleSupervisionAffected,oldPolicyVersions:[...oldVersions].sort(),newActiveVersion:selectedId,changedDoeCount,errors,warnings}
   };
  }

  async function previewRecalculate(options={}){
   const current=actor();
   if(!canRecalculate(current))deny('preview administrative recalculation for');
   return (await recalculationPlan(options)).preview;
  }

  async function runRecalculate({academicYear,policyVersionId,scope='all',resumeFrom=0,batchId='',onProgress}={}){
   const current=actor();
   if(!canRecalculate(current))deny('execute administrative recalculation for');
   if(typeof recalculationWriter!=='function')throw new DoeServiceError('RECALCULATION_WRITER_REQUIRED','DOE recalculation requires an atomic canonical writer.');
   const plan=await recalculationPlan({academicYear,policyVersionId,scope});
   if(plan.preview.errors.length){
    throw new DoeServiceError('RECALCULATION_PREVIEW_FAILED','DOE recalculation contains blocking calculation errors.',{preview:plan.preview});
   }
   const rows=plan.rows,batch=recalculationBatchId(batchId,academicYear,policyVersionId);
   const totalRows=rows.length,startIndex=Math.min(Math.max(0,Number(resumeFrom)||0),totalRows);
   const chunkSize=Math.max(1,Math.min(200,Number(recalculationChunkSize)||200));
   let completedRows=startIndex;
   if(typeof repository.appendAudit==='function')await repository.appendAudit({
    policyVersionId:text(policyVersionId),action:'recalculation_started',entityType:'policy_version',entityId:text(policyVersionId),
    recalculationBatchId:batch,academicYear:text(academicYear),scope,completedRows:startIndex,totalRows,
    changedBy:text(current.uid),changedByName:text(current.name),changedByEmail:text(current.email),changedAt:timestamp()
   });
   try{
    if(typeof onProgress==='function')onProgress({batchId:batch,status:'running',completedRows,totalRows,resumeFrom:startIndex});
    for(let start=startIndex;start<totalRows;start+=chunkSize){
     const end=Math.min(totalRows,start+chunkSize),chunk=rows.slice(start,end);
     const calculationRecords=chunk.map(row=>buildCalculationRecord(row._calculationResult,{
      facultyId:row.facultyId,sessionId:row.sessionId,assignmentId:row.assignmentId,sourceEntityType:row.sourceEntityType,sourceEntityId:row.sourceEntityId,
      trigger:'administrative_recalculation',recalculationBatchId:batch
     }));
     const publicRows=chunk.map(({_calculationResult,...row})=>row);
     await recalculationWriter({academicYear:text(academicYear),policyVersionId:text(policyVersionId),scope,batchId:batch,start,end,totalRows,rows:publicRows,calculationRecords,actor:current});
     completedRows=end;
     if(typeof onProgress==='function')onProgress({batchId:batch,status:'running',completedRows,totalRows,resumeFrom:completedRows});
    }
   }catch(error){
    error.partialCommit=completedRows>startIndex||startIndex>0;
    error.completedRows=completedRows;
    error.resumeFrom=completedRows;
    error.batchId=batch;
    throw error;
   }
   try{
    if(typeof derivedIndexRefresh==='function')await derivedIndexRefresh({academicYear:text(academicYear),policyVersionId:text(policyVersionId),scope,batchId:batch,completedRows,totalRows});
   }catch(error){
    error.partialCommit=completedRows>0;
    error.completedRows=completedRows;
    error.resumeFrom=completedRows;
    error.batchId=batch;
    throw error;
   }
   if(typeof repository.appendAudit==='function')await repository.appendAudit({
    policyVersionId:text(policyVersionId),action:'recalculation_completed',entityType:'policy_version',entityId:text(policyVersionId),
    recalculationBatchId:batch,academicYear:text(academicYear),scope,completedRows,totalRows,
    changedBy:text(current.uid),changedByName:text(current.name),changedByEmail:text(current.email),changedAt:timestamp()
   });
   if(typeof onProgress==='function')onProgress({batchId:batch,status:'completed',completedRows,totalRows,resumeFrom:null});
   return{...plan.preview,batchId:batch,totalRows,completedRows,resumeFrom:null};
  }

  return Object.freeze({
   loadPolicyBundle,policyChecksum,previewDatasetProjection,previewDatasetChecksum,validateDraft,runImpactPreview,publish,createPolicyYear,cloneAsDraft,archive,
   activePolicyForYear,calculateSession,buildCalculationRecord,recordCalculation,previewRecalculate,runRecalculate,
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
  planMigrationExceptions,
  buildShadowParityReport,
  createService
 };
});
