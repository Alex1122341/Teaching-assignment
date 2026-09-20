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
  deactivateRoleAssignment:async input=>{calls.push(['deactivate',input]);return{assignmentFactId:input.assignmentFactId,active:false}}
 };
 const routes=createDoeRoutes({calculationService});
 const denied=await routes.handle({method:'GET',path:'/api/doe/faculty/f1/role-assignments',actor:faculty,query:{academicYear:'2027-28'}});
 assert.equal(denied.statusCode,403);
 const listed=await routes.handle({method:'GET',path:'/api/doe/faculty/f1/role-assignments',actor:admin,query:{academicYear:'2027-28'}});
 assert.equal(listed.statusCode,200);
 assert.equal(listed.body[0].assignmentFactId,'role-1');
 const removed=await routes.handle({method:'DELETE',path:'/api/doe/role-assignments/role-1',actor:admin});
 assert.equal(removed.statusCode,200);
 assert.equal(removed.body.active,false);
 assert.equal(calls[0][1].facultyId,'f1');
 assert.equal(calls[0][1].academicYear,'2027-28');
 assert.equal(calls[1][1].assignmentFactId,'role-1');
});
