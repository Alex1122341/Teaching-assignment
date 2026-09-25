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

test('LAB scoped editor renders and reads the canonical LAB group assignment control',()=>{
 const js=read('timetable.js');
 assert.match(js,/data-selection-field="labGroups"/);
 assert.match(js,/data-selection-lab-group-option/);
 assert.match(js,/labGroupDirectory/);
 assert.match(js,/labGroupIds=policy\.fields\.labGroups/);
 assert.match(js,/selectionCapabilities\(\)\.canEditLabGroups\)await ensureLabWorkflowContext\(\)/);
});

test('selection pickers render chips into their sibling containers',()=>{
 const js=read('timetable.js');
 const faculty=js.slice(js.indexOf('function updateSelectionFacultyPicker'),js.indexOf('function selectionLabGroupOptions'));
 const lab=js.slice(js.indexOf('function updateSelectionLabGroupPicker'),js.indexOf('function selectionRole'));
 assert.match(faculty,/nextElementSibling/);
 assert.match(lab,/nextElementSibling/);
 assert.doesNotMatch(faculty,/picker\.querySelector\('\.selection-faculty-chips'\)/);
 assert.doesNotMatch(lab,/picker\.querySelector\('\.selection-faculty-chips'\)/);
});

test('scoped Work Queue editor derives field ownership from the persisted scoped stage',()=>{
 const js=read('timetable.js');
 const start=js.indexOf('function selectionRole');
 const end=js.indexOf('function selectionCapabilities',start);
 const fn=js.slice(start,end);
 assert.match(fn,/if\(scopedWork\?\.stage\)return scopedWork\.stage/);
 assert.doesNotMatch(fn,/activeScoped/);
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
 assert.match(fn,/const overrides=needsDoe\?confirmSchedulingChanges/);
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


test('ADC Add One keeps LAB Topic locked but successful FormData includes the TBD handoff placeholder',()=>{
 const js=read('timetable.js');
 const start=js.indexOf('async function openSessionForm');
 const end=js.indexOf('\n  function input(',start);
 const fn=js.slice(start,end);
 assert.match(fn,/if\(isLab\)topicInput\.value='TBD'/);
 assert.match(fn,/topicInput\.readOnly=isLab/);
 assert.doesNotMatch(fn,/topicInput\.disabled=isLab/);
 assert.match(fn,/new FormData\(e\.target\)/);
});

test('Subject selection uses the active catalog and a Subject-only save bypasses DOE work',()=>{
 const js=read('timetable.js');
 assert.match(js,/db\.collection\('teaching_subjects'\)\.get\(\)/);
 assert.match(js,/subjectOptions\.map\(option=>option\.key\)/);
 const start=js.indexOf('async function openSessionForm');
 const end=js.indexOf('\n  function input(',start);
 const form=js.slice(start,end);
 assert.match(form,/subjectChoices\(s\.subjectKey\)/);
 assert.match(form,/Choose an active Subject from the catalog/);
 assert.match(form,/if\(subjectOnly\)next=\{\.\.\.existing,subjectKey\}/);
 assert.match(form,/if\(existing&&!subjectOnly\)/);
 assert.match(form,/const needsDoe=canEditInstructor&&!subjectOnly/);
 assert.match(form,/UCVM_TIMETABLE_SELECTION\.workingRevisionChange\(existing,next,currentUser,timestamp/);
 assert.match(form,/if\(revision\)batch\.update\(db\.collection\('teaching_assignment_submissions'\)\.doc\(revision.id\),revision.data\)/);
});

test('trusted Teaching Assignment ownership editor is directory-backed and derives package identity outside the UI',()=>{
 const js=read('timetable.js');
 assert.match(js,/teaching_assignment_groups/);
 assert.match(js,/teaching_responsibilities/);
 assert.match(js,/ensureTeachingAssignmentDirectory/);
 assert.match(js,/data-selection-field="teachingAssignmentGroupId"/);
 assert.match(js,/data-selection-field="responsibleHiccResponsibilityId"/);
 assert.doesNotMatch(js,/data-selection-field="teachingAssignmentSubmissionId"/);
 assert.match(js,/allowTeachingAssignmentOwnership:selectionOwnershipAllowed\(\)/);
 assert.match(js,/teachingAssignmentGroups:\[\.\.\.teachingAssignmentGroupDirectory\.values\(\)\]/);
 assert.match(js,/teachingResponsibilities:\[\.\.\.teachingResponsibilityDirectory\.values\(\)\]/);
});

test('Owner ADFAD General uses ownership-only ta_config rather than inheriting ADC or Faculty editing',()=>{
 const js=read('timetable.js');
 const start=js.indexOf('function selectionRole');
 const end=js.indexOf('function selectionPolicy',start);
 const fn=js.slice(start,end);
 assert.match(fn,/UCVM\.general\(currentUser\)&&canConfigureTeachingAssignmentOwnership\(\)\)return'ta_config'/);
 assert.match(fn,/hasOfficeAccess\('adc'\)\)return'adc'/);
 assert.match(fn,/selectionOwnershipAllowed/);
});

test('Teaching Assignment ownership participates in stale checks and metadata-only saves bypass DOE',()=>{
 const js=read('timetable.js');
 const start=js.indexOf('async function saveSelectedChanges');
 const end=js.indexOf('\n  function openSessionDetail',start);
 const fn=js.slice(start,end);
 for(const field of ['teachingAssignmentGroupId','responsibleHiccResponsibilityId','teachingAssignmentSubmissionId'])assert.match(fn,new RegExp(field));
 assert.match(fn,/onlyNonDoeMetadataChanged/);
 assert.match(fn,/nonDoeMetadataCount/);
 assert.match(fn,/const needsDoe=canEditFaculty&&preflight\.updates\.length>0&&nonDoeMetadataCount===0/);
});

test('internal package locator stays absent from the sanitized Working calendar projection',()=>{
 const projection=read('calendar-session.js');
 assert.doesNotMatch(projection,/teachingAssignmentSubmissionId/);
 // Safe year/group/responsibility metadata lets ADC configure ownership without
 // reading private /sessions. The adapter derives the package ID in memory.
 for(const field of ['academicYear','teachingAssignmentGroupId','responsibleHiccResponsibilityId'])assert.match(projection,new RegExp(field),field);
 const timetable=read('timetable.js');
 assert.match(timetable,/createOwnershipAdapter\(\{db,actor:currentUser,configurationReady:canConfigureTeachingAssignmentOwnership/);
 assert.match(timetable,/commitOwnership:\(update,log\)=>ownershipAdapter.save\(update,log\)/);
});

test('Teaching Assignment directory permission failure disables ownership configuration without failing timetable data',()=>{
 const js=read('timetable.js');
 const start=js.indexOf('async function ensureTeachingAssignmentDirectory');
 const end=js.indexOf('function canConfigureTeachingAssignmentOwnership',start);
 const fn=js.slice(start,end);
 assert.match(fn,/permission-denied/);
 assert.match(fn,/teachingAssignmentDirectoryReady=false/);
 assert.match(fn,/return teachingAssignmentDirectory\(\)/);
});
