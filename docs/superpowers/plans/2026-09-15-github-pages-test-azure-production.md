# GitHub Pages Test + Gated Azure Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Azure PR previews with one fixed GitHub Pages test site, then require an explicit GitHub `production` environment approval before a verified `main` artifact is deployed to Azure Static Web Apps.

**Architecture:** Pull requests keep the existing independent `Test` CI and gain a self-gating GitHub Pages workflow that verifies the exact PR integration revision, builds `.deploy-static`, stages Pages-only test identity/routing compatibility, and publishes one fixed site at `https://alex1122341.github.io/Teaching-assignment/`. Pushes to `main` run a production-only Azure workflow with two jobs: validate/build/upload an immutable artifact first, then a `production` environment-gated job downloads those exact bytes and deploys them to Azure after manual approval.

**Tech Stack:** GitHub Actions, GitHub Pages, Azure Static Web Apps, Node.js 22, Java 21, Firebase Auth/Firestore emulators, vanilla HTML/CSS/JavaScript, Node's built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-15-github-pages-test-azure-production-design.md`

## Global Constraints

- Keep `main` as the only production source of truth; do not implement feature work directly on `main`.
- Keep `.github/workflows/test.yml` as the independent CI signal on pull requests and pushes to `main`.
- GitHub Pages is one fixed public test frontend at `https://alex1122341.github.io/Teaching-assignment/`; the latest successful same-repository PR deployment replaces the previous test version.
- Azure Static Web Apps is production-only after this change; no Azure PR preview or PR-close cleanup remains.
- Both GitHub Pages test and Azure production use the same Firebase project, `tester-teaching`.
- Node.js version is `22`; Java version is `21` for Firebase emulator tests.
- PR deployment must use regular `pull_request`, never `pull_request_target`.
- Only same-repository PRs may deploy the GitHub Pages test site.
- Pages deployment must not occur unless `npm ci`, `npm test`, `npm run test:emulator`, static build, and Pages staging all succeed.
- Pages staging is artifact-only behavior; it must not modify tracked application HTML or make the Azure production artifact show the test banner.
- Preserve committed `staticwebapp.config.json` for Azure; GitHub Pages gets a generated static compatibility shim for `/faculty-dashboard.html`.
- Production deployment must use a `production` GitHub Environment with required reviewer approval and deployment restricted to `main`.
- `Prevent self-review` must remain disabled for the `production` environment.
- Production deploy must download and deploy the exact artifact built before approval; it must not rebuild after approval.
- Use one `azure-production-main` concurrency group with cancellation so a newer `main` candidate supersedes an older pending approval.
- Keep `tools/deploy_azure_static_web.ps1` as the emergency/manual Azure fallback.
- Firebase Hosting stays out of routine web deployment.
- Firestore rules remain manually deployed when changed; this plan does not automate `firestore.rules` deployment.
- Never commit or print `AZURE_STATIC_WEB_APPS_API_TOKEN`.

## File Structure

- Create `tools/stage-github-pages.js`: deterministic Pages-only post-build staging helper. It injects the test banner into staged HTML, creates `faculty-dashboard.html`, writes `.nojekyll`, and writes non-secret build identity metadata.
- Create `tests/github-pages-staging.test.js`: unit/integration coverage for Pages staging, visible identity, relative redirect behavior, and subpath-safe static navigation.
- Create `.github/workflows/github-pages-test.yml`: same-repository PR verification/build/Pages deployment workflow.
- Create `tests/github-pages-deployment.test.js`: regression coverage for Pages workflow triggers, permissions, same-repo guard, concurrency, test gates, official Pages actions, and setup documentation.
- Modify `.github/workflows/azure-static-web-apps.yml`: make it `main`-only, split validation/build from gated production deployment, and hand off an Actions artifact.
- Modify `tests/azure-deployment.test.js`: replace Azure PR-preview assertions with production-only approval/artifact assertions while preserving canonical Azure config and fallback coverage.
- Modify `SETUP.md`: document one-time Pages, Firebase Authorized Domain, `production` Environment, environment-secret migration, routine test/merge/approval flow, and emergency/manual fallback.
- Retain `.github/workflows/test.yml`, `tools/build-static.js`, `tools/static-assets.json`, `staticwebapp.config.json`, `tools/deploy_azure_static_web.ps1`, `firebase.json`, and `firestore.rules` unless a test reveals a narrowly scoped compatibility defect.

