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

test('Azure deployment workflow gates uploads and separates PR preview from production',()=>{
  const workflow=read('.github/workflows/azure-static-web-apps.yml');

  assert.match(workflow,/push:\s*\n\s+branches:\s*\[main\]/);
  assert.match(workflow,/pull_request:\s*\n\s+types:\s*\[opened, synchronize, reopened, closed\]\s*\n\s+branches:\s*\[main\]/);
  assert.doesNotMatch(workflow,/pull_request_target/);

  assert.match(workflow,/npm ci/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run test:emulator/);
  assert.match(workflow,/node tools\/build-static\.js/);
  assert.match(workflow,/cp staticwebapp\.config\.json \.deploy-static\/staticwebapp\.config\.json/);

  const pinned=/Azure\/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1/g;
  assert.equal((workflow.match(pinned)||[]).length,2);
  assert.match(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(workflow,/repo_token:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow,/app_location:\s*['"]?\.deploy-static['"]?/);
  assert.match(workflow,/output_location:\s*['"]{2}/);
  assert.match(workflow,/skip_app_build:\s*true/);
  assert.match(workflow,/production_branch:\s*['"]?main['"]?/);
  assert.match(workflow,/action:\s*['"]?upload['"]?/);
  assert.match(workflow,/action:\s*['"]?close['"]?/);

  const sameRepoGuard=/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/g;
  assert.equal((workflow.match(sameRepoGuard)||[]).length,2);
  assert.match(workflow,/cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(workflow,/static_web_app_url/);
});

test('setup docs describe GitHub-to-Azure as the routine web deployment path',()=>{
  const setup=read('SETUP.md');
  assert.match(setup,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(setup,/pull request/i);
  assert.match(setup,/preview/i);
  assert.match(setup,/push to `main`|merge.*`main`/i);
  assert.match(setup,/firestore:rules/);
  assert.match(setup,/manual fallback|emergency\/manual fallback/i);
  assert.doesNotMatch(setup,/Publish the frontend to Firebase Hosting/);
});
