'use strict';
// ---------------------------------------------------------------------------
// Merged domain test file.
//
// This file was assembled from several small single-purpose test files in the
// same domain. No assertion was changed: each source body is preserved verbatim
// inside its own IIFE so top-level declarations from different files cannot
// collide, and the total number of tests is unchanged.
//
// Split it back out by taking each block below to its own file if a failure ever
// needs a narrower blast radius.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------------------
// merged from tests/bulk-import-backup.test.js
// ------------------------------------------------------------------------
(() => {
const {test}=require('node:test');
const assert=require('node:assert/strict');
const backup=require('../bulk-import-backup.js');
class FakeTimestamp{constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds}toDate(){return new Date(this.seconds*1000)}}

test('backup codec round-trips timestamps',()=>{
  const encoded=backup.encodeValue({updatedAt:new FakeTimestamp(123,456)});
  assert.deepEqual(encoded,{updatedAt:{__ucvmFirestoreType:'timestamp',seconds:123,nanoseconds:456}});
  const decoded=backup.decodeValue(encoded,{Timestamp:FakeTimestamp});
  assert.equal(decoded.updatedAt.seconds,123);
  assert.equal(decoded.updatedAt.nanoseconds,456);
});

test('backup codec rejects unknown class instances',()=>{
  class Unknown{}
  assert.throws(()=>backup.encodeValue(new Unknown()),/unsupported firestore value/i);
});

test('backup identity must match the interrupted import',async()=>{
  const payload=await backup.buildBackup({projectId:'tester-teaching',importId:'i1',sourceFingerprint:'abc',actor:{uid:'general',name:'General'},faculty:[],sessions:[],summarySettings:null,createdAt:'2026-09-16T20:00:00.000Z'});
  await backup.parseAndValidateBackup(backup.serializeBackup(payload),{projectId:'tester-teaching',importId:'i1',sourceFingerprint:'abc'});
  await assert.rejects(()=>backup.parseAndValidateBackup(backup.serializeBackup(payload),{projectId:'tester-teaching',importId:'i2',sourceFingerprint:'abc'}),/does not belong/i);
});
})();

// ------------------------------------------------------------------------
// merged from tests/bulk-import-core.test.js
// ------------------------------------------------------------------------
(() => {
const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bulk-import-core.js');

const validSource=()=>({
  schemaVersion:'ucvm-all-faculty-summaries-v8-synced-2026-27',
  sourceWorkbook:'Teaching Assignments.xlsx',
  faculty:[{ucid:'100',displayName:'One'}],
  sessions:[{id:'s1',course:'301',date:'2026-09-08',assignments:[]}]
});

test('validateSource blocks duplicate faculty and session IDs',()=>{
  const source=validSource();
  source.faculty.push({ucid:'100'});
  source.sessions.push({...source.sessions[0]});
  const result=core.validateSource(source);
  assert.match(result.errors.join('\n'),/duplicate faculty/i);
  assert.match(result.errors.join('\n'),/duplicate session/i);
});

test('fingerprintBytes hashes raw bytes, not parsed JSON',async()=>{
  const a=new TextEncoder().encode('{"a":1}');
  const b=new TextEncoder().encode('{ "a": 1 }');
  assert.notEqual(await core.fingerprintBytes(a),await core.fingerprintBytes(b));
});

test('analyzeSource reports stale sessions and large-change confirmation',()=>{
  const source=validSource();
  source.sessions.push({id:'s2',course:'302',date:'2026-09-09',assignments:[]});
  const analysis=core.analyzeSource({
    source,
    currentFaculty:[{__id:'100'},{__id:'200'}],
    currentSessions:[{id:'s1'},{id:'old-1'},{id:'old-2'},{id:'old-3'},{id:'old-4'},{id:'old-5'},{id:'old-6'},{id:'old-7'},{id:'old-8'}]
  });
  assert.equal(analysis.sessionExpected,2);
  assert.equal(analysis.staleSessionIds.length,8);
  assert.equal(analysis.requiresTypedImportConfirmation,true);
});

test('diffIdSets compares identity, not only counts',()=>{
  assert.deepEqual(core.diffIdSets(['A','B','C'],['A','B','D']),{missing:['C'],unexpected:['D']});
});


test('session and stale import batches use the conservative paired-write budget',()=>{
  assert.ok(core.SESSION_BATCH_SIZE<=8);
  assert.ok(core.STALE_BATCH_SIZE<=8);
  assert.equal(core.FACULTY_BATCH_SIZE,350);
});
})();

