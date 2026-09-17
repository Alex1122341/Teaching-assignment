'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const backup=require('../bulk-import-backup.js');
class FakeTimestamp{constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds}toDate(){return new Date(this.seconds*1000)}}

test('backup codec round-trips timestamps',()=>{
  const encoded=backup.encodeValue({updatedAt:new FakeTimestamp(123,456)});
  assert.deepEqual(encoded,{updatedAt:{__ucvmFirestoreType:'timestamp',seconds:123,nanoseconds:456}});
  const decoded=backup.decodeValue(encoded,{Timestamp:FakeTimestamp});
  assert.equal(decoded.updatedAt.seconds,123);
  assert.equal(decoded.updatedAt.nanoseconds,456);
});

test('backup codec rejects unknown class instances',()=>{
  class Unknown{}
  assert.throws(()=>backup.encodeValue(new Unknown()),/unsupported firestore value/i);
});

test('backup identity must match the interrupted import',async()=>{
  const payload=await backup.buildBackup({projectId:'tester-teaching',importId:'i1',sourceFingerprint:'abc',actor:{uid:'general',name:'General'},faculty:[],sessions:[],summarySettings:null,createdAt:'2026-09-16T20:00:00.000Z'});
  await backup.parseAndValidateBackup(backup.serializeBackup(payload),{projectId:'tester-teaching',importId:'i1',sourceFingerprint:'abc'});
  await assert.rejects(()=>backup.parseAndValidateBackup(backup.serializeBackup(payload),{projectId:'tester-teaching',importId:'i2',sourceFingerprint:'abc'}),/does not belong/i);
});