---

### Task 1: Add deterministic GitHub Pages staging

**Files:**
- Create: `tools/stage-github-pages.js`
- Create: `tests/github-pages-staging.test.js`
- Read only: `tools/static-assets.json`

**Interfaces:**
- Consumes: a completed static build directory such as `.deploy-static`; identity `{ prNumber, headSha, buildSha }`.
- Produces: `stagePagesDirectory(directory, identity)`, `injectTestBanner(html, identity)`, `buildFacultyDashboardRedirect(identity)`, and a CLI:
  `node tools/stage-github-pages.js --directory .deploy-static --pr <number> --head-sha <40-hex> --build-sha <40-hex>`.
- Produces artifact-only files: `.nojekyll`, `faculty-dashboard.html`, `github-pages-build.json`.

- [ ] **Step 1: Write the failing staging tests**

Create `tests/github-pages-staging.test.js` with concrete coverage equivalent to:

```js
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

test('Pages staging mutates only the supplied build directory',()=>{
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

test('tracked web entry points use relative internal asset/navigation URLs for Pages project subpath',()=>{
  const assets=JSON.parse(fs.readFileSync(path.join(root,'tools/static-assets.json'),'utf8'));
  const htmlFiles=assets.filter(name=>name.endsWith('.html'));
  const jsFiles=assets.filter(name=>name.endsWith('.js'));

  for(const name of htmlFiles){
    const source=fs.readFileSync(path.join(root,name),'utf8');
    assert.doesNotMatch(source,/(?:href|src)=["']\/(?!\/)/i,`${name} has a root-absolute internal URL`);
  }

  const rootNavigation=/(?:window\.)?location(?:\.href)?\s*=\s*["']\/(?!\/)|(?:window\.)?location\.(?:assign|replace)\(\s*["']\/(?!\/)/i;
  for(const name of jsFiles){
    const source=fs.readFileSync(path.join(root,name),'utf8');
    assert.doesNotMatch(source,rootNavigation,`${name} has root-absolute browser navigation`);
  }
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test tests/github-pages-staging.test.js
```

Expected: FAIL because `../tools/stage-github-pages` does not exist.

- [ ] **Step 3: Implement the minimal Pages staging helper**

Create `tools/stage-github-pages.js` with these behaviors:

```js
'use strict';
const fs=require('node:fs');
const path=require('node:path');

const BANNER_ID='github-pages-test-site-banner';

function normalizeIdentity(input={}){
  const prNumber=Number(input.prNumber);
  const headSha=String(input.headSha||'').trim().toLowerCase();
  const buildSha=String(input.buildSha||'').trim().toLowerCase();
  if(!Number.isInteger(prNumber)||prNumber<1)throw Error('PR number must be a positive integer.');
  if(!/^[0-9a-f]{40}$/.test(headSha))throw Error('Head SHA must be 40 hexadecimal characters.');
  if(!/^[0-9a-f]{40}$/.test(buildSha))throw Error('Build SHA must be 40 hexadecimal characters.');
  return{prNumber,headSha,buildSha};
}

function bannerMarkup(identity){
  const value=normalizeIdentity(identity);
  return `<style id="github-pages-test-site-style">#${BANNER_ID}{position:fixed;top:10px;right:10px;z-index:2147483647;max-width:360px;padding:9px 12px;border:2px solid #8a6d00;border-radius:8px;background:#fff3cd;color:#3d3300;font:700 12px/1.35 Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.22)}#${BANNER_ID} small{display:block;margin-top:2px;font-weight:600}</style><div id="${BANNER_ID}" role="status">TEST SITE - GitHub Pages<small>Not Production - Live Firebase Backend · PR #${value.prNumber} · ${value.headSha.slice(0,7)}</small></div>`;
}

