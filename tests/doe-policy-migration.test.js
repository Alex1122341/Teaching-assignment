'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ENGINE=require('../doe-policy-engine.js');
const SERVICE=require('../doe-policy-service.js');

const seedPath=path.join(__dirname,'..','tools','doe-policy-2026-27-seed.json');
const seed=JSON.parse(fs.readFileSync(seedPath,'utf8'));

test('2026-27 seed contains only the six stable general teaching rules',()=>{
  assert.equal(seed.version.academicYear,'2026-27');
  assert.equal(seed.version.status,'draft');
  assert.deepEqual(seed.exceptions,[]);
  assert.deepEqual(
    seed.rules.map(rule=>rule.ruleKey),
    [
      'teaching.lecture.standard',
      'teaching.srl.standard',
      'teaching.lab.lead',
      'teaching.lab.primary',
      'teaching.lab.support',
      'teaching.lab.secondary'
    ]
  );
  assert.ok(seed.rules.every(rule=>rule.sourceType==='migration'));
  assert.ok(seed.rules.every(rule=>/current operational behavior/i.test(rule.sourceReference)));
  assert.ok(!JSON.stringify(seed).match(/facultyId|@ucalgary|ucid/i));
  assert.deepEqual(ENGINE.validatePolicy(seed),{valid:true,errors:[],warnings:[]});
});

test('generated migration Exception IDs are stable when authorized source rows are reordered',()=>{
  const rows=[
    {migrationId:'source-a',classification:'fixed',facultyId:'f-a',category:'role',assignment:'Role A',fixedDoe:2,reason:'Authorized fixed value',sourceReference:'Source A'},
    {migrationId:'source-b',classification:'source-reconciled',facultyId:'f-b',category:'role',assignment:'Role B',fixedDoe:3,reason:'Authorized reconciliation',sourceReference:'Source B'}
  ];
  const options={policyVersionId:seed.version.policyVersionId};
  const forward=SERVICE.planMigrationExceptions(rows,options).exceptions.map(row=>row.exceptionId).sort();
  const reverse=SERVICE.planMigrationExceptions([...rows].reverse(),options).exceptions.map(row=>row.exceptionId).sort();
  assert.deepEqual(reverse,forward);
});

test('2026-27 seed reproduces current timetable teaching rates',()=>{
  const fixtures=[
    [{activityType:'LEC',teachingRole:'Lecture'},0.30,'teaching.lecture.standard'],
    [{activityType:'SRL',teachingRole:'SRL'},0.30,'teaching.srl.standard'],
    [{activityType:'LAB',teachingRole:'Lab Lead'},0.21,'teaching.lab.lead'],
    [{activityType:'LAB',teachingRole:'Lab Primary'},0.21,'teaching.lab.primary'],
    [{activityType:'LAB',teachingRole:'Lab Support'},0.19,'teaching.lab.support'],
    [{activityType:'LAB',teachingRole:'Lab Secondary'},0.19,'teaching.lab.secondary']
  ];
  for(const [selector,rate,ruleKey] of fixtures){
    const result=ENGINE.calculate(seed,{academicYear:'2026-27',hours:4,...selector});
    assert.ok(Math.abs(result.resultDoe-(4*rate))<1e-12,ruleKey);
    assert.equal(result.ruleKey,ruleKey);
  }
});

