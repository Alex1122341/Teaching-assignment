'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ENGINE=require('../doe-policy-engine.js');
const REPO=require('../doe-policy-repository.js');
const SERVICE=require('../doe-policy-service.js');

function seed(){
 return{
  policies:[{
   policyId:'ucvm-workload-2027-28',academicYear:'2027-28',
   name:'UCVM Workload Policy 2027-28',currentActiveVersionId:'ucvm-workload-2027-28-v1'
  }],
  versions:[
   {
    policyVersionId:'ucvm-workload-2027-28-v1',policyId:'ucvm-workload-2027-28',
    academicYear:'2027-28',versionNumber:1,status:'active',revision:1
   },
   {
    policyVersionId:'ucvm-workload-2027-28-v2',policyId:'ucvm-workload-2027-28',
    academicYear:'2027-28',versionNumber:2,status:'draft',revision:1,
    lastImpactRunId:'',lastValidatedRevision:null,rulesChecksum:''
   }
  ],
  rules:[{
   ruleId:'r-v2-lecture',policyVersionId:'ucvm-workload-2027-28-v2',
   ruleKey:'teaching.lecture.standard',category:'teaching',name:'Standard Lecture',
   calculationMode:'per_hour',resultKind:'credit',priority:100,enabled:true
  }],
  selectors:[{
   selectorId:'sel-v2-lecture',ruleId:'r-v2-lecture',policyVersionId:'ucvm-workload-2027-28-v2',
   field:'activityType',operator:'equals',valueText:'LEC',order:1
  }],
  parameters:[{
   parameterId:'param-v2-rate',ruleId:'r-v2-lecture',policyVersionId:'ucvm-workload-2027-28-v2',
   name:'rate',valueNumber:.30,unit:'percent_per_hour',required:true,order:1
  }],
  inputs:[{
   ruleInputId:'input-v2-hours',ruleId:'r-v2-lecture',policyVersionId:'ucvm-workload-2027-28-v2',
   inputName:'hours',inputType:'number',required:true,source:'session',unit:'hours'
  }],
  exceptions:[]
 };
}

const actor=role=>({
 uid:role==='adfa_general'?'general':'regular',
 name:role==='adfa_general'?'General Admin':'Regular Admin',
 email:`${role}@example.test`,
 role
});

function create(role='adfa_regular',repo=REPO.createMemoryRepository(seed()),options={}){
 return{
  repo,
  service:SERVICE.createService({
   repository:repo,
   engine:ENGINE,
   actorProvider:()=>actor(role),
   clock:()=>new Date('2026-09-18T20:00:00Z'),
   datasetChecksumProvider:async()=>options.datasetChecksum||'dataset-1'
  })
 };
}

test('ADFA Regular can validate a Draft and validation records exact revision and checksum',async()=>{
 const {repo,service}=create();
 const result=await service.validateDraft('ucvm-workload-2027-28-v2');
 assert.equal(result.valid,true);
 assert.equal(result.policyRevision,1);
 assert.match(result.policyChecksum,/^[a-f0-9]{64}$/);
 const version=await repo.getVersion('ucvm-workload-2027-28-v2');
 assert.equal(version.lastValidatedRevision,1);
 assert.equal(version.rulesChecksum,result.policyChecksum);
});

test('ADFA Regular cannot publish even after validation',async()=>{
 const {service}=create();
 await service.validateDraft('ucvm-workload-2027-28-v2');
 await assert.rejects(
  ()=>service.publish('ucvm-workload-2027-28-v2'),
  error=>error&&error.code==='PERMISSION_DENIED'
 );
});

test('General publish requires a successful current Impact Preview',async()=>{
 const {service}=create('adfa_general');
 await service.validateDraft('ucvm-workload-2027-28-v2');
 await assert.rejects(
  ()=>service.publish('ucvm-workload-2027-28-v2'),
  error=>error&&error.code==='PREVIEW_REQUIRED'
 );
});

test('publish rejects preview evidence from an older Draft revision',async()=>{
 const {repo,service}=create('adfa_general');
 const validation=await service.validateDraft('ucvm-workload-2027-28-v2');
 await repo.createImpactRun({
  impactRunId:'impact-old',policyVersionId:'ucvm-workload-2027-28-v2',
  policyRevision:1,policyChecksum:validation.policyChecksum,inputDatasetChecksum:'dataset-1',
  status:'passed',runBy:'general'
 });
 const version=await repo.getVersion('ucvm-workload-2027-28-v2');
 await repo.replaceVersion({
  ...version,revision:2,lastValidatedRevision:2,
  lastImpactRunId:'impact-old',lastImpactRevision:1,
  lastImpactChecksum:validation.policyChecksum,lastImpactDatasetChecksum:'dataset-1'
 });
 await assert.rejects(
  ()=>service.publish('ucvm-workload-2027-28-v2'),
  error=>error&&error.code==='PREVIEW_STALE'
 );
});

