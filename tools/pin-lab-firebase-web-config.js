'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {normalize}=require('./build-firebase-config.js');

const PROJECT_ID='vista-teaching-lab';
const DEFAULT_WEB_APP_NAME='VISTA GitHub Pages Lab';
const root=path.resolve(__dirname,'..');
const target=path.join(__dirname,'lab-firebase-web-config.json');
const REAL_API_KEY=/^AIza[0-9A-Za-z_-]{35}$/;

function argValue(args,name){
  const index=args.indexOf(name);
  return index>=0&&args[index+1]?String(args[index+1]).trim():'';
}

function parseJson(raw,label='Firebase CLI'){
  try{return JSON.parse(String(raw||''));}
  catch{throw new Error(`${label} returned invalid JSON.`);}
}

function runFirebase(execImpl,args){
  try{
    return execImpl('firebase',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','inherit']});
  }catch{
    throw new Error(`firebase ${args.join(' ')} failed. Authenticate to the lab project and confirm the credential can manage Firebase Web Apps.`);
  }
}

function extractSdkConfig(parsed){
  return parsed?.result?.sdkConfig||parsed?.sdkConfig||parsed;
}

function extractApps(parsed){
  const value=parsed?.result||parsed?.apps||parsed;
  return Array.isArray(value)?value:[];
}

function isWebApp(app){
  const platform=String(app?.platform||app?.platformId||'').toUpperCase();
  return platform==='WEB'||String(app?.appId||'').includes(':web:');
}

function chooseWebApp(apps,{displayName=DEFAULT_WEB_APP_NAME}={}){
  const web=(Array.isArray(apps)?apps:[]).filter(isWebApp);
  const named=web.find(app=>String(app?.displayName||'')===displayName);
  if(named)return named;
  if(web.length===1)return web[0];
  if(web.length>1)throw new Error('Multiple Firebase Web Apps exist. Pass --app <appId> to choose one explicitly.');
  return null;
}

function listWebApps(execImpl){
  const raw=runFirebase(execImpl,['apps:list','--project',PROJECT_ID,'--json']);
  return extractApps(parseJson(raw,'firebase apps:list'));
}

function ensureWebApp({execImpl=execFileSync,displayName=DEFAULT_WEB_APP_NAME}={}){
  let app=chooseWebApp(listWebApps(execImpl),{displayName});
  if(app)return String(app.appId||'').trim();
  runFirebase(execImpl,['apps:create','WEB',displayName,'--project',PROJECT_ID,'--json']);
  app=chooseWebApp(listWebApps(execImpl),{displayName});
  const appId=String(app?.appId||'').trim();
  if(!appId)throw new Error('Firebase Web App creation completed but no Web App ID could be resolved.');
  return appId;
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
  const appId=argValue(args,'--app')||ensureWebApp({execImpl});
  const raw=runFirebase(execImpl,['apps:sdkconfig','WEB',appId,'--project',PROJECT_ID,'--json']);
  return validateLabConfig(extractSdkConfig(parseJson(raw,'firebase apps:sdkconfig')));
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

module.exports={
  PROJECT_ID,DEFAULT_WEB_APP_NAME,REAL_API_KEY,argValue,parseJson,extractSdkConfig,extractApps,isWebApp,
  chooseWebApp,listWebApps,ensureWebApp,validateLabConfig,fetchLabConfig,main
};
