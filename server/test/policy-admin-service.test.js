'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPolicyAdminService,buildImpactDataset,applyRecalculationRowsToSource}=require('../src/doe/policy-admin-service.js');

const general={uid:'g1',name:'General',role:'adfa_general'};
function harness(){
  const calls=[];
  const serviceFor=actor=>({
    async createPolicyYear(input){calls.push(['create',actor,input]);return{policy:{academicYear:input.academicYear}}},
    async cloneAsDraft(id){calls.push(['clone',actor,id]);return{version:{policyVersionId:'v2'}}},
    async validateDraft(id){calls.push(['validate',actor,id]);return{valid:true,errors:[],warnings:[]}},
    async runImpactPreview(id){calls.push(['preview',actor,id]);return{status:'passed',policyVersionId:id}},
    async publish(id){calls.push(['publish',actor,id]);return{policyVersionId:id,status:'active'}},
    async archive(id){calls.push(['archive',actor,id]);return{policyVersionId:id,status:'archived'}},
    async previewRecalculate(input){calls.push(['recalc-preview',actor,input]);return{errors:[],warnings:[],assignmentsAffected:2,changedDoeCount:1}},
    async runRecalculate(input){calls.push(['recalc-run',actor,input]);return{batchId:'b1',completedRows:2,totalRows:2}}
  });
  const engine={
    validatePolicy:()=>({valid:true,errors:[],warnings:[]}),
    calculate:(_bundle,sample)=>({resultDoe:Number(sample.hours||0)*.3,ruleId:'r1',ruleKey:'teaching.lecture.standard',inputs:sample,parameters:{rate:.3}})
  };
  const annual={async validateAnnualReview(id,_dataset,{actor}){calls.push(['annual-validate',actor,id]);return{valid:true,errors:[],warnings:[]}}};
  return{calls,service:createPolicyAdminService({serviceFor,engine,annualRulebookService:annual})};
}

test('policy admin calculation actions execute through the server service for the request actor',async()=>{
  const {service,calls}=harness();
  await service.createPolicyYear({actor:general,academicYear:'2027-28'});
  await service.cloneDraft({actor:general,policyVersionId:'v1'});
  await service.validateDraft({actor:general,policyVersionId:'v1'});
  await service.runImpactPreview({actor:general,policyVersionId:'v1'});
  await service.publish({actor:general,policyVersionId:'v1'});
  await service.archive({actor:general,policyVersionId:'v1'});
  await service.previewRecalculate({actor:general,academicYear:'2027-28',policyVersionId:'v1',scope:'all'});
  await service.runRecalculate({actor:general,academicYear:'2027-28',policyVersionId:'v1',scope:'all'});
  assert.ok(calls.some(row=>row[0]==='annual-validate'));
  assert.ok(calls.some(row=>row[0]==='publish'&&row[1].uid==='g1'));
  assert.ok(calls.some(row=>row[0]==='recalc-run'&&row[1].uid==='g1'));
});

test('draft rule test is evaluated on the server engine',async()=>{
  const {service}=harness();
  const result=await service.testRule({actor:general,rule:{policyVersionId:'v1',ruleId:'r1',ruleKey:'teaching.lecture.standard',name:'Lecture',category:'teaching',calculationMode:'per_hour',resultKind:'credit',priority:100,enabled:true,selectors:[],inputs:[{inputName:'hours',required:true}],parameters:[{name:'rate',valueNumber:.3}],tiers:[]},sample:{hours:2}});
  assert.equal(result.resultDoe,.6);
  assert.equal(result.ruleKey,'teaching.lecture.standard');
});


