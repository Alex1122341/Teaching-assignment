'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {normalize}=require('./build-firebase-config.js');

const PROJECT_ID='vista-teaching-lab';
const root=path.resolve(__dirname,'..');
const target=path.join(__dirname,'lab-firebase-web-config.json');
const REAL_API_KEY=/^AIza[0-9A-Za-z_-]{35}$/;

function argValue(args,name){
  const index=args.indexOf(name);
  return index>=0&&args[index+1]?String(args[index+1]).trim():'';
}

function extractSdkConfig(parsed){
  return parsed?.result?.sdkConfig||parsed?.sdkConfig||parsed;
}

function validateLabConfig(input){
  const config=normalize(input);
  if(config.projectId!==PROJECT_ID)throw new Error(`Firebase config must target "${PROJECT_ID}".`);
  if(config.authDomain!==`${PROJECT_ID}.firebaseapp.com`)throw new Error('Firebase authDomain does not match the lab project.');
  if(!REAL_API_KEY.test(String(config.apiKey||'')))throw new Error('Firebase lab Web API key is missing or invalid.');
  if(!/^\d+$/.test(String(config.messagingSenderId||'')))throw new Error('Firebase messagingSenderId is invalid.');
  if(!/^1:\d+:web:[0-9a-f]+$/i.test(String(config.appId||'')))throw new Error('Firebase appId is invalid.');
  return config;
}

function fetchLabConfig({args=process.argv.slice(2),execImpl=execFileSync}={}){
  const appId=argValue(args,'--app');
  const command=['apps:sdkconfig','web'];
  if(appId)command.push(appId);
  command.push('--project',PROJECT_ID,'--json');
  let raw;
  try{
    raw=execImpl('firebase',command,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','inherit']});
  }catch{
    throw new Error(`firebase ${command.join(' ')} failed. Run "firebase login" and confirm the lab project has a registered Web app.`);
  }
  let parsed;
  try{parsed=JSON.parse(raw)}catch{throw new Error('Firebase CLI returned invalid JSON.');}
  return validateLabConfig(extractSdkConfig(parsed));
}

function main(){
  const config=fetchLabConfig();
  fs.writeFileSync(target,JSON.stringify(config,null,2)+'\n');
  console.log(`Pinned public Firebase Web SDK config for "${PROJECT_ID}" to ${path.relative(root,target)}.`);
  console.log('No service-account credential or private key was written.');
}

if(require.main===module){
  try{main()}catch(error){console.error(`Lab config pin failed: ${error.message}`);process.exit(1);}
}

module.exports={PROJECT_ID,REAL_API_KEY,argValue,extractSdkConfig,validateLabConfig,fetchLabConfig,main};
