'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ENGINE=require('../doe-policy-engine.js');
const REPO=require('../doe-policy-repository.js');
const SERVICE=require('../doe-policy-service.js');

function seed(){
 return{
  policies:[{policyId:'ucvm-workload-2027-28',academicYear:'2027-28',name:'Policy',currentActiveVersionId:'ucvm-workload-2027-28-v1'}],
  versions:[
   {policyVersionId:'ucvm-workload-2027-28-v1',policyId:'ucvm-workload-2027-28',academicYear:'2027-28',versionNumber:1,status:'active',revision:1},
   {policyVersionId:'ucvm-workload-2027-28-v2',policyId:'ucvm-workload-2027-28',academicYear:'2027-28',versionNumber:2,status:'draft',revision:1}
  ],
  rules:[{ruleId:'r-v1-lecture',policyVersionId:'ucvm-workload-2027-28-v1',ruleKey:'teaching.lecture.standard',category:'teaching',name:'Lecture',calculationMode:'per_hour',resultKind:'credit',priority:100,enabled:true}],
  selectors:[{selectorId:'sel-v1',ruleId:'r-v1-lecture',policyVersionId:'ucvm-workload-2027-28-v1',field:'activityType',operator:'equals',valueText:'LEC',order:1}],
  parameters:[{parameterId:'param-v1',ruleId:'r-v1-lecture',policyVersionId:'ucvm-workload-2027-28-v1',name:'rate',valueNumber:.3,required:true,order:1}],
  inputs:[{ruleInputId:'input-v1',ruleId:'r-v1-lecture',policyVersionId:'ucvm-workload-2027-28-v1',inputName:'hours',inputType:'number',required:true,source:'session'}],
  exceptions:[]
 };
}

const actor=role=>({uid:role==='adfa_general'?'general':'regular',name:'Admin',email:'admin@example.test',role});
const dataset=()=>({academicYear:'2027-28',calculations:[
 {sourceEntityType:'session_assignment',sourceEntityId:'s1--assignment--1',sessionId:'s1',assignmentId:'a1',facultyId:'f1',currentDoe:.3,currentPolicyVersionId:'legacy-v0',context:{category:'teaching',activityType:'LEC',teachingRole:'Lecture',role:'Lecture',hours:2}},
 {sourceEntityType:'session_assignment',sourceEntityId:'s2--assignment--1',sessionId:'s2',assignmentId:'a2',facultyId:'f1',currentDoe:.6,currentPolicyVersionId:'ucvm-workload-2027-28-v1',context:{category:'teaching',activityType:'LEC',teachingRole:'Lecture',role:'Lecture',hours:2}},
 {sourceEntityType:'session_assignment',sourceEntityId:'s3--assignment--1',sessionId:'s3',assignmentId:'a3',facultyId:'f2',currentDoe:.1,currentPolicyVersionId:'legacy-v0',context:{category:'teaching',activityType:'LEC',teachingRole:'Lecture',role:'Lecture',hours:1}}
]});

function create({role='adfa_general',writer,refresh,provider=dataset,chunkSize=2}={}){
 const repo=REPO.createMemoryRepository(seed());
 const service=SERVICE.createService({
  repository:repo,engine:ENGINE,actorProvider:()=>actor(role),clock:()=>new Date('2026-09-18T22:00:00Z'),
  datasetProvider:async()=>provider(),recalculationWriter:writer,derivedIndexRefresh:refresh,recalculationChunkSize:chunkSize
 });
 return{repo,service};
}

test('ADFA Regular cannot execute administrative recalculation',async()=>{
 const {service}=create({role:'adfa_regular',writer:async()=>{throw Error('must not run')}});
 await assert.rejects(
  ()=>service.runRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',scope:'all'}),
  error=>error&&error.code==='PERMISSION_DENIED'
 );
});

test('recalculate requires the selected policy to be the Active version for the academic year',async()=>{
 const {service}=create();
 await assert.rejects(
  ()=>service.previewRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v2',scope:'all'}),
  error=>error&&error.code==='ACTIVE_POLICY_REQUIRED'
 );
});

