'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=require('../tools/configure-lab-auth.js');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('Auth setup is hard-locked to the Firebase lab project and configure needs exact confirmation',()=>{
  assert.equal(tool.validateOptions({operation:'check',confirmation:''},{projectId:'vista-teaching-lab'}).operation,'check');
  assert.throws(()=>tool.validateOptions({operation:'check'},{projectId:'tester-teaching'}),/vista-teaching-lab/);
  assert.throws(()=>tool.validateOptions({operation:'configure',confirmation:''},{projectId:'vista-teaching-lab'}),/exact confirmation/);
  assert.equal(tool.validateOptions({operation:'configure',confirmation:'CONFIGURE-AUTH:vista-teaching-lab'},{projectId:'vista-teaching-lab'}).operation,'configure');
});

test('Auth readiness requires email password sign-in and the GitHub Pages domain',()=>{
  const ready=tool.authReadiness({
    signIn:{email:{enabled:true,passwordRequired:true}},
    authorizedDomains:['localhost','alex1122341.github.io']
  });
  assert.equal(ready.ready,true);
  assert.equal(ready.pagesDomainAuthorized,true);
  assert.equal(tool.authReadiness({signIn:{email:{enabled:false,passwordRequired:true}},authorizedDomains:['alex1122341.github.io']}).ready,false);
  assert.equal(tool.authReadiness({signIn:{email:{enabled:true,passwordRequired:true}},authorizedDomains:['localhost']}).ready,false);
});

test('configured Auth patch preserves existing domains and enables password sign-in',()=>{
  const patch=tool.configuredPatch({
    signIn:{email:{enabled:false,passwordRequired:false},phoneNumber:{enabled:true}},
    authorizedDomains:['Example.COM','localhost','example.com']
  });
  assert.deepEqual(patch.signIn,{email:{enabled:true,passwordRequired:true}});
  assert.deepEqual(patch.authorizedDomains,['alex1122341.github.io','example.com','localhost']);
});

test('Identity Toolkit client uses the lab config endpoint and update mask without leaking credentials',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return{
      ok:true,status:200,
      text:async()=>JSON.stringify({signIn:{email:{enabled:true,passwordRequired:true}},authorizedDomains:['alex1122341.github.io']})
    };
  };
  await tool.identityRequest({accessToken:'token-value',fetchImpl});
  await tool.identityRequest({method:'PATCH',accessToken:'token-value',body:{signIn:{email:{enabled:true,passwordRequired:true}},authorizedDomains:['alex1122341.github.io']},fetchImpl});
  assert.equal(calls[0].url,'https://identitytoolkit.googleapis.com/admin/v2/projects/vista-teaching-lab/config');
  assert.match(calls[1].url,/updateMask=signIn\.email,authorizedDomains$/);
  assert.equal(calls[0].options.headers.Authorization,'Bearer token-value');
  assert.equal(calls[0].options.headers['X-Goog-User-Project'],'vista-teaching-lab');
});

test('Firebase Lab Auth Setup workflow is manual, lab-only and uses the protected Admin environment',()=>{
  const source=read('.github/workflows/firebase-lab-auth-setup.yml');
  assert.match(source,/workflow_dispatch:/);
  assert.doesNotMatch(source,/\n\s*push:/);
  assert.doesNotMatch(source,/\n\s*pull_request:/);
  assert.match(source,/name:\s*firebase-lab-admin/);
  assert.match(source,/FIREBASE_PROJECT_ID:\s*vista-teaching-lab/);
  assert.match(source,/secrets\.FIREBASE_LAB_SERVICE_ACCOUNT_JSON/);
  assert.match(source,/CONFIGURE-AUTH:vista-teaching-lab/);
  assert.match(source,/npm --prefix server install --no-audit --no-fund/);
  assert.doesNotMatch(source,/server\/package-lock\.json|npm --prefix server ci/);
  assert.match(source,/node tools\/configure-lab-auth\.js/);
  assert.doesNotMatch(source,/tester-teaching/);
});
