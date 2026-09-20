'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cli=require('../tools/run-doe-admin-job.js');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('DOE admin CLI is hard-locked to the isolated Firebase lab project',()=>{
  const base={operation:'validate-policy',policyVersionId:'policy-v1',academicYear:'',scope:'all',confirmation:''};
  assert.equal(cli.validateOptions(base,{projectId:'vista-teaching-lab'}).policyVersionId,'policy-v1');
  assert.throws(()=>cli.validateOptions(base,{projectId:'tester-teaching'}),/vista-teaching-lab/);
  assert.throws(()=>cli.validateOptions({...base,operation:'unknown'},{projectId:'vista-teaching-lab'}),/Unknown DOE admin operation/);
  const queue={operation:'recalculate-queue',policyVersionId:'',academicYear:'',scope:'all',confirmation:'PROCESS-QUEUE'};
  assert.equal(cli.validateOptions(queue,{projectId:'vista-teaching-lab'}).operation,'recalculate-queue');
});

test('DOE destructive operations require exact typed confirmation',()=>{
  const publish={operation:'publish-policy',policyVersionId:'policy-v2',academicYear:'',scope:'all',confirmation:''};
  assert.equal(cli.expectedConfirmation(publish),'PUBLISH:policy-v2');
  assert.throws(()=>cli.validateOptions(publish,{projectId:'vista-teaching-lab'}),/exact confirmation/);
  assert.equal(cli.validateOptions({...publish,confirmation:'PUBLISH:policy-v2'},{projectId:'vista-teaching-lab'}).operation,'publish-policy');

  const recalc={operation:'recalculate',policyVersionId:'active-v3',academicYear:'2026-27',scope:'all',confirmation:'RECALCULATE:active-v3:2026-27'};
  assert.equal(cli.validateOptions(recalc,{projectId:'vista-teaching-lab'}).academicYear,'2026-27');
  assert.throws(()=>cli.validateOptions({...recalc,academicYear:'',confirmation:''},{projectId:'vista-teaching-lab'}),/Academic Year/);
  const queue={operation:'recalculate-queue',policyVersionId:'',academicYear:'',scope:'all',confirmation:''};
  assert.equal(cli.expectedConfirmation(queue),'PROCESS-QUEUE');
  assert.throws(()=>cli.validateOptions(queue,{projectId:'vista-teaching-lab'}),/PROCESS-QUEUE/);
});

test('DOE admin workflow is manual, lab-scoped and does not depend on Azure',()=>{
  const workflow=read('.github/workflows/firebase-doe-admin.yml');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/\n\s*push:/);
  assert.doesNotMatch(workflow,/\n\s*pull_request:/);
  assert.match(workflow,/name:\s*firebase-lab-admin/);
  assert.match(workflow,/FIREBASE_PROJECT_ID:\s*vista-teaching-lab/);
  assert.match(workflow,/secrets\.FIREBASE_LAB_SERVICE_ACCOUNT_JSON/);
  assert.match(workflow,/npm --prefix server ci/);
  assert.match(workflow,/npm run test:all/);
  assert.match(workflow,/recalculate-queue/);
  assert.match(workflow,/PROCESS-QUEUE/);
  assert.match(workflow,/node tools\/run-doe-admin-job\.js/);
  assert.doesNotMatch(workflow,/azure|AZURE_/i);
});

test('browser security rules keep authoritative DOE writes out of the client',()=>{
  const rules=read('firestore.rules');
  for(const collection of ['doe_policies','doe_policy_versions','doe_rules','doe_assignments','doe_calculation_records','doe_audit_log']){
    assert.ok(rules.includes(`match /${collection}/`),`${collection} rule is missing`);
  }
  assert.match(rules,/match \/doe_assignments\/\{id\}[\s\S]*?allow read,create,update,delete: if false;/);
  assert.match(rules,/match \/doe_calculation_records\/\{id\}[\s\S]*?allow create,update,delete: if false;/);
});


test('DOE queue processor recalculates the current session assignment scope and completes the request',async()=>{
  const updates=[],calls=[];
  const requestDoc={id:'rq1',data:()=>({status:'pending',sessionId:'s1',academicYear:'2026-27',attemptCount:0}),ref:{set:async data=>updates.push(data)}};
  const firestore={collection:name=>{
    if(name==='doe_recalculation_requests')return{where:()=>({limit:()=>({get:async()=>({docs:[requestDoc]})})}),doc:()=>requestDoc.ref};
    if(name==='sessions')return{doc:id=>({get:async()=>({exists:true,id,data:()=>({date:'2026-09-10',semester:'fall',assignments:[{facultyId:'f1'},{ucid:'f2'},{}]})})})};
    throw Error('Unexpected collection '+name);
  }};
  const policyAdminService={
    getPolicyYear:async({academicYear})=>({policy:{currentActiveVersionId:'active-v1',academicYear}}),
    runRecalculate:async payload=>{calls.push(payload);return{batchId:'batch-1',completedRows:2}}
  };
  const result=await cli.processRecalculationQueue({firestore,policyAdminService,actor:{uid:'job',name:'Job'},clock:()=> '2026-09-20T12:00:00Z'});
  assert.equal(result.completed,1);assert.equal(result.failed,0);
  assert.deepEqual(calls[0].scope,{sourceEntityTypes:['session_assignment'],sourceEntityIds:['s1--assignment--1','s1--assignment--2']});
  assert.equal(calls[0].academicYear,'2026-27');assert.equal(calls[0].policyVersionId,'active-v1');
  assert.equal(updates.at(-1).status,'completed');assert.deepEqual(updates.at(-1).actualFacultyIds,['f1','f2']);
});

test('DOE queue processor leaves failed requests pending for retry',async()=>{
  const updates=[],requestDoc={id:'rq2',data:()=>({status:'pending',sessionId:'missing'}),ref:{set:async data=>updates.push(data)}};
  const firestore={collection:name=>name==='doe_recalculation_requests'?{where:()=>({limit:()=>({get:async()=>({docs:[requestDoc]})})})}:{doc:()=>({get:async()=>({exists:false})})}};
  const result=await cli.processRecalculationQueue({firestore,policyAdminService:{getPolicyYear:async()=>{throw Error('unused')},runRecalculate:async()=>{}},actor:{uid:'job'},clock:()=> '2026-09-20T12:00:00Z'});
  assert.equal(result.failed,1);assert.equal(updates.at(-1).status,'pending');assert.equal(updates.at(-1).lastErrorCode,'SESSION_NOT_FOUND');
});


test('DOE queue scope preserves explicit assignment ids and falls back to ordinals',()=>{
  assert.deepEqual(
    cli.currentSessionScope({assignments:[{facultyId:'f1',assignmentId:'custom-1'},{facultyId:'f2'},{}]},'s9'),
    {sourceEntityIds:['custom-1','s9--assignment--2'],facultyIds:['f1','f2']}
  );
});
