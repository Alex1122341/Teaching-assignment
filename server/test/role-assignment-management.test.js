'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCalculationService}=require('../src/doe/calculation-service.js');

const admin={uid:'g1',name:'General',email:'g@example.test',role:'adfa_general'};
const engine={matchRule(){return{source:'rule',rule:{}}},calculate(){return{resultDoe:1,policyVersionId:'v1',ruleId:'r1',ruleKey:'role.test',inputs:{},parameters:{},ruleSnapshot:{}}}};

test('role assignment management lists active faculty facts and deactivates with audit',async()=>{
 const calls=[];
 const rows=[
  {assignmentFactId:'role-1',academicYear:'2027-28',facultyId:'f1',category:'role',roleType:'HICC',courseCode:'VTMD 204',active:true},
  {assignmentFactId:'role-old',academicYear:'2027-28',facultyId:'f1',category:'role',roleType:'VISC',subjectKey:'anatomy',active:false}
 ];
 const repository={
  async getActivePolicyBundle(){return{rules:[],exceptions:[]}},
  async listFacultyRoleAssignments(facultyId,academicYear){calls.push(['list',facultyId,academicYear]);return rows.filter(row=>row.active!==false)},
  async getDoeAssignment(id){calls.push(['get',id]);return rows.find(row=>row.assignmentFactId===id)||null},
  async deactivateDoeAssignment(input){calls.push(['deactivate',input]);const row=rows.find(item=>item.assignmentFactId===input.assignmentFactId);row.active=false;return{...row}}
 };
 const service=createCalculationService({repository,engine,clock:()=>new Date('2026-09-20T01:00:00Z'),auditIdFactory:()=> 'audit-1'});
 const list=await service.listRoleAssignments({actor:admin,facultyId:'f1',academicYear:'2027-28'});
 assert.deepEqual(list.map(row=>row.assignmentFactId),['role-1']);
 const removed=await service.deactivateRoleAssignment({actor:admin,assignmentFactId:'role-1'});
 assert.equal(removed.active,false);
 const write=calls.find(row=>row[0]==='deactivate')[1];
 assert.equal(write.auditRecord.action,'doe_assignment_deactivated');
 assert.equal(write.auditRecord.auditId,'audit-1');
 assert.equal(write.auditRecord.changedBy,'g1');
});

test('role assignment management refuses non-role deactivation and non-admin access',async()=>{
 const repository={
  async getActivePolicyBundle(){return{rules:[],exceptions:[]}},
  async listFacultyRoleAssignments(){return[]},
  async getDoeAssignment(){return{assignmentFactId:'a1',category:'teaching',active:true}},
  async deactivateDoeAssignment(){throw Error('must not write')}
 };
 const service=createCalculationService({repository,engine});
 await assert.rejects(()=>service.listRoleAssignments({actor:{role:'faculty'},facultyId:'f1',academicYear:'2027-28'}),error=>error.code==='FORBIDDEN');
 await assert.rejects(()=>service.deactivateRoleAssignment({actor:admin,assignmentFactId:'a1'}),error=>error.code==='ASSIGNMENT_NOT_ROLE');
});
