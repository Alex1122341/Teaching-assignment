'use strict';
const path=require('node:path');
const {loadRuntimeConfig}=require('./verify-production-client-config');

function validatePreview(runtime,{expectedProjectId='vista-teaching-lab'}={}){
  if(!runtime?.firebaseConfig)throw Error('Preview Firebase client configuration is missing.');
  if(runtime.emulator===true)throw Error('GitHub Pages preview must not enable local emulator mode.');
  if(runtime.projectId!==expectedProjectId||runtime.firebaseConfig.projectId!==expectedProjectId){
    throw Error(`Preview Firebase project must be "${expectedProjectId}".`);
  }
  const config=runtime.firebaseConfig;
  const apiKey=String(config.apiKey||'').trim();
  if(!apiKey||apiKey.includes('GENERATE_WITH_')||!/^AIza[0-9A-Za-z_-]{35}$/.test(apiKey)){
    throw Error('Preview Firebase API key is missing, placeholder, or invalid.');
  }
  if(String(config.authDomain||'')!==`${expectedProjectId}.firebaseapp.com`){
    throw Error('Preview Firebase authDomain does not match the isolated lab project.');
  }
  if(String(runtime.doeApiBaseUrl||'').trim()){
    throw Error('GitHub Pages preview must not be configured to reach a DOE API endpoint.');
  }
  return true;
}

function main(){
  const expected=process.env.EXPECTED_FIREBASE_PROJECT_ID||'vista-teaching-lab';
  const runtime=loadRuntimeConfig(path.resolve(__dirname,'..','firebase-config.js'),'alex1122341.github.io');
  validatePreview(runtime,{expectedProjectId:expected});
  console.log(`Preview client configuration verified for isolated project "${runtime.projectId}".`);
}

if(require.main===module){
  try{main()}catch(error){console.error(`Preview config verification failed: ${error.message}`);process.exit(1)}
}
module.exports={validatePreview,main};
