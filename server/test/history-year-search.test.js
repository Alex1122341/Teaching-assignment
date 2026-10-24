'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createChangeHistoryApi}=require('../src/history/change-history-api');
const {projectHistoryEvent,filterHistoryRows}=require('../src/history/change-history-projection');
const {renderHistoryExport}=require('../src/history/change-history-export');
const F='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const event=(n,year='2026-27')=>({source:'audit',eventId:String(n),eventType:'session_updated',entityType:'session',entityId:F,occurredAtUtc:'2026-10-17T12:00:00Z',actorName:'Avery Admin',beforeJson:{room:'Old room',startTime:'08:30',endTime:'09:30',date:'2026-11-01'},afterJson:{room:n>=150?'Anatomy Wet Lab':'Other room',startTime:'08:30',endTime:'09:30',date:'2026-11-01'},contextJson:{academicYear:year,courseCode:'206',topic:'Spinal Cord',affectedFaculty:[{facultyId:F,displayName:'Synthetic Teacher'}]}});
const auth={scope:'timetable',admin:false,facultyId:F};
test('keyword query passes the actual closed HTTP route and still rejects duplicate keywords',async()=>{
 const {createChangeHistoryFunctions}=require('../src/runtime/swa-change-history-functions');
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'actor'}),findUser:async()=>({baseRole:'faculty',facultyId:F,active:true}),clock:()=>Date.parse('2026-10-18T01:00:00Z'),repository:{list:async()=>[event(150)]}});
 const route=createChangeHistoryFunctions({api}),headers={authorization:'Bearer test'};
 const r=await route(new Request('https://paws.invalid/api/v1/change-history?scope=timetable&academicYear=2026-27&keyword=wet',{headers}));assert.equal(r.status,200);assert.equal(r.jsonBody.total,1);
 assert.equal((await route(new Request('https://paws.invalid/api/v1/change-history?scope=timetable&keyword=a&keyword=b',{headers}))).status,400);
});
test('selected academic year excludes other years even when change dates coincide; keyword searches all matching rows before pagination',async()=>{
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'actor'}),findUser:async()=>({baseRole:'faculty',facultyId:F,active:true}),clock:()=>Date.parse('2026-10-18T01:00:00Z'),repository:{list:async()=>[...Array.from({length:350},(_,i)=>event(i)),event(999,'2025-26')]}});
 const q=await api.query('token',{scope:'timetable',academicYear:'2026-27',keyword:'206 wet avery'});
 assert.equal(q.status,200);assert.equal(q.body.total,200);assert.equal(q.body.rows.length,100);assert.ok(q.body.rows.every(r=>r.academicYear==='2026-27'&&r.updatedValue==='Anatomy Wet Lab'));
 const page=await api.page('token',{snapshot:q.body.snapshot,offset:100});assert.equal(page.status,200);assert.equal(page.body.rows.length,100);assert.ok(page.body.rows.every(r=>!q.body.rows.some(first=>first.rowId===r.rowId)));
 assert.equal(q.body.rows[0].actor,'Avery Admin');
 const exp=await api.export('token',{snapshot:q.body.snapshot,format:'csv'});assert.equal(exp.body.rowCount,200);const csv=Buffer.from(exp.body.fileBase64,'base64').toString();assert.match(csv,/Anatomy Wet Lab/);assert.doesNotMatch(csv,/2025-26/);
 const defaults=await api.query('token',{scope:'timetable'});assert.equal(defaults.body.filters.academicYear,'2026-27');assert.equal(defaults.body.total,350);
});
test('AFC date ranges follow affected academic years rather than audit timestamp and retain zero/false values',()=>{
 const e={source:'audit',eventId:'afc',eventType:'afc_record_created',occurredAtUtc:'2026-10-17T12:00:00Z',afterJson:{facultyId:F,startDate:'2025-04-30',endDate:'2025-05-02',workDays:0,active:false}};
 const rows=projectHistoryEvent(e,{scope:'dashboard',admin:true});
 assert.ok(filterHistoryRows(rows,{academicYear:'2024-25'}).length);assert.ok(filterHistoryRows(rows,{academicYear:'2025-26'}).length);assert.equal(filterHistoryRows(rows,{academicYear:'2026-27'}).length,0);
 assert.equal(rows[0].startDate,'2025-04-30');assert.equal(rows[0].endDate,'2025-05-02');assert.equal(rows.find(r=>r.field==='Work days').updatedValue,'0');
});
test('global Lookup changes use Calgary May boundary, malformed recorded years and secret values never enter search',()=>{
 const base={source:'audit',eventId:'l',eventType:'FacultyUpdated',entityId:F,beforeJson:{rank:'Old',privateSecret:'hidden-value'},afterJson:{rank:'New',privateSecret:'hidden-value'},actorName:'secret@example.invalid'};
 for(const [when,yes,no]of [['2026-05-01T05:59:59Z','2025-26','2026-27'],['2026-05-01T06:00:00Z','2026-27','2025-26']]){
  const rows=projectHistoryEvent({...base,occurredAtUtc:when},{scope:'dashboard',admin:true});assert.ok(filterHistoryRows(rows,{academicYear:yes}).length);assert.equal(filterHistoryRows(rows,{academicYear:no}).length,0);assert.equal(filterHistoryRows(rows,{academicYear:yes,keyword:'hidden-value'}).length,0);assert.equal(filterHistoryRows(rows,{academicYear:yes,keyword:'secret@example.invalid'}).length,0);assert.equal(rows[0].actor,undefined);
 }
 const bad=projectHistoryEvent({...event(1),contextJson:{academicYear:'2026-99'}},auth);assert.equal(filterHistoryRows(bad,{academicYear:'2026-27'}).length,0);
});
test('history export supplies compact-view facts as separately labeled complete columns with missing values N/A',async()=>{
 const file=await renderHistoryExport([{changeDate:'2026-10-17T12:00:00Z',changeType:'session_updated',domain:'Teaching',field:'Room',previousValue:'A',updatedValue:'B',academicYear:'2026-27',startDate:'2026-11-01',endDate:'2026-11-01',startTime:'08:30',endTime:'09:30'}],'csv');
 const csv=file.bytes.toString();assert.match(csv,/'?"Time \(UTC\)","Type","Domain","Course","Session","Field","From","Start","End","To value","By whom","Academic year"/);assert.match(csv,/2026-11-01 08:30/);assert.match(csv,/"N\/A"/);
});

test('default search and year choices cover older retained changes; explicit changed-on dates still narrow results',async()=>{
 const old={...event(150,'2024-25'),occurredAtUtc:'2024-10-01T12:00:00Z'},recent=event(151),calls=[];
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'actor'}),findUser:async()=>({baseRole:'faculty',facultyId:F,active:true}),clock:()=>Date.parse('2026-10-18T01:00:00Z'),repository:{list:async filters=>{calls.push(filters);return [old,recent].filter(e=>e.occurredAtUtc>=filters.start&&e.occurredAtUtc<filters.end);}}});
 const current=await api.query('token',{scope:'timetable'});assert.ok(current.body.facets.academicYears.includes('2024-25'));
 const past=await api.query('token',{scope:'timetable',academicYear:'2024-25',keyword:'wet'});assert.equal(past.body.total,1);assert.equal((await api.export('token',{snapshot:past.body.snapshot,format:'csv'})).body.rowCount,1);
 const narrowed=await api.query('token',{scope:'timetable',academicYear:'2024-25',start:'2026-01-01',end:'2026-12-01'});assert.equal(narrowed.body.total,0);
});

