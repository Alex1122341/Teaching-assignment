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

test('Identity Toolkit client uses the lab config endpoint and update mask without leaking credentials or forcing a quota project',async()=>{
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
  assert.equal(calls[0].options.headers['X-Goog-User-Project'],undefined);
});



test('check treats an uninitialized Firebase Authentication project as not ready without mutating it',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    return{
      ok:false,status:404,
      text:async()=>JSON.stringify({error:{status:'NOT_FOUND',message:'CONFIGURATION_NOT_FOUND'}})
    };
  };
  const adminModule={cert:()=>({getAccessToken:async()=>({access_token:'token-value'})})};
  const env={
    FIREBASE_PROJECT_ID:'vista-teaching-lab',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'vista-teaching-lab',client_email:'svc@example.test',private_key:'PRIVATE'})
  };
  const result=await tool.execute({operation:'check',confirmation:''},{env,adminModule,fetchImpl});
  assert.equal(result.after.ready,false);
  assert.equal(result.after.initialized,false);
  assert.deepEqual(calls.map(row=>row.method),['GET']);
});

test('configure initializes Firebase Authentication when project config is missing, then enables email/password and Pages domain',async()=>{
  const calls=[];
  let getCount=0;
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET';
    calls.push({url,method,body:options.body});
    if(method==='GET'){
      getCount+=1;
      if(getCount===1)return{
        ok:false,status:404,
        text:async()=>JSON.stringify({error:{status:'NOT_FOUND',message:'CONFIGURATION_NOT_FOUND'}})
      };
      return{
        ok:true,status:200,
        text:async()=>JSON.stringify({signIn:{email:{enabled:false,passwordRequired:false}},authorizedDomains:['localhost']})
      };
    }
    if(method==='POST'&&url.includes('/identityPlatform:initializeAuth'))return{ok:true,status:200,text:async()=>''};
    if(method==='PATCH')return{
      ok:true,status:200,
      text:async()=>JSON.stringify({signIn:{email:{enabled:true,passwordRequired:true}},authorizedDomains:['localhost','alex1122341.github.io']})
    };
    throw Error('unexpected request '+method+' '+url);
  };
  const adminModule={cert:()=>({getAccessToken:async()=>({access_token:'token-value'})})};
  const env={
    FIREBASE_PROJECT_ID:'vista-teaching-lab',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'vista-teaching-lab',client_email:'svc@example.test',private_key:'PRIVATE'})
  };
  const result=await tool.execute(
    {operation:'configure',confirmation:'CONFIGURE-AUTH:vista-teaching-lab'},
    {env,adminModule,fetchImpl}
  );
  assert.equal(result.initializedNow,true);
  assert.equal(result.after.ready,true);
  assert.equal(result.after.initialized,true);
  assert.deepEqual(calls.map(row=>row.method),['GET','POST','GET','PATCH']);
  assert.match(calls[1].url,/identityPlatform:initializeAuth$/);
  assert.equal(calls[1].headers?.['X-Goog-User-Project'],undefined);
});

test('Firebase Admin v14 modular cert export can mint an access token',async()=>{
  const calls=[];
  const adminModule={
    cert(serviceAccount){
      calls.push(serviceAccount);
      return{getAccessToken:async()=>({access_token:'lab-access-token'})};
    }
  };
  const account={project_id:'vista-teaching-lab',client_email:'svc@example.test',private_key:'PRIVATE'};
  const token=await tool.accessTokenFor(account,{adminModule});
  assert.equal(token,'lab-access-token');
  assert.deepEqual(calls,[account]);
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
