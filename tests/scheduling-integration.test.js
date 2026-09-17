'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('timetable delegates time parsing, duration, availability overlap, and bulk timing validation to the scheduling core',()=>{
  const source=read('timetable.js');
  assert.match(source,/const scheduling\s*=\s*window\.UCVM_SCHEDULING/);
  assert.match(source,/function timeToMinutes\([^)]*\)\s*\{\s*return scheduling\.parseTime\(/);
  assert.match(source,/function blockHours\([^)]*\)\s*\{[^}]*scheduling\.durationHours\(/s);
  assert.match(source,/function availabilityTimeMinutes\([^)]*\)\s*\{\s*return scheduling\.parseTime\(/);
  assert.match(source,/function availabilityIntervalsOverlap\([^)]*\)\s*\{[^}]*scheduling\.intervalsOverlap\(/s);
  assert.match(source,/function timetableAvailability\([^)]*\)\s*\{[\s\S]*?scheduling\.findFacultyConflicts\(/);
  assert.match(source,/function validateBulkRows\([^)]*\)\s*\{[\s\S]*?scheduling\.normalizeDate\(date\)[\s\S]*?scheduling\.validateInterval\(start,end\)/);
});

test('timetable does not keep a second AM PM parser or manual overlap formula',()=>{
  const source=read('timetable.js');
  assert.doesNotMatch(source,/function availabilityTimeMinutes[\s\S]*?match\(\/\^\(\\d\{1,2\}/);
  assert.doesNotMatch(source,/return as<be&&bs<ae/);
});
