const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Faculty Admin starts from settings indexes and loads selected detail only',()=>{
 const source=read('faculty-admin.js');
 assert.match(source,/doc\('faculty_index'\)/);
 assert.match(source,/doc\('schedule_stats'\)/);
 assert.match(source,/function loadFacultyDetail\(id\)/);
 assert.match(source,/doc\(String\(id\)\)\.get\(\)/);
 assert.match(source,/where\('facultyIds','array-contains',String\(id\)\)/);
 assert.doesNotMatch(source,/db\.collection\(COLLECTION\)\.onSnapshot/);
 assert.doesNotMatch(source,/db\.collection\(SESSION_COLLECTION\)\.onSnapshot/);
});

test('full Faculty Admin datasets are loaded only for full-data operations',()=>{
 const source=read('faculty-admin.js');
 assert.match(source,/function ensureAdminDataset/);
 assert.match(source,/\['summary','roles','database'\]\.includes\(tab\)/);
});

test('approval workflow fetches only sessions referenced by requests',()=>{
 const source=read('approval-workflow.js');
 assert.match(source,/function ensureRequestSessions\(requestRows\)/);
 assert.match(source,/db\.doc\(`\$\{SESSIONS\}\/\$\{id\}`\)\.get\(\)/);
 assert.match(source,/where\('date','==',date\)\.get\(\)/);
 assert.doesNotMatch(source,/where\('facultyIds','array-contains',id\)\.get\(\)/);
 assert.match(source,/approvalSessionDatesLoaded=new Set\(\)/);
 assert.doesNotMatch(source,/approvalSessionFacultyLoaded/);
 assert.doesNotMatch(source,/db\.collection\(SESSIONS\)\.get\(\)/);
 assert.doesNotMatch(source,/UCVM_PAGE_DATA\?\.allSessions/);
});

test('User Management uses the lightweight faculty index until an Owner requests bulk provisioning',()=>{
 const source=read('user-management.js');
 assert.match(source,/doc\('faculty_index'\)\.get\(\)/);
 const initialLoad=source.match(/async function load\(\)\{[\s\S]*?\n \}/)?.[0]||'';
 assert.doesNotMatch(initialLoad,/db\.collection\('faculty'\)\.get\(\)/);
 assert.match(source,/async function fullFaculty\(\)\{const snapshot=await db\.collection\('faculty'\)\.get\(\)/);
 assert.match(source,/async function previewProvision\(\)[\s\S]*await fullFaculty\(\)/);
});

test('Timetable faculty self-service subscribes to assigned faculty only',()=>{
 const source=read('timetable.js');
 assert.match(source,/where\('facultyIds','array-contains',facultyId\)/);
 assert.doesNotMatch(source,/db\.collection\('sessions'\)\.onSnapshot/);
 assert.match(source,/ensureSessionsForRange/);
});

test('Timetable editing reads only affected dates and scoped exports avoid full reads',()=>{
 const source=read('timetable.js');
 assert.match(source,/function ensureSessionsForDates/);
 assert.match(source,/where\('date','in',dateChunk\)/);
 for(const name of ['openSwapModal','startSessionSelection','openBulkSessionForm','openSessionForm']){
  const start=source.indexOf(`function ${name}`);
  const next=source.indexOf('\n  function ',start+1);
  const body=source.slice(start,next<0?source.length:next);
  assert.doesNotMatch(body,/ensureAllSessions/,`${name} should not load every session`);
 }
 const submit=source.match(/\$\('export-form'\)\.onsubmit=[\s\S]*?\n\s*};/)?.[0]||'';
 assert.match(submit,/scope==='all'.*ensureAllSessions/s);
 assert.match(submit,/scope==='date'.*ensureSessionsForRange/s);
});
