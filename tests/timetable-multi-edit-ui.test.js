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

test('faculty choices defer DOE totals to the authoritative server preview',()=>{
 const js=read('timetable.js');
 assert.doesNotMatch(js,/function buildSwapDoeState\s*\(/);
 assert.doesNotMatch(js,/UCVM_FACULTY_DOE\.effectiveTarget/);
 assert.match(js,/DOE server preview on save/);
 assert.match(js,/Server preview on SWAP/);
});

test('selection mode routes rendered sessions through stable IDs and blocks all read-only synthetic rows',()=>{
 const js=read('timetable.js');
 assert.match(js,/function bindSessionBlocks[\s\S]*sessionSelection\.toggle/);
 assert.match(js,/function isReadOnlySynthetic/);
 assert.match(js,/isReadOnlySynthetic\(s\)[\s\S]*return/);
 assert.match(js,/University closure records are read-only|read-only institutional/i);
 assert.match(js,/selectedRows\([\s\S]*selection.*ids\(\)/);
 assert.match(js,/selectionViewFlow\.review\(\)/);
});

test('spreadsheet editor validates before progressive paired commits and applies exact index deltas per completed batch',()=>{
 const js=read('timetable.js');
 for(const field of ['date','year','course','type','start','end','topic','room','faculty'])assert.match(js,new RegExp(`data-selection-field=["']${field}["']`));
 assert.match(js,/planChanges\(/);
 assert.match(js,/firestoreSafeSessionPatch\(update\.data\)/);
 assert.doesNotMatch(js,/firestoreSafeSession\(update\.data\)/);
 assert.match(js,/updatedBy:currentUser\.uid[\s\S]*updatedAt:timestamp/);
 assert.match(js,/commitPlan\(/);
 assert.match(js,/saveSessionChange\(\{academicYear:update\.after\?\.academicYear\|\|'',sessionId:update\.id,afterSession:update\.after,trigger:'multi_session_edit'\}\)/);
 assert.match(js,/updateDerivedIndexes\(\[\{before:log\.before,after:savedAfter\}\],\{rethrow:true\}\)/);
 assert.match(js,/afterBatch:async\(\{logs\}\)=>/);
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
 assert.match(js,/UCVM_OFFICE_CAPABILITIES\.forProfile/);
 assert.match(js,/CALENDAR_SESSION_COLLECTION\s*=\s*['"]calendar_sessions['"]/);
 assert.match(js,/function sessionCollection\(\)[\s\S]*other_office[\s\S]*CALENDAR_SESSION_COLLECTION/);
 assert.match(js,/bulk-add-session-btn[\s\S]*canAddSessions/);
 assert.match(js,/add-session-btn[\s\S]*canAddOneSession/);
 assert.match(js,/selection-controls[\s\S]*canSelectSessions/);
});

test('general selection never creates scoped Work Queue state and scoped editor does',()=>{
 const js=read('timetable.js');
 const general=js.slice(js.indexOf('async function startSessionSelection'),js.indexOf('function cancelSessionSelection'));
 const scoped=js.slice(js.indexOf('async function openScopedEditor'),js.indexOf('function selectionFacultyOptions'));
 assert.match(general,/scopedWork=null/);
 assert.doesNotMatch(general,/sessionId:id|capabilities\(stage\)/);
 assert.match(scoped,/scopedWork=\{sessionId:id,stage\}/);
 assert.match(scoped,/capabilities\(stage\)\.canEditInstructor/);
});

test('scoped Work Queue editor derives field ownership from the persisted scoped stage',()=>{
 const js=read('timetable.js');
 assert.match(js,/function selectionRole\(\)\{if\(scopedWork\?\.stage\)return scopedWork\.stage;/);
 assert.doesNotMatch(js,/function selectionRole\(\)[^\n]*activeScoped/);
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

test('faculty swap delegates canonical session and sanitized calendar persistence to the DOE API',()=>{
 const js=read('timetable.js'),repo=read('server/src/doe/firestore-repository.js');
 const start=js.indexOf('async function performFacultySwap');
 const end=js.indexOf('\n  async function initializeLiveSchedule',start);
 const fn=js.slice(start,end);
 assert.match(fn,/saveSessionChange/);
 assert.doesNotMatch(fn,/CALENDAR_SESSION_COLLECTION|UCVM_CALENDAR_SESSION\.fromSource/);
 assert.match(repo,/saveSessionCalculationBundle/);
 assert.match(repo,/transaction\.set\(calendarRef,calendarSession\.fromSource\(session,sessionId\)\)/);
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

test('timetable page contract loads private LAB workflow context only for LAB-capable profiles',()=>{
 const js=read('timetable.js');
 assert.match(js,/db\.collection\('lab_groups'\)\.where\('active','==',true\)\.get\(\)/);
 assert.match(js,/db\.collection\('lab_group_rosters'\)\.get\(\)/);
 assert.match(js,/if\(!currentUser\|\|!hasOfficeAccess\('lab'\)\)/);
 assert.match(js,/workflowContext,/);
 assert.match(js,/ensureWorkflowContext:\(\)=>ensureLabWorkflowContext\(\)/);
 assert.match(js,/stage==='lab'\)await ensureLabWorkflowContext\(\)/);
});
