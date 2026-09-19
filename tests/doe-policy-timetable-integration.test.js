'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ENGINE=require('../doe-policy-engine.js');
const REPO=require('../doe-policy-repository.js');
const SERVICE=require('../doe-policy-service.js');
const root=path.resolve(__dirname,'..');

function loadSelection(){
  const context={window:{},Date,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context);
  return context.window.UCVM_TIMETABLE_SELECTION;
}

function seed(rate=.42){
  return{
    policies:[{policyId:'ucvm-workload-2026-27',academicYear:'2026-27',currentActiveVersionId:'ucvm-workload-2026-27-v1'}],
    versions:[{policyVersionId:'ucvm-workload-2026-27-v1',policyId:'ucvm-workload-2026-27',academicYear:'2026-27',versionNumber:1,status:'active',revision:1}],
    rules:[{ruleId:'lecture-rule',policyVersionId:'ucvm-workload-2026-27-v1',ruleKey:'teaching.lecture.standard',category:'teaching',name:'Lecture',calculationMode:'per_hour',resultKind:'credit',priority:100,enabled:true}],
    selectors:[
      {selectorId:'lecture-type',ruleId:'lecture-rule',policyVersionId:'ucvm-workload-2026-27-v1',field:'activityType',operator:'equals',valueText:'LEC',order:1},
      {selectorId:'lecture-role',ruleId:'lecture-rule',policyVersionId:'ucvm-workload-2026-27-v1',field:'teachingRole',operator:'equals',valueText:'Lecture',order:2}
    ],
    parameters:[{parameterId:'lecture-rate',ruleId:'lecture-rule',policyVersionId:'ucvm-workload-2026-27-v1',name:'rate',valueNumber:rate,unit:'percent_per_hour',required:true,order:1}],
    inputs:[{ruleInputId:'lecture-hours',ruleId:'lecture-rule',policyVersionId:'ucvm-workload-2026-27-v1',inputName:'hours',inputType:'number',required:true,source:'session',unit:'hours'}],
    exceptions:[]
  };
}

function serviceFor(data=seed()){
  const repository=REPO.createMemoryRepository(data);
  const service=SERVICE.createService({
    repository,engine:ENGINE,
    actorProvider:()=>({uid:'admin-1',name:'Admin',email:'admin@example.test',role:'adfa_general'}),
    clock:()=>new Date('2026-09-18T20:00:00Z')
  });
  return{repository,service};
}

function lectureSession(overrides={}){
  return{
    id:'s1',date:'2026-09-10',semester:'fall',year:1,course:'200',type:'LEC',topic:'Topic',room:'A101',start:'09:00',end:'11:00',
    assignments:[{ucid:'f1',facultyId:'f1',name:'Faculty One',role:'Lecture'}],facultyIds:['f1'],
    ...overrides
  };
}

const plain=value=>JSON.parse(JSON.stringify(value));

test('new Lecture uses the current Active policy instead of a local timetable rate map',async()=>{
  const api=loadSelection(),{service}=serviceFor(seed(.42));
  const adapter=api.createDoeAdapter({service,engine:ENGINE});
  const prepared=await adapter.prepareSession(null,lectureSession(),{trigger:'session_created'});
  assert.equal(prepared.session.assignments[0].doeCredit,.84);
  assert.equal(prepared.session.assignments[0].doePolicyVersionId,'ucvm-workload-2026-27-v1');
  assert.equal(prepared.session.assignments[0].doeRuleId,'lecture-rule');
  assert.equal(prepared.session.assignments[0].doeRuleKey,'teaching.lecture.standard');
  assert.equal(prepared.calculationRecords.length,1);
});

test('room-only edit preserves stored DOE and original policy calculation provenance',async()=>{
  const api=loadSelection(),{service}=serviceFor(seed(.42));
  const adapter=api.createDoeAdapter({service,engine:ENGINE});
  const before=lectureSession({
    assignments:[{ucid:'f1',facultyId:'f1',name:'Faculty One',role:'Lecture',assignmentId:'s1--assignment--1',creditedHours:2,doeCredit:.6,doePolicyVersionId:'legacy-v1',doeRuleId:'legacy-rule',doeRuleKey:'teaching.lecture.standard',doeCalculationId:'calc-old'}]
  });
  const after=plain(before);after.room='B202';
  const prepared=await adapter.prepareSession(before,after,{trigger:'session_updated'});
  const assignment=prepared.session.assignments[0];
  assert.equal(assignment.doeCredit,.6);
  assert.equal(assignment.doePolicyVersionId,'legacy-v1');
  assert.equal(assignment.doeCalculationId,'calc-old');
  assert.equal(prepared.calculationRecords.length,0);
});