function injectTestBanner(html,identity){
  const source=String(html);
  if(source.includes(`id="${BANNER_ID}"`))return source;
  if(!/<body(?:\s[^>]*)?>/i.test(source))throw Error('HTML file is missing a <body> element.');
  return source.replace(/<body(?:\s[^>]*)?>/i,match=>`${match}\n${bannerMarkup(identity)}`);
}

function buildFacultyDashboardRedirect(identity){
  return injectTestBanner(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./index.html"><title>Redirecting…</title></head><body><p>Redirecting to <a href="./index.html">UCVM Timetable</a>…</p><script>window.location.replace('./index.html');</script></body></html>`,identity);
}

function listHtmlFiles(directory){
  const found=[];
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const full=path.join(directory,entry.name);
    if(entry.isDirectory())found.push(...listHtmlFiles(full));
    else if(entry.isFile()&&entry.name.endsWith('.html')&&entry.name!=='faculty-dashboard.html')found.push(full);
  }
  return found;
}

function stagePagesDirectory(directory,identity){
  const target=path.resolve(directory);
  if(!fs.existsSync(target)||!fs.statSync(target).isDirectory())throw Error(`Pages directory does not exist: ${target}`);
  const value=normalizeIdentity(identity);
  const htmlFiles=listHtmlFiles(target);
  for(const filename of htmlFiles){
    fs.writeFileSync(filename,injectTestBanner(fs.readFileSync(filename,'utf8'),value));
  }
  fs.writeFileSync(path.join(target,'faculty-dashboard.html'),buildFacultyDashboardRedirect(value));
  fs.writeFileSync(path.join(target,'.nojekyll'),'');
  fs.writeFileSync(path.join(target,'github-pages-build.json'),JSON.stringify({environment:'github-pages-test',...value},null,2)+'\n');
  return{directory:target,htmlFiles:htmlFiles.length,identity:value};
}

function parseArgs(argv){
  const value=name=>{const index=argv.indexOf(name);return index>=0?argv[index+1]:undefined};
  return{
    directory:value('--directory'),
    identity:{prNumber:value('--pr'),headSha:value('--head-sha'),buildSha:value('--build-sha')}
  };
}

if(require.main===module){
  const options=parseArgs(process.argv.slice(2));
  if(!options.directory)throw Error('--directory is required.');
  console.log(JSON.stringify(stagePagesDirectory(options.directory,options.identity)));
}

