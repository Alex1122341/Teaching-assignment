'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const REPO=require('../doe-policy-repository.js');

function seed(){
 return{
  policies:[{
   policyId:'ucvm-workload-2027-28',
   academicYear:'2027-28',
   name:'UCVM Workload Policy 2027-28',
   currentActiveVersionId:'ucvm-workload-2027-28-v1'
  }],
  versions:[
   {
    policyVersionId:'ucvm-workload-2027-28-v1',
    policyId:'ucvm-workload-2027-28',
    academicYear:'2027-28',
    versionNumber:1,status:'active',revision:3
   },
   {
    policyVersionId:'ucvm-workload-2027-28-v2',
    policyId:'ucvm-workload-2027-28',
    academicYear:'2027-28',
    versionNumber:2,status:'draft',revision:1,lastImpactRunId:'old-run'
   }
  ],
  rules:[{
   ruleId:'rule-lecture',
   policyVersionId:'ucvm-workload-2027-28-v2',
   ruleKey:'teaching.lecture.standard',
   category:'teaching',
   calculationMode:'per_hour',
   enabled:true
  }],
  exceptions:[]
 };
}

test('repository exports a stable relational-friendly collection map',()=>{
 assert.deepEqual(REPO.COLLECTIONS,{
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
});

test('memory repository returns plain domain objects keyed by stable business IDs',async()=>{
 const repo=REPO.createMemoryRepository(seed());
 assert.equal((await repo.listPolicies())[0].policyId,'ucvm-workload-2027-28');
 assert.equal((await repo.getPolicy('ucvm-workload-2027-28')).academicYear,'2027-28');
 assert.equal((await repo.listVersions('ucvm-workload-2027-28')).length,2);
 assert.equal((await repo.getVersion('ucvm-workload-2027-28-v2')).status,'draft');
 assert.equal((await repo.listRules('ucvm-workload-2027-28-v2'))[0].ruleId,'rule-lecture');
 assert.deepEqual(await repo.listExceptions('ucvm-workload-2027-28-v2'),[]);
});

test('draft rule mutation enforces optimistic revision and invalidates preview evidence',async()=>{
 const repo=REPO.createMemoryRepository(seed());
 const actor={uid:'regular',name:'ADFA Regular',email:'regular@example.test'};
 const saved=await repo.saveDraftRule({
  ruleId:'rule-lecture',
  policyVersionId:'ucvm-workload-2027-28-v2',
  ruleKey:'teaching.lecture.standard',
  category:'teaching',
  calculationMode:'per_hour',
  enabled:true
 },1,actor);
 assert.equal(saved.version.revision,2);
 assert.equal(saved.version.lastImpactRunId,'');
 const audits=await repo.listAudit('ucvm-workload-2027-28-v2');
 assert.equal(audits.at(-1).action,'rule_updated');
 assert.equal(audits.at(-1).changedBy,'regular');

 await assert.rejects(
  ()=>repo.saveDraftRule({...saved.rule,name:'stale'},1,actor),
  error=>error&&error.code==='POLICY_REVISION_CONFLICT'
 );
});

test('active and archived versions cannot be edited through draft mutation methods',async()=>{
 const repo=REPO.createMemoryRepository(seed());
 await assert.rejects(
  ()=>repo.saveDraftRule({
   ruleId:'bad',
   policyVersionId:'ucvm-workload-2027-28-v1',
   ruleKey:'bad',
   calculationMode:'fixed'
  },3,{uid:'regular'}),
  error=>error&&error.code==='POLICY_NOT_DRAFT'
 );
});

test('exception mutation requires stable IDs and shares the same revision contract',async()=>{
 const repo=REPO.createMemoryRepository(seed());
 const saved=await repo.saveException({
  exceptionId:'ex-f1',
  policyVersionId:'ucvm-workload-2027-28-v2',
  facultyId:'f1',
  scopeType:'session',
  scopeKey:'s1',
  fixedDoe:2.5,
  reason:'Existing prorated operational value',
  sourceReference:'MASTER'
 },1,{uid:'regular'});
 assert.equal(saved.version.revision,2);
 assert.equal((await repo.listExceptions('ucvm-workload-2027-28-v2'))[0].exceptionId,'ex-f1');
});

test('impact runs and rows remain separate records and normalize timestamps to ISO strings',async()=>{
 const repo=REPO.createMemoryRepository(seed());
 await repo.createImpactRun({
  impactRunId:'impact-1',
  policyVersionId:'ucvm-workload-2027-28-v2',
  policyRevision:1,
  policyChecksum:'abc',
  inputDatasetChecksum:'data',
  status:'running',
  startedAt:new Date('2026-09-18T18:00:00Z'),
  runBy:'regular'
 });
 await repo.saveImpactRows('impact-1',[
  {impactRowId:'row-1',facultyId:'f1',currentDoe:20,draftDoe:22,difference:2}
 ]);
 const run=await repo.getImpactRun('impact-1');
 assert.equal(run.startedAt,'2026-09-18T18:00:00.000Z');
 assert.equal((await repo.listImpactRows('impact-1'))[0].facultyId,'f1');
});

test('publication, calculation, and audit evidence are append-only in the repository contract',async()=>{
 const repo=REPO.createMemoryRepository(seed());
 await repo.createPublication({
  publicationId:'pub-1',
  policyVersionId:'ucvm-workload-2027-28-v2',
  publishedAt:new Date('2026-09-18T19:00:00Z'),
  publishedBy:'general'
 });
 await repo.createCalculationRecord({
  calculationId:'calc-1',
  policyVersionId:'ucvm-workload-2027-28-v2',
  facultyId:'f1',
  resultDoe:1.8,
  calculatedAt:new Date('2026-09-18T19:05:00Z')
 });
 await repo.appendAudit({
  auditId:'audit-1',
  policyVersionId:'ucvm-workload-2027-28-v2',
  action:'validation_run',
  changedAt:new Date('2026-09-18T19:10:00Z'),
  changedBy:'regular'
 });
 assert.equal((await repo.listPublications('ucvm-workload-2027-28-v2')).length,1);
 assert.equal((await repo.listCalculationRecords({facultyId:'f1'}))[0].calculationId,'calc-1');
 assert.equal((await repo.listAudit('ucvm-workload-2027-28-v2')).at(-1).auditId,'audit-1');
 await assert.rejects(
  ()=>repo.createPublication({publicationId:'pub-1',policyVersionId:'ucvm-workload-2027-28-v2'}),
  error=>error&&error.code==='EVIDENCE_ALREADY_EXISTS'
 );
});

test('normalization strips Firestore-specific timestamp objects from domain results',()=>{
 const fakeTimestamp={toDate:()=>new Date('2026-09-18T20:00:00Z')};
 const normalized=REPO.normalizeDomainObject({
  createdAt:fakeTimestamp,
  nested:{updatedAt:fakeTimestamp},
  list:[{changedAt:fakeTimestamp}]
 });
 assert.deepEqual(normalized,{
  createdAt:'2026-09-18T20:00:00.000Z',
  nested:{updatedAt:'2026-09-18T20:00:00.000Z'},
  list:[{changedAt:'2026-09-18T20:00:00.000Z'}]
 });
});
