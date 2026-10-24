'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createDoeWorkflowPreviewService}=require('../src/doe/doe-workflow-preview-service');

function fixture({calculationStatus='calculated',outWorksheetStatus='calculated',incomingWorksheetStatus='calculated',incomingAlreadyAssigned=false}={}){
  const loaded={
    sessionId:'session-1',academicYear:'2026-27',curriculumYear:'Year 2',courseCode:'VET 201',
    sessionType:'Lecture',topic:'Anatomy',sessionDate:'2026-10-07',startTime:'09:00:00',endTime:'10:00:00',
    assignments:[
      {sessionAssignmentId:'assignment-1',facultyId:'faculty-out',teachingRole:'Lecture',creditedHours:1},
      ...(incomingAlreadyAssigned?[{sessionAssignmentId:'assignment-2',facultyId:'faculty-in',teachingRole:'Lecture',creditedHours:1}]:[])
    ]
  };
  const current={
    'faculty-out':{status:outWorksheetStatus,academicYear:'2026-27',policyVersionId:'policy-1',totals:{assignedTeachingDoe:15,effectiveTargetDoe:20,remainingDoe:5},lines:[{sourceEntityType:'session_assignment',sourceEntityId:'assignment-1',resultDoe:2,status:'calculated'}]},
    'faculty-in':{status:incomingWorksheetStatus,academicYear:'2026-27',policyVersionId:'policy-1',totals:{assignedTeachingDoe:10,effectiveTargetDoe:20,remainingDoe:10},lines:[]}
  };
  const projected=[];
  const repository={loadSessionDoeFacts:async id=>id==='session-1'?loaded:null};
  const worksheetService={
    buildFacultyWorksheet:async({facultyId})=>current[facultyId]||{status:'not_found',totals:{assignedTeachingDoe:null,effectiveTargetDoe:null,remainingDoe:null},lines:[]},
    previewFacultyWorksheet:async({facultyId,removeSourceEntityId,addLine})=>{
      projected.push({facultyId,removeSourceEntityId,addLine});
      const base=current[facultyId];
      if(!base)return{status:'not_found',totals:{assignedTeachingDoe:null,effectiveTargetDoe:null,remainingDoe:null},lines:[]};
      const total=base.totals.assignedTeachingDoe+(removeSourceEntityId?-2:(addLine?.resultDoe||0));
      return{...base,totals:{...base.totals,assignedTeachingDoe:total,remainingDoe:base.totals.effectiveTargetDoe-total}};
    }
  };
  const calculationService={preview:async({academicYear,facts})=>{
    assert.equal(academicYear,'2026-27');
    assert.equal(facts.facultyId,'faculty-in');
    assert.equal(facts.courseCode,'VET 201');
    assert.equal(facts.hours,1);
    return calculationStatus==='calculated'
      ?{status:'calculated',resultDoe:2,policyVersionId:'policy-1',ruleId:'rule-1',ruleKey:'lecture'}
      :{status:'needs_review',resultDoe:null,policyVersionId:'policy-1'};
  }};
  return{service:createDoeWorkflowPreviewService({repository,worksheetService,calculationService}),projected};
}

test('faculty transfer preview uses SQL session facts and server-calculated DOE, without persisting evidence',async()=>{
  const {service,projected}=fixture();
  const result=await service.previewFacultyTransfer({sessionId:'session-1',outgoingFacultyId:'faculty-out',incomingFacultyId:'faculty-in'});
  assert.equal(result.status,'calculated');
  assert.equal(result.sessionDoeCredit,2);
  assert.equal(result.outgoing.current.totals.assignedTeachingDoe,15);
  assert.equal(result.outgoing.projected.totals.assignedTeachingDoe,13);
  assert.equal(result.incoming.current.totals.assignedTeachingDoe,10);
  assert.equal(result.incoming.projected.totals.assignedTeachingDoe,12);
  assert.equal(result.evidencePersisted,false);
  assert.equal(projected.length,2);
  assert.equal(projected[0].removeSourceEntityId,'assignment-1');
  assert.equal(projected[1].addLine.resultDoe,2);
});

test('faculty transfer preview fails closed when policy calculation needs review',async()=>{
  const {service}=fixture({calculationStatus:'needs_review'});
  const result=await service.previewFacultyTransfer({sessionId:'session-1',outgoingFacultyId:'faculty-out',incomingFacultyId:'faculty-in'});
  assert.equal(result.status,'needs_review');
  assert.equal(result.sessionDoeCredit,null);
  assert.equal(result.outgoing.projected.totals.assignedTeachingDoe,null);
  assert.equal(result.incoming.projected.totals.assignedTeachingDoe,null);
  assert.ok(result.issueCodes.includes('NEEDS_REVIEW'));
});

test('faculty transfer preview fails closed when either current worksheet is not calculated',async()=>{
  const {service}=fixture({incomingWorksheetStatus:'needs_review'});
  const result=await service.previewFacultyTransfer({sessionId:'session-1',outgoingFacultyId:'faculty-out',incomingFacultyId:'faculty-in'});
  assert.equal(result.status,'needs_review');
  assert.equal(result.incoming.projected.totals.assignedTeachingDoe,null);
});

test('faculty transfer preview rejects unknown, ambiguous, same-faculty, and already-assigned transfers',async()=>{
  const {service}=fixture({incomingAlreadyAssigned:true});
  await assert.rejects(service.previewFacultyTransfer({sessionId:'missing',outgoingFacultyId:'faculty-out',incomingFacultyId:'faculty-in'}),{code:'SESSION_NOT_FOUND'});
  await assert.rejects(service.previewFacultyTransfer({sessionId:'session-1',outgoingFacultyId:'faculty-out',incomingFacultyId:'faculty-out'}),{code:'FACULTY_TRANSFER_INVALID'});
  await assert.rejects(service.previewFacultyTransfer({sessionId:'session-1',outgoingFacultyId:'faculty-out',incomingFacultyId:'faculty-in'}),{code:'FACULTY_ALREADY_ASSIGNED'});
});
