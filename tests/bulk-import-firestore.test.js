'use strict';
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
