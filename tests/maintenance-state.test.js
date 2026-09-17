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

test('planned maintenance API exposes a non-throwing normal-write guard',()=>{
 const api=require('../maintenance-state.js'),messages=[];
 const locked=api.normalize({teachingDataWriteLocked:true,maintenanceMode:'bulk_import',activeImportId:'i1'});
 assert.equal(api.isActive(locked),true);
 assert.equal(api.normalTeachingWritesAllowed(locked),false);
 assert.equal(api.guardNormalWrite(locked,{toast:message=>messages.push(message)}),false);
 assert.deepEqual(messages,[api.LOCKED_MESSAGE]);
 const open=api.normalize(null);
 assert.equal(api.guardNormalWrite(open,{toast:message=>messages.push(message)}),true);
 assert.equal(typeof api.watch,'function');
 assert.equal(typeof api.installBanner,'function');
 assert.equal(typeof api.renderBanner,'function');
});

test('runtime banner keeps the required maintenance message exact',()=>{
 const api=require('../maintenance-state.js'),nodes={};
 const body={prepend(node){nodes[node.id]=node},classList:{toggle(){}}};
 const doc={body,getElementById:id=>nodes[id]||null,createElement:()=>({id:'',style:{},textContent:'',setAttribute(){},removeAttribute(){},getAttribute(){return null}}),querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};
 const runtime=api.create({document:doc});
 runtime.setState({teachingDataWriteLocked:true,maintenanceMode:'bulk_import',activeImportId:'i1',maintenanceOwnerName:'Alex'});
 assert.equal(nodes['teaching-maintenance-banner'].textContent,api.LOCKED_MESSAGE);
});

test('UI blocker covers timetable, approval, faculty, import, and derived-index rebuild mutations but not viewing',()=>{
 const api=require('../maintenance-state.js');
 for(const selector of ['#add-session-btn','#selection-save-btn','.btn-swap-confirm','[data-approve-request]','#workflow-self-swap','#save-edit','#import-summary-btn','[data-derived-index-rebuild]'])assert.ok(api.BLOCKED_CLICK_SELECTORS.includes(selector),selector);
 for(const selector of ['#session-form','#bulk-session-form','#workflow-edit-form','#workflow-self-take-form','#edit-form'])assert.ok(api.BLOCKED_SUBMIT_SELECTORS.includes(selector),selector);
 assert.equal(api.BLOCKED_CLICK_SELECTORS.includes('#my-timetable-btn'),false);
 assert.equal(api.BLOCKED_CLICK_SELECTORS.includes('#derived-index-verify'),false);
});

test('both timetable and faculty dashboard load maintenance-state before their mutation controllers',()=>{
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8'),admin=fs.readFileSync(path.join(root,'faculty-admin.html'),'utf8');
 assert.ok(index.indexOf('maintenance-state.js')>0&&index.indexOf('maintenance-state.js')<index.indexOf('timetable.js'));
 assert.ok(admin.indexOf('maintenance-state.js')>0&&admin.indexOf('maintenance-state.js')<admin.indexOf('faculty-admin.js'));
});
