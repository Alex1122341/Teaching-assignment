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

test('static builder validates sources, hashes generated bundles and emits deployment metadata',()=>{
 const builder=read('tools/build-static.js');
 assert.match(builder,/static-assets\.json/);
 assert.match(builder,/runtime-bundles\.json/);
 assert.match(builder,/node:crypto/);
 assert.match(builder,/hashedBundleOutput/);
 assert.match(builder,/buildBundleArtifacts/);
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

test('Firebase and Azure keep mutable assets revalidated while hashed bundles are immutable',()=>{
 const firebase=JSON.parse(read('firebase.json')).hosting.headers;
 const bundleRule=firebase.find(rule=>rule.source==='/bundles/**');
 const rootRule=firebase.find(rule=>rule.source==='/*.@(html|js|css)');
 assert.deepEqual(bundleRule.headers,[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]);
 assert.deepEqual(rootRule.headers,[{key:'Cache-Control',value:'no-cache, max-age=0, must-revalidate'}]);

 const azure=JSON.parse(read('staticwebapp.config.json'));
 const bundleRoute=azure.routes.find(rule=>rule.route==='/bundles/*');
 const rootRoute=azure.routes.find(rule=>rule.route==='/*.{html,js,css}');
 assert.equal(bundleRoute.headers['Cache-Control'],'public, max-age=31536000, immutable');
 assert.equal(rootRoute.headers['Cache-Control'],'no-cache, max-age=0, must-revalidate');
 assert.equal(azure.routes[0].route,'/faculty-dashboard.html','redirect stays ahead of cache wildcard routes');
});

test('Azure stages the canonical config after the same generated lightweight build',()=>{
 execFileSync(process.platform==='win32'?'pwsh.exe':'pwsh',[
  '-NoProfile','-File',path.join(root,'tools/deploy_azure_static_web.ps1'),'-SitePath',root,'-BuildOnly'
 ],{cwd:root,encoding:'utf8',timeout:30000});
 const output=path.join(root,'.deploy-static');
 const config=JSON.parse(fs.readFileSync(path.join(output,'staticwebapp.config.json'),'utf8'));
 assert.deepEqual(config,JSON.parse(read('staticwebapp.config.json')));

 const metadataPath=path.join(root,'.deploy-metadata','deployment-assets.json');
 const metadata=JSON.parse(fs.readFileSync(metadataPath,'utf8'));
 assert.equal(metadata.schemaVersion,'ucvm-static-deployment-v2');
 assert.equal(metadata.sourceAssetCount,63);
 assert.equal(metadata.deploymentAssetCount,30);
 assert.equal(metadata.deployedJsCount,20);
 assert.equal(metadata.bundles.length,12);

 const actual=recursiveFiles(output).filter(name=>name!=='staticwebapp.config.json').sort();
 const expected=metadata.assets.map(row=>row.path).sort();
 assert.deepEqual(actual,expected);

 assert.ok(actual.includes('faculty-admin-enhancements.js'));
 assert.deepEqual(fs.readFileSync(path.join(output,'faculty-admin-enhancements.js')),fs.readFileSync(path.join(root,'faculty-admin-enhancements.js')));
 for(const name of ['afc-form-values.js','afc-pdf-browser.js','faculty-swap-handoff.js','approval-workflow.js'])assert.equal(actual.includes(name),false,name);
 for(const name of ['faculty-doe.js','data-index.js','firebase-config.js','faculty-access.js'])assert.equal(actual.includes(name),false,name);

 const bundleByLogical=new Map(metadata.bundles.map(bundle=>[bundle.logicalOutput,bundle]));
 assert.equal(bundleByLogical.size,12);
 for(const logical of [
  'bundles/afc-pdf.lazy.bundle.js',
  'bundles/approval-workflow.lazy.bundle.js',
  'bundles/shared-auth.bundle.js',
  'bundles/shared-approval-request.bundle.js',
  'bundles/timetable-app.bundle.js',
  'bundles/faculty-runtime-main.bundle.js',
  'bundles/user-management.bundle.js'
 ]){
  const bundle=bundleByLogical.get(logical);
  assert.ok(bundle,logical);
  assert.ok(bundle.output.startsWith(logical.slice(0,-3)+'.'),bundle.output);
  assert.match(bundle.output,/\.[0-9a-f]{12}\.js$/);
  assert.equal(bundle.hash,bundle.output.match(/\.([0-9a-f]{12})\.js$/)?.[1]);
  assert.ok(actual.includes(bundle.output),bundle.output);
  assert.equal(actual.includes(logical),false,logical);
 }

 const generatedIndex=fs.readFileSync(path.join(output,'index.html'),'utf8');
 assert.ok(generatedIndex.includes(`src="${bundleByLogical.get('bundles/shared-auth.bundle.js').output}"`));
 assert.ok(generatedIndex.includes(`src="${bundleByLogical.get('bundles/timetable-app.bundle.js').output}"`));
 assert.doesNotMatch(generatedIndex,/src="faculty-doe\.js"/);
 assert.notEqual(generatedIndex,read('index.html'));

 const timetableBundle=fs.readFileSync(path.join(output,bundleByLogical.get('bundles/timetable-app.bundle.js').output),'utf8');
 assert.ok(timetableBundle.includes(bundleByLogical.get('bundles/afc-pdf.lazy.bundle.js').output));
 assert.ok(timetableBundle.includes(bundleByLogical.get('bundles/approval-workflow.lazy.bundle.js').output));
 assert.doesNotMatch(timetableBundle,/bundles\/afc-pdf\.lazy\.bundle\.js/);
 assert.doesNotMatch(timetableBundle,/bundles\/approval-workflow\.lazy\.bundle\.js/);

 assert.equal(fs.existsSync(path.join(output,'deployment-assets.json')),false);
 assert.equal(fs.existsSync(path.join(output,'faculty-dashboard.html')),false);
});
