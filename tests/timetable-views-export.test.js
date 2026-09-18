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
