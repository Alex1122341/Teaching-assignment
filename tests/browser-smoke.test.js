'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {
 PAGE_EXPECTATIONS,CLOUD_FIREBASE_HOSTS,safeStaticPath,contentType,chromeCandidates,localAssetFailure
}=require('../tools/browser-smoke.js');

test('browser smoke covers every generated application page',()=>{
 assert.deepEqual(PAGE_EXPECTATIONS.map(item=>item.page),['index.html','faculty-admin.html','user-management.html','password.html']);
 for(const item of PAGE_EXPECTATIONS)assert.match(item.required,/^bundles\/.+\.bundle\.js$/);
});

test('browser smoke explicitly rejects Firebase cloud endpoints',()=>{
 for(const host of ['firestore.googleapis.com','identitytoolkit.googleapis.com','securetoken.googleapis.com'])assert.ok(CLOUD_FIREBASE_HOSTS.has(host));
});

test('static smoke server cannot escape the deployment directory',()=>{
 const site=path.resolve('/tmp/ucvm-site');
 assert.equal(safeStaticPath(site,'/index.html'),path.join(site,'index.html'));
 assert.equal(safeStaticPath(site,'/bundles/a.bundle.js'),path.join(site,'bundles/a.bundle.js'));
 assert.equal(safeStaticPath(site,'/%2e%2e/firestore.rules'),null);
 assert.equal(safeStaticPath(site,'/%00bad'),null);
});

test('browser smoke MIME and local-asset filters cover runtime files',()=>{
 assert.match(contentType('x.js'),/javascript/);
 assert.match(contentType('x.css'),/text\/css/);
 assert.match(contentType('x.pdf'),/application\/pdf/);
 assert.equal(localAssetFailure('http://127.0.0.1:8765/a.js','http://127.0.0.1:8765'),true);
 assert.equal(localAssetFailure('https://www.gstatic.com/firebase.js','http://127.0.0.1:8765'),false);
});

test('Chrome discovery keeps environment overrides ahead of runner defaults',()=>{
 const candidates=chromeCandidates({CHROME_PATH:'/custom/chrome',CHROME_BIN:'/custom/bin'});
 assert.deepEqual(candidates.slice(0,2),['/custom/chrome','/custom/bin']);
 assert.ok(candidates.includes('google-chrome'));
});