module.exports={normalizeIdentity,injectTestBanner,buildFacultyDashboardRedirect,stagePagesDirectory};
```

Do not add this helper or the generated banner/shim files to `tools/static-assets.json`; they are Pages-only post-build staging.

- [ ] **Step 4: Run focused and full static tests**

Run:

```bash
node --test tests/github-pages-staging.test.js
npm test
```

Expected: PASS. If the relative-URL regression finds a real root-absolute application navigation, change only that application link to the equivalent relative URL and keep the regression test.

- [ ] **Step 5: Commit Task 1**

```bash
git add tools/stage-github-pages.js tests/github-pages-staging.test.js
git commit -m "test: stage GitHub Pages test builds"
```

---

### Task 2: Add the fixed GitHub Pages PR deployment workflow

**Files:**
- Create: `.github/workflows/github-pages-test.yml`
- Create: `tests/github-pages-deployment.test.js`
- Consume: `tools/stage-github-pages.js`

**Interfaces:**
- Consumes: same-repository `pull_request` events targeting `main` for `opened`, `synchronize`, and `reopened`.
- Produces: fixed `github-pages` deployment after verification and `steps.deployment.outputs.page_url` as the GitHub environment URL.
- Uses current official Pages action majors verified for 2026-09-15: `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`.

- [ ] **Step 1: Write the failing workflow regression test**

Create `tests/github-pages-deployment.test.js`:

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('Pages test workflow deploys only verified same-repository PRs to one fixed environment',()=>{
  const workflow=read('.github/workflows/github-pages-test.yml');

  assert.match(workflow,/pull_request:\s*\n\s+types:\s*\[opened, synchronize, reopened\]\s*\n\s+branches:\s*\[main\]/);
  assert.doesNotMatch(workflow,/pull_request_target/);
  assert.doesNotMatch(workflow,/push:/);
  assert.match(workflow,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow,/group:\s*github-pages-test/);
  assert.match(workflow,/cancel-in-progress:\s*true/);

  assert.match(workflow,/contents:\s*read/);
  assert.match(workflow,/pages:\s*write/);
  assert.match(workflow,/id-token:\s*write/);

  assert.match(workflow,/npm ci/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run test:emulator/);
  assert.match(workflow,/node tools\/build-static\.js/);
  assert.match(workflow,/node tools\/stage-github-pages\.js/);
  assert.match(workflow,/github\.event\.pull_request\.number/);
  assert.match(workflow,/github\.event\.pull_request\.head\.sha/);

  assert.match(workflow,/actions\/configure-pages@v6/);
  assert.match(workflow,/actions\/upload-pages-artifact@v5/);
  assert.match(workflow,/include-hidden-files:\s*true/);
  assert.match(workflow,/actions\/deploy-pages@v5/);
  assert.match(workflow,/name:\s*github-pages/);
  assert.match(workflow,/steps\.deployment\.outputs\.page_url/);
  assert.doesNotMatch(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test tests/github-pages-deployment.test.js
```

Expected: FAIL because `.github/workflows/github-pages-test.yml` does not exist.

- [ ] **Step 3: Create the Pages workflow**

Create `.github/workflows/github-pages-test.yml` with this structure:

```yaml
name: GitHub Pages Test Site

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: github-pages-test
  cancel-in-progress: true

jobs:
  verify_and_package:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Check out PR integration revision
        uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Set up Java for Firebase emulators
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'

      - name: Install dependencies
        run: npm ci

      - name: Run static and unit tests
        run: npm test

      - name: Run Firestore and Auth emulator tests
        run: npm run test:emulator

      - name: Build static site
        run: node tools/build-static.js

      - name: Stage GitHub Pages test site
        run: >-
          node tools/stage-github-pages.js
          --directory .deploy-static
          --pr "${{ github.event.pull_request.number }}"
          --head-sha "${{ github.event.pull_request.head.sha }}"
          --build-sha "${{ github.sha }}"

      - name: Configure GitHub Pages
        uses: actions/configure-pages@v6

      - name: Upload GitHub Pages artifact
        uses: actions/upload-pages-artifact@v5
        with:
          path: .deploy-static
          include-hidden-files: true

  deploy:
    needs: verify_and_package
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy fixed test site
        id: deployment
        uses: actions/deploy-pages@v5
```

Do not add Azure credentials, Azure actions, `workflow_run`, or `pull_request_target` to this workflow.

- [ ] **Step 4: Run the workflow regressions and full static tests**

Run:

```bash
node --test tests/github-pages-deployment.test.js tests/github-pages-staging.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add .github/workflows/github-pages-test.yml tests/github-pages-deployment.test.js
git commit -m "ci: publish verified PRs to GitHub Pages"
```

---

### Task 3: Make Azure production-only and approval-gated

**Files:**
- Modify: `.github/workflows/azure-static-web-apps.yml`
- Modify: `tests/azure-deployment.test.js`
- Retain: `staticwebapp.config.json`
- Retain: `tools/deploy_azure_static_web.ps1`

**Interfaces:**
- Consumes: `push` to `main` only.
- Job `validate_and_build` produces Actions artifact `azure-production-${{ github.sha }}` containing the verified `.deploy-static` tree plus `staticwebapp.config.json`.
- Job `deploy_production` consumes that exact artifact, waits on GitHub environment `production`, then invokes the already-reviewed pinned `Azure/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1` action.
- Uses `actions/upload-artifact@v7` and `actions/download-artifact@v8` for the production handoff.

