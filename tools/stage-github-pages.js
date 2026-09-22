'use strict';
const fs=require('node:fs');
const path=require('node:path');
const BANNER_ID='github-pages-test-site-banner';
const BANNER_CLASS='github-pages-test-site-notice';
const DEMO_DATA_FILE='pages-demo-data.js';
const DEMO_RUNTIME_FILE='pages-demo-runtime.js';
const LAB_RUNTIME_FILE='firebase-lab-runtime.js';
const LAB_DOE_FILE='doe-policy-firebase-lab.js';
const LAB_BANNER_ID='firebase-lab-mode-banner';
const LAB_PROJECT_ID='vista-teaching-lab';
const LAB_CONFIG_FILE='lab-firebase-web-config.json';
const REAL_API_KEY=/^AIza[0-9A-Za-z_-]{35}$/;
const {buildDataset}=require('./seed/dataset.js');

function normalizeIdentity(input={}){
  const prNumber=Number(input.prNumber);
  const headSha=String(input.headSha||'').trim().toLowerCase();
  const buildSha=String(input.buildSha||'').trim().toLowerCase();
  if(!Number.isInteger(prNumber)||prNumber<1)throw Error('PR number must be a positive integer.');
  if(!/^[0-9a-f]{40}$/.test(headSha))throw Error('Head SHA must be 40 hexadecimal characters.');
  if(!/^[0-9a-f]{40}$/.test(buildSha))throw Error('Build SHA must be 40 hexadecimal characters.');
  return{prNumber,headSha,buildSha};
}

// Firebase Lab artifacts are produced by a manual dispatch, not by a pull
// request, so PR number 0 is valid there.
function normalizeLabIdentity(input={}){
  const headSha=String(input.headSha||'').trim().toLowerCase();
  const buildSha=String(input.buildSha||'').trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(headSha))throw Error('Head SHA must be 40 hexadecimal characters.');
  if(!/^[0-9a-f]{40}$/.test(buildSha))throw Error('Build SHA must be 40 hexadecimal characters.');
  const prNumber=Number(input.prNumber);
  return{prNumber:Number.isInteger(prNumber)&&prNumber>=0?prNumber:0,headSha,buildSha};
}

function bannerMarkup(identity){
  const value=normalizeIdentity(identity);
  return `<style id="github-pages-test-site-style">.${BANNER_CLASS}{position:fixed;top:10px;right:10px;z-index:2147483647;max-width:390px;padding:9px 12px;border:2px solid #8a6d00;border-radius:8px;background:#fff3cd;color:#3d3300;font:700 12px/1.35 Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.22)}.${BANNER_CLASS} small{display:block;margin-top:2px;font-weight:600}</style><div id="${BANNER_ID}" class="${BANNER_CLASS}" role="status">TEST SITE - GitHub Pages<small>Frontend Demo · synthetic browser-local data · DOE backend off · PR #${value.prNumber} · ${value.headSha.slice(0,7)}</small></div>`;
}

function injectTestBanner(html,identity){
  const source=String(html);
  if(source.includes(`id="${BANNER_ID}"`))return source;
  if(!/<body(?:\s[^>]*)?>/i.test(source))throw Error('HTML file is missing a <body> element.');
  return source.replace(/<body(?:\s[^>]*)?>/i,match=>`${match}\n${bannerMarkup(identity)}`);
}

function demoScriptTags(){
  return '<script src="./'+DEMO_DATA_FILE+'"></script><script src="./'+DEMO_RUNTIME_FILE+'"></script>';
}

function labBannerMarkup(identity){
  const value=normalizeLabIdentity(identity);
  return `<style id="firebase-lab-mode-style">.${BANNER_CLASS}{position:fixed;top:10px;right:10px;z-index:2147483647;max-width:430px;padding:9px 12px;border:2px solid #1a4f96;border-radius:8px;background:#e7f1ff;color:#0b2d5c;font:700 12px/1.35 Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.22)}.${BANNER_CLASS} small{display:block;margin-top:2px;font-weight:600}</style><div id="${LAB_BANNER_ID}" class="${BANNER_CLASS}" role="status">FIREBASE LAB - real Firebase<small>vista-teaching-lab · Auth + Firestore · DOE data LIVE · DOE writer OFF · PR #${value.prNumber} · ${value.headSha.slice(0,7)}</small></div>`;
}

function injectLabBanner(html,identity){
  const source=String(html);
  if(source.includes(`id="${LAB_BANNER_ID}"`))return source;
  if(!/<body(?:\s[^>]*)?>/i.test(source))throw Error('HTML file is missing a <body> element.');
  return source.replace(/<body(?:\s[^>]*)?>/i,match=>`${match}\n${labBannerMarkup(identity)}`);
}

function labScriptTags(){
  return '<script src="./'+LAB_DOE_FILE+'"></script><script src="./'+LAB_RUNTIME_FILE+'"></script>';
}

