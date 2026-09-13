'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const timetable=fs.readFileSync(path.join(root,'index.html'),'utf8');
const dashboardHtml=fs.readFileSync(path.join(root,'faculty-dashboard.html'),'utf8');
const dashboardJs=fs.readFileSync(path.join(root,'faculty-dashboard.js'),'utf8');

test('faculty accounts land on their own teaching in day view',()=>{
 assert.match(timetable,/viewMode\s*=\s*roleIsFaculty\(currentUser\)\s*\?\s*'day'\s*:\s*'week'/);
 assert.match(timetable,/myTimetableOnly\s*=\s*roleIsFaculty\(currentUser\)/);
 assert.match(timetable,/currentUser\.profile\?\.facultyId|currentUser\.profile\.facultyId/);
});

test('faculty dashboard keeps list history and AFC without a duplicate calendar',()=>{
 assert.doesNotMatch(dashboardHtml,/id="calendar-tab"|id="calendar-view"|id="week-grid"/);
 assert.match(dashboardHtml,/id="list-tab"/);
 assert.match(dashboardHtml,/id="history-tab"/);
 assert.match(dashboardHtml,/id="afc-tab"/);
 assert.doesNotMatch(dashboardJs,/renderCalendar|week-prev|week-next|week-current/);
 assert.match(dashboardJs,/currentView\s*=\s*location\.hash===['"]#afc['"]\?['"]afc['"]:['"]list['"]/);
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
 assert.match(timetable,/does not send|does not silently|review before sending/i);
});