- [ ] **Step 1: Rewrite the Azure regression test first**

Keep the first two existing tests in `tests/azure-deployment.test.js` that verify the canonical routing config and manual fallback. Replace the old PR-preview workflow test with assertions equivalent to:

```js
test('Azure workflow verifies main, waits for production approval, then deploys the exact artifact',()=>{
  const workflow=read('.github/workflows/azure-static-web-apps.yml');

  assert.match(workflow,/push:\s*\n\s+branches:\s*\[main\]/);
  assert.doesNotMatch(workflow,/pull_request:/);
  assert.doesNotMatch(workflow,/pull_request_target/);
  assert.doesNotMatch(workflow,/action:\s*['"]?close['"]?/);
  assert.match(workflow,/group:\s*azure-production-main/);
  assert.match(workflow,/cancel-in-progress:\s*true/);

  assert.match(workflow,/validate_and_build:/);
  assert.match(workflow,/npm ci/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run test:emulator/);
  assert.match(workflow,/node tools\/build-static\.js/);
  assert.match(workflow,/cp staticwebapp\.config\.json \.deploy-static\/staticwebapp\.config\.json/);
  assert.match(workflow,/actions\/upload-artifact@v7/);
  assert.match(workflow,/name:\s*azure-production-\$\{\{ github\.sha \}\}/);

  assert.match(workflow,/deploy_production:/);
  assert.match(workflow,/needs:\s*validate_and_build/);
  assert.match(workflow,/environment:\s*\n\s+name:\s*production/);
  assert.match(workflow,/actions\/download-artifact@v8/);
  assert.match(workflow,/Azure\/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1/);
  assert.equal((workflow.match(/Azure\/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1/g)||[]).length,1);
  assert.match(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(workflow,/app_location:\s*['"]?\.deploy-static['"]?/);
  assert.match(workflow,/skip_app_build:\s*true/);
  assert.match(workflow,/production_branch:\s*['"]?main['"]?/);
  assert.match(workflow,/action:\s*['"]?upload['"]?/);
  assert.doesNotMatch(workflow,/repo_token:/);
});
```

Also update the existing setup-doc test in this file so it expects GitHub Pages testing plus approval-gated Azure production and rejects the old Azure-preview wording:

```js
assert.match(setup,/GitHub Pages/i);
assert.match(setup,/Review deployments|Approve and deploy/i);
assert.match(setup,/production environment/i);
assert.match(setup,/firestore:rules/);
assert.match(setup,/manual fallback|emergency\/manual fallback/i);
assert.doesNotMatch(setup,/temporary Azure PR preview|Azure Preview URL/i);
```

The docs assertions are expected to remain RED until Task 4; when running Task 3 focused tests, use the test-name pattern for the workflow/config tests or accept that only the documentation test remains red until Task 4.

- [ ] **Step 2: Run the Azure workflow test and confirm RED**

Run:

```bash
node --test --test-name-pattern="Azure Static Web Apps routing|manual Azure fallback|Azure workflow verifies" tests/azure-deployment.test.js
```

Expected: FAIL on the new production-workflow assertions because the current workflow still handles PR previews.

- [ ] **Step 3: Replace the Azure workflow with two production jobs**

Refactor `.github/workflows/azure-static-web-apps.yml` to:

