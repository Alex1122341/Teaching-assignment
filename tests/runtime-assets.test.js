const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const web=path.join(root,'web'),readWeb=name=>fs.readFileSync(path.join(web,name),'utf8');

test('runtime pages omit the undeployed Functions SDK',()=>{
 for(const name of ['index.html','faculty-admin.html','user-management.html'])assert.doesNotMatch(readWeb(name),/firebase-functions-compat/);
});

test('retired faculty assets are absent from disk, manifest and all runtime links',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 for(const name of ['faculty-dashboard.html','faculty-dashboard.js']){
  assert.equal(fs.existsSync(path.join(root,name)),false,name);
  assert.equal(fs.existsSync(path.join(web,name)),false,name);
  assert.equal(manifest.includes(name),false,name);
 }
 const runtime=manifest.filter(name=>/\.(html|js|css)$/.test(name)).map(readWeb).join('\n');
 assert.doesNotMatch(runtime,/faculty-dashboard\.(?:html|js)/);
});

test('source runtime allowlist contains the complete API-authoritative dependency graph and no stale visible names',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 assert.equal(manifest.length,69);
 for(const name of ['js/approvals/approval-scheduling.js','js/approvals/approval-routing.js','js/approvals/approval-state.js','js/approvals/approval-office-view.js','js/approvals/approval-lifecycle.js','js/approvals/approval-finalizer.js','js/absence-from-campus/afc-form-values.js','js/absence-from-campus/afc-form-state.js','js/absence-from-campus/afc-timetable-panel.js','js/data-index/audit-details.js','js/data-index/derived-index-health.js','js/core/firebase-config.js','js/doe/doe-api-client.js','js/doe/doe-worksheet-view.js','js/doe/doe-rulebook-admin.js','js/doe/doe-policy-admin.js','styles/doe-policy-admin.css','js/accounts/faculty-account-planner.js','js/faculty/faculty-doe.js','js/faculty/faculty-swap-handoff.js','js/faculty/faculty-swap-safe.js','js/data-index/index-maintenance.js','js/timetable/scheduling-core.js','js/timetable/university-closures.js','js/timetable/timetable-selection.js','js/approvals/workflow-notifications.js','styles/user-management.css'])assert.ok(manifest.includes(name),name);
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(manifest.includes(name),false,name);
 const runtime=manifest.filter(name=>/\.(html|js)$/.test(name)).map(readWeb).join('\n');
 assert.doesNotMatch(runtime,/Faculty Directory|Faculty Admin Dashboard|Open Faculty Dashboard/);
 for(const page of manifest.filter(name=>name.endsWith('.html'))){
  const html=readWeb(page),references=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match=>match[1].split(/[?#]/)[0]).filter(value=>value&&!/^(?:https?:|#|mailto:|tel:)/.test(value));
  for(const reference of references)assert.ok(manifest.includes(reference),`${page} -> ${reference}`);
 }
});

test('scheduling core loads before approval bootstrap and timetable consumers',()=>{
 const html=read('web/index.html');
 assert.ok(html.includes('<script src="js/timetable/scheduling-core.js"></script>'));
 assert.ok(html.includes('<script src="js/core/faculty-access.js"></script>'));
 assert.ok(html.indexOf('js/timetable/scheduling-core.js')<html.indexOf('js/core/faculty-access.js'));
 assert.ok(html.indexOf('js/timetable/scheduling-core.js')<html.indexOf('js/timetable/timetable-selection.js'));
 assert.ok(html.indexOf('js/timetable/scheduling-core.js')<html.indexOf('js/timetable/timetable.js'));
});

test('Spark AFC client and its PDF template remain deployable',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 for(const name of ['js/absence-from-campus/afc-actions.js','js/absence-from-campus/afc-pdf-browser.js','js/absence-from-campus/afc-timetable-panel.js','assets/forms/absence-from-campus-app.pdf','assets/forms/absence-from-campus-app-v2.pdf','assets/forms/absence-from-campus-terms.pdf'])assert.ok(manifest.includes(name),name);
});

