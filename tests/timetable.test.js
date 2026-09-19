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
// merged from tests/timetable-academic-navigation.test.js
// ------------------------------------------------------------------------
(() => {
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
})();

// ------------------------------------------------------------------------
// merged from tests/timetable-bulk-outlook.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const timetable=['index.html','timetable.js','afc-timetable-panel.js'].map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n');

test('faculty accounts land on their own teaching in day view',()=>{
 assert.match(timetable,/viewMode\s*=\s*roleIsFaculty\(currentUser\)\s*\?\s*'day'\s*:\s*'week'/);
 assert.match(timetable,/myTimetableOnly\s*=\s*roleIsFaculty\(currentUser\)/);
 assert.match(timetable,/currentUser\.profile\?\.facultyId|currentUser\.profile\.facultyId/);
});

test('timetable contains faculty list, history and AFC self-service without a second calendar',()=>{
 for(const id of ['cal-list-btn','my-change-history-btn','afc-request-btn','afc-panel'])assert.match(timetable,new RegExp(`id=["']${id}["']`));
 assert.match(timetable,/UCVM_AFC_TIMETABLE_PANEL/);
 assert.match(timetable,/UCVM_PAGE_DATA/);
});

test('latest updates is removed and exports use a compact bottom bar',()=>{
 assert.doesNotMatch(timetable,/id="updates-panel"|id="latest-updates-body"/);
 assert.match(timetable,/id="compact-export-bar"/);
 assert.match(timetable,/id="export-csv"/);
 assert.match(timetable,/id="export-calendar"/);
 assert.match(timetable,/id="outlook-invite-btn"/);
});

test('admins can add up to 200 sessions in an editable spreadsheet table',()=>{
 assert.match(timetable,/id="bulk-add-session-btn"/);
 assert.match(timetable,/const MAX_BULK_SESSION_ROWS\s*=\s*200/);
 assert.match(timetable,/function openBulkSessionForm/);
 assert.match(timetable,/function parseBulkPaste/);
 assert.match(timetable,/function validateBulkRows/);
 assert.match(timetable,/async function saveBulkSessions/);
 for(const id of ['bulk-add-row','bulk-duplicate-row','bulk-paste-rows','bulk-session-body'])assert.match(timetable,new RegExp(`id=["']${id}["']`));
 assert.match(timetable,/session_change_log|SESSION_LOG_COLLECTION/);
 assert.match(timetable,/batch\.commit\(\)/);
});

test('Outlook invitation package is filtered, reviewable, and contains attendees',()=>{
 assert.match(timetable,/function openOutlookInviteDialog/);
 assert.match(timetable,/function exportOutlookInvites/);
 assert.match(timetable,/METHOD:REQUEST/);
 assert.match(timetable,/METHOD:REQUEST <code>\.ics<\/code> package/);
 assert.match(timetable,/ORGANIZER/);
 assert.match(timetable,/ATTENDEE/);
 assert.match(timetable,/exportFilteredRows/);
 assert.match(timetable,/isUniversityClosure/);
 assert.match(timetable,/exportOutlookInvites[\s\S]*filter[\s\S]*isUniversityClosure/);
 assert.match(timetable,/does not send|does not silently|review before sending/i);
});
})();

// ------------------------------------------------------------------------
// merged from tests/timetable-responsive-filters.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Schedule filters markup has one accessible always-visible toggle',()=>{
 const html=read('index.html'),css=read('timetable.css');
 assert.match(html,/id="schedule-filter-toggle"[^>]*aria-controls="schedule-filter-panel"[^>]*aria-expanded="true"/);
 assert.match(html,/id="schedule-filter-panel"/);
 assert.doesNotMatch(html,/id="filter-toggle-btn"/);
 assert.match(css,/@media\s*\(max-width:\s*900px\)/);
 assert.match(css,/\.schedule-filter-panel\[hidden\]/);
});

test('Schedule filters default by viewport and honor tab preference',()=>{
 const source=read('timetable.js');
 const fn=source.match(/  function initialScheduleFiltersExpanded\([\s\S]*?\n  \}/)?.[0];
 assert.ok(fn,'initialScheduleFiltersExpanded should be independently testable');
 const context={};vm.runInNewContext(`${fn}\nresult=initialScheduleFiltersExpanded;`,context);
 assert.equal(context.result({matches:true},null),false);
 assert.equal(context.result({matches:false},null),true);
 assert.equal(context.result({matches:true},'true'),true);
 assert.equal(context.result({matches:false},'false'),false);
 assert.match(source,/sessionStorage\.setItem\(SCHEDULE_FILTERS_KEY/);
 assert.match(source,/aria-expanded/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/timetable-ui-editor-removal.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('timetable has no local layout editor while session editing remains available',()=>{
 const html=read('index.html'),js=read('timetable.js'),css=read('timetable.css'),runtime=html+'\n'+js+'\n'+css;
 for(const token of ['ui-editor-panel','ui-edit-mode-btn','bindUIEditorControls','data-ui-editable','UI_SETTINGS_KEY','ucvm_ui_settings'])assert.doesNotMatch(runtime,new RegExp(token));
 assert.doesNotMatch(css,/\.ui-editor-|body\.ui-editing|--ui-sidebar-width/);
 assert.match(js,/function openSessionForm/);
 assert.match(js,/function saveBulkSessions/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/timetable-views-export.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=['index.html','timetable.js'].map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n');

test('course filter supports selecting several courses',()=>{
 assert.match(html,/id="filter-course-options"/);
 assert.match(html,/selectedCourses/);
 assert.match(html,/data-course-choice/);
 assert.doesNotMatch(html,/id="filter-course">/);
});

test('timetable has day, week, month and future list views',()=>{
 for(const id of ['cal-day-btn','cal-week-btn','cal-month-btn','cal-list-btn'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/function renderDay/);
 assert.match(html,/function renderList/);
 assert.match(html,/viewMode\s*=\s*roleIsFaculty\(currentUser\)\s*\?\s*'day'/);
 assert.match(html,/roleIsFaculty/);
});

test('CCC records are opt-in and sourced from the sanitized public schedule document',()=>{
 assert.match(html,/id="show-ccc"/);
 assert.match(html,/collection\('public_schedule'\)\.doc\('ccc_events'\)/);
 assert.match(html,/function loadCccEvents/);
 assert.match(html,/showCcc\s*=\s*false/);
 const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
 assert.match(rules,/match \/public_schedule\/\{id\}/);
 const admin=fs.readFileSync(path.join(root,'faculty-admin.js'),'utf8');
 assert.match(admin,/function syncCccPublicSchedule/);
 assert.match(admin,/await syncCccPublicSchedule\(p\)/);
});

test('CSV and calendar exports use filters and support date, academic, and all scopes',()=>{
 assert.match(html,/id="export-calendar"/);
 assert.match(html,/text\/calendar/);
 assert.match(html,/BEGIN:VCALENDAR/);
 for(const scope of ['date','academic','all'])assert.match(html,new RegExp(`value="${scope}"`));
 assert.match(html,/ensureAllSessions/);
 assert.match(html,/exportFilteredRows/);
 assert.match(html,/University Closure/);
 assert.match(html,/sessionsWithOverlays/);
});
})();
