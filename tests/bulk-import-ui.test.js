'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../bulk-import-ui.js');
const root=path.resolve(__dirname,'..');

test('preflight summary exposes management-facing counts and warnings',()=>{
 const result=ui.summarizePreflight({source:{sourceWorkbook:'MASTER.xlsx'},analysis:{facultyExpected:118,sessionExpected:2400,createdSessionIds:['a'],updatedSessionIds:['b','c'],staleSessionIds:['old'],noSourceFacultyIds:['f1'],requiresTypedImportConfirmation:true},warnings:['Large change'],errors:[]});
 assert.deepEqual(result,{sourceWorkbook:'MASTER.xlsx',facultyExpected:118,sessionExpected:2400,createdSessions:1,updatedSessions:2,staleSessions:1,noSourceFaculty:1,requiresTypedImportConfirmation:true,errors:[],warnings:['Large change']});
});

test('restore phase and recovery ownership are explicit',()=>{
 assert.equal(ui.isRestoreJob({phase:'RESTORING_SESSIONS'}),true);
 assert.equal(ui.isRestoreJob({phase:'APPLYING_SESSIONS'}),false);
 assert.deepEqual(ui.recoveryPermissions({teachingDataWriteLocked:true,maintenanceOwnerUid:'general'},{phase:'FAILED'},'general2'),{active:true,isOwner:false,canTakeOver:true,isRestore:false});
});

test('start gate requires a saved backup and exact IMPORT confirmation for large changes',()=>{
 assert.deepEqual(ui.startGate({backupConfirmed:false,requiresTypedImportConfirmation:false,typedConfirmation:''}),{ok:false,message:'Confirm that the recovery backup has been saved.'});
 assert.deepEqual(ui.startGate({backupConfirmed:true,requiresTypedImportConfirmation:true,typedConfirmation:'import'}),{ok:false,message:'Type IMPORT exactly to confirm this large synchronization.'});
 assert.deepEqual(ui.startGate({backupConfirmed:true,requiresTypedImportConfirmation:true,typedConfirmation:'IMPORT'}),{ok:true,message:''});
 assert.deepEqual(ui.startGate({backupConfirmed:true,requiresTypedImportConfirmation:false,typedConfirmation:''}),{ok:true,message:''});
});

test('restore and takeover confirmation helpers reject ambiguous input',()=>{
 assert.equal(ui.restoreConfirmed('RESTORE'),true);
 assert.equal(ui.restoreConfirmed('restore'),false);
 assert.equal(ui.restoreConfirmed(' RESTORE '),true);
 assert.equal(ui.takeoverReason('   '),'');
 assert.equal(ui.takeoverReason(' Original administrator unavailable '),'Original administrator unavailable');
});

test('raw file payload preserves exact bytes used for fingerprinting',async()=>{
 const raw=new TextEncoder().encode('{ "a": 1 }');
 const file={name:'source.json',arrayBuffer:async()=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)};
 const payload=await ui.readFilePayload(file);
 assert.equal(payload.name,'source.json');
 assert.equal(payload.text,'{ "a": 1 }');
 assert.deepEqual([...payload.bytes],[...raw]);
});

test('Faculty Dashboard loads bulk import runtime after legacy admin bindings so it can replace the old destructive handler',()=>{
 const html=fs.readFileSync(path.join(root,'faculty-admin.html'),'utf8');
 assert.ok(html.indexOf('bulk-import-core.js')>0);
 assert.ok(html.indexOf('bulk-import-controller.js')>html.indexOf('bulk-import-core.js'));
 assert.ok(html.indexOf('bulk-import-ui.js')>html.indexOf('faculty-admin.js'));
});
