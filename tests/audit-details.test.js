'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(){
 const context={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','audit-details.js'),'utf8'),context);
 return context.window.UCVM_AUDIT_DETAILS;
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('legacy batch logs recover concrete field changes from before and after snapshots',()=>{
 const details=load();
 const entry={action:'batch_update',before:{date:'2026-09-17',topic:'Old',room:'A1',assignments:[{name:'Alex'}],facultyIds:['1'],instructor:'Alex'},after:{date:'2026-09-18',topic:'New',room:'B2',assignments:[{name:'Blair'}],facultyIds:['2'],instructor:'Blair'}};
 assert.deepEqual(plain(details.changes(entry)),[
  {field:'date',label:'Date',before:'2026-09-17',after:'2026-09-18'},
  {field:'topic',label:'Topic',before:'Old',after:'New'},
  {field:'room',label:'Room',before:'A1',after:'B2'},
  {field:'assignments',label:'Faculty',before:['Alex'],after:['Blair']}
 ]);
});

test('change groups show three details until expanded',()=>{
 const details=load(),changes=[1,2,3,4,5].map(value=>({field:String(value)}));
 assert.deepEqual(plain(details.group(changes,false)),{visible:[{field:'1'},{field:'2'},{field:'3'}],remaining:2});
 assert.deepEqual(plain(details.group(changes,true)),{visible:changes,remaining:0});
});

test('session audit diff records changed fields and normalized faculty names',()=>{
 const details=load(),before={date:'2026-09-17',course:'204',topic:'Old',assignments:[{ucid:'1',name:'Alex'}]},after={...before,topic:'New',assignments:[{ucid:'2',name:'Blair'}]};
 assert.deepEqual(plain(details.diff(before,after,'session')), [
  {field:'topic',label:'Topic',before:'Old',after:'New'},
  {field:'assignments',label:'Faculty',before:['Alex'],after:['Blair']}
 ]);
});

test('faculty audit diff supports create and delete without logging empty fields',()=>{
 const details=load(),faculty={ucid:'100',preferredFullName:'Doe, Jane',email:'jane@example.ca',office:''};
 assert.deepEqual(plain(details.diff(null,faculty,'faculty')), [
  {field:'ucid',label:'UCID',before:null,after:'100'},
  {field:'preferredFullName',label:'Preferred name',before:null,after:'Doe, Jane'},
  {field:'email',label:'Email',before:null,after:'jane@example.ca'}
 ]);
 assert.deepEqual(plain(details.diff(faculty,null,'faculty')), [
  {field:'ucid',label:'UCID',before:'100',after:null},
  {field:'preferredFullName',label:'Preferred name',before:'Doe, Jane',after:null},
  {field:'email',label:'Email',before:'jane@example.ca',after:null}
 ]);
});
