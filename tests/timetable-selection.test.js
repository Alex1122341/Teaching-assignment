'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function load(){
 const context={window:{},Date};
 vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context);
 return context.window.UCVM_TIMETABLE_SELECTION;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const baseSession={id:'s1',date:'2026-10-07',year:1,course:'204',type:'LEC',start:'08:30',end:'09:30',topic:'Passports',room:'A101',assignments:[{ucid:'1001',name:'Alex Faculty',role:'Lecture'}],facultyIds:['1001']};

test('selection module requires the canonical scheduling core',()=>{
 const context={window:{},Date};
 assert.throws(()=>vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context),/scheduling core/i);
});

test('selection persists by session id, toggles, clears, and enforces 200 limit',()=>{
 const selection=load().create(200);
 for(let i=1;i<=200;i++)assert.equal(selection.toggle(`s${i}`),true);
 assert.equal(selection.size,200);
 assert.equal(selection.has('s42'),true);
 assert.throws(()=>selection.toggle('s201'),/200/);
 assert.equal(selection.toggle('s42'),false);
 assert.equal(selection.has('s42'),false);
 assert.deepEqual(plain(selection.ids()).slice(0,2),['s1','s2']);
 selection.clear();assert.equal(selection.size,0);
});

test('row validation reports exact row and field failures',()=>{
 const api=load(),faculty=new Map([['1001',{__id:'1001',preferredFullName:'Alex Faculty'}]]);
 assert.deepEqual(plain(api.validateRow(baseSession,1,faculty)),[]);
 const invalid={...baseSession,date:'2026-02-30',year:5,course:' ',type:'',start:'10:00',end:'09:00',facultyIds:['missing'],assignments:[]};
 const errors=plain(api.validateRow(invalid,4,faculty));
 for(const text of ['Row 4: date','Row 4: year','Row 4: course','Row 4: type','Row 4: end time','Row 4: assigned faculty'])assert.ok(errors.some(error=>error.toLowerCase().includes(text.toLowerCase())),text);
});

test('row validation delegates timing to the core and preserves unknown-time sessions',()=>{
 const api=load(),faculty=new Map([['1001',true]]);
 assert.deepEqual(plain(api.validateRow({...baseSession,start:'10:00',end:'11:00'},1,faculty)),[]);
 assert.ok(api.validateRow({...baseSession,start:'10:00',end:'10:00'},1,faculty).some(error=>/end time/i.test(error)));
 assert.ok(api.validateRow({...baseSession,start:'11:00',end:'10:00'},1,faculty).some(error=>/end time/i.test(error)));
 assert.deepEqual(plain(api.validateRow({...baseSession,start:'',end:'',timeUnknown:true},1,faculty)),[]);
});

test('change planner suppresses unchanged rows and pairs each update with one audit log',()=>{
 const api=load(),actor={uid:'admin-1',email:'admin@ucalgary.ca',name:'Admin User'},timestamp={server:true};
 assert.equal(api.planChanges([baseSession],[plain(baseSession)],actor,timestamp).updates.length,0);
 const edited={...plain(baseSession),topic:'Updated topic',room:'B202',assignments:[{facultyId:'1002',name:'Blair Faculty',role:'Lecture'}],facultyIds:['1002']};
 const plan=plain(api.planChanges([baseSession],[edited],actor,timestamp));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates.length,1);assert.equal(plan.logs.length,1);
 assert.equal(plan.updates[0].id,'s1');
 assert.deepEqual(plan.updates[0].data.facultyIds,['1002']);
 assert.equal(plan.logs[0].sessionId,'s1');
 assert.equal(plan.logs[0].action,'batch_update');
 assert.equal(plan.logs[0].changedBy,'admin-1');
 assert.equal(plan.logs[0].before.topic,'Passports');
 assert.equal(plan.logs[0].after.topic,'Updated topic');
 assert.deepEqual(plan.logs[0].changes.map(change=>change.field),['topic','room','assignments']);
 assert.deepEqual(plan.logs[0].changes.find(change=>change.field==='topic'),{field:'topic',label:'Topic',before:'Passports',after:'Updated topic'});
 assert.deepEqual(plan.logs[0].changes.find(change=>change.field==='assignments'),{field:'assignments',label:'Faculty',before:['Alex Faculty'],after:['Blair Faculty']});
});

test('batch selection restores the view that was active when selection began',()=>{
 const flow=load().createViewFlow();
 assert.equal(flow.begin('week'),'week');
 assert.equal(flow.review(),'list');
 assert.equal(flow.finish(),'week');
 assert.equal(flow.begin('month'),'month');
 assert.equal(flow.finish(),'month');
});

test('change planner returns errors without update or audit entries',()=>{
 const api=load(),bad={...plain(baseSession),id:'s1',start:'11:00',end:'10:00'};
 const plan=plain(api.planChanges([baseSession],[bad],{uid:'u'},123));
 assert.ok(plan.errors.some(error=>error.includes('Row 1')));
 assert.equal(plan.updates.length,0);assert.equal(plan.logs.length,0);
});

test('selected rows ignore normal filters, preserve selection order, and exclude CCC records',()=>{
 const api=load(),selection=api.create();selection.toggle('future-hidden');selection.toggle('visible');selection.toggle('ccc-row');
 const rows=api.selectedRows([{id:'visible'},{id:'ccc-row',isCcc:true},{id:'future-hidden'}],selection.ids());
 assert.deepEqual(plain(rows.map(row=>row.id)),['future-hidden','visible']);
});

test('atomic save performs two paired operations per changed session and none for invalid plans',async()=>{
 const api=load(),operations=[],batch={update:(ref,data)=>operations.push(['update',ref,data]),set:(ref,data)=>operations.push(['set',ref,data]),commit:async()=>operations.push(['commit'])};
 let afterCommit=0;
 const store={batch:()=>batch,sessionRef:id=>`sessions/${id}`,logRef:()=>`logs/${operations.length}`,afterCommit:async()=>{afterCommit++}};
 const invalid=await api.commitPlan({updates:[],logs:[],errors:['Row 1: invalid']},store);
 assert.equal(invalid.committed,false);assert.equal(operations.length,0);
 const plan={errors:[],updates:[],logs:[]};for(let i=0;i<200;i++){plan.updates.push({id:`s${i}`,data:{topic:`T${i}`}});plan.logs.push({sessionId:`s${i}`,action:'batch_update'})}
 const result=await api.commitPlan(plan,store);
 assert.equal(result.committed,true);assert.equal(result.operations,400);assert.equal(operations.filter(x=>x[0]==='update').length,200);assert.equal(operations.filter(x=>x[0]==='set').length,200);assert.equal(operations.at(-1)[0],'commit');assert.equal(afterCommit,1);
});
