'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const responsibility=require('../teaching-responsibility.js');
const academic=require('../academic-responsibility.js');

const hicc=()=>responsibility.createResponsibility({
 id:'hicc-vtmd204',kind:'hicc',groupId:'year-2',label:'VTMD 204 HICC',
 academicScopeTokens:['hicc|VTMD 204|*']
});

test('stable responsibility keeps one package identity while Bill and Lisa rotate',()=>{
 const r=hicc();
 const packageId=responsibility.submissionDocumentId('2026-27',r.groupId,r.id);
 assert.equal(packageId,responsibility.submissionDocumentId('2026-27',r.groupId,r.id));
 assert.doesNotMatch(packageId,/bill|lisa/i);
 const lisa=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'lisa',facultyId:'f-lisa',windows:[{activeDate:'2026-09-01',expirationDate:'2027-03-01',sourceDoeAssignmentFactId:'doe-lisa'}]});
 const bill=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'bill',facultyId:'f-bill',windows:[{activeDate:'2027-03-01',expirationDate:'2027-05-01',sourceDoeAssignmentFactId:'doe-bill'}]});
 responsibility.validateResponsibilitySchedule(r,[lisa,bill]);
 assert.equal(responsibility.effectiveAssignee([lisa,bill],'2027-02-28').assigneeUid,'lisa');
 assert.equal(responsibility.effectiveAssignee([lisa,bill],'2027-03-01').assigneeUid,'bill');
});

test('one assignee may return later in the same year using multiple non-overlapping windows',()=>{
 const r=hicc();
 const bill=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'bill',windows:[
  {activeDate:'2026-09-01',expirationDate:'2026-10-01'},
  {activeDate:'2027-03-01',expirationDate:'2027-05-01'}
 ]});
 assert.equal(responsibility.scheduleActiveAt(bill,'2026-09-15'),true);
 assert.equal(responsibility.scheduleActiveAt(bill,'2026-10-01'),false);
 assert.equal(responsibility.scheduleActiveAt(bill,'2027-03-01'),true);
});

test('overlapping assignees fail closed but adjacent half-open windows are valid',()=>{
 const r=hicc(),bill=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'bill',windows:[{activeDate:'2026-09-01',expirationDate:'2027-03-01'}]});
 const lisaOverlap=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'lisa',windows:[{activeDate:'2027-02-28',expirationDate:'2027-05-01'}]});
 assert.throws(()=>responsibility.validateResponsibilitySchedule(r,[bill,lisaOverlap]),/overlapping effective assignees/i);
 const lisaAdjacent=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'lisa',windows:[{activeDate:'2027-03-01',expirationDate:'2027-05-01'}]});
 assert.doesNotThrow(()=>responsibility.validateResponsibilitySchedule(r,[bill,lisaAdjacent]));
});

test('HICC scope belongs to the stable responsibility, not the temporary assignee profile',()=>{
 const profile=responsibility.scopeProfile(hicc());
 assert.equal(academic.hasScope(profile,'hicc',{course:'VTMD 204',subjectKey:'surgery'}),true);
 assert.equal(academic.hasScope(profile,'hicc',{course:'VTMD 205',subjectKey:'surgery'}),false);
});

test('VISC responsibility is group leadership and carries no HICC Course Subject tokens',()=>{
 const visc=responsibility.createResponsibility({id:'visc-year-2',kind:'visc',groupId:'year-2',label:'Year 2 VISC'});
 assert.deepEqual(visc.academicScopeTokens,[]);
 assert.equal(responsibility.scopeProfile(visc).role,'visc');
});

test('assignee Firestore path is directly resolvable from responsibility year and authenticated UID',()=>{
 assert.equal(responsibility.assigneePath('hicc-vtmd204','2026-27','uid-lisa'),'teaching_responsibilities/hicc-vtmd204/years/2026-27/assignees/uid-lisa');
});

test('VISC responsibility may be reused by multiple explicitly configured groups',()=>{
 const visc=responsibility.createResponsibility({id:'visc-shared',kind:'visc',label:'Shared VISC'});
 assert.equal(visc.groupId,'');
 assert.deepEqual(visc.academicScopeTokens,[]);
});
