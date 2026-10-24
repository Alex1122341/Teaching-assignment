'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeAppointmentPeriods,reconcileMasterSource}=require('../src/master-refresh/master-source-domain');
const year='2026-27';
test('missing dates default to inclusive May-April appointment only',()=>{
 assert.deepEqual(normalizeAppointmentPeriods({academicYear:year}).periods,[{startDate:'2026-05-01',endDate:'2027-04-30'}]);
});
test('month-only structured dates use first and last actual day',()=>{
 assert.deepEqual(normalizeAppointmentPeriods({academicYear:year,startCell:'Sep 2026',endCell:'Feb 2027'}).periods,[{startDate:'2026-09-01',endDate:'2027-02-28'}]);
 assert.deepEqual(normalizeAppointmentPeriods({academicYear:'2023-24',endCell:'Feb 2024'}).periods,[{startDate:'2023-05-01',endDate:'2024-02-29'}]);
});
test('ends and restarts produce two ranges preserving the absence gap',()=>{
 assert.deepEqual(normalizeAppointmentPeriods({academicYear:year,roleDateNotes:'Ends Aug 2026. Restarts Mar 2027'}).periods,[{startDate:'2026-05-01',endDate:'2026-08-31'},{startDate:'2027-03-01',endDate:'2027-04-30'}]);
});
test('specific June first start and January year inference follow source meaning',()=>{
 assert.deepEqual(normalizeAppointmentPeriods({academicYear:year,roleDateNotes:'Starts at UCVM June 1'}).periods,[{startDate:'2026-06-01',endDate:'2027-04-30'}]);
 assert.deepEqual(normalizeAppointmentPeriods({academicYear:year,roleDateNotes:'Starts Jan 2027'}).periods,[{startDate:'2027-01-01',endDate:'2027-04-30'}]);
});
test('structured dates are preserved but contradictory role notes block an update',()=>{
 const r=normalizeAppointmentPeriods({academicYear:year,startCell:'2026-06-01',roleDateNotes:'Starts July 2026'});
 assert.equal(r.periods[0].startDate,'2026-06-01');assert.ok(r.issues.includes('DATE_CONFLICT'));
});
test('ordinary leave notes cannot create a role suspension',()=>{
 const r=normalizeAppointmentPeriods({academicYear:year,roleDateNotes:'RSL Sep 2026 - Feb 2027. Full credit retained.'});
 assert.deepEqual(r.periods,[{startDate:'2026-05-01',endDate:'2027-04-30'}]);
});
test('invalid actual date and reversed or overlapping periods are held',()=>{
 for(const input of [{startCell:'2026-02-30'},{startCell:'2026-12-01',endCell:'2026-09-30'},{roleDateNotes:'Ends Aug 2026. Restarts Jul 2026'}])assert.ok(normalizeAppointmentPeriods({academicYear:year,...input}).issues.length);
});
test('unsupported academic years cannot silently select a period',()=>{
 assert.throws(()=>normalizeAppointmentPeriods({academicYear:'2026-28'}),{code:'INVALID_ACADEMIC_YEAR'});
});
test('reconciliation preserves existing DOE mismatch and absent source allocation',()=>{
 const source={academicYear:year,appointments:[{facultyId:'A',roleType:'HICC',scope:'Example',sourceDoe:1},{facultyId:'B',roleType:'VISC',scope:'Area',sourceDoe:null}],cccAllocations:[],rotations:[],trainees:[]};
 const result=reconcileMasterSource(source,{roles:[{roleId:'R1',facultyId:'A',roleType:'HICC',scope:'Example',mappedDoe:2,overrideDoe:null},{roleId:'R2',facultyId:'B',roleType:'VISC',scope:'Area',mappedDoe:5,overrideDoe:0}]});
 assert.equal(result.heldIssues.find(r=>r.roleId==='R1').code,'DOE_MISMATCH');
 assert.equal(result.heldIssues.find(r=>r.roleId==='R2').code,'SOURCE_DOE_MISSING');
 assert.equal(result.operations.some(r=>Object.hasOwn(r,'newDoe')),false);
});
