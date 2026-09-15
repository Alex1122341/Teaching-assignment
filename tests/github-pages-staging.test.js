'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const {
  injectTestBanner,
  buildFacultyDashboardRedirect,
  stagePagesDirectory
}=require('../tools/stage-github-pages');

const identity={
  prNumber:23,
  headSha:'1111111111111111111111111111111111111111',
  buildSha:'2222222222222222222222222222222222222222'
};

test('Pages banner identifies test host, live backend, PR and short head SHA',()=>{
  const html=injectTestBanner('<!doctype html><html><body class="app"><main>UCVM</main></body></html>',identity);
  assert.match(html,/id="github-pages-test-site-banner"/);
  assert.match(html,/TEST SITE - GitHub Pages/);
  assert.match(html,/Not Production - Live Firebase Backend/);
  assert.match(html,/PR #23/);
  assert.match(html,/1111111/);
  assert.equal((html.match(/github-pages-test-site-banner/g)||[]).length,1);
});

test('faculty dashboard Pages shim redirects within the project subpath',()=>{
  const html=buildFacultyDashboardRedirect(identity);
  assert.match(html,/\.\/index\.html/);
  assert.doesNotMatch(html,/url=\/index\.html/i);
  assert.doesNotMatch(html,/location\.replace\(['"]\/index\.html/);
  assert.match(html,/github-pages-test-site-banner/);
});

test('Pages staging changes only the supplied build directory',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucvm-pages-'));
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html><body>Index</body></html>');
  fs.writeFileSync(path.join(dir,'faculty-admin.html'),'<!doctype html><html><body>Faculty</body></html>');

  const result=stagePagesDirectory(dir,identity);
  assert.equal(result.htmlFiles,2);
  assert.match(fs.readFileSync(path.join(dir,'index.html'),'utf8'),/TEST SITE - GitHub Pages/);
  assert.match(fs.readFileSync(path.join(dir,'faculty-admin.html'),'utf8'),/Live Firebase Backend/);
  assert.ok(fs.existsSync(path.join(dir,'.nojekyll')));
  assert.ok(fs.existsSync(path.join(dir,'faculty-dashboard.html')));

  const meta=JSON.parse(fs.readFileSync(path.join(dir,'github-pages-build.json'),'utf8'));
  assert.deepEqual(meta,{
    environment:'github-pages-test',
    prNumber:23,
    headSha:identity.headSha,
    buildSha:identity.buildSha
  });
  fs.rmSync(dir,{recursive:true,force:true});
});

test('tracked web entry points use relative internal URLs for the Pages project subpath',()=>{
  const assets=JSON.parse(fs.readFileSync(path.join(root,'tools/static-assets.json'),'utf8'));
  for(const name of assets.filter(value=>value.endsWith('.html'))){
    const source=fs.readFileSync(path.join(root,name),'utf8');
    assert.doesNotMatch(source,/(?:href|src)=["']\/(?!\/)/i,`${name} has a root-absolute internal URL`);
  }
  const rootNavigation=/(?:window\.)?location(?:\.href)?\s*=\s*["']\/(?!\/)|(?:window\.)?location\.(?:assign|replace)\(\s*["']\/(?!\/)/i;
  for(const name of assets.filter(value=>value.endsWith('.js'))){
    const source=fs.readFileSync(path.join(root,name),'utf8');
    assert.doesNotMatch(source,rootNavigation,`${name} has root-absolute browser navigation`);
  }
});
