'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const runtimeFiles=[
  'server/src/auth/firebase-admin.js',
  'server/src/auth/firebase-sql-auth.js',
  'server/src/data/sql-connection.js',
  'server/src/data/sql-session-repository.js',
  'server/src/data/sql-user-repository.js',
  'server/src/data/data-api.js',
  'server/src/routes/data-routes.js',
  'server/src/http/errors.js',
  'server/src/runtime/swa-sql-runtime.js',
  'server/src/runtime/swa-functions.js'
];
const packageFiles=['swa-api/index.js','swa-api/host.json','swa-api/package.json','swa-api/package-lock.json'];

function safeRelative(value){
  const text=String(value||'').replace(/\\/g,'/');
  return text&&!text.startsWith('/')&&!text.startsWith('../')&&!text.includes('/../');
}

function buildSwaApi({rootDir=root,outputDir=path.join(rootDir,'.deploy-swa-api')}={}){
  const sourceRoot=path.resolve(rootDir);
  const output=path.resolve(outputDir);
  fs.rmSync(output,{recursive:true,force:true});
  fs.mkdirSync(output,{recursive:true});

  const files=[];
  const copy=(sourceRelative,targetRelative)=>{
    if(!safeRelative(sourceRelative)||!safeRelative(targetRelative))throw Error('Unsafe SWA API path.');
    const source=path.resolve(sourceRoot,sourceRelative);
    if(!source.startsWith(sourceRoot+path.sep)||!fs.existsSync(source)||!fs.statSync(source).isFile()){
      throw Error(`Required SWA API source is missing: ${sourceRelative}`);
    }
    const target=path.resolve(output,targetRelative);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(source,target);
    files.push(targetRelative.replace(/\\/g,'/'));
  };

  for(const relative of packageFiles)copy(relative,relative.replace(/^swa-api\//,''));
  for(const relative of runtimeFiles)copy(relative,relative);

  return{output,files:[...files].sort()};
}

if(require.main===module){
  const args=process.argv.slice(2);
  const at=args.indexOf('--output');
  const outputDir=at>=0&&args[at+1]?path.resolve(args[at+1]):path.join(root,'.deploy-swa-api');
  const result=buildSwaApi({outputDir});
  process.stdout.write(JSON.stringify({output:result.output,files:result.files.length})+'\n');
}

module.exports={runtimeFiles,buildSwaApi};
