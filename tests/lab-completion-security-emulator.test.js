'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('LAB completion evidence: '+name,{skip:!enabled},fn);
before(async()=>{
  if(!enabled)return;
  const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
  env=await initializeTestEnvironment({projectId:'demo-ucvm-lab-completion',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    for(const role of ['lab','administrator'])await ctx.firestore().doc(`users/${role}`).set({role,active:true,mustChangePassword:false});
    await ctx.firestore().doc('lab_groups/g-a').set({groupId:'g-a',course:'505',groupCode:'A',colorKey:'group-a',active:true});
  });
});
after(async()=>{if(env)await env.cleanup()});
const db=uid=>env.authenticatedContext(uid).firestore();
check('safe evidence cannot claim completion without a private roster',async()=>{
  const {assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
  await assertFails(db('lab').doc('lab_groups/g-a').update({rosterComplete:true,updatedBy:'lab',updatedAt:serverTimestamp()}));
});
check('LAB atomically completes roster and safe evidence; ADFA sees readiness but no IDs',async()=>{
  const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
  const fire=db('lab'),batch=fire.batch(),stamp=serverTimestamp();
  batch.set(fire.doc('lab_group_rosters/g-a'),{groupId:'g-a',studentIds:['30012345'],updatedBy:'lab',updatedAt:stamp});
  batch.update(fire.doc('lab_groups/g-a'),{rosterComplete:true,updatedBy:'lab',updatedAt:stamp});
  await assertSucceeds(batch.commit());
  const safe=(await assertSucceeds(db('administrator').doc('lab_groups/g-a').get())).data();
  assert.equal(safe.rosterComplete,true);
  assert.equal(JSON.stringify(safe).includes('30012345'),false);
  await assertFails(db('administrator').doc('lab_group_rosters/g-a').get());
});
check('roster changes cannot leave stale completion evidence',async()=>{
  const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
  const fire=db('lab'),stamp=serverTimestamp();
  await assertFails(fire.doc('lab_group_rosters/g-a').update({studentIds:[],updatedBy:'lab',updatedAt:stamp}));
  const batch=fire.batch();
  batch.update(fire.doc('lab_group_rosters/g-a'),{studentIds:[],updatedBy:'lab',updatedAt:stamp});
  batch.update(fire.doc('lab_groups/g-a'),{rosterComplete:false,updatedBy:'lab',updatedAt:stamp});
  await assertSucceeds(batch.commit());
  assert.equal((await db('administrator').doc('lab_groups/g-a').get()).data().rosterComplete,false);
});
