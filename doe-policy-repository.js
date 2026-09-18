(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_POLICY_REPOSITORY=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';

 const COLLECTIONS=Object.freeze({
  policies:'doe_policies',
  versions:'doe_policy_versions',
  rules:'doe_rules',
  selectors:'doe_rule_selectors',
  parameters:'doe_rule_parameters',
  tiers:'doe_rule_tiers',
  inputs:'doe_rule_inputs',
  exceptions:'doe_exceptions',
  impactRuns:'doe_impact_runs',
  impactRows:'doe_impact_rows',
  publications:'doe_publications',
  calculations:'doe_calculation_records',
  audit:'doe_audit_log'
 });

 class RepositoryError extends Error{
  constructor(code,message,details={}){
   super(message);
   this.name='RepositoryError';
   this.code=code;
   Object.assign(this,details);
  }
 }

 const text=value=>String(value??'').trim();

 function normalizeDomainObject(value){
  if(value===null||value===undefined)return value;
  if(value instanceof Date)return value.toISOString();
  if(value&&typeof value.toDate==='function'){
   const converted=value.toDate();
   return converted instanceof Date?converted.toISOString():normalizeDomainObject(converted);
  }
  if(Array.isArray(value))return value.map(normalizeDomainObject);
  if(typeof value==='object'){
   const result={};
   for(const [key,item] of Object.entries(value))result[key]=normalizeDomainObject(item);
   return result;
  }
  return value;
 }

 const clone=value=>normalizeDomainObject(value);
 const now=()=>new Date().toISOString();

 function createMemoryRepository(seed={}){
  const stores={
   policies:new Map(),
   versions:new Map(),
   rules:new Map(),
   selectors:new Map(),
   parameters:new Map(),
   tiers:new Map(),
   inputs:new Map(),
   exceptions:new Map(),
   impactRuns:new Map(),
   impactRows:new Map(),
   publications:new Map(),
   calculations:new Map(),
   audit:new Map()
  };
  let sequence=0;

  const idField={
   policies:'policyId',versions:'policyVersionId',rules:'ruleId',selectors:'selectorId',
   parameters:'parameterId',tiers:'tierId',inputs:'ruleInputId',exceptions:'exceptionId',
   impactRuns:'impactRunId',impactRows:'impactRowId',publications:'publicationId',
   calculations:'calculationId',audit:'auditId'
  };

  function putSeed(storeName,rows){
   for(const raw of Array.isArray(rows)?rows:[]){
    const row=clone(raw),key=text(row?.[idField[storeName]]);
    if(key)stores[storeName].set(key,row);
   }
  }
  for(const storeName of Object.keys(stores))putSeed(storeName,seed?.[storeName]);

  function values(storeName){
   return[...stores[storeName].values()].map(clone);
  }
  function one(storeName,id){
   const row=stores[storeName].get(text(id));
   return row?clone(row):null;
  }
  function requireId(storeName,row){
   const field=idField[storeName],id=text(row?.[field]);
   if(!id)throw new RepositoryError('BUSINESS_ID_REQUIRED',`${field} is required.`,{field});
   return id;
  }
  function requireVersion(versionId){
   const id=text(versionId),version=stores.versions.get(id);
   if(!version)throw new RepositoryError('POLICY_VERSION_NOT_FOUND',`DOE policy version "${id}" was not found.`,{policyVersionId:id});
   return version;
  }
  function requireDraft(versionId,expectedRevision){
   const version=requireVersion(versionId);
   if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Only Draft DOE policy versions can be edited.',{policyVersionId:text(versionId)});
   if(Number(version.revision||0)!==Number(expectedRevision)){
    throw new RepositoryError('POLICY_REVISION_CONFLICT','DOE policy Draft changed since it was loaded.',{
     policyVersionId:text(versionId),expectedRevision:Number(expectedRevision),actualRevision:Number(version.revision||0)
    });
   }
   return version;
  }
  function actorFields(actor={}){
   return{
    changedBy:text(actor.uid),
    changedByName:text(actor.name),
    changedByEmail:text(actor.email)
   };
  }
  function generatedId(prefix){
   sequence+=1;
   return`${prefix}-${sequence}`;
  }
  function appendAuditInternal(event){
   const row=clone(event||{});
   if(!text(row.auditId))row.auditId=generatedId('audit');
   if(stores.audit.has(row.auditId))throw new RepositoryError('EVIDENCE_ALREADY_EXISTS','DOE audit record already exists.',{auditId:row.auditId});
   if(!row.changedAt)row.changedAt=now();
   stores.audit.set(row.auditId,row);
   return clone(row);
  }
  function bumpDraft(version,actor,action,entityType,entityId,before,after){
   version.revision=Number(version.revision||0)+1;
   version.lastImpactRunId='';
   version.lastImpactRevision=null;
   version.lastImpactChecksum='';
   version.lastImpactDatasetChecksum='';
   version.lastValidatedRevision=null;
   version.updatedAt=now();
   version.updatedBy=text(actor?.uid);
   stores.versions.set(version.policyVersionId,clone(version));
   appendAuditInternal({
    policyVersionId:version.policyVersionId,
    action,entityType,entityId,
    beforeSnapshot:clone(before??null),
    afterSnapshot:clone(after??null),
    ...actorFields(actor)
   });
   return clone(version);
  }

  async function listPolicies(){return values('policies')}
  async function getPolicy(policyId){return one('policies',policyId)}
  async function listVersions(policyId){return values('versions').filter(row=>row.policyId===text(policyId)).sort((a,b)=>Number(a.versionNumber||0)-Number(b.versionNumber||0))}
  async function getVersion(policyVersionId){return one('versions',policyVersionId)}
  async function listRules(policyVersionId){return values('rules').filter(row=>row.policyVersionId===text(policyVersionId))}
  async function getRule(ruleId){return one('rules',ruleId)}
  async function listSelectors(ruleId){return values('selectors').filter(row=>row.ruleId===text(ruleId))}
  async function listParameters(ruleId){return values('parameters').filter(row=>row.ruleId===text(ruleId))}
  async function listTiers(ruleId){return values('tiers').filter(row=>row.ruleId===text(ruleId)).sort((a,b)=>Number(a.tierOrder||0)-Number(b.tierOrder||0))}
  async function listRuleInputs(ruleId){return values('inputs').filter(row=>row.ruleId===text(ruleId))}
  async function listExceptions(policyVersionId){return values('exceptions').filter(row=>row.policyVersionId===text(policyVersionId))}
  async function listImpactRows(impactRunId){return values('impactRows').filter(row=>row.impactRunId===text(impactRunId))}
  async function getImpactRun(impactRunId){return one('impactRuns',impactRunId)}
  async function listPublications(policyVersionId){return values('publications').filter(row=>row.policyVersionId===text(policyVersionId))}
  async function listAudit(policyVersionId){return values('audit').filter(row=>!policyVersionId||row.policyVersionId===text(policyVersionId))}
  async function listCalculationRecords(filter={}){
   return values('calculations').filter(row=>Object.entries(filter||{}).every(([key,value])=>String(row?.[key]??'')===String(value??'')));
  }

  async function createPolicy(policy){
   const row=clone(policy),id=requireId('policies',row);
   if(stores.policies.has(id))throw new RepositoryError('POLICY_ALREADY_EXISTS','DOE policy already exists.',{policyId:id});
   stores.policies.set(id,row);
   return clone(row);
  }

  async function createVersion(version){
   const row=clone(version),id=requireId('versions',row);
   if(stores.versions.has(id))throw new RepositoryError('POLICY_VERSION_ALREADY_EXISTS','DOE policy version already exists.',{policyVersionId:id});
   if(!row.status)row.status='draft';
   if(row.revision===undefined||row.revision===null)row.revision=0;
   stores.versions.set(id,row);
   return clone(row);
  }

  async function saveDraftRule(rule,expectedRevision,actor={}){
   const row=clone(rule),id=requireId('rules',row),version=requireDraft(row.policyVersionId,expectedRevision);
   const before=stores.rules.get(id)||null;
   if(before&&before.policyVersionId!==row.policyVersionId)throw new RepositoryError('BUSINESS_ID_CONFLICT','ruleId belongs to another policy version.',{ruleId:id});
   stores.rules.set(id,row);
   const updated=bumpDraft(version,actor,before?'rule_updated':'rule_created','rule',id,before,row);
   return{rule:clone(row),version:updated};
  }

  async function deleteDraftRule(ruleId,expectedRevision,actor={}){
   const id=text(ruleId),before=stores.rules.get(id);
   if(!before)throw new RepositoryError('RULE_NOT_FOUND','DOE rule was not found.',{ruleId:id});
   const version=requireDraft(before.policyVersionId,expectedRevision);
   stores.rules.delete(id);
   for(const storeName of ['selectors','parameters','tiers','inputs']){
    for(const [key,row] of stores[storeName])if(row.ruleId===id)stores[storeName].delete(key);
   }
   const updated=bumpDraft(version,actor,'rule_deleted','rule',id,before,null);
   return{ruleId:id,version:updated};
  }

  async function saveDraftChild(storeName,row,expectedRevision,actor={}){
   const normalized=clone(row),id=requireId(storeName,normalized);
   const rule=stores.rules.get(text(normalized.ruleId));
   if(!rule)throw new RepositoryError('RULE_NOT_FOUND','Parent DOE rule was not found.',{ruleId:text(normalized.ruleId)});
   const version=requireDraft(rule.policyVersionId,expectedRevision);
   normalized.policyVersionId=rule.policyVersionId;
   const before=stores[storeName].get(id)||null;
   if(before&&before.ruleId!==normalized.ruleId)throw new RepositoryError('BUSINESS_ID_CONFLICT','DOE child ID belongs to another rule.',{id});
   stores[storeName].set(id,normalized);
   const entityType={selectors:'selector',parameters:'parameter',tiers:'tier',inputs:'rule_input'}[storeName];
   const updated=bumpDraft(version,actor,before?`${entityType}_updated`:`${entityType}_created`,entityType,id,before,normalized);
   return{row:clone(normalized),version:updated};
  }

  async function deleteDraftChild(storeName,id,expectedRevision,actor={}){
   const key=text(id),before=stores[storeName].get(key);
   if(!before)throw new RepositoryError('DOE_CHILD_NOT_FOUND','DOE rule child record was not found.',{id:key});
   const rule=stores.rules.get(text(before.ruleId));
   if(!rule)throw new RepositoryError('RULE_NOT_FOUND','Parent DOE rule was not found.',{ruleId:text(before.ruleId)});
   const version=requireDraft(rule.policyVersionId,expectedRevision);
   stores[storeName].delete(key);
   const entityType={selectors:'selector',parameters:'parameter',tiers:'tier',inputs:'rule_input'}[storeName];
   return{version:bumpDraft(version,actor,`${entityType}_deleted`,entityType,key,before,null)};
  }

  async function saveSelector(row,revision,actor){return saveDraftChild('selectors',row,revision,actor)}
  async function saveParameter(row,revision,actor){return saveDraftChild('parameters',row,revision,actor)}
  async function saveTier(row,revision,actor){return saveDraftChild('tiers',row,revision,actor)}
  async function saveRuleInput(row,revision,actor){return saveDraftChild('inputs',row,revision,actor)}
  async function deleteSelector(id,revision,actor){return deleteDraftChild('selectors',id,revision,actor)}
  async function deleteParameter(id,revision,actor){return deleteDraftChild('parameters',id,revision,actor)}
  async function deleteTier(id,revision,actor){return deleteDraftChild('tiers',id,revision,actor)}
  async function deleteRuleInput(id,revision,actor){return deleteDraftChild('inputs',id,revision,actor)}

  async function saveException(exception,expectedRevision,actor={}){
   const row=clone(exception),id=requireId('exceptions',row),version=requireDraft(row.policyVersionId,expectedRevision);
   const before=stores.exceptions.get(id)||null;
   if(before&&before.policyVersionId!==row.policyVersionId)throw new RepositoryError('BUSINESS_ID_CONFLICT','exceptionId belongs to another policy version.',{exceptionId:id});
   stores.exceptions.set(id,row);
   const updated=bumpDraft(version,actor,before?'exception_updated':'exception_created','exception',id,before,row);
   return{exception:clone(row),version:updated};
  }

  async function deleteException(exceptionId,expectedRevision,actor={}){
   const id=text(exceptionId),before=stores.exceptions.get(id);
   if(!before)throw new RepositoryError('EXCEPTION_NOT_FOUND','DOE exception was not found.',{exceptionId:id});
   const version=requireDraft(before.policyVersionId,expectedRevision);
   stores.exceptions.delete(id);
   return{exceptionId:id,version:bumpDraft(version,actor,'exception_deleted','exception',id,before,null)};
  }

  async function createImpactRun(run){
   const row=clone(run),id=requireId('impactRuns',row);
   if(stores.impactRuns.has(id))throw new RepositoryError('IMPACT_RUN_ALREADY_EXISTS','DOE Impact Preview run already exists.',{impactRunId:id});
   stores.impactRuns.set(id,row);
   return clone(row);
  }

  async function updateImpactRun(impactRunId,patch){
   const id=text(impactRunId),before=stores.impactRuns.get(id);
   if(!before)throw new RepositoryError('IMPACT_RUN_NOT_FOUND','DOE Impact Preview run was not found.',{impactRunId:id});
   const row=clone({...before,...patch,impactRunId:id});
   stores.impactRuns.set(id,row);
   return clone(row);
  }

  async function saveImpactRows(impactRunId,rows){
   const runId=text(impactRunId);
   if(!stores.impactRuns.has(runId))throw new RepositoryError('IMPACT_RUN_NOT_FOUND','DOE Impact Preview run was not found.',{impactRunId:runId});
   const saved=[];
   for(const raw of Array.isArray(rows)?rows:[]){
    const row=clone({...raw,impactRunId:runId});
    const id=requireId('impactRows',row);
    stores.impactRows.set(id,row);
    saved.push(clone(row));
   }
   return saved;
  }

  async function createPublication(publication){
   const row=clone(publication),id=requireId('publications',row);
   if(stores.publications.has(id))throw new RepositoryError('EVIDENCE_ALREADY_EXISTS','DOE publication record already exists.',{publicationId:id});
   stores.publications.set(id,row);
   return clone(row);
  }

  async function createCalculationRecord(record){
   const row=clone(record),id=requireId('calculations',row);
   if(stores.calculations.has(id))throw new RepositoryError('EVIDENCE_ALREADY_EXISTS','DOE calculation record already exists.',{calculationId:id});
   stores.calculations.set(id,row);
   return clone(row);
  }

  async function appendAudit(event){
   return appendAuditInternal(event);
  }

  async function replaceVersion(version){
   const row=clone(version),id=requireId('versions',row);
   if(!stores.versions.has(id))throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:id});
   stores.versions.set(id,row);
   return clone(row);
  }

  async function replacePolicy(policy){
   const row=clone(policy),id=requireId('policies',row);
   if(!stores.policies.has(id))throw new RepositoryError('POLICY_NOT_FOUND','DOE policy was not found.',{policyId:id});
   stores.policies.set(id,row);
   return clone(row);
  }

  async function saveValidationResult(policyVersionId,{revision,policyChecksum,valid,errorCount=0,warningCount=0,actor={}}={}){
   const version=requireDraft(policyVersionId,revision);
   version.lastValidatedRevision=Number(revision);
   version.rulesChecksum=text(policyChecksum);
   version.lastValidationPassed=valid===true;
   version.lastValidationErrorCount=Number(errorCount||0);
   version.lastValidationWarningCount=Number(warningCount||0);
   version.lastValidatedAt=now();
   version.lastValidatedBy=text(actor.uid);
   stores.versions.set(version.policyVersionId,clone(version));
   appendAuditInternal({
    policyVersionId:version.policyVersionId,action:'validation_run',entityType:'policy_version',entityId:version.policyVersionId,
    beforeSnapshot:null,afterSnapshot:{revision:Number(revision),policyChecksum:text(policyChecksum),valid:valid===true,errorCount:Number(errorCount||0),warningCount:Number(warningCount||0)},
    ...actorFields(actor)
   });
   return clone(version);
  }

  async function saveImpactEvidence(policyVersionId,{revision,impactRunId,policyChecksum,inputDatasetChecksum,actor={}}={}){
   const version=requireDraft(policyVersionId,revision);
   version.lastImpactRunId=text(impactRunId);
   version.lastImpactRevision=Number(revision);
   version.lastImpactChecksum=text(policyChecksum);
   version.lastImpactDatasetChecksum=text(inputDatasetChecksum);
   version.lastImpactAt=now();
   version.lastImpactBy=text(actor.uid);
   stores.versions.set(version.policyVersionId,clone(version));
   return clone(version);
  }

  async function publishVersion({policyVersionId,expectedRevision,policyChecksum,impactRunId,inputDatasetChecksum,publication,actor={}}={}){
   const version=requireDraft(policyVersionId,expectedRevision);
   if(text(version.rulesChecksum)!==text(policyChecksum)||Number(version.lastValidatedRevision)!==Number(expectedRevision)||version.lastValidationPassed!==true){
    throw new RepositoryError('VALIDATION_REQUIRED','Current DOE Draft has not passed validation.',{policyVersionId:text(policyVersionId)});
   }
   const run=stores.impactRuns.get(text(impactRunId));
   if(!run||run.status!=='passed'||text(run.policyVersionId)!==text(policyVersionId)||Number(run.policyRevision)!==Number(expectedRevision)||text(run.policyChecksum)!==text(policyChecksum)||text(run.inputDatasetChecksum)!==text(inputDatasetChecksum)){
    throw new RepositoryError('PREVIEW_STALE','DOE Impact Preview evidence is missing or stale.',{policyVersionId:text(policyVersionId)});
   }
   const policy=stores.policies.get(text(version.policyId));
   if(!policy)throw new RepositoryError('POLICY_NOT_FOUND','DOE policy was not found.',{policyId:text(version.policyId)});
   const previousId=text(policy.currentActiveVersionId);
   if(previousId&&previousId!==version.policyVersionId){
    const previous=stores.versions.get(previousId);
    if(previous){
     previous.status='archived';previous.archivedAt=now();previous.archivedBy=text(actor.uid);
     stores.versions.set(previousId,clone(previous));
    }
   }
   version.status='active';version.publishedAt=now();version.publishedBy=text(actor.uid);
   stores.versions.set(version.policyVersionId,clone(version));
   policy.currentActiveVersionId=version.policyVersionId;policy.updatedAt=now();policy.updatedBy=text(actor.uid);
   stores.policies.set(policy.policyId,clone(policy));
   const pub=clone(publication||{});
   const publicationId=requireId('publications',pub);
   if(stores.publications.has(publicationId))throw new RepositoryError('EVIDENCE_ALREADY_EXISTS','DOE publication record already exists.',{publicationId});
   stores.publications.set(publicationId,pub);
   appendAuditInternal({
    policyVersionId:version.policyVersionId,action:'policy_published',entityType:'policy_version',entityId:version.policyVersionId,
    beforeSnapshot:{status:'draft'},afterSnapshot:{status:'active',publicationId},...actorFields(actor)
   });
   return{version:clone(version),policy:clone(policy),publication:clone(pub),previousActiveVersionId:previousId};
  }

  async function archiveVersion(policyVersionId,actor={}){
   const version=requireVersion(policyVersionId);
   if(version.status!=='active')throw new RepositoryError('POLICY_NOT_ACTIVE','Only an Active DOE policy can be archived.',{policyVersionId:text(policyVersionId)});
   const policy=stores.policies.get(text(version.policyId));
   version.status='archived';version.archivedAt=now();version.archivedBy=text(actor.uid);
   stores.versions.set(version.policyVersionId,clone(version));
   if(policy&&policy.currentActiveVersionId===version.policyVersionId){
    policy.currentActiveVersionId='';policy.updatedAt=now();policy.updatedBy=text(actor.uid);stores.policies.set(policy.policyId,clone(policy));
   }
   appendAuditInternal({policyVersionId:version.policyVersionId,action:'policy_archived',entityType:'policy_version',entityId:version.policyVersionId,beforeSnapshot:{status:'active'},afterSnapshot:{status:'archived'},...actorFields(actor)});
   return{version:clone(version),policy:policy?clone(policy):null};
  }

  return Object.freeze({
   listPolicies,getPolicy,listVersions,getVersion,listRules,getRule,
   listSelectors,listParameters,listTiers,listRuleInputs,listExceptions,
   createPolicy,createVersion,replaceVersion,replacePolicy,
   saveValidationResult,saveImpactEvidence,publishVersion,archiveVersion,
   saveDraftRule,deleteDraftRule,
   saveSelector,saveParameter,saveTier,saveRuleInput,
   deleteSelector,deleteParameter,deleteTier,deleteRuleInput,
   saveException,deleteException,
   createImpactRun,updateImpactRun,saveImpactRows,getImpactRun,listImpactRows,
   createPublication,listPublications,
   createCalculationRecord,listCalculationRecords,
   appendAudit,listAudit
  });
 }

 return{COLLECTIONS,RepositoryError,normalizeDomainObject,createMemoryRepository};
});
