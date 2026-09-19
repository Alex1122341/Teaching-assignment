'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');

function loadRuntimeConfig(filename=path.join(root,'firebase-config.js'),hostname='red-cliff-04871ca0f.5.azurestaticapps.net'){
  const window={location:{hostname}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{window},{filename});
  return{
    firebaseConfig:window.UCVM_FIREBASE_CONFIG,
    emulator:window.UCVM_FIREBASE_EMULATOR,
    projectId:window.UCVM_FIREBASE_PROJECT_ID,
    doeApiBaseUrl:window.UCVM_DOE_API_BASE_URL
  };
}

function validate(runtime,{expectedProjectId='tester-teaching'}={}){
  if(!runtime?.firebaseConfig)throw Error('Production Firebase client configuration is missing.');
  if(runtime.emulator===true)throw Error('Production client configuration unexpectedly enables emulator mode.');
  if(runtime.projectId!==expectedProjectId||runtime.firebaseConfig.projectId!==expectedProjectId){
    throw Error(`Production Firebase project must be "${expectedProjectId}".`);
  }
  const apiKey=String(runtime.firebaseConfig.apiKey||'');
  if(!apiKey||apiKey.includes('GENERATE_WITH_'))throw Error('Production Firebase API key is still a placeholder.');
  const base=String(runtime.doeApiBaseUrl||'').trim();
  if(!base)throw Error('Production DOE API base URL is missing.');
  let url;
  try{url=new URL(base)}catch{throw Error('Production DOE API base URL is invalid.')}
  if(url.protocol!=='https:')throw Error('Production DOE API base URL must use HTTPS.');
  if(['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname.toLowerCase()))throw Error('Production DOE API base URL must not target localhost.');
  if(url.username||url.password||url.search||url.hash)throw Error('Production DOE API base URL must not contain credentials, query parameters, or a fragment.');
  return true;
}

function main(){
  const runtime=loadRuntimeConfig();
  validate(runtime,{expectedProjectId:process.env.EXPECTED_FIREBASE_PROJECT_ID||'tester-teaching'});
  console.log(`Production client configuration verified for project "${runtime.projectId}" with an HTTPS DOE API endpoint.`);
}

if(require.main===module){
  try{main()}catch(error){console.error(`Production config verification failed: ${error.message}`);process.exit(1)}
}
module.exports={loadRuntimeConfig,validate,main};
