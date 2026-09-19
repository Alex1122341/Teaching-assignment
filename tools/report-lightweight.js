'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {localScripts}=require('./build-static.js');

const root=path.resolve(__dirname,'..');
const pages=['index.html','faculty-admin.html','user-management.html','password.html'];

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function bytesFor(rootDir,relative){return fs.statSync(path.join(rootDir,relative)).size}
function round(value,digits=1){const factor=10**digits;return Math.round(value*factor)/factor}
function reduction(before,after){return before?round(((before-after)/before)*100):0}
function pageScriptCounts(rootDir,pageNames=pages){
 return Object.fromEntries(pageNames.map(page=>{
  const html=fs.readFileSync(path.join(rootDir,page),'utf8');
  return[page,localScripts(html).length];
 }));
}
function collectSourceMetrics(rootDir=root){
 const manifest=readJson(path.join(rootDir,'tools/static-assets.json'));
 const js=manifest.filter(name=>name.endsWith('.js'));
 return{
  assets:manifest.length,
  jsAssets:js.length,
  bytes:manifest.reduce((sum,name)=>sum+bytesFor(rootDir,name),0),
  jsBytes:js.reduce((sum,name)=>sum+bytesFor(rootDir,name),0),
  pageScripts:pageScriptCounts(rootDir)
 };
}
function collectDeploymentMetrics(rootDir=root){
 const deploy=path.join(rootDir,'.deploy-static');
 const metadata=readJson(path.join(deploy,'deployment-assets.json'));
 const js=metadata.assets.filter(row=>row.path.endsWith('.js'));
 return{
  assets:metadata.deploymentAssetCount,
  jsAssets:metadata.deployedJsCount,
  bytes:metadata.bytes,
  jsBytes:js.reduce((sum,row)=>sum+Number(row.bytes||0),0),
  pageScripts:pageScriptCounts(deploy),
  bundles:metadata.bundles.length,
  metadataBytes:fs.statSync(path.join(deploy,'deployment-assets.json')).size
 };
}
function row(label,before,after,suffix=''){
 const delta=after-before;
 const pct=reduction(before,after);
 const sign=delta>0?'+':'';
 return `| ${label} | ${before.toLocaleString()}${suffix} | ${after.toLocaleString()}${suffix} | ${sign}${delta.toLocaleString()}${suffix} (${delta<=0?'-':'+'}${Math.abs(pct)}%) |`;
}
function markdownReport(source,deployed){
 const lines=[
  '## Lightweight deployment metrics',
  '',
  '| Metric | Modular source graph | Generated deployment | Change |',
  '| --- | ---: | ---: | ---: |',
  row('Application assets',source.assets,deployed.assets),
  row('JavaScript assets',source.jsAssets,deployed.jsAssets),
  row('Application bytes',source.bytes,deployed.bytes,' B'),
  row('JavaScript bytes',source.jsBytes,deployed.jsBytes,' B')
 ];
 for(const page of pages){
  const label={'index.html':'Timetable direct JS','faculty-admin.html':'Faculty Dashboard direct JS','user-management.html':'User Management direct JS','password.html':'Password direct JS'}[page];
  lines.push(row(label,source.pageScripts[page],deployed.pageScripts[page]));
 }
 lines.push(
  '',
  `Generated bundles: **${deployed.bundles}**  `,
  `Deployment metadata: **${deployed.metadataBytes.toLocaleString()} B**  `,
  '',
  '> Source modules are intentionally retained; this report measures the browser deployment graph, not repository-file deletion.'
 );
 return lines.join('\n');
}
function run(rootDir=root){
 const source=collectSourceMetrics(rootDir),deployed=collectDeploymentMetrics(rootDir);
 const markdown=markdownReport(source,deployed);
 process.stdout.write(markdown+'\n');
 return{source,deployed,markdown};
}
if(require.main===module)run();
module.exports={pages,reduction,pageScriptCounts,collectSourceMetrics,collectDeploymentMetrics,markdownReport,run};
