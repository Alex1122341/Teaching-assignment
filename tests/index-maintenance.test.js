const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('maintenance helpers replace and remove sessions without losing faculty IDs',()=>{
 const api=require(path.join(root,'index-maintenance.js'));
 const next={id:'s2',assignments:[{ucid:'1002'},{facultyId:'1001'}]};
 const replaced=api.replaceSession([{id:'s1'},{id:'s2',assignments:[]}],next);
 assert.deepEqual(replaced.find(x=>x.id==='s2').facultyIds,['1001','1002']);
 assert.deepEqual(api.removeSession(replaced,'s1').map(x=>x.id),['s2']);
});

test('session writes add derived faculty IDs',()=>{
 const index=read('timetable.js'),admin=read('faculty-admin.js'),approval=read('approval-workflow.js');
 assert.match(index,/UCVM_INDEX_MAINTENANCE\.sessionForWrite\(s\)/);
 assert.match(admin,/UCVM_INDEX_MAINTENANCE\.sessionForWrite\(rec\)/);
 assert.match(approval,/patch\.facultyIds=UCVM_DATA_INDEX\.sessionFacultyIds/);
});

test('session and faculty mutations refresh derived settings',()=>{
 const index=read('timetable.js'),admin=read('faculty-admin.js'),maintenance=read('index-maintenance.js');
 assert.match(index,/refreshDerivedIndexes/);
 assert.match(admin,/writeDerivedIndexes/);
 assert.match(maintenance,/faculty_index/);
 assert.match(maintenance,/schedule_stats/);
});

test('derived settings writes are limited to administrators',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/id in \['faculty_index','schedule_stats'\].*admin\(\)/s);
});