// Firebase Lab runtime must load AFTER firebase-config.js so it can force the
// lab project and disable the emulator redirect that firebase-config.js applies
// to localhost.
function injectLabRuntime(html){
  const source=String(html);
  if(source.includes(LAB_RUNTIME_FILE))return source;
  const tags=labScriptTags();
  const configTag=/<script[^>]+firebase-config\.js[^>]*><\/script>/i;
  if(configTag.test(source))return source.replace(configTag,match=>match+'\n'+tags);
  const firestoreTag=/<script[^>]+firebase-firestore-compat\.js[^>]*><\/script>/i;
  if(firestoreTag.test(source))return source.replace(firestoreTag,match=>match+'\n'+tags);
  throw Error('Could not find a safe insertion point for the Firebase Lab runtime.');
}

function readLabConfig({configPath,allowPlaceholderConfig=false}={}){
  const file=configPath?path.resolve(configPath):path.join(__dirname,LAB_CONFIG_FILE);
  let raw='';
  if(fs.existsSync(file))raw=fs.readFileSync(file,'utf8');
  if(!String(raw||'').trim()&&process.env.UCVM_LAB_FIREBASE_WEB_CONFIG){
    raw=String(process.env.UCVM_LAB_FIREBASE_WEB_CONFIG);
  }
  if(!String(raw||'').trim())throw Error('Firebase Lab web configuration is missing. Provide tools/'+LAB_CONFIG_FILE+' or UCVM_LAB_FIREBASE_WEB_CONFIG.');
  let config;
  try{config=JSON.parse(raw);}
  catch{throw Error('Firebase Lab web configuration is not valid JSON.');}
  if(String(config.projectId||'').trim()!==LAB_PROJECT_ID){
    throw Error(`Firebase Lab web configuration must target ${LAB_PROJECT_ID}.`);
  }
  if(!allowPlaceholderConfig&&!REAL_API_KEY.test(String(config.apiKey||'').trim())){
    throw Error('Firebase Lab web configuration has no valid public web API key. Run tools/pin-lab-firebase-web-config.js or supply UCVM_LAB_FIREBASE_WEB_CONFIG.');
  }
  return{
    apiKey:String(config.apiKey||'').trim(),
    authDomain:String(config.authDomain||'').trim(),
    projectId:LAB_PROJECT_ID,
    storageBucket:String(config.storageBucket||'').trim(),
    messagingSenderId:String(config.messagingSenderId||'').trim(),
    appId:String(config.appId||'').trim()
  };
}

function writeLabRuntime(directory,options={}){
  const target=path.resolve(directory);
  const config=readLabConfig(options);
  fs.copyFileSync(path.join(__dirname,LAB_DOE_FILE),path.join(target,LAB_DOE_FILE));
  fs.copyFileSync(path.join(__dirname,LAB_RUNTIME_FILE),path.join(target,LAB_RUNTIME_FILE));
  const configFile=path.join(target,'firebase-config.js');
  if(!fs.existsSync(configFile))throw Error('firebase-config.js is missing from the Pages directory.');
  const source=fs.readFileSync(configFile,'utf8');
  const replacement=`const config = ${JSON.stringify(config,null,2).replace(/\n/g,'\n  ')};`;
  const updated=source.replace(/const\s+config\s*=\s*\{[\s\S]*?\};/,replacement);
  if(updated===source)throw Error('Could not rewrite firebase-config.js for Firebase Lab mode.');
  fs.writeFileSync(configFile,updated);
  return{config:Object.assign({},config,{apiKey:'<public-web-api-key>'}),files:[LAB_DOE_FILE,LAB_RUNTIME_FILE,'firebase-config.js']};
}

function injectDemoRuntime(html){
  const source=String(html);
  if(source.includes(DEMO_RUNTIME_FILE))return source;
  const tags=demoScriptTags();
  const firebaseMarker=/<script[^>]+firebase-firestore-compat\.js[^>]*><\/script>/i;
  if(firebaseMarker.test(source))return source.replace(firebaseMarker,match=>match+'\n'+tags);
  const authBundle=/<script[^>]+(?:bundles\/shared-auth\.bundle\.js|firebase-config\.js)[^>]*><\/script>/i;
  if(authBundle.test(source))return source.replace(authBundle,match=>tags+'\n'+match);
  throw Error('Could not find a safe insertion point for the GitHub Pages demo runtime.');
}

function writeDemoRuntime(directory){
  const dataset=buildDataset();
  const payload={version:3,generatedFrom:dataset.generatedFrom,counts:dataset.counts,documents:dataset.documents};
  fs.writeFileSync(path.join(directory,DEMO_DATA_FILE),'window.UCVM_PAGES_DEMO_SEED='+JSON.stringify(payload)+';\n');
  fs.copyFileSync(path.join(__dirname,DEMO_RUNTIME_FILE),path.join(directory,DEMO_RUNTIME_FILE));
  return dataset.documents.length;
}

