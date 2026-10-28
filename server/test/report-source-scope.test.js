'use strict';
const {createSqlDashboardRepository}=require('../src/data/sql-dashboard-repository');
require('node:test')('report roster preserves already canonical fallback names through the shared formatter',async()=>{
 const assert=require('node:assert/strict'),names=require('../src/domain/person-name');let query;
 const repository=createSqlDashboardRepository({query:async sql=>{query=sql;return [{facultyId:'one',displayName:/REPLACE\(CASE/.test(sql)?'Example Alex':'Example, Alex',preferredFirstName:null,preferredLastName:null,active:true}];}});
 const [row]=await repository.reportFaculty();assert.equal(names.format(row),'Example, Alex');assert.match(query,/f\.DisplayName AS displayName/);
});
require('node:test')('report roster reads beyond the ordinary two-hundred-row page without identity/contact fields',async()=>{
 const assert=require('node:assert/strict');let observed;
 const repository=createSqlDashboardRepository({query:async(sql,params)=>{observed={sql,params};return Array.from({length:201},(_,i)=>({facultyId:'id'+i,preferredFirstName:'Alex',preferredLastName:'Example',active:true,fte:0}));}});
 const rows=await repository.reportFaculty();assert.equal(rows.length,201);assert.equal(observed.params.limit,10001);assert.doesNotMatch(observed.sql,/Email|Ucid|ReportsTo|Afc|JointAppointment/);assert.equal(rows[0].fte,0);
});
const test=require('node:test'),assert=require('node:assert/strict');
const {createSqlSessionRepository}=require('../src/data/sql-session-repository');
test('report session reads bind academic year and retain undated records without changing existing range callers',async()=>{
 const calls=[],repository=createSqlSessionRepository({query:async(sql,params)=>{calls.push({sql,params});return [];}});
 await repository.list({academicYear:'2026-2027',includeAssignmentTargets:true});assert.match(calls[0].sql,/c\.AcademicYear\s*=\s*@academicYear/);assert.equal(calls[0].params.academicYear,'2026-27');assert.doesNotMatch(calls[0].sql,/c\.SessionDate >= @start/);assert.match(calls[0].sql,/AS assignmentsJson/);
 await assert.rejects(repository.list({academicYear:'2026-28'}),{code:'INVALID_ACADEMIC_YEAR'});assert.equal(calls.length,1);
 await repository.list({start:'2026-10-01',end:'2026-11-01'});assert.deepEqual(calls[1].params,{start:'2026-10-01',end:'2026-11-01'});assert.doesNotMatch(calls[1].sql,/c\.AcademicYear\s*=\s*@academicYear/);
 await repository.list({academicYear:'2026-27',includeAssignmentTargets:true,includeUnresolvedAssignmentLabels:true});assert.match(calls[2].sql,/sa\.SourceFacultyName AS sourceFacultyName/);assert.doesNotMatch(calls[2].sql,/WHERE sa\.SessionId = c\.SessionId AND sa\.FacultyId IS NOT NULL/);
});
