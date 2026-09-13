const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Faculty Admin starts from settings indexes and loads selected detail only',()=>{
 const source=read('faculty-admin.html');
 assert.match(source,/doc\('faculty_index'\)/);
 assert.match(source,/doc\('schedule_stats'\)/);
 assert.match(source,/function loadFacultyDetail\(id\)/);
 assert.match(source,/doc\(String\(id\)\)\.get\(\)/);
 assert.match(source,/where\('facultyIds','array-contains',String\(id\)\)/);
 assert.doesNotMatch(source,/db\.collection\(COLLECTION\)\.onSnapshot/);
 assert.doesNotMatch(source,/db\.collection\(SESSION_COLLECTION\)\.onSnapshot/);
});

test('full Faculty Admin datasets are loaded only for full-data operations',()=>{
 const source=read('faculty-admin.html');
 assert.match(source,/function ensureAdminDataset/);
 assert.match(source,/\['summary','roles','database'\]\.includes\(tab\)/);
});

test('approval workflow fetches only sessions referenced by requests',()=>{
 const source=read('approval-workflow.js');
 assert.match(source,/function ensureRequestSessions\(requestRows\)/);
 assert.match(source,/db\.doc\(`\$\{SESSIONS\}\/\$\{id\}`\)\.get\(\)/);
 assert.doesNotMatch(source,/db\.collection\(SESSIONS\)\.get\(\)/);
 assert.doesNotMatch(source,/UCVM_PAGE_DATA\?\.allSessions/);
});

test('User Management uses the lightweight faculty index',()=>{
 const source=read('user-management.js');
 assert.match(source,/doc\('faculty_index'\)\.get\(\)/);
 assert.doesNotMatch(source,/db\.collection\('faculty'\)\.get\(\)/);
});