```yaml
name: Azure Production

on:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: azure-production-main
  cancel-in-progress: true

jobs:
  validate_and_build:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Check out production commit
        uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Set up Java for Firebase emulators
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'

      - name: Install dependencies
        run: npm ci

      - name: Run static and unit tests
        run: npm test

      - name: Run Firestore and Auth emulator tests
        run: npm run test:emulator

      - name: Build static site
        run: node tools/build-static.js

      - name: Stage Azure configuration
        run: cp staticwebapp.config.json .deploy-static/staticwebapp.config.json

      - name: Upload verified production artifact
        uses: actions/upload-artifact@v7
        with:
          name: azure-production-${{ github.sha }}
          path: .deploy-static
          if-no-files-found: error
          retention-days: 7
          include-hidden-files: true

  deploy_production:
    needs: validate_and_build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment:
      name: production
      url: https://red-cliff-04871ca0f.5.azurestaticapps.net
    steps:
      - name: Download verified production artifact
        uses: actions/download-artifact@v8
        with:
          name: azure-production-${{ github.sha }}
          path: .deploy-static

      - name: Verify production artifact handoff
        run: |
          test -f .deploy-static/index.html
          test -f .deploy-static/staticwebapp.config.json

      - name: Deploy approved artifact to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: upload
          app_location: .deploy-static
          api_location: ''
          output_location: ''
          skip_app_build: true
          skip_api_build: true
          production_branch: main
```

Do not put `environment: production` on `validate_and_build`; the approval must appear only after verification/build succeeds.

- [ ] **Step 4: Run focused Azure workflow/config tests**

Run:

```bash
node --test --test-name-pattern="Azure Static Web Apps routing|manual Azure fallback|Azure workflow verifies" tests/azure-deployment.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add .github/workflows/azure-static-web-apps.yml tests/azure-deployment.test.js
git commit -m "ci: gate Azure production deployments"
```

---

### Task 4: Rewrite deployment documentation and lock the rollout contract in tests

**Files:**
- Modify: `SETUP.md`
- Modify: `tests/github-pages-deployment.test.js`
- Modify if needed: `tests/azure-deployment.test.js`

**Interfaces:**
- Produces the operator contract for fixed Pages test hosting, live shared Firebase backend, manual PR validation, merge, post-merge production approval, environment-secret migration, and manual Firestore rules.

- [ ] **Step 1: Extend documentation assertions before editing docs**

Append this setup test to `tests/github-pages-deployment.test.js`:

```js
test('setup docs describe Pages test hosting and one-time production approval setup',()=>{
  const setup=read('SETUP.md');
  assert.match(setup,/https:\/\/alex1122341\.github\.io\/Teaching-assignment\//);
  assert.match(setup,/Settings.*Pages.*GitHub Actions/is);
  assert.match(setup,/alex1122341\.github\.io/);
  assert.match(setup,/Firebase.*Authorized domains/is);
  assert.match(setup,/environment.*production/is);
  assert.match(setup,/Required reviewer/i);
  assert.match(setup,/Prevent self-review/i);
  assert.match(setup,/main.*deploy/is);
  assert.match(setup,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(setup,/environment secret/i);
  assert.match(setup,/Review deployments|Approve and deploy/i);
  assert.match(setup,/Live Firebase Backend|live backend/i);
  assert.doesNotMatch(setup,/temporary Azure PR preview|same PR preview environment/i);
});
```

- [ ] **Step 2: Run the documentation tests and confirm RED**

Run:

```bash
node --test tests/github-pages-deployment.test.js tests/azure-deployment.test.js
```

Expected: workflow tests PASS; setup-documentation assertions FAIL because `SETUP.md` still describes Azure PR previews.

- [ ] **Step 3: Rewrite only the Web deployment/activation deployment wording in `SETUP.md`**

Update Activation order step 6 to say the frontend is validated on GitHub Pages, then production is approved and deployed to Azure.

Replace the existing `## Web deployment` section through `### Emergency/manual fallback` with content that contains all of the following exact operational facts:

```text
Test site: https://alex1122341.github.io/Teaching-assignment/
Production: https://red-cliff-04871ca0f.5.azurestaticapps.net
Firebase backend: tester-teaching
```

Document one-time setup in this order:

