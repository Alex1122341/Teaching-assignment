'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildSwaApi}=require('../tools/build-swa-api.js');

test('SWA API build stages only allowlisted SQL/Auth runtime files with deterministic metadata',()=>{
  const root=path.resolve(__dirname,'..');
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'paws-swa-api-'));
  try{
    const result=buildSwaApi({rootDir:root,outputDir:output});
    for(const relative of ['index.js','host.json','package.json','package-lock.json']){
      assert.equal(fs.existsSync(path.join(output,relative)),true,relative);
    }
    assert.equal(fs.existsSync(path.join(output,'server/src/doe')),false);
    const packageJson=JSON.parse(fs.readFileSync(path.join(output,'package.json'),'utf8'));
    assert.equal(packageJson.engines.node,'22.x');
    assert.equal(packageJson.dependencies['@azure/functions'],'4.16.5');
    assert.equal(packageJson.dependencies['firebase-admin'],'14.4.0');
    assert.equal(packageJson.dependencies.mssql,'12.7.2');
    const text=result.files.map(file=>fs.readFileSync(path.join(output,file),'utf8')).join('\n');
    assert.doesNotMatch(text,/BEGIN PRIVATE KEY/);
    assert.doesNotMatch(text,/PAWS_SQL_CONNECTION_STRING\s*=/);
    assert.doesNotMatch(text,/FIREBASE_SERVICE_ACCOUNT_JSON\s*=/);
  }finally{
    fs.rmSync(output,{recursive:true,force:true});
  }
});
