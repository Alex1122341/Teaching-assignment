'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const site=path.join(root,'.deploy-static');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const CLOUD_FIREBASE_HOSTS=new Set(['firestore.googleapis.com','identitytoolkit.googleapis.com','securetoken.googleapis.com']);
const PAGE_EXPECTATIONS=Object.freeze([
 {page:'index.html',titles:['UCVM Timetable - Workload Guideline DOE V9.7'],required:'bundles/timetable-app.bundle.js'},
 {page:'faculty-admin.html',titles:['Faculty Dashboard'],required:'bundles/faculty-runtime-main.bundle.js'},
 {page:'user-management.html',titles:['UCVM · User Management','UCVM Timetable - Workload Guideline DOE V9.7'],required:'bundles/user-management.bundle.js'},
 {page:'password.html',titles:['UCVM · Change Password','UCVM Timetable - Workload Guideline DOE V9.7'],required:'bundles/shared-auth.bundle.js'}
]);
const AUTH_FIXTURE=Object.freeze({
 projectId:'vista-teaching-lab',
 email:'browser.smoke@ucalgary.ca',
 password:'BrowserSmoke-2026!'
});
function emulatorOrigin(value,fallback){
 const raw=String(value||fallback).trim().replace(/^https?:\/\//,'').replace(/\/$/,'');
 return `http://${raw}`;
}
async function createAuthenticatedFixture({
 authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST,
 firestoreHost=process.env.FIRESTORE_EMULATOR_HOST,
 fixture=AUTH_FIXTURE
}={}){
 if(!authHost||!firestoreHost)throw Error('Authenticated browser smoke requires Auth and Firestore emulators.');
 const authOrigin=emulatorOrigin(authHost,'127.0.0.1:9099');
 const firestoreOrigin=emulatorOrigin(firestoreHost,'127.0.0.1:8080');
 const signUp=await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email:fixture.email,password:fixture.password,returnSecureToken:true})
 });
 if(!signUp.ok)throw Error(`Auth emulator fixture creation failed: HTTP ${signUp.status} ${(await signUp.text()).slice(0,300)}`);
 const account=await signUp.json(),uid=String(account.localId||'');
 if(!uid)throw Error('Auth emulator fixture did not return a UID.');
 const fields={
  name:{stringValue:'Browser Smoke Owner'},
  email:{stringValue:fixture.email},
  role:{stringValue:'adfa_general'},
  active:{booleanValue:true},
  mustChangePassword:{booleanValue:false},
  updatedBy:{stringValue:uid}
 };
 const profile=await fetch(`${firestoreOrigin}/v1/projects/${fixture.projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,{
  method:'PATCH',
  headers:{authorization:'Bearer owner','content-type':'application/json'},
  body:JSON.stringify({fields})
 });
 if(!profile.ok)throw Error(`Firestore emulator profile creation failed: HTTP ${profile.status} ${(await profile.text()).slice(0,300)}`);
 return{uid,email:fixture.email,password:fixture.password};
}

function safeStaticPath(siteRoot,requestUrl){
 let pathname;
 try{pathname=decodeURIComponent(new URL(requestUrl,'http://127.0.0.1').pathname)}catch{return null}
 const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
 if(!relative||relative.includes('\0'))return null;
 const base=path.resolve(siteRoot),candidate=path.resolve(base,relative),prefix=base.endsWith(path.sep)?base:base+path.sep;
 return candidate.startsWith(prefix)?candidate:null;
}
function contentType(filename){
 const ext=path.extname(filename).toLowerCase();
 return({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.pdf':'application/pdf'}[ext]||'application/octet-stream');
}
function createStaticServer(siteRoot=site){
 return http.createServer((req,res)=>{
  const filename=safeStaticPath(siteRoot,req.url||'/');
  if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404,{'content-type':'text/plain'});res.end('Not found');return}
  res.writeHead(200,{'content-type':contentType(filename),'cache-control':'no-store'});
  fs.createReadStream(filename).pipe(res);
 });
}
function chromeCandidates(env=process.env){
 return[env.CHROME_PATH,env.CHROME_BIN,'google-chrome-stable','google-chrome','chromium','chromium-browser'].filter((value,index,all)=>value&&all.indexOf(value)===index);
}
function findChrome(env=process.env){
 for(const candidate of chromeCandidates(env)){
  const result=spawnSync(candidate,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(!result.error&&result.status===0)return candidate;
 }
 return'';
}
async function waitForDebugPort(userDataDir,child,timeoutMs=15000){
 const active=path.join(userDataDir,'DevToolsActivePort'),started=Date.now();
 while(Date.now()-started<timeoutMs){
  if(child.exitCode!==null)throw Error(`Chrome exited before DevTools became available (exit ${child.exitCode}).`);
  if(fs.existsSync(active)){
   const [port]=fs.readFileSync(active,'utf8').trim().split(/\r?\n/);
   if(/^\d+$/.test(port))return Number(port);
  }
  await wait(100);
 }
 throw Error('Timed out waiting for Chrome DevTools port.');
}
async function newTarget(port){
 const response=await fetch(`http://127.0.0.1:${port}/json/new?about%3Ablank`,{method:'PUT'});
 if(!response.ok)throw Error(`Chrome target creation failed: HTTP ${response.status}`);
 return response.json();
}
async function closeTarget(port,id){
 try{await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(id)}`)}catch{}
}
async function connectCdp(url){
 if(typeof WebSocket!=='function')throw Error('This browser smoke test requires the Node.js WebSocket global (Node 22+).');
 const ws=new WebSocket(url),pending=new Map(),listeners=new Set();
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Timed out opening Chrome DevTools WebSocket.')),10000);
  ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
  ws.addEventListener('error',event=>{clearTimeout(timer);reject(Error(`Chrome DevTools WebSocket error: ${event?.message||'unknown'}`))},{once:true});
 });
 ws.addEventListener('message',event=>{
  let message;
  try{message=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString('utf8'))}catch{return}
  if(message.id&&pending.has(message.id)){
   const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);
   if(message.error)item.reject(Error(`${item.method}: ${message.error.message||JSON.stringify(message.error)}`));else item.resolve(message.result||{});
   return;
  }
  for(const listener of listeners)listener(message);
 });
 let nextId=0;
 function send(method,params={}){
  const id=++nextId;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Chrome DevTools command timed out: ${method}`))},15000);
   pending.set(id,{resolve,reject,timer,method});
   ws.send(JSON.stringify({id,method,params}));
  });
 }
 function on(listener){listeners.add(listener);return()=>listeners.delete(listener)}
 function close(){try{ws.close()}catch{}}
 return{send,on,close};
}
function waitForEvent(cdp,method,timeoutMs=20000){
 return new Promise((resolve,reject)=>{
  let off=()=>{};
  const timer=setTimeout(()=>{off();reject(Error(`Timed out waiting for Chrome event: ${method}`))},timeoutMs);
  off=cdp.on(message=>{if(message.method!==method)return;clearTimeout(timer);off();resolve(message.params||{})});
 });
}
function exceptionText(details={}){
 const exception=details.exception||{};
 return String(exception.description||exception.value||details.text||'Unknown browser exception');
}
function localAssetFailure(url,origin){
 try{
  const parsed=new URL(url);
  if(parsed.origin!==origin)return false;
  return /\.(?:html|js|css|json)(?:$|[?#])/i.test(parsed.pathname);
 }catch{return false}
}
async function evaluateState(cdp){
 const expression=`(()=>({
  title:document.title,
  ready:document.readyState,
  href:location.href,
  emulator:window.UCVM_FIREBASE_EMULATOR===true,
  hasFirebase:typeof window.firebase==='object',
  hasUcvm:typeof window.UCVM==='object',
  runtimeError:(document.getElementById('runtime-error')?.textContent||'').trim()
 }))()`;
 for(let attempt=0;attempt<20;attempt++){
  try{
   const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
   if(result.exceptionDetails)throw Error(exceptionText(result.exceptionDetails));
   if(result.result?.value)return result.result.value;
  }catch(error){if(attempt===19)throw error}
  await wait(150);
 }
 throw Error('Could not evaluate browser state.');
}
async function inspectPage({debugPort,origin,expectation}){
 const target=await newTarget(debugPort),cdp=await connectCdp(target.webSocketDebuggerUrl);
 const requests=new Map(),requested=[],exceptions=[],assetFailures=[],cloudRequests=[];
 const off=cdp.on(message=>{
  const params=message.params||{};
  if(message.method==='Runtime.exceptionThrown')exceptions.push(exceptionText(params.exceptionDetails));
  if(message.method==='Network.requestWillBeSent'){
   const url=params.request?.url||'';requests.set(params.requestId,url);requested.push(url);
   try{if(CLOUD_FIREBASE_HOSTS.has(new URL(url).hostname))cloudRequests.push(url)}catch{}
  }
  if(message.method==='Network.loadingFailed'){
   const url=requests.get(params.requestId)||'';
   if(localAssetFailure(url,origin))assetFailures.push(`${url}: ${params.errorText||'loading failed'}`);
  }
  if(message.method==='Network.responseReceived'){
   const response=params.response||{},url=response.url||requests.get(params.requestId)||'';
   if(Number(response.status)>=400&&localAssetFailure(url,origin))assetFailures.push(`${url}: HTTP ${response.status}`);
  }
 });
 try{
  await Promise.all([cdp.send('Runtime.enable'),cdp.send('Page.enable'),cdp.send('Network.enable')]);
  const load=waitForEvent(cdp,'Page.loadEventFired');
  const navigation=await cdp.send('Page.navigate',{url:`${origin}/${expectation.page}`});
  if(navigation.errorText)throw Error(`${expectation.page}: navigation failed: ${navigation.errorText}`);
  await load;
  await wait(1800);
  const state=await evaluateState(cdp);
  const requiredUrl=`${origin}/${expectation.required}`;
  const requestedRequired=requested.some(url=>url.split(/[?#]/)[0]===requiredUrl);
  const problems=[];
  if(!expectation.titles.includes(state.title))problems.push(`unexpected title "${state.title}"`);
  if(state.ready!=='complete')problems.push(`document.readyState=${state.ready}`);
  if(!state.emulator)problems.push('Firebase emulator mode is not enabled');
  if(!state.hasFirebase)problems.push('Firebase SDK global is missing');
  if(!state.hasUcvm)problems.push('UCVM shared runtime global is missing');
  if(state.runtimeError)problems.push(state.runtimeError);
  if(!requestedRequired)problems.push(`required generated asset was not requested: ${expectation.required}`);
  if(exceptions.length)problems.push(`uncaught browser exception(s): ${exceptions.join(' | ')}`);
  if(assetFailures.length)problems.push(`local asset failure(s): ${assetFailures.join(' | ')}`);
  if(cloudRequests.length)problems.push(`unexpected Firebase cloud request(s) in emulator smoke: ${cloudRequests.join(' | ')}`);
  if(problems.length)throw Error(`${expectation.page}: ${problems.join('; ')}`);
  return{page:expectation.page,finalUrl:state.href,title:state.title,requiredAsset:expectation.required,requests:requested.filter(url=>url.startsWith(origin)).length};
 }finally{
  off();cdp.close();await closeTarget(debugPort,target.id);
 }
}
async function waitForCondition(cdp,expression,label,timeoutMs=12000){
 const started=Date.now();
 while(Date.now()-started<timeoutMs){
  const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(`${label}: ${exceptionText(result.exceptionDetails)}`);
  if(result.result?.value)return result.result.value;
  await wait(200);
 }
 throw Error(`Timed out waiting for authenticated browser state: ${label}`);
}
async function authenticatedOwnerSmoke({debugPort,origin,fixture}){
 const target=await newTarget(debugPort),cdp=await connectCdp(target.webSocketDebuggerUrl);
 const requests=new Map(),exceptions=[],assetFailures=[],cloudRequests=[];
 const off=cdp.on(message=>{
  const params=message.params||{};
  if(message.method==='Runtime.exceptionThrown')exceptions.push(exceptionText(params.exceptionDetails));
  if(message.method==='Network.requestWillBeSent'){
   const url=params.request?.url||'';requests.set(params.requestId,url);
   try{if(CLOUD_FIREBASE_HOSTS.has(new URL(url).hostname))cloudRequests.push(url)}catch{}
  }
  if(message.method==='Network.loadingFailed'){
   const url=requests.get(params.requestId)||'';
   if(localAssetFailure(url,origin))assetFailures.push(`${url}: ${params.errorText||'loading failed'}`);
  }
  if(message.method==='Network.responseReceived'){
   const response=params.response||{},url=response.url||requests.get(params.requestId)||'';
   if(Number(response.status)>=400&&localAssetFailure(url,origin))assetFailures.push(`${url}: HTTP ${response.status}`);
  }
 });
 const navigate=async page=>{
  const load=waitForEvent(cdp,'Page.loadEventFired');
  const navigation=await cdp.send('Page.navigate',{url:`${origin}/${page}`});
  if(navigation.errorText)throw Error(`${page}: navigation failed: ${navigation.errorText}`);
  await load;await wait(400);
 };
 try{
  await Promise.all([cdp.send('Runtime.enable'),cdp.send('Page.enable'),cdp.send('Network.enable')]);
  await navigate('index.html');
  const loginExpression=`(async()=>{sessionStorage.setItem('ucvm-admin-default-landing',${JSON.stringify(fixture.uid)});const credential=await firebase.auth().signInWithEmailAndPassword(${JSON.stringify(fixture.email)},${JSON.stringify(fixture.password)});return{uid:credential.user.uid,email:credential.user.email}})()`;
  const login=await cdp.send('Runtime.evaluate',{expression:loginExpression,returnByValue:true,awaitPromise:true});
  if(login.exceptionDetails)throw Error(`owner sign-in failed: ${exceptionText(login.exceptionDetails)}`);
  if(login.result?.value?.uid!==fixture.uid)throw Error('Authenticated smoke signed in an unexpected UID.');
  await waitForCondition(cdp,`(()=>firebase.auth().currentUser?.uid===${JSON.stringify(fixture.uid)}&&!document.body.classList.contains('auth-locked')&&!document.getElementById('manage-users-btn')?.classList.contains('hidden'))()`,'Timetable owner access');

  await navigate('faculty-admin.html');
  await waitForCondition(cdp,`(()=>document.getElementById('auth-gate')?.classList.contains('hidden')===true&&document.getElementById('admin-chip')?.textContent.includes('Browser Smoke Owner'))()`,'Faculty Dashboard owner access');

  await navigate('user-management.html');
  await waitForCondition(cdp,`(()=>document.getElementById('content')?.hidden===false&&document.getElementById('accounts')?.hidden===false&&document.getElementById('identity')?.textContent.includes('Browser Smoke Owner'))()`,'User Management owner access');

  await wait(500);
  const problems=[];
  if(exceptions.length)problems.push(`uncaught browser exception(s): ${exceptions.join(' | ')}`);
  if(assetFailures.length)problems.push(`local asset failure(s): ${assetFailures.join(' | ')}`);
  if(cloudRequests.length)problems.push(`unexpected Firebase cloud request(s): ${cloudRequests.join(' | ')}`);
  if(problems.length)throw Error(`authenticated owner smoke: ${problems.join('; ')}`);
  return{pages:['index.html','faculty-admin.html','user-management.html'],uid:fixture.uid};
 }finally{
  off();cdp.close();await closeTarget(debugPort,target.id);
 }
}
async function run(){
 const authenticated=process.argv.includes('--authenticated');
 if(!fs.existsSync(path.join(root,'.deploy-metadata','deployment-assets.json')))throw Error('Build .deploy-static before running browser smoke.');
 const authFixture=authenticated?await createAuthenticatedFixture():null;
 const chrome=findChrome();
 if(!chrome)throw Error(`Chrome/Chromium was not found. Tried: ${chromeCandidates().join(', ')}`);
 const server=createStaticServer(site);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const address=server.address(),origin=`http://127.0.0.1:${address.port}`;
 const userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ucvm-browser-smoke-'));
 let stderr='';
 const child=spawn(chrome,[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--no-first-run','--no-default-browser-check','--disable-component-update',
  '--remote-debugging-port=0',`--user-data-dir=${userDataDir}`,'about:blank'
 ],{stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',chunk=>{stderr+=chunk.toString()});
 try{
  const debugPort=await waitForDebugPort(userDataDir,child);
  const results=[];
  for(const expectation of PAGE_EXPECTATIONS)results.push(await inspectPage({debugPort,origin,expectation}));
  process.stdout.write(`Browser smoke passed ${results.length}/${PAGE_EXPECTATIONS.length} signed-out pages in emulator mode.\n`);
  for(const item of results)process.stdout.write(`- ${item.page}: ${item.requiredAsset} loaded; ${item.requests} local requests; final ${item.finalUrl}\n`);
  if(authFixture){
   const owner=await authenticatedOwnerSmoke({debugPort,origin,fixture:authFixture});
   process.stdout.write(`Authenticated owner smoke passed ${owner.pages.length}/${owner.pages.length} protected pages: ${owner.pages.join(', ')}.\n`);
  }
  return results;
 }catch(error){
  if(stderr.trim())process.stderr.write(`Chrome stderr (tail):\n${stderr.slice(-5000)}\n`);
  throw error;
 }finally{
  if(child.exitCode===null){
   child.kill('SIGTERM');
   for(let i=0;i<20&&child.exitCode===null;i++)await wait(100);
   if(child.exitCode===null){
    child.kill('SIGKILL');
    for(let i=0;i<20&&child.exitCode===null;i++)await wait(100);
   }
  }
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(userDataDir,{recursive:true,force:true,maxRetries:8,retryDelay:100});
 }
}
if(require.main===module)run().catch(error=>{console.error(error.stack||error);process.exit(1)});
module.exports={PAGE_EXPECTATIONS,CLOUD_FIREBASE_HOSTS,AUTH_FIXTURE,emulatorOrigin,createAuthenticatedFixture,safeStaticPath,contentType,chromeCandidates,findChrome,localAssetFailure,createStaticServer};