1. GitHub repository -> **Settings -> Pages -> Build and deployment -> Source -> GitHub Actions**.
2. GitHub repository -> **Settings -> Environments -> github-pages**: no required reviewers and no `main`-only deployment restriction, because same-repository PRs must update the fixed test site.
3. Firebase Console -> `tester-teaching` -> Authentication -> Settings -> Authorized domains -> add exactly `alex1122341.github.io` (not the `/Teaching-assignment/` path).
4. GitHub repository -> **Settings -> Environments -> New environment -> production**.
5. `production` -> Required reviewers -> `Alex1122341`.
6. `production` -> deployment branches/tags -> allow `main` only.
7. Leave **Prevent self-review** disabled so `Alex1122341` can merge and then approve the production deployment.
8. Azure Portal -> Static Web App `ucvm-teaching-lab-web` -> Manage deployment token -> copy token.
9. GitHub `production` environment -> Environment secrets -> add `AZURE_STATIC_WEB_APPS_API_TOKEN` with that token.
10. Keep the existing repository-level token until the first environment-gated production deployment succeeds; after verification, delete the duplicate repository-level secret so the token is available only through `production`.

Document routine PR/release flow:

```text
feature branch
-> PR
-> Test workflow + GitHub Pages Test Site workflow
-> fixed Pages test URL updates only after all automated tests pass
-> verify banner PR/SHA and test browser behavior
-> merge to main
-> Azure Production validate/build job runs
-> deployment waits for production environment approval
-> Actions -> Review deployments -> production -> Approve and deploy
-> exact pre-approved artifact deploys to Azure
```

State clearly that the Pages site is public and points to the live/shared `tester-teaching` Firebase backend, so data-changing manual tests must be deliberate.

Retain the manual Firestore rules command exactly:

```bash
npx firebase deploy --project tester-teaching --only firestore:rules
```

Retain the existing PowerShell unblock/run emergency fallback instructions.

Remove instructions saying PRs create Azure Preview URLs or that merging automatically deploys production without approval.

- [ ] **Step 4: Run all static tests**

Run:

```bash
npm test
```

Expected: PASS, including staging, Pages workflow, Azure workflow, and setup-doc regressions.

- [ ] **Step 5: Run emulator tests**

Run:

```bash
npm run test:emulator
```

Expected: PASS. No rules behavior should have changed; this is a full regression gate because both deployment workflows promise to run this suite.

- [ ] **Step 6: Commit Task 4**

```bash
git add SETUP.md tests/github-pages-deployment.test.js tests/azure-deployment.test.js
git commit -m "docs: document gated Pages to Azure releases"
```

---

### Task 5: Configure repository/Firebase controls and verify the end-to-end rollout

**Files:**
- No tracked application files required.
- GitHub repository settings, GitHub Environments, Firebase Authentication settings, and Azure deployment token are external configuration.

**Interfaces:**
- Produces working Pages source configuration, Firebase Auth origin authorization, `github-pages` deployment environment without manual approval, and `production` deployment environment with reviewer approval and environment-scoped Azure token.

- [ ] **Step 1: Create the implementation PR before changing production**

Use a feature branch containing Tasks 1-4 and open a PR to `main`. Confirm existing `Test` checks are green before relying on the new deployment behavior.

- [ ] **Step 2: Configure GitHub Pages for Actions**

In GitHub:

```text
Alex1122341/Teaching-assignment
-> Settings
-> Pages
-> Build and deployment
-> Source: GitHub Actions
```

Then open:

```text
Settings -> Environments -> github-pages
```

Required state:

```text
Required reviewers: none
Deployment branches/tags: no main-only restriction
```

If GitHub creates `github-pages` only after the first Pages workflow attempt, set these values immediately after it appears and rerun the failed Pages workflow.

- [ ] **Step 3: Authorize the GitHub Pages Firebase origin**

In Firebase Console:

```text
Project: tester-teaching
-> Authentication
-> Settings
-> Authorized domains
-> Add domain
alex1122341.github.io
```

Do not enter `https://`, a trailing slash, or `/Teaching-assignment/`.

- [ ] **Step 4: Configure the gated production environment**

In GitHub:

```text
Settings -> Environments -> New environment -> production
```

Configure:

```text
Required reviewer: Alex1122341
Prevent self-review: OFF
Deployment branches/tags: Selected branches -> main
```

Do not add required reviewers to `github-pages`.

- [ ] **Step 5: Move the Azure token into the production environment**

