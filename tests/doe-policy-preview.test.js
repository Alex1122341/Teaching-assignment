'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ENGINE=require('../doe-policy-engine.js');
const REPO=require('../doe-policy-repository.js');
const SERVICE=require('../doe-policy-service.js');

const actor={uid:'regular',name:'Regular Admin',email:'regular@example.test',role:'adfa_regular'};

function seed({rate=.30,invalid=false}={}){
 return{
  policies:[{
   policyId:'ucvm-workload-2027-28',
   academicYear:'2027-28',
   name:'UCVM Workload Policy 2027-28',
   currentActiveVersionId:'ucvm-workload-2027-28-v1'
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
  parameters:invalid?[]:[{
   parameterId:'param-v2-rate',ruleId:'r-v2-lecture',policyVersionId:'ucvm-workload-2027-28-v2',
   name:'rate',valueNumber:rate,unit:'percent_per_hour',required:true,order:1
  }],
  inputs:[{
   ruleInputId:'input-v2-hours',ruleId:'r-v2-lecture',policyVersionId:'ucvm-workload-2027-28-v2',
   inputName:'hours',inputType:'number',required:true,source:'session',unit:'hours'
  }],
  exceptions:[]
 };
}

function dataset({hours1=2,hours2=3,current1=.5,current2=.75,extra={}}={}){
 return{
  academicYear:'2027-28',
  calculations:[
   {
    sourceEntityType:'session_assignment',
    sourceEntityId:'assignment-1',
    sessionId:'session-1',
    assignmentId:'assignment-1',
    facultyId:'f1',
    currentDoe:current1,
    context:{activityType:'LEC',hours:hours1,room:'CSB 101',notes:'irrelevant',...extra}
   },
   {
    sourceEntityType:'session_assignment',
    sourceEntityId:'assignment-2',
    sessionId:'session-2',
    assignmentId:'assignment-2',
    facultyId:'f2',
    currentDoe:current2,
    context:{activityType:'LEC',hours:hours2,room:'CSB 102'}
   }
  ]
 };
}

function make(options={}){
 const repo=REPO.createMemoryRepository(seed(options));
 const service=SERVICE.createService({
  repository:repo,
  engine:ENGINE,
  actorProvider:()=>actor,
  clock:()=>new Date('2026-09-18T22:00:00Z')
 });
 return{repo,service};
}

test('Impact Preview compares current DOE to Draft DOE without mutating the source dataset',async()=>{
 const {repo,service}=make();
 const source=dataset(),before=JSON.parse(JSON.stringify(source));
 await service.validateDraft('ucvm-workload-2027-28-v2');
 const result=await service.runImpactPreview('ucvm-workload-2027-28-v2',source);

 assert.equal(result.status,'passed');
 assert.equal(result.activeVersionIdAtPreview,'ucvm-workload-2027-28-v1');
 assert.equal(result.facultyCount,2);
 assert.equal(result.calculationCount,2);
 assert.equal(result.changedFacultyCount,2);
 assert.equal(result.errorCount,0);
 assert.equal(result.rows.length,2);
 const f1=result.rows.find(row=>row.facultyId==='f1');
 assert.equal(f1.currentDoe,.5);
 assert.ok(Math.abs(f1.draftDoe-.6)<1e-12);
 assert.ok(Math.abs(f1.difference-.1)<1e-12);
 assert.deepEqual(f1.affectedRules,['teaching.lecture.standard']);
 assert.deepEqual(source,before);

 const version=await repo.getVersion('ucvm-workload-2027-28-v2');
 assert.equal(version.lastImpactRunId,result.impactRunId);
 assert.equal(version.lastImpactRevision,1);
 assert.equal(version.lastImpactChecksum,result.policyChecksum);
 assert.equal(version.lastImpactDatasetChecksum,result.inputDatasetChecksum);
 assert.equal((await repo.listImpactRows(result.impactRunId)).length,2);
});

test('Impact Preview requires a successful validation for the exact Draft revision',async()=>{
 const {repo,service}=make({invalid:true});
 const validation=await service.validateDraft('ucvm-workload-2027-28-v2');
 assert.equal(validation.valid,false);
 assert.ok(validation.errors.some(error=>error.code==='PARAMETER_MISSING'));

 await assert.rejects(
  ()=>service.runImpactPreview('ucvm-workload-2027-28-v2',dataset()),
  error=>error&&error.code==='VALIDATION_REQUIRED'
 );
 const version=await repo.getVersion('ucvm-workload-2027-28-v2');
 assert.equal(version.lastImpactRunId,'');
});

test('calculation errors are blocking and are surfaced on the affected faculty row',async()=>{
 const {repo,service}=make();
 const source=dataset();
 await service.validateDraft('ucvm-workload-2027-28-v2');
 source.calculations[0].context={activityType:'LEC'};
 const result=await service.runImpactPreview('ucvm-workload-2027-28-v2',source);

 assert.equal(result.status,'failed');
 assert.ok(result.errorCount>0);
 const f1=result.rows.find(row=>row.facultyId==='f1');
 assert.ok(f1.errors.some(error=>error.code==='INPUT_MISSING'));
 assert.equal((await repo.getVersion('ucvm-workload-2027-28-v2')).lastImpactRunId,'');
});

test('large DOE variance is review-warning only and does not block an otherwise valid preview',async()=>{
 const {service}=make({rate:4});
 await service.validateDraft('ucvm-workload-2027-28-v2');
 const result=await service.runImpactPreview('ucvm-workload-2027-28-v2',dataset({current1:.5,current2:.75}));

 assert.equal(result.status,'passed');
 assert.equal(result.errorCount,0);
 assert.ok(result.warningCount>=1);
 assert.ok(result.largeIncreaseCount>=1);
 assert.equal(result.largeDecreaseCount,0);
 assert.ok(result.rows.some(row=>row.warnings.some(warning=>warning.code==='LARGE_INCREASE')));
});

test('dataset checksum includes DOE-relevant inputs and ignores unrelated UI/detail fields',async()=>{
 const {service}=make();
 const bundle=await service.loadPolicyBundle('ucvm-workload-2027-28-v2');
 const base=dataset();
 const same=dataset({extra:{uiExpanded:true,temporaryColor:'red'}});
 const changed=dataset({hours1:4});

 const a=await service.previewDatasetChecksum(bundle,base);
 const b=await service.previewDatasetChecksum(bundle,same);
 const c=await service.previewDatasetChecksum(bundle,changed);
 assert.equal(a,b);
 assert.notEqual(a,c);
 assert.match(a,/^[a-f0-9]{64}$/);
});

test('Draft mutation after preview invalidates the stored preview evidence',async()=>{
 const {repo,service}=make();
 await service.validateDraft('ucvm-workload-2027-28-v2');
 const preview=await service.runImpactPreview('ucvm-workload-2027-28-v2',dataset());
 assert.equal(preview.status,'passed');

 const rule=(await repo.listRules('ucvm-workload-2027-28-v2'))[0];
 const saved=await repo.saveDraftRule({...rule,name:'Changed after preview'},1,actor);
 assert.equal(saved.version.revision,2);
 assert.equal(saved.version.lastImpactRunId,'');
 assert.equal(saved.version.lastImpactChecksum,'');
});

test('relevant source data changes produce a new dataset checksum and therefore stale preview evidence',async()=>{
 const {service}=make();
 await service.validateDraft('ucvm-workload-2027-28-v2');
 const first=await service.runImpactPreview('ucvm-workload-2027-28-v2',dataset());
 const bundle=await service.loadPolicyBundle('ucvm-workload-2027-28-v2');
 const changedChecksum=await service.previewDatasetChecksum(bundle,dataset({hours1:5}));
 assert.notEqual(first.inputDatasetChecksum,changedChecksum);
});

test('preview IDs and row ordering are deterministic for a stable run input ordering-independent dataset',async()=>{
 const {service}=make();
 await service.validateDraft('ucvm-workload-2027-28-v2');
 const source=dataset();
 source.calculations.reverse();
 const result=await service.runImpactPreview('ucvm-workload-2027-28-v2',source);
 assert.deepEqual(result.rows.map(row=>row.facultyId),['f1','f2']);
 assert.ok(result.rows.every(row=>row.impactRowId.startsWith(result.impactRunId+'--faculty--')));
});


test('Impact Preview keeps missing current DOE unavailable instead of coercing it to zero',async()=>{
 const {service}=make();
 await service.validateDraft('ucvm-workload-2027-28-v2');
 const result=await service.runImpactPreview('ucvm-workload-2027-28-v2',dataset({current1:null,current2:.9}));
 const f1=result.rows.find(row=>row.facultyId==='f1');
 assert.equal(f1.currentDoe,null);
 assert.equal(f1.difference,null);
 assert.equal(f1.impactStatus,'resolved_current_gap');
 assert.equal(f1.currentUnavailableCount,1);
 assert.equal(result.resolvedCurrentGapCount,1);
});

test('Impact Preview summarizes increases decreases unchanged rows and largest changes for admin review',async()=>{
 const {service}=make();
 await service.validateDraft('ucvm-workload-2027-28-v2');
 const result=await service.runImpactPreview('ucvm-workload-2027-28-v2',dataset({current1:.5,current2:1.2}));
 assert.equal(result.increaseCount,1);
 assert.equal(result.decreaseCount,1);
 assert.equal(result.unchangedCount,0);
 assert.equal(result.newNeedsReviewCount,0);
 assert.ok(Math.abs(result.largestIncreaseDoe-.1)<1e-12);
 assert.ok(Math.abs(result.largestDecreaseDoe+.3)<1e-12);
 assert.equal(result.rows.find(row=>row.facultyId==='f1').impactStatus,'increase');
 assert.equal(result.rows.find(row=>row.facultyId==='f2').impactStatus,'decrease');
});

test('Impact Preview marks Draft calculation errors as Needs Review without inventing a Draft DOE',async()=>{
 const {service}=make();
 const source=dataset();
 source.calculations[0].context={activityType:'LEC'};
 await service.validateDraft('ucvm-workload-2027-28-v2');
 const result=await service.runImpactPreview('ucvm-workload-2027-28-v2',source);
 const f1=result.rows.find(row=>row.facultyId==='f1');
 assert.equal(f1.draftDoe,null);
 assert.equal(f1.difference,null);
 assert.equal(f1.impactStatus,'needs_review');
 assert.equal(result.newNeedsReviewCount,1);
});
