'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyTeachingReserve}=require('../src/doe/reserve-service.js');
const policy={splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3};

test('Workload Guideline Appendix scenario 1 is reproduced',()=>{
 const result=applyTeachingReserve({teachingTarget:15,stream:'research_teaching',rawSupervision:12,assignedTeaching:3,policy});
 assert.equal(result.appliedSupervision,12);assert.equal(result.totalAppliedTeaching,15);
});

test('Workload Guideline Appendix scenario 2 caps supervision at 11 while retaining full supervisory load',()=>{
 const result=applyTeachingReserve({teachingTarget:15,stream:'research_teaching',rawSupervision:20,assignedTeaching:4,policy});
 assert.equal(result.appliedSupervision,11);assert.equal(result.rawSupervision,20);assert.equal(result.unappliedSupervision,9);
});

test('Workload Guideline Appendix scenario 3 remains 27 total when 3 percent is unfilled',()=>{
 const result=applyTeachingReserve({teachingTarget:30,stream:'research_teaching',rawSupervision:17,assignedTeaching:10,policy});
 assert.equal(result.totalAppliedTeaching,27);assert.equal(result.remainingToTarget,3);
});

test('Workload Guideline Appendix scenario 4 exposes five percent remaining and twenty percent assigned-teaching capacity',()=>{
 const result=applyTeachingReserve({teachingTarget:30,stream:'research_teaching',rawSupervision:10,assignedTeaching:15,policy});
 assert.equal(result.maxAssignedTeaching,20);assert.equal(result.remainingToTarget,5);
});

test('Workload Guideline Appendix scenario 5 components leave 45.5 percent exact remaining, displayed as 46 in the source guideline',()=>{
 const assignedComponents=12+12.5+5+2;
 const result=applyTeachingReserve({teachingTarget:80,stream:'teaching_focused',rawSupervision:3,assignedTeaching:assignedComponents,policy});
 assert.equal(assignedComponents,31.5);
 assert.equal(result.appliedSupervision,3);
 assert.equal(result.remainingToTarget,45.5);
 assert.equal(Math.round(result.remainingToTarget),46);
});