test('dry run writes nothing and reports affected rows, versions, changes, errors and warnings',async()=>{
 let writes=0,refreshes=0;
 const {repo,service}=create({writer:async()=>{writes++},refresh:async()=>{refreshes++}});
 const preview=await service.previewRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',scope:'all'});
 assert.equal(preview.facultyAffected,2);
 assert.equal(preview.assignmentsAffected,3);
 assert.equal(preview.roleSupervisionAffected,0);
 assert.deepEqual(preview.oldPolicyVersions,['legacy-v0','ucvm-workload-2027-28-v1']);
 assert.equal(preview.newActiveVersion,'ucvm-workload-2027-28-v1');
 assert.equal(preview.changedDoeCount,2);
 assert.equal(preview.errors.length,0);
 assert.ok(Array.isArray(preview.warnings));
 assert.equal(writes,0);assert.equal(refreshes,0);
 assert.equal((await repo.listCalculationRecords()).length,0);
 assert.equal((await repo.listAudit()).length,0);
});

test('execution writes canonical rows with immutable calculation evidence and refreshes derived indexes after all chunks',async()=>{
 const committed=[],events=[];let refreshes=0;
 const writer=async payload=>{events.push(`write:${payload.start}-${payload.end}`);committed.push(...payload.rows.map((row,index)=>({row,record:payload.calculationRecords[index]})))};
 const refresh=async()=>{events.push('refresh');refreshes++};
 const {repo,service}=create({writer,refresh});
 const result=await service.runRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',scope:'all',batchId:'recalc-001'});
 assert.equal(result.completedRows,3);
 assert.equal(result.batchId,'recalc-001');
 assert.equal(committed.length,3);
 assert.equal(committed[0].row.resultDoe,.6);
 assert.equal(committed[0].record.policyVersionId,'ucvm-workload-2027-28-v1');
 assert.equal(committed[0].record.recalculationBatchId,'recalc-001');
 assert.equal(committed[0].record.trigger,'administrative_recalculation');
 assert.equal(refreshes,1);
 assert.equal(events.at(-1),'refresh');
 const audits=await repo.listAudit('ucvm-workload-2027-28-v1');
 assert.deepEqual(audits.map(row=>row.action),['recalculation_started','recalculation_completed']);
});

test('failed chunk exposes partialCommit, completedRows, resumeFrom and stable batchId',async()=>{
 let calls=0;
 const writer=async()=>{calls++;if(calls===2)throw Error('chunk failed')};
 const {service}=create({writer});
 await assert.rejects(
  ()=>service.runRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',scope:'all',batchId:'recalc-resume'}),
  error=>{
   assert.equal(error.partialCommit,true);
   assert.equal(error.completedRows,2);
   assert.equal(error.resumeFrom,2);
   assert.equal(error.batchId,'recalc-resume');
   return true;
  }
 );
});

test('configured recalculation chunks stay within the Firestore atomic-write budget',async()=>{
 const rows=Array.from({length:401},(_,index)=>({
  sourceEntityType:'session_assignment',sourceEntityId:`s${index}--assignment--1`,sessionId:`s${index}`,assignmentId:`a${index}`,facultyId:`f${index}`,currentDoe:.3,currentPolicyVersionId:'legacy-v0',
  context:{category:'teaching',activityType:'LEC',teachingRole:'Lecture',role:'Lecture',hours:1}
 }));
 const sizes=[];
 const {service}=create({provider:()=>({academicYear:'2027-28',calculations:rows}),chunkSize:400,writer:async payload=>sizes.push(payload.rows.length),refresh:async()=>{}});
 await service.runRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',scope:'all',batchId:'recalc-budget'});
 assert.deepEqual(sizes,[200,200,1]);
});

test('derived-index refresh failure exposes a fully committed resume point and retries without rewriting DOE rows',async()=>{
 let writes=0,refreshes=0,failRefresh=true;
 const writer=async()=>{writes++};
 const refresh=async()=>{refreshes++;if(failRefresh)throw Error('index refresh failed')};
 const {service}=create({writer,refresh});
 await assert.rejects(
  ()=>service.runRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',scope:'all',batchId:'recalc-index'}),
  error=>{
   assert.equal(error.partialCommit,true);
   assert.equal(error.completedRows,3);
   assert.equal(error.resumeFrom,3);
   assert.equal(error.batchId,'recalc-index');
   return true;
  }
 );
 const writesAfterFailure=writes;failRefresh=false;
 const result=await service.runRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',scope:'all',resumeFrom:3,batchId:'recalc-index'});
 assert.equal(writes,writesAfterFailure);
 assert.equal(refreshes,2);
 assert.equal(result.completedRows,3);
});

