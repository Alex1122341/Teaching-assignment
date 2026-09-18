'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'approval-state.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_STATE;
}

test('one rejection terminates the whole request',()=>{
  const api=load();
  const result=api.decide({status:'pending',approvals:{adc:'pending',lab:'approved',adfa:'pending'}},{office:'adc',decision:'reject'});
  assert.equal(result.status,'rejected');
  assert.equal(result.approvals.adc,'rejected');
  assert.equal(result.approvals.lab,'approved');
  assert.equal(result.approvals.adfa,'cancelled');
});

test('push back exposes only the returning office scope',()=>{
  const api=load();
  const result=api.decide({status:'pending',editableFields:[],approvals:{adc:'pending',lab:'approved'}},{office:'adc',decision:'push_back',fields:['date','room']});
  assert.equal(result.status,'update_required');
  assert.deepEqual([...result.editableFields],['date','room']);
  assert.equal(result.approvals.adc,'push_back');
  assert.equal(result.approvals.lab,'approved');
});

test('resubmission preserves unchanged approved scopes but resets returned scopes',()=>{
  const api=load();
  const result=api.planRevision({
    revision:1,status:'update_required',
    approvals:{adc:{status:'push_back',fields:['date'],scopeSignature:'old-a'},lab:{status:'approved',fields:['topic'],scopeSignature:'same-l'}},
    oldSignatures:{adc:'old-a',lab:'same-l'},
    newSignatures:{adc:'new-a',lab:'same-l'},
    changedFields:['date'],hasAssignedFaculty:false,requiredOffices:['adc','lab']
  });
  assert.equal(result.revision,2);
  assert.equal(result.status,'pending');
  assert.equal(result.approvals.adc.status,'pending');
  assert.equal(result.approvals.lab.status,'approved');
});

test('date/time revision with assigned Faculty reopens prior ADFA approval',()=>{
  const api=load();
  const result=api.planRevision({
    revision:3,status:'update_required',
    approvals:{adc:{status:'push_back',fields:['date']},adfa:{status:'approved',fields:['instructor']}},
    oldSignatures:{adc:'a1',adfa:'f1'},newSignatures:{adc:'a2',adfa:'f1'},
    changedFields:['date'],hasAssignedFaculty:true,requiredOffices:['adc','adfa']
  });
  assert.equal(result.approvals.adfa.status,'pending');
});

test('withdraw is allowed only from pending or update_required',()=>{
  const api=load();
  assert.equal(api.withdraw({status:'pending'}).status,'withdrawn');
  assert.equal(api.withdraw({status:'update_required'}).status,'withdrawn');
  assert.throws(()=>api.withdraw({status:'approved'}),/can no longer be withdrawn/i);
  assert.throws(()=>api.withdraw({status:'rejected'}),/can no longer be withdrawn/i);
  assert.throws(()=>api.withdraw({status:'withdrawn'}),/can no longer be withdrawn/i);
});

test('Spark finalizer requires ADFA only when Faculty changes are present',()=>{
  const api=load();
  assert.equal(api.canFinalize({office:'adc',hasFacultyChange:true,allRequiredApproved:true}),false);
  assert.equal(api.canFinalize({office:'lab',hasFacultyChange:true,allRequiredApproved:true}),false);
  assert.equal(api.canFinalize({office:'adfa',hasFacultyChange:true,allRequiredApproved:true}),true);
  assert.equal(api.canFinalize({office:'adfa',hasFacultyChange:true,allRequiredApproved:false}),false);
  assert.equal(api.canFinalize({office:'lab',hasFacultyChange:false,allRequiredApproved:true}),true);
});

test('other pending offices may continue deciding while a request is update_required',()=>{
 const api=load();
 const current={status:'update_required',editableFields:['date'],approvals:{adc:{status:'push_back'},lab:{status:'pending'}}};
 const approved=api.decide(current,{office:'lab',decision:'approve',fields:['topic']});
 assert.equal(approved.status,'update_required');
 assert.equal(approved.approvals.adc.status,'push_back');
 assert.equal(approved.approvals.lab.status,'approved');
});

test('multiple push backs union returned editable fields',()=>{
 const api=load();
 const current={status:'update_required',editableFields:['date'],approvals:{adc:{status:'push_back'},lab:{status:'pending'}}};
 const pushed=api.decide(current,{office:'lab',decision:'push_back',fields:['topic']});
 assert.deepEqual(Array.from(pushed.editableFields),['date','topic']);
});
