'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const config=JSON.parse(read('tools/runtime-bundles.json'));
const sourceManifest=JSON.parse(read('tools/static-assets.json'));
const build=require('../tools/build-static.js');

const localScripts=html=>[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]
 .map(match=>match[1].split(/[?#]/)[0])
 .filter(value=>value&&!/^https?:/i.test(value));

test('runtime bundle build exports deterministic pure helpers',()=>{
 for(const name of ['validateBundleConfig','bundleText','rewriteHtmlForPage','deploymentPlan'])assert.equal(typeof build[name],'function',name);
});

test('bundle configuration uses safe generated paths and source allowlist entries',()=>{
 assert.equal(config.version,1);
 assert.ok(Array.isArray(config.bundles)&&config.bundles.length>0);
 const outputs=new Set();
 for(const bundle of config.bundles){
  assert.match(bundle.output,/^bundles\/[a-z0-9-]+\.bundle\.js$/);
  assert.equal(outputs.has(bundle.output),false,bundle.output);
  outputs.add(bundle.output);
  assert.ok(Array.isArray(bundle.sources)&&bundle.sources.length>=2,bundle.output);
  assert.ok(Array.isArray(bundle.pages)&&bundle.pages.length>=1,bundle.output);
  for(const source of bundle.sources)assert.ok(sourceManifest.includes(source),`${bundle.output}: ${source}`);
  for(const page of bundle.pages)assert.ok(sourceManifest.includes(page),`${bundle.output}: ${page}`);
 }
});

test('startup bundles exclude true lazy and compatibility runtime sources',()=>{
 const bundled=new Set(config.bundles.flatMap(bundle=>bundle.sources));
 for(const source of config.dynamicSources)assert.equal(bundled.has(source),false,source);
 for(const source of ['afc-form-values.js','afc-pdf-browser.js','approval-workflow.js','faculty-swap-handoff.js','faculty-admin-enhancements.js'])assert.ok(sourceManifest.includes(source),source);
});

test('AFC PDF helpers form one ordered lazy deployment bundle',()=>{
 assert.ok(Array.isArray(config.lazyBundles));
 const afc=config.lazyBundles.find(bundle=>bundle.output==='bundles/afc-pdf.lazy.bundle.js');
 assert.ok(afc);
 assert.deepEqual(afc.sources,['afc-form-values.js','afc-pdf-browser.js']);
 const text=build.bundleText(afc.sources.map(source=>({source,content:read(source)})));
 assert.ok(text.indexOf('/* SOURCE: afc-form-values.js */')<text.indexOf('/* SOURCE: afc-pdf-browser.js */'));
 const loader=read('asset-loader.js');
 assert.match(loader,/loadScriptOnce\('bundles\/afc-pdf\.lazy\.bundle\.js','UCVM_AFC_PDF'\)/);
 assert.doesNotMatch(loader,/loadScriptOnce\('afc-form-values\.js'/);
 assert.doesNotMatch(loader,/loadScriptOnce\('afc-pdf-browser\.js'/);
});

test('approval compatibility and workflow form one ordered lazy deployment bundle',()=>{
 const approval=config.lazyBundles.find(bundle=>bundle.output==='bundles/approval-workflow.lazy.bundle.js');
 assert.ok(approval);
 assert.deepEqual(approval.sources,['faculty-swap-handoff.js','approval-workflow.js']);
 const text=build.bundleText(approval.sources.map(source=>({source,content:read(source)})));
 assert.ok(text.indexOf('/* SOURCE: faculty-swap-handoff.js */')<text.indexOf('/* SOURCE: approval-workflow.js */'));
 const loader=read('asset-loader.js'),access=read('faculty-access.js');
 assert.match(loader,/loadScriptOnce\('bundles\/approval-workflow\.lazy\.bundle\.js'\)/);
 assert.doesNotMatch(loader,/loadScriptOnce\('faculty-swap-handoff\.js'/);
 assert.doesNotMatch(loader,/loadScriptOnce\('approval-workflow\.js'/);
 assert.match(access,/UCVM_ASSETS\?\.ensureApprovalWorkflow/);
 assert.doesNotMatch(access,/load\('approval-workflow\.js'/);
});

test('shared approval request bundle removes cross-page duplication without reordering',()=>{
 const shared=config.bundles.find(bundle=>bundle.output==='bundles/shared-approval-request.bundle.js');
 assert.ok(shared);
 assert.deepEqual(shared.sources,['approval-routing.js','approval-request.js']);
 assert.deepEqual(shared.pages,['index.html','faculty-admin.html']);
 for(const source of shared.sources){
  assert.equal(config.bundles.filter(bundle=>bundle.sources.includes(source)).length,1,source);
 }
});

test('bundle source sequences are contiguous and non-overlapping on each declared page',()=>{
 assert.doesNotThrow(()=>build.validateBundleConfig({root,sourceManifest,config}));
});

test('generated page HTML reduces direct scripts without changing source HTML',()=>{
 const expected={'index.html':10,'faculty-admin.html':12,'user-management.html':6,'password.html':3};
 for(const [page,count] of Object.entries(expected)){
  const source=read(page);
  const generated=build.rewriteHtmlForPage(source,page,config);
  assert.equal(localScripts(generated).length,count,page);
  assert.equal(read(page),source,`${page} source must stay unchanged`);
  assert.doesNotMatch(generated,/src=["'](?:faculty-doe|data-index|firebase-config)\.js["']/,`${page} should use bundles`);
 }
});

test('bundle output preserves source order and adds auditable source markers',()=>{
 const bundle=config.bundles.find(item=>item.output==='bundles/shared-faculty-scheduling.bundle.js');
 const text=build.bundleText(bundle.sources.map(source=>({source,content:read(source)})));
 const first=text.indexOf('/* SOURCE: faculty-doe.js */');
 const second=text.indexOf('/* SOURCE: scheduling-core.js */');
 assert.ok(first>=0&&second>first);
 assert.ok(text.includes(read('faculty-doe.js')));
 assert.ok(text.includes(read('scheduling-core.js')));
 assert.doesNotMatch(text,/\/\* END SOURCE:/);
});

test('deployment plan replaces startup sources and both verified lazy helper groups',()=>{
 const plan=build.deploymentPlan({root,sourceManifest,config});
 assert.equal(plan.generatedBundles.length,12);
 assert.equal(plan.deployedJsCount,20);
 for(const source of ['afc-form-values.js','afc-pdf-browser.js','faculty-swap-handoff.js','approval-workflow.js'])assert.equal(plan.copyAssets.includes(source),false,source);
 for(const lazy of ['faculty-swap-safe.js','faculty-admin-enhancements.js'])assert.ok(plan.copyAssets.includes(lazy),lazy);
 for(const source of ['faculty-doe.js','scheduling-core.js','data-index.js','index-maintenance.js','audit-details.js','firebase-config.js','faculty-access.js'])assert.equal(plan.copyAssets.includes(source),false,source);
 assert.ok(plan.generatedBundles.includes('bundles/afc-pdf.lazy.bundle.js'));
 assert.ok(plan.generatedBundles.includes('bundles/approval-workflow.lazy.bundle.js'));
 for(const page of ['index.html','faculty-admin.html','user-management.html','password.html'])assert.ok(plan.copyAssets.includes(page),page);
});