test('duration edit recalculates derived credited hours with the current Active policy',async()=>{
  const api=loadSelection(),{service}=serviceFor(seed(.42));
  const adapter=api.createDoeAdapter({service,engine:ENGINE});
  const before=lectureSession({
    assignments:[{ucid:'f1',facultyId:'f1',name:'Faculty One',role:'Lecture',assignmentId:'s1--assignment--1',creditedHours:2,doeCredit:.6,doePolicyVersionId:'legacy-v1',doeRuleId:'legacy-rule',doeRuleKey:'teaching.lecture.standard',doeCalculationId:'calc-old'}]
  });
  const after=plain(before);after.end='12:00';
  const prepared=await adapter.prepareSession(before,after,{trigger:'session_timing_changed'});
  const assignment=prepared.session.assignments[0];
  assert.equal(assignment.creditedHours,3);
  assert.ok(Math.abs(assignment.doeCredit-1.26)<1e-12);
  assert.equal(assignment.doePolicyVersionId,'ucvm-workload-2026-27-v1');
  assert.equal(prepared.calculationRecords.length,1);
});

function addTeachingRoleRule(data,{ruleId,role,rate}){
  data.rules.push({ruleId,policyVersionId:'ucvm-workload-2026-27-v1',ruleKey:`teaching.lecture.${role.toLowerCase()}`,category:'teaching',name:role,calculationMode:'per_hour',resultKind:'credit',priority:100,enabled:true});
  data.selectors.push(
    {selectorId:`${ruleId}-type`,ruleId,policyVersionId:'ucvm-workload-2026-27-v1',field:'activityType',operator:'equals',valueText:'LEC',order:1},
    {selectorId:`${ruleId}-role`,ruleId,policyVersionId:'ucvm-workload-2026-27-v1',field:'teachingRole',operator:'equals',valueText:role,order:2}
  );
  data.parameters.push({parameterId:`${ruleId}-rate`,ruleId,policyVersionId:'ucvm-workload-2026-27-v1',name:'rate',valueNumber:rate,unit:'percent_per_hour',required:true,order:1});
  data.inputs.push({ruleInputId:`${ruleId}-hours`,ruleId,policyVersionId:'ucvm-workload-2026-27-v1',inputName:'hours',inputType:'number',required:true,source:'session',unit:'hours'});
  return data;
}

test('teaching-role edit recalculates with the matching Active policy rule',async()=>{
  const data=addTeachingRoleRule(seed(.42),{ruleId:'support-rule',role:'Support',rate:.19});
  const api=loadSelection(),{service}=serviceFor(data),adapter=api.createDoeAdapter({service,engine:ENGINE});
  const before=lectureSession({
    assignments:[{ucid:'f1',facultyId:'f1',name:'Faculty One',role:'Lecture',assignmentId:'s1--assignment--1',creditedHours:2,doeCredit:.84,doePolicyVersionId:'ucvm-workload-2026-27-v1',doeRuleId:'lecture-rule',doeRuleKey:'teaching.lecture.standard',doeCalculationId:'calc-old'}]
  });
  const after=plain(before);after.assignments[0].role='Support';
  const prepared=await adapter.prepareSession(before,after,{trigger:'teaching_role_changed'});
  assert.ok(Math.abs(prepared.session.assignments[0].doeCredit-.38)<1e-12);
  assert.equal(prepared.session.assignments[0].doeRuleId,'support-rule');
  assert.notEqual(prepared.session.assignments[0].doeCalculationId,'calc-old');
  assert.equal(prepared.calculationRecords.length,1);
});

