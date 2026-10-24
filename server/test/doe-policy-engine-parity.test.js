'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../src/domain/doe-policy-engine.js');

const bundle=(rules,extra={})=>({version:{policyVersionId:'v1',academicYear:'2026-27'},rules,...extra});

test('declared selectors and parameters determine the calculation',()=>{
  const result=engine.calculate(bundle([{
    ruleId:'r1',ruleKey:'lecture',category:'teaching',priority:1,enabled:true,
    selectors:[{field:'activityType',operator:'equals',valueText:'lecture'}],
    calculationMode:'per_hour',parameters:[{name:'rate',valueNumber:0.3}],
    inputs:[{inputName:'hours',required:true}]
  }]),{activityType:'lecture',hours:2});
  assert.equal(result.resultDoe,0.6);
  assert.equal(result.policyVersionId,'v1');
});

test('equal-priority equivalent matches fail as ambiguous',()=>{
  const rules=['r1','r2'].map(ruleId=>({ruleId,ruleKey:ruleId,category:'role',priority:1,enabled:true,
    selectors:[{field:'roleType',operator:'equals',valueText:'VISC'}],calculationMode:'fixed',parameters:[{name:'fixed',valueNumber:1}]}));
  assert.throws(()=>engine.calculate(bundle(rules),{roleType:'VISC'}),error=>error.code==='AMBIGUOUS_RULE');
});

test('missing required input fails rather than returning zero',()=>{
  const rules=[{ruleId:'r1',ruleKey:'lecture',category:'teaching',priority:1,enabled:true,
    selectors:[{field:'activityType',operator:'equals',valueText:'lecture'}],calculationMode:'per_hour',
    parameters:[{name:'rate',valueNumber:0.3}],inputs:[{inputName:'hours',required:true}]}];
  assert.throws(()=>engine.calculate(bundle(rules),{activityType:'lecture'}),error=>error.code==='INPUT_MISSING');
});

test('invalid and incomplete rule configuration fails validation',()=>{
  const report=engine.validatePolicy(bundle([{ruleId:'r1',ruleKey:'bad',priority:'x',enabled:true,selectors:[{field:'courseCode',operator:'around',valueText:'x'}],calculationMode:'unknown'}]));
  assert.equal(report.valid,false);
  assert.ok(report.errors.some(error=>error.code==='CALCULATION_MODE_INVALID'));
  assert.ok(report.errors.some(error=>error.code==='SELECTOR_INVALID'));
});

test('a disabled Reserve policy placeholder is reviewable without inventing numeric defaults',()=>{
  const reserveRule={ruleId:'reserve-review',ruleKey:'reserve_policy',category:'reserve',priority:0,enabled:false,reviewStatus:'needs_review',calculationMode:'fixed',parameters:[],selectors:[]};
  assert.equal(engine.validatePolicy(bundle([reserveRule])).valid,true);
  assert.throws(()=>engine.calculate(bundle([reserveRule]),{category:'reserve'}),error=>error.code==='RULE_NOT_FOUND');
});
