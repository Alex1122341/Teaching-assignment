'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');

test('DOE API packaging stages server and every shared runtime dependency',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'ucvm-doe-api-'));
 const run=spawnSync(process.execPath,[path.join(root,'tools','build-doe-api.js'),'--output',out],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr||run.stdout);
 const required=[
  'server/package.json','server/src/server.js','doe-formula.js','doe-policy-engine.js','doe-policy-repository.js',
  'doe-policy-firestore.js','doe-policy-service.js','index-maintenance.js','data-index.js','scheduling-core.js','calendar-session.js'
 ];
 for(const file of required)assert.equal(fs.existsSync(path.join(out,file)),true,`missing ${file}`);
 const smoke=spawnSync(process.execPath,['-e',`require(${JSON.stringify(path.join(out,'server','src','server.js'))})`],{cwd:root,encoding:'utf8'});
 assert.equal(smoke.status,0,smoke.stderr||smoke.stdout);
});
