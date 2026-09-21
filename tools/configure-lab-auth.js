'use strict';

const path=require('node:path');
const {createRequire}=require('node:module');
const {parseServiceAccount}=require('./bootstrap-lab-user.js');

const LAB_PROJECT_ID='vista-teaching-lab';
const PAGES_DOMAIN='alex1122341.github.io';
const OPERATIONS=new Set(['check','configure']);
const CONFIGURE_CONFIRMATION=`CONFIGURE-AUTH:${LAB_PROJECT_ID}`;
const text=value=>String(value??'').trim();

function readArg(argv,name,fallback=''){
  const index=argv.indexOf(name);
  return index>=0&&argv[index+1]!==undefined?argv[index+1]:fallback;
}

function parseArgs(argv=process.argv.slice(2)){
  return{
    operation:text(readArg(argv,'--operation','check')).toLowerCase()||'check',
    confirmation:text(readArg(argv,'--confirmation'))
  };
}

function validateOptions(options,{projectId=process.env.FIREBASE_PROJECT_ID}={}){
  const normalized={
    operation:text(options?.operation||'check').toLowerCase(),
    confirmation:text(options?.confirmation)
  };
  if(text(projectId)!==LAB_PROJECT_ID)throw Error(`Firebase lab Auth configuration is locked to "${LAB_PROJECT_ID}".`);
  if(!OPERATIONS.has(normalized.operation))throw Error('Unknown Firebase lab Auth operation.');
  if(normalized.operation==='configure'&&normalized.confirmation!==CONFIGURE_CONFIRMATION){
    throw Error(`Auth configuration requires exact confirmation "${CONFIGURE_CONFIRMATION}".`);
  }
  return normalized;
}

function normalizeDomains(value){
  return [...new Set((Array.isArray(value)?value:[]).map(item=>text(item).toLowerCase()).filter(Boolean))].sort();
}

function authReadiness(config={}){
  const domains=normalizeDomains(config.authorizedDomains);
  const email=config?.signIn?.email||{};
  return{
    projectId:LAB_PROJECT_ID,
    emailEnabled:email.enabled===true,
    passwordRequired:email.passwordRequired===true,
    pagesDomainAuthorized:domains.includes(PAGES_DOMAIN),
    authorizedDomains:domains,
    ready:email.enabled===true&&email.passwordRequired===true&&domains.includes(PAGES_DOMAIN)
  };
}

function configuredPatch(config={}){
  const currentDomains=normalizeDomains(config.authorizedDomains);
  return{
    signIn:{
      email:{
        enabled:true,
        passwordRequired:true
      }
    },
    authorizedDomains:normalizeDomains([...currentDomains,PAGES_DOMAIN])
  };
}

function identityConfigUrl(projectId=LAB_PROJECT_ID){
  return `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config`;
}

function identityInitializeUrl(projectId=LAB_PROJECT_ID){
  return `https://identitytoolkit.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/identityPlatform:initializeAuth`;
}

