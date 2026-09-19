const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
function recursiveFiles(directory,base=directory){
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const full=path.join(directory,entry.name);
  return entry.isDirectory()?recursiveFiles(full,base):[path.relative(base,full).split(path.sep).join('/')];
 });
}

test('Firebase and Azure use one generated static build',()=>{
 const firebase=JSON.parse(read('firebase.json'));
 const manifest=JSON.parse(read('tools/static-assets.json'));
 const bundles=JSON.parse(read('tools/runtime-bundles.json'));
 const azure=read('tools/deploy_azure_static_web.ps1');
 assert.equal(firebase.hosting.public,'.deploy-static');
 assert.match(JSON.stringify(firebase.hosting.predeploy),/build-static\.js/);
 assert.match(azure,/build-static\.js/);
 assert.match(azure,/\.deploy-static/);
 assert.equal(bundles.version,1);
 for(const file of ['index.html','faculty-admin.html','approval-workflow.js','faculty-swap-safe.js','absence-from-campus-app.pdf'])assert.ok(manifest.includes(file),`${file} is required`);
});

test('source static manifest excludes repository and development files',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 assert.equal(new Set(manifest).size,manifest.length);
 for(const file of manifest){
  assert.equal(path.isAbsolute(file),false);
  assert.equal(file.includes('..'),false);
  assert.doesNotMatch(file,/(^|\/)(\.git|tests|tools|functions|docs|output)(\/|$)/);
  assert.doesNotMatch(file,/\.(?:log|rules)$/);
 }
});

test('static builder validates source and bundle manifests and emits a generated deployment graph',()=>{
 const builder=read('tools/build-static.js');
 assert.match(builder,/static-assets\.json/);
 assert.match(builder,/runtime-bundles\.json/);
 assert.match(builder,/path\.resolve/);
 assert.match(builder,/startsWith/);
 assert.match(builder,/bundleText/);
 assert.match(builder,/rewriteHtmlForPage/);
 assert.match(builder,/deployment-assets\.json/);
 assert.match(builder,/rmSync/);
});

test('Firebase redirects the retired faculty page to the timetable',()=>{
 const hosting=JSON.parse(read('firebase.json')).hosting;
 assert.deepEqual(hosting.redirects?.find(rule=>rule.source==='/faculty-dashboard.html'),{
  source:'/faculty-dashboard.html',destination:'/index.html',type:301
 });
});

test('Azure stages its redirect after the same generated lightweight build',()=>{
 execFileSync(process.platform==='win32'?'pwsh.exe':'pwsh',[
  '-NoProfile','-File',path.join(root,'tools/deploy_azure_static_web.ps1'),'-SitePath',root,'-BuildOnly'
 ],{cwd:root,encoding:'utf8',timeout:30000});
 const output=path.join(root,'.deploy-static');
 const config=JSON.parse(fs.readFileSync(path.join(output,'staticwebapp.config.json'),'utf8'));
 assert.deepEqual(config.routes,[{route:'/faculty-dashboard.html',redirect:'/index.html',statusCode:301}]);

 const metadata=JSON.parse(fs.readFileSync(path.join(output,'deployment-assets.json'),'utf8'));
 assert.equal(metadata.schemaVersion,'ucvm-static-deployment-v1');
 assert.equal(metadata.sourceAssetCount,62);
 assert.equal(metadata.deploymentAssetCount,32);
 assert.equal(metadata.deployedJsCount,22);
 assert.equal(metadata.bundles.length,10);

 const actual=recursiveFiles(output).filter(name=>!['staticwebapp.config.json','deployment-assets.json'].includes(name)).sort();
 const expected=metadata.assets.map(row=>row.path).sort();
 assert.deepEqual(actual,expected);

 for(const name of ['afc-form-values.js','afc-pdf-browser.js','approval-workflow.js','faculty-swap-handoff.js','faculty-admin-enhancements.js']){
  assert.ok(actual.includes(name),name);
  assert.deepEqual(fs.readFileSync(path.join(output,name)),fs.readFileSync(path.join(root,name)),name);
 }
 for(const name of ['faculty-doe.js','data-index.js','firebase-config.js','faculty-access.js'])assert.equal(actual.includes(name),false,name);
 for(const name of ['bundles/shared-auth.bundle.js','bundles/shared-approval-request.bundle.js','bundles/timetable-app.bundle.js','bundles/faculty-runtime-main.bundle.js','bundles/user-management.bundle.js'])assert.ok(actual.includes(name),name);

 const generatedIndex=fs.readFileSync(path.join(output,'index.html'),'utf8');
 assert.match(generatedIndex,/src="bundles\/shared-auth\.bundle\.js"/);
 assert.match(generatedIndex,/src="bundles\/timetable-app\.bundle\.js"/);
 assert.doesNotMatch(generatedIndex,/src="faculty-doe\.js"/);
 assert.notEqual(generatedIndex,read('index.html'));

 assert.equal(fs.existsSync(path.join(output,'faculty-dashboard.html')),false);
});
