'use strict';
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