Retrieve the deployment token from:

```text
Azure Portal
-> Static Web App: ucvm-teaching-lab-web
-> Manage deployment token
```

Add it in:

```text
GitHub -> Settings -> Environments -> production -> Environment secrets
Name: AZURE_STATIC_WEB_APPS_API_TOKEN
Value: <paste the Azure deployment token directly in GitHub; do not put it in chat, logs, or source>
```

Leave the existing repository-level secret temporarily so rollback is easy during first rollout. The environment secret takes precedence for the `production` job.

- [ ] **Step 6: Verify the fixed Pages test deployment from a same-repository PR**

Expected workflow sequence:

```text
Test -> PASS
GitHub Pages Test Site / verify_and_package -> PASS
GitHub Pages Test Site / deploy -> PASS
```

Open:

```text
https://alex1122341.github.io/Teaching-assignment/
```

Verify all of the following manually:

```text
- Banner says TEST SITE - GitHub Pages.
- Banner says Not Production - Live Firebase Backend.
- Banner PR number matches the PR being tested.
- Banner short SHA matches the PR head SHA.
- Sign-in succeeds.
- Timetable loads.
- Faculty Dashboard opens.
- Faculty self-dashboard behavior still limits a faculty account to its own profile.
- Admin still sees the full dashboard.
- /Teaching-assignment/faculty-dashboard.html redirects to ./index.html behavior.
- Browser network/console shows no 404 caused by root-absolute local assets.
```

If the newly added workflow does not run on the workflow-introducing PR because GitHub requires the workflow to exist on the default branch first, finish code review without claiming Pages verification, merge only this deployment-only change, and create a small same-repository docs-only verification PR immediately afterward. Use that PR to complete this Pages verification before using the pipeline for application feature releases.

- [ ] **Step 7: Verify a second PR update replaces the fixed test site**

Push one harmless documentation-only commit to the open verification PR. Confirm the Pages workflow runs again, the fixed URL remains the same, and the banner SHA updates to the new PR head SHA.

Do not intentionally introduce a failing commit solely to test failure retention. The automated workflow regression plus normal future CI failures are sufficient unless a controlled failure is specifically desired later.

- [ ] **Step 8: Merge and verify Azure stops for approval**

Merge the validated deployment PR (or the pipeline PR after the post-merge Pages verification path above).

Expected Azure workflow state:

```text
Azure Production / validate_and_build -> PASS
Azure Production / deploy_production -> Waiting for review
```

At this point confirm the Azure production site has not changed because approval has not yet been granted.

- [ ] **Step 9: Approve production in GitHub and verify Azure**

In GitHub Actions open the waiting run and use:

```text
Review deployments
-> select production
-> Approve and deploy
```

Expected:

```text
Azure Production / deploy_production -> PASS
https://red-cliff-04871ca0f.5.azurestaticapps.net -> serves the approved main build
```

Verify sign-in, timetable, Faculty Dashboard, and `/faculty-dashboard.html` Azure redirect after deployment.

- [ ] **Step 10: Remove the duplicate repository-level Azure secret after success**

Only after the first environment-gated Azure deployment succeeds:

```text
GitHub -> Settings -> Secrets and variables -> Actions
-> repository secret AZURE_STATIC_WEB_APPS_API_TOKEN
-> delete repository-level copy
```

Keep the `production` environment secret with the same name.

- [ ] **Step 11: Final verification before completion claim**

Run or confirm fresh results for:

```bash
npm test
npm run test:emulator
node tools/build-static.js
```

Confirm current GitHub Actions evidence shows:

```text
- Test workflow PASS.
- GitHub Pages fixed test deployment PASS on a same-repository PR.
- Azure Production validate_and_build PASS on main.
- Azure deploy_production visibly waited for production approval.
- Azure deploy_production PASS only after approval.
- No Azure PR preview workflow/job remains.
```

Document the final Pages test URL and Azure production URL in the implementation PR conversation, along with whether the workflow-introducing PR or a follow-up verification PR was used for live Pages validation.
