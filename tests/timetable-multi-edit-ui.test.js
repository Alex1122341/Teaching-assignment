'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('timetable loads selection before its controller and exposes admin selection controls',()=>{
 const html=read('index.html'),js=read('timetable.js');
 assert.ok(html.indexOf('timetable-selection.js')<html.indexOf('timetable.js'));
 assert.ok(html.indexOf('faculty-doe.js')<html.indexOf('timetable.js'));
 for(const id of ['select-sessions-btn','selection-cancel-btn','review-selected-btn','selection-count'])assert.match(html,new RegExp(`id=["']${id}["']`));
 assert.match(js,/selection-controls.*classList\.toggle\('hidden',\s*!canSelectSessions\(\)\)/s);
});

test('faculty choices use effective DOE and visibly label overrides',()=>{
 const js=read('timetable.js');
 assert.match(js,/UCVM_FACULTY_DOE\.effectiveTarget/);
 assert.match(js,/Override DOE/);
 assert.doesNotMatch(js,/Contract Teaching DOE is shown when it exists/);
});

test('selection mode routes every rendered session through stable IDs and blocks CCC selection',()=>{
 const js=read('timetable.js');
 assert.match(js,/function bindSessionBlocks[\s\S]*sessionSelection\.toggle/);
 assert.match(js,/if\s*\(s\?\.isCcc\)[\s\S]*return/);
 assert.match(js,/selectedRows\([\s\S]*selection.*ids\(\)/);
 assert.match(js,/selectionViewFlow\.review\(\)/);
});

test('spreadsheet editor validates before progressive paired commits and applies exact index deltas per completed batch',()=>{
 const js=read('timetable.js');
 for(const field of ['date','year','course','type','start','end','topic','room','faculty'])assert.match(js,new RegExp(`data-selection-field=["']${field}["']`));
 assert.match(js,/planChanges\(/);
 assert.match(js,/firestoreSafeSession\(update\.data\)/);
 assert.match(js,/updatedBy:currentUser\.uid[\s\S]*updatedAt:timestamp/);
 assert.match(js,/commitPlan\(/);
 assert.match(js,/afterBatch:async\(\{logs\}\)=>/);
 assert.match(js,/logs\.map\(log=>\(\{before:log\.before,after:log\.after\}\)\)/);
 assert.match(js,/afterBatch:async\(\{logs\}\)=>\{invalidateAllSessions\(\);if\(canEditFaculty\)\{const changes=logs\.map\(log=>\(\{before:log\.before,after:log\.after\}\)\);await updateDerivedIndexes\(changes,\{rethrow:true\}\)\}/);
});

test('back to selection rerenders immediately instead of relying on a subscription change',()=>{
 const js=read('timetable.js');
 const match=js.match(/\$\('selection-back-btn'\)\.onclick=\(\)=>\{([^}]*)\}/);
 assert.ok(match,'selection back handler must exist');
 const handler=match[1];
 assert.match(handler,/reviewingSelection=false/);
 assert.match(handler,/viewMode=selectionViewFlow\.finish\(\)/);
 assert.match(handler,/render\(\)/);
});

test('office roles use explicit capability gates and ADC LAB read the sanitized calendar collection',()=>{
 const js=read('timetable.js');
 assert.match(js,/['"]adc['"]/);
 assert.match(js,/['"]lab['"]/);
 assert.match(js,/UCVM_OFFICE_CAPABILITIES\.forRole/);
 assert.match(js,/CALENDAR_SESSION_COLLECTION\s*=\s*['"]calendar_sessions['"]/);
 assert.match(js,/function sessionCollection\(\)/);
 assert.match(js,/bulk-add-session-btn[\s\S]*canAddSessions/);
 assert.match(js,/add-session-btn[\s\S]*canAddOneSession/);
 assert.match(js,/selection-controls[\s\S]*canSelectSessions/);
});

test('selection save pairs source calendar and audit writes and uses resumable progress batches',()=>{
 const js=read('timetable.js');
 assert.match(js,/calendarRef:id=>db\.collection\('calendar_sessions'\)\.doc\(id\)/);
 assert.match(js,/calendarFromSource:\(row,id\)=>window\.UCVM_CALENDAR_SESSION\.fromSource\(row,id\)/);
 assert.match(js,/chunkSize:SESSION_SAVE_BATCH_ROWS/);
 assert.match(js,/completedRows/);
 assert.match(js,/resumeFrom/);
});

test('ADC bulk entry hides faculty editing, forces LAB topic TBD, and saves in resumable paired batches',()=>{
 const js=read('timetable.js');
 assert.match(js,/async function openBulkSessionForm\(\)[\s\S]*if\(!canAddSessions\(\)\)/);
 assert.match(js,/const canEditFaculty=capabilities\(\)\.canEditInstructor/);
 assert.match(js,/bulk-faculty[\s\S]*disabled/);
 assert.match(js,/String\(row\.type\|\|''\)\.toUpperCase\(\)==='LAB'[\s\S]*row\.topic='TBD'/);
 assert.match(js,/saveBulkSessions[\s\S]*SESSION_SAVE_BATCH_ROWS/);
 assert.match(js,/calendar_sessions/);
 assert.match(js,/Resume save/);
});

test('single-session writers use capability-owned fields and keep calendar documents synchronized',()=>{
 const js=read('timetable.js');
 assert.match(js,/async function openSessionForm\(existing = null\)[\s\S]*canAddOneSession/);
 assert.match(js,/canEditInstructor/);
 assert.match(js,/calendarRef/);
 assert.match(js,/UCVM_CALENDAR_SESSION\.fromSource/);
 assert.match(js,/async function deleteSession[\s\S]*batch\.delete\(db\.collection\(CALENDAR_SESSION_COLLECTION\)\.doc\(id\)\)/);
});

test('faculty swap keeps the sanitized calendar mirror synchronized',()=>{
 const js=read('timetable.js');
 const start=js.indexOf('async function performFacultySwap');
 const end=js.indexOf('\n  async function initializeLiveSchedule',start);
 const fn=js.slice(start,end);
 assert.match(fn,/CALENDAR_SESSION_COLLECTION/);
 assert.match(fn,/UCVM_CALENDAR_SESSION\.fromSource/);
});

test('role-locked timetable fields have a visible disabled treatment',()=>{
 const css=read('timetable.css');
 assert.match(css,/\.role-locked-field/);
 assert.match(css,/cursor:\s*not-allowed/);
});

test('ADC multi-edit emits sanitized assignment recheck instead of opening ADFA conflict override details',()=>{
 const js=read('timetable.js');
 const start=js.indexOf('async function saveSelectedChanges');
 const end=js.indexOf('\n  function openSessionDetail',start);
 const fn=js.slice(start,end);
 assert.match(fn,/const overrides=canEditFaculty\?confirmSchedulingChanges/);
 assert.match(fn,/ucvm:assignment-recheck-required/);
 assert.match(fn,/facultyDisplayName/);
});

test('interactive timetable saves use the conservative paired-write row budget',()=>{
 const js=read('timetable.js');
 assert.match(js,/SESSION_SAVE_BATCH_ROWS\s*=\s*8/);
});
