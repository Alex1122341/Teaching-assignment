'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'workflow-notifications.js'),'utf8'),context);return context.window.UCVM_WORKFLOW_NOTIFICATIONS;}

test('notification builder allowlists office-safe fields and strips private Faculty data',()=>{
 const api=load();
 const payload=api.build({kind:'request_assigned',office:'adc',request:{id:'r1',sessionId:'s1',proposedFacultyName:'Dr Jane',ucid:'SECRET-UCID',email:'secret@example.test',doe:42,afc:'PRIVATE'},session:{course:'505',date:'2027-03-22',start:'14:45',end:'16:15',type:'LAB',topic:'Pre-Op',facultyIds:['SECRET-UCID'],awayFromCampusRecords:[{reason:'PRIVATE'}]},message:'Review request'});
 assert.deepEqual(Object.keys(payload).sort(),['course','createdAt','date','end','facultyDisplayName','kind','message','readBy','recipientOffice','requestId','sessionId','start','topic','type'].sort());
 assert.equal(payload.recipientOffice,'adc');
 assert.equal(payload.facultyDisplayName,'Dr Jane');
 assert.equal(payload.createdAt,null);
 const json=JSON.stringify(payload);
 for(const forbidden of ['SECRET-UCID','secret@example.test','42','PRIVATE','facultyIds','awayFromCampusRecords','doe','afc'])assert.equal(json.includes(forbidden),false,forbidden);
});

test('notification builder supports only approved workflow event kinds and office recipients',()=>{
 const api=load();
 for(const kind of ['request_assigned','request_resubmitted','office_decision','request_applied','request_withdrawn','assignment_recheck_required'])assert.equal(api.build({kind,office:'adfa'}).kind,kind);
 assert.throws(()=>api.build({kind:'private_faculty_dump',office:'adfa'}),/Unsupported workflow notification/);
 assert.throws(()=>api.build({kind:'request_assigned',office:'faculty'}),/Unsupported notification recipient/);
});

test('emitBatch persists only the sanitized builder output',()=>{
 const api=load(),writes=[];
 const ref={id:'n1'},db={collection:name=>({doc:()=>({...ref,path:`${name}/n1`})})},batch={set:(target,value)=>writes.push({target,value})};
 const output=api.emitBatch(batch,db,{kind:'assignment_recheck_required',office:'adfa',session:{id:'s1',course:'505',date:'2027-03-22',start:'09:00',end:'10:00',instructor:'Dr Jane',ucid:'SECRET'}},'STAMP');
 assert.equal(writes.length,1);assert.equal(writes[0].target.path,'workflow_notifications/n1');
 assert.equal(writes[0].value.createdAt,'STAMP');assert.equal(writes[0].value.facultyDisplayName,'Dr Jane');assert.equal(JSON.stringify(writes[0].value).includes('SECRET'),false);
 assert.equal(output.id,'n1');
});

test('notification client is role-scoped and acknowledges only readBy',()=>{
 const source=fs.readFileSync(path.join(root,'workflow-notifications.js'),'utf8');
 assert.match(source,/where\('recipientOffice','==',office\)/);
 assert.match(source,/orderBy\('createdAt','desc'\)/);
 assert.match(source,/arrayUnion\(user\.uid\)/);
 assert.match(source,/update\(\{readBy:/);
});

test('notification panel is published and loaded before timetable workflow consumers',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),assets=JSON.parse(fs.readFileSync(path.join(root,'tools/static-assets.json'),'utf8'));
 assert.match(html,/id="workflow-notifications"/);
 assert.match(html,/src="workflow-notifications\.js"/);
 assert.ok(html.indexOf('workflow-notifications.js')<html.indexOf('timetable.js'));
 assert.ok(assets.includes('workflow-notifications.js'));
});
