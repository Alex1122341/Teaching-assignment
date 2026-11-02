'use strict';
// CI gate: each pull request must make a meaningful change to its own
// public CHANGELOG.json entry compared with the PR base SHA.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {validateChangelog,assertPrUpdated}=require('./site-changelog');

function args(argv){
  const value=name=>argv[argv.indexOf(name)+1];
  const pr=Number(value('--pr')),base=value('--base');
  if(!Number.isSafeInteger(pr)||pr<1)throw new Error('--pr must be a positive integer.');
  if(typeof base!=='string'||!/^[0-9a-f]{40}$/i.test(base))throw new Error('--base must be a full Git commit SHA.');
  return {pr,base};
}
function previousDocument(base){
  // The base commit must exist. Only an absent changelog is allowed
  // (first-ever installation). Never hide invalid refs or Git errors.
  const git=(...argv)=>execFileSync('git',argv,{cwd:path.resolve(__dirname,'..'),encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git('rev-parse','--verify',base+'^{commit}');
  try{git('cat-file','-e',base+':CHANGELOG.json');}
  catch{return null;}
  return JSON.parse(git('show',base+':CHANGELOG.json'));
}
function main(argv){
  const {pr,base}=args(argv);
  const current=validateChangelog(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../CHANGELOG.json'),'utf8')));
  const changed=assertPrUpdated(current,previousDocument(base),pr);
  console.log('Change log accepted for PR #'+pr+': '+changed.title);
  return changed;
}
if(require.main===module){
  try{main(process.argv.slice(2));}catch(error){console.error('Change log validation failed: '+error.message);process.exitCode=1;}
}
module.exports={main,previousDocument,args};