test('missing policy or required input blocks a DOE-relevant save instead of substituting zero',async()=>{
  const api=loadSelection();
  const missingPolicy=serviceFor({policies:[],versions:[],rules:[],selectors:[],parameters:[],inputs:[],exceptions:[]});
  await assert.rejects(
    ()=>api.createDoeAdapter({service:missingPolicy.service,engine:ENGINE}).prepareSession(null,lectureSession()),
    error=>error&&error.code==='ACTIVE_POLICY_NOT_FOUND'
  );

  const {service}=serviceFor(seed(.42)),adapter=api.createDoeAdapter({service,engine:ENGINE});
  const unknown=lectureSession({start:'',end:'',timeUnknown:true,assignments:[{ucid:'f1',facultyId:'f1',name:'Faculty One',role:'Lecture'}]});
  await assert.rejects(
    ()=>adapter.prepareSession(null,unknown),
    error=>error&&error.code==='INPUT_MISSING'
  );
  assert.equal(unknown.assignments[0].doeCredit,undefined);
});

test('DOE recalculation returns audit evidence with old and new DOE and policy provenance',async()=>{
  const api=loadSelection(),{service}=serviceFor(seed(.42)),adapter=api.createDoeAdapter({service,engine:ENGINE});
  const before=lectureSession({
    assignments:[{ucid:'f1',facultyId:'f1',name:'Faculty One',role:'Lecture',assignmentId:'s1--assignment--1',creditedHours:2,doeCredit:.6,doePolicyVersionId:'legacy-v1',doeRuleId:'legacy-rule',doeRuleKey:'teaching.lecture.standard',doeCalculationId:'calc-old'}]
  });
  const after=plain(before);after.end='12:00';
  const prepared=await adapter.prepareSession(before,after,{trigger:'session_timing_changed'});
  assert.equal(prepared.doeChanges.length,1);
  assert.deepEqual(plain(prepared.doeChanges[0]),{
    assignmentId:'s1--assignment--1',facultyId:'f1',oldDoeCredit:.6,newDoeCredit:1.26,
    oldPolicyVersionId:'legacy-v1',newPolicyVersionId:'ucvm-workload-2026-27-v1',
    oldCalculationId:'calc-old',newCalculationId:prepared.session.assignments[0].doeCalculationId,
    ruleId:'lecture-rule',ruleKey:'teaching.lecture.standard'
  });
  assert.equal(prepared.calculationRecords[0].resultDoe,1.26);
  assert.equal(prepared.calculationRecords[0].policyVersionId,'ucvm-workload-2026-27-v1');
});

test('Firestore DOE repository can stage immutable calculation evidence into a caller-owned batch',()=>{
  const FIRESTORE=require('../doe-policy-firestore.js'),writes=[];
  const db={collection:name=>({doc:id=>({path:`${name}/${id}`})})};
  const repository=FIRESTORE.createFirestoreRepository({db});
  const batch={set:(ref,row)=>writes.push([ref.path,row])};
  const record={calculationId:'calc-atomic',policyVersionId:'v1',calculatedBy:'admin-1',resultDoe:.84};
  const staged=repository.stageCalculationRecord(batch,record);
  assert.equal(staged.calculationId,'calc-atomic');
  assert.deepEqual(writes.map(entry=>entry[0]),['doe_calculation_records/calc-atomic']);
});

test('timetable writers are cut over to the policy adapter and the private hard-coded rate map is removed',()=>{
  const source=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
  assert.doesNotMatch(source,/function\s+doeRateForRole\b/);
  assert.doesNotMatch(source,/['"]Lecture['"]\s*:\s*0\.30/);
  assert.match(source,/function\s+getTimetableDoeRuntime\b/);
  assert.match(source,/saveSelectedChanges[\s\S]*prepareSession/);
  assert.match(source,/saveBulkSessions[\s\S]*prepareSession/);
  assert.match(source,/session-form['"]\)\.onsubmit[\s\S]*prepareSession/);
  assert.doesNotMatch(source,/stageCalculationRecord|UCVM_DOE_POLICY_FIRESTORE/);
  assert.match(source,/saveSessionChange/);
});

test('faculty swap re-evaluates DOE through API and persists through server session save',()=>{
  const source=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
  const start=source.indexOf('async function performFacultySwap');
  const end=source.indexOf('\n  async function initializeLiveSchedule',start);
  const fn=source.slice(start,end);
  assert.match(fn,/prepareSession\(/);
  assert.match(fn,/saveSessionChange/);
  assert.doesNotMatch(fn,/stageCalculationRecord|UCVM_DOE_POLICY_FIRESTORE/);
  assert.match(fn,/doeAuditChanges/);
});
