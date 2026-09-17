'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const rules=`rules_version = '2';
service cloud.firestore {
 match /databases/{database}/documents {
  function staff(){return request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.active == true;}
  match /sessions/{id} {
   allow create: if staff() && getAfter(/databases/$(database)/documents/calendar_sessions/$(id)).data.topic == request.resource.data.topic;
  }
  match /calendar_sessions/{id} {
   allow create: if staff() && getAfter(/databases/$(database)/documents/sessions/$(id)).data.topic == request.resource.data.topic;
  }
 }
}`;
let env;
before(async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'This probe must run in the emulator.');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-pairing-probe',firestore:{rules}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(ctx=>ctx.firestore().doc('users/staff').set({active:true}));
});
after(async()=>{if(env)await env.cleanup();});
function pairs(count,prefix){const db=env.authenticatedContext('staff').firestore(),batch=db.batch();for(let i=0;i<count;i++){batch.set(db.doc(`sessions/${prefix}-${i}`),{topic:'Synthetic test'});batch.set(db.doc(`calendar_sessions/${prefix}-${i}`),{topic:'Synthetic test'});}return batch.commit();}
test('one source/calendar pair commits together',async()=>{await assertSucceeds(pairs(1,'single'));});
test('a source-only write without its calendar pair is rejected',async()=>{await assertFails(env.authenticatedContext('staff').firestore().doc('sessions/missing-calendar').set({topic:'Synthetic test'}));});
test('eight independently checked source/calendar pairs fit the access-call budget',async()=>{await assertSucceeds(pairs(8,'eight'));});
test('two hundred checked pairs exceed the security-rule access-call budget',async()=>{await assertFails(pairs(200,'two-hundred'));});
