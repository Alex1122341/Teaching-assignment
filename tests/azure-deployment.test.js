'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('Azure Static Web Apps routing config is committed at repository root',()=>{
  const config=JSON.parse(read('staticwebapp.config.json'));
  assert.deepEqual(config.routes,[{
    route:'/faculty-dashboard.html',
    redirect:'/index.html',
    statusCode:301
  }]);
});

test('manual Azure fallback copies the canonical config instead of generating a second copy',()=>{
  const script=read('tools/deploy_azure_static_web.ps1');
  assert.match(script,/Join-Path \$SitePath 'staticwebapp\.config\.json'/);
  assert.match(script,/Copy-Item .*staticwebapp\.config\.json/);
  assert.doesNotMatch(script,/\$azureConfig\s*=\s*@\{/);
});

test('Azure deployment is main-only and deploys the verified pre-approval artifact',()=>{
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
  assert.match(workflow,/path:\s*\.deploy-static/);
  assert.match(workflow,/Azure\/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1/);
  assert.match(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(workflow,/app_location:\s*['"]?\.deploy-static['"]?/);
  assert.match(workflow,/skip_app_build:\s*true/);
  assert.match(workflow,/production_branch:\s*['"]?main['"]?/);
  assert.match(workflow,/action:\s*['"]?upload['"]?/);

  const deployJob=workflow.slice(workflow.indexOf('deploy_production:'));
  assert.doesNotMatch(deployJob,/npm ci/);
  assert.doesNotMatch(deployJob,/npm test/);
  assert.doesNotMatch(deployJob,/node tools\/build-static\.js/);
});

test('setup docs describe Pages testing followed by gated Azure production',()=>{
  const setup=read('SETUP.md');
  assert.match(setup,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(setup,/pull request/i);
  assert.match(setup,/GitHub Pages/i);
  assert.match(setup,/merge.*`main`|merge.*main/i);
  assert.match(setup,/Approve and deploy/i);
  assert.match(setup,/firestore:rules/);
  assert.match(setup,/manual fallback|emergency\/manual fallback/i);
  assert.match(setup,/Firebase Hosting is not used|Firebase Hosting stays out/i);
  assert.doesNotMatch(setup,/Azure PR preview|temporary Azure PR preview/i);
});