test('undeployed callable implementation and completed migration are removed',()=>{
 for(const name of ['functions/index.js','functions/afc-pdf.js','functions/bootstrap-general.js','tools/migrate_assigned_ad_rest.js'])assert.equal(fs.existsSync(path.join(root,name)),false,name);
 const deployed=JSON.parse(read('tools/static-assets.json')).map(readWeb).join('\n');
 assert.doesNotMatch(deployed,/httpsCallable|bootstrapGeneral|replaceGroupAssignment/);
});


test('approval routing and state engines load before timetable workflow consumers',()=>{
 const html=read('web/index.html');
 for(const name of ['js/approvals/approval-routing.js','js/approvals/approval-state.js','js/approvals/approval-office-view.js','js/approvals/approval-lifecycle.js','js/approvals/approval-finalizer.js'])assert.ok(html.includes(`<script src="${name}"></script>`),name);
 assert.ok(html.indexOf('js/approvals/approval-routing.js')<html.indexOf('js/timetable/timetable.js'));
 assert.ok(html.indexOf('js/approvals/approval-state.js')<html.indexOf('js/timetable/timetable.js'));
 assert.ok(html.indexOf('js/approvals/approval-office-view.js')<html.indexOf('js/core/asset-loader.js'));
 assert.ok(html.indexOf('js/approvals/approval-lifecycle.js')<html.indexOf('js/core/asset-loader.js'));
 assert.ok(html.indexOf('js/approvals/approval-finalizer.js')<html.indexOf('js/core/asset-loader.js'));
 const loader=read('web/js/core/asset-loader.js'),access=read('web/js/core/faculty-access.js');
 assert.ok(loader.includes("loadScriptOnce('bundles/approval-workflow.lazy.bundle.js')"));
 assert.ok(loader.includes("loadScriptOnce('bundles/afc-pdf.lazy.bundle.js','UCVM_AFC_PDF')"));
 assert.match(access,/UCVM_ASSETS\?\.ensureApprovalWorkflow/);
 assert.doesNotMatch(access,/load\('[^']*approval-workflow\.js'/);
});

test('DOE API runtime deploys and loads before Faculty and Timetable consumers without browser policy engine/storage',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 const deployable=['js/doe/doe-api-client.js','js/doe/doe-worksheet-view.js','js/doe/doe-rulebook-admin.js','js/doe/doe-policy-admin.js','styles/doe-policy-admin.css'];
 assert.equal(manifest.length,69);
 for(const name of deployable)assert.ok(manifest.includes(name),name);
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(manifest.includes(name),false,name);

 const faculty=read('web/faculty-admin.html');
 assert.ok(faculty.includes('<link rel="stylesheet" href="styles/doe-policy-admin.css">'));
 for(const name of ['js/doe/doe-api-client.js','js/doe/doe-worksheet-view.js','js/doe/doe-rulebook-admin.js','js/doe/doe-policy-admin.js'])assert.ok(faculty.includes(`<script src="${name}"></script>`),`faculty-admin.html -> ${name}`);
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(faculty.includes(`<script src="${name}"></script>`),false,name);
 assert.ok(faculty.indexOf('js/doe/doe-api-client.js')<faculty.indexOf('js/doe/doe-worksheet-view.js'));
 assert.ok(faculty.indexOf('js/doe/doe-api-client.js')<faculty.indexOf('js/doe/doe-rulebook-admin.js'));
 assert.ok(faculty.indexOf('js/doe/doe-rulebook-admin.js')<faculty.indexOf('js/doe/doe-policy-admin.js'));
 assert.ok(faculty.indexOf('js/doe/doe-worksheet-view.js')<faculty.indexOf('js/faculty/faculty-admin.js'));

 const timetable=read('web/index.html');
 assert.ok(timetable.includes('<script src="js/doe/doe-api-client.js"></script>'));
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(timetable.includes(`<script src="${name}"></script>`),false,name);
 assert.doesNotMatch(timetable,/doe-policy-admin\.js|doe-policy-admin\.css/);
 assert.ok(timetable.indexOf('js/doe/doe-api-client.js')<timetable.indexOf('js/timetable/timetable-selection.js'));
 assert.ok(timetable.indexOf('js/doe/doe-api-client.js')<timetable.indexOf('js/timetable/timetable.js'));
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
