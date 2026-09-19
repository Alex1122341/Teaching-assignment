'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildImpactDataset,applyRecalculationRowsToSource}=require('../src/doe/legacy-policy-runtime.js');

test('impact dataset uses persisted DOE evidence and never recreates DOE from client rate times hours',()=>{
  const dataset=buildImpactDataset({
    sessions:[{id:'s1',academicYear:'2027-28',type:'LEC',course:'VTMD 101',assignments:[
      {assignmentId:'a1',facultyId:'f1',role:'Lecture',creditedHours:2,doeCredit:.6,doePolicyVersionId:'v1'},
      {assignmentId:'a2',facultyId:'f2',role:'Lecture',creditedHours:2,doeRate:.3}
    ]}],faculty:[],assignments:[]
  },'2027-28');
  const a1=dataset.calculations.find(row=>row.assignmentId==='a1');
  const a2=dataset.calculations.find(row=>row.assignmentId==='a2');
  assert.equal(a1.currentDoe,.6);
  assert.equal(a2.currentDoe,null);
});

test('impact dataset includes stable annual DOE assignment facts',()=>{
  const dataset=buildImpactDataset({sessions:[],faculty:[],assignments:[{
    assignmentFactId:'role-1',academicYear:'2027-28',facultyId:'f1',category:'role',roleType:'HICC',courseCode:'VTMD 204',doeCredit:12,doePolicyVersionId:'v1'
  }]},'2027-28');
  assert.deepEqual(dataset.calculations.map(row=>[row.sourceEntityType,row.sourceEntityId,row.currentDoe]),[['doe_assignment','role-1',12]]);
});

test('recalculation applies canonical provenance to stable assignment document',()=>{
  const next=applyRecalculationRowsToSource({assignmentFactId:'role-1',facultyId:'f1',doeCredit:12},[{
    sourceEntityType:'doe_assignment',sourceEntityId:'role-1',assignmentId:'role-1',resultDoe:9,policyVersionId:'v2',ruleId:'r2',ruleKey:'role.hicc'
  }],[{calculationId:'calc-2'}]);
  assert.equal(next.doeCredit,9);
  assert.equal(next.doePolicyVersionId,'v2');
  assert.equal(next.doeCalculationId,'calc-2');
});
