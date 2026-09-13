const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

const modulePath=path.resolve(__dirname,'../data-index.js');

test('faculty index keeps list, search, DOE and override information',()=>{
 const api=require(modulePath);
 const faculty={__id:'1001',preferredFullName:'Alpha, Alex',hrFullName:'Alpha, Alexandra',rank:'Professor',campus:'Foothills',primaryDepartment:'Clinical Sciences',teachingArea:'Cardiology',reportsTo:'Department Head',doe:{teaching:40},doeOverride2026_27:{value:25,reason:'RSL'},facultySummary2026_27:{roles:[{type:'HICC',assignment:'VMED 501'}]}};
 const entry=api.facultyEntry('1001',faculty,{count:7,assignedDOE:2.1});
 assert.equal(entry.id,'1001');
 assert.equal(entry.name,'Alpha, Alex');
 assert.equal(entry.rank,'Professor');
 assert.equal(entry.contractTeachingDOE,40);
 assert.equal(entry.overrideDOE,25);
 assert.equal(entry.overrideReason,'RSL');
 assert.equal(entry.sessionCount,7);
 for(const term of ['alpha','alexandra','cardiology','clinical sciences','hicc','vmed 501'])assert.match(entry.searchText,new RegExp(term));
});

test('session faculty IDs are unique, normalized and stable',()=>{
 const api=require(modulePath);
 const ids=api.sessionFacultyIds({facultyIds:['1002'],assignments:[{ucid:'1001'},{facultyId:'1002'},{ucid:'1001'},{name:'No ID'}]});
 assert.deepEqual(ids,['1001','1002']);
});

test('faculty index and schedule statistics derive assignment counts',()=>{
 const api=require(modulePath);
 const faculty=[{__id:'1002',preferredFullName:'Beta'},{__id:'1001',preferredFullName:'Alpha',doe:{teaching:35}}];
 const sessions=[
  {id:'s1',course:'501',date:'2026-09-01',assignments:[{ucid:'1001',doeCredit:.3},{ucid:'1002',doeCredit:.2}]},
  {id:'s2',course:'501',date:'2026-09-02',assignments:[{ucid:'1001',doeCredit:.4}]},
  {id:'s3',course:'502',date:'2026-09-03',assignments:[]}
 ];
 const index=api.buildFacultyIndex(faculty,sessions);
 assert.deepEqual(index.entries.map(x=>x.id),['1001','1002']);
 assert.deepEqual(index.entries.map(x=>x.sessionCount),[2,1]);
 assert.deepEqual(index.entries.map(x=>x.assignedTeachingDOE),[.7,.2]);
 const stats=api.scheduleStats(sessions);
 assert.equal(stats.sessionCount,3);
 assert.equal(stats.assignedFacultyCount,2);
 assert.deepEqual(stats.courseCounts,{501:2,502:1});
});

test('index functions tolerate missing optional data',()=>{
 const api=require(modulePath);
 assert.deepEqual(api.sessionFacultyIds(null),[]);
 const entry=api.facultyEntry('x',{},{});
 assert.equal(entry.id,'x');
 assert.equal(entry.name,'x');
 assert.equal(entry.contractTeachingDOE,null);
 assert.equal(entry.overrideDOE,null);
});