// ------------------------------------------------------------------------
// merged from tests/bulk-import-firestore.test.js
// ------------------------------------------------------------------------
(() => {
const {test}=require('node:test');
const assert=require('node:assert/strict');
const firestoreStore=require('../bulk-import-firestore.js');
const calendarSession=require('../calendar-session.js');

function recordingDb(){
  const commits=[];
  const ref=path=>({path,collection:name=>({doc:id=>ref(`${path}/${name}/${id}`)})});
  const db={
    collection:name=>({doc:id=>ref(`${name}/${id}`)}),
    batch:()=>{const paths=[];return{set:r=>paths.push(r.path),update:r=>paths.push(r.path),delete:r=>paths.push(r.path),commit:async()=>commits.push(paths.slice())}},
    runTransaction:async fn=>fn({get:async()=>({exists:false,data:()=>({})}),set:()=>{},update:()=>{}})
  };
  return{db,commits};
}
const fakeFirebase={firestore:{FieldValue:{serverTimestamp:()=>({serverTimestamp:true}),delete:()=>({delete:true})}}};

test('faculty data and checkpoint share one batch commit',async()=>{
  const fake=recordingDb(),store=firestoreStore.create({db:fake.db,firebase:fakeFirebase,calendarSession});
  await store.commitFacultyBatch({importId:'i1',batchIndex:0,total:2,writes:[{id:'f1',patch:{facultySummaryStatus2026_27:'Loaded'}}]});
  assert.deepEqual(fake.commits[0].sort(),['bulk_import_jobs/i1','faculty/f1']);
});

test('terminal status and unlock share one batch commit',async()=>{
  const fake=recordingDb(),store=firestoreStore.create({db:fake.db,firebase:fakeFirebase,calendarSession});
  await store.completeAndUnlock({importId:'i1',status:'COMPLETED'});
  assert.deepEqual(fake.commits[0].sort(),['bulk_import_jobs/i1','settings/system_state']);
});



test('import session data, sanitized calendar data, and checkpoint share one batch commit',async()=>{
  const fake=recordingDb(),store=firestoreStore.create({db:fake.db,firebase:fakeFirebase,calendarSession});
  await store.commitSessionBatch({importId:'i1',batchIndex:0,total:2,writes:[{id:'s1',data:{course:'301',date:'2026-09-08',instructor:'Dr One',facultyIds:['private']}}]});
  assert.deepEqual(fake.commits[0].sort(),['bulk_import_jobs/i1','calendar_sessions/s1','sessions/s1']);
});

test('stale session delete removes source and sanitized calendar in the same checkpoint batch',async()=>{
  const fake=recordingDb(),store=firestoreStore.create({db:fake.db,firebase:fakeFirebase,calendarSession});
  await store.commitStaleDeleteBatch({importId:'i1',batchIndex:0,total:2,ids:['s-old']});
  assert.deepEqual(fake.commits[0].sort(),['bulk_import_jobs/i1','calendar_sessions/s-old','sessions/s-old']);
});

test('restore session data and checkpoint share one batch commit',async()=>{
  const fake=recordingDb(),store=firestoreStore.create({db:fake.db,firebase:fakeFirebase,calendarSession});
  await store.commitRestoreSessionBatch({importId:'i1',batchIndex:0,total:2,writes:[{id:'s1',data:{course:'301'}}]});
  assert.deepEqual(fake.commits[0].sort(),['bulk_import_jobs/i1','calendar_sessions/s1','sessions/s1']);
});

test('restore delete data and checkpoint share one batch commit',async()=>{
  const fake=recordingDb(),store=firestoreStore.create({db:fake.db,firebase:fakeFirebase,calendarSession});
  await store.commitRestoreDeleteBatch({importId:'i1',batchIndex:0,total:2,ids:['s-new']});
  assert.deepEqual(fake.commits[0].sort(),['bulk_import_jobs/i1','calendar_sessions/s-new','sessions/s-new']);
});
})();

// ------------------------------------------------------------------------
// merged from tests/bulk-import-static-assets.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('shared deployment allowlist includes every bulk import recovery runtime asset',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'tools/static-assets.json'),'utf8'));
 for(const name of ['bulk-import-core.js','bulk-import-backup.js','bulk-import-firestore.js','bulk-import-controller.js','bulk-import-ui.js','maintenance-state.js'])assert.ok(manifest.includes(name),name);
});

test('Faculty Dashboard loads import modules in dependency order and UI after legacy handler binding',()=>{
 const html=fs.readFileSync(path.join(root,'faculty-admin.html'),'utf8');
 const names=['maintenance-state.js','bulk-import-core.js','bulk-import-backup.js','bulk-import-firestore.js','bulk-import-controller.js','faculty-admin.js','bulk-import-ui.js'];
 const positions=names.map(name=>html.indexOf(name));
 assert.ok(positions.every(value=>value>=0));
 for(let i=1;i<positions.length;i++)assert.ok(positions[i]>positions[i-1],`${names[i]} should load after ${names[i-1]}`);
});

