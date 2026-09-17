'use strict';
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
