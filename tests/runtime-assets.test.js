const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('runtime pages omit the undeployed Functions SDK',()=>{
 for(const name of ['index.html','faculty-admin.html','faculty-dashboard.html','user-management.html'])assert.doesNotMatch(read(name),/firebase-functions-compat/);
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
