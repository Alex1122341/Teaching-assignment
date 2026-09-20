'use strict';
// ---------------------------------------------------------------------------
// Merged domain test file.
//
// This file was assembled from several small single-purpose test files in the
// same domain. No assertion was changed: each source body is preserved verbatim
// inside its own IIFE so top-level declarations from different files cannot
// collide, and the total number of tests is unchanged.
//
// Split it back out by taking each block below to its own file if a failure ever
// needs a narrower blast radius.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------------------
// merged from tests/github-pages-deployment.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('Pages workflow deploys only verified same-repository PRs to one fixed environment',()=>{
  const workflow=read('.github/workflows/github-pages-test.yml');
  assert.match(workflow,/pull_request:\s*\n\s+types:\s*\[opened, synchronize, reopened\]\s*\n\s+branches:\s*\[main\]/);
  assert.doesNotMatch(workflow,/pull_request_target/);
  assert.doesNotMatch(workflow,/\n\s*push:/);
  assert.match(workflow,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow,/group:\s*github-pages-test/);
  assert.match(workflow,/cancel-in-progress:\s*true/);
  assert.match(workflow,/contents:\s*read/);
  assert.match(workflow,/pages:\s*write/);
  assert.match(workflow,/id-token:\s*write/);
  assert.match(workflow,/uses:\s*actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow,/npm ci/);
  assert.match(workflow,/npm run test:all/);
  assert.match(workflow,/npm run test:emulator/);
  assert.doesNotMatch(workflow,/LAB_FIREBASE_WEB_CONFIG_JSON/);
  assert.match(workflow,/node tools\/build-firebase-config\.js --from-json tools\/production-firebase-web-config\.json/);
  assert.match(workflow,/node tools\/verify-preview-client-config\.js/);
  assert.match(workflow,/PRODUCTION_DOE_API_BASE_URL/);
  assert.match(workflow,/PAGES_DOE_API_BASE_URL/);
  assert.match(workflow,/--doe-api-base-url/);
  assert.match(workflow,/Verify DOE API health and GitHub Pages CORS when configured/);
  assert.match(workflow,/PRODUCTION_FRONTEND_ORIGIN:\s*https:\/\/alex1122341\.github\.io/);
  assert.match(workflow,/node tools\/verify-production-doe-api\.js/);
  assert.ok(workflow.indexOf('Prepare live Firebase compatibility configuration')<workflow.indexOf('Build static site'));
  assert.match(workflow,/node tools\/build-static\.js/);
  assert.match(workflow,/node tools\/stage-github-pages\.js/);
  assert.match(workflow,/--pr\s+["']?\$\{\{ github\.event\.pull_request\.number \}\}["']?/);
  assert.match(workflow,/--head-sha\s+["']?\$\{\{ github\.event\.pull_request\.head\.sha \}\}["']?/);
  assert.match(workflow,/--build-sha\s+["']?\$\{\{ github\.event\.pull_request\.head\.sha \}\}["']?/);
  assert.match(workflow,/actions\/configure-pages@v6/);
  assert.match(workflow,/actions\/upload-pages-artifact@v5/);
  assert.match(workflow,/path:\s*\.deploy-static/);
  assert.match(workflow,/include-hidden-files:\s*true/);
  assert.match(workflow,/actions\/deploy-pages@v5/);
  assert.match(workflow,/environment:\s*\n\s+name:\s*github-pages/);
  assert.match(workflow,/url:\s*\$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
});

test('Pages workflow leaves the independent Test workflow in place',()=>{
  const workflow=read('.github/workflows/test.yml');
  assert.match(workflow,/name:\s*Test/);
  assert.match(workflow,/pull_request:/);
  assert.match(workflow,/uses:\s*actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow,/push:\s*\n\s+branches:\s*\n\s+- main/);
});

test('setup docs define the fixed Pages live Firebase compatibility boundary',()=>{
  const setup=read('SETUP.md');
  assert.match(setup,/https:\/\/alex1122341\.github\.io\/Teaching-assignment\//);
  assert.match(setup,/GitHub Pages/i);
  assert.match(setup,/tester-teaching/);
  assert.match(setup,/Live Firebase Compatibility Mode|live Firebase compatibility/i);
  assert.match(setup,/DOE API.*GitHub Pages|GitHub Pages.*DOE API/i);
  assert.match(setup,/alex1122341\.github\.io/);
  assert.match(setup,/Authorized domains/i);
  assert.match(setup,/latest successful.*pull request|latest successful.*PR/i);
  assert.match(setup,/TEST SITE|Not Production/i);
});

test('setup docs require manual production approval after merge',()=>{
  const setup=read('SETUP.md');
  assert.match(setup,/production.*Environment|Environment.*production/i);
  assert.match(setup,/required reviewer/i);
  assert.match(setup,/Prevent self-review/i);
  assert.match(setup,/Approve and deploy/i);
  assert.match(setup,/main/);
  assert.match(setup,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(setup,/environment secret/i);
});

test('exact-head CI runs root and server DOE suites',()=>{
  const testWorkflow=read('.github/workflows/test.yml');
  const pagesWorkflow=read('.github/workflows/github-pages-test.yml');
  for(const workflow of [testWorkflow,pagesWorkflow]){
    assert.match(workflow,/npm run test:all/);
    assert.match(workflow,/npm run test:emulator/);
    assert.match(workflow,/github\.event\.pull_request\.head\.sha/);
  }
});

test('DOE API workflow verifies the exact PR head without deploying production',()=>{
  const workflow=read('.github/workflows/doe-api-test.yml');
  assert.match(workflow,/pull_request:/);
  assert.match(workflow,/ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow,/node-version:\s*['"]22['"]/);
  assert.match(workflow,/npm --prefix server (?:ci|install)/);
  assert.match(workflow,/npm --prefix server test/);
  assert.match(workflow,/node tools\/build-doe-api\.js/);
  assert.match(workflow,/output\/doe-api\/server\/src\/server\.js/);
  assert.doesNotMatch(workflow,/azure\/webapps-deploy|az webapp|production/i);
});
})();

// ------------------------------------------------------------------------
// merged from tests/github-pages-staging.test.js
// ------------------------------------------------------------------------
(() => {
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

test('Pages banner identifies test host, live Firebase compatibility mode, PR and short head SHA',()=>{
  const html=injectTestBanner('<!doctype html><html><body class="app"><main>UCVM</main></body></html>',identity);
  assert.match(html,/id="github-pages-test-site-banner"/);
  assert.match(html,/TEST SITE - GitHub Pages/);
  assert.match(html,/Live Firebase Compatibility Mode/);
  assert.match(html,/tester-teaching/);
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
  assert.match(fs.readFileSync(path.join(dir,'faculty-admin.html'),'utf8'),/Live Firebase Compatibility Mode/);
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
})();


(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('Pages compatibility preview uses the pinned tester-teaching Web SDK config and accepts only a verified HTTPS DOE API',()=>{
  const workflow=read('.github/workflows/github-pages-test.yml');
  const verifier=read('tools/verify-preview-client-config.js');
  assert.match(workflow,/tools\/production-firebase-web-config\.json/);
  assert.doesNotMatch(workflow,/LAB_FIREBASE_WEB_CONFIG_JSON/);
  assert.match(workflow,/EXPECTED_FIREBASE_PROJECT_ID:\s*tester-teaching/);
  assert.match(verifier,/tester-teaching/);
  assert.match(verifier,/GENERATE_WITH_/);
  assert.match(verifier,/AIza/);
  assert.match(verifier,/cleanBaseUrl/);
  assert.doesNotMatch(verifier,/must not be configured to reach a DOE API endpoint/);
});
})();
