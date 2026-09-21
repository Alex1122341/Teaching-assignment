'use strict';
const fs=require('node:fs');
const path=require('node:path');
const BANNER_ID='github-pages-test-site-banner';
const BANNER_CLASS='github-pages-test-site-notice';
const DEMO_DATA_FILE='pages-demo-data.js';
const DEMO_RUNTIME_FILE='pages-demo-runtime.js';
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
  const payload={version:1,generatedFrom:dataset.generatedFrom,counts:dataset.counts,documents:dataset.documents};
  fs.writeFileSync(path.join(directory,DEMO_DATA_FILE),'window.UCVM_PAGES_DEMO_SEED='+JSON.stringify(payload)+';\n');
  fs.copyFileSync(path.join(__dirname,DEMO_RUNTIME_FILE),path.join(directory,DEMO_RUNTIME_FILE));
  return dataset.documents.length;
}

function buildFacultyDashboardRedirect(identity){
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./index.html"><title>Redirecting…</title></head><body><p>Redirecting to <a href="./index.html">UCVM Timetable</a>…</p><script>window.location.replace('./index.html');</script></body></html>`;
  return injectTestBanner(html,identity);
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

function stagePagesDirectory(directory,identity){
  const target=path.resolve(directory);
  if(!fs.existsSync(target)||!fs.statSync(target).isDirectory())throw Error(`Pages directory does not exist: ${target}`);
  const value=normalizeIdentity(identity);
  const htmlFiles=listHtmlFiles(target);
  for(const filename of htmlFiles){
    const source=fs.readFileSync(filename,'utf8');
    fs.writeFileSync(filename,injectTestBanner(injectDemoRuntime(source),value));
  }
  const demoDocuments=writeDemoRuntime(target);
  fs.writeFileSync(path.join(target,'faculty-dashboard.html'),buildFacultyDashboardRedirect(value));
  fs.writeFileSync(path.join(target,'.nojekyll'),'');
  fs.writeFileSync(path.join(target,'github-pages-build.json'),JSON.stringify({environment:'github-pages-test',mode:'frontend-demo',doeBackend:'disabled',demoDocuments,...value},null,2)+'\n');
  return{directory:target,htmlFiles:htmlFiles.length,demoDocuments,identity:value};
}

function parseArgs(argv){
  const value=name=>{const index=argv.indexOf(name);return index>=0?argv[index+1]:undefined};
  return{directory:value('--directory'),identity:{prNumber:value('--pr'),headSha:value('--head-sha'),buildSha:value('--build-sha')}};
}

if(require.main===module){
  const options=parseArgs(process.argv.slice(2));
  if(!options.directory)throw Error('--directory is required.');
  console.log(JSON.stringify(stagePagesDirectory(options.directory,options.identity)));
}

module.exports={normalizeIdentity,injectTestBanner,injectDemoRuntime,writeDemoRuntime,buildFacultyDashboardRedirect,stagePagesDirectory};
