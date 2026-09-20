'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('DOE API staging creates an App Service root start contract',()=>{
 const source=read('tools/build-doe-api.js');
 assert.match(source,/ucvm-doe-api-appservice/);
 assert.match(source,/scripts:\{start:'npm --prefix server start'\}/);
 assert.match(source,/startCommand:'npm start'/);
});

test('DOE API production deployment is manual, exact-main and production-environment gated',()=>{
 const workflow=read('.github/workflows/azure-doe-api-production-deploy.yml');
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/commit_sha:/);
 assert.doesNotMatch(workflow,/push:/);
 assert.doesNotMatch(workflow,/pull_request:/);
 assert.match(workflow,/environment:\s*\n\s+name:\s*production/);
 assert.match(workflow,/git fetch origin main --depth=1/);
 assert.match(workflow,/git rev-parse origin\/main/);
 assert.match(workflow,/DOE_API_APP_NAME/);
 assert.match(workflow,/PRODUCTION_DOE_API_BASE_URL/);
 assert.match(workflow,/AZURE_DOE_API_PUBLISH_PROFILE/);
 assert.match(workflow,/npm --prefix server test/);
 assert.match(workflow,/node tools\/build-doe-api\.js/);
 assert.match(workflow,/npm --prefix output\/doe-api\/server ci --omit=dev/);
 assert.match(workflow,/Azure\/webapps-deploy@02a81bead70021f5284939794bcec79c271ab383/);
 assert.match(workflow,/node tools\/verify-production-doe-api\.js/);
 assert.match(workflow,/https:\/\/red-cliff-04871ca0f\.5\.azurestaticapps\.net/);
 assert.match(workflow,/https:\/\/alex1122341\.github\.io/);
});

test('DOE API deployment never embeds Azure or Firebase server credentials in workflow source',()=>{
 const workflow=read('.github/workflows/azure-doe-api-production-deploy.yml');
 assert.doesNotMatch(workflow,/BEGIN PRIVATE KEY/);
 assert.doesNotMatch(workflow,/client_email/);
 assert.doesNotMatch(workflow,/publishData/);
 assert.match(workflow,/secrets\.AZURE_DOE_API_PUBLISH_PROFILE/);
});
