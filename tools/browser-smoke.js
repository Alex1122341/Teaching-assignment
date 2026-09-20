'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const site=path.join(root,'.deploy-static');
const metadataPath=path.join(root,'.deploy-metadata','deployment-assets.json');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function readDeploymentMetadata(){return JSON.parse(fs.readFileSync(metadataPath,'utf8'))}
function bundlePathMap(metadata=readDeploymentMetadata()){
 return new Map((metadata.bundles||[]).map(bundle=>[bundle.logicalOutput||bundle.output,bundle.output]));
}
const CLOUD_FIREBASE_HOSTS=new Set(['firestore.googleapis.com','identitytoolkit.googleapis.com','securetoken.googleapis.com']);
const PAGE_EXPECTATIONS=Object.freeze([
 {page:'index.html',titles:['UCVM Timetable - Workload Guideline DOE V9.7'],requiredLogical:'bundles/timetable-app.bundle.js'},
 {page:'faculty-admin.html',titles:['Faculty Dashboard'],requiredLogical:'bundles/faculty-runtime-main.bundle.js'},
 {page:'user-management.html',titles:['UCVM · User Management','UCVM Timetable - Workload Guideline DOE V9.7'],requiredLogical:'bundles/user-management.bundle.js'},
 {page:'password.html',titles:['UCVM · Change Password','UCVM Timetable - Workload Guideline DOE V9.7'],requiredLogical:'bundles/shared-auth.bundle.js'}
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
function doeSmokeResponse(requestUrl,method='GET'){
 const parsed=new URL(String(requestUrl||'/'),'http://127.0.0.1');
 if(!parsed.pathname.startsWith('/__doe-smoke/api/doe/'))return null;
 if(String(method||'GET').toUpperCase()!=='GET')return{statusCode:405,body:{code:'SMOKE_READ_ONLY',message:'DOE browser smoke endpoint is read-only.'}};
 const year=String(parsed.searchParams.get('academicYear')||'2026-27');
 const reference={title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5};
 const roleAssignment={assignmentFactId:'role-smoke-hicc',roleType:'HICC',courseCode:'VTMD 204',subjectKey:'',resultDoe:12,status:'calculated',ruleKey:'role.hicc',ruleId:'rule-hicc-smoke',reference};
 const summary={
  facultyId:'browser-smoke-faculty',displayName:'Browser Smoke Faculty',academicYear:year,policyVersionId:'ucvm-workload-smoke-v1',status:'calculated',
  lastCalculatedAt:'2026-09-20T01:00:00Z',target:{effectiveTargetDoe:40,overrideDoe:null,overrideReason:'',source:'contract'},
  roleAssignmentCount:1,roleAssignments:[roleAssignment],teachingLineCount:1,supervisionLineCount:0,adjustmentLineCount:0,serverFactCount:2,unratedLineCount:0,missingMappingCount:0,issueCount:0,issueCodes:[],
  scheduledTeachingDoe:28,roleDoe:12,rawSupervisionDoe:0,appliedSupervisionDoe:0,adjustmentDoe:0,assignedTeachingDoe:40,effectiveTargetDoe:40,remainingDoe:0
 };
 const explainSummary={...summary,facultyId:'fac-001',displayName:'Avery Lindqvist'};
 const mappingSummary={
  facultyId:'browser-smoke-mapping',displayName:'Browser Smoke Mapping',academicYear:year,policyVersionId:'ucvm-workload-smoke-v1',status:'needs_review',
  lastCalculatedAt:'2026-09-20T01:00:00Z',target:{effectiveTargetDoe:30,overrideDoe:null,overrideReason:'',source:'contract'},
  roleAssignmentCount:1,roleAssignments:[],teachingLineCount:0,supervisionLineCount:0,adjustmentLineCount:0,serverFactCount:1,unratedLineCount:1,missingMappingCount:1,issueCount:1,issueCodes:['COURSE_MAPPING_REQUIRED'],
  scheduledTeachingDoe:null,roleDoe:null,rawSupervisionDoe:0,appliedSupervisionDoe:0,adjustmentDoe:0,assignedTeachingDoe:null,effectiveTargetDoe:30,remainingDoe:null
 };
 const worksheet={
  facultyId:summary.facultyId,displayName:summary.displayName,academicYear:year,policyVersionId:summary.policyVersionId,status:'calculated',lastCalculatedAt:summary.lastCalculatedAt,
  target:{effectiveTargetDoe:40,overrideDoe:null,overrideReason:'',source:'contract'},reserve:{initialTraineeReserve:0,rawSupervisionDoe:0,appliedSupervision:0,unappliedSupervision:0},
  totals:{scheduledTeachingDoe:28,roleDoe:12,rawSupervisionDoe:0,appliedSupervisionDoe:0,adjustmentDoe:0,assignedTeachingDoe:40,effectiveTargetDoe:40,remainingDoe:0},
  sections:{scheduledTeaching:{subtotal:28},roles:{subtotal:12},supervision:{rawSubtotal:0,appliedSubtotal:0},adjustments:{subtotal:0}},errors:[],
  lines:[
   {lineId:'session-smoke--assignment-smoke',category:'teaching',sourceEntityType:'session_assignment',sourceEntityId:'session-smoke',label:'Browser Smoke Lecture',calculationText:'2 h × 14.00% DOE/h = 28.00%',resultDoe:28,status:'calculated',policyVersionId:summary.policyVersionId,ruleId:'rule-lecture-smoke',ruleKey:'teaching.lecture',reference,calculationId:'calc-smoke-lecture',calculatedAt:'2026-09-20T01:00:00Z',explanation:{rule:{name:'Lecture standard rate',calculationMode:'rate',category:'teaching'},facts:{activityType:'Lecture',teachingRole:'Primary Instructor',courseCode:'VETM 301'},inputs:{hours:2},parameters:{rate:14},trigger:'session_assignment',source:'active_policy'}},
   {lineId:'role-smoke-hicc',category:'role',sourceEntityType:'doe_assignment',sourceEntityId:'role-smoke-hicc',assignmentFactId:'role-smoke-hicc',roleType:'HICC',courseCode:'VTMD 204',label:'HICC · VTMD 204',calculationText:'Rule Book role assignment',resultDoe:12,status:'calculated',policyVersionId:summary.policyVersionId,ruleId:'rule-hicc-smoke',ruleKey:'role.hicc',reference,calculationId:'calc-smoke-hicc'}
  ]
 };
 const explainWorksheet={...worksheet,facultyId:'fac-001',displayName:'Avery Lindqvist'};
 if(parsed.pathname==='/__doe-smoke/api/doe/list')return{statusCode:200,body:[summary,mappingSummary,explainSummary]};
 if(parsed.pathname==='/__doe-smoke/api/doe/policies')return{statusCode:200,body:[]};
 if(parsed.pathname==='/__doe-smoke/api/doe/faculty/browser-smoke-faculty/role-assignments')return{statusCode:200,body:[{...roleAssignment,academicYear:year,facultyId:summary.facultyId,active:true,doeCredit:12,doeRuleKey:roleAssignment.ruleKey,doeRuleId:roleAssignment.ruleId}]};
 if(parsed.pathname==='/__doe-smoke/api/doe/faculty/browser-smoke-faculty/worksheet')return{statusCode:200,body:worksheet};
 if(parsed.pathname==='/__doe-smoke/api/doe/faculty/fac-001/worksheet')return{statusCode:200,body:explainWorksheet};
 return{statusCode:404,body:{code:'SMOKE_ROUTE_NOT_FOUND',message:'Unsupported DOE browser smoke route.'}};
}
function createStaticServer(siteRoot=site){
 return http.createServer((req,res)=>{
  const smoke=doeSmokeResponse(req.url||'/',req.method||'GET');
  if(smoke){res.writeHead(smoke.statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(smoke.body));return}
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
async function inspectPage({debugPort,origin,expectation,bundlePaths}){
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
  const requiredAsset=bundlePaths.get(expectation.requiredLogical);
  if(!requiredAsset)throw Error(`${expectation.page}: missing generated bundle mapping for ${expectation.requiredLogical}`);
  const requiredUrl=`${origin}/${requiredAsset}`;
  const requestedRequired=requested.some(url=>url.split(/[?#]/)[0]===requiredUrl);
  const problems=[];
  if(!expectation.titles.includes(state.title))problems.push(`unexpected title "${state.title}"`);
  if(state.ready!=='complete')problems.push(`document.readyState=${state.ready}`);
  if(!state.emulator)problems.push('Firebase emulator mode is not enabled');
  if(!state.hasFirebase)problems.push('Firebase SDK global is missing');
  if(!state.hasUcvm)problems.push('UCVM shared runtime global is missing');
  if(state.runtimeError)problems.push(state.runtimeError);
  if(!requestedRequired)problems.push(`required generated asset was not requested: ${requiredAsset}`);
  if(exceptions.length)problems.push(`uncaught browser exception(s): ${exceptions.join(' | ')}`);
  if(assetFailures.length)problems.push(`local asset failure(s): ${assetFailures.join(' | ')}`);
  if(cloudRequests.length)problems.push(`unexpected Firebase cloud request(s) in emulator smoke: ${cloudRequests.join(' | ')}`);
  if(problems.length)throw Error(`${expectation.page}: ${problems.join('; ')}`);
  return{page:expectation.page,finalUrl:state.href,title:state.title,requiredAsset,requests:requested.filter(url=>url.startsWith(origin)).length};
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
async function authenticatedOwnerSmoke({debugPort,origin,fixture,bundlePaths}){
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

  const afcAsset=bundlePaths.get('bundles/afc-pdf.lazy.bundle.js');
  const approvalAsset=bundlePaths.get('bundles/approval-workflow.lazy.bundle.js');
  if(!afcAsset||!approvalAsset)throw Error('Authenticated smoke is missing hashed lazy bundle mappings.');
  const afcLazy=await cdp.send('Runtime.evaluate',{
   expression:`(async()=>{const api=await window.UCVM_ASSETS.ensureAfcPdf();const expected=${JSON.stringify(afcAsset)};const scripts=[...document.scripts].filter(script=>String(script.src||'').endsWith('/'+expected));const bytes=await api.render({facultySnapshot:{ucid:'f1'},facultyId:'f1',facultyName:'Browser Smoke Owner',workDays:1,startDate:'2026-10-01',endDate:'2026-10-01',reason:'vacation',contactAddress:'2500 University Drive NW',contactPhone:'403-555-1212',termsVersion:'ucvm-afc-terms-page2-v1',applicantSignature:{mode:'typed',name:'Browser Smoke Owner',uid:${JSON.stringify(fixture.uid)},email:${JSON.stringify(fixture.email)},account:${JSON.stringify(fixture.email)},signedAt:new Date().toISOString(),fingerprint:'browser-smoke'}});const doc=await PDFLib.PDFDocument.load(bytes);return{ok:!!api,values:!!window.UCVM_AFC_FORM_VALUES,pdf:!!window.UCVM_AFC_PDF,scripts:scripts.length,pages:doc.getPageCount()}})()`,
   returnByValue:true,
   awaitPromise:true
  });
  if(afcLazy.exceptionDetails)throw Error(`AFC lazy bundle failed: ${exceptionText(afcLazy.exceptionDetails)}`);
  if(!afcLazy.result?.value?.ok||!afcLazy.result?.value?.values||!afcLazy.result?.value?.pdf)throw Error('AFC lazy bundle did not expose the expected runtime globals.');
  if(afcLazy.result?.value?.scripts!==1)throw Error(`AFC hashed lazy bundle loaded ${afcLazy.result?.value?.scripts||0} times; expected exactly once.`);if(afcLazy.result?.value?.pages!==1)throw Error(`Approved AFC PDF contains ${afcLazy.result?.value?.pages||0} pages; expected exactly one form page.`);

  const approvalLazy=await cdp.send('Runtime.evaluate',{
   expression:`(async()=>{await window.UCVM_ASSETS.ensureApprovalWorkflow();const expected=${JSON.stringify(approvalAsset)};const scripts=[...document.scripts].filter(script=>String(script.src||'').endsWith('/'+expected));return{handoff:window.UCVM_SAFE_SWAP_HANDOFF?.mode||'',scripts:scripts.length}})()`,
   returnByValue:true,
   awaitPromise:true
  });
  if(approvalLazy.exceptionDetails)throw Error(`Approval lazy bundle failed: ${exceptionText(approvalLazy.exceptionDetails)}`);
  if(approvalLazy.result?.value?.handoff!=='direct-session-modal')throw Error('Approval lazy bundle did not execute the compatibility handoff first.');
  if(approvalLazy.result?.value?.scripts!==1)throw Error(`Approval lazy bundle loaded ${approvalLazy.result?.value?.scripts||0} times; expected exactly once.`);

  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const mockBase=location.origin+'/__doe-smoke';window.UCVM_CONFIG={...(window.UCVM_CONFIG||{}),doeApiBaseUrl:mockBase};let explicit='';Object.defineProperty(window,'UCVM_DOE_API_BASE_URL',{configurable:true,get(){return explicit||mockBase},set(value){const next=String(value||'').trim();if(next)explicit=next}})})()`});
  await navigate('faculty-admin.html');
  await waitForCondition(cdp,`(()=>document.getElementById('auth-gate')?.classList.contains('hidden')===true&&document.getElementById('admin-chip')?.textContent.includes('Browser Smoke Owner'))()`,'Faculty Dashboard owner access');
  await waitForCondition(cdp,`(()=>!!document.getElementById('doe-list-tab')&&!!document.querySelector('script[data-ucvm-faculty-admin-enhancements]'))()`,'DOE List deferred enhancement');
  const doeNavigation=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const tab=document.getElementById('doe-list-tab'),list=document.getElementById('doe-list-view'),rules=document.getElementById('doe-rules-view');tab?.click();return{tab:!!tab,listVisible:!!list&&!list.classList.contains('hidden'),rulesHidden:!!rules&&rules.classList.contains('hidden')}})()`,
   returnByValue:true
  });
  if(doeNavigation.exceptionDetails)throw Error(`DOE List navigation smoke failed: ${exceptionText(doeNavigation.exceptionDetails)}`);
  if(!doeNavigation.result?.value?.tab||!doeNavigation.result?.value?.listVisible||!doeNavigation.result?.value?.rulesHidden)throw Error('DOE List deferred enhancement did not own the Faculty Dashboard panel state.');
  await waitForCondition(cdp,`(()=>{const text=document.getElementById('doe-list-body')?.textContent||'';return text.includes('Browser Smoke Faculty')&&text.includes('40.00%')&&text.includes('ucvm-workload-smoke-v1')})()`,'DOE mocked server summary render');
  const doeWorksheet=await cdp.send('Runtime.evaluate',{
   expression:`(async()=>{const worksheet=await window.UCVM_DOE_API.getFacultyWorksheet('browser-smoke-faculty','2026-27');const host=document.createElement('div');host.id='doe-smoke-worksheet-render';host.innerHTML=window.UCVM_DOE_WORKSHEET_VIEW.worksheetHtml(worksheet);document.getElementById('doe-list-view')?.appendChild(host);return{configured:window.UCVM_DOE_API.isConfigured(),base:window.UCVM_DOE_API.baseUrl(),text:host.textContent}})()`,
   returnByValue:true,awaitPromise:true
  });
  if(doeWorksheet.exceptionDetails)throw Error(`DOE worksheet render smoke failed: ${exceptionText(doeWorksheet.exceptionDetails)}`);
  const rendered=doeWorksheet.result?.value||{};
  if(!rendered.configured||!String(rendered.base||'').includes('/__doe-smoke'))throw Error('DOE browser smoke did not use the local read-only server endpoint.');
  if(!String(rendered.text||'').includes('Teaching DOE · server worksheet')||!String(rendered.text||'').includes('40.00%')||!String(rendered.text||'').includes('calc-smoke-lecture'))throw Error('DOE browser smoke did not render authoritative Worksheet totals and calculation evidence.');

  const reconciliationNavigation=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const tab=document.getElementById('doe-reconciliation-tab'),view=document.getElementById('doe-reconciliation-view');tab?.click();return{tab:!!tab,visible:!!view&&!view.classList.contains('hidden')}})()`,
   returnByValue:true
  });
  if(reconciliationNavigation.exceptionDetails)throw Error(`DOE Reconciliation navigation smoke failed: ${exceptionText(reconciliationNavigation.exceptionDetails)}`);
  if(!reconciliationNavigation.result?.value?.tab||!reconciliationNavigation.result?.value?.visible)throw Error('DOE Reconciliation tab did not become visible.');
  await waitForCondition(cdp,`(()=>{const queue=document.getElementById('doe-reconciliation-queue-body')?.textContent||'',all=document.getElementById('doe-reconciliation-body')?.textContent||'',summary=document.getElementById('doe-reconciliation-summary')?.textContent||'';return queue.includes('Browser Smoke Mapping')&&queue.includes('Missing Mapping')&&queue.includes('COURSE MAPPING REQUIRED')&&all.includes('Browser Smoke Faculty')&&summary.includes('Action queue')})()`,'DOE Reconciliation work queue render');

  const explainOpen=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{window.dispatchEvent(new CustomEvent('ucvm:doe-open-faculty',{detail:{facultyId:'fac-001'}}));return true})()`,
   returnByValue:true
  });
  if(explainOpen.exceptionDetails)throw Error(`DOE explanation profile open failed: ${exceptionText(explainOpen.exceptionDetails)}`);
  await waitForCondition(cdp,`(()=>!!document.querySelector('#profile-pane [data-doe-explain-line="session-smoke--assignment-smoke"]'))()`,'DOE explanation trigger render');
  const explainClick=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const button=document.querySelector('#profile-pane [data-doe-explain-line="session-smoke--assignment-smoke"]');button?.click();const modal=document.getElementById('doe-explain-modal'),body=document.getElementById('doe-explain-body');return{button:!!button,visible:!!modal&&!modal.classList.contains('hidden'),text:body?.textContent||''}})()`,
   returnByValue:true
  });
  if(explainClick.exceptionDetails)throw Error(`DOE explanation modal click failed: ${exceptionText(explainClick.exceptionDetails)}`);
  const explanation=explainClick.result?.value||{};
  if(!explanation.button||!explanation.visible)throw Error('DOE explanation modal did not open from the Faculty profile.');
  for(const required of ['Lecture standard rate','Primary Instructor','Hours','2','Rate','14','ucvm-workload-smoke-v1','teaching.lecture','calc-smoke-lecture','UCVM Workload Guidelines']){
   if(!String(explanation.text||'').includes(required))throw Error(`DOE explanation modal render missing "${required}".`);
  }

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
 if(!fs.existsSync(metadataPath))throw Error('Build .deploy-static before running browser smoke.');
 const bundlePaths=bundlePathMap();
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
  for(const expectation of PAGE_EXPECTATIONS)results.push(await inspectPage({debugPort,origin,expectation,bundlePaths}));
  process.stdout.write(`Browser smoke passed ${results.length}/${PAGE_EXPECTATIONS.length} signed-out pages in emulator mode.\n`);
  for(const item of results)process.stdout.write(`- ${item.page}: ${item.requiredAsset} loaded; ${item.requests} local requests; final ${item.finalUrl}\n`);
  if(authFixture){
   const owner=await authenticatedOwnerSmoke({debugPort,origin,fixture:authFixture,bundlePaths});
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
module.exports={PAGE_EXPECTATIONS,CLOUD_FIREBASE_HOSTS,AUTH_FIXTURE,readDeploymentMetadata,bundlePathMap,emulatorOrigin,createAuthenticatedFixture,safeStaticPath,contentType,chromeCandidates,findChrome,localAssetFailure,doeSmokeResponse,createStaticServer};