test('bulk import final verification includes sanitized calendar health',()=>{
 const source=fs.readFileSync(path.join(root,'bulk-import-ui.js'),'utf8');
 assert.match(source,/UCVM_CALENDAR_SESSION_MAINTENANCE/);
 assert.match(source,/verifyCalendar:\s*\(\{?[^)]*\}?\)?\s*=>\s*calendarMaintenance\.verify\(db\)/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/bulk-import-ui.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../bulk-import-ui.js');
const root=path.resolve(__dirname,'..');

test('preflight summary exposes management-facing counts and warnings',()=>{
 const result=ui.summarizePreflight({source:{sourceWorkbook:'MASTER.xlsx'},analysis:{facultyExpected:118,sessionExpected:2400,createdSessionIds:['a'],updatedSessionIds:['b','c'],staleSessionIds:['old'],noSourceFacultyIds:['f1'],requiresTypedImportConfirmation:true},warnings:['Large change'],errors:[]});
 assert.deepEqual(result,{sourceWorkbook:'MASTER.xlsx',facultyExpected:118,sessionExpected:2400,createdSessions:1,updatedSessions:2,staleSessions:1,noSourceFaculty:1,requiresTypedImportConfirmation:true,errors:[],warnings:['Large change']});
});

test('restore phase and recovery ownership are explicit',()=>{
 assert.equal(ui.isRestoreJob({phase:'RESTORING_SESSIONS'}),true);
 assert.equal(ui.isRestoreJob({phase:'APPLYING_SESSIONS'}),false);
 assert.deepEqual(ui.recoveryPermissions({teachingDataWriteLocked:true,maintenanceOwnerUid:'general'},{phase:'FAILED'},'general2'),{active:true,isOwner:false,canTakeOver:true,isRestore:false});
});

test('start gate requires a saved backup and exact IMPORT confirmation for large changes',()=>{
 assert.deepEqual(ui.startGate({backupConfirmed:false,requiresTypedImportConfirmation:false,typedConfirmation:''}),{ok:false,message:'Confirm that the recovery backup has been saved.'});
 assert.deepEqual(ui.startGate({backupConfirmed:true,requiresTypedImportConfirmation:true,typedConfirmation:'import'}),{ok:false,message:'Type IMPORT exactly to confirm this large synchronization.'});
 assert.deepEqual(ui.startGate({backupConfirmed:true,requiresTypedImportConfirmation:true,typedConfirmation:'IMPORT'}),{ok:true,message:''});
 assert.deepEqual(ui.startGate({backupConfirmed:true,requiresTypedImportConfirmation:false,typedConfirmation:''}),{ok:true,message:''});
});

test('restore and takeover confirmation helpers reject ambiguous input',()=>{
 assert.equal(ui.restoreConfirmed('RESTORE'),true);
 assert.equal(ui.restoreConfirmed('restore'),false);
 assert.equal(ui.restoreConfirmed(' RESTORE '),true);
 assert.equal(ui.takeoverReason('   '),'');
 assert.equal(ui.takeoverReason(' Original administrator unavailable '),'Original administrator unavailable');
});

test('raw file payload preserves exact bytes used for fingerprinting',async()=>{
 const raw=new TextEncoder().encode('{ "a": 1 }');
 const file={name:'source.json',arrayBuffer:async()=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)};
 const payload=await ui.readFilePayload(file);
 assert.equal(payload.name,'source.json');
 assert.equal(payload.text,'{ "a": 1 }');
 assert.deepEqual([...payload.bytes],[...raw]);
});

test('Faculty Dashboard loads bulk import runtime after legacy admin bindings so it can replace the old destructive handler',()=>{
 const html=fs.readFileSync(path.join(root,'faculty-admin.html'),'utf8');
 assert.ok(html.indexOf('bulk-import-core.js')>0);
 assert.ok(html.indexOf('bulk-import-controller.js')>html.indexOf('bulk-import-core.js'));
 assert.ok(html.indexOf('bulk-import-ui.js')>html.indexOf('faculty-admin.js'));
});

test('bulk import runtime injects the full derived-index verifier and atomic writer',()=>{
 const js=fs.readFileSync(path.join(root,'bulk-import-ui.js'),'utf8');
 assert.match(js,/rebuildIndexes:\(\{faculty,sessions,actor:who\}\)=>indexMaintenance\.writeDerivedIndexes\(db,faculty,sessions,who\)/);
 assert.match(js,/verifyIndexes:\(\{faculty,sessions\}\)=>indexMaintenance\.verifyDerivedIndexes\(db,\{faculty,sessions\}\)/);
 assert.doesNotMatch(js,/verifyDerivedIndexesProvisional/);
});
})();
