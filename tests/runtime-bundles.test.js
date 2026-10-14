'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const web=path.join(root,'web'),readWeb=name=>fs.readFileSync(path.join(web,name),'utf8');
const config=JSON.parse(read('tools/runtime-bundles.json'));
const sourceManifest=JSON.parse(read('tools/static-assets.json'));
const build=require('../tools/build-static.js');

const localScripts=html=>[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]
 .map(match=>match[1].split(/[?#]/)[0])
 .filter(value=>value&&!/^https?:/i.test(value));

test('runtime bundle build exports deterministic pure helpers',()=>{
 for(const name of ['validateBundleConfig','bundleText','rewriteHtmlForPage','buildBundleArtifacts','hashedBundleOutput','deploymentPlan'])assert.equal(typeof build[name],'function',name);
});

test('generated bundle names are deterministic content hashes',()=>{
 const one=build.hashedBundleOutput('bundles/example.bundle.js','alpha');
 const same=build.hashedBundleOutput('bundles/example.bundle.js','alpha');
 const changed=build.hashedBundleOutput('bundles/example.bundle.js','beta');
 assert.equal(one,same);
 assert.notEqual(one,changed);
 assert.match(one,/^bundles\/example\.bundle\.[0-9a-f]{12}\.js$/);
});

test('generated startup bundles reference hashed lazy bundles and generated HTML references hashed startup bundles',()=>{
 const generated=build.buildBundleArtifacts({rootDir:web,config});
 const afc=generated.bundlePaths.get('bundles/afc-pdf.lazy.bundle.js');
 const approval=generated.bundlePaths.get('bundles/approval-workflow.lazy.bundle.js');
 const timetable=generated.artifacts.find(item=>item.logicalOutput==='bundles/timetable-app.bundle.js');
 assert.match(afc,/^bundles\/afc-pdf\.lazy\.bundle\.[0-9a-f]{12}\.js$/);
 assert.match(approval,/^bundles\/approval-workflow\.lazy\.bundle\.[0-9a-f]{12}\.js$/);
 assert.ok(timetable.content.includes(afc));
 assert.ok(timetable.content.includes(approval));
 assert.doesNotMatch(timetable.content,/bundles\/afc-pdf\.lazy\.bundle\.js/);
 assert.doesNotMatch(timetable.content,/bundles\/approval-workflow\.lazy\.bundle\.js/);
 const html=build.rewriteHtmlForPage(read('web/index.html'),'index.html',config,generated.bundlePaths);
 assert.match(html,/src="bundles\/shared-auth\.bundle\.[0-9a-f]{12}\.js"/);
 assert.match(html,/src="bundles\/timetable-app\.bundle\.[0-9a-f]{12}\.js"/);
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
 for(const source of ['js/absence-from-campus/afc-form-values.js','js/absence-from-campus/afc-pdf-browser.js','js/approvals/approval-workflow.js','js/faculty/faculty-swap-handoff.js','js/faculty/faculty-admin-enhancements.js'])assert.ok(sourceManifest.includes(source),source);
});

test('AFC PDF helpers form one ordered lazy deployment bundle',()=>{
 assert.ok(Array.isArray(config.lazyBundles));
 const afc=config.lazyBundles.find(bundle=>bundle.output==='bundles/afc-pdf.lazy.bundle.js');
 assert.ok(afc);
 assert.deepEqual(afc.sources,['js/absence-from-campus/afc-form-values.js','js/absence-from-campus/afc-pdf-browser.js']);
 const text=build.bundleText(afc.sources.map(source=>({source,content:readWeb(source)})));
 assert.ok(text.indexOf('/* SOURCE: js/absence-from-campus/afc-form-values.js */')<text.indexOf('/* SOURCE: js/absence-from-campus/afc-pdf-browser.js */'));
 const loader=read('web/js/core/asset-loader.js');
 assert.match(loader,/loadScriptOnce\('bundles\/afc-pdf\.lazy\.bundle\.js','UCVM_AFC_PDF'\)/);
 assert.doesNotMatch(loader,/loadScriptOnce\('[^']*afc-form-values\.js'/);
 assert.doesNotMatch(loader,/loadScriptOnce\('[^']*afc-pdf-browser\.js'/);
});

test('approval compatibility and workflow form one ordered lazy deployment bundle',()=>{
 const approval=config.lazyBundles.find(bundle=>bundle.output==='bundles/approval-workflow.lazy.bundle.js');
 assert.ok(approval);
 assert.deepEqual(approval.sources,['js/faculty/faculty-swap-handoff.js','js/approvals/approval-workflow.js']);
 const text=build.bundleText(approval.sources.map(source=>({source,content:readWeb(source)})));
 assert.ok(text.indexOf('/* SOURCE: js/faculty/faculty-swap-handoff.js */')<text.indexOf('/* SOURCE: js/approvals/approval-workflow.js */'));
 const loader=read('web/js/core/asset-loader.js'),access=read('web/js/core/faculty-access.js');
 assert.match(loader,/loadScriptOnce\('bundles\/approval-workflow\.lazy\.bundle\.js'\)/);
 assert.doesNotMatch(loader,/loadScriptOnce\('[^']*faculty-swap-handoff\.js'/);
 assert.doesNotMatch(loader,/loadScriptOnce\('[^']*approval-workflow\.js'/);
 assert.match(access,/UCVM_ASSETS\?\.ensureApprovalWorkflow/);
 assert.doesNotMatch(access,/load\('[^']*approval-workflow\.js'/);
});

test('shared approval request bundle removes cross-page duplication without reordering',()=>{
 const shared=config.bundles.find(bundle=>bundle.output==='bundles/shared-approval-request.bundle.js');
 assert.ok(shared);
 assert.deepEqual(shared.sources,['js/approvals/approval-routing.js','js/approvals/approval-request.js']);
 assert.deepEqual(shared.pages,['index.html','faculty-admin.html']);
 for(const source of shared.sources){
  assert.equal(config.bundles.filter(bundle=>bundle.sources.includes(source)).length,1,source);
 }
});

test('bundle source sequences are contiguous and non-overlapping on each declared page',()=>{
 assert.doesNotThrow(()=>build.validateBundleConfig({root:web,sourceManifest,config}));
});

test('generated page HTML reduces direct scripts without changing source HTML',()=>{
 const expected={'index.html':10,'faculty-admin.html':12,'user-management.html':6,'password.html':3};
 for(const [page,count] of Object.entries(expected)){
  const source=readWeb(page);
  const generated=build.rewriteHtmlForPage(source,page,config);
  assert.equal(localScripts(generated).length,count,page);
  assert.equal(readWeb(page),source,`${page} source must stay unchanged`);
  assert.doesNotMatch(generated,/src=["'][^"']*(?:faculty-doe|data-index|firebase-config)\.js["']/,`${page} should use bundles`);
 }
});

test('bundle output preserves source order and adds auditable source markers',()=>{
 const bundle=config.bundles.find(item=>item.output==='bundles/shared-faculty-scheduling.bundle.js');
 const text=build.bundleText(bundle.sources.map(source=>({source,content:readWeb(source)})));
 const first=text.indexOf('/* SOURCE: js/faculty/faculty-doe.js */');
 const second=text.indexOf('/* SOURCE: js/timetable/scheduling-core.js */');
 assert.ok(first>=0&&second>first);
 assert.ok(text.includes(read('web/js/faculty/faculty-doe.js')));
 assert.ok(text.includes(read('web/js/timetable/scheduling-core.js')));
 assert.doesNotMatch(text,/\/\* END SOURCE:/);
});

test('deployment plan replaces startup sources and both verified lazy helper groups',()=>{
 const plan=build.deploymentPlan({root:web,sourceManifest,config});
 assert.equal(plan.generatedBundles.length,12);
 assert.equal(plan.deployedJsCount,20);
 for(const source of ['js/absence-from-campus/afc-form-values.js','js/absence-from-campus/afc-pdf-browser.js','js/faculty/faculty-swap-handoff.js','js/approvals/approval-workflow.js'])assert.equal(plan.copyAssets.includes(source),false,source);
 for(const lazy of ['js/faculty/faculty-swap-safe.js','js/faculty/faculty-admin-enhancements.js'])assert.ok(plan.copyAssets.includes(lazy),lazy);
 for(const source of ['js/faculty/faculty-doe.js','js/timetable/scheduling-core.js','js/data-index/data-index.js','js/data-index/index-maintenance.js','js/data-index/audit-details.js','js/core/firebase-config.js','js/core/faculty-access.js'])assert.equal(plan.copyAssets.includes(source),false,source);
 assert.ok(plan.generatedBundles.includes('bundles/afc-pdf.lazy.bundle.js'));
 assert.ok(plan.generatedBundles.includes('bundles/approval-workflow.lazy.bundle.js'));
 for(const page of ['index.html','faculty-admin.html','user-management.html','password.html'])assert.ok(plan.copyAssets.includes(page),page);
});
