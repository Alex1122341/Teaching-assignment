'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildDataset,ACADEMIC_YEAR}=require('../tools/seed/dataset.js');
const ENGINE=require('../doe-policy-engine.js');
const RUNTIME=require('../server/src/doe/legacy-policy-runtime.js');

function collection(dataset,name){
  const prefix=name+'/';
  return dataset.documents.filter(row=>row.path.startsWith(prefix)).map(row=>({id:row.path.slice(prefix.length),...row.data}));
}

function seededBundle(dataset){
  const policies=collection(dataset,'doe_policies'),versions=collection(dataset,'doe_policy_versions');
  assert.equal(policies.length,1);
  assert.equal(versions.length,1);
  const policy=policies[0],version=versions[0];
  assert.equal(policy.currentActiveVersionId,version.policyVersionId);
  assert.equal(version.status,'active');
  const selectors=collection(dataset,'doe_rule_selectors');
  const inputs=collection(dataset,'doe_rule_inputs');
  const parameters=collection(dataset,'doe_rule_parameters');
  const rules=collection(dataset,'doe_rules').map(rule=>({
    ...rule,
    selectors:selectors.filter(row=>row.ruleId===rule.ruleId),
    inputs:inputs.filter(row=>row.ruleId===rule.ruleId),
    parameters:parameters.filter(row=>row.ruleId===rule.ruleId),
    tiers:[]
  }));
  return{policy,version,rules,exceptions:[]};
}

test('lab seed contains an explicit synthetic Active DOE policy and no production claim',()=>{
  const dataset=buildDataset(),bundle=seededBundle(dataset);
  assert.equal(bundle.policy.testOnly,true);
  assert.equal(bundle.version.testOnly,true);
  assert.match(bundle.policy.description,/TEST ONLY/i);
  assert.equal(bundle.version.academicYear,ACADEMIC_YEAR);
  assert.equal(ENGINE.validatePolicy(bundle).valid,true);
});

test('every seeded timetable assignment is calculable by the synthetic lab policy',()=>{
  const dataset=buildDataset(),bundle=seededBundle(dataset);
  const sessions=collection(dataset,'sessions').map(row=>({id:row.id,...row}));
  assert.ok(sessions.length>0);
  assert.ok(sessions.every(row=>row.academicYear===ACADEMIC_YEAR));
  const impact=RUNTIME.buildImpactDataset({sessions,faculty:[],assignments:[]},ACADEMIC_YEAR);
  assert.ok(impact.calculations.length>0);
  for(const row of impact.calculations){
    const result=ENGINE.calculate(bundle,row.context);
    assert.ok(Number.isFinite(result.resultDoe),row.sourceEntityId);
    assert.equal(result.policyVersionId,bundle.version.policyVersionId);
    assert.equal(result.source,'rule');
  }
});

test('production runtime exposes assignment-level sourceEntityIds for precise queue scopes',()=>{
  const impact=RUNTIME.buildImpactDataset({sessions:[{
    id:'s1',academicYear:ACADEMIC_YEAR,type:'Lecture',assignments:[
      {assignmentId:'a1',facultyId:'f1',role:'Lecture',creditedHours:2},
      {facultyId:'f2',role:'Lecture',creditedHours:1}
    ]
  }],faculty:[],assignments:[]},ACADEMIC_YEAR);
  assert.deepEqual(impact.calculations.map(row=>row.sourceEntityId),['a1','s1--assignment--2']);
});
