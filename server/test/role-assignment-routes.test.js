'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDoeRoutes}=require('../src/routes/doe-routes.js');

const admin={uid:'g1',role:'adfa_general'};
const faculty={uid:'f1',facultyId:'f1',role:'faculty'};

test('DOE role assignment management routes are admin-only and preserve identifiers',async()=>{
 const calls=[];
 const calculationService={
  calculateAssignment:async()=>({}),
  listRoleAssignments:async input=>{calls.push(['list',input]);return[{assignmentFactId:'role-1'}]},
  deactivateRoleAssignment:async input=>{calls.push(['deactivate',input]);return{assignmentFactId:input.assignmentFactId,active:false}},
  copyRoleAssignmentsYear:async input=>{calls.push(['copy',input]);return{sourceYear:input.sourceYear,targetYear:input.targetYear,copied:3}}
 };
 const routes=createDoeRoutes({calculationService});
 const denied=await routes.handle({method:'GET',path:'/api/doe/faculty/f1/role-assignments',actor:faculty,query:{academicYear:'2027-28'}});
 assert.equal(denied.statusCode,403);
 const listed=await routes.handle({method:'GET',path:'/api/doe/faculty/f1/role-assignments',actor:admin,query:{academicYear:'2027-28'}});
 assert.equal(listed.statusCode,200);
 assert.equal(listed.body[0].assignmentFactId,'role-1');
 const deniedCopy=await routes.handle({method:'POST',path:'/api/doe/role-assignment-years/2027-28/copy-from/2026-27',actor:faculty});
 assert.equal(deniedCopy.statusCode,403);
 const copied=await routes.handle({method:'POST',path:'/api/doe/role-assignment-years/2027-28/copy-from/2026-27',actor:admin});
 assert.equal(copied.statusCode,200);
 assert.equal(copied.body.copied,3);
 const removed=await routes.handle({method:'DELETE',path:'/api/doe/role-assignments/role-1',actor:admin});
 assert.equal(removed.statusCode,200);
 assert.equal(removed.body.active,false);
 assert.equal(calls[0][1].facultyId,'f1');
 assert.equal(calls[0][1].academicYear,'2027-28');
 assert.equal(calls[1][0],'copy');
 assert.equal(calls[1][1].sourceYear,'2026-27');
 assert.equal(calls[1][1].targetYear,'2027-28');
 assert.equal(calls[2][1].assignmentFactId,'role-1');
});
