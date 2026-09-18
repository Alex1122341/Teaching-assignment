'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bulk-import-core.js');

const validSource=()=>({
  schemaVersion:'ucvm-all-faculty-summaries-v8-synced-2026-27',
  sourceWorkbook:'Teaching Assignments.xlsx',
  faculty:[{ucid:'100',displayName:'One'}],
  sessions:[{id:'s1',course:'301',date:'2026-09-08',assignments:[]}]
});

test('validateSource blocks duplicate faculty and session IDs',()=>{
  const source=validSource();
  source.faculty.push({ucid:'100'});
  source.sessions.push({...source.sessions[0]});
  const result=core.validateSource(source);
  assert.match(result.errors.join('\n'),/duplicate faculty/i);
  assert.match(result.errors.join('\n'),/duplicate session/i);
});

test('fingerprintBytes hashes raw bytes, not parsed JSON',async()=>{
  const a=new TextEncoder().encode('{"a":1}');
  const b=new TextEncoder().encode('{ "a": 1 }');
  assert.notEqual(await core.fingerprintBytes(a),await core.fingerprintBytes(b));
});

test('analyzeSource reports stale sessions and large-change confirmation',()=>{
  const source=validSource();
  source.sessions.push({id:'s2',course:'302',date:'2026-09-09',assignments:[]});
  const analysis=core.analyzeSource({
    source,
    currentFaculty:[{__id:'100'},{__id:'200'}],
    currentSessions:[{id:'s1'},{id:'old-1'},{id:'old-2'},{id:'old-3'},{id:'old-4'},{id:'old-5'},{id:'old-6'},{id:'old-7'},{id:'old-8'}]
  });
  assert.equal(analysis.sessionExpected,2);
  assert.equal(analysis.staleSessionIds.length,8);
  assert.equal(analysis.requiresTypedImportConfirmation,true);
});

test('diffIdSets compares identity, not only counts',()=>{
  assert.deepEqual(core.diffIdSets(['A','B','C'],['A','B','D']),{missing:['C'],unexpected:['D']});
});


test('session and stale import batches use the conservative paired-write budget',()=>{
  assert.ok(core.SESSION_BATCH_SIZE<=8);
  assert.ok(core.STALE_BATCH_SIZE<=8);
  assert.equal(core.FACULTY_BATCH_SIZE,350);
});
