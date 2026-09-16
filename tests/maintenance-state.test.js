'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('missing system state is treated as unlocked for backward-compatible rule rollout',()=>{
 const api=require('../maintenance-state.js');
 assert.deepEqual(api.normalizeState(null),{teachingDataWriteLocked:false,maintenanceMode:'none',activeImportId:'',maintenanceOwnerUid:'',maintenanceOwnerName:''});
 assert.equal(api.isLocked(api.normalizeState(null)),false);
});

test('normal write guard uses the shared maintenance message',()=>{
 const api=require('../maintenance-state.js');
 const locked=api.normalizeState({teachingDataWriteLocked:true,maintenanceMode:'bulk_import',activeImportId:'i1'});
 assert.throws(()=>api.assertNormalWriteAllowed(locked),new RegExp(api.LOCKED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('UI blocker covers timetable, approval, faculty, and import mutations but not viewing',()=>{
 const api=require('../maintenance-state.js');
 for(const selector of ['#add-session-btn','#selection-save-btn','.btn-swap-confirm','[data-approve-request]','#workflow-self-swap','#save-edit','#import-summary-btn'])assert.ok(api.BLOCKED_CLICK_SELECTORS.includes(selector),selector);
 for(const selector of ['#session-form','#bulk-session-form','#workflow-edit-form','#workflow-self-take-form','#edit-form'])assert.ok(api.BLOCKED_SUBMIT_SELECTORS.includes(selector),selector);
 assert.equal(api.BLOCKED_CLICK_SELECTORS.includes('#my-timetable-btn'),false);
});

test('both timetable and faculty dashboard load maintenance-state before their mutation controllers',()=>{
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8'),admin=fs.readFileSync(path.join(root,'faculty-admin.html'),'utf8');
 assert.ok(index.indexOf('maintenance-state.js')>0&&index.indexOf('maintenance-state.js')<index.indexOf('timetable.js'));
 assert.ok(admin.indexOf('maintenance-state.js')>0&&admin.indexOf('maintenance-state.js')<admin.indexOf('faculty-admin.js'));
});
