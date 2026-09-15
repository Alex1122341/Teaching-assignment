const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('faculty, HICC, and VISC can open Faculty Dashboard from the timetable',()=>{
 const src=read('timetable.js');
 assert.match(src,/\$\('faculty-dashboard-btn'\)\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*if\s*\(UCVM\.admin\(currentUser\)\s*\|\|\s*roleIsFaculty\(currentUser\)\)\s*window\.location\.href\s*=\s*'faculty-admin\.html'/);
 assert.match(src,/\$\('faculty-dashboard-btn'\)\.classList\.toggle\('hidden',\s*!\(UCVM\.admin\(currentUser\)\s*\|\|\s*roleIsFaculty\(currentUser\)\)\)/);
});

test('faculty dashboard has a linked self-profile mode that does not subscribe to the faculty index',()=>{
 const src=read('faculty-admin.js');
 assert.match(src,/function isSelfServiceProfile\(p\)\{return \['faculty','hicc','visc'\]\.includes\(String\(p\?\.role\|\|''\)\.toLowerCase\(\)\)\}/);
 assert.match(src,/async function loadSelfFaculty\(facultyId\)/);
 assert.match(src,/db\.collection\(COLLECTION\)\.doc\(String\(facultyId\)\)\.get\(\)/);
 assert.match(src,/listenFacultySessions\(facultyId\)/);
 assert.match(src,/if\(isSelfServiceProfile\(p\)\)\{await enterSelfMode\(user,p\);return\}/);
 assert.match(src,/if\(UCVM\.admin\(p\)\)\{enterAdminMode\(user,p\);return\}/);
});

test('faculty self mode is full-width and removes admin navigation and editing',()=>{
 const js=read('faculty-admin.js'),css=read('faculty-admin.css');
 assert.match(js,/document\.body\.classList\.add\('faculty-self-mode'\)/);
 assert.match(js,/const editButton=selfMode\?'':/);
 assert.match(css,/body\.faculty-self-mode \.tabs/);
 assert.match(css,/body\.faculty-self-mode \.kpis/);
 assert.match(css,/body\.faculty-self-mode #lookup-view > \.toolbar/);
 assert.match(css,/body\.faculty-self-mode \.result-pane/);
 assert.match(css,/body\.faculty-self-mode \.lookup-grid\{display:block/);
});

test('faculty record rules use the linked facultyId for get and keep list admin-only',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/function ownFacultyId\(id\)\{return facultyMember\(\) && profile\(\)\.facultyId is string && profile\(\)\.facultyId == id;\}/);
 assert.match(rules,/match \/faculty\/\{id\} \{\s*allow get: if admin\(\) \|\| ownFacultyId\(id\);\s*allow list: if admin\(\);/s);
});

test('admin-only dashboard enhancements start only after an administrator profile is confirmed',()=>{
 const src=read('faculty-admin-enhancements.js');
 assert.doesNotMatch(src,/installStyles\(\);watchDom\(\);/);
 assert.match(src,/const startFromPage=\(\)=>\{[^}]*UCVM\.admin\(sharedProfile\)[\s\S]*watchDom\(\)/);
});
