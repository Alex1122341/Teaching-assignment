'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const seed=require('../../tools/doe-policy-2026-27-seed.json');
const ENGINE=require('../../doe-policy-engine.js');

const bundle={version:seed.version,rules:seed.rules,exceptions:seed.exceptions||[]};
const calc=context=>ENGINE.calculate(bundle,{academicYear:'2026-27',...context}).resultDoe;

const cases=[
 ['Lecture',{activityType:'LEC',teachingRole:'Lecture',hours:2},0.60],
 ['SRL',{activityType:'SRL',teachingRole:'SRL',hours:2},0.60],
 ['Lab Primary',{activityType:'LAB',teachingRole:'Lab Primary',hours:2},0.42],
 ['Lab Secondary',{activityType:'LAB',teachingRole:'Lab Secondary',hours:2},0.38],
 ['Rotation Participant',{roleType:'Rotation Participant',weeks:2},5.00],
 ['Rotation Coordinator',{roleType:'Designated Rotation Coordinator'},2.00],
 ['Undergraduate supervision',{traineeType:'undergraduate',supervisionRole:'supervisor',trainees:2},2.00],
 ['4th Year Preceptor',{traineeType:'fourth_year_preceptor',supervisionRole:'preceptor',trainees:2},1.50],
 ['Graduate Primary',{traineeType:'graduate',supervisionRole:'primary',trainees:2},6.00],
 ['Graduate Co-supervisor',{traineeType:'graduate',supervisionRole:'co_supervisor',trainees:2},4.00],
 ['Postdoc',{traineeType:'postdoc',supervisionRole:'supervisor',trainees:2},3.00],
 ['HICC development',{roleType:'HICC',units:6},12.00],
 ['VISC year 2',{roleType:'VISC',curriculumStage:'year_2'},5.00],
 ['New Faculty capped',{roleType:'New Faculty Career Development',baseValue:12},10.00],
 ['Special Activities capped',{roleType:'Special Activities',baseValue:7},5.00]
];
for(const [name,context,expected] of cases){
 test(`2026-27 guideline rule: ${name}`,()=>assert.equal(calc(context),expected));
}

test('2026-27 guideline course coordination uses fixed unit-band values',()=>{
 for(const [units,expected] of [[2,1.75],[3,3.5],[5,3.5],[6,7],[9,7],[10,10],[14,10],[15,15]]){
  assert.equal(calc({roleType:'Course Coordinator',quantity:units}),expected,`${units} units`);
 }
});

test('every enabled seed rule has a structured reference id and source reference',()=>{
 for(const rule of seed.rules.filter(row=>row.enabled!==false)){
  assert.ok(rule.referenceId,`${rule.ruleKey} missing referenceId`);
  assert.ok(rule.sourceReference,`${rule.ruleKey} missing sourceReference`);
 }
 assert.ok(Array.isArray(seed.references)&&seed.references.length>=3);
});

test('2026-27 seed stores trainee reserve policy parameters in database configuration',()=>{
 assert.deepEqual(seed.version.reservePolicy,{
  strategy:'flexible_teaching_reserve',splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3,referenceId:'wg-6-3-t2',reviewStatus:'confirmed_unchanged'
 });
});