test('resume skips committed rows and preserves the same recalculation batch id',async()=>{
 const committed=[];
 const writer=async payload=>committed.push({ids:payload.rows.map(row=>row.sourceEntityId),batchId:payload.batchId});
 const {service}=create({writer});
 const result=await service.runRecalculate({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',scope:'all',resumeFrom:2,batchId:'recalc-resume'});
 assert.equal(result.completedRows,3);
 assert.deepEqual(committed,[{ids:['s3--assignment--1'],batchId:'recalc-resume'}]);
});

test('admin recalculation confirmation names the Academic Year and Active policy version',()=>{
 const ADMIN=require('../doe-policy-admin.js');
 const message=ADMIN.recalculationConfirmationText({academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1'},{assignmentsAffected:12,changedDoeCount:7});
 assert.match(message,/2027-28/);
 assert.match(message,/ucvm-workload-2027-28-v1/);
 assert.match(message,/12/);
 assert.match(message,/7/);
});

test('recalculation source helper updates session assignment DOE and immutable provenance pointer',()=>{
 const ADMIN=require('../doe-policy-admin.js');
 const source={assignments:[{assignmentId:'a1',ucid:'f1',role:'Lecture',doeCredit:.3}]};
 const rows=[{sourceEntityType:'session_assignment',sourceEntityId:'s1--assignment--1',assignmentId:'a1',resultDoe:.6,policyVersionId:'v1',ruleId:'r1',ruleKey:'teaching.lecture.standard'}];
 const records=[{calculationId:'calc-1'}];
 const next=ADMIN.applyRecalculationRowsToSource(source,rows,records);
 assert.equal(next.assignments[0].doeCredit,.6);
 assert.equal(next.assignments[0].doePolicyVersionId,'v1');
 assert.equal(next.assignments[0].doeRuleId,'r1');
 assert.equal(next.assignments[0].doeRuleKey,'teaching.lecture.standard');
 assert.equal(next.assignments[0].doeCalculationId,'calc-1');
});

test('recalculation source helper updates managed role and source reconciliation faculty DOE',()=>{
 const ADMIN=require('../doe-policy-admin.js');
 const source={managedRoles2026_27:[{type:'HICC',doeCredit:1}],facultySummary2026_27:{sourceNonTimetableTeachingDOE:2}};
 const rows=[
  {sourceEntityType:'managed_role',sourceEntityId:'f1--managed-role--1',resultDoe:1.5,policyVersionId:'v1',ruleId:'rr',ruleKey:'role.hicc'},
  {sourceEntityType:'source_reconciliation',sourceEntityId:'f1--source-non-timetable-teaching',resultDoe:2.5,policyVersionId:'v1',ruleId:'rt',ruleKey:'teaching.reconciliation'}
 ];
 const records=[{calculationId:'calc-r'},{calculationId:'calc-t'}];
 const next=ADMIN.applyRecalculationRowsToSource(source,rows,records);
 assert.equal(next.managedRoles2026_27[0].doeCredit,1.5);
 assert.equal(next.managedRoles2026_27[0].doeCalculationId,'calc-r');
 assert.equal(next.facultySummary2026_27.sourceNonTimetableTeachingDOE,2.5);
 assert.equal(next.facultySummary2026_27.sourceNonTimetableTeachingDOECalculationId,'calc-t');
});

test('Firestore rules reserve administrative recalculation markers and batch path for ADFA General',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const rules=fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8');
 assert.match(rules,/match \/doe_recalculation_batches\/\{id\}/);
 assert.match(rules,/doeRecalculationBatchId/);
 assert.match(rules,/recalculationBatchId/);
 assert.match(rules,/general\(\)/);
 assert.match(rules,/after\.diff\(before\)\.affectedKeys\(\)\.hasOnly\(\['status','completedRows','changedByName','updatedAt'\]\)/);
});

test('production DOE admin wires the Firestore recalculation writer and canonical derived-index refresh',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'..','doe-policy-admin.js'),'utf8');
 assert.match(source,/createFirestoreRecalculationWriter/);
 assert.match(source,/recalculationWriter:/);
 assert.match(source,/derivedIndexRefresh:/);
 assert.match(source,/refreshCoreDerivedIndexes/);
 assert.match(source,/doe-recalculate-status/);
});
