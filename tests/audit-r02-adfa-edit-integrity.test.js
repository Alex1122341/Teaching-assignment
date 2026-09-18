'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));

function loadSelection(){
 const context={window:{},Date};
 vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context);
 return context.window.UCVM_TIMETABLE_SELECTION;
}

const original={
 id:'s1',date:'2026-10-07',week:6,semester:'fall',year:1,
 course:'204',courseName:'Foundations I',type:'LEC',start:'08:30',end:'09:30',timeUnknown:false,
 topic:'Passports',room:'A101',
 assignments:[{ucid:'1001',facultyId:'1001',name:'Alex Faculty',role:'Lecture'}],
 facultyIds:['1001'],instructor:'Alex Faculty',labDetails:[]
};
const actor={uid:'admin-1',email:'admin@ucalgary.ca',name:'Admin User',role:'administrator'};
const faculty=new Map([
 ['1001',{__id:'1001',preferredFullName:'Alex Faculty'}],
 ['1002',{__id:'1002',preferredFullName:'Blair Faculty'}]
]);

test('R02 partial source write contract does not invent an empty facultyIds field',()=>{
 const maintenance=require('../index-maintenance.js');
 assert.equal(typeof maintenance.sessionPatchForWrite,'function');
 assert.deepEqual(plain(maintenance.sessionPatchForWrite({room:'B202'})),{room:'B202'});
 assert.deepEqual(plain(maintenance.sessionPatchForWrite({assignments:[{facultyId:'1002'}]})),{
  assignments:[{facultyId:'1002'}],facultyIds:['1002']
 });
});

test('R02 ADFA room-only edit preserves faculty state and emits only the room patch',()=>{
 const api=loadSelection();
 const edited={...plain(original),room:'B202'};
 const plan=plain(api.planChanges([original],[edited],actor,123,faculty,{role:'administrator'}));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates.length,1);
 assert.deepEqual(plan.updates[0].data,{room:'B202'});
 assert.deepEqual(plan.updates[0].after.facultyIds,['1001']);
 assert.equal(plan.updates[0].after.instructor,'Alex Faculty');
});

test('R02 ADFA faculty-only edit carries the private assignment fields into the source patch',()=>{
 const api=loadSelection();
 const assignments=[{ucid:'1002',facultyId:'1002',name:'Blair Faculty',role:'Lecture'}];
 const edited={...plain(original),assignments,facultyIds:['1002'],instructor:'Blair Faculty'};
 const plan=plain(api.planChanges([original],[edited],actor,123,faculty,{role:'administrator'}));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates.length,1);
 assert.deepEqual(plan.updates[0].data.assignments,assignments);
 assert.deepEqual(plan.updates[0].data.facultyIds,['1002']);
 assert.equal(plan.updates[0].data.instructor,'Blair Faculty');
 assert.equal(Object.hasOwn(plan.updates[0].data,'labDetails'),false);
 assert.deepEqual(plan.logs[0].changes.map(change=>change.field),['assignments']);
});

test('R02 ADFA date and course edits carry their derived calendar fields',()=>{
 const api=loadSelection();
 const edited={...plain(original),date:'2027-01-11',week:1,semester:'winter',course:'305',courseName:'Clinical Skills II'};
 const plan=plain(api.planChanges([original],[edited],actor,123,faculty,{role:'administrator'}));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates.length,1);
 assert.equal(plan.updates[0].data.date,'2027-01-11');
 assert.equal(plan.updates[0].data.week,1);
 assert.equal(plan.updates[0].data.semester,'winter');
 assert.equal(plan.updates[0].data.course,'305');
 assert.equal(plan.updates[0].data.courseName,'Clinical Skills II');
});

test('R02 multi-session save uses the partial-write serializer instead of the full-session serializer',()=>{
 const js=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
 const start=js.indexOf('async function saveSelectedChanges');
 const end=js.indexOf('\n  function openSessionDetail',start);
 const fn=js.slice(start,end);
 assert.match(fn,/firestoreSafeSessionPatch\(update\.data\)/);
 assert.doesNotMatch(fn,/firestoreSafeSession\(update\.data\)/);
});
