'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('Azure Static Web Apps routing and cache config is committed at repository root',()=>{
  const config=JSON.parse(read('staticwebapp.config.json'));
  assert.deepEqual(config.routes,[
    {route:'/faculty-dashboard.html',redirect:'/index.html',statusCode:301},
    {route:'/bundles/*',headers:{'Cache-Control':'public, max-age=31536000, immutable'}},
    {route:'/*.{html,js,css}',headers:{'Cache-Control':'no-cache, max-age=0, must-revalidate'}}
  ]);
});

test('manual Azure fallback copies the canonical config instead of generating a second copy',()=>{
  const script=read('tools/deploy_azure_static_web.ps1');
  assert.match(script,/Join-Path \$SitePath 'staticwebapp\.config\.json'/);
  assert.match(script,/Copy-Item .*staticwebapp\.config\.json/);
  assert.doesNotMatch(script,/\$azureConfig\s*=\s*@\{/);
});

test('Azure main push builds and uploads a verified artifact but cannot deploy production',()=>{
  const workflow=read('.github/workflows/azure-static-web-apps.yml');

  assert.match(workflow,/push:\s*\n\s+branches:\s*\[main\]/);
  assert.doesNotMatch(workflow,/pull_request:/);
  assert.doesNotMatch(workflow,/pull_request_target/);
  assert.match(workflow,/group:\s*azure-production-main/);
  assert.match(workflow,/cancel-in-progress:\s*true/);
  assert.match(workflow,/validate_and_build:/);
  assert.match(workflow,/npm ci/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run test:emulator/);
  assert.match(workflow,/PRODUCTION_FIREBASE_WEB_CONFIG_JSON/);
  assert.match(workflow,/PRODUCTION_DOE_API_BASE_URL/);
  assert.match(workflow,/node tools\/build-firebase-config\.js --from-json .* --doe-api-base-url/);
  assert.match(workflow,/node tools\/verify-production-client-config\.js/);
  assert.ok(workflow.indexOf('Prepare production client configuration') < workflow.indexOf('Build static site'));
  assert.match(workflow,/node tools\/build-static\.js/);
  assert.match(workflow,/cp staticwebapp\.config\.json \.deploy-static\/staticwebapp\.config\.json/);
  assert.match(workflow,/actions\/upload-artifact@v7/);
  assert.match(workflow,/name:\s*azure-production-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow,/deploy_production:/);
  assert.doesNotMatch(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.doesNotMatch(workflow,/Azure\/static-web-apps-deploy/);
});

test('setup docs describe Pages testing followed by gated Azure production',()=>{
  const setup=read('SETUP.md');
  assert.match(setup,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(setup,/pull request/i);
  assert.match(setup,/GitHub Pages/i);
  assert.match(setup,/merge.*`main`|merge.*main/i);
  assert.match(setup,/Azure Production Deploy/i);
  assert.match(setup,/source run ID|source_run_id/i);
  assert.match(setup,/commit SHA|commit_sha/i);
  assert.match(setup,/main.*does not.*deploy|does not.*automatically deploy/i);
  assert.match(setup,/firestore:rules/);
  assert.match(setup,/manual fallback|emergency\/manual fallback/i);
  assert.match(setup,/Firebase Hosting is not used|Firebase Hosting stays out/i);
  assert.doesNotMatch(setup,/Azure PR preview|temporary Azure PR preview/i);
});

test('production deployment requires an explicit manual dispatch and reuses the exact verified main artifact',()=>{
  const buildWorkflow=read('.github/workflows/azure-static-web-apps.yml');
  assert.match(buildWorkflow,/push:\s*\n\s+branches:\s*\[main\]/);
  assert.match(buildWorkflow,/actions\/upload-artifact@v7/);
  assert.match(buildWorkflow,/name:\s*azure-production-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(buildWorkflow,/deploy_production:/);
  assert.doesNotMatch(buildWorkflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.doesNotMatch(buildWorkflow,/Azure\/static-web-apps-deploy/);

  const deployWorkflow=read('.github/workflows/azure-production-deploy.yml');
  assert.match(deployWorkflow,/workflow_dispatch:/);
  assert.match(deployWorkflow,/source_run_id:/);
  assert.match(deployWorkflow,/commit_sha:/);
  assert.match(deployWorkflow,/actions:\s*read/);
  assert.match(deployWorkflow,/environment:\s*\n\s+name:\s*production/);
  assert.match(deployWorkflow,/gh api .*actions\/runs\/\$\{SOURCE_RUN_ID\}/);
  assert.match(deployWorkflow,/head_sha/);
  assert.match(deployWorkflow,/head_branch/);
  assert.match(deployWorkflow,/conclusion/);
  assert.match(deployWorkflow,/\.github\/workflows\/azure-static-web-apps\.yml/);
  assert.match(deployWorkflow,/actions\/download-artifact@v8/);
  assert.match(deployWorkflow,/name:\s*azure-production-\$\{\{ inputs\.commit_sha \}\}/);
  assert.match(deployWorkflow,/run-id:\s*\$\{\{ inputs\.source_run_id \}\}/);
  assert.match(deployWorkflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(deployWorkflow,/Azure\/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1/);

  const deployJob=deployWorkflow.slice(deployWorkflow.indexOf('deploy_production:'));
  assert.doesNotMatch(deployJob,/npm ci/);
  assert.doesNotMatch(deployJob,/npm test/);
  assert.doesNotMatch(deployJob,/node tools\/build-static\.js/);
});
