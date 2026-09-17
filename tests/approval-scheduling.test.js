'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'approval-scheduling.js'),'utf8'),context);return context.window.UCVM_APPROVAL_SCHEDULING}
const plain=value=>JSON.parse(JSON.stringify(value));

test('approval scheduling policy requires deliberate override only for real conflicts',()=>{
 const policy=load();
 assert.equal(policy.requiresOverride({status:'conflict'}),true);
 assert.equal(policy.requiresOverride({status:'clear'}),false);
 assert.equal(policy.requiresOverride({status:'check_needed'}),false);
});

test('approval scheduling policy builds a privacy-safe deterministic override audit payload',()=>{
 const policy=load();
 assert.deepEqual(plain(policy.overrideAudit({uid:'admin-1',name:'Admin User'},[{id:'s2',course:'304',date:'2026-10-01',start:'09:00',end:'10:00',ucid:'should-not-copy',doe:99,afcReason:'private'}])),{
  type:'faculty_time_conflict',confirmed:true,confirmedBy:'admin-1',confirmedByName:'Admin User',conflicts:[{id:'s2',course:'304',date:'2026-10-01',start:'09:00',end:'10:00'}]
 });
});
