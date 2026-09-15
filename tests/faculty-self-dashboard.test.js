const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('faculty, HICC, and VISC can open Faculty Dashboard from the timetable',()=>{
 const src=read('asset-loader.js');
 assert.match(src,/function enableFacultyDashboardLink\(\)/);
 assert.match(src,/\['faculty','hicc','visc'\]\.includes\(UCVM\.role\(profile\?\.role\)\)/);
 assert.match(src,/button\.classList\.remove\('hidden'\)/);
 assert.match(src,/window\.location\.href='faculty-admin\.html'/);
 assert.match(src,/ucvm:sessions-updated/);
});

test('faculty dashboard has a linked self-profile mode that does not subscribe to the faculty index',()=>{
 const src=read('faculty-admin.js');
 assert.match(src,/function isSelfServiceProfile\(p\)\{return \['faculty','hicc','visc'\]\.includes\(String\(p\?\.role\|\|''\)\.toLowerCase\(\)\)\}/);
 assert.match(src,/async function loadSelfFaculty\(facultyId\)/);
 assert.match(src,/db\.collection\(COLLECTION\)\.doc\(String\(facultyId\)\)\.get\(\)/);
 assert.match(src,/listenFacultySessions\(facultyId\)/);
 assert.match(src,/if\(isSelfServiceProfile\(p\)\)\{await enterSelfMode\(user,p\);return\}/);
 assert.match(src,/if\(UCVM\.admin\(p\)\)\{enterAdminMode\(user,p\);return\}/);
 const start=src.indexOf('async function enterSelfMode(user,p)');
 const end=src.indexOf('\nfunction enterAdminMode',start);
 assert.ok(start>=0&&end>start,'enterSelfMode must exist');
 const body=src.slice(start,end);
 assert.doesNotMatch(body,/subscribeFaculty\(/);
 assert.doesNotMatch(body,/subscribeSessions\(/);
 assert.doesNotMatch(body,/faculty_index/);
});

test('faculty self mode is full-width and removes admin navigation and editing',()=>{
 const src=read('faculty-admin.js');
 assert.match(src,/document\.body\.classList\.add\('faculty-self-mode'\)/);
 assert.match(src,/const editButton=selfMode\?'':/);
 assert.match(src,/body\.faculty-self-mode \.tabs/);
 assert.match(src,/body\.faculty-self-mode \.kpis/);
 assert.match(src,/body\.faculty-self-mode #lookup-view > \.toolbar/);
 assert.match(src,/body\.faculty-self-mode \.result-pane/);
 assert.match(src,/body\.faculty-self-mode \.lookup-grid\{display:block/);
});

test('faculty record rules use the linked facultyId for get and keep list admin-only',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/function ownFacultyId\(id\)\{return facultyMember\(\) && profile\(\)\.facultyId is string && profile\(\)\.facultyId == id;\}/);
 assert.match(rules,/match \/faculty\/\{id\} \{\s*allow get: if admin\(\) \|\| ownFacultyId\(id\);\s*allow list: if admin\(\);/s);
});

test('admin-only enhancements keep their data subscription behind the administrator check',()=>{
 const src=read('faculty-admin-enhancements.js');
 const start=src.indexOf('const startFromPage=()=>');
 assert.ok(start>=0,'admin enhancement gate must exist');
 const body=src.slice(start,start+500);
 assert.match(body,/UCVM\.admin\(sharedProfile\)/);
 assert.match(body,/subscribe\(\)/);
});