test('year choices include intermediate academic years of retained date ranges',async()=>{
 const range={source:'audit',eventId:'range',eventType:'afc_record_created',occurredAtUtc:'2026-10-20T22:00:00Z',afterJson:{facultyId:F,startDate:'2024-04-30',endDate:'2025-05-01'}};
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'admin'}),findUser:async()=>({baseRole:'owner',active:true}),clock:()=>Date.parse('2026-10-21T01:00:00Z'),repository:{list:async()=>[range]}});
 const q=await api.query('t',{scope:'dashboard'});for(const y of ['2023-24','2024-25','2025-26'])assert.ok(q.body.facets.academicYears.includes(y),y);
});
test('mixed valid/malformed and non-string explicit year evidence cannot produce inferred year rows',()=>{
 const lookup={source:'audit',eventId:'bad-year',eventType:'FacultyUpdated',entityId:F,occurredAtUtc:'2026-10-17T12:00:00Z',beforeJson:{rank:'Old'},afterJson:{rank:'New'}};
 for(const e of [{...event(1),beforeJson:{room:'A',academicYear:'bad'},afterJson:{room:'B',academicYear:'2026-27'}},{...lookup,afterJson:{rank:'New',academicYear:2025}},{...lookup,contextJson:{academicYear:{year:2026}}}])assert.equal(filterHistoryRows(projectHistoryEvent(e,{scope:e.eventType==='FacultyUpdated'?'dashboard':'timetable',admin:true}),{academicYear:'2026-27'}).length,0);
});
