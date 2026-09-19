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
// merged from tests/scheduling-core.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function load(){
  const context={window:{},Date};
  vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
  return context.window.UCVM_SCHEDULING;
}

test('parseTime accepts supported forms and rejects impossible values',()=>{
  const api=load();
  assert.equal(api.parseTime('09:00'),540);
  assert.equal(api.parseTime('9:00'),540);
  assert.equal(api.parseTime('12:00 AM'),0);
  assert.equal(api.parseTime('12:00 PM'),720);
  assert.equal(api.parseTime('1:30 PM'),810);
  assert.equal(api.parseTime('24:00'),null);
  assert.equal(api.parseTime('09:60'),null);
  assert.equal(api.parseTime('13:00 PM'),null);
  assert.equal(api.parseTime(''),null);
});

test('normalizeDate accepts real ISO dates and rejects impossible calendar dates',()=>{
  const api=load();
  assert.equal(api.normalizeDate('2026-10-01'), '2026-10-01');
  assert.equal(api.normalizeDate('2026-10-01T08:00:00'), '2026-10-01');
  assert.equal(api.normalizeDate('2026-02-30'), null);
  assert.equal(api.normalizeDate('not-a-date'), null);
});

test('interval validation rejects zero, reversed, and cross-midnight intervals',()=>{
  const api=load();
  assert.equal(api.validateInterval('09:00','10:00').status,'valid');
  assert.equal(api.validateInterval('10:00','10:00').status,'invalid');
  assert.equal(api.validateInterval('11:00','10:00').status,'invalid');
  assert.equal(api.validateInterval('23:30','00:30').status,'invalid');
  assert.equal(api.validateInterval('','',{timeUnknown:true}).status,'unknown');
});

test('duration and overlap use half-open interval semantics',()=>{
  const api=load();
  assert.equal(api.durationMinutes('09:00','10:30'),90);
  assert.equal(api.durationHours('09:00','10:30'),1.5);
  assert.equal(api.durationHours('','',{timeUnknown:true}),null);
  assert.equal(api.intervalsOverlap('09:00','10:00','10:00','11:00'),false);
  assert.equal(api.intervalsOverlap('09:00','10:01','10:00','11:00'),true);
  assert.equal(api.intervalsOverlap('09:00','11:00','09:30','10:00'),true);
  assert.equal(api.intervalsOverlap('bad','11:00','09:30','10:00'),null);
});

test('validateSessionTiming preserves unknown time without inventing start or end',()=>{
  const api=load();
  assert.deepEqual(JSON.parse(JSON.stringify(api.validateSessionTiming({date:'2026-10-01',start:'',end:'',timeUnknown:true}))),{
    date:'2026-10-01',status:'unknown',reason:'time_unknown',startMinutes:null,endMinutes:null
  });
});

test('findFacultyConflicts separates real conflicts from unknown-time checks',()=>{
  const api=load();
  const sessions=[
    {id:'a',date:'2026-10-01',start:'09:00',end:'10:00',faculty:['f1']},
    {id:'b',date:'2026-10-01',start:'',end:'',timeUnknown:true,faculty:['f1']},
    {id:'c',date:'2026-10-02',start:'09:00',end:'10:00',faculty:['f1']}
  ];
  const assigned=s=>s.faculty.includes('f1');
  const result=api.findFacultyConflicts({date:'2026-10-01',start:'09:30',end:'10:30',sessions,isAssigned:assigned});
  assert.equal(result.status,'conflict');
  assert.deepEqual([...result.conflicts].map(x=>x.id),['a']);
  assert.deepEqual([...result.possibleConflicts].map(x=>x.id),['b']);
  const adjacent=api.findFacultyConflicts({date:'2026-10-01',start:'10:00',end:'11:00',sessions:[sessions[0]],isAssigned:assigned});
  assert.equal(adjacent.status,'clear');
});

test('findFacultyConflicts returns check_needed for invalid target time and different date is ignored',()=>{
  const api=load();
  const sessions=[{id:'a',date:'2026-10-02',start:'09:00',end:'10:00',faculty:['f1']}];
  const result=api.findFacultyConflicts({date:'2026-10-01',start:'bad',end:'10:00',sessions,isAssigned:s=>s.faculty.includes('f1')});
  assert.equal(result.status,'check_needed');
  assert.deepEqual(result.possibleConflicts,[]);
});
})();

// ------------------------------------------------------------------------
// merged from tests/scheduling-integration.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('timetable delegates time parsing, duration, availability overlap, bulk timing, and single-session validation to the scheduling core',()=>{
  const source=read('timetable.js');
  assert.match(source,/const scheduling\s*=\s*window\.UCVM_SCHEDULING/);
  assert.match(source,/function timeToMinutes\([^)]*\)\s*\{\s*return scheduling\.parseTime\(/);
  assert.match(source,/function blockHours\([^)]*\)\s*\{[^}]*scheduling\.durationHours\(/s);
  assert.doesNotMatch(source,/function availabilityTimeMinutes\(/);
  assert.doesNotMatch(source,/function availabilityIntervalsOverlap\(/);
  assert.match(source,/function timetableAvailability\([^)]*\)\s*\{[\s\S]*?scheduling\.findFacultyConflicts\(/);
  assert.match(source,/function validateBulkRows\([^)]*\)\s*\{[\s\S]*?scheduling\.normalizeDate\(date\)[\s\S]*?scheduling\.validateInterval\(start,end\)/);
  assert.match(source,/session-form[^]*?scheduling\.normalizeDate\(date\)[^]*?scheduling\.validateInterval\(start,end,\{timeUnknown\}\)\.status==='invalid'/);
});

test('timetable does not keep a second AM PM parser or manual overlap formula',()=>{
  const source=read('timetable.js');
  assert.doesNotMatch(source,/function availabilityTimeMinutes[\s\S]*?match\(\/\^\(\\d\{1,2\}/);
  assert.doesNotMatch(source,/return as<be&&bs<ae/);
});

test('ADFA approval delegates conflict checks and records explicit timetable-conflict overrides',()=>{
  const source=read('approval-workflow.js');
  assert.match(source,/const scheduling=window\.UCVM_SCHEDULING/);
  assert.doesNotMatch(source,/function timeMinutes\(/);
  assert.doesNotMatch(source,/function overlaps\(/);
  assert.match(source,/function timetableCheck\([^)]*\)\{[\s\S]*?scheduling\.findFacultyConflicts\(/);
  assert.match(source,/function approvalConflictOverride\([^)]*\)\{[\s\S]*?approvalScheduling\.requiresOverride[\s\S]*?approvalScheduling\.overrideAudit/);
  assert.match(source,/Override and approve despite the timetable conflict/);
  assert.match(source,/override:conflictOverride/);
});
})();