async function identityRequest({method='GET',accessToken,body,fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw Error('fetch is unavailable.');
  const token=text(accessToken);
  if(!token)throw Error('Google access token is required.');
  const url=method==='PATCH'
    ?`${identityConfigUrl()}?updateMask=signIn.email,authorizedDomains`
    :identityConfigUrl();
  const response=await fetchImpl(url,{
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json',
      'X-Goog-User-Project':LAB_PROJECT_ID
    },
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const raw=await response.text();
  let payload={};
  try{payload=raw?JSON.parse(raw):{}}catch{payload={raw:raw.slice(0,500)}}
  if(!response.ok){
    const message=text(payload?.error?.message)||`HTTP ${response.status}`;
    const error=Error(`Identity Toolkit ${method} failed: ${message}`);
    error.statusCode=response.status;
    error.apiCode=text(payload?.error?.message||payload?.error?.status);
    throw error;
  }
  return payload;
}

async function initializeIdentityPlatform({accessToken,fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw Error('fetch is unavailable.');
  const token=text(accessToken);
  if(!token)throw Error('Google access token is required.');
  const response=await fetchImpl(identityInitializeUrl(),{
    method:'POST',
    headers:{
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json',
      'X-Goog-User-Project':LAB_PROJECT_ID
    },
    body:'{}'
  });
  const raw=await response.text();
  let payload={};
  try{payload=raw?JSON.parse(raw):{}}catch{payload={raw:raw.slice(0,500)}}
  if(!response.ok){
    const message=text(payload?.error?.message)||`HTTP ${response.status}`;
    const error=Error(`Identity Toolkit initializeAuth failed: ${message}`);
    error.statusCode=response.status;
    error.apiCode=text(payload?.error?.status||payload?.error?.message);
    throw error;
  }
  return payload;
}

function loadFirebaseAdmin(){
  const root=path.resolve(__dirname,'..');
  const requireFromServer=createRequire(path.join(root,'server','package.json'));
  try{return requireFromServer('firebase-admin/app')}
  catch(error){
    error.message=`firebase-admin is required. Run "npm --prefix server install --no-audit --no-fund". ${error.message}`;
    throw error;
  }
}

async function accessTokenFor(serviceAccount,{adminModule}={}){
  const admin=adminModule||loadFirebaseAdmin();
  const certFn=typeof admin?.cert==='function'?admin.cert:admin?.credential?.cert;
  if(typeof certFn!=='function')throw Error('Firebase Admin SDK does not expose a compatible cert() credential factory.');
  const credential=certFn.call(admin?.credential||admin,serviceAccount);
  const value=await credential.getAccessToken();
  const token=text(value?.access_token||value?.accessToken);
  if(!token)throw Error('Firebase Admin credential did not return a Google access token.');
  return token;
}

async function execute(options,{env=process.env,adminModule,fetchImpl=globalThis.fetch}={}){
  const normalized=validateOptions(options,{projectId:env.FIREBASE_PROJECT_ID});
  const account=parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const accessToken=await accessTokenFor(account,{adminModule});
  let current,initializedNow=false;
  try{
    current=await identityRequest({accessToken,fetchImpl});
  }catch(error){
    if(error?.apiCode!=='CONFIGURATION_NOT_FOUND')throw error;
    const beforeMissing={...authReadiness({}),initialized:false};
    if(normalized.operation==='check'){
      return{operation:'check',changed:false,before:beforeMissing,after:beforeMissing};
    }
    await initializeIdentityPlatform({accessToken,fetchImpl});
    initializedNow=true;
    current=await identityRequest({accessToken,fetchImpl});
  }
  const before={...authReadiness(current),initialized:true};

  if(normalized.operation==='check'){
    return{operation:'check',changed:false,before,after:before};
  }

  const patch=configuredPatch(current);
  current=await identityRequest({method:'PATCH',accessToken,body:patch,fetchImpl});
  const after={...authReadiness(current),initialized:true};
  if(!after.ready)throw Error('Firebase Authentication configuration is still not ready after the update.');
  return{operation:'configure',changed:initializedNow||JSON.stringify(before)!==JSON.stringify(after),initializedNow,before,after};
}

async function main(){
  const result=await execute(parseArgs());
  console.log(JSON.stringify(result,null,2));
  if(!result.after.ready){
    console.error(`Firebase lab Auth is not ready: emailEnabled=${result.after.emailEnabled}, passwordRequired=${result.after.passwordRequired}, pagesDomainAuthorized=${result.after.pagesDomainAuthorized}`);
    process.exitCode=2;
  }
}

if(require.main===module){
  main().catch(error=>{console.error(`Firebase lab Auth configuration failed: ${error.message}`);process.exit(1);});
}

module.exports={
  LAB_PROJECT_ID,PAGES_DOMAIN,OPERATIONS,CONFIGURE_CONFIRMATION,
  parseArgs,validateOptions,normalizeDomains,authReadiness,configuredPatch,
  identityConfigUrl,identityInitializeUrl,identityRequest,initializeIdentityPlatform,accessTokenFor,execute,main
};
