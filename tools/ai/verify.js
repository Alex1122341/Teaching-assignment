'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {stripVTControlCharacters}=require('node:util');
const task=require('./task.js');
const {safePath,redact,id}=require('./safety.js');
const {validate}=require('./schema.js');
function profiles(root){
 const node=process.execPath,cli=safePath(root,'node_modules/firebase-tools/lib/bin/firebase.js');
 const command=(args,evidence,timeout=180000)=>({exe:node,args,evidence,timeout});
 return {
  unit:command(['--test','--test-reporter=tap','tests/*.test.js'],{kind:'tap',runs:1}),
  server:command(['--test','--test-reporter=tap','server/test/*.test.js'],{kind:'tap',runs:1}),
  build:command(['tools/build-static.js'],{kind:'build'}),
  emulator:command([cli,'emulators:exec','--only','firestore,auth','--project','demo-ucvm-access',
   'node --test --test-reporter=tap --test-concurrency=1 tests/*.test.js && node --test --test-reporter=tap server/test/*.test.js'],{kind:'tap',runs:2},900000),
  browser:command(['tools/browser-smoke.js'],{kind:'browser',mode:'emulator'}),
  demo:command(['tools/ai/smoke-demo.js'],{kind:'browser',mode:'Pages Frontend Demo'}),
  authenticated:command([cli,'emulators:exec','--only','firestore,auth','--project','vista-teaching-lab',
   'node tools/seed-database.js --emulator && node tools/browser-smoke.js --authenticated && node tools/password-browser-smoke.js'],{kind:'authenticated'},900000)
 };
}
function cleanEnv(env){
 const allowed=/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|JAVA_HOME|CHROME_PATH|CI|LANG|LC_ALL)$/i;
 return Object.fromEntries(Object.entries(env).filter(([key])=>allowed.test(key)));
}
// Fixed Node test profiles emit one complete TAP document per command. The
// emulator profile must complete BOTH the root and server commands, not just one.
function tapEvidence(output,runs){
 const reports=output.split(/^TAP version 13$/m).slice(1);
 if(reports.length!==runs)return false;
 return reports.every(report=>{
  const counts={};
  for(const field of ['tests','pass','fail','cancelled','skipped','todo']){
   const matches=[...report.matchAll(new RegExp('^# '+field+' (\\d+)$','gm'))];
   if(matches.length!==1||!Number.isSafeInteger(Number(matches[0][1])))return false;
   counts[field]=Number(matches[0][1]);
  }
  const plans=[...report.matchAll(/^1\.\.(\d+)$/gm)];
  const points=[...report.matchAll(/^(?:not )?ok (\d+)(?:\s|$)/gm)];
  return plans.length===1&&points.length>0&&Number(plans[0][1])===points.length&&
   points.every((point,index)=>Number(point[1])===index+1)&&counts.tests>=points.length&&
   counts.tests===counts.pass+counts.fail+counts.cancelled+counts.skipped+counts.todo&&
   counts.pass>0&&counts.fail===0&&counts.cancelled===0&&counts.skipped===0&&counts.todo===0;
 });
}
function pageEvidence(output,pattern){
 return [...output.matchAll(pattern)].some(match=>Number(match[1])>0&&Number(match[1])===Number(match[2]));
}
function hasEvidence(output,evidence){
 if(evidence?.kind==='tap')return tapEvidence(output,evidence.runs);
 if(evidence?.kind==='build')return output.split('\n').some(line=>{
  let record;try{record=JSON.parse(line)}catch{return false}
  return record&&typeof record.output==='string'&&/(?:^|[\\/])\.deploy-static$/.test(record.output)&&
   typeof record.metadataPath==='string'&&record.metadataPath.replace(/\\/g,'/').endsWith('.deploy-metadata/deployment-assets.json')&&
   ['files','bytes','metadataBytes','deployedJs','bundles'].every(key=>Number.isSafeInteger(record[key])&&record[key]>0);
 });
 if(evidence?.kind==='browser')return pageEvidence(output,new RegExp('^Browser smoke passed (\\d+)/(\\d+) pages in '+evidence.mode+' mode\\.$','gm'));
 if(evidence?.kind==='authenticated')return hasEvidence(output,{kind:'browser',mode:'emulator'})&&
  pageEvidence(output,/^Authenticated owner smoke passed (\d+)\/(\d+) protected pages: .+\.$/gm)&&
  /^Rule Book smoke checkpoint: recalculation completed\.$/m.test(output)&&
  /^Password reset browser smoke passed: signed-out page stayed accessible, reset submitted, privacy-safe confirmation rendered, and Auth emulator recorded the reset request\.$/m.test(output);
 return false;
}
function summarize(run,evidence){
 const output=redact((run.stdout||'')+'\n'+(run.stderr||''));
 const text=stripVTControlCharacters(output).replace(/\r\n/g,'\n');
 const skipped=[...text.matchAll(/^# skipped (\d+)$/gm)].reduce((n,m)=>n+Number(m[1]),0);
 const failed=/^\s*(?:not ok\b|Bail out!)/m.test(text)||[...text.matchAll(/^# (?:fail|cancelled) (\d+)$/gm)].some(m=>Number(m[1])>0);
 const pending=[...text.matchAll(/^# todo (\d+)$/gm)].some(m=>Number(m[1])>0);
 const result=run.error?.code==='ENOENT'?'NOT RUN':run.status!==0||run.error||run.signal||failed?'FAIL':skipped||pending||!hasEvidence(text,evidence)?'NOT RUN':'PASS';
 return {output,skipped,result,exit_code:Number.isInteger(run.status)?run.status:null,
 reason:run.error?redact(run.error.message):result==='FAIL'?'Command failed or reported a failed/cancelled test.':skipped?'Tests were skipped; run the emulator profile for security coverage.':pending?'Tests remain TODO.':result==='NOT RUN'?'Missing or incomplete '+(evidence?.kind||'profile-specific')+' completion evidence.':''};
}
function verify(root,number,selected,{run=spawnSync,env=process.env}={}){
 const spec=task.validSpec(root,number),ctx=task.context(root,number),registry=profiles(root);
 const names=selected?.length?selected:spec.required_tests;
 if(new Set(names).size!==names.length||names.some(n=>!Object.hasOwn(registry,n)))throw Error('Unknown or duplicate verification profile');
 const report={issue:Number(id(number)),...ctx,started_at:new Date().toISOString(),finished_at:'',checks:[]};
 const dir=safePath(root,'.ai','generated',id(number));fs.mkdirSync(dir,{recursive:true});
 for(const profile of names){
  const command=registry[profile],raw=run(command.exe,command.args,{cwd:root,env:cleanEnv(env),shell:false,encoding:'utf8',timeout:command.timeout,maxBuffer:16*1024*1024});
  const result=summarize(raw,command.evidence),log='.ai/generated/'+id(number)+'/'+profile+'.log';
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
