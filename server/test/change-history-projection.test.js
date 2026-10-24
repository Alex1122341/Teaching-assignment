'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {projectHistoryEvent,filterHistoryRows,publicHistoryRow}=require('../src/history/change-history-projection');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const auth={uid:'viewer',role:'faculty',facultyId:A,admin:false,scope:'timetable'};
test('trainee refresh and recovery history is own/admin annual Lookup evidence, with no raw private notes',()=>{
 for(const eventType of ['trainee_source_refreshed','trainee_source_recovered']){
  const e={source:'audit',eventId:'trainee',eventType,entityType:'faculty',entityId:A,occurredAtUtc:'2026-10-19T12:00:00Z',actorName:'Example Admin',beforeJson:JSON.stringify({facultyId:A,displayName:'Recorded Faculty',academicYear:'2025-26',counts:[0,0,3,0,0,0,0],sourceDoe:1}),afterJson:JSON.stringify({facultyId:A,displayName:'Recorded Faculty',academicYear:'2025-26',counts:[0,null,4,0,0,0,0],sourceDoe:null,allocationStatus:'source_missing',privateNotes:'PRIVATE STUDENT',email:'private@example.test'}),metadataJson:'{"operatorLogin":"PRIVATE LOGIN"}'};
  const rows=projectHistoryEvent(e,{...auth,scope:'dashboard'});assert.ok(rows.length>=3);assert.ok(rows.every(r=>r.domain==='Lookup'&&r.academicYear==='2025-26'&&r.affectedFaculty==='Recorded Faculty'));
  assert.ok(rows.some(r=>r.field==='Fourth-year preceptor'&&r.updatedValue==='4'));
  assert.doesNotMatch(JSON.stringify(rows.map(publicHistoryRow)),/PRIVATE|private@example/);
  assert.equal(filterHistoryRows(rows,{academicYear:'2026-27'}).length,0);assert.equal(filterHistoryRows(rows,{academicYear:'2025-26'}).length,rows.length);
  assert.equal(projectHistoryEvent(e,{...auth,scope:'dashboard',facultyId:B}).length,0);assert.ok(projectHistoryEvent(e,{...auth,scope:'dashboard',facultyId:B,admin:true}).length);assert.equal(projectHistoryEvent(e,{...auth,scope:'timetable',admin:true}).length,0);
 }
});
test('uploaded AFC document history is admin-only safe metadata, never PDF bytes or approval',()=>{
 const e={eventId:'upload',occurredAtUtc:'2026-10-17T12:00:00Z',source:'audit',eventType:'afc_form_uploaded',entityType:'afc_form',entityId:B,afterJson:JSON.stringify({facultyId:A,fileName:'Form.pdf',pageCount:2,byteLength:200,pdfBytes:'SECRET',status:'approved'})};
 const rows=projectHistoryEvent(e,{...auth,scope:'dashboard',admin:true});assert.ok(rows.length);assert.match(JSON.stringify(rows),/Form.pdf/);assert.doesNotMatch(JSON.stringify(rows),/SECRET|approved/);assert.equal(projectHistoryEvent(e,{...auth,scope:'dashboard'}).length,0);
});
const event=(extra={})=>({source:'audit',eventId:A,eventType:'session_updated',entityType:'session',entityId:B,occurredAtUtc:'2026-10-16T14:00:00.000Z',beforeJson:JSON.stringify({courseCode:'201',topic:'Old topic',room:'A',academicYear:'2026-27'}),afterJson:JSON.stringify({courseCode:'206',topic:'New topic',room:'B',notes:'private-notes',email:'private-email',doeCredit:999}),contextJson:JSON.stringify({courseCode:'206',topic:'New topic',academicYear:'2026-27',affectedFaculty:[{facultyId:B,facultyKey:'opaque-b',displayName:'Teacher B'}]}),actorName:'Admin',...extra});
test('public teaching history is across faculty and a closed field projection',()=>{
 const rows=projectHistoryEvent(event(),auth);assert.equal(rows.length,3);
 assert.equal(rows.find(r=>r.field==='Room').previousValue,'A');
 const json=JSON.stringify(rows.map(publicHistoryRow));assert.doesNotMatch(json,/private|999|actorName|facultyId|opaque-b/);assert.match(json,/Teacher B/);
});
test('my teaching history follows recorded affected membership rather than actor',()=>{
 assert.equal(projectHistoryEvent(event(),{...auth,scope:'mine'}).length,0);
 assert.ok(projectHistoryEvent(event({actorFirebaseUid:'someone-else',contextJson:JSON.stringify({affectedFaculty:[{facultyId:A,displayName:'A'}]})}),{...auth,scope:'mine'}).length);
});
test('removed faculty is affected by before assignment snapshot and private DOE is stripped',()=>{
 const e=event({eventType:'session_assignments_replaced',beforeJson:JSON.stringify([{facultyId:A,sourceFacultyName:'Removed',teachingRole:'Lead',doeCredit:999,notes:'private'}]),afterJson:JSON.stringify([{facultyId:B,sourceFacultyName:'Replacement',teachingRole:'Lead'}])});
 const rows=projectHistoryEvent(e,{...auth,scope:'mine'});assert.equal(rows.length,1);assert.match(rows[0].previousValue,/Removed/);assert.match(rows[0].updatedValue,/Replacement/);assert.doesNotMatch(JSON.stringify(rows.map(publicHistoryRow)),/999|private|facultyId/);
});
test('legacy time edits without recorded membership do not guess my involvement',()=>{
 assert.equal(projectHistoryEvent(event({contextJson:null}),{...auth,scope:'mine'}).length,0);
 assert.ok(projectHistoryEvent(event({contextJson:null}),auth).length);
});
test('AFC details are only own or administrator dashboard history, never public or mine',()=>{
 const e=event({eventType:'afc_record_cancelled',entityType:'afc_record',beforeJson:JSON.stringify({FacultyId:B,ReasonCode:'medical',Notes:'private-medical',Active:true}),afterJson:JSON.stringify({FacultyId:B,ReasonCode:'medical',Notes:'private-medical',Active:false})});
 for(const scope of ['timetable','mine','dashboard'])assert.equal(projectHistoryEvent(e,{...auth,scope}).length,0);
 assert.ok(projectHistoryEvent(e,{...auth,scope:'dashboard',facultyId:B}).length);
 assert.ok(projectHistoryEvent(e,{...auth,scope:'dashboard',admin:true}).length);
});
test('Lookup history keeps own fields and rejects another person and office privilege escalation',()=>{
 const e=event({eventType:'FacultyUpdated',entityType:'Faculty',entityId:A,beforeJson:'{"rank":"Old","email":"own-before","password":"secret"}',afterJson:'{"rank":"New","email":"own-after","password":"secret-new"}'});
 assert.equal(projectHistoryEvent(e,{...auth,scope:'dashboard'}).length,2);
 assert.equal(projectHistoryEvent(e,{...auth,scope:'dashboard',facultyId:B,role:'adc'}).length,0);
 assert.doesNotMatch(JSON.stringify(projectHistoryEvent(e,{...auth,scope:'dashboard'})),/secret/);
});
test('faculty sees published policy public fields and recorded operator name, never drafts or private exceptions',()=>{
 const e=event({source:'doe',eventType:'published',entityType:'doe_policy_version',beforeJson:'{}',afterJson:JSON.stringify({revision:2,ruleBook:{rules:[{ruleKey:'lecture',ruleLabel:'Lecture',formulaText:'hours*rate',parameters:[{name:'rate',valueNumber:2}]}],exceptions:[{facultyId:B,reason:'private-exception',fixedDoe:999}]}})});
 const rows=projectHistoryEvent(e,{...auth,scope:'dashboard'});assert.ok(rows.length);assert.match(JSON.stringify(rows),/Lecture/);assert.doesNotMatch(JSON.stringify(rows.map(publicHistoryRow)),/private|999/);assert.equal(rows[0].actor,'Admin');
 assert.equal(projectHistoryEvent({...e,eventType:'draft_updated'},{...auth,scope:'dashboard'}).length,0);
 assert.equal(projectHistoryEvent(e,auth).length,0);
});
test('unknown event and malformed audit JSON fail closed and do not expose raw strings',()=>{
 assert.deepEqual(projectHistoryEvent(event({eventType:'account_audit',afterJson:'{"password":"secret"}'}),auth),[]);
 assert.doesNotMatch(JSON.stringify(projectHistoryEvent(event({beforeJson:'secret raw SQL',afterJson:'bad-json',contextJson:null}),auth)),/secret|SQL|bad-json/);
});
test('course/topic filters match old and new and never infer VISC or academic year',()=>{
 const rows=projectHistoryEvent(event(),auth);
 for(const course of ['201','206'])assert.equal(filterHistoryRows(rows,{course}).length,rows.length);
 for(const topic of ['Old','New'])assert.equal(filterHistoryRows(rows,{topic}).length,rows.length);
 assert.equal(filterHistoryRows(rows,{faculty:'opaque-b'}).length,rows.length);
 assert.equal(filterHistoryRows(rows,{viscSubject:'Anatomy'}).length,0);
 assert.equal(filterHistoryRows(rows,{viscSubject:'__not_recorded__'}).length,rows.length);
 assert.equal(filterHistoryRows(rows,{academicYear:'2026-27'}).length,rows.length);
 assert.equal(projectHistoryEvent(event({beforeJson:'{"room":"A"}',afterJson:'{"room":"B"}',contextJson:null}),auth)[0].academicYear,null);
});
test('actor fields are only actually recorded admin names and not email/UID fallback',()=>{
 const row=projectHistoryEvent(event(),{...auth,admin:true})[0];assert.equal(publicHistoryRow(row).actor,'Admin');
 assert.equal(publicHistoryRow(projectHistoryEvent(event({actorName:null,actorFirebaseUid:'secret-uid'}),{...auth,admin:true})[0]).actor,undefined);
});
test('Dashboard includes own recorded manual/target DOE changes, but no other faculty values',()=>{
 const e=event({source:'doe',eventType:'manual_doe_updated',entityType:'manual_doe_assignment',facultyId:A,beforeJson:'{"DoeValue":1,"Notes":"Own note"}',afterJson:'{"DoeValue":2,"Notes":"New own note"}',contextJson:null});
 const rows=projectHistoryEvent(e,{...auth,scope:'dashboard'});assert.equal(rows.length,2);assert.match(JSON.stringify(rows),/New own note/);
 assert.equal(projectHistoryEvent({...e,facultyId:B},{...auth,scope:'dashboard'}).length,0);assert.equal(projectHistoryEvent(e,auth).length,0);
});
test('own migrated working schedule uses exact source evidence without AFC recovery payload',()=>{
 const e=event({source:'work',eventType:'calendar_activity_import_committed',entityType:'calendar_activity',beforeJson:null,afterJson:JSON.stringify({facultyId:A,label:'CCC Day',startDate:'2026-10-16',endDate:'2026-10-17',category:'ccc'}),contextJson:null});
 assert.ok(projectHistoryEvent(e,{...auth,scope:'mine'}).length);assert.equal(projectHistoryEvent(e,auth).length,0);assert.equal(projectHistoryEvent(e,{...auth,scope:'mine',facultyId:B}).length,0);
});
test('legacy AFC approval and recommendation use recorded metadata ownership only',()=>{
 for(const type of ['afc_request_approved','afc_request_recommended']){
  const e=event({eventType:type,entityType:'afc_request',beforeJson:'{"status":"pending_admin"}',afterJson:'{"status":"approved"}',contextJson:null,metadataJson:JSON.stringify({facultyId:A,assignedReportToFirebaseUid:'private-supervisor'})});
  assert.equal(projectHistoryEvent(e,{...auth,scope:'dashboard'}).length,1);
  assert.equal(projectHistoryEvent(e,{...auth,scope:'dashboard',facultyId:B}).length,0);
  assert.equal(projectHistoryEvent(e,auth).length,0);
  assert.doesNotMatch(JSON.stringify(projectHistoryEvent(e,{...auth,scope:'dashboard'})),/private-supervisor/);
 }
});
test('Rule Book mapping-only and reference-link-only edits retain exact before/after evidence for admins',()=>{
 const oldBook={rules:[{ruleKey:'lecture',referenceId:A}],courseMappings:[{mappingId:A,courseCode:'206',mappingFactsJson:'{"aliases":["old"]}',referenceId:A}],subjectMappings:[{mappingId:B,subjectKey:'anatomy',subjectName:'Anatomy',mappingFactsJson:'{"subjectCount":1}'}]};
 const next=structuredClone(oldBook);next.rules[0].referenceId=B;next.courseMappings[0].mappingFactsJson='{"aliases":["new"]}';next.subjectMappings[0].mappingFactsJson='{"subjectCount":2}';
 const e=event({source:'doe',eventType:'draft_updated',entityType:'doe_policy_version',beforeJson:JSON.stringify({ruleBook:oldBook}),afterJson:JSON.stringify({ruleBook:next})});
 const rows=projectHistoryEvent(e,{...auth,admin:true,scope:'dashboard'});assert.equal(rows.length,3);assert.match(rows.find(row=>row.field==='Rule lecture').updatedValue,new RegExp(B));
 assert.match(rows.find(row=>row.field.startsWith('courseMappings')).previousValue,/old/);assert.match(rows.find(row=>row.field.startsWith('subjectMappings')).updatedValue,/subjectCount.*2/);
});
test('same-title references remain distinct and their notes/links are preserved only for admin history',()=>{
 const oldBook={references:[{referenceId:A,title:'Guidelines',section:'Teaching',notes:'private-ref-old',documentLink:'old-link'},{referenceId:B,title:'Guidelines',section:'Research',notes:'private-ref-other',documentLink:'other-link'}]};
 const next=structuredClone(oldBook);next.references[0].notes='private-ref-new';next.references[0].documentLink='new-link';
 const e=event({source:'doe',eventType:'draft_updated',entityType:'doe_policy_version',beforeJson:JSON.stringify({ruleBook:oldBook}),afterJson:JSON.stringify({ruleBook:next})});
 const rows=projectHistoryEvent(e,{...auth,admin:true,scope:'dashboard'});assert.equal(rows.length,1);assert.match(rows[0].previousValue,/private-ref-old/);assert.match(rows[0].updatedValue,/new-link/);
 const publicRows=projectHistoryEvent({...e,eventType:'published',beforeJson:JSON.stringify({publishedRuleBook:oldBook})},{...auth,scope:'dashboard'});
 assert.doesNotMatch(JSON.stringify(publicRows),/private-ref/);assert.match(JSON.stringify(publicRows),/new-link/);
});
test('working recovery is removal and recorded time changes stay private and affect the true owner',()=>{
 const range={facultyId:A,label:'CCC Day',startDate:'2026-10-16',endDate:'2026-10-17',category:'ccc'};
 const recovery=event({source:'work',eventType:'calendar_activity_import_recovered',entityType:'calendar_activity',beforeJson:null,afterJson:JSON.stringify(range),contextJson:null});
 const removed=projectHistoryEvent(recovery,{...auth,scope:'mine'}).find(row=>row.field==='Start date');assert.equal(removed.previousValue,'2026-10-16');assert.equal(removed.updatedValue,'—');assert.equal(removed.status,'Removed');
 const time=event({source:'work',eventType:'calendar_activity_time_resolved',entityType:'calendar_activity',beforeJson:null,afterJson:JSON.stringify({facultyId:A,label:'CCC Day',date:'2026-10-16',startTime:'09:00',endTime:'10:00'}),contextJson:null});
 const timed=projectHistoryEvent(time,{...auth,scope:'mine'});assert.equal(timed.find(row=>row.field==='Start time').updatedValue,'09:00');assert.equal(timed.find(row=>row.field==='Start time').previousValue,'Not recorded');
 for(const e of [recovery,time]){assert.equal(projectHistoryEvent(e,{...auth,facultyId:B,scope:'mine'}).length,0);assert.equal(projectHistoryEvent(e,auth).length,0);assert.ok(projectHistoryEvent(e,{...auth,admin:true,scope:'dashboard'}).length);}
 assert.equal(projectHistoryEvent({...time,afterJson:null,metadataJson:'{"activityDate":"2026-10-16"}'},{...auth,scope:'mine'}).length,0);
 assert.equal(projectHistoryEvent({...time,eventType:'unknown_work_event'},{...auth,admin:true,scope:'dashboard'}).length,0);
});
test('opaque faculty filtering resolves proven legacy IDs without inventing membership or historical names',()=>{
 const directoryFacultyJson=JSON.stringify([{facultyId:A,facultyKey:'key-a',displayName:'Current A'},{facultyId:B,facultyKey:'key-b',displayName:'Current B'}]);
 const e=event({eventType:'session_assignments_replaced',beforeJson:JSON.stringify([{facultyId:A,teachingRole:'Lead'}]),afterJson:'[]',contextJson:null,directoryFacultyJson});
 const rows=projectHistoryEvent(e,{...auth,scope:'mine'});assert.equal(rows.length,1);assert.equal(filterHistoryRows(rows,{faculty:'key-a'}).length,1);assert.equal(filterHistoryRows(rows,{faculty:'key-b'}).length,0);
 assert.doesNotMatch(JSON.stringify(rows.map(publicHistoryRow)),/Current A|Current B/);assert.match(rows[0]._facultyOptions[0].name,/current directory/);
 const unproven=event({beforeJson:'{"room":"A"}',afterJson:'{"room":"B"}',contextJson:null,directoryFacultyJson});assert.equal(projectHistoryEvent(unproven,{...auth,scope:'mine'}).length,0);
 const privateEvent=event({eventType:'afc_request_approved',beforeJson:'{"status":"pending_admin"}',afterJson:'{"status":"approved"}',contextJson:null,metadataJson:JSON.stringify({facultyId:A}),directoryFacultyJson});
 assert.equal(filterHistoryRows(projectHistoryEvent(privateEvent,{...auth,scope:'dashboard'}),{faculty:'key-a'}).length,1);
 assert.equal(projectHistoryEvent(privateEvent,{...auth,scope:'dashboard',facultyId:B}).length,0);
});
test('CCC whole replacement records private added/removed history for the affected faculty only',()=>{
 const activity={facultyId:A,label:'CCC',category:'ccc',startDate:'2026-11-02',endDate:'2026-11-04',recoveryJson:'PRIVATE'};
 for(const added of [true,false]){const e=event({source:'work',eventType:added?'ccc_activity_added':'ccc_activity_removed',entityType:'calendar_activity',beforeJson:added?null:JSON.stringify(activity),afterJson:added?JSON.stringify(activity):null,contextJson:null});
  const rows=projectHistoryEvent(e,{...auth,scope:'mine'});assert.ok(rows.length);assert.equal(rows[0].status,added?'Added':'Removed');assert.doesNotMatch(JSON.stringify(rows),/PRIVATE/);assert.equal(projectHistoryEvent(e,{...auth,facultyId:B,scope:'mine'}).length,0);assert.equal(projectHistoryEvent(e,auth).length,0);assert.ok(projectHistoryEvent(e,{...auth,admin:true,scope:'dashboard'}).length);
 }
});
