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
  assert.equal(config.platform?.apiRuntime,'node:22');
});

test('manual Azure fallback copies the canonical config instead of generating a second copy',()=>{
  const script=read('tools/deploy_azure_static_web.ps1');
  assert.match(script,/Join-Path \$SitePath 'staticwebapp\.config\.json'/);
  assert.match(script,/Copy-Item .*staticwebapp\.config\.json/);
  assert.doesNotMatch(script,/\$azureConfig\s*=\s*@\{/);
});

test('Azure main push builds one verified frontend plus Managed Functions handoff without App Service dependency',()=>{
  const workflow=read('.github/workflows/azure-static-web-apps.yml');

  assert.match(workflow,/push:\s*\n\s+branches:\s*\[main\]/);
  assert.doesNotMatch(workflow,/pull_request:/);
  assert.match(workflow,/npm ci/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run test:emulator/);
  assert.match(workflow,/npm --prefix server .*install/);
  assert.match(workflow,/npm --prefix server test/);
  assert.match(workflow,/--paws-session-backend azure-sql/);
  assert.match(workflow,/node tools\/verify-production-client-config\.js/);
  assert.doesNotMatch(workflow,/test -n "\$PRODUCTION_DOE_API_BASE_URL"/);
  assert.doesNotMatch(workflow,/Verify production DOE API health and CORS/);
  assert.doesNotMatch(workflow,/node tools\/verify-production-doe-api\.js/);
  assert.match(workflow,/node tools\/build-static\.js/);
  assert.match(workflow,/node tools\/build-swa-api\.js --output \.deploy-swa-api/);
  assert.match(workflow,/\.azure-production\/app/);
  assert.match(workflow,/\.azure-production\/api/);
  assert.match(workflow,/actions\/upload-artifact@v7/);
  assert.match(workflow,/name:\s*azure-production-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
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

test('production deployment manually deploys the exact verified app and Managed Functions artifacts',()=>{
  const buildWorkflow=read('.github/workflows/azure-static-web-apps.yml');
  assert.match(buildWorkflow,/actions\/upload-artifact@v7/);
  assert.match(buildWorkflow,/name:\s*azure-production-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(buildWorkflow,/Azure\/static-web-apps-deploy/);

  const deployWorkflow=read('.github/workflows/azure-production-deploy.yml');
  assert.match(deployWorkflow,/workflow_dispatch:/);
  assert.match(deployWorkflow,/source_run_id:/);
  assert.match(deployWorkflow,/commit_sha:/);
  assert.match(deployWorkflow,/actions\/download-artifact@v8/);
  assert.match(deployWorkflow,/name:\s*azure-production-\$\{\{ inputs\.commit_sha \}\}/);
  assert.match(deployWorkflow,/app_location:\s*\.azure-production\/app/);
  assert.match(deployWorkflow,/api_location:\s*\.azure-production\/api/);
  assert.match(deployWorkflow,/skip_app_build:\s*true/);
  assert.match(deployWorkflow,/skip_api_build:\s*false/);
  assert.match(deployWorkflow,/\/api\/health\/sql/);
  assert.match(deployWorkflow,/dependency.*azure-sql|azure-sql.*dependency/);

  const deployJob=deployWorkflow.slice(deployWorkflow.indexOf('deploy_production:'));
  assert.doesNotMatch(deployJob,/node tools\/build-static\.js/);
  assert.doesNotMatch(deployJob,/node tools\/build-swa-api\.js/);
});
