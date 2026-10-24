'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {resolveRoleDoe}=require('../src/domain/doe-calculator');
const {createSqlDashboardRepository}=require('../src/data/sql-dashboard-repository');
const {createSqlDoeWorksheetRepository}=require('../src/data/sql-doe-worksheet-repository');
test('new source-missing role cannot receive a catalog inferred credit',()=>{
 const result=resolveRoleDoe({academicYear:'2026-27',roleType:'VISC',courseOrSubjectOrRotation:'Example Area',sourceAllocationStatus:'source_missing',doeMappedValue:null,doeOverrideValue:null});
 assert.equal(result.effectiveDoe,null);assert.equal(result.calculatedDoe,null);assert.equal(result.reviewReason,'source-allocation-missing');
});
test('source missing never erases an existing explicit zero override',()=>{
 const result=resolveRoleDoe({academicYear:'2026-27',roleType:'VISC',courseOrSubjectOrRotation:'Example Area',sourceAllocationStatus:'source_missing',doeMappedValue:5,doeOverrideValue:0});
 assert.equal(result.effectiveDoe,0);
});
test('dashboard roles carries allocation status into the calculation',async()=>{
 const db={query:async(sql)=>sql.includes('FROM paws.RoleAssignment r LEFT JOIN')?[{roleAssignmentId:'11111111-1111-1111-1111-111111111111',roleType:'VISC',academicYear:'2026-27',sourceAllocationStatus:'source_missing',doeMappedValue:null,doeOverrideValue:null}]:[]};
 const roles=await createSqlDashboardRepository(db).roles({academicYear:'2026-27'});
 assert.equal(roles[0].effectiveDoe,null);assert.equal(roles[0].doeReviewReason,'source-allocation-missing');
});
test('worksheet retains missing source allocation instead of catalog credit',async()=>{
 const db={query:async(sql)=>{
  if(sql.includes('FROM paws.Faculty AS f'))return[{facultyId:'faculty-1',displayName:'Example Faculty'}];
  if(sql.includes('FROM paws.RoleAssignment AS r'))return[{facultyId:'faculty-1',roleAssignmentId:'role-1',roleType:'VISC',academicYear:'2026-27',sourceAllocationStatus:'source_missing',doeMappedValue:null,doeOverrideValue:null}];
  return[];
 }};
 const source=await createSqlDoeWorksheetRepository(db).getFacultyWorksheetSource('faculty-1','2026-27');
 const row=source.lines.find(r=>r.sourceEntityId==='role-1');
 assert.equal(row.resultDoe,null);assert.equal(row.reviewReason,'source-allocation-missing');
 assert.equal(row.facts.sourceAllocationStatus,'source_missing');
});
