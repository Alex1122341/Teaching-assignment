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
// merged from tests/workflow-notification-integration.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('request submission emits a sanitized assignment notification for every required office',()=>{
 const source=read('approval-request.js');
 assert.match(source,/UCVM_WORKFLOW_NOTIFICATIONS/);
 assert.match(source,/request_assigned/);
 assert.match(source,/records\.workflow\.requiredOffices/);
});

test('routed workflow emits sanitized notifications for decision resubmit withdraw and apply lifecycle events',()=>{
 const source=read('approval-workflow.js');
 for(const kind of ['office_decision','request_resubmitted','request_withdrawn','request_applied'])assert.match(source,new RegExp(kind),kind);
 assert.match(source,/notifications\.emitBatch/);
 assert.match(source,/notifications\.mount/);
});

test('ADC direct schedule-change signal persists only an ADFA assignment-recheck notification',()=>{
 const source=read('workflow-notifications.js');
 assert.match(source,/ucvm:assignment-recheck-required/);
 assert.match(source,/assignment_recheck_required/);
 assert.match(source,/office:'adfa'/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/workflow-notification-rules.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const indexes=JSON.parse(fs.readFileSync(path.join(root,'firestore.indexes.json'),'utf8'));
const css=fs.readFileSync(path.join(root,'timetable.css'),'utf8');

test('workflow notification rules enforce sanitized shape role-scoped reads and readBy-only acknowledgement',()=>{
 assert.match(rules,/function\s+workflowNotificationShapeValid\(/);
 assert.match(rules,/function\s+validWorkflowNotificationCreate\(/);
 assert.match(rules,/function\s+workflowNotificationRead\(/);
 assert.match(rules,/function\s+workflowNotificationAcknowledge\(/);
 assert.match(rules,/match \/workflow_notifications\/\{id\}/);
 assert.match(rules,/allow read:\s*if\s+workflowNotificationRead\(\)/);
 assert.match(rules,/allow create:\s*if\s+validWorkflowNotificationCreate\(\)/);
 assert.match(rules,/allow update:\s*if\s+workflowNotificationAcknowledge\(\)/);
 assert.match(rules,/allow delete:\s*if\s+false/);
 assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['readBy'\]\)/);
 assert.match(rules,/assignment_recheck_required/);
 assert.match(rules,/recipientOffice\s*==\s*'adfa'/);
});

test('workflow notification query has recipientOffice plus createdAt descending composite index',()=>{
 const found=indexes.indexes.some(index=>index.collectionGroup==='workflow_notifications'&&JSON.stringify(index.fields)===JSON.stringify([
  {fieldPath:'recipientOffice',order:'ASCENDING'},
  {fieldPath:'createdAt',order:'DESCENDING'}
 ]));
 assert.equal(found,true);
});

test('workflow notification panel has compact fixed side-panel styles and unread emphasis',()=>{
 assert.match(css,/\.workflow-notifications\s*\{/);
 assert.match(css,/\.workflow-notification\.unread/);
 assert.match(css,/\.workflow-notifications-head/);
 assert.match(css,/\.workflow-notifications-list/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/workflow-notifications.test.js
// ------------------------------------------------------------------------
(() => {
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
 assert.match(source,/officesForProfile/);assert.match(source,/where\('recipientOffice','==',offices\[0\]\)/);assert.match(source,/where\('recipientOffice','in',offices\)/);
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
})();