test('policy admin reads bundles and saves Draft configuration through the server repository',async()=>{
  const calls=[];
  const repositoryFor=actor=>({
    async listPolicies(){calls.push(['list-policies',actor]);return[{policyId:'p1',academicYear:'2027-28'}]},
    async listVersions(policyId){calls.push(['list-versions',actor,policyId]);return[{policyVersionId:'v1',policyId,status:'draft',revision:2}]},
    async getVersion(id){calls.push(['get-version',actor,id]);return{policyVersionId:id,status:'draft',revision:2}},
    async getImpactRun(id){return{impactRunId:id,status:'passed'}},
    async listImpactRows(id){return[{impactRunId:id,facultyId:'f1'}]},
    async saveDraftRule(row,revision){calls.push(['save-rule',row,revision]);return{rule:row,version:{revision:revision+1}}},
    async saveSelector(row,revision){calls.push(['save-selector',row,revision]);return{row,version:{revision:revision+1}}},
    async saveRuleInput(row,revision){calls.push(['save-input',row,revision]);return{row,version:{revision:revision+1}}},
    async saveParameter(row,revision){calls.push(['save-parameter',row,revision]);return{row,version:{revision:revision+1}}},
    async saveTier(row,revision){calls.push(['save-tier',row,revision]);return{row,version:{revision:revision+1}}},
    async saveException(row,revision){calls.push(['save-exception',row,revision]);return{exception:row,version:{revision:revision+1}}}
  });
  const serviceFor=actor=>({
    async loadPolicyBundle(id){calls.push(['bundle',actor,id]);return{version:{policyVersionId:id,status:'draft',revision:2},rules:[],exceptions:[]}}
  });
  const service=createPolicyAdminService({serviceFor,repositoryFor,engine:{validatePolicy:()=>({valid:true,errors:[],warnings:[]}),calculate:()=>({})}});
  assert.equal((await service.listPolicies({actor:general}))[0].policyId,'p1');
  assert.equal((await service.listVersions({actor:general,policyId:'p1'}))[0].policyVersionId,'v1');
  assert.equal((await service.loadPolicyBundle({actor:general,policyVersionId:'v1'})).version.policyVersionId,'v1');
  const impact=await service.getImpactPreview({actor:general,impactRunId:'i1'});
  assert.equal(impact.rows[0].facultyId,'f1');
  const rule={policyVersionId:'v1',ruleId:'r1',ruleKey:'teaching.lecture.standard',selectors:[{selectorId:'s1'}],inputs:[{ruleInputId:'i1'}],parameters:[{parameterId:'p1'}],tiers:[{tierId:'t1'}]};
  await service.saveRule({actor:general,policyVersionId:'v1',rule});
  await service.saveException({actor:general,policyVersionId:'v1',exception:{exceptionId:'e1',fixedDoe:2,reason:'Approved',sourceReference:'WG'}});
  assert.deepEqual(calls.filter(row=>row[0].startsWith('save-')).map(row=>row[0]),['save-rule','save-selector','save-input','save-parameter','save-tier','save-exception']);
});


test('server policy admin builds authoritative legacy impact rows during migration',()=>{
  const built=buildImpactDataset({
    faculty:[{__id:'f1',managedRoles2026_27:[{type:'HICC',assignment:'VTMD 204',action:'add',doeCredit:2.5,doePolicyVersionId:'role-v0'}]}],
    sessions:[{id:'s1',date:'2026-09-10',course:'204',type:'LEC',assignments:[{assignmentId:'a1',ucid:'f1',role:'Lecture',creditedHours:1,doeCredit:.3,doePolicyVersionId:'teach-v0'}]}]
  },'2026-27');
  assert.equal(built.calculations.length,2);
  assert.equal(built.calculations.find(row=>row.sourceEntityType==='session_assignment').currentDoe,.3);
  assert.equal(built.calculations.find(row=>row.sourceEntityType==='managed_role').currentDoe,2.5);
});

test('server recalculation source application preserves immutable provenance pointers',()=>{
  const next=applyRecalculationRowsToSource(
    {assignments:[{assignmentId:'a1',ucid:'f1',doeCredit:.3}]},
    [{sourceEntityType:'session_assignment',sourceEntityId:'s1--assignment--1',assignmentId:'a1',resultDoe:.6,policyVersionId:'v1',ruleId:'r1',ruleKey:'teaching.lecture.standard'}],
    [{calculationId:'calc-1'}]
  );
  assert.equal(next.assignments[0].doeCredit,.6);
  assert.equal(next.assignments[0].doePolicyVersionId,'v1');
  assert.equal(next.assignments[0].doeCalculationId,'calc-1');
});

test('policy year read returns the matching policy and versions through server repository',async()=>{
 const repositoryFor=()=>({
  async listPolicies(){return[{policyId:'p26',academicYear:'2026-27'},{policyId:'p27',academicYear:'2027-28'}]},
  async listVersions(policyId){return[{policyVersionId:'v27',policyId,status:'draft'}]}
 });
 const service=createPolicyAdminService({serviceFor:()=>({}),repositoryFor,engine:{validatePolicy:()=>({valid:true}),calculate:()=>({})}});
 const result=await service.getPolicyYear({actor:general,academicYear:'2027-28'});
 assert.equal(result.policy.policyId,'p27');
 assert.equal(result.versions[0].policyVersionId,'v27');
});

test('legacy impact rows never infer current DOE from doeRate times hours',()=>{
 const built=buildImpactDataset({sessions:[{id:'s1',assignments:[{assignmentId:'a1',ucid:'f1',doeRate:.3,creditedHours:2}]}]},'2026-27');
 assert.equal(built.calculations[0].currentDoe,null);
});
