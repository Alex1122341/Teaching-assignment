'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyTeachingReserve,rollingAverageCount}=require('../src/doe/reserve-service.js');

const policy={splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3};

test('DOE <=35 starts with equal reserves and supervision expands when assigned teaching is low',()=>{
 const result=applyTeachingReserve({teachingTarget:15,stream:'research_teaching',rawSupervision:12,assignedTeaching:3,policy});
 assert.equal(result.initialTraineeReserve,7.5);
 assert.equal(result.initialAssignedTeachingReserve,7.5);
 assert.equal(result.appliedSupervision,12);
 assert.equal(result.maxAssignedTeaching,3);
 assert.equal(result.totalAppliedTeaching,15);
 assert.equal(result.remainingToTarget,0);
});

test('DOE <=35 caps applied supervision at the target remaining after actual assigned teaching',()=>{
 const result=applyTeachingReserve({teachingTarget:15,stream:'research_teaching',rawSupervision:20,assignedTeaching:4,policy});
 assert.equal(result.appliedSupervision,11);
 assert.equal(result.unappliedSupervision,9);
 assert.equal(result.maxAssignedTeaching,4);
 assert.equal(result.totalAppliedTeaching,15);
});

test('DOE <=35 preserves a real unfilled gap when both supervision and assigned teaching are below target',()=>{
 const result=applyTeachingReserve({teachingTarget:30,stream:'research_teaching',rawSupervision:17,assignedTeaching:10,policy});
 assert.equal(result.appliedSupervision,17);
 assert.equal(result.totalAppliedTeaching,27);
 assert.equal(result.remainingToTarget,3);
});

test('assigned teaching can fill unused trainee reserve',()=>{
 const result=applyTeachingReserve({teachingTarget:30,stream:'research_teaching',rawSupervision:10,assignedTeaching:15,policy});
 assert.equal(result.appliedSupervision,10);
 assert.equal(result.maxAssignedTeaching,20);
 assert.equal(result.remainingToTarget,5);
});

test('DOE above 35 uses the database trainee ceiling',()=>{
 const result=applyTeachingReserve({teachingTarget:40,stream:'research_teaching',rawSupervision:20,assignedTeaching:10,policy});
 assert.equal(result.initialTraineeReserve,15);
 assert.equal(result.appliedSupervision,15);
 assert.equal(result.unappliedSupervision,5);
 assert.equal(result.maxAssignedTeaching,25);
});

test('teaching focused stream uses the database 7.5 ceiling',()=>{
 const result=applyTeachingReserve({teachingTarget:80,stream:'teaching_focused',rawSupervision:3,assignedTeaching:31.5,policy});
 assert.equal(result.initialTraineeReserve,7.5);
 assert.equal(result.appliedSupervision,3);
 assert.equal(result.maxAssignedTeaching,77);
 assert.equal(result.remainingToTarget,45.5);
});

test('graduate supervision uses a full rolling window when available and current count otherwise',()=>{
 assert.equal(rollingAverageCount({currentCount:3,historyCounts:[1,2],years:3}),3);
 assert.equal(rollingAverageCount({currentCount:3,historyCounts:[1,2,3],years:3}),2);
 assert.equal(rollingAverageCount({currentCount:2,historyCounts:[1,2,3,4],years:3}),3);
});

test('reserve calculation fails closed on missing or invalid database policy parameters',()=>{
 assert.throws(()=>applyTeachingReserve({teachingTarget:30,stream:'research_teaching',rawSupervision:5,assignedTeaching:5,policy:{}}),error=>error.code==='RESERVE_POLICY_INVALID');
});