test('publish rejects when the source dataset changed after preview',async()=>{
 const repo=REPO.createMemoryRepository(seed());
 const first=SERVICE.createService({
  repository:repo,engine:ENGINE,actorProvider:()=>actor('adfa_general'),
  clock:()=>new Date('2026-09-18T20:00:00Z'),
  datasetChecksumProvider:async()=>'dataset-1'
 });
 const validation=await first.validateDraft('ucvm-workload-2027-28-v2');
 await repo.createImpactRun({
  impactRunId:'impact-1',policyVersionId:'ucvm-workload-2027-28-v2',
  policyRevision:1,policyChecksum:validation.policyChecksum,inputDatasetChecksum:'dataset-1',
  status:'passed',runBy:'general'
 });
 const version=await repo.getVersion('ucvm-workload-2027-28-v2');
 await repo.replaceVersion({
  ...version,lastImpactRunId:'impact-1',lastImpactRevision:1,
  lastImpactChecksum:validation.policyChecksum,lastImpactDatasetChecksum:'dataset-1'
 });
 const changed=SERVICE.createService({
  repository:repo,engine:ENGINE,actorProvider:()=>actor('adfa_general'),
  clock:()=>new Date('2026-09-18T20:00:00Z'),
  datasetChecksumProvider:async()=>'dataset-2'
 });
 await assert.rejects(
  ()=>changed.publish('ucvm-workload-2027-28-v2'),
  error=>error&&error.code==='PREVIEW_STALE'
 );
});

test('successful publish archives the old Active version and records immutable publication evidence',async()=>{
 const {repo,service}=create('adfa_general');
 const validation=await service.validateDraft('ucvm-workload-2027-28-v2');
 await repo.createImpactRun({
  impactRunId:'impact-good',policyVersionId:'ucvm-workload-2027-28-v2',
  policyRevision:1,policyChecksum:validation.policyChecksum,inputDatasetChecksum:'dataset-1',
  status:'passed',runBy:'general',
  facultyCount:100,calculationCount:500,changedFacultyCount:12,errorCount:0,warningCount:2
 });
 const version=await repo.getVersion('ucvm-workload-2027-28-v2');
 await repo.replaceVersion({
  ...version,lastImpactRunId:'impact-good',lastImpactRevision:1,
  lastImpactChecksum:validation.policyChecksum,lastImpactDatasetChecksum:'dataset-1'
 });

 const result=await service.publish('ucvm-workload-2027-28-v2');
 assert.equal(result.version.status,'active');
 assert.equal((await repo.getVersion('ucvm-workload-2027-28-v1')).status,'archived');
 assert.equal((await repo.getPolicy('ucvm-workload-2027-28')).currentActiveVersionId,'ucvm-workload-2027-28-v2');
 const publications=await repo.listPublications('ucvm-workload-2027-28-v2');
 assert.equal(publications.length,1);
 assert.equal(publications[0].policyRevision,1);
 assert.equal(publications[0].policyChecksum,validation.policyChecksum);
 assert.equal(publications[0].impactRunId,'impact-good');
 assert.equal(publications[0].publishedBy,'general');
});

test('published versions remain immutable through Draft editing APIs',async()=>{
 const {repo,service}=create('adfa_general');
 const validation=await service.validateDraft('ucvm-workload-2027-28-v2');
 await repo.createImpactRun({
  impactRunId:'impact-good',policyVersionId:'ucvm-workload-2027-28-v2',
  policyRevision:1,policyChecksum:validation.policyChecksum,inputDatasetChecksum:'dataset-1',
  status:'passed',runBy:'general'
 });
 const version=await repo.getVersion('ucvm-workload-2027-28-v2');
 await repo.replaceVersion({...version,lastImpactRunId:'impact-good',lastImpactRevision:1,lastImpactChecksum:validation.policyChecksum,lastImpactDatasetChecksum:'dataset-1'});
 await service.publish('ucvm-workload-2027-28-v2');
 await assert.rejects(
  ()=>repo.saveDraftRule({
   ruleId:'new',policyVersionId:'ucvm-workload-2027-28-v2',ruleKey:'new',
   category:'teaching',calculationMode:'fixed',resultKind:'credit',priority:1,enabled:true
  },1,actor('adfa_general')),
  error=>error&&error.code==='POLICY_NOT_DRAFT'
 );
});

test('canonical policy checksum is stable across rule and child ordering',async()=>{
 const {service}=create();
 const bundle=await service.loadPolicyBundle('ucvm-workload-2027-28-v2');
 const a=await service.policyChecksum(bundle);
 const shuffled={
  ...bundle,
  rules:[...bundle.rules].reverse().map(rule=>({
   ...rule,
   selectors:[...(rule.selectors||[])].reverse(),
   parameters:[...(rule.parameters||[])].reverse(),
   inputs:[...(rule.inputs||[])].reverse(),
   tiers:[...(rule.tiers||[])].reverse()
  })),
  exceptions:[...(bundle.exceptions||[])].reverse()
 };
 const b=await service.policyChecksum(shuffled);
 assert.equal(a,b);
});
