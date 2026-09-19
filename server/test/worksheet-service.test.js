'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createWorksheetService}=require('../src/doe/worksheet-service.js');

const reservePolicy={splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3,referenceId:'wg-6-3-t2'};
function source(){return{
 facultyId:'f1',academicYear:'2027-28',displayName:'Dr Example',stream:'research_teaching',
 target:{contractTeachingDoe:40,effectiveTargetDoe:40,source:'contract'},reservePolicy,
 lines:[
  {lineId:'lecture-1',category:'teaching',label:'VTMD 301 Lecture',quantity:2,quantityUnit:'hours',calculationText:'2 × 0.30%',resultDoe:.6,policyVersionId:'v-old',ruleId:'r-lecture',ruleKey:'teaching.lecture.standard',calculationId:'c-1',reference:{title:'UCVM Workload Guidelines',section:'6.2',table:'Table 1',page:3},status:'calculated'},
  {lineId:'hicc-1',category:'role',label:'HICC · VTMD 204',quantity:6,quantityUnit:'units',calculationText:'6 × 2.00%',resultDoe:12,policyVersionId:'v-old',ruleId:'r-hicc',ruleKey:'role.hicc.development',calculationId:'c-2',reference:{title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5},status:'calculated'},
  {lineId:'grad-1',category:'supervision',label:'Graduate Primary',quantity:2,quantityUnit:'trainees',calculationText:'2 × 3.00%',resultDoe:6,policyVersionId:'v-old',ruleId:'r-grad',ruleKey:'supervision.graduate.primary',calculationId:'c-3',reference:{title:'UCVM Workload Guidelines',section:'6.3',table:'Table 2',page:4},status:'calculated'},
  {lineId:'adj-1',category:'adjustment',label:'Approved Teaching Exception',resultDoe:1,policyVersionId:'v-old',exceptionId:'e1',calculationId:'c-4',reference:{title:'Dean approval'},status:'approved_exception'}
 ]
};}
function repo(current=source()){
 return{
  async getFacultyWorksheetSource(facultyId,academicYear){assert.equal(facultyId,'f1');assert.equal(academicYear,'2027-28');return structuredClone(current)},
  async listFacultyIdsForDoe(){return['f1']}
 };
}

test('worksheet totals persisted DOE lines and applies reserve once',async()=>{
 const service=createWorksheetService({repository:repo()});
 const worksheet=await service.buildFacultyWorksheet({facultyId:'f1',academicYear:'2027-28'});
 assert.equal(worksheet.status,'calculated');
 assert.equal(worksheet.sections.scheduledTeaching.subtotal,.6);
 assert.equal(worksheet.sections.roles.subtotal,12);
 assert.equal(worksheet.sections.supervision.rawSubtotal,6);
 assert.equal(worksheet.sections.supervision.appliedSubtotal,6);
 assert.equal(worksheet.sections.adjustments.subtotal,1);
 assert.equal(worksheet.totals.assignedTeachingDoe,19.6);
 assert.equal(worksheet.totals.effectiveTargetDoe,40);
 assert.equal(worksheet.totals.remainingDoe,20.4);
 assert.equal(worksheet.lines[1].calculationId,'c-2');
 assert.equal(worksheet.lines[1].reference.page,5);
});

test('worksheet fails closed when a canonical DOE line is missing',async()=>{
 const current=source();delete current.lines[0].resultDoe;current.lines[0].status='needs_review';
 const worksheet=await createWorksheetService({repository:repo(current)}).buildFacultyWorksheet({facultyId:'f1',academicYear:'2027-28'});
 assert.equal(worksheet.status,'needs_review');
 assert.equal(worksheet.totals.assignedTeachingDoe,null);
 assert.ok(worksheet.errors.some(error=>error.code==='DOE_LINE_UNAVAILABLE'));
});

test('historical persisted result does not drift when a later active policy changes',async()=>{
 const current=source();
 const service=createWorksheetService({repository:repo(current),activePolicyProvider:async()=>({policyVersionId:'v-new',lectureRate:.9})});
 const worksheet=await service.buildFacultyWorksheet({facultyId:'f1',academicYear:'2027-28'});
 assert.equal(worksheet.lines[0].resultDoe,.6);
 assert.equal(worksheet.lines[0].policyVersionId,'v-old');
 assert.equal(worksheet.lines[0].calculationId,'c-1');
});

test('DOE list summaries are built from the same worksheet contract',async()=>{
 const service=createWorksheetService({repository:repo()});
 const list=await service.listFacultyDoe({academicYear:'2027-28'});
 assert.equal(list.length,1);
 assert.equal(list[0].facultyId,'f1');
 assert.equal(list[0].assignedTeachingDoe,19.6);
 assert.equal(list[0].remainingDoe,20.4);
});


test('worksheet fails closed when canonical lines span policy versions',async()=>{
 const current=source();
 current.lines[1].policyVersionId='v-other';
 current.policyStatus='mixed';
 current.reservePolicy=null;
 const worksheet=await createWorksheetService({repository:repo(current)}).buildFacultyWorksheet({facultyId:'f1',academicYear:'2027-28'});
 assert.equal(worksheet.status,'needs_review');
 assert.equal(worksheet.totals.assignedTeachingDoe,null);
 assert.ok(worksheet.errors.some(error=>error.code==='MIXED_POLICY_VERSIONS'));
});


test('DOE list uses one bulk worksheet-source load instead of N repeated source scans',async()=>{
 let bulkCalls=0,singleCalls=0;
 const first=source(),second={...source(),facultyId:'f2',displayName:'Dr Two'};
 const repository={
  async getFacultyWorksheetSource(){singleCalls++;return structuredClone(first)},
  async listFacultyWorksheetSources(academicYear){bulkCalls++;assert.equal(academicYear,'2027-28');return[structuredClone(first),structuredClone(second)]}
 };
 const list=await createWorksheetService({repository}).listFacultyDoe({academicYear:'2027-28'});
 assert.equal(bulkCalls,1);
 assert.equal(singleCalls,0);
 assert.deepEqual(list.map(row=>row.facultyId),['f1','f2']);
});
