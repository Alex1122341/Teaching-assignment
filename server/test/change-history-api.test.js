'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createChangeHistoryApi}=require('../src/history/change-history-api');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function harness({count=202}={}){
 let now=Date.parse('2026-10-16T12:00:00Z'),calls=0,serial=0;
 let profile={active:true,mustChangePassword:false,baseRole:'faculty',facultyId:A};
 let events=Array.from({length:count},(_,i)=>({source:'audit',eventId:String(i),eventType:'session_updated',entityType:'session',entityId:A,occurredAtUtc:'2026-10-16T10:00:00Z',beforeJson:'{"room":"Old"}',afterJson:JSON.stringify({room:'New '+i}),contextJson:JSON.stringify({academicYear:'2026-27',affectedFaculty:[{facultyId:A,displayName:'Teacher'}]})}));
 const api=createChangeHistoryApi({verifyToken:async token=>{if(token==='bad')throw Error('private');return token?{uid:token}:null;},findUser:async()=>profile,repository:{list:async()=>{calls++;return events;}},clock:()=>now,randomId:()=>String(++serial).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
 return {api,calls:()=>calls,setProfile:p=>profile=p,advance:ms=>now+=ms,mutate:()=>events=[],now:()=>now};
}
test('authentication/profile denial precedes all reads and fixed errors reveal no internals',async()=>{
 const h=harness();for(const token of ['',null,'bad'])assert.equal((await h.api.query(token,{scope:'mine'})).status,401);
 for(const profile of [null,{active:false,baseRole:'faculty'},{active:true,baseRole:'faculty'},{active:true,baseRole:'owner',mustChangePassword:true},{active:true,baseRole:'other_office'}]){h.setProfile(profile);assert.equal((await h.api.query('a',{scope:'mine'})).status,403);}
 assert.equal(h.calls(),0);
});
test('closed filters reject spoofing, arrays, impossible dates, duplicate route values and invalid formats',async()=>{
 const h=harness();for(const query of [{scope:'evil'},{scope:'mine',actorFirebaseUid:'spoof'},{scope:'mine',course:['206']},{scope:'mine',start:'2026-02-30',end:'2026-03-10'},{scope:'mine',start:'2026-11-01',end:'2026-10-01'},{scope:'mine',faculty:'raw-id'},{scope:'mine',academicYear:'wrong'}])assert.equal((await h.api.query('a',query)).status,400);
 assert.equal(h.calls(),0);
});
test('all filtered records belong to a stable snapshot across pages and both real exports',async()=>{
 const h=harness(),q=await h.api.query('a',{scope:'mine'});assert.equal(q.status,200);assert.equal(q.body.total,202);assert.equal(q.body.rows.length,100);
 h.mutate();const page=await h.api.page('a',{snapshot:q.body.snapshot,offset:100});assert.equal(page.status,200);assert.equal(page.body.rows.length,100);assert.equal(h.calls(),1);
 for(const format of ['csv','xlsx']){const out=await h.api.export('a',{snapshot:q.body.snapshot,format});assert.equal(out.status,200);assert.equal(out.body.rowCount,202);assert.ok(out.body.fileBase64);}
 assert.equal(h.calls(),1);
});
test('handles reject a different actor, changed role/link, inactive identity and expiry',async()=>{
 for(const change of ['actor','role','link','inactive','expiry']){
  const h=harness(),q=await h.api.query('a',{scope:'mine'});let token='a';
  if(change==='actor')token='b';if(change==='role')h.setProfile({active:true,baseRole:'owner',facultyId:A});if(change==='link')h.setProfile({active:true,baseRole:'faculty',facultyId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});if(change==='inactive')h.setProfile({active:false,baseRole:'faculty',facultyId:A});if(change==='expiry')h.advance(600001);
  assert.ok([403,409].includes((await h.api.export(token,{snapshot:q.body.snapshot,format:'csv'})).status));
 }
});
test('snapshot retention evicts oldest after two queries per actor and rejects offset/format injection',async()=>{
 const h=harness(),one=await h.api.query('a',{scope:'mine'});await h.api.query('a',{scope:'mine'});await h.api.query('a',{scope:'mine'});
 assert.equal((await h.api.page('a',{snapshot:one.body.snapshot,offset:0})).status,409);
 const q=await h.api.query('a',{scope:'mine'});
 for(const offset of [-1,'01','1.5',101,999999])assert.equal((await h.api.page('a',{snapshot:q.body.snapshot,offset})).status,400);
 assert.equal((await h.api.export('a',{snapshot:q.body.snapshot,format:'pdf'})).status,400);
 assert.equal((await h.api.export('a',{snapshot:q.body.snapshot,format:'csv',actor:'spoof'})).status,400);
});
test('unlinked admin gets explicit My History error, not all-admin data',async()=>{
 const h=harness();h.setProfile({active:true,baseRole:'owner'});assert.equal((await h.api.query('a',{scope:'mine'})).status,403);assert.equal(h.calls(),0);
 assert.equal((await h.api.query('a',{scope:'timetable'})).status,200);
});
test('more than the bounded row set is rejected rather than silently truncated',async()=>{
 const h=harness({count:10001});const q=await h.api.query('a',{scope:'mine'});assert.equal(q.status,413);assert.equal(q.body.error.code,'HISTORY_LIMIT');assert.equal(q.body.rows,undefined);
});
test('query revalidates identity after asynchronous SQL read before releasing rows',async()=>{
 let profile={active:true,baseRole:'faculty',facultyId:A};
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'a'}),findUser:async()=>profile,repository:{list:async()=>{profile={active:false,baseRole:'faculty',facultyId:A};return [];}}});
 assert.equal((await api.query('a',{scope:'mine'})).status,403);
});

