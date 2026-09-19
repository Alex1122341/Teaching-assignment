#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2);
const outArg=args.indexOf('--output');
const output=path.resolve(root,outArg>=0&&args[outArg+1]?args[outArg+1]:'output/doe-api');
const shared=[
 'doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js',
 'index-maintenance.js','data-index.js','faculty-doe.js','scheduling-core.js','calendar-session.js'
];
function copyFile(rel){
 const from=path.join(root,rel),to=path.join(output,rel);
 if(!fs.existsSync(from))throw new Error(`Required DOE API runtime file is missing: ${rel}`);
 fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);
}
function copyDir(from,to){
 fs.mkdirSync(to,{recursive:true});
 for(const entry of fs.readdirSync(from,{withFileTypes:true})){
  if(entry.name==='node_modules'||entry.name==='test')continue;
  const src=path.join(from,entry.name),dst=path.join(to,entry.name);
  if(entry.isDirectory())copyDir(src,dst);else fs.copyFileSync(src,dst);
 }
}
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
copyDir(path.join(root,'server'),path.join(output,'server'));
for(const rel of shared)copyFile(rel);
const manifest={schemaVersion:'ucvm-doe-api-package-v1',entrypoint:'server/src/server.js',sharedFiles:shared};
fs.writeFileSync(path.join(output,'doe-api-package.json'),JSON.stringify(manifest,null,2)+'\n');
process.stdout.write(`DOE API package staged at ${output}\n`);
