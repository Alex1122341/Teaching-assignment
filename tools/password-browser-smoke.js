'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {
  createAuthenticatedFixture,createStaticServer,findChrome,chromeCandidates,emulatorOrigin
}=require('./browser-smoke');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const RESET_FIXTURE={projectId:'vista-teaching-lab',email:'password-reset.browser-smoke@ucalgary.ca',password:'PasswordReset-Smoke-2026!'};

async function waitForDebugPort(userDataDir,child,timeoutMs=15000){
  const active=path.join(userDataDir,'DevToolsActivePort'),started=Date.now();
  while(Date.now()-started<timeoutMs){
    if(child.exitCode!==null)throw Error('Chrome exited before DevTools became available.');
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
async function closeTarget(port,id){try{await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(id)}`)}catch{}}
async function connectCdp(url){
  const ws=new WebSocket(url),pending=new Map(),listeners=new Set();
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Timed out opening Chrome DevTools WebSocket.')),10000);
    ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Chrome DevTools WebSocket error.'))},{once:true});
  });
  ws.addEventListener('message',event=>{
    let message;try{message=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString('utf8'))}catch{return}
    if(message.id&&pending.has(message.id)){
      const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);
      if(message.error)item.reject(Error(message.error.message||'Chrome DevTools command failed.'));else item.resolve(message.result||{});
      return;
    }
    for(const listener of listeners)listener(message);
  });
  let nextId=0;
  return{
    send(method,params={}){
      const id=++nextId;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Chrome DevTools command timed out: ${method}`))},15000);
        pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
      });
    },
    on(listener){listeners.add(listener);return()=>listeners.delete(listener)},
    close(){try{ws.close()}catch{}}
  };
}
function waitForEvent(cdp,method,timeoutMs=20000){
  return new Promise((resolve,reject)=>{
    let off=()=>{};const timer=setTimeout(()=>{off();reject(Error(`Timed out waiting for ${method}`))},timeoutMs);
    off=cdp.on(message=>{if(message.method!==method)return;clearTimeout(timer);off();resolve(message.params||{})});
  });
}
async function evaluate(cdp,expression){
  const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(String(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Browser evaluation failed.'));
  return result.result?.value;
}
async function waitForCondition(cdp,expression,label,timeoutMs=12000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    if(await evaluate(cdp,expression))return;
    await wait(150);
  }
  throw Error(`Timed out waiting for ${label}`);
}
async function resetCodes(authHost){
  const origin=emulatorOrigin(authHost,'127.0.0.1:9099');
  const response=await fetch(`${origin}/emulator/v1/projects/${RESET_FIXTURE.projectId}/oobCodes`);
  if(!response.ok)throw Error(`Auth emulator reset-code lookup failed: HTTP ${response.status}`);
  const body=await response.json();
  return Array.isArray(body.oobCodes)?body.oobCodes:[];
}
async function run(){
  const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST,firestoreHost=process.env.FIRESTORE_EMULATOR_HOST;
  if(!authHost||!firestoreHost)throw Error('Password browser smoke requires Auth and Firestore emulators.');
  if(!fs.existsSync(path.resolve(__dirname,'../.deploy-static/password.html')))throw Error('Build .deploy-static before running password browser smoke.');
  await createAuthenticatedFixture({authHost,firestoreHost,fixture:RESET_FIXTURE});
  const chrome=findChrome();
  if(!chrome)throw Error(`Chrome/Chromium was not found. Tried: ${chromeCandidates().join(', ')}`);
  const server=createStaticServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const origin=`http://127.0.0.1:${server.address().port}`,userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ucvm-password-reset-smoke-'));
  let stderr='',debugPort,target,cdp;
  const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${userDataDir}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',chunk=>{stderr+=chunk.toString()});
  try{
    debugPort=await waitForDebugPort(userDataDir,child);target=await newTarget(debugPort);cdp=await connectCdp(target.webSocketDebuggerUrl);
    await Promise.all([cdp.send('Runtime.enable'),cdp.send('Page.enable')]);
    const load=waitForEvent(cdp,'Page.loadEventFired');
    const nav=await cdp.send('Page.navigate',{url:`${origin}/password.html`});
    if(nav.errorText)throw Error(nav.errorText);await load;
    await waitForCondition(cdp,"(()=>document.getElementById('identity')?.textContent==='Not signed in'&&!document.getElementById('password-reset-section')?.hidden&&document.getElementById('password-change-section')?.hidden===true)()",'signed-out reset page');
    await evaluate(cdp,`(()=>{const input=document.getElementById('password-reset-email');input.value=${JSON.stringify(RESET_FIXTURE.email)};document.getElementById('password-reset-form').requestSubmit();return true})()`);
    await waitForCondition(cdp,"(()=>/If an account exists for that email/.test(document.getElementById('status')?.textContent||''))()",'privacy-preserving reset confirmation');
    const codes=await resetCodes(authHost);
    if(!codes.some(row=>String(row.email||'').toLowerCase()===RESET_FIXTURE.email.toLowerCase()&&String(row.requestType||'').toUpperCase()==='PASSWORD_RESET'))throw Error('Auth emulator did not record a PASSWORD_RESET code for the browser-smoke account.');
    process.stdout.write('Password reset browser smoke passed: signed-out page stayed accessible, reset submitted, privacy-safe confirmation rendered, and Auth emulator recorded the reset request.\n');
  }catch(error){
    if(stderr.trim())process.stderr.write(`Chrome stderr (tail):\n${stderr.slice(-4000)}\n`);
    throw error;
  }finally{
    try{cdp?.close()}catch{}
    if(debugPort&&target?.id)await closeTarget(debugPort,target.id);
    if(child.exitCode===null){child.kill('SIGTERM');for(let i=0;i<20&&child.exitCode===null;i++)await wait(100);if(child.exitCode===null)child.kill('SIGKILL')}
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(userDataDir,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
}
if(require.main===module)run().catch(error=>{console.error(error.stack||error);process.exit(1)});
module.exports={run};
