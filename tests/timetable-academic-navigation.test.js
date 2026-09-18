'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function extractFunction(source,name){
  const match=source.match(new RegExp('  function '+name+'\\([\\s\\S]*?\\n  \\}'));
  assert.ok(match,`${name} should be independently testable`);
  return match[0];
}

test('semester controls add All mode and remove the redundant Month filter',()=>{
  const html=read('index.html');
  assert.match(html,/data-semester="all"[^>]*>All</);
  assert.doesNotMatch(html,/id="filter-month"/);
  assert.doesNotMatch(read('timetable.js'),/filter-month/);
});

test('continuous academic navigation crosses semester boundaries in calendar order',()=>{
  const source=read('timetable.js');
  const fn=extractFunction(source,'moveAcademicWeekPosition');
  const context={WEEK_COUNT:17};
  vm.runInNewContext(fn+'\nresult=moveAcademicWeekPosition;',context);
  const move=(semester,week,delta,continuous)=>JSON.parse(JSON.stringify(context.result(semester,week,delta,continuous)));

  assert.deepEqual(move('spring',17,1,true),{semester:'fall',week:1});
  assert.deepEqual(move('fall',1,-1,true),{semester:'spring',week:17});
  assert.deepEqual(move('fall',17,1,true),{semester:'winter',week:1});
  assert.deepEqual(move('winter',1,-1,true),{semester:'fall',week:17});
  assert.deepEqual(move('winter',17,1,true),{semester:'winter',week:17});
  assert.deepEqual(move('spring',1,-1,true),{semester:'spring',week:1});
});

test('locked semester navigation stays inside W1 to W17',()=>{
  const source=read('timetable.js');
  const fn=extractFunction(source,'moveAcademicWeekPosition');
  const context={WEEK_COUNT:17};
  vm.runInNewContext(fn+'\nresult=moveAcademicWeekPosition;',context);
  const move=(semester,week,delta)=>JSON.parse(JSON.stringify(context.result(semester,week,delta,false)));

  assert.deepEqual(move('fall',17,1),{semester:'fall',week:17});
  assert.deepEqual(move('winter',1,-1),{semester:'winter',week:1});
  assert.deepEqual(move('fall',8,1),{semester:'fall',week:9});
});

test('All mode is the default/reset scope while selectedSemester remains the actual calendar position',()=>{
  const js=read('timetable.js');
  assert.match(js,/let semesterScope\s*=\s*'all'/);
  const reset=js.slice(js.indexOf('function resetFilters()'),js.indexOf('\n  function ',js.indexOf('function resetFilters()')+1));
  assert.match(reset,/semesterScope\s*=\s*'all'/);
  assert.match(reset,/syncSemesterUI\(\)/);
  const filtered=js.slice(js.indexOf('function filteredSessions'),js.indexOf('\n  function ',js.indexOf('function filteredSessions')+1));
  assert.match(filtered,/semesterScope\s*!==\s*'all'/);
});

test('month view derives its month from the selected academic week instead of a second filter',()=>{
  const js=read('timetable.js');
  assert.doesNotMatch(js,/calendarYearForMonth/);
  const range=js.slice(js.indexOf('function visibleSessionRange()'),js.indexOf('\n  function ',js.indexOf('function visibleSessionRange()')+1));
  assert.match(range,/monthRangeForAcademicPosition\(selectedSemester,selectedWeek\)/);
  const month=js.slice(js.indexOf('function renderMonth()'),js.indexOf('\n  function ',js.indexOf('function renderMonth()')+1));
  assert.match(month,/monthRangeForAcademicPosition\(selectedSemester,selectedWeek\)/);
});
