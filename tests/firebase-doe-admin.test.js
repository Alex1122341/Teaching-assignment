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
});

test('DOE destructive operations require exact typed confirmation',()=>{
  const publish={operation:'publish-policy',policyVersionId:'policy-v2',academicYear:'',scope:'all',confirmation:''};
  assert.equal(cli.expectedConfirmation(publish),'PUBLISH:policy-v2');
  assert.throws(()=>cli.validateOptions(publish,{projectId:'vista-teaching-lab'}),/exact confirmation/);
  assert.equal(cli.validateOptions({...publish,confirmation:'PUBLISH:policy-v2'},{projectId:'vista-teaching-lab'}).operation,'publish-policy');

  const recalc={operation:'recalculate',policyVersionId:'active-v3',academicYear:'2026-27',scope:'all',confirmation:'RECALCULATE:active-v3:2026-27'};
  assert.equal(cli.validateOptions(recalc,{projectId:'vista-teaching-lab'}).academicYear,'2026-27');
  assert.throws(()=>cli.validateOptions({...recalc,academicYear:'',confirmation:''},{projectId:'vista-teaching-lab'}),/Academic Year/);
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
