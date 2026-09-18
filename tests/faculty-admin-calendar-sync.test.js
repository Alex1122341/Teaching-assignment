'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../faculty-admin.js'),'utf8');
test('legacy summary synchronization pairs every session set and delete with sanitized calendar and uses conservative batches',()=>{
 assert.match(source,/UCVM_CALENDAR_SESSION\.fromSource/);
 assert.match(source,/collection\(['"]calendar_sessions['"]\)/);
 assert.match(source,/for\(let i=0;i<p\.sessions\.length;i\+=8\)/);
 assert.match(source,/for\(let i=0;i<stale\.length;i\+=8\)/);
});
