'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildDataset}=require('../tools/seed/dataset.js');

const PUBLIC_FIELDS=['course','courseName','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructor'];

function mapDocs(){
 const dataset=buildDataset();
 return new Map(dataset.documents.map(row=>[row.path,row.data]));
}

test('every synthetic calendar row is the public projection of its canonical session',()=>{
 const docs=mapDocs();
 const sessions=[...docs.entries()].filter(([path])=>path.startsWith('sessions/'));
 assert.ok(sessions.length>0);
 for(const [path,session] of sessions){
  const id=path.slice('sessions/'.length),calendar=docs.get('calendar_sessions/'+id);
  assert.ok(calendar,'missing calendar projection for '+id);
  assert.equal(calendar.sessionId,id);
  for(const field of PUBLIC_FIELDS)assert.deepEqual(calendar[field],session[field],id+' '+field);
  assert.deepEqual(calendar.instructorNames,session.instructorNames,id+' instructorNames');
 }
});

test('pending and update-required workflow fixtures share their base session with the timetable',()=>{
 const docs=mapDocs();
 for(const [path,request] of [...docs.entries()].filter(([path])=>path.startsWith('change_requests/'))){
  if(!['pending','update_required'].includes(request.status))continue;
  const session=docs.get('sessions/'+request.sessionId);
  assert.ok(session,'missing canonical session for '+path);
  for(const field of PUBLIC_FIELDS)assert.deepEqual(request.basePublic[field],session[field],path+' base '+field);
  const workflow=docs.get('change_request_workflow/'+path.split('/')[1]);
  assert.ok(workflow,'missing workflow for '+path);
  assert.equal(workflow.finalType,request.patchPublic.type);
 }
});

test('applied approval fixture is already reflected in canonical session and calendar',()=>{
 const docs=mapDocs(),request=docs.get('change_requests/req-003');
 assert.equal(request.status,'approved');
 assert.ok(request.appliedAt);
 const session=docs.get('sessions/'+request.sessionId),calendar=docs.get('calendar_sessions/'+request.sessionId);
 for(const field of PUBLIC_FIELDS){
  assert.deepEqual(session[field],request.patchPublic[field],field);
  assert.deepEqual(calendar[field],session[field],field+' calendar');
 }
 assert.deepEqual(session.facultyIds,['fac-001','fac-003']);
 assert.deepEqual(session.assignments.map(row=>row.facultyId),session.facultyIds);
});

test('update-required fixture identifies the returned office without blocking LAB review',()=>{
 const docs=mapDocs(),request=docs.get('change_requests/req-002');
 assert.equal(request.status,'update_required');
 assert.deepEqual(request.editableFields,['date']);
 assert.equal(docs.get('change_request_approvals/req-002_adc').status,'push_back');
 assert.equal(docs.get('change_request_approvals/req-002_lab').status,'pending');
});

test('workflow notifications resolve display context from the canonical session',()=>{
 const docs=mapDocs(),notification=docs.get('workflow_notifications/notif-001'),session=docs.get('sessions/'+notification.sessionId);
 assert.ok(session);
 for(const field of ['course','date','start','end','type','topic'])assert.deepEqual(notification[field],session[field],field);
 assert.equal(notification.facultyDisplayName,session.instructor);
});
