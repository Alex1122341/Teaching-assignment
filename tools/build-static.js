'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.resolve(__dirname,'..');
const sourceManifestPath=path.join(__dirname,'static-assets.json');
const bundleManifestPath=path.join(__dirname,'runtime-bundles.json');

function readJson(filename){return JSON.parse(fs.readFileSync(filename,'utf8'))}
function contentHash(content){return crypto.createHash('sha256').update(String(content),'utf8').digest('hex').slice(0,12)}
function hashedBundleOutput(output,content){
 if(!safeRelative(output)||!output.endsWith('.js'))throw Error(`Cannot hash unsafe bundle output: ${output}`);
 return output.replace(/\.js$/,`.${contentHash(content)}.js`);
}
function bundleOutputFor(logicalOutput,bundlePaths){
 if(bundlePaths instanceof Map)return bundlePaths.get(logicalOutput)||logicalOutput;
 if(bundlePaths&&typeof bundlePaths==='object')return bundlePaths[logicalOutput]||logicalOutput;
 return logicalOutput;
}
function rewriteGeneratedBundleReferences(content,bundlePaths){
 let output=String(content);
 const entries=bundlePaths instanceof Map?[...bundlePaths.entries()]:Object.entries(bundlePaths||{});
 for(const [logical,hashed] of entries.sort((a,b)=>b[0].length-a[0].length))output=output.split(logical).join(hashed);
 return output;
}
function safeRelative(relative){
 if(typeof relative!=='string'||!relative||path.isAbsolute(relative))return false;
 if(relative.includes('\\'))return false;
 const parts=relative.split('/');
 return !parts.some(part=>!part||part==='.'||part==='..');
}
function localScripts(html){
 return[...String(html).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]
  .map(match=>match[1].split(/[?#]/)[0])
  .filter(value=>value&&!/^https?:/i.test(value));
}
function startupBundles(config){return Array.isArray(config.bundles)?config.bundles:[]}
function lazyBundles(config){return Array.isArray(config.lazyBundles)?config.lazyBundles:[]}
function allBundles(config){return [...startupBundles(config),...lazyBundles(config)]}
function bundleForPage(config,page){
 return startupBundles(config).filter(bundle=>bundle.pages.includes(page));
}
function validateBundleConfig({root:rootDir=root,sourceManifest,config}){
 if(!Array.isArray(sourceManifest)||!sourceManifest.length)throw Error('Static source manifest must be a non-empty array.');
 if(new Set(sourceManifest).size!==sourceManifest.length)throw Error('Static source manifest contains duplicates.');
 if(!config||config.version!==1||!Array.isArray(config.bundles)||!config.bundles.length)throw Error('Runtime bundle manifest version 1 with bundles is required.');
 const sourceSet=new Set(sourceManifest),dynamic=new Set(config.dynamicSources||[]),outputs=new Set(),lazyClaimed=new Set();
 for(const item of dynamic){
  if(!sourceSet.has(item))throw Error(`Dynamic runtime source is not in static source manifest: ${item}`);
 }
 for(const bundle of startupBundles(config)){
  if(!safeRelative(bundle.output)||!bundle.output.startsWith('bundles/')||!bundle.output.endsWith('.bundle.js'))throw Error(`Unsafe bundle output: ${bundle.output}`);
  if(outputs.has(bundle.output)||sourceSet.has(bundle.output))throw Error(`Duplicate/colliding bundle output: ${bundle.output}`);
  outputs.add(bundle.output);
  if(!Array.isArray(bundle.sources)||bundle.sources.length<2||new Set(bundle.sources).size!==bundle.sources.length)throw Error(`Bundle must contain at least two unique sources: ${bundle.output}`);
  if(!Array.isArray(bundle.pages)||!bundle.pages.length||new Set(bundle.pages).size!==bundle.pages.length)throw Error(`Bundle must declare unique pages: ${bundle.output}`);
  for(const source of bundle.sources){
   if(!safeRelative(source)||!sourceSet.has(source))throw Error(`Bundle source is not in static source manifest: ${bundle.output} -> ${source}`);
   if(dynamic.has(source))throw Error(`Dynamic runtime source cannot be placed in a startup bundle: ${source}`);
   const absolute=path.resolve(rootDir,source);
   if(!absolute.startsWith(rootDir+path.sep)||!fs.existsSync(absolute)||!fs.statSync(absolute).isFile())throw Error(`Bundle source is missing: ${source}`);
  }
  for(const page of bundle.pages){
   if(!safeRelative(page)||!page.endsWith('.html')||!sourceSet.has(page))throw Error(`Bundle page is not a source HTML asset: ${bundle.output} -> ${page}`);
  }
 }
 for(const bundle of lazyBundles(config)){
  if(!safeRelative(bundle.output)||!bundle.output.startsWith('bundles/')||!bundle.output.endsWith('.bundle.js'))throw Error(`Unsafe lazy bundle output: ${bundle.output}`);
  if(outputs.has(bundle.output)||sourceSet.has(bundle.output))throw Error(`Duplicate/colliding bundle output: ${bundle.output}`);
  outputs.add(bundle.output);
  if(!Array.isArray(bundle.sources)||bundle.sources.length<2||new Set(bundle.sources).size!==bundle.sources.length)throw Error(`Lazy bundle must contain at least two unique sources: ${bundle.output}`);
  for(const source of bundle.sources){
   if(!safeRelative(source)||!sourceSet.has(source))throw Error(`Lazy bundle source is not in static source manifest: ${bundle.output} -> ${source}`);
   if(!dynamic.has(source))throw Error(`Lazy bundle source must be declared dynamic: ${source}`);
   if(lazyClaimed.has(source))throw Error(`Dynamic source may belong to only one lazy bundle: ${source}`);
   lazyClaimed.add(source);
   const absolute=path.resolve(rootDir,source);
   if(!absolute.startsWith(rootDir+path.sep)||!fs.existsSync(absolute)||!fs.statSync(absolute).isFile())throw Error(`Lazy bundle source is missing: ${source}`);
  }
 }
 const pageNames=[...new Set(startupBundles(config).flatMap(bundle=>bundle.pages))];
 for(const page of pageNames){
  const html=fs.readFileSync(path.resolve(rootDir,page),'utf8'),scripts=localScripts(html),claimed=new Set();
  for(const bundle of bundleForPage(config,page)){
   const start=scripts.indexOf(bundle.sources[0]);
   if(start<0||bundle.sources.some((source,index)=>scripts[start+index]!==source))throw Error(`Bundle sources must be contiguous and ordered in ${page}: ${bundle.output}`);
   for(const source of bundle.sources){
    if(claimed.has(source))throw Error(`A source may belong to only one startup bundle per page: ${page} -> ${source}`);
    claimed.add(source);
   }
  }
 }
 return true;
}
function bundleText(parts){
 if(!Array.isArray(parts)||!parts.length)throw Error('Bundle parts are required.');
 return parts.map(part=>{
  if(!safeRelative(part.source))throw Error(`Unsafe bundle source marker: ${part.source}`);
  const content=String(part.content??'');
  return `/* SOURCE: ${part.source} */\n${content}${content.endsWith('\n')?'':'\n'};\n`;
 }).join('\n');
}
function rewriteHtmlForPage(html,page,config,bundlePaths){
 const bundles=bundleForPage(config,page),bySource=new Map();
 for(const bundle of bundles)bundle.sources.forEach((source,index)=>{
  if(bySource.has(source))throw Error(`Source assigned twice on ${page}: ${source}`);
  bySource.set(source,{bundle,index});
 });
 return String(html).replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi,(tag,raw)=>{
  const source=String(raw).split(/[?#]/)[0],entry=bySource.get(source);
  if(!entry)return tag;
  return entry.index===0?`<script src="${bundleOutputFor(entry.bundle.output,bundlePaths)}"></script>`:'';
 });
}
function buildBundleArtifacts({rootDir=root,config}){
 const bundlePaths=new Map(),artifacts=[];
 const buildOne=(bundle,kind)=>{
  const parts=bundle.sources.map(source=>({source,content:fs.readFileSync(path.resolve(rootDir,source),'utf8')}));
  const raw=bundleText(parts);
  const content=rewriteGeneratedBundleReferences(raw,bundlePaths);
  const output=hashedBundleOutput(bundle.output,content);
  const hash=contentHash(content);
  bundlePaths.set(bundle.output,output);
  artifacts.push({logicalOutput:bundle.output,output,hash,kind,sources:bundle.sources,pages:kind==='startup'?bundle.pages:[],content,bytes:Buffer.byteLength(content)});
 };
 for(const bundle of lazyBundles(config))buildOne(bundle,'lazy');
 for(const bundle of startupBundles(config))buildOne(bundle,'startup');
 const logicalOutputs=allBundles(config).map(bundle=>bundle.output);
 for(const artifact of artifacts){
  for(const logical of logicalOutputs){
   if(artifact.content.includes(logical))throw Error(`Generated bundle still contains unhashed bundle reference: ${artifact.logicalOutput} -> ${logical}`);
  }
 }
 return{bundlePaths,artifacts};
}
function deploymentPlan({root:rootDir=root,sourceManifest,config}){
 validateBundleConfig({root:rootDir,sourceManifest,config});
 const htmlPages=sourceManifest.filter(asset=>asset.endsWith('.html')),directPages=new Map();
 for(const page of htmlPages){
  const scripts=localScripts(fs.readFileSync(path.resolve(rootDir,page),'utf8'));
  for(const source of scripts){
   if(!directPages.has(source))directPages.set(source,new Set());
   directPages.get(source).add(page);
  }
 }
 const dynamic=new Set(config.dynamicSources||[]),bundledSources=new Set(startupBundles(config).flatMap(bundle=>bundle.sources));
 const covered=(source,page)=>bundleForPage(config,page).some(bundle=>bundle.sources.includes(source));
 const startupOmitted=[...bundledSources].filter(source=>{
  if(dynamic.has(source))return false;
  const pages=[...(directPages.get(source)||[])];
  return pages.length>0&&pages.every(page=>covered(source,page));
 });
 const lazyOmitted=lazyBundles(config).flatMap(bundle=>bundle.sources);
 for(const source of lazyOmitted){
  if((directPages.get(source)||new Set()).size)throw Error(`Lazy bundle source is still directly loaded by source HTML: ${source}`);
 }
 const omittedSources=[...new Set([...startupOmitted,...lazyOmitted])].sort();
 const omitted=new Set(omittedSources);
 const copyAssets=sourceManifest.filter(asset=>!omitted.has(asset));
 const generatedBundles=allBundles(config).map(bundle=>bundle.output);
 const deployedJsCount=copyAssets.filter(asset=>asset.endsWith('.js')).length+generatedBundles.filter(asset=>asset.endsWith('.js')).length;
 return{copyAssets,omittedSources,generatedBundles,deployedJsCount};
}
function buildStatic({rootDir=root,outputDir=path.join(root,'.deploy-static'),sourceManifest=readJson(sourceManifestPath),config=readJson(bundleManifestPath)}={}){
 const output=path.resolve(outputDir),allowedOutput=path.join(rootDir,'.deploy-static');
 if(output!==allowedOutput||!output.startsWith(rootDir+path.sep))throw Error('Static build output must be the repository .deploy-static directory.');
 validateBundleConfig({root:rootDir,sourceManifest,config});
 const plan=deploymentPlan({root:rootDir,sourceManifest,config});
 const generated=buildBundleArtifacts({rootDir,config});
 const metadataDir=path.join(rootDir,'.deploy-metadata'),metaPath=path.join(metadataDir,'deployment-assets.json');
 fs.rmSync(output,{recursive:true,force:true});
 fs.rmSync(metadataDir,{recursive:true,force:true});
 fs.mkdirSync(output,{recursive:true});
 fs.mkdirSync(metadataDir,{recursive:true});
 const written=[];
 const write=(relative,content)=>{
  if(!safeRelative(relative))throw Error(`Unsafe static output path: ${relative}`);
  const destination=path.resolve(output,relative);
  if(!destination.startsWith(output+path.sep))throw Error(`Static output escapes build directory: ${relative}`);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  if(Buffer.isBuffer(content))fs.writeFileSync(destination,content);else fs.writeFileSync(destination,String(content),'utf8');
  written.push({path:relative,bytes:fs.statSync(destination).size});
 };
 for(const relative of plan.copyAssets){
  if(!safeRelative(relative))throw Error(`Unsafe static asset path: ${relative}`);
  const source=path.resolve(rootDir,relative);
  if(!source.startsWith(rootDir+path.sep)||!fs.existsSync(source)||!fs.statSync(source).isFile())throw Error(`Required static asset is missing: ${relative}`);
  if(relative.endsWith('.html'))write(relative,rewriteHtmlForPage(fs.readFileSync(source,'utf8'),relative,config,generated.bundlePaths));
  else write(relative,fs.readFileSync(source));
 }
 const bundleDetails=[];
 for(const artifact of generated.artifacts){
  write(artifact.output,artifact.content);
  bundleDetails.push({logicalOutput:artifact.logicalOutput,output:artifact.output,hash:artifact.hash,kind:artifact.kind,sources:artifact.sources,pages:artifact.pages,bytes:artifact.bytes});
 }
 const bytes=written.reduce((sum,row)=>sum+row.bytes,0);
 const metadata={
  schemaVersion:'ucvm-static-deployment-v2',
  sourceAssetCount:sourceManifest.length,
  deploymentAssetCount:written.length,
  deployedJsCount:plan.deployedJsCount,
  bytes,
  omittedSources:plan.omittedSources,
  bundles:bundleDetails,
  assets:written
 };
 fs.writeFileSync(metaPath,JSON.stringify(metadata,null,2)+'\n','utf8');
 const metadataBytes=fs.statSync(metaPath).size;
 console.log(JSON.stringify({output,files:written.length,bytes,metadataPath:path.relative(rootDir,metaPath),metadataBytes,deployedJs:plan.deployedJsCount,bundles:bundleDetails.length}));
 return{...metadata,metadataBytes,metadataPath:metaPath,output};
}
if(require.main===module){
 const outputArg=process.argv.indexOf('--output');
 const output=path.resolve(outputArg>=0?process.argv[outputArg+1]:path.join(root,'.deploy-static'));
 buildStatic({outputDir:output});
}
module.exports={contentHash,hashedBundleOutput,bundleOutputFor,rewriteGeneratedBundleReferences,safeRelative,localScripts,startupBundles,lazyBundles,allBundles,validateBundleConfig,bundleText,rewriteHtmlForPage,buildBundleArtifacts,deploymentPlan,buildStatic};
