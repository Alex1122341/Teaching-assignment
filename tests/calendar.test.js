'use strict';
// ---------------------------------------------------------------------------
// Merged domain test file.
//
// This file was assembled from several small single-purpose test files in the
// same domain. No assertion was changed: each source body is preserved verbatim
// inside its own IIFE so top-level declarations from different files cannot
// collide, and the total number of tests is unchanged.
//
// Split it back out by taking each block below to its own file if a failure ever
// needs a narrower blast radius.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------------------
// merged from tests/calendar-maintenance-rules.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
test('maintenance source writes require a synchronized calendar companion',()=>{assert.match(rules,/function maintenanceSessionWrite\(id\)[\s\S]*calendarMatchesSourceAfter\(id\)/);assert.match(rules,/allow create:[^\n]*maintenanceSessionWrite\(id\)/);assert.match(rules,/allow update:[^\n]*maintenanceSessionWrite\(id\)/);assert.match(rules,/allow delete:[^\n]*maintenanceSessionDelete\(id\)/);});
test('calendar repair is General-only and matches the current private source',()=>{assert.match(rules,/function generalCalendarRepair\(id\)/);assert.match(rules,/general\(\)[\s\S]*calendarMatchesCurrentSource\(id\)/);assert.match(rules,/allow (?:create|update):[^\n]*generalCalendarRepair\(id\)/);});
})();

// ------------------------------------------------------------------------
// merged from tests/calendar-session-maintenance.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const root=path.resolve(__dirname,'..');
function load(){const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'calendar-session.js'),'utf8'),{window});vm.runInNewContext(fs.readFileSync(path.join(root,'calendar-session-maintenance.js'),'utf8'),{window});return window.UCVM_CALENDAR_SESSION_MAINTENANCE;}
const source={id:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructor:'Jane Smith',assignments:[{ucid:'f1',name:'Jane Smith',doeCredit:.5}]};
const clean={sessionId:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructorNames:['Jane Smith'],instructor:'Jane Smith'};
test('calendar compare identifies missing stale wrong and private documents',()=>{const api=load();let r=api.compare([source],[]);assert.equal(r.ok,false);assert.equal(r.mismatches[0].kind,'missing');r=api.compare([],[clean]);assert.equal(r.mismatches[0].kind,'stale');r=api.compare([source],[{...clean,room:'Wrong'}]);assert.equal(r.mismatches[0].kind,'mismatch');r=api.compare([source],[{...clean,facultyIds:['f1']}]);assert.equal(r.mismatches[0].kind,'private_field');});
test('calendar compare reports exact sanitized mirror healthy',()=>{const r=load().compare([source],[clean]);assert.deepEqual({ok:r.ok,mismatchCount:r.mismatchCount},{ok:true,mismatchCount:0});});
})();

// ------------------------------------------------------------------------
// merged from tests/calendar-session.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>require('../calendar-session.js');
const source=()=>({id:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',instructor:'Jane Smith; Alex Faculty',facultyIds:['private-id-1','private-id-2'],assignments:[{ucid:'private-id-1',name:'Jane Smith',email:'private@example.test',doeCredit:1.25},{ucid:'private-id-2',name:'Alex Faculty',doeCredit:1.25}],awayFromCampusRecords:[{startDate:'private-date',reason:'private-reason'}],extraPrivate:{email:'hidden@example.test'}});
test('calendar sanitizer exposes exactly the public scheduling schema and names',()=>{
 const input=source(),before=structuredClone(input),clean=load().fromSource(input,'s1');
 assert.deepEqual(clean,{sessionId:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',instructor:'Jane Smith; Alex Faculty',instructorNames:['Jane Smith','Alex Faculty']});
 assert.deepEqual(input,before);
 for(const forbidden of ['facultyIds','assignments','ucid','doeCredit','awayFromCampusRecords','private-id','private@example.test','private-reason','hidden@example.test'])assert.equal(JSON.stringify(clean).includes(forbidden),false,forbidden);
});
test('calendar sanitizer preserves unknown time without inventing a time',()=>{
 const result=load().fromSource({...source(),start:'',end:'',timeUnknown:true},'s2');assert.equal(result.timeUnknown,true);assert.equal(result.start,'');assert.equal(result.end,'');
});
test('legacy display names can be read without consulting Faculty records',()=>{
 const clean=load().fromSource({instructor:'Jane Smith; Jane Smith; Alex Faculty'},'s3');
 assert.deepEqual(clean.instructorNames,['Jane Smith','Alex Faculty']);
 assert.equal(clean.instructor,'Jane Smith; Jane Smith; Alex Faculty');
});
test('display-only conversion never copies nested objects through public fields',()=>{
 const clean=load().fromSource({course:'505',topic:{email:'secret@example.test'},room:['private@example.test'],instructor:{ucid:'secret-id'},assignments:[{ucid:'secret-id',name:{email:'nested@example.test'}}]},'s4');
 assert.equal(clean.topic,'');assert.equal(clean.room,'');assert.equal(clean.instructor,'');assert.deepEqual(clean.instructorNames,[]);
 assert.doesNotMatch(JSON.stringify(clean),/secret|private|nested/);
});
test('sanitizer does not reconstruct authoritative instructor text from private assignments',()=>{
 const clean=load().fromSource({assignments:[{ucid:'f1',name:'Private-only assignment'}]},'legacy');
 assert.equal(clean.instructor,'');assert.deepEqual(clean.instructorNames,[]);
});
test('browser and Node exports produce identical calendar data',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ctx={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../calendar-session.js'),'utf8'),ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.UCVM_CALENDAR_SESSION.fromSource(source(),'s1'))),load().fromSource(source(),'s1'));
});
})();
