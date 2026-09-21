'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const task=require('./task.js');
const {safePath,redact,id}=require('./safety.js');
const {validate}=require('./schema.js');
function profiles(root){
 const node=process.execPath,cli=safePath(root,'node_modules/firebase-tools/lib/bin/firebase.js');
 const command=(args,timeout=180000)=>({exe:node,args,timeout});
 return {
  unit:command(['--test','--test-reporter=tap','tests/*.test.js']),
  server:command(['--test','--test-reporter=tap','server/test/*.test.js']),
  build:command(['tools/build-static.js']),
  emulator:command([cli,'emulators:exec','--only','firestore,auth','--project','demo-ucvm-access',
   'node --test --test-reporter=tap --test-concurrency=1 tests/*.test.js && node --test --test-reporter=tap server/test/*.test.js'],900000),
  browser:command(['tools/browser-smoke.js']),
  demo:command(['tools/ai/smoke-demo.js']),
  authenticated:command([cli,'emulators:exec','--only','firestore,auth','--project','vista-teaching-lab',
   'node tools/seed-database.js --emulator && node tools/browser-smoke.js --authenticated && node tools/password-browser-smoke.js'],900000)
 };
}
function cleanEnv(env){
 const allowed=/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|JAVA_HOME|CHROME_PATH|CI|LANG|LC_ALL)$/i;
 return Object.fromEntries(Object.entries(env).filter(([key])=>allowed.test(key)));
}
function summarize(run){
 const output=redact((run.stdout||'')+'\n'+(run.stderr||''));
 const skipped=[...output.matchAll(/^# skipped (\d+)$/gm)].reduce((n,m)=>n+Number(m[1]),0);
 const failed=[...output.matchAll(/^# fail (\d+)$/gm)].some(m=>Number(m[1])>0);
 const result=run.error?.code==='ENOENT'?'NOT RUN':run.status!==0||run.error||failed?'FAIL':skipped?'NOT RUN':'PASS';
 return {output,skipped,result,exit_code:Number.isInteger(run.status)?run.status:null,
 reason:run.error?redact(run.error.message):skipped?'Tests were skipped; run the emulator profile for security coverage.':result==='FAIL'?'Command failed.':''};
}
function verify(root,number,selected,{run=spawnSync,env=process.env}={}){
 const spec=task.validSpec(root,number),ctx=task.context(root,number),registry=profiles(root);
 const names=selected?.length?selected:spec.required_tests;
 if(new Set(names).size!==names.length||names.some(n=>!Object.hasOwn(registry,n)))throw Error('Unknown or duplicate verification profile');
 const report={issue:Number(id(number)),...ctx,started_at:new Date().toISOString(),finished_at:'',checks:[]};
 const dir=safePath(root,'.ai','generated',id(number));fs.mkdirSync(dir,{recursive:true});
 for(const profile of names){
  const command=registry[profile],raw=run(command.exe,command.args,{cwd:root,env:cleanEnv(env),shell:false,encoding:'utf8',timeout:command.timeout,maxBuffer:16*1024*1024});
  const result=summarize(raw),log='.ai/generated/'+id(number)+'/'+profile+'.log';
  fs.writeFileSync(safePath(root,log),result.output);
  report.checks.push({profile,command:'node '+command.args.join(' '),result:result.result,exit_code:result.exit_code,skipped:result.skipped,reason:result.reason,log});
 }
 report.finished_at=new Date().toISOString();
 if(task.context(root,number).source_digest!==ctx.source_digest)throw Error('Source changed during verification; rerun');
 validate('verification',report);task.write(root,number,'verification.json',report);
 task.write(root,number,'05-verification.md','# Verification\n\n'+report.checks.map(c=>'- '+c.profile+': '+c.result+' — '+(c.reason||'exit '+c.exit_code)+'; log: '+c.log).join('\n')+'\n');
 return report;
}
module.exports={verify,profiles,cleanEnv,summarize};
