'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSwapApi}=require('../src/swap/swap-api');
const {createSqlSwapRepository}=require('../src/data/sql-swap-repository');
const ID='11111111-1111-4111-8111-111111111111';
function fixture(){return {
 request:{requestId:ID,sessionId:ID,revision:2,status:'pending',nextStage:'lab',isMine:false,courseCode:'206',date:'2026-11-05',academicYear:'2026-27',changes:{topic:'Proposed LAB topic'},note:'Please review',routing:{needsAdc:true,needsLab:true,needsVisc:false,notifyReplacement:false},requester:{firstName:'Mary Jane',lastName:'de la Cruz',email:'PRIVATE_EMAIL'},original:{courseCode:'206',topic:'Original LAB topic',date:'2026-11-05',startTime:'09:00',endTime:'10:30',assignmentDisplayName:'Hall, David',ucid:'PRIVATE_UCID'},SnapshotJson:'PRIVATE_SNAPSHOT',CreatorUid:'PRIVATE_UID'},
 capabilities:{canDecide:true,canRevise:false,canOverride:false,decisions:['approve','reject','push_back']},
 history:[{revision:1,stage:'adfa',decision:'approve',actor:{displayName:'Old Reviewer'},createdAtUtc:'2026-10-01T10:00:00Z'},{revision:2,stage:'adc',decision:'approve',actor:{firstName:'Jean-Luc',lastName:'O’Neill',email:'PRIVATE_EMAIL'},comment:'Schedule checked',createdAtUtc:'2026-10-02T10:00:00Z',ActorUid:'PRIVATE_UID'}],
 revisions:[{revision:2,createdAtUtc:'2026-10-02T09:00:00Z',actor:{displayName:'Mary Jane de la Cruz'}}],secret:'PRIVATE_TOP'
};}
function api(body,baseRole='lab'){
 const repository=createSqlSwapRepository({query:async()=>[{responseJson:JSON.stringify(body)}]});
 return createSwapApi({verifyToken:async()=>({uid:'synthetic'}),findUser:async()=>({active:true,baseRole}),repository,writeGates:{swapDecision:true,swapRequest:true,swapApply:true}});
}
test('authorized approval detail shows the persisted serial route and current revision only, without private source data',async()=>{
 const result=await api(fixture()).detail('token',ID);assert.equal(result.status,200);
 assert.deepEqual(result.body.workflow.stages.map(row=>[row.key,row.status]),[['adc','approved'],['lab','current'],['adfa','waiting']]);
 assert.equal(result.body.request.original.topic,'Original LAB topic');assert.equal(result.body.request.changes.topic,'Proposed LAB topic');
 assert.equal(result.body.request.requesterName,'de la Cruz, Mary Jane');assert.equal(result.body.history[1].actorName,'O’Neill, Jean-Luc');
 assert.equal(result.body.workflow.finalStage,'adfa');assert.equal(result.body.workflow.complete,false);
 assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_|SnapshotJson|CreatorUid|ActorUid/);
});
test('an out-of-order approval is not presented as a verified route',async()=>{
 const body=fixture();body.history.push({revision:2,stage:'adfa',decision:'approve'});
 const result=await api(body).detail('token',ID);assert.equal(result.body.workflow.verified,false);assert.equal(result.body.workflow.complete,false);
});
test('an applied request is complete only with all approvals at its own revision',async()=>{
 const body=fixture();body.request.status='applied';body.request.nextStage=null;
 assert.equal((await api(body).detail('token',ID)).body.workflow.complete,false);
 body.history.push({revision:2,stage:'lab',decision:'approve'},{revision:2,stage:'adfa',decision:'approve'});
 const result=await api(body).detail('token',ID);assert.equal(result.body.workflow.complete,true);assert.ok(result.body.workflow.stages.every(row=>row.status==='approved'));
});
test('push-back and withdrawal retain prior evidence without a false live application',async()=>{
 const body=fixture();body.request.status='changes_requested';body.request.nextStage=null;body.history.push({revision:2,stage:'lab',decision:'push_back',comment:'Clarify topic'});
 const returned=(await api(body).detail('token',ID)).body;assert.equal(returned.workflow.stages[1].status,'changes_requested');assert.equal(returned.workflow.complete,false);
 body.request.status='withdrawn';const withdrawn=(await api(body).detail('token',ID)).body;assert.equal(withdrawn.workflow.stages[2].status,'cancelled');assert.equal(withdrawn.workflow.complete,false);
});
test('legacy detail does not invent a route or expose email-shaped display labels',async()=>{
 const body=fixture();delete body.request.routing;body.request.requester={displayName:'private@example.test'};body.history[0].actor={displayName:'private@example.test'};
 const result=(await api(body).detail('token',ID)).body;assert.equal(result.workflow.available,false);assert.equal(result.workflow.complete,false);assert.equal(result.request.requesterName,'PAWS user');assert.equal(result.history[0].actorName,'PAWS user');assert.doesNotMatch(JSON.stringify(result),/@|PRIVATE_/);
});
test('queue uses SQL ownership and decision capability and removes confidential profile fields',async()=>{
 const row={...fixture().request,isMine:true,canDecide:false,requiresOverride:true};
 const result=(await api({requests:[row],notifications:[{requestId:ID,revision:2,status:'pending',TargetUid:'PRIVATE_UID'}]}).queue('token')).body;
 assert.equal(result.requests[0].isMine,true);assert.equal(result.requests[0].canDecide,false);assert.equal(result.requests[0].requiresOverride,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|SnapshotJson|TargetUid/);
});
test('SQL row denial remains a denial before approval information is returned',async()=>{
 const instance=createSwapApi({verifyToken:async()=>({uid:'other'}),findUser:async()=>({active:true,baseRole:'faculty'}),repository:createSqlSwapRepository({query:async()=>{throw Object.assign(Error('Out of scope'),{number:53003});}})});
 const result=await instance.detail('token',ID);assert.equal(result.status,403);assert.equal(result.body.workflow,undefined);
});
test('approval person labels preserve structured compound and partial names at the API boundary',async()=>{
 const body=fixture();body.request.replacement={firstName:'Mary Jane',lastName:'de la Cruz'};body.request.replacementDisplayName='Unstructured fallback';body.request.requester={lastName:'de la Cruz'};
 const result=(await api(body).detail('token',ID)).body;assert.equal(result.request.replacementDisplayName,'de la Cruz, Mary Jane');assert.equal(result.request.requesterName,'de la Cruz');
 body.request.replacement={displayName:'Not provided'};assert.equal((await api(body).detail('token',ID)).body.request.replacementDisplayName,'Not provided');
});
test('a real applied override marks skipped office steps as bypassed rather than approved or inconsistent',async()=>{
 const body=fixture();body.request.status='applied';body.request.nextStage=null;body.history.push({revision:2,stage:'lab',decision:'approve',overrideReason:'Authorized synthetic override',actor:{displayName:'Synthetic Owner'}});
 const result=(await api(body).detail('token',ID)).body.workflow;
 assert.equal(result.verified,true);assert.equal(result.complete,true);assert.equal(result.appliedByOverride,true);assert.equal(result.stages[2].status,'bypassed');
});
test('original outgoing labels use the snapshot canonical identity and mask email-like source fallbacks',async()=>{
 const body=fixture();body.request.original.assignment={firstName:'David',lastName:'Hall'};body.request.original.assignmentDisplayName='Imported Previous Instructor';
 assert.equal((await api(body).detail('token',ID)).body.request.original.assignmentDisplayName,'Hall, David');
 delete body.request.original.assignment;body.request.original.assignmentDisplayName='private.faculty@example.test';assert.doesNotMatch((await api(body).detail('token',ID)).body.request.original.assignmentDisplayName,/@/);
});
