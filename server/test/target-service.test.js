'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTargetService}=require('../src/doe/target-service.js');
const general={uid:'g1',name:'General',role:'adfa_general'};
const regular={uid:'r1',name:'Regular',role:'adfa_regular'};
const facultyActor={uid:'f1',role:'faculty'};
function repo(){
 const saved=[];
 return{
  saved,
  async getFacultyRecord(id){return id==='f1'?{facultyId:'f1',doe:{teaching:40}}:null},
  async getActivePolicyBundle(){return{version:{policyVersionId:'v1'}}},
  async saveFacultyTarget(payload){saved.push(structuredClone(payload));return payload.target}
 };
}
test('target save derives contract and effective target server-side',async()=>{
 const repository=repo(),service=createTargetService({repository,clock:()=>new Date('2027-07-01T00:00:00Z')});
 const row=await service.saveFacultyTarget({actor:regular,facultyId:'f1',academicYear:'2027-28',override:{value:25,reason:'RSL',notes:'Approved'}});
 assert.equal(row.contractTeachingDoe,40);
 assert.equal(row.overrideDoe,25);
 assert.equal(row.effectiveTargetDoe,25);
 assert.equal(row.policyVersionId,'v1');
 assert.equal(repository.saved[0].auditRecord.action,'faculty_doe_target_saved');
});
test('target save rejects non-admin and override without reason',async()=>{
 const service=createTargetService({repository:repo()});
 await assert.rejects(()=>service.saveFacultyTarget({actor:facultyActor,facultyId:'f1',academicYear:'2027-28',override:null}),e=>e.code==='FORBIDDEN');
 await assert.rejects(()=>service.saveFacultyTarget({actor:general,facultyId:'f1',academicYear:'2027-28',override:{value:25,reason:''}}),e=>e.code==='DOE_TARGET_OVERRIDE_INVALID');
});
