'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createWorkflowPreviewService}=require('../src/doe/workflow-preview-service.js');

const general={uid:'g1',name:'General',role:'adfa_general'};
function fixture(){
  const session={id:'s1',academicYear:'2027-28',date:'2027-09-10',semester:'fall',course:'VTMD 505',type:'LAB',start:'09:00',end:'12:00',assignments:[
    {assignmentId:'a1',facultyId:'f1',ucid:'f1',name:'Outgoing',role:'Lab Primary',creditedHours:3,doeCredit:.63,doePolicyVersionId:'v1',doeRuleId:'lab',doeRuleKey:'teaching.lab.primary',doeCalculationId:'old-calc'}
  ]};
  const repository={
    getSession:async id=>id==='s1'?structuredClone(session):null,
    getActivePolicyBundle:async()=>({rules:[{category:'teaching',enabled:true,selectors:[{field:'activityType'},{field:'teachingRole'}],inputs:[{inputName:'hours'}]}],exceptions:[{enabled:true,facultyId:'f2'}]})
  };
  const calculationService={calculateAssignment:async ({facts})=>({status:'calculated',resultDoe:facts.facultyId==='f2'?.57:.63,policyVersionId:'v2',ruleId:'lab',ruleKey:'teaching.lab.primary',calculationText:'3 × rate',reference:{referenceId:'r1'}})};
  const worksheetService={buildFacultyWorksheet:async({facultyId})=>({facultyId,status:'calculated',totals:{assignedTeachingDoe:facultyId==='f1'?20:10,effectiveTargetDoe:40,remainingDoe:facultyId==='f1'?20:30}})};
  return{repository,calculationService,worksheetService,session};
}

test('faculty transfer preview loads the canonical session and returns server-projected worksheets',async()=>{
  const deps=fixture(),service=createWorkflowPreviewService(deps);
  const result=await service.previewFacultyTransfer({actor:general,academicYear:'2027-28',sessionId:'s1',assignmentId:'a1',incomingFacultyId:'f2'});
  assert.equal(result.sessionDoeCredit,.63);
  assert.equal(result.incomingDoeCredit,.57);
  assert.equal(result.outgoing.currentAssignedDoe,20);
  assert.equal(result.outgoing.projectedAssignedDoe,19.37);
  assert.equal(result.incoming.currentAssignedDoe,10);
  assert.equal(result.incoming.projectedAssignedDoe,10.57);
});

test('faculty transfer preview ignores a client-provided DOE override',async()=>{
  const deps=fixture(),service=createWorkflowPreviewService(deps);
  const result=await service.previewFacultyTransfer({actor:general,academicYear:'2027-28',sessionId:'s1',assignmentId:'a1',incomingFacultyId:'f2',doeCredit:99});
  assert.equal(result.incomingDoeCredit,.57);
});

test('session save persists only server-prepared DOE and evidence',async()=>{
  const deps=fixture(),writes=[];
  deps.repository.saveSessionCalculationBundle=async payload=>{writes.push(payload);return payload.session};
  deps.calculationService.prepareAssignmentCalculation=async({facts})=>({
    calculation:{status:'calculated',resultDoe:.57,policyVersionId:'v2',ruleId:'lab',ruleKey:'teaching.lab.primary',calculationId:'calc-save',calculatedAt:'2026-09-19T18:00:00Z'},
    calculationRecord:{calculationId:'calc-save',academicYear:'2027-28',facultyId:facts.facultyId,resultDoe:.57,policyVersionId:'v2',ruleId:'lab',ruleKey:'teaching.lab.primary'}
  });
  deps.repository.getActivePolicyBundle=async()=>({rules:[{category:'teaching',enabled:true,selectors:[{field:'activityType'},{field:'teachingRole'}],inputs:[{inputName:'hours'}]}],exceptions:[{enabled:true,facultyId:'f2'}]});
  const service=createWorkflowPreviewService(deps),after=structuredClone(deps.session);
  after.assignments[0]={...after.assignments[0],facultyId:'f2',ucid:'f2',doeCredit:99};
  const result=await service.saveSessionChange({actor:general,academicYear:'2027-28',sessionId:'s1',afterSession:after,trigger:'session_updated'});
  assert.equal(result.session.assignments[0].doeCredit,.57);
  assert.equal(writes.length,1);
  assert.equal(writes[0].session.assignments[0].doeCredit,.57);
  assert.equal(writes[0].calculationRecords[0].calculationId,'calc-save');
});

test('session save can create a new canonical session from server-calculated assignment facts',async()=>{
  const deps=fixture(),writes=[];
  deps.repository.getSession=async()=>null;
  deps.repository.saveSessionCalculationBundle=async payload=>{writes.push(payload);return payload.session};
  deps.calculationService.prepareAssignmentCalculation=async({facts})=>({
    calculation:{status:'calculated',resultDoe:.42,policyVersionId:'v2',ruleId:'lab',ruleKey:'teaching.lab.primary',calculationId:'calc-new'},
    calculationRecord:{calculationId:'calc-new',academicYear:'2027-28',facultyId:facts.facultyId,resultDoe:.42,policyVersionId:'v2',ruleId:'lab',ruleKey:'teaching.lab.primary'}
  });
  const service=createWorkflowPreviewService(deps);
  const after={id:'new-1',academicYear:'2027-28',date:'2027-09-11',semester:'fall',course:'VTMD 505',type:'LAB',start:'09:00',end:'11:00',assignments:[{facultyId:'f1',ucid:'f1',name:'Faculty',role:'Lab Primary',doeCredit:99}]};
  const result=await service.saveSessionChange({actor:general,academicYear:'2027-28',sessionId:'new-1',afterSession:after,trigger:'session_created'});
  assert.equal(result.session.assignments[0].doeCredit,.42);
  assert.equal(writes.length,1);
  assert.equal(writes[0].session.sessionId,'new-1');
});

test('non-faculty assignment is persisted without client DOE fields or fabricated calculation evidence',async()=>{
  const deps=fixture(),writes=[];
  deps.repository.saveSessionCalculationBundle=async payload=>{writes.push(payload);return payload.session};
  const service=createWorkflowPreviewService(deps),after=structuredClone(deps.session);
  after.assignments[0]={assignmentId:'a1',name:'Sessional Person',category:'Sessional',role:'Lab Primary',doeCredit:99,doePolicyVersionId:'evil'};
  const result=await service.saveSessionChange({actor:general,academicYear:'2027-28',sessionId:'s1',afterSession:after,trigger:'faculty_transfer'});
  assert.equal(result.session.assignments[0].doeCredit,undefined);
  assert.equal(result.session.assignments[0].doePolicyVersionId,undefined);
  assert.equal(result.calculationRecords.length,0);
  assert.equal(writes[0].calculationRecords.length,0);
});
