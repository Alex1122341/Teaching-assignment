'use strict';
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