function buildFacultyDashboardRedirect(identity){
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./index.html"><title>Redirecting…</title></head><body><p>Redirecting to <a href="./index.html">UCVM Timetable</a>…</p><script>window.location.replace('./index.html');</script></body></html>`;
  return injectTestBanner(html,identity);
}

function buildLabDashboardRedirect(identity){
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./index.html"><title>Redirecting…</title></head><body><p>Redirecting to <a href="./index.html">UCVM Timetable</a>…</p><script>window.location.replace('./index.html');</script></body></html>`;
  return injectLabBanner(html,identity);
}

function listHtmlFiles(directory){
  const found=[];
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const full=path.join(directory,entry.name);
    if(entry.isDirectory())found.push(...listHtmlFiles(full));
    else if(entry.isFile()&&entry.name.endsWith('.html')&&entry.name!=='faculty-dashboard.html')found.push(full);
  }
  return found;
}

function stagePagesDirectory(directory,identity,options={}){
  const target=path.resolve(directory);
  if(!fs.existsSync(target)||!fs.statSync(target).isDirectory())throw Error(`Pages directory does not exist: ${target}`);
  const mode=String(options.mode||'demo').trim().toLowerCase();
  if(mode!=='demo'&&mode!=='lab')throw Error(`Unknown Pages staging mode: ${mode}`);
  const value=mode==='lab'?normalizeLabIdentity(identity):normalizeIdentity(identity);

  if(mode==='lab')return stageLabDirectory(target,value,options);

  const htmlFiles=listHtmlFiles(target);
  for(const filename of htmlFiles){
    const source=fs.readFileSync(filename,'utf8');
    fs.writeFileSync(filename,injectTestBanner(injectDemoRuntime(source),value));
  }
  const demoDocuments=writeDemoRuntime(target);
  fs.writeFileSync(path.join(target,'faculty-dashboard.html'),buildFacultyDashboardRedirect(value));
  fs.writeFileSync(path.join(target,'.nojekyll'),'');
  fs.writeFileSync(path.join(target,'github-pages-build.json'),JSON.stringify({environment:'github-pages-test',mode:'frontend-demo',doeBackend:'disabled',demoDocuments,...value},null,2)+'\n');
  return{directory:target,mode:'frontend-demo',htmlFiles:htmlFiles.length,demoDocuments,identity:value};
}

// Firebase Lab staging: real Firebase SDK, no synthetic compatibility runtime.
function stageLabDirectory(target,value,options={}){
  const htmlFiles=listHtmlFiles(target);
  for(const filename of htmlFiles){
    const source=fs.readFileSync(filename,'utf8');
    if(source.includes(DEMO_RUNTIME_FILE)||source.includes(DEMO_DATA_FILE)){
      throw Error(`Firebase Lab mode cannot stage ${path.basename(filename)}: the Frontend Demo runtime is already injected.`);
    }
    fs.writeFileSync(filename,injectLabBanner(injectLabRuntime(source),value));
  }
  const lab=writeLabRuntime(target,options);
  fs.writeFileSync(path.join(target,'faculty-dashboard.html'),buildLabDashboardRedirect(value));
  fs.writeFileSync(path.join(target,'.nojekyll'),'');
  fs.writeFileSync(path.join(target,'github-pages-build.json'),JSON.stringify({
    environment:'firebase-lab',
    mode:'firebase-lab',
    projectId:LAB_PROJECT_ID,
    syntheticRuntime:false,
    auth:'firebase-authentication',
    firestore:'cloud-firestore',
    doePolicyData:'live-firestore',
    doeAuthoritativeWriter:'off-trusted-backend-required',
    labFiles:lab.files,
    ...value
  },null,2)+'\n');
  return{directory:target,mode:'firebase-lab',htmlFiles:htmlFiles.length,projectId:LAB_PROJECT_ID,labFiles:lab.files,identity:value};
}

function parseArgs(argv){
  const value=name=>{const index=argv.indexOf(name);return index>=0?argv[index+1]:undefined};
  const flags=new Set(argv);
  return{
    directory:value('--directory'),
    mode:value('--mode')||'demo',
    configPath:value('--lab-config'),
    allowPlaceholderConfig:flags.has('--allow-placeholder-config'),
    identity:{prNumber:value('--pr'),headSha:value('--head-sha'),buildSha:value('--build-sha')}
  };
}

if(require.main===module){
  const options=parseArgs(process.argv.slice(2));
  if(!options.directory)throw Error('--directory is required.');
  console.log(JSON.stringify(stagePagesDirectory(options.directory,options.identity,options)));
}

module.exports={
  normalizeIdentity,
  injectTestBanner,
  injectDemoRuntime,
  injectLabBanner,
  injectLabRuntime,
  writeDemoRuntime,
  writeLabRuntime,
  readLabConfig,
  buildFacultyDashboardRedirect,
  stagePagesDirectory,
  stageLabDirectory,
  LAB_PROJECT_ID,
  LAB_RUNTIME_FILE,
  LAB_DOE_FILE
};
