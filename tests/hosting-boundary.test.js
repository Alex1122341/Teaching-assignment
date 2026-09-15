const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Firebase and Azure use one allowlisted static build',()=>{
 const firebase=JSON.parse(read('firebase.json'));
 const manifest=JSON.parse(read('tools/static-assets.json'));
 const azure=read('tools/deploy_azure_static_web.ps1');
 assert.equal(firebase.hosting.public,'.deploy-static');
 assert.match(JSON.stringify(firebase.hosting.predeploy),/build-static\.js/);
 assert.match(azure,/build-static\.js/);
 assert.match(azure,/\.deploy-static/);
 for(const file of ['index.html','faculty-admin.html','approval-workflow.js','faculty-swap-safe.js','absence-from-campus-app.pdf'])assert.ok(manifest.includes(file),`${file} is required`);
});

test('static manifest excludes repository and development files',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 assert.equal(new Set(manifest).size,manifest.length);
 for(const file of manifest){
  assert.equal(path.isAbsolute(file),false);
  assert.equal(file.includes('..'),false);
  assert.doesNotMatch(file,/(^|\/)(\.git|tests|tools|functions|docs|output)(\/|$)/);
  assert.doesNotMatch(file,/\.(?:log|rules)$/);
 }
});

test('static builder validates sources and copies exactly the manifest',()=>{
 const builder=read('tools/build-static.js');
 assert.match(builder,/static-assets\.json/);
 assert.match(builder,/path\.resolve/);
 assert.match(builder,/startsWith/);
 assert.match(builder,/copyFileSync/);
 assert.match(builder,/rmSync/);
});

test('Firebase redirects the retired faculty page to the timetable',()=>{
 const hosting=JSON.parse(read('firebase.json')).hosting;
 assert.deepEqual(hosting.redirects?.find(rule=>rule.source==='/faculty-dashboard.html'),{
  source:'/faculty-dashboard.html',destination:'/index.html',type:301
 });
});

test('Azure stages its redirect after the static builder and preserves exactly the application allowlist',()=>{
 execFileSync(process.platform==='win32'?'pwsh.exe':'pwsh',[
  '-NoProfile','-File',path.join(root,'tools/deploy_azure_static_web.ps1'),'-SitePath',root,'-BuildOnly'
 ],{cwd:root,encoding:'utf8',timeout:30000});
 const output=path.join(root,'.deploy-static');
 const config=JSON.parse(fs.readFileSync(path.join(output,'staticwebapp.config.json'),'utf8'));
 assert.deepEqual(config.routes,[{route:'/faculty-dashboard.html',redirect:'/index.html',statusCode:301}]);
 const manifest=JSON.parse(read('tools/static-assets.json'));
 assert.equal(manifest.length,34);
 assert.deepEqual(fs.readdirSync(output).filter(name=>name!=='staticwebapp.config.json').sort(),[...manifest].sort());
 for(const name of manifest)assert.deepEqual(fs.readFileSync(path.join(output,name)),fs.readFileSync(path.join(root,name)));
 assert.equal(fs.existsSync(path.join(output,'faculty-dashboard.html')),false);
});
