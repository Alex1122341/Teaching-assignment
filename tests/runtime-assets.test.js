const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('runtime pages omit the undeployed Functions SDK',()=>{
 for(const name of ['index.html','faculty-admin.html','user-management.html'])assert.doesNotMatch(read(name),/firebase-functions-compat/);
});

test('retired faculty assets are absent from disk, manifest and all runtime links',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 for(const name of ['faculty-dashboard.html','faculty-dashboard.js']){
  assert.equal(fs.existsSync(path.join(root,name)),false,name);
  assert.equal(manifest.includes(name),false,name);
 }
 const runtime=manifest.filter(name=>/\.(html|js|css)$/.test(name)).map(read).join('\n');
 assert.doesNotMatch(runtime,/faculty-dashboard\.(?:html|js)/);
});

test('production manifest contains the complete 63-file dependency graph and no stale visible names',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 assert.equal(manifest.length,63);
 for(const name of ['approval-scheduling.js','approval-routing.js','approval-state.js','approval-office-view.js','approval-lifecycle.js','approval-finalizer.js','afc-form-values.js','afc-form-state.js','afc-timetable-panel.js','audit-details.js','derived-index-health.js','doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js','doe-policy-admin.js','doe-policy-admin.css','faculty-account-planner.js','faculty-doe.js','faculty-swap-handoff.js','faculty-swap-safe.js','index-maintenance.js','scheduling-core.js','university-closures.js','timetable-selection.js','workflow-notifications.js','user-management.css'])assert.ok(manifest.includes(name),name);
 const runtime=manifest.filter(name=>/\.(html|js)$/.test(name)).map(read).join('\n');
 assert.doesNotMatch(runtime,/Faculty Directory|Faculty Admin Dashboard|Open Faculty Dashboard/);
 for(const page of manifest.filter(name=>name.endsWith('.html'))){
  const html=read(page),references=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match=>match[1].split(/[?#]/)[0]).filter(value=>value&&!/^(?:https?:|#|mailto:|tel:)/.test(value));
  for(const reference of references)assert.ok(manifest.includes(reference),`${page} -> ${reference}`);
 }
});

test('scheduling core loads before approval bootstrap and timetable consumers',()=>{
 const html=read('index.html');
 assert.ok(html.includes('<script src="scheduling-core.js"></script>'));
 assert.ok(html.includes('<script src="faculty-access.js"></script>'));
 assert.ok(html.indexOf('scheduling-core.js')<html.indexOf('faculty-access.js'));
 assert.ok(html.indexOf('scheduling-core.js')<html.indexOf('timetable-selection.js'));
 assert.ok(html.indexOf('scheduling-core.js')<html.indexOf('timetable.js'));
});

test('Spark AFC client and its PDF template remain deployable',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 for(const name of ['afc-actions.js','afc-pdf-browser.js','afc-timetable-panel.js','absence-from-campus-app.pdf'])assert.ok(manifest.includes(name),name);
});

test('undeployed callable implementation and completed migration are removed',()=>{
 for(const name of ['functions/index.js','functions/afc-pdf.js','functions/bootstrap-general.js','tools/migrate_assigned_ad_rest.js'])assert.equal(fs.existsSync(path.join(root,name)),false,name);
 const deployed=JSON.parse(read('tools/static-assets.json')).map(read).join('\n');
 assert.doesNotMatch(deployed,/httpsCallable|bootstrapGeneral|replaceGroupAssignment/);
});


test('approval routing and state engines load before timetable workflow consumers',()=>{
 const html=read('index.html');
 for(const name of ['approval-routing.js','approval-state.js','approval-office-view.js','approval-lifecycle.js','approval-finalizer.js'])assert.ok(html.includes(`<script src="${name}"></script>`),name);
 assert.ok(html.indexOf('approval-routing.js')<html.indexOf('timetable.js'));
 assert.ok(html.indexOf('approval-state.js')<html.indexOf('timetable.js'));
 assert.ok(html.indexOf('approval-office-view.js')<html.indexOf('asset-loader.js'));
 assert.ok(html.indexOf('approval-lifecycle.js')<html.indexOf('asset-loader.js'));
 assert.ok(html.indexOf('approval-finalizer.js')<html.indexOf('asset-loader.js'));
 const loader=read('asset-loader.js');
 assert.ok(loader.includes("loadScriptOnce('approval-workflow.js')"));
});