test('exception migration planner separates safe rules, authorized fixed values, and review errors',()=>{
  const result=SERVICE.planMigrationExceptions([
    {
      migrationId:'known-lecture',classification:'safe_general_rule',facultyId:'private-not-exported',
      category:'teaching',assignment:'Lecture block',fixedDoe:1.2
    },
    {
      migrationId:'prorated-hicc',classification:'prorated',facultyId:'faculty-17',
      category:'HICC',assignment:'HICC rotation A',fixedDoe:3.5,
      reason:'Existing prorated operational value',sourceReference:'Authorized 2026-27 source workbook'
    },
    {
      migrationId:'unknown-source',classification:'unresolved',facultyId:'faculty-22',
      category:'VISC',assignment:'Unresolved source row',fixedDoe:2.1
    }
  ],{policyVersionId:seed.version.policyVersionId});

  assert.deepEqual(result.generalRuleRecords.map(row=>row.migrationId),['known-lecture']);
  assert.equal(result.exceptions.length,1);
  assert.deepEqual(
    Object.fromEntries(['facultyId','category','assignment','fixedDoe','reason','sourceReference'].map(key=>[key,result.exceptions[0][key]])),
    {
      facultyId:'faculty-17',category:'HICC',assignment:'HICC rotation A',fixedDoe:3.5,
      reason:'Existing prorated operational value',sourceReference:'Authorized 2026-27 source workbook'
    }
  );
  assert.equal(result.exceptions[0].policyVersionId,seed.version.policyVersionId);
  assert.equal(result.exceptions[0].scopeType,'assignment');
  assert.equal(result.reviewErrors.length,1);
  assert.equal(result.reviewErrors[0].code,'MIGRATION_CLASSIFICATION_UNRESOLVED');
  assert.equal(result.accepted,false);
});

test('planner-generated assignment Exception matches the preview assignment label',()=>{
  const planned=SERVICE.planMigrationExceptions([{
    migrationId:'role-fixed',classification:'fixed',facultyId:'f7',category:'role',
    assignment:'Course Coordinator',fixedDoe:2.25,reason:'Authorized fixed value',sourceReference:'Authorized source'
  }],{policyVersionId:seed.version.policyVersionId});
  const result=ENGINE.calculate({
    version:seed.version,rules:[],exceptions:planned.exceptions
  },{facultyId:'f7',category:'role',assignment:'Course Coordinator'});
  assert.equal(result.source,'exception');
  assert.equal(result.resultDoe,2.25);
});

test('migration planner never infers a general formula from an observed numeric result',()=>{
  const result=SERVICE.planMigrationExceptions([
    {
      migrationId:'single-observation',facultyId:'faculty-31',category:'role',assignment:'Operational duty',
      fixedDoe:2.5,observedHours:5,observedRate:0.5
    }
  ],{policyVersionId:seed.version.policyVersionId});
  assert.deepEqual(result.generalRuleRecords,[]);
  assert.deepEqual(result.exceptions,[]);
  assert.equal(result.reviewErrors[0].code,'MIGRATION_CLASSIFICATION_REQUIRED');
  assert.equal(result.accepted,false);
});

test('shadow parity reports explained and unresolved differences per faculty',()=>{
  const report=SERVICE.buildShadowParityReport([
    {facultyId:'f1',oldDoe:1.20,engineDoe:1.20,classification:'rule'},
    {facultyId:'f1',oldDoe:3.25,engineDoe:3.50,classification:'exception',reason:'Approved source reconciliation',sourceReference:'Authorized source',approval:{approvedBy:'general-1',approvedByRole:'adfa_general',approvedAt:'2026-09-18T20:00:00Z',approvalReference:'General approval record 17'}},
    {facultyId:'f2',oldDoe:2.00,engineDoe:2.03,classification:'unresolved'},
    {facultyId:'f3',oldDoe:1.00,engineDoe:1.01,classification:'unresolved'}
  ]);

  assert.equal(report.tolerance,0.01);
  assert.equal(report.accepted,false);
  assert.deepEqual(report.blockingFacultyIds,['f2']);
  const f1=report.faculty.find(row=>row.facultyId==='f1');
  assert.deepEqual(f1,{
    facultyId:'f1',oldTotal:4.45,engineTotal:4.7,difference:0.25,
    ruleExplainedAmount:0,exceptionExplainedAmount:0.25,unresolvedAmount:0,
    accepted:true
  });
  assert.equal(report.faculty.find(row=>row.facultyId==='f2').unresolvedAmount,0.03);
  assert.equal(report.faculty.find(row=>row.facultyId==='f3').accepted,true);
});

test('difference documentation without General approval evidence remains unresolved',()=>{
  const report=SERVICE.buildShadowParityReport([
    {facultyId:'f9',oldDoe:1,engineDoe:1.5,classification:'exception',reason:'Source reconciliation',sourceReference:'Authorized source'}
  ]);
  assert.equal(report.accepted,false);
  assert.equal(report.faculty[0].exceptionExplainedAmount,0);
  assert.equal(report.faculty[0].unresolvedAmount,0.5);
});
