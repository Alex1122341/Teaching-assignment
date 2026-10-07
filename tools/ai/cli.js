#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const task=require('./task.js');
const {verify}=require('./verify.js');
const {id,assertSafe}=require('./safety.js');
const REPO='Alex1122341/Teaching-assignment';
async function issueFromGitHub(number,token=process.env.GH_TOKEN){
 const response=await fetch('https://api.github.com/repos/'+REPO+'/issues/'+id(number),{
  headers:{Accept:'application/vnd.github+json','User-Agent':'vista-ai-v1',...(token?{Authorization:'Bearer '+token}:{})},
  signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('GitHub issue request failed: HTTP '+response.status);
 const text=await response.text();if(text.length>256*1024)throw Error('GitHub response too large');
 const issue=JSON.parse(text);if(issue.number!==Number(number)||issue.pull_request)throw Error('Expected matching Issue, not PR');
 return issue;
}
async function main(argv=process.argv.slice(2),root=path.resolve(__dirname,'../..')){
 const [command,number,argument,...rest]=argv;
 if(command==='validate'){const out=task.validateAll(root);console.log(JSON.stringify(out,null,2));return}
 if(command==='help'||!command){
  console.log('ai:task <ID> [--issue-file FILE] | ai:architect <ID> | ai:builder <ID> hy4|deepseek|codex | ai:review <ID> hy4|deepseek|codex | ai:verify <ID> [unit,server,build,emulator,browser,demo,authenticated] | ai:final-review <ID> | ai:status <ID> | ai:advance <ID> <stage> | ai:collect <ID> | ai:validate');return;
 }
 id(number);
 let output;
 if(command==='task'){
  if(argument&&argument!=='--issue-file')throw Error('Expected --issue-file or no options');
  let issue;
  if(argument==='--issue-file'){
   if(rest.length!==1)throw Error('Expected one issue JSON file');
   const text=fs.readFileSync(rest[0],'utf8');if(text.length>256*1024)throw Error('Issue JSON too large');assertSafe(text);issue=JSON.parse(text);
  }else issue=await issueFromGitHub(number);
  if(issue.number!==Number(number))throw Error('Issue number mismatch');
  output=task.init(root,issue);task.prompt(root,number,'architect');
 }else if(['architect','builder','review','integrator','final-review'].includes(command)){
  output=task.prompt(root,number,command,argument);
 }else if(command==='verify'){
  output=verify(root,number,argument?argument.split(','):undefined);
  if(output.checks.some(c=>c.result!=='PASS'))process.exitCode=1;
 }else if(command==='status'){
  output=task.check(root,number);if(!output.ready)process.exitCode=1;
 }else if(command==='advance')output=task.advance(root,number,argument);
 else if(command==='collect')output=task.collect(root,number);
 else throw Error('Unknown command; use help');
 console.log(typeof output==='string'?output:JSON.stringify(output,null,2));
}
if(require.main===module)main().catch(e=>{console.error('AI workflow: '+e.message);process.exitCode=1});
module.exports={main,issueFromGitHub};
