'use strict';
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
  assert.match(workflow,/npm ci/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run test:emulator/);
  assert.match(workflow,/node tools\/build-static\.js/);
  assert.match(workflow,/node tools\/stage-github-pages\.js/);
  assert.match(workflow,/--pr\s+["']?\$\{\{ github\.event\.pull_request\.number \}\}["']?/);
  assert.match(workflow,/--head-sha\s+["']?\$\{\{ github\.event\.pull_request\.head\.sha \}\}["']?/);
  assert.match(workflow,/--build-sha\s+["']?\$\{\{ github\.sha \}\}["']?/);
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
  assert.match(workflow,/push:\s*\n\s+branches:\s*\n\s+- main/);
});

test('setup docs define the fixed Pages test site and shared live backend',()=>{
  const setup=read('SETUP.md');
  assert.match(setup,/https:\/\/alex1122341\.github\.io\/Teaching-assignment\//);
  assert.match(setup,/GitHub Pages/i);
  assert.match(setup,/tester-teaching/);
  assert.match(setup,/live Firebase backend|shared Firebase backend/i);
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
