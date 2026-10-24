'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createTeachingAssignmentApi} = require('../src/teaching-assignment/teaching-assignment-api');
const packageId='11111111-1111-4111-8111-111111111111';

function createApi({role='hicc', gate=true, repository={}}={}) {
  const calls=[];
  const api=createTeachingAssignmentApi({
    verifyToken: async token => ({uid: token, name: 'Token Name'}),
    findUser: async uid => ({firebaseUid:uid, active:true, mustChangePassword:false, baseRole:role, facultyId:'faculty-1', displayName:'SQL Name'}),
    repository: Object.fromEntries(['listWorkQueue','listContributionTargets','getPackage','getPublishedRelease','getHistory','saveDraft','addContribution','submit','review','finalSubmit','saveFinalization','publish'].map(name=>[name, async args=>{calls.push([name,args]); return repository[name]?.(args) ?? {ok:true};}])),
    writeGates:{taDraft:gate,taReview:gate,taFinal:gate,taPublish:gate}
  });
  return {api,calls};
}

test('draft writes require effective HICC authority and bind actor UID to verified token', async () => {
  const {api,calls}=createApi();
  assert.equal((await api.saveDraft('firebase-uid',{packageId,expectedWorkingRevision:0,sessions:[]})).status,200);
  assert.equal(calls[0][1].actorFirebaseUid,'firebase-uid');
  assert.equal(calls[0][1].expectedWorkingRevision,0);
  assert.equal((await api.saveDraft('firebase-uid',{packageId,expectedWorkingRevision:0,sessions:[],actorFirebaseUid:'forged'})).status,400);
});

test('write gates deny writes and only current HICC/VISC or admin capabilities can transition', async () => {
  assert.equal((await createApi({gate:false}).api.saveDraft('uid',{packageId,expectedWorkingRevision:0,sessions:[]})).status,503);
  assert.equal((await createApi({role:'faculty'}).api.saveDraft('uid',{packageId,expectedWorkingRevision:0,sessions:[]})).status,403);
  assert.equal((await createApi({role:'visc'}).api.finalSubmit('uid',packageId,{expectedWorkingRevision:2})).status,403);
  assert.equal((await createApi({role:'adfa_general'}).api.saveFinalization('uid',packageId,{expectedWorkingRevision:2,assignments:[]})).status,200);
  assert.equal((await createApi({role:'adfa_regular'}).api.publish('uid',{academicYear:'2026-27'})).status,200);
  assert.equal((await createApi({role:'administrator'}).api.saveFinalization('uid',packageId,{expectedWorkingRevision:2,assignments:[]})).status,200);
  assert.equal((await createApi({role:'developer'}).api.saveFinalization('uid',packageId,{expectedWorkingRevision:2,assignments:[]})).status,200);
});

test('review rejects missing push-back reason and maps stale SQL revision conflicts', async () => {
  assert.equal((await createApi().api.review('uid',packageId,{revisionNumber:1,decision:'push_back'})).status,400);
  const {api}=createApi({repository:{submit:async()=>{const error=new Error('stale revision conflict');error.number=52120;throw error;}}});
  assert.equal((await api.submit('uid',packageId,{expectedWorkingRevision:1})).status,409);
});

test('suggestions remain opaque and non-authoritative, with contributor office derived from SQL profile',async()=>{
  const {api,calls}=createApi({role:'adc'});
  const input={revisionNumber:1,sessionId:'22222222-2222-4222-8222-222222222222',candidateKey:'replacement-candidate-7',suggestedDisplayName:'Dr Example',note:'Suggested for review'};
  assert.equal((await api.addContribution('uid',packageId,input)).status,200);
  assert.equal(calls[0][1].suggestedByOffice,'adc');
  assert.equal(calls[0][1].actorFirebaseUid,'uid');
  assert.equal((await api.addContribution('uid',packageId,{...input,facultyId:'forged'})).status,400);
  assert.equal((await createApi({role:'administrator'}).api.addContribution('uid',packageId,input)).status,403);
});

test('read endpoints require authenticated SQL profile and use server actor scope', async () => {
  const {api,calls}=createApi();
  assert.equal((await api.workQueue('uid',{academicYear:'2026-27'})).status,200);
  assert.equal(calls[0][1].actorFirebaseUid,'uid');
  assert.equal(calls[0][1].facultyId,'faculty-1');
  assert.equal((await api.workQueue('',{academicYear:'2026-27'})).status,401);
  assert.deepEqual((await api.writeCapabilities('uid')).body.writeCapabilities,{taDraft:true,taReview:true,taFinal:true,taPublish:true});
});

test('published reads are restricted to supported roles and require server-linked faculty identity',async()=>{
  const {api,calls}=createApi({role:'hicc'});
  assert.equal((await api.published('uid',{academicYear:'2026-27'})).status,200);
  assert.equal(calls[0][1].facultyId,'faculty-1');
  assert.equal((await createApi({role:'viewer'}).api.published('uid',{academicYear:'2026-27'})).status,403);
  const unlinked=createTeachingAssignmentApi({verifyToken:async uid=>({uid}),findUser:async()=>({active:true,baseRole:'faculty'}),repository:{getPublishedRelease:async()=>({})}});
  assert.equal((await unlinked.published('uid',{academicYear:'2026-27'})).status,403);
});

test('ADC/LAB contribution targets are role-gated and do not grant review-package access',async()=>{
  const {api,calls}=createApi({role:'lab'});
  const result=await api.contributionTargets('uid',{academicYear:'2026-27'});
  assert.equal(result.status,200);
  assert.deepEqual(calls[0],[ 'listContributionTargets', {academicYear:'2026-27'} ]);
  assert.equal((await api.getPackage('uid',packageId)).status,403);
  assert.equal((await createApi({role:'faculty'}).api.contributionTargets('uid',{academicYear:'2026-27'})).status,403);
  assert.equal((await createApi({role:'adc'}).api.contributionTargets('uid',{academicYear:'2026-28'})).status,400);
});
