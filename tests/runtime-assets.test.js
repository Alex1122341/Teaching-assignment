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

test('source runtime allowlist contains the complete API-authoritative dependency graph and no stale visible names',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 assert.equal(manifest.length,69);
 for(const name of ['approval-scheduling.js','approval-routing.js','approval-state.js','approval-office-view.js','approval-lifecycle.js','approval-finalizer.js','afc-form-values.js','afc-form-state.js','afc-timetable-panel.js','audit-details.js','derived-index-health.js','firebase-config.js','doe-api-client.js','doe-worksheet-view.js','doe-rulebook-admin.js','doe-policy-admin.js','doe-policy-admin.css','faculty-account-planner.js','faculty-doe.js','faculty-swap-handoff.js','faculty-swap-safe.js','index-maintenance.js','scheduling-core.js','university-closures.js','timetable-selection.js','workflow-notifications.js','user-management.css'])assert.ok(manifest.includes(name),name);
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(manifest.includes(name),false,name);
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
 for(const name of ['afc-actions.js','afc-pdf-browser.js','afc-timetable-panel.js','absence-from-campus-app.pdf','absence-from-campus-app-v2.pdf','absence-from-campus-terms.pdf'])assert.ok(manifest.includes(name),name);
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
 const loader=read('asset-loader.js'),access=read('faculty-access.js');
 assert.ok(loader.includes("loadScriptOnce('bundles/approval-workflow.lazy.bundle.js')"));
 assert.ok(loader.includes("loadScriptOnce('bundles/afc-pdf.lazy.bundle.js','UCVM_AFC_PDF')"));
 assert.match(access,/UCVM_ASSETS\?\.ensureApprovalWorkflow/);
 assert.doesNotMatch(access,/load\('approval-workflow\.js'/);
});

test('DOE API runtime deploys and loads before Faculty and Timetable consumers without browser policy engine/storage',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 const deployable=['doe-api-client.js','doe-worksheet-view.js','doe-rulebook-admin.js','doe-policy-admin.js','doe-policy-admin.css'];
 assert.equal(manifest.length,69);
 for(const name of deployable)assert.ok(manifest.includes(name),name);
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(manifest.includes(name),false,name);

 const faculty=read('faculty-admin.html');
 assert.ok(faculty.includes('<link rel="stylesheet" href="doe-policy-admin.css">'));
 for(const name of ['doe-api-client.js','doe-worksheet-view.js','doe-rulebook-admin.js','doe-policy-admin.js'])assert.ok(faculty.includes(`<script src="${name}"></script>`),`faculty-admin.html -> ${name}`);
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(faculty.includes(`<script src="${name}"></script>`),false,name);
 assert.ok(faculty.indexOf('doe-api-client.js')<faculty.indexOf('doe-worksheet-view.js'));
 assert.ok(faculty.indexOf('doe-api-client.js')<faculty.indexOf('doe-rulebook-admin.js'));
 assert.ok(faculty.indexOf('doe-rulebook-admin.js')<faculty.indexOf('doe-policy-admin.js'));
 assert.ok(faculty.indexOf('doe-worksheet-view.js')<faculty.indexOf('faculty-admin.js'));

 const timetable=read('index.html');
 assert.ok(timetable.includes('<script src="doe-api-client.js"></script>'));
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(timetable.includes(`<script src="${name}"></script>`),false,name);
 assert.doesNotMatch(timetable,/doe-policy-admin\.js|doe-policy-admin\.css/);
 assert.ok(timetable.indexOf('doe-api-client.js')<timetable.indexOf('timetable-selection.js'));
 assert.ok(timetable.indexOf('doe-api-client.js')<timetable.indexOf('timetable.js'));
});



test('static deployment build is generated from source and bundle manifests',()=>{
 const build=read('tools/build-static.js'),bundles=JSON.parse(read('tools/runtime-bundles.json'));
 assert.match(build,/runtime-bundles\.json/);
 assert.match(build,/deployment-assets\.json/);
 assert.equal(bundles.version,1);
 assert.ok(bundles.bundles.length>0);
 const agents=read('AGENTS.md');
 assert.match(agents,/generated \`\.deploy-static\` artifact/);
 assert.match(agents,/runtime-bundles\.json/);
});
