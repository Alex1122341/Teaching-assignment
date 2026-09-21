'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const report=require('../tools/report-lightweight.js');

test('lightweight report calculates reduction percentages',()=>{
 assert.equal(report.reduction(52,21),59.6);
 assert.equal(report.reduction(31,9),71);
 assert.equal(report.reduction(100,101),-1);
});

test('source metrics describe the modular runtime graph',()=>{
 const metrics=report.collectSourceMetrics(path.resolve(__dirname,'..'));
 assert.equal(metrics.assets,69);
 assert.equal(metrics.jsAssets,57);
 assert.equal(metrics.pageScripts['index.html'],36);
 assert.equal(metrics.pageScripts['faculty-admin.html'],32);
 assert.equal(metrics.pageScripts['user-management.html'],16);
 assert.equal(metrics.pageScripts['password.html'],4);
});

test('deployment metrics read generated metadata and rewritten HTML',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucvm-lightweight-report-'));
 try{
  const deploy=path.join(dir,'.deploy-static');
  fs.mkdirSync(deploy,{recursive:true});
  const page=(scripts)=>`<!doctype html><html><body>${scripts.map(src=>`<script src="${src}"></script>`).join('')}</body></html>`;
  fs.writeFileSync(path.join(deploy,'index.html'),page(['a.js','b.js']));
  fs.writeFileSync(path.join(deploy,'faculty-admin.html'),page(['a.js']));
  fs.writeFileSync(path.join(deploy,'user-management.html'),page(['u.js']));
  fs.writeFileSync(path.join(deploy,'password.html'),page(['p.js']));
  const metadataDir=path.join(dir,'.deploy-metadata');
  fs.mkdirSync(metadataDir,{recursive:true});
  fs.writeFileSync(path.join(metadataDir,'deployment-assets.json'),JSON.stringify({
   deploymentAssetCount:7,deployedJsCount:4,bytes:1234,
   bundles:[{output:'bundles/a.bundle.js'}],
   assets:[{path:'a.js',bytes:100},{path:'b.js',bytes:200},{path:'u.js',bytes:300},{path:'p.js',bytes:400},{path:'index.html',bytes:50},{path:'faculty-admin.html',bytes:50},{path:'user-management.html',bytes:50}]
  }));
  const metrics=report.collectDeploymentMetrics(dir);
  assert.equal(metrics.assets,7);
  assert.equal(metrics.jsAssets,4);
  assert.equal(metrics.jsBytes,1000);
  assert.equal(metrics.bundles,1);
  assert.deepEqual(metrics.pageScripts,{'index.html':2,'faculty-admin.html':1,'user-management.html':1,'password.html':1});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('markdown report makes reductions visible in PR summaries',()=>{
 const source={assets:62,jsAssets:52,bytes:1934772,jsBytes:742264,pageScripts:{'index.html':31,'faculty-admin.html':27,'user-management.html':11,'password.html':4}};
 const deployed={assets:31,jsAssets:21,bytes:1955538,jsBytes:761316,pageScripts:{'index.html':9,'faculty-admin.html':11,'user-management.html':6,'password.html':3},bundles:9,metadataBytes:6742};
 const md=report.markdownReport(source,deployed);
 assert.match(md,/Application assets \| 62 \| 31 \| -31 \(-50%\)/);
 assert.match(md,/JavaScript assets \| 52 \| 21 \| -31 \(-59\.6%\)/);
 assert.match(md,/Timetable direct JS \| 31 \| 9 \| -22 \(-71%\)/);
 assert.match(md,/Source modules are intentionally retained/);
});