test('Dashboard AFC multi-input is one authorized operation, including all fields after keyword filtering',async()=>{
 const request='11111111-1111-4111-8111-111111111111',facultyId=A;
 const events=Array.from({length:5},(_,i)=>{
  const day=String(9+i).padStart(2,'0');
  return {source:'audit',eventId:'77777777-7777-4777-8777-'+String(i+1).padStart(12,'0'),eventType:'afc_record_created',
   entityType:'afc_record',entityId:'88888888-8888-4888-8888-'+String(i+1).padStart(12,'0'),occurredAtUtc:'2026-10-20T22:00:00Z',
   actorName:'Recorded Admin',metadataJson:JSON.stringify({source:'multi_input',batchRequestId:request,batchRowNumber:i,batchRowCount:5}),
   beforeJson:null,afterJson:JSON.stringify({facultyId,startDate:'2026-11-'+day,endDate:'2026-11-'+day,purpose:'University Travel',active:true}),
   contextJson:JSON.stringify({affectedFaculty:[{facultyId,facultyKey:facultyId,displayName:'Faculty A'}]})};
 });
 let queries=0;
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'admin'}),findUser:async()=>({active:true,mustChangePassword:false,baseRole:'adfa_general'}),repository:{list:async()=>{queries++;return events;}}});
 const q=await api.query('valid',{scope:'dashboard',academicYear:'2026-27',keyword:'University Travel'});
 assert.equal(q.status,200);
 assert.equal(q.body.total,1);
 assert.equal(q.body.rows[0].recordCount,5);
 assert.equal(q.body.rows[0].title,'5 AFC Records Created');
 assert.equal(q.body.rows[0].records.length,5);
 assert.ok(q.body.rows[0].records.every(record=>record.changes.some(c=>c.field==='Start date')&&record.changes.some(c=>c.field==='Purpose')));
 assert.doesNotMatch(JSON.stringify(q.body.rows),/batchRequestId|entityId|firebaseUid/i);
 const exported=await api.export('valid',{snapshot:q.body.snapshot,format:'csv'});
 assert.equal(exported.status,200);
 assert.equal(exported.body.rowCount,1);
 assert.match(Buffer.from(exported.body.fileBase64,'base64').toString('utf8'),/5 AFC Records Created/);
 assert.equal(queries,1);
});
test('Dashboard grouped results never disclose other faculty details after scope filtering',async()=>{
 const events=[A,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',A].map((facultyId,i)=>({
  source:'audit',eventId:'e'+i,eventType:'afc_record_created',entityType:'afc_record',occurredAtUtc:'2026-10-20T22:00:00Z',
  metadataJson:JSON.stringify({source:'multi_input',batchRequestId:'11111111-1111-4111-8111-111111111111',batchRowNumber:i,batchRowCount:3}),
  beforeJson:null,afterJson:JSON.stringify({facultyId,startDate:'2026-11-11',endDate:'2026-11-12',purpose:'Vacation',active:true}),
  contextJson:JSON.stringify({affectedFaculty:[{facultyId,facultyKey:facultyId,displayName:facultyId===A?'Faculty A':'Private B'}]})
 }));
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'faculty'}),findUser:async()=>({active:true,mustChangePassword:false,baseRole:'faculty',facultyId:A}),repository:{list:async()=>events}});
 const q=await api.query('valid',{scope:'dashboard',academicYear:'2026-27'});
 assert.equal(q.status,200);
 assert.equal(q.body.total,1);
 assert.equal(q.body.rows[0].recordCount,2);
 assert.doesNotMatch(JSON.stringify(q.body.rows),/Private B|bbbbbbbb/);
 const ex=await api.export('valid',{snapshot:q.body.snapshot,format:'csv'});
 assert.equal(ex.status,200);
 assert.doesNotMatch(Buffer.from(ex.body.fileBase64,'base64').toString('utf8'),/Private B|bbbbbbbb/);
});

