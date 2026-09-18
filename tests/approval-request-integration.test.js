'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('shared routed request module is published before both submission clients',()=>{
  const manifest=JSON.parse(read('tools/static-assets.json'));
  assert.ok(manifest.includes('approval-request.js'));
  const index=read('index.html');
  assert.ok(index.indexOf('approval-routing.js')<index.indexOf('approval-request.js'));
  assert.ok(index.indexOf('approval-request.js')<index.indexOf('asset-loader.js'));
  const admin=read('faculty-admin.html');
  assert.ok(admin.indexOf('approval-request.js')>=0);
  assert.ok(admin.indexOf('approval-request.js')<admin.indexOf('faculty-swap-safe.js'));
  const loader=read('asset-loader.js');
  assert.match(loader,/loadScriptOnce\('approval-request\.js','UCVM_APPROVAL_REQUEST'\)/);
  assert.ok(loader.indexOf("approval-request.js")<loader.indexOf("faculty-swap-safe.js"));
});

test('legacy and privacy-safe swap submissions both use the split routed request writer',()=>{
  const workflow=read('approval-workflow.js'),safe=read('faculty-swap-safe.js');
  assert.match(workflow,/UCVM_APPROVAL_REQUEST\.submit\(/);
  assert.match(safe,/UCVM_APPROVAL_REQUEST\.submit\(/);
  assert.doesNotMatch(safe,/db\.collection\(REQUESTS\)\.add\(payload\)/);
  assert.doesNotMatch(workflow,/Request submitted to ADFA for approval\./);
  assert.match(workflow,/Request submitted for approval\./);
  assert.match(safe,/Request submitted for approval\./);
});
