'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {operationKey,groupDashboardHistory}=require('../src/history/change-history-operations');
const {projectHistoryEvent,filterHistoryRows}=require('../src/history/change-history-projection');
const FACULTY_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FACULTY_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BATCH='11111111-1111-4111-8111-111111111111';
const auth={uid:'operator',role:'adfa_general',admin:true,facultyId:null,scope:'dashboard'};
function afc(i,{facultyId=FACULTY_A,facultyName='Casey Example',batchId=BATCH,source='multi_input',at='2026-10-20T15:10:00Z'}={}){
 const date='2026-11-'+String(10+i).padStart(2,'0');
 return {source:'audit',eventId:'77777777-7777-4777-8777-'+String(i+1).padStart(12,'0'),
  eventType:'afc_record_created',entityType:'afc_record',
  occurredAtUtc:at,actorName:'ADFAD Admin',
  metadataJson:JSON.stringify({source,batchRequestId:batchId,batchRowNumber:i,batchRowCount:5}),
  beforeJson:null,afterJson:JSON.stringify({facultyId,startDate:date,endDate:date,purpose:'University Travel',active:true}),
  contextJson:JSON.stringify({affectedFaculty:[{facultyId,facultyKey:facultyId,displayName:facultyName}]})};
}
const toEntry=(event,viewer=auth)=>({event,rows:projectHistoryEvent(event,viewer)});
test('five AFC rows from one Save form one expandable operation with every audit field intact',()=>{
 const events=Array.from({length:5},(_,i)=>afc(i));
 const groups=groupDashboardHistory(events.map(event=>toEntry(event)));
 assert.equal(groups.length,1);
 assert.equal(groups[0].title,'5 AFC Records Created');
 assert.equal(groups[0].recordCount,5);
 assert.equal(groups[0].records.length,5);
 assert.equal(groups[0].startDate,'2026-11-10');
 assert.equal(groups[0].endDate,'2026-11-14');
 assert.ok(groups[0].records.every(record=>record.changes.some(change=>change.field==='Purpose'&&change.updatedValue==='University Travel')));
 assert.equal(groups[0].changeCount,groups[0].records.reduce((sum,r)=>sum+r.changes.length,0));
 assert.doesNotMatch(JSON.stringify(groups),/batchRequestId|facultyId|actorFirebaseUid/);
});
test('one edited faculty with multiple fields is one operation, not multiple History entries',()=>{
 const event={source:'audit',eventId:'event-1',eventType:'FacultyUpdated',occurredAtUtc:'2026-10-20T15:00:00Z',entityType:'Faculty',entityId:FACULTY_A,
  actorName:'Admin',beforeJson:JSON.stringify({facultyId:FACULTY_A,displayName:'Old',rank:'Instructor',fte:1}),
  afterJson:JSON.stringify({facultyId:FACULTY_A,displayName:'New',rank:'Professor',fte:0.8}),
  contextJson:JSON.stringify({affectedFaculty:[{facultyId:FACULTY_A,displayName:'Faculty A'}]})};
 const groups=groupDashboardHistory([toEntry(event)]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].recordCount,1);
 assert.deepEqual(groups[0].records[0].changes.map(c=>c.field).sort(),['Display name','FTE','Rank']);
});
test('independent submits are not grouped by time, faculty, or event type',()=>{
 const a=afc(0,{source:'single'}),b=afc(1,{source:'single'});
 assert.notEqual(operationKey(a),operationKey(b));
 assert.equal(groupDashboardHistory([toEntry(a),toEntry(b)]).length,2);
 assert.equal(groupDashboardHistory([toEntry(afc(0)),toEntry(afc(1,{batchId:'22222222-2222-4222-8222-222222222222'}))]).length,2);
});
test('invalid and missing batch metadata cannot accidentally combine unrelated audits',()=>{
 const a=afc(0,{batchId:'not-a-uuid'}),b=afc(1,{batchId:'not-a-uuid'});
 assert.equal(groupDashboardHistory([toEntry(a),toEntry(b)]).length,2);
 assert.equal(groupDashboardHistory([toEntry(afc(0,{source:'other'})),toEntry(afc(1,{source:'other'}))]).length,2);
});
test('filtering selects only matching authorized AFC records, then retains all their fields',()=>{
 const first=afc(0),second=afc(1,{facultyId:FACULTY_B,facultyName:'Second Faculty'});
 const selected=[first,second].map(event=>{
  const available=projectHistoryEvent(event,auth);
  const matched=filterHistoryRows(available,{faculty:FACULTY_B,academicYear:'2026-27'});
  return matched.length?{event,rows:available}:null;
 }).filter(Boolean);
 const groups=groupDashboardHistory(selected);
 assert.equal(groups.length,1);assert.equal(groups[0].recordCount,1);
 assert.equal(groups[0].affectedFaculty,'Second Faculty');
 assert.equal(groups[0].records[0].changes.length,projectHistoryEvent(second,auth).length);
});
test('privacy: no unapproved event or field can appear in any operation detail',()=>{
 const another=afc(0,{facultyId:FACULTY_B});
 const viewer={uid:'faculty-user',role:'faculty',facultyId:FACULTY_A,admin:false,scope:'dashboard'};
 const group=groupDashboardHistory([toEntry(another,viewer)]);
 assert.deepEqual(group,[]);
 const own=groupDashboardHistory([toEntry(afc(0),{...viewer})]);
 assert.equal(own.length,1);
 assert.doesNotMatch(JSON.stringify(own),/batchRowCount|metadataJson|FacultyId|uid/);
});

test('a Calendar Activity import projects multiple item rows but remains one Dashboard operation',()=>{
 const audit='11111111-1111-4111-8111-111111111111';
 const events=[1,2,3].map(i=>({
  source:'work',eventId:audit+':22222222-2222-4222-8222-'+String(i).padStart(12,'0'),
  eventType:'calendar_activity_import_committed',occurredAtUtc:'2026-10-20T15:00:00Z',
  actorName:'Admin',facultyId:FACULTY_A,
  afterJson:JSON.stringify({facultyId:FACULTY_A,label:'AFC',category:'away',startDate:'2026-11-11',endDate:'2026-11-12'})
 }));
 assert.equal(groupDashboardHistory(events.map(e=>toEntry(e))).length,1);
 assert.equal(groupDashboardHistory(events.map(e=>toEntry(e)))[0].recordCount,3);
 assert.notEqual(operationKey(events[0]),operationKey({...events[0],eventType:'calendar_activity_time_resolved'}));
});
