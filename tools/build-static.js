'use strict';
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const manifestPath=path.join(__dirname,'static-assets.json');
const outputArg=process.argv.indexOf('--output');
const output=path.resolve(outputArg>=0?process.argv[outputArg+1]:path.join(root,'.deploy-static'));
const allowedOutput=path.join(root,'.deploy-static');
const assets=JSON.parse(fs.readFileSync(manifestPath,'utf8'));

if(!Array.isArray(assets)||!assets.length)throw Error('Static asset manifest must be a non-empty array.');
if(new Set(assets).size!==assets.length)throw Error('Static asset manifest contains duplicates.');
if(output!==allowedOutput||!output.startsWith(root+path.sep))throw Error('Static build output must be the repository .deploy-static directory.');

fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
let bytes=0;
for(const relative of assets){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('..'))throw Error(`Unsafe static asset path: ${relative}`);
 const source=path.resolve(root,relative),rootPrefix=root.endsWith(path.sep)?root:root+path.sep;
 if(!source.startsWith(rootPrefix)||!fs.statSync(source).isFile())throw Error(`Required static asset is missing: ${relative}`);
 const destination=path.join(output,relative);
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.copyFileSync(source,destination);bytes+=fs.statSync(source).size;
}
console.log(JSON.stringify({output,files:assets.length,bytes}));
