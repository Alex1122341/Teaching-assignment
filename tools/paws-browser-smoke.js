'use strict';
// Browser smoke for the PAWS Frontend Demo staged in .deploy-static.
// Opens each PAWS page as several demo roles in headless Chrome and checks
// that the page renders, shows the test banner, throws no script errors and
// never sends a request to the real PAWS API.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {findChrome,createStaticServer}=require('./browser-smoke');

const root=path.resolve(__dirname,'..');
const site=path.join(root,'.deploy-static');
const USER_KEY='ucvm-pages-demo-user-v2';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const CHECKS=Object.freeze([
 {page:'index.html',uid:'uid-developer',text:['Teaching Schedule','Week','DEMO ROLE TESTER','Academic Years · Demo']},
 {page:'index.html',uid:'uid-owner',text:['Teaching Schedule','Academic Years · Demo']},
 {page:'index.html',uid:'uid-admin',text:['Teaching Schedule','Admin tools']},
 {page:'index.html',uid:'uid-hicc-1',text:['Teaching Schedule']},
 {page:'index.html',uid:'uid-fac-001',text:['Teaching Schedule','My Teaching']},
 {page:'faculty-admin.html',uid:'uid-developer',text:['Faculty Dashboard','Lookup','DOE Overview','AFC Records','Academic Years · Demo']},
 {page:'faculty-admin.html',uid:'uid-admin',text:['Faculty Dashboard','Teaching Summary']},
 {page:'teaching-assignments.html',uid:'uid-admin',text:['Teaching Assignments','Academic Years · Demo']},
 {page:'teaching-assignments.html',uid:'uid-fac-001',text:['Teaching Assignments']},
 {page:'user-management.html',uid:'uid-owner',text:['User Management','Accounts']},
 {page:'password.html',uid:'uid-fac-001',text:['Change Password']}
]);

function apiOrigin(){
 const config=fs.readFileSync(path.join(site,'paws-api-origin.js'),'utf8');
 const match=config.match(/https?:\/\/[^'"\s]+/);
 return match?new URL(match[0]).origin:'';
}

async function connect(wsUrl){
 const ws=new WebSocket(wsUrl);let id=0;const pending=new Map(),listeners=new Set();
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(Error(msg.error.message)):resolve(msg.result)}else listeners.forEach(fn=>fn(msg))};
 return{send:(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))}),on:fn=>listeners.add(fn),close:()=>ws.close()};
}

async function waitForText(cdp,texts,timeoutMs=20000){
 const started=Date.now();let body='';
 while(Date.now()-started<timeoutMs){
  const result=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText:""',returnByValue:true});
  body=String(result.result?.value||'');
  if(texts.every(text=>body.includes(text)))return {ok:true,body};
  await wait(250);
 }
 return {ok:false,body};
}

