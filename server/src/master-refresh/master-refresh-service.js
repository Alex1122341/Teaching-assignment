'use strict';
const {academicBounds,manifestHash}=require('./master-source-domain');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/i.test(v),version=v=>typeof v==='string'&&/^[0-9a-f]{16}$/i.test(v);
const invalid=()=>Object.assign(new Error('The MASTER refresh request is invalid.'),{code:'INVALID_MASTER_REFRESH_REQUEST'});
const actor=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!/[\x00-\x1f]/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const only=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const domain=v=>v==='appointments'||v==='trainees';
function createMasterRefreshService({repository}={}){
 if(!repository)throw new TypeError('A MASTER refresh repository is required.');
 return Object.freeze({
  async preview(p){
   validateMasterPreview(p);
   if(typeof repository.loadDoeContext!=='function')throw Object.assign(Error('Current DOE evidence is required.'),{code:'MASTER_ENGINE_REQUIRED'});
   const context=await repository.loadDoeContext({academicYear:p.academicYear,candidatePolicyVersionId:p.candidatePolicyVersionId});
   if(!sha(context?.contextHash))throw invalid();
   const {compareMasterDoe}=require('./master-doe-reconciliation');
   const comparison=await compareMasterDoe({source:p.source,...context,domain:p.domain});
   const doeGuard={schemaVersion:1,sourceManifestSha256:p.source.manifestSha256,contextHash:context.contextHash,doeGuardHash:comparison.doeGuardHash,rows:comparison.rows,facultyImpacts:comparison.facultyImpacts};
   return repository.preview({...p,doeGuard});
  },
  async apply(p){
   if(!only(p,['batchId','domain','expectedVersion','manifestSha256','sourceSha256','idempotencyKey','actorFirebaseUid','confirm'])||!domain(p.domain)||!UUID.test(p.batchId||'')||!version(p.expectedVersion)||!sha(p.manifestSha256)||!sha(p.sourceSha256)||!UUID.test(p.idempotencyKey||'')||!actor(p.actorFirebaseUid)||p.confirm!==true)throw invalid();
   const r=await repository.apply(p);
   return Object.fromEntries(['receiptId','appliedCount','heldCount','idempotentReplay'].map(k=>[k,r[k]]));
  },
  async recover(p){
   if(!only(p,['receiptId','actorFirebaseUid','confirm'])||!UUID.test(p.receiptId||'')||!actor(p.actorFirebaseUid)||p.confirm!==true)throw invalid();
   return repository.recover(p);
  }
 });
}
function validateMasterPreview(p){
   if(!only(p,['domain','academicYear','source','actorFirebaseUid','candidatePolicyVersionId'])||!domain(p.domain)||!actor(p.actorFirebaseUid)||!object(p.source))throw invalid();
   academicBounds(p.academicYear);
   const s=p.source;
   if(s.schemaVersion!==1||s.academicYear!==p.academicYear||!sha(s.sourceSha256)||!sha(s.manifestSha256)||['appointments','rotations','cccAllocations','roleDefinitions','trainees','cccSlots','issues'].some(k=>!Array.isArray(s[k])))throw invalid();
   const {manifestSha256,...body}=s;
   if(manifestHash(body)!==manifestSha256.toUpperCase())throw Object.assign(new Error('The MASTER source manifest changed.'),{code:'SOURCE_MANIFEST_MISMATCH'});
   if(Buffer.byteLength(JSON.stringify(s),'utf8')>8*1024*1024)throw invalid();
   if(p.candidatePolicyVersionId!==undefined&&!UUID.test(p.candidatePolicyVersionId))throw invalid();
}
module.exports={createMasterRefreshService,validateMasterPreview};
