'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=require('../tools/bootstrap-lab-user.js');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('lab bootstrap is hard-locked to vista-teaching-lab and institutional emails',()=>{
  const options={email:'lab@ucalgary.ca',displayName:'LAB Test',role:'lab',facultyId:'',officeName:'UCVM LAB',confirmation:'BOOTSTRAP:lab@ucalgary.ca:lab'};
  const value=tool.validateOptions(options,{projectId:'vista-teaching-lab'});
  assert.equal(value.email,'lab@ucalgary.ca');
  assert.equal(value.role,'lab');
  assert.throws(()=>tool.validateOptions(options,{projectId:'tester-teaching'}),/vista-teaching-lab/);
  assert.throws(()=>tool.validateOptions({...options,email:'lab@example.com',confirmation:'BOOTSTRAP:lab@example.com:lab'},{projectId:'vista-teaching-lab'}),/@ucalgary\.ca/);
});

test('lab bootstrap requires exact role confirmation and Faculty ID where applicable',()=>{
  const faculty={email:'faculty.test@ucalgary.ca',displayName:'Faculty Test',role:'faculty',facultyId:'',officeName:'',confirmation:'BOOTSTRAP:faculty.test@ucalgary.ca:faculty'};
  assert.throws(()=>tool.validateOptions(faculty,{projectId:'vista-teaching-lab'}),/Faculty ID/);
  assert.throws(()=>tool.validateOptions({...faculty,facultyId:'FAC-TEST',confirmation:'wrong'},{projectId:'vista-teaching-lab'}),/exact confirmation/);
  assert.equal(tool.validateOptions({...faculty,facultyId:'FAC-TEST'},{projectId:'vista-teaching-lab'}).facultyId,'FAC-TEST');
});

test('service account validation requires the isolated lab project',()=>{
  const good=JSON.stringify({project_id:'vista-teaching-lab',client_email:'lab-admin@example.test',private_key:'private-key'});
  assert.equal(tool.parseServiceAccount(good).project_id,'vista-teaching-lab');
  assert.throws(()=>tool.parseServiceAccount(JSON.stringify({project_id:'tester-teaching',client_email:'x',private_key:'y'})),/vista-teaching-lab/);
  assert.throws(()=>tool.parseServiceAccount(''),/required/);
});

test('profile builder emits only known role-appropriate account fields',()=>{
  const now=new Date('2026-09-20T00:00:00Z');
  const office=tool.buildProfile({email:'lab@ucalgary.ca',displayName:'LAB Test',role:'lab',facultyId:'',officeName:'UCVM LAB'},{actor:{uid:'actor',name:'Actor'},now});
  assert.deepEqual(office,{
    name:'LAB Test',email:'lab@ucalgary.ca',role:'lab',active:true,mustChangePassword:false,
    updatedBy:'actor',updatedByName:'Actor',updatedAt:now,officeName:'UCVM LAB',officeEmail:'lab@ucalgary.ca'
  });
  const faculty=tool.buildProfile({email:'faculty.test@ucalgary.ca',displayName:'Faculty Test',role:'faculty',facultyId:'FAC-TEST',officeName:''},{actor:{uid:'actor',name:'Actor'},now});
  assert.equal(faculty.facultyId,'FAC-TEST');
  assert.deepEqual(faculty.facultyRoles,['faculty']);
  assert.equal(Object.hasOwn(faculty,'officeName'),false);
});

test('bootstrap workflow is manual, passwordless and uses only the lab admin environment',()=>{
  const source=read('.github/workflows/firebase-lab-bootstrap.yml');
  assert.match(source,/workflow_dispatch:/);
  assert.doesNotMatch(source,/\n\s*push:/);
  assert.doesNotMatch(source,/\n\s*pull_request:/);
  assert.match(source,/name:\s*firebase-lab-admin/);
  assert.match(source,/FIREBASE_PROJECT_ID:\s*vista-teaching-lab/);
  assert.match(source,/secrets\.FIREBASE_LAB_SERVICE_ACCOUNT_JSON/);
  assert.match(source,/node tools\/bootstrap-lab-user\.js/);
  assert.doesNotMatch(source,/password:/i);
  assert.doesNotMatch(source,/tester-teaching/);
});
