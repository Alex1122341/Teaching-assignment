'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=require('../tools/set-lab-user-password.js');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const target={email:'adfa@ucalgary.ca',confirmation:'SET-LAB-PASSWORD:adfa@ucalgary.ca:vista-teaching-lab'};
const envFor=(overrides={})=>({FIREBASE_PROJECT_ID:'vista-teaching-lab',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'vista-teaching-lab',client_email:'lab-admin@example.test',private_key:'not-a-real-key'}),LAB_SYNTHETIC_ACCOUNT_PASSWORD:'synthetic-password-value',...overrides});

test('password setter locks the project and the single bootstrapped UCalgary account',()=>{
  assert.deepEqual(tool.validateOptions(target,{projectId:'vista-teaching-lab'}),target);
  assert.throws(()=>tool.validateOptions(target,{projectId:'tester-teaching'}),/vista-teaching-lab/);
  assert.throws(()=>tool.validateOptions({...target,email:'someone@example.com'},{projectId:'vista-teaching-lab'}),/@ucalgary\.ca/);
  assert.throws(()=>tool.validateOptions({...target,email:'other@ucalgary.ca'},{projectId:'vista-teaching-lab'}),/adfa@ucalgary\.ca/);
});

test('password setter requires exact explicit confirmation and a protected password env value',()=>{
  assert.throws(()=>tool.validateOptions({...target,confirmation:''},{projectId:'vista-teaching-lab'}),/exact confirmation/);
  assert.throws(()=>tool.getPassword({}),/LAB_SYNTHETIC_ACCOUNT_PASSWORD/);
  assert.throws(()=>tool.getPassword({LAB_SYNTHETIC_ACCOUNT_PASSWORD:''}),/LAB_SYNTHETIC_ACCOUNT_PASSWORD/);
  assert.equal(tool.getPassword(envFor()),'synthetic-password-value');
  assert.throws(()=>tool.parseArgs(['--password','do-not-accept-cli-password']),/LAB_SYNTHETIC_ACCOUNT_PASSWORD/);
});

test('password setter fails when the existing Auth user is absent and never creates one',async()=>{
  const calls=[];
  const admin={apps:[],initializeApp(){},credential:{cert:()=>({})},auth:()=>({
    getUserByEmail:async email=>{calls.push(['getUserByEmail',email]);const error=new Error('not found');error.code='auth/user-not-found';throw error;},
    createUser:async()=>{calls.push(['createUser']);throw Error('must not be called');}
  })};
  await assert.rejects(tool.execute(target,{env:envFor(),adminModule:admin}),/Firebase Auth user was not found/);
  assert.deepEqual(calls,[['getUserByEmail','adfa@ucalgary.ca']]);
});

test('password setter refuses an already initialized Admin app for another project',async()=>{
  const admin={apps:[{}],app:()=>({options:{projectId:'tester-teaching'}}),auth:()=>{throw Error('must not be called');}};
  await assert.rejects(tool.execute(target,{env:envFor(),adminModule:admin}),/must belong to "vista-teaching-lab"/);
});

test('password update targets the same existing UID without user creation or Firestore access',async()=>{
  const calls=[];let passwordWasUpdated=false;
  const before={uid:'stable-user-uid',email:'adfa@ucalgary.ca'};
  const after={...before};
  const auth={
    getUserByEmail:async email=>{calls.push(['getUserByEmail',email]);return before;},
    updateUser:async(uid,patch)=>{calls.push(['updateUser',uid,Object.keys(patch)]);assert.equal(patch.password,'synthetic-password-value');passwordWasUpdated=true;return after;},
    getUser:async uid=>{calls.push(['getUser',uid]);return passwordWasUpdated?after:before;},
    createUser:async()=>{calls.push(['createUser']);throw Error('must not be called');}
  };
  const admin={apps:[],initializeApp(){},credential:{cert:()=>({})},auth:()=>auth,firestore:()=>{calls.push(['firestore']);throw Error('must not be called');}};
  const result=await tool.execute(target,{env:envFor(),adminModule:admin});
  assert.deepEqual(calls,[['getUserByEmail','adfa@ucalgary.ca'],['updateUser','stable-user-uid',['password']],['getUser','stable-user-uid']]);
  assert.deepEqual(result,{projectId:'vista-teaching-lab',email:'adfa@ucalgary.ca',uidPreserved:true,passwordUpdated:true});
  assert.doesNotMatch(JSON.stringify(result),/synthetic-password-value/);
});

test('password never appears in failure output even if Firebase throws it back',async()=>{
  const password='synthetic-password-value';
  const admin={apps:[],initializeApp(){},credential:{cert:()=>({})},auth:()=>({
    getUserByEmail:async()=>({uid:'stable-user-uid',email:'adfa@ucalgary.ca'}),
    updateUser:async()=>{throw Error(`remote diagnostic ${password}`);}
  })};
  await assert.rejects(tool.execute(target,{env:envFor({LAB_SYNTHETIC_ACCOUNT_PASSWORD:password}),adminModule:admin}),error=>{
    assert.doesNotMatch(error.message,new RegExp(password));
    return true;
  });
});

test('workflow uses the protected environment secret and has no password text input',()=>{
  const source=read('.github/workflows/firebase-lab-set-password.yml');
  assert.match(source,/workflow_dispatch:/);
  assert.match(source,/name:\s*firebase-lab-admin/);
  assert.match(source,/cache-dependency-path:\s*package-lock\.json/);
  assert.equal(fs.existsSync(path.join(root,'package-lock.json')),true);
  assert.match(source,/npm --prefix server install --no-audit --no-fund/);
  assert.doesNotMatch(source,/npm --prefix server ci/);
  assert.match(source,/FIREBASE_PROJECT_ID:\s*vista-teaching-lab/);
  assert.match(source,/FIREBASE_SERVICE_ACCOUNT_JSON:\s*\$\{\{\s*secrets\.FIREBASE_LAB_SERVICE_ACCOUNT_JSON\s*\}\}/);
  assert.match(source,/LAB_SYNTHETIC_ACCOUNT_PASSWORD:\s*\$\{\{\s*secrets\.LAB_SYNTHETIC_ACCOUNT_PASSWORD\s*\}\}/);
  assert.doesNotMatch(source,/inputs\.password|password:\s*\n\s*description:/i);
  assert.doesNotMatch(source,/tester-teaching/);
  assert.match(source,/node tools\/set-lab-user-password\.js/);
});
