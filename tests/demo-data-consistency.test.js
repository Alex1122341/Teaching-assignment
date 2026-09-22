'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildDataset}=require('../tools/seed/dataset.js');

const PUBLIC_FIELDS=['course','courseName','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructor'];

function docs(){
 const dataset=buildDataset();
 return new Map(dataset.documents.map(row=>[row.path,row.data]));
}

test('every synthetic calendar row matches its canonical session projection',()=>{
 const map=docs();
 const sessions=[...map.entries()].filter(([path])=>path.startsWith('sessions/'));
 assert.ok(sessions.length>0);
 for(const [path,session] of sessions){
  const id=path.slice('sessions/'.length),calendar=map.get('calendar_sessions/'+id);
  assert.ok(calendar,'missing calendar projection for '+id);
  assert.equal(calendar.sessionId,id);
  for(const field of PUBLIC_FIELDS)assert.deepEqual(calendar[field],session[field],id+' '+field);
  assert.deepEqual(calendar.instructorNames,session.instructorNames,id+' instructorNames');
 }
});

test('pending and update-required requests still point at their unchanged base timetable session',()=>{
 const map=docs();
 for(const [path,request] of [...map.entries()].filter(([path])=>path.startsWith('change_requests/'))){
  if(!['pending','update_required'].includes(request.status))continue;
  const session=map.get('sessions/'+request.sessionId);
  assert.ok(session,'missing canonical session for '+path);
  for(const field of PUBLIC_FIELDS)assert.deepEqual(request.basePublic[field],session[field],path+' base '+field);
  const workflow=map.get('change_request_workflow/'+path.split('/')[1]);
  assert.ok(workflow,'missing workflow for '+path);
  assert.equal(workflow.finalType,request.patchPublic.type);
 }
});

test('approved workflow fixture is already applied to canonical session and calendar',()=>{
 const map=docs(),request=map.get('change_requests/req-003');
 assert.equal(request.status,'approved');
 assert.ok(request.appliedAt);
 assert.equal(request.appliedRevision,request.revision);
 const session=map.get('sessions/'+request.sessionId),calendar=map.get('calendar_sessions/'+request.sessionId);
 assert.equal(session.approvalRequestId,'req-003');
 assert.equal(session.approvalRevision,request.revision);
 for(const field of PUBLIC_FIELDS){
  assert.deepEqual(session[field],request.patchPublic[field],field);
  assert.deepEqual(calendar[field],session[field],field+' calendar');
 }
 assert.deepEqual(calendar.instructorNames,session.instructorNames);
 assert.equal(session.facultyIds[0],'fac-003');
 assert.deepEqual(session.assignments.map(row=>row.facultyId),session.facultyIds);
 const privateRecord=map.get('change_request_private/req-003');
 assert.equal(privateRecord.assignmentChange.to.candidateKey,'cand-003');
 assert.ok(privateRecord.assignmentChange.from.facultyId);
 assert.notEqual(privateRecord.assignmentChange.from.facultyId,session.facultyIds[0]);
});

test('update-required serial fixture records ADC push back while LAB remains pending',()=>{
 const map=docs(),request=map.get('change_requests/req-002');
 assert.equal(request.status,'update_required');
 assert.deepEqual(request.editableFields,['date']);
 assert.match(request.requesterMessage,/revise/i);
 assert.equal(map.get('change_request_approvals/req-002_adc').status,'push_back');
 assert.equal(map.get('change_request_approvals/req-002_lab').status,'pending');
});

test('synthetic HICC routed requests use the Firestore-authorized HICC scope',()=>{
 const map=docs();
 for(const [path,row] of [...map.entries()].filter(([path])=>path.startsWith('change_requests/'))){
  assert.equal(row.requestSchema,'office-routing-v1',path+' schema');
  assert.equal(row.requesterRole,'hicc',path+' requester role');
  assert.equal(row.scope,'hicc',path+' scope');
  assert.ok(row.groupId,path+' groupId');
  assert.ok(row.groupName,path+' groupName');
 }
});

test('synthetic approval records use the canonical routed-approval schema',()=>{
 const map=docs();
 for(const [path,row] of [...map.entries()].filter(([path])=>path.startsWith('change_request_approvals/'))){
  const id=path.slice('change_request_approvals/'.length);
  assert.equal(row.id,id,path+' id');
  assert.equal(id,row.requestId+'_'+row.office,path+' document id');
  assert.equal(typeof row.pushBackReason,'string',path+' pushBackReason');
  assert.equal(Object.hasOwn(row,'message'),false,path+' legacy message');
  assert.ok(['pending','approved','push_back','rejected','cancelled'].includes(row.status),path+' status');
 }
});

test('workflow notification display context resolves from its canonical session',()=>{
 const map=docs(),notification=map.get('workflow_notifications/notif-001'),session=map.get('sessions/'+notification.sessionId);
 assert.ok(session);
 assert.equal(notification.requestId,'req-001');
 for(const field of ['course','date','start','end','type','topic'])assert.deepEqual(notification[field],session[field],field);
 assert.equal(notification.facultyDisplayName,session.instructor);
});