async function main(){
 if(!fs.existsSync(path.join(site,'pages-demo-api.js')))throw Error('Run tools/build-paws-pages.js and stage with --mode paws first.');
 const chrome=findChrome();if(!chrome)throw Error('Chrome or Chromium is required for the PAWS browser smoke.');
 const server=createStaticServer(site);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,blockedOrigin=apiOrigin();
 const userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'paws-smoke-'));
 const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${userDataDir}`,'about:blank'],{stdio:'ignore'});
 const problems=[];
 try{
  const activePort=path.join(userDataDir,'DevToolsActivePort');let port=0;
  for(let i=0;i<150&&!port;i++){if(fs.existsSync(activePort))port=Number(fs.readFileSync(activePort,'utf8').split(/\r?\n/)[0])||0;if(!port)await wait(100)}
  if(!port)throw Error('Chrome DevTools did not start.');
  for(const check of CHECKS){
   const target=await (await fetch(`http://127.0.0.1:${port}/json/new?about%3Ablank`,{method:'PUT'})).json();
   const cdp=await connect(target.webSocketDebuggerUrl);const errors=[],apiCalls=[];
   cdp.on(msg=>{
    if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails?.exception?.description||msg.params.exceptionDetails?.text||'exception');
    if(msg.method==='Network.requestWillBeSent'&&blockedOrigin&&msg.params.request.url.startsWith(blockedOrigin))apiCalls.push(msg.params.request.url);
   });
   await cdp.send('Runtime.enable');await cdp.send('Network.enable');await cdp.send('Page.enable');
   await cdp.send('Page.navigate',{url:`${origin}/index.html`});await wait(500);
   await cdp.send('Runtime.evaluate',{expression:`localStorage.setItem(${JSON.stringify(USER_KEY)},${JSON.stringify(check.uid)})`});
   await cdp.send('Page.navigate',{url:`${origin}/${check.page}`});
   const label=`${check.page} as ${check.uid}`;
   const {ok,body}=await waitForText(cdp,['PAWS Frontend Demo',...check.text]);
   if(!ok)problems.push(`${label}: missing ${check.text.filter(text=>!body.includes(text)).join(', ')||'banner'}`);
   if(errors.length)problems.push(`${label}: script error ${errors[0].split('\n')[0]}`);
   if(apiCalls.length)problems.push(`${label}: request reached the real PAWS API ${apiCalls[0]}`);
   if(check.page==='index.html'&&check.uid==='uid-owner'&&ok){
     // Exercise the multi-year workspace through the actual staged browser.
     const probe=await cdp.send('Runtime.evaluate',{expression:"(function(){try{const launcher=document.getElementById('paws-multi-year-open');if(!launcher)return{ok:false,error:'Launcher missing'};launcher.click();const dialog=document.getElementById('paws-multi-year-demo');if(!dialog||!dialog.open)return{ok:false,error:'Academic Year dialog did not open'};const before=dialog.querySelector('[data-my-year]');if(!before||before.value!=='2026-27')return{ok:false,error:'2026-27 initial year missing'};const create=dialog.querySelector('[data-my-action=\"create-year\"]');if(!create)return{ok:false,error:'Owner Create Next Year missing'};create.click();const after=dialog.querySelector('[data-my-year]');if(!after||after.value!=='2027-28')return{ok:false,error:'Create Next Year did not select 2027-28',year:after?.value||''};const model=window.PAWS_MULTI_YEAR_DEMO_MODEL;if(!model)return{ok:false,error:'Domain model missing'};const state=JSON.parse(localStorage.getItem(model.STORAGE_KEY)||'null');if(!state||state.years['2027-28']?.status!=='planning'||Object.keys(state.annual['2027-28']||{}).length)return{ok:false,error:'New year did not initialize as empty Planning'};return{ok:true};}catch(error){return{ok:false,error:String(error?.message||error)}}})()",returnByValue:true});
     if(!probe.result?.value?.ok)problems.push(label+': multi-year modal probe failed: '+JSON.stringify(probe.result?.value||probe.exceptionDetails||'no result'));
     else console.log('ok   Multi-year Owner workspace creates an empty 2027-28 planning year');
     const enhanced=await cdp.send('Runtime.evaluate',{expression:"(function(){try{\n const dialog=document.getElementById('paws-multi-year-demo');\n const yearHeader=document.getElementById('paws-global-academic-year');\n if(!yearHeader||yearHeader.value!=='2027-28')return{ok:false,reason:'Top Academic Year selector not synchronized'};\n const button=dialog.querySelector('[data-my-tab=\"rollover\"]');\n if(!button)return{ok:false,reason:'Rollover tab not available'};\n button.click();\n const form=dialog.querySelector('[data-my-form=\"rollover-preview\"]');\n if(!form)return{ok:false,reason:'Rollover form missing'};\n const select=form.querySelector('[name=\"code\"]'),code=select?.value;\n if(!code)return{ok:false,reason:'No Published source Course for rollover'};\n form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));\n const create=dialog.querySelector('[data-my-action=\"rollover-confirm\"]');\n if(!create)return{ok:false,reason:'Selective rollover preview missing'};\n const original=window.confirm;window.confirm=()=>true;try{create.click()}finally{window.confirm=original}\n const state=JSON.parse(localStorage.getItem(window.PAWS_MULTI_YEAR_DEMO_MODEL.STORAGE_KEY)||'null');\n const course=state?.annual?.['2027-28']?.[code];\n if(!course||course.working.length!==0||course.published.length!==0)return{ok:false,reason:'Rollover did not create empty Working Course',code};\n if(!dialog.querySelector('[data-my-tab=\"review\"]'))return{ok:false,reason:'Publish Review tab missing'};\n dialog.querySelector('[data-my-tab=\"compare\"]').click();\n if(!dialog.textContent.includes('Cross-year Teaching / DOE Comparison'))return{ok:false,reason:'Comparison view missing'};\n return{ok:true,code};\n}catch(error){return{ok:false,reason:String(error?.message||error)}}})()",returnByValue:true});
     if(!enhanced.result?.value?.ok)problems.push(label+': selective rollover browser flow failed: '+JSON.stringify(enhanced.result?.value||enhanced.exceptionDetails||'no result'));
     else console.log('ok   Year selector, selective Published rollover, Publish Review and Cross-Year Comparison');
   }
   if(check.page==='index.html'&&check.uid==='uid-developer'&&ok){
     // Real staged-browser test: approve a seeded ADFA SWAP with synthetic data.
     const executed=await cdp.send('Runtime.evaluate',{expression:"(async function demoApprovalBrowserProbe(){\n  try{\n    const api=window.UCVM_PAWS_DATA,swap=window.PAWS_SWAP;\n    if(!api?.swapQueue||!swap?.openDetail)return{ok:false,error:'SWAP client not ready'};\n    const queue=await api.swapQueue();\n    const request=(queue.requests||[]).find(r=>r.nextStage==='adfa'&&r.status==='pending'&&r.changes?.replacementCandidateKey);\n    if(!request)return{ok:false,error:'No seeded final ADFA request'};\n    await swap.openDetail(request.requestId);\n    const approve=document.querySelector('.sql-swap-approval-dialog [data-decision=\"approve\"]');\n    if(!approve)return{ok:false,error:'Approve button not rendered'};\n    if(approve.disabled)return{ok:false,error:'Approve disabled',preview:document.querySelector('[data-approval-doe]')?.innerText||''};\n    const reason=document.querySelector('.sql-swap-approval-dialog [data-override]');\n    if(reason)reason.value='Synthetic conflict reviewed by Developer';\n    approve.click();\n    const confirm=document.querySelector('.sql-swap-approval-dialog [data-confirm-action]');\n    if(!confirm)return{ok:false,error:'Approval confirmation not shown'};\n    confirm.click();\n    for(let i=0;i<50;i++){\n      await new Promise(resolve=>setTimeout(resolve,150));\n      const detail=await api.swapDetail(request.requestId);\n      if(detail.request?.status==='applied')return{ok:true,status:'applied',requestId:request.requestId};\n    }\n    return{ok:false,error:'Approval did not reach applied state'};\n  }catch(error){return{ok:false,error:String(error?.message||error)};}\n})()",awaitPromise:true,returnByValue:true});
     const result=executed.result?.value;
     if(!result?.ok)problems.push(`${label}: ADFA demo approval failed: ${JSON.stringify(result||executed.exceptionDetails||'no result').slice(0,450)}`);
     else console.log('ok   ADFA SWAP final approval applies to browser-local timetable');
   }
   console.log(`${ok&&!errors.length&&!apiCalls.length?'ok  ':'FAIL'} ${label}`);
   cdp.close();await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(()=>{});
  }
 }finally{
  const exited=new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve)});
  child.kill();server.close();await Promise.race([exited,wait(5000)]);
  try{fs.rmSync(userDataDir,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}
 }
 if(problems.length){console.error(problems.join('\n'));process.exitCode=1}
 else console.log(`PAWS browser smoke passed (${CHECKS.length} page/role checks).`);
}

if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exit(1)});
module.exports={CHECKS};