test('Dashboard pagination counts complete operations instead of individual changed fields',async()=>{
 const events=Array.from({length:101},(_,i)=>({
  source:'audit',eventId:'event-'+i,eventType:'afc_record_created',entityType:'afc_record',
  occurredAtUtc:'2026-10-20T22:00:00Z',afterJson:JSON.stringify({facultyId:A,startDate:'2026-11-09',endDate:'2026-11-09',purpose:'Vacation',active:true}),
  contextJson:JSON.stringify({affectedFaculty:[{facultyId:A,displayName:'Faculty A'}]})
 }));
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'admin'}),findUser:async()=>({active:true,mustChangePassword:false,baseRole:'adfa_general'}),repository:{list:async()=>events}});
 const first=await api.query('valid',{scope:'dashboard',academicYear:'2026-27'});
 assert.equal(first.status,200);
 assert.equal(first.body.total,101);
 assert.equal(first.body.rows.length,100);
 assert.ok(first.body.rows.every(row=>row.recordCount===1&&row.changeCount>=3));
 const second=await api.page('valid',{snapshot:first.body.snapshot,offset:100});
 assert.equal(second.status,200);
 assert.equal(second.body.rows.length,1);
 assert.equal(second.body.rows[0].recordCount,1);
});

test('restored Dashboard displays pre-reset source audits, grouped by operation and all academic years',async()=>{
 const {DASHBOARD_HISTORY_ARCHIVE_START_UTC:floor}=require('../src/history/change-history-api');
 const fid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const event=(key,changedAt,workDate)=>({source:'audit',eventId:key,eventType:'afc_record_created',entityType:'afc_record',
  occurredAtUtc:changedAt,actorName:'Recorded Admin',
  afterJson:JSON.stringify({facultyId:fid,startDate:workDate,endDate:workDate,purpose:'Vacation',active:true}),
  contextJson:JSON.stringify({affectedFaculty:[{facultyId:fid,displayName:'Faculty A'}]})});
 const source=[event('excluded','2026-10-04T23:59:59.999Z','2026-11-10'),
  event('first',floor,'2026-11-10'),
  event('restored','2026-10-16T12:00:00Z','2025-04-20'),
  event('future','2026-10-20T22:00:00Z','2026-11-10'),
  event('invalid','not-a-date','2026-11-10')];
 let lastArgs;
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'admin'}),
  findUser:async()=>({active:true,baseRole:'adfa_general'}),
  repository:{list:async params=>{lastArgs=params;return source;}},
  clock:()=>Date.parse('2026-10-21T12:00:00Z')});
 const q=await api.query('token',{scope:'dashboard',start:'2019-01-01',end:'9999-12-31'});
 assert.equal(q.status,200);
 assert.equal(q.body.filters.academicYear,'all');
 assert.equal(q.body.historyArchiveStartUtc,floor);
 assert.equal(lastArgs.startUtc,floor);
 assert.equal(lastArgs.endUtc,'2026-10-22T00:00:00.000Z');
 assert.equal(q.body.total,3);
 assert.ok(q.body.rows.some(row=>row.changeDate.startsWith('2026-10-16')));
 assert.ok(q.body.rows.every(row=>row.recordCount===1&&row.changeCount>=3));
 assert.ok(q.body.facets.academicYears.includes('2024-25'));
 assert.match(q.body.coverage[0],/historical dashboard operations are restored/i);
 for(const format of ['csv','xlsx']){
  const e=await api.export('token',{snapshot:q.body.snapshot,format});
  assert.equal(e.status,200);assert.equal(e.body.rowCount,3);
  assert.ok(e.body.fileBase64.length>50);
 }
 const selected=await api.query('token',{scope:'dashboard',academicYear:'2024-25'});
 assert.equal(selected.status,200);assert.equal(selected.body.total,1);
 assert.match(selected.body.rows[0].changeDate,/2026-10-16/);
 const narrow=await api.query('token',{scope:'dashboard',start:'2026-10-20'});
 assert.equal(narrow.status,200);assert.equal(narrow.body.total,1);
 assert.equal(lastArgs.startUtc,'2026-10-20T00:00:00.000Z');
});
test('Dashboard filters entirely before archive bounds produce an authorized empty snapshot without SQL',async()=>{
 let calls=0;
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'admin'}),
  findUser:async()=>({active:true,baseRole:'adfa_general'}),
  repository:{list:async()=>{calls++;return [];}},
  clock:()=>Date.parse('2026-10-21T12:00:00Z')});
 const q=await api.query('token',{scope:'dashboard',start:'2026-01-01',end:'2026-10-05'});
 assert.equal(q.status,200);assert.equal(q.body.total,0);assert.equal(calls,0);
 const e=await api.export('token',{snapshot:q.body.snapshot,format:'csv'});
 assert.equal(e.status,200);assert.equal(e.body.rowCount,0);
});
test('archive time spoofing fails closed; My History and Calendar Changes retain their prior scope rules',async()=>{
 const fid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const old={source:'audit',eventId:'old-session',eventType:'session_updated',entityType:'session',entityId:fid,
  occurredAtUtc:'2026-10-16T10:00:00Z',beforeJson:'{"room":"Old"}',afterJson:'{"room":"New"}',
  contextJson:JSON.stringify({academicYear:'2026-27',affectedFaculty:[{facultyId:fid,displayName:'Teacher'}]})};
 const seen=[];
 const api=createChangeHistoryApi({verifyToken:async()=>({uid:'faculty'}),
  findUser:async()=>({active:true,baseRole:'faculty',facultyId:fid}),
  repository:{list:async filters=>{seen.push(filters);return [old];}},
  clock:()=>Date.parse('2026-10-21T12:00:00Z')});
 for(const filters of [{scope:'dashboard',historyBaselineUtc:'0001-01-01T00:00:00.000Z'},
  {scope:'dashboard',startUtc:'0001-01-01T00:00:00.000Z'},
  {scope:'mine',academicYear:'all'},{scope:'timetable',academicYear:'all'}])
  assert.equal((await api.query('token',filters)).status,400);
 assert.equal(seen.length,0);
 const dash=await api.query('token',{scope:'dashboard'});
 assert.equal(dash.status,200);
 // Public session updates stay excluded from the private Dashboard scope.
 assert.equal(dash.body.total,0);
 const mine=await api.query('token',{scope:'mine',academicYear:'2026-27'});
 const timetable=await api.query('token',{scope:'timetable',academicYear:'2026-27'});
 assert.equal(mine.status,200);assert.equal(mine.body.total,1);
 assert.equal(timetable.status,200);assert.equal(timetable.body.total,1);
 assert.equal(seen[0].startUtc,'2026-10-05T00:00:00.000Z');
 assert.equal(seen[1].startUtc,undefined);assert.equal(seen[2].startUtc,undefined);
});
