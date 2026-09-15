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

test('production manifest contains the complete 33-file dependency graph and no stale visible names',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 assert.equal(manifest.length,33);
 for(const name of ['afc-form-values.js','afc-form-state.js','afc-timetable-panel.js','audit-details.js','faculty-account-planner.js','faculty-doe.js','timetable-selection.js','user-management.css'])assert.ok(manifest.includes(name),name);
 const runtime=manifest.filter(name=>/\.(html|js)$/.test(name)).map(read).join('\n');
 assert.doesNotMatch(runtime,/Faculty Directory|Faculty Admin Dashboard|Open Faculty Dashboard/);
 for(const page of manifest.filter(name=>name.endsWith('.html'))){
  const html=read(page),references=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match=>match[1].split(/[?#]/)[0]).filter(value=>value&&!/^(?:https?:|#|mailto:|tel:)/.test(value));
  for(const reference of references)assert.ok(manifest.includes(reference),`${page} -> ${reference}`);
 }
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
