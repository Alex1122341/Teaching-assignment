(function(root,factory){
 const base=typeof module==='object'&&module.exports?require('./doe-policy-repository.js'):(root&&root.UCVM_DOE_POLICY_REPOSITORY);
 const api=factory(base);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_POLICY_FIRESTORE=api;
})(typeof window!=='undefined'?window:null,function(BASE){
 'use strict';
 if(!BASE)throw new Error('UCVM DOE policy repository contract is required.');

 const {COLLECTIONS,RepositoryError,normalizeDomainObject}=BASE;
 const text=value=>String(value??'').trim();
 const nowIso=()=>new Date().toISOString();

 function createFirestoreRepository({db}={}){
  if(!db||typeof db.collection!=='function')throw new Error('Firestore db is required.');

  const collection=name=>db.collection(COLLECTIONS[name]);
  const ref=(name,id)=>collection(name).doc(text(id));
  const mapDocs=snapshot=>snapshot.docs.map(doc=>normalizeDomainObject(doc.data()));
  const one=async(name,id)=>{
   const snapshot=await ref(name,id).get();
   return snapshot.exists?normalizeDomainObject(snapshot.data()):null;
  };
  const query=async(name,field,value)=>mapDocs(await collection(name).where(field,'==',value).get());
  const generatedId=name=>collection(name).doc().id;

  function requireId(row,field){
   const id=text(row?.[field]);
   if(!id)throw new RepositoryError('BUSINESS_ID_REQUIRED',`${field} is required.`,{field});
   return id;
  }

  function revisionConflict(versionId,expected,actual){
   return new RepositoryError('POLICY_REVISION_CONFLICT','DOE policy Draft changed since it was loaded.',{
    policyVersionId:text(versionId),expectedRevision:Number(expected),actualRevision:Number(actual)
   });
  }

  function actorFields(actor={}){
   return{
    changedBy:text(actor.uid),
    changedByName:text(actor.name),
    changedByEmail:text(actor.email)
   };
  }

  function invalidationPatch(version,actor){
   return{
    revision:Number(version.revision||0)+1,
    lastImpactRunId:'',
    lastImpactRevision:null,
    lastImpactChecksum:'',
    lastImpactDatasetChecksum:'',
    lastValidatedRevision:null,
    updatedAt:nowIso(),
    updatedBy:text(actor?.uid)
   };
  }

  function auditRow({versionId,action,entityType,entityId,before,after,actor}){
   return{
    auditId:generatedId('audit'),
    policyVersionId:text(versionId),
    action:text(action),
    entityType:text(entityType),
    entityId:text(entityId),
    beforeSnapshot:normalizeDomainObject(before??null),
    afterSnapshot:normalizeDomainObject(after??null),
    ...actorFields(actor),
    changedAt:nowIso()
   };
  }

  async function listPolicies(){return mapDocs(await collection('policies').get())}
  async function getPolicy(id){return one('policies',id)}
  async function listVersions(policyId){
   const rows=await query('versions','policyId',text(policyId));
   return rows.sort((a,b)=>Number(a.versionNumber||0)-Number(b.versionNumber||0));
  }
  async function getVersion(id){return one('versions',id)}
  async function listRules(versionId){return query('rules','policyVersionId',text(versionId))}
  async function getRule(id){return one('rules',id)}
  async function listSelectors(ruleId){return query('selectors','ruleId',text(ruleId))}
  async function listParameters(ruleId){return query('parameters','ruleId',text(ruleId))}
  async function listTiers(ruleId){
   const rows=await query('tiers','ruleId',text(ruleId));
   return rows.sort((a,b)=>Number(a.tierOrder||0)-Number(b.tierOrder||0));
  }
  async function listRuleInputs(ruleId){return query('inputs','ruleId',text(ruleId))}
  async function listExceptions(versionId){return query('exceptions','policyVersionId',text(versionId))}
  async function getImpactRun(id){return one('impactRuns',id)}
  async function listImpactRows(runId){return query('impactRows','impactRunId',text(runId))}
  async function listPublications(versionId){return query('publications','policyVersionId',text(versionId))}
  async function listAudit(versionId){return versionId?query('audit','policyVersionId',text(versionId)):mapDocs(await collection('audit').get())}
  async function listCalculationRecords(filter={}){
   let q=collection('calculations');
   for(const [field,value] of Object.entries(filter||{}))q=q.where(field,'==',value);
   return mapDocs(await q.get());
  }

  async function createPolicy(policy){
   const row=normalizeDomainObject(policy),id=requireId(row,'policyId');
   await ref('policies',id).set(row);
   return row;
  }
  async function createVersion(version){
   const row=normalizeDomainObject(version),id=requireId(row,'policyVersionId');
   if(!row.status)row.status='draft';
   if(row.revision===undefined||row.revision===null)row.revision=0;
   await ref('versions',id).set(row);
   return row;
  }

  async function saveDraftRule(rule,expectedRevision,actor={}){
   const row=normalizeDomainObject(rule),ruleId=requireId(row,'ruleId'),versionId=requireId(row,'policyVersionId');
   const versionRef=ref('versions',versionId),ruleRef=ref('rules',ruleId);
   return db.runTransaction(async transaction=>{
    const versionSnapshot=await transaction.get(versionRef);
    if(!versionSnapshot.exists)throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:versionId});
    const version=normalizeDomainObject(versionSnapshot.data());
    if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Only Draft DOE policy versions can be edited.',{policyVersionId:versionId});
    if(Number(version.revision||0)!==Number(expectedRevision))throw revisionConflict(versionId,expectedRevision,version.revision||0);
    const ruleSnapshot=await transaction.get(ruleRef),before=ruleSnapshot.exists?normalizeDomainObject(ruleSnapshot.data()):null;
    if(before&&text(before.policyVersionId)!==versionId)throw new RepositoryError('BUSINESS_ID_CONFLICT','ruleId belongs to another policy version.',{ruleId});
    const patch=invalidationPatch(version,actor),updatedVersion={...version,...patch};
    const audit=auditRow({
     versionId,action:before?'rule_updated':'rule_created',entityType:'rule',entityId:ruleId,before,after:row,actor
    });
    transaction.set(ruleRef,row);
    transaction.update(versionRef,patch);
    transaction.set(ref('audit',audit.auditId),audit);
    return{rule:row,version:updatedVersion};
   });
  }

  async function deleteDraftRule(ruleId,expectedRevision,actor={}){
   const ruleRef=ref('rules',ruleId);
   return db.runTransaction(async transaction=>{
    const ruleSnapshot=await transaction.get(ruleRef);
    if(!ruleSnapshot.exists)throw new RepositoryError('RULE_NOT_FOUND','DOE rule was not found.',{ruleId:text(ruleId)});
    const before=normalizeDomainObject(ruleSnapshot.data()),versionId=text(before.policyVersionId),versionRef=ref('versions',versionId);
    const versionSnapshot=await transaction.get(versionRef);
    const version=versionSnapshot.exists?normalizeDomainObject(versionSnapshot.data()):null;
    if(!version)throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:versionId});
    if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Only Draft DOE policy versions can be edited.',{policyVersionId:versionId});
    if(Number(version.revision||0)!==Number(expectedRevision))throw revisionConflict(versionId,expectedRevision,version.revision||0);
    const patch=invalidationPatch(version,actor),audit=auditRow({
     versionId,action:'rule_deleted',entityType:'rule',entityId:text(ruleId),before,after:null,actor
    });
    transaction.delete(ruleRef);
    transaction.update(versionRef,patch);
    transaction.set(ref('audit',audit.auditId),audit);
    return{ruleId:text(ruleId),version:{...version,...patch}};
   });
  }

  async function saveDraftChild(storeName,row,idField,expectedRevision,actor={},entityType){
   const normalized=normalizeDomainObject(row),id=requireId(normalized,idField),ruleId=requireId(normalized,'ruleId');
   const ruleRef=ref('rules',ruleId),childRef=ref(storeName,id);
   return db.runTransaction(async transaction=>{
    const ruleSnapshot=await transaction.get(ruleRef);
    if(!ruleSnapshot.exists)throw new RepositoryError('RULE_NOT_FOUND','Parent DOE rule was not found.',{ruleId});
    const rule=normalizeDomainObject(ruleSnapshot.data()),versionId=text(rule.policyVersionId),versionRef=ref('versions',versionId);
    const versionSnapshot=await transaction.get(versionRef);
    const version=versionSnapshot.exists?normalizeDomainObject(versionSnapshot.data()):null;
    if(!version)throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:versionId});
    if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Only Draft DOE policy versions can be edited.',{policyVersionId:versionId});
    if(Number(version.revision||0)!==Number(expectedRevision))throw revisionConflict(versionId,expectedRevision,version.revision||0);
    const childSnapshot=await transaction.get(childRef),before=childSnapshot.exists?normalizeDomainObject(childSnapshot.data()):null;
    normalized.policyVersionId=versionId;
    if(before&&text(before.ruleId)!==ruleId)throw new RepositoryError('BUSINESS_ID_CONFLICT','DOE child ID belongs to another rule.',{id});
    const patch=invalidationPatch(version,actor),audit=auditRow({
     versionId,action:before?`${entityType}_updated`:`${entityType}_created`,entityType,entityId:id,before,after:normalized,actor
    });
    transaction.set(childRef,normalized);
    transaction.update(versionRef,patch);
    transaction.set(ref('audit',audit.auditId),audit);
    return{row:normalized,version:{...version,...patch}};
   });
  }

  async function saveSelector(row,revision,actor){return saveDraftChild('selectors',row,'selectorId',revision,actor,'selector')}
  async function saveParameter(row,revision,actor){return saveDraftChild('parameters',row,'parameterId',revision,actor,'parameter')}
  async function saveTier(row,revision,actor){return saveDraftChild('tiers',row,'tierId',revision,actor,'tier')}
  async function saveRuleInput(row,revision,actor){return saveDraftChild('inputs',row,'ruleInputId',revision,actor,'rule_input')}

  async function saveException(exception,expectedRevision,actor={}){
   const row=normalizeDomainObject(exception),exceptionId=requireId(row,'exceptionId'),versionId=requireId(row,'policyVersionId');
   const versionRef=ref('versions',versionId),exceptionRef=ref('exceptions',exceptionId);
   return db.runTransaction(async transaction=>{
    const versionSnapshot=await transaction.get(versionRef);
    if(!versionSnapshot.exists)throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:versionId});
    const version=normalizeDomainObject(versionSnapshot.data());
    if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Only Draft DOE policy versions can be edited.',{policyVersionId:versionId});
    if(Number(version.revision||0)!==Number(expectedRevision))throw revisionConflict(versionId,expectedRevision,version.revision||0);
    const snapshot=await transaction.get(exceptionRef),before=snapshot.exists?normalizeDomainObject(snapshot.data()):null;
    const patch=invalidationPatch(version,actor),audit=auditRow({
     versionId,action:before?'exception_updated':'exception_created',entityType:'exception',entityId:exceptionId,before,after:row,actor
    });
    transaction.set(exceptionRef,row);
    transaction.update(versionRef,patch);
    transaction.set(ref('audit',audit.auditId),audit);
    return{exception:row,version:{...version,...patch}};
   });
  }

  async function createImpactRun(run){
   const row=normalizeDomainObject(run),id=requireId(row,'impactRunId');
   await ref('impactRuns',id).set(row);
   return row;
  }
  async function updateImpactRun(id,patch){
   await ref('impactRuns',id).update(normalizeDomainObject(patch));
   return getImpactRun(id);
  }
  async function saveImpactRows(impactRunId,rows){
   const batch=db.batch(),saved=[];
   for(const raw of Array.isArray(rows)?rows:[]){
    const row=normalizeDomainObject({...raw,impactRunId:text(impactRunId)}),id=requireId(row,'impactRowId');
    batch.set(ref('impactRows',id),row);saved.push(row);
   }
   await batch.commit();
   return saved;
  }
  async function createPublication(row){
   const normalized=normalizeDomainObject(row),id=requireId(normalized,'publicationId');
   await ref('publications',id).set(normalized);
   return normalized;
  }
  async function createCalculationRecord(row){
   const normalized=normalizeDomainObject(row),id=requireId(normalized,'calculationId');
   await ref('calculations',id).set(normalized);
   return normalized;
  }
  async function appendAudit(row){
   const normalized=normalizeDomainObject(row);
   if(!text(normalized.auditId))normalized.auditId=generatedId('audit');
   await ref('audit',normalized.auditId).set(normalized);
   return normalized;
  }

  return Object.freeze({
   listPolicies,getPolicy,listVersions,getVersion,listRules,getRule,
   listSelectors,listParameters,listTiers,listRuleInputs,listExceptions,
   createPolicy,createVersion,saveDraftRule,deleteDraftRule,
   saveSelector,saveParameter,saveTier,saveRuleInput,saveException,
   createImpactRun,updateImpactRun,saveImpactRows,getImpactRun,listImpactRows,
   createPublication,listPublications,createCalculationRecord,listCalculationRecords,
   appendAudit,listAudit
  });
 }

 return{createFirestoreRepository};
});
