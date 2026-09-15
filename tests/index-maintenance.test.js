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

test('session mutations update derived settings from exact before and after records',()=>{
 const index=read('timetable.js'),approval=read('approval-workflow.js'),admin=read('faculty-admin.js'),maintenance=read('index-maintenance.js');
 assert.match(index,/UCVM_INDEX_MAINTENANCE\.updateDerivedIndexes\(db,changes/);
 assert.match(index,/\{before:existing\|\|null,after:next\}/);
 assert.match(index,/\{before:s,after:null\}/);
 assert.match(approval,/updateDerivedIndexes\?\.\(\[\{before:current,after/);
 assert.match(admin,/writeDerivedIndexes/);
 assert.match(maintenance,/faculty_index/);
 assert.match(maintenance,/schedule_stats/);
});

test('derived settings writes are limited to administrators',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/id in \['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map'\].*admin\(\)/s);
});

test('session deltas update totals, courses, faculty counts, and assigned DOE',()=>{
 const api=require(path.join(root,'index-maintenance.js'));
 const facultyIndex={entries:[
  {id:'1001',name:'Alex',sessionCount:1,assignedTeachingDOE:5},
  {id:'1002',name:'Blair',sessionCount:0,assignedTeachingDOE:10}
 ]};
 const stats={sessionCount:1,assignedFacultyCount:1,courseCounts:{200:1}};
 const before={id:'s1',course:'200',assignments:[{ucid:'1001',doeCredit:5}]};
 const after={id:'s1',course:'204',assignments:[{ucid:'1002',doeCredit:2.5}]};
 const result=api.applySessionChanges(facultyIndex,stats,[{before,after}]);
 assert.deepEqual(result.scheduleStats,{sessionCount:1,assignedFacultyCount:1,courseCounts:{204:1}});
 assert.deepEqual(result.facultyIndex.entries,[
  {id:'1001',name:'Alex',sessionCount:0,assignedTeachingDOE:0},
  {id:'1002',name:'Blair',sessionCount:1,assignedTeachingDOE:12.5}
 ]);
 assert.deepEqual(facultyIndex.entries[0],{id:'1001',name:'Alex',sessionCount:1,assignedTeachingDOE:5});
});

test('create and delete session deltas are reversible and empty changes are idempotent',()=>{
 const api=require(path.join(root,'index-maintenance.js'));
 const index={entries:[{id:'1001',sessionCount:0,assignedTeachingDOE:7}]},stats={sessionCount:0,assignedFacultyCount:0,courseCounts:{}};
 const session={id:'s1',course:'300',assignments:[{facultyId:'1001',doeCredit:1.25}]};
 const added=api.applySessionChanges(index,stats,[{before:null,after:session}]);
 assert.deepEqual(added.scheduleStats,{sessionCount:1,assignedFacultyCount:1,courseCounts:{300:1}});
 assert.deepEqual(added.facultyIndex.entries,[{id:'1001',sessionCount:1,assignedTeachingDOE:8.25}]);
 const removed=api.applySessionChanges(added.facultyIndex,added.scheduleStats,[{before:session,after:null}]);
 assert.deepEqual(removed,{facultyIndex:index,scheduleStats:stats});
 assert.deepEqual(api.applySessionChanges(index,stats,[]),{facultyIndex:index,scheduleStats:stats});
});
