'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=require('../tools/seed-lab-admin.js');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('lab data setup is hard-locked to vista-teaching-lab',()=>{
  assert.equal(tool.validateOptions({mode:'verify'},{projectId:'vista-teaching-lab'}).mode,'verify');
  assert.equal(tool.validateOptions({mode:'seed'},{projectId:'vista-teaching-lab'}).mode,'seed');
  assert.throws(()=>tool.validateOptions({mode:'seed'},{projectId:'tester-teaching'}),/vista-teaching-lab/);
  assert.throws(()=>tool.validateOptions({mode:'delete'},{projectId:'vista-teaching-lab'}),/Unknown/);
});

test('seed planner keeps Firestore batches within safe write limits',()=>{
  const documents=Array.from({length:901},(_,index)=>({path:`x/${index}`,data:{index}}));
  const chunks=tool.chunkDocuments(documents,400);
  assert.deepEqual(chunks.map(chunk=>chunk.length),[400,400,101]);
  assert.equal(chunks.flat().length,documents.length);
});

test('Firebase Lab Data Setup is manual, lab-only and confirmation-gated',()=>{
  const source=read('.github/workflows/firebase-lab-data-setup.yml');
  assert.match(source,/workflow_dispatch:/);
  assert.doesNotMatch(source,/\n\s*push:/);
  assert.doesNotMatch(source,/\n\s*pull_request:/);
  assert.match(source,/contents:\s*read/);
  assert.match(source,/name:\s*firebase-lab-admin/);
  assert.match(source,/FIREBASE_PROJECT_ID:\s*vista-teaching-lab/);
  assert.match(source,/secrets\.FIREBASE_LAB_SERVICE_ACCOUNT_JSON/);
  assert.match(source,/SEED:vista-teaching-lab/);
  assert.match(source,/DEPLOY-FIRESTORE:vista-teaching-lab/);
  assert.match(source,/PROVISION:vista-teaching-lab/);
  assert.match(source,/GOOGLE_APPLICATION_CREDENTIALS/);
  assert.match(source,/firebase deploy --only firestore --project vista-teaching-lab --non-interactive/);
  assert.doesNotMatch(source,/git push origin|github\.event_name == 'push'|AZURE_|tester-teaching/);
});

test('admin seeder consumes the canonical deterministic dataset instead of defining a second schema',()=>{
  const source=read('tools/seed-lab-admin.js');
  assert.match(source,/require\('\.\/seed\/dataset\.js'\)/);
  assert.match(source,/buildDataset\(\)/);
  assert.doesNotMatch(source,/faculty:\s*\[/);
});


test('lab config pin can create a named Web App when none exists',()=>{
  const pin=require('../tools/pin-lab-firebase-web-config.js');
  const calls=[];
  let listed=0;
  const good={
    apiKey:'AIza'+'A'.repeat(35),
    authDomain:'vista-teaching-lab.firebaseapp.com',
    projectId:'vista-teaching-lab',
    storageBucket:'vista-teaching-lab.firebasestorage.app',
    messagingSenderId:'123456789012',
    appId:'1:123456789012:web:abcdef0123456789abcdef'
  };
  const execImpl=(binary,args)=>{
    calls.push(args.slice());
    if(args[0]==='apps:list'){
      listed+=1;
      return listed===1?JSON.stringify({result:[]}):JSON.stringify({result:[{platform:'WEB',displayName:'VISTA GitHub Pages Lab',appId:good.appId}]});
    }
    if(args[0]==='apps:create')return JSON.stringify({result:{appId:good.appId}});
    if(args[0]==='apps:sdkconfig')return JSON.stringify({result:{sdkConfig:good}});
    throw new Error('unexpected command');
  };
  assert.equal(pin.fetchLabConfig({args:[],execImpl}).projectId,'vista-teaching-lab');
  assert.ok(calls.some(args=>args[0]==='apps:create'&&args[1]==='WEB'));
});
