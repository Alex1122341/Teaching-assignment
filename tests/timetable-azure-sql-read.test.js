'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','timetable.js'),'utf8');

test('timetable has an explicit Azure SQL session read branch without Firestore onSnapshot',()=>{
  assert.match(source,/function sessionBackend\(\)/);
  assert.match(source,/window\.UCVM_PAWS_DATA\?\.sessionBackend/);
  assert.match(source,/window\.UCVM_PAWS_DATA\.listSessions\(\{start:range\.start,end:range\.end\}\)/);
  assert.match(source,/scheduleSource\s*=\s*rows\.length\s*\?\s*'azure-sql'\s*:\s*'azure-sql-empty'/);
  assert.match(source,/scheduleSource\s*=\s*'azure-sql-error'/);
  assert.match(source,/\['firestore','firestore-empty','azure-sql','azure-sql-empty'\]\.includes\(scheduleSource\)/);
  assert.match(source,/if\(sessionBackend\(\)==='azure-sql'\)[\s\S]{0,1800}ensureSessionsForRange/);
  assert.match(source,/sessionQueryForRange\(range\)\.onSnapshot/);
});

test('Azure SQL session mode has one shared fail-closed mutation guard',()=>{
  assert.match(source,/function sessionMutationsAllowed\(\)/);
  assert.match(source,/function assertSessionMutationsAllowed\(\)/);
  assert.match(source,/SQL_SESSION_WRITES_NOT_READY/);

  for(const name of [
    'openBulkSessionForm',
    'openSessionForm',
    'deleteSession',
    'saveSelectedChanges',
    'openSwapModal',
    'startSessionSelection'
  ]){
    const start=source.indexOf(`function ${name}`);
    const asyncStart=source.indexOf(`async function ${name}`);
    const at=start>=0?start:asyncStart;
    assert.ok(at>=0,`missing ${name}`);
    const body=source.slice(at,at+700);
    assert.match(body,/assertSessionMutationsAllowed\(\)/,`${name} must fail closed before any write/edit path`);
  }
});

test('admin session mutation controls are hidden when the configured session backend is read-only',()=>{
  assert.match(source,/const sessionWritesEnabled=sessionMutationsAllowed\(\)/);
  assert.match(source,/bulk-add-session-btn[\s\S]{0,120}!sessionWritesEnabled/);
  assert.match(source,/add-session-btn[\s\S]{0,120}!sessionWritesEnabled/);
  assert.match(source,/selection-controls[\s\S]{0,120}!sessionWritesEnabled/);
});

test('Azure SQL session reads are used by date and all-session helpers too',()=>{
  const range=source.slice(source.indexOf('async function ensureSessionsForRange'),source.indexOf('window.UCVM_PAGE_DATA='));
  assert.match(range,/sessionBackend\(\)==='azure-sql'/);
  assert.match(range,/ensureSessionsForRange\(dates\[0\],dates\[dates\.length-1\]\)/);
  const all=source.slice(source.indexOf('async function ensureAllSessions'),source.indexOf('function invalidateAllSessions'));
  assert.match(all,/sessionBackend\(\)==='azure-sql'/);
  assert.match(all,/ensureSessionsForRange\('0001-01-01','9999-12-31'\)/);
});
