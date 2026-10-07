'use strict';
// ---------------------------------------------------------------------------
// Merged domain test file.
//
// This file was assembled from several small single-purpose test files in the
// same domain. No assertion was changed: each source body is preserved verbatim
// inside its own IIFE so top-level declarations from different files cannot
// collide, and the total number of tests is unchanged.
//
// Split it back out by taking each block below to its own file if a failure ever
// needs a narrower blast radius.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------------------
// merged from tests/audit-details.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(){
 const context={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','audit-details.js'),'utf8'),context);
 return context.window.UCVM_AUDIT_DETAILS;
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('legacy batch logs recover concrete field changes from before and after snapshots',()=>{
 const details=load();
 const entry={action:'batch_update',before:{date:'2026-09-17',topic:'Old',room:'A1',assignments:[{name:'Alex'}],facultyIds:['1'],instructor:'Alex'},after:{date:'2026-09-18',topic:'New',room:'B2',assignments:[{name:'Blair'}],facultyIds:['2'],instructor:'Blair'}};
 assert.deepEqual(plain(details.changes(entry)),[
  {field:'date',label:'Date',before:'2026-09-17',after:'2026-09-18'},
  {field:'topic',label:'Topic',before:'Old',after:'New'},
  {field:'room',label:'Room',before:'A1',after:'B2'},
  {field:'assignments',label:'Faculty',before:['Alex'],after:['Blair']}
 ]);
});

test('change groups show three details until expanded',()=>{
 const details=load(),changes=[1,2,3,4,5].map(value=>({field:String(value)}));
 assert.deepEqual(plain(details.group(changes,false)),{visible:[{field:'1'},{field:'2'},{field:'3'}],remaining:2});
 assert.deepEqual(plain(details.group(changes,true)),{visible:changes,remaining:0});
});

test('session audit diff records changed fields and normalized faculty names',()=>{
 const details=load(),before={date:'2026-09-17',course:'204',topic:'Old',assignments:[{ucid:'1',name:'Alex'}]},after={...before,topic:'New',assignments:[{ucid:'2',name:'Blair'}]};
 assert.deepEqual(plain(details.diff(before,after,'session')), [
  {field:'topic',label:'Topic',before:'Old',after:'New'},
  {field:'assignments',label:'Faculty',before:['Alex'],after:['Blair']}
 ]);
});

test('faculty audit diff supports create and delete without logging empty fields',()=>{
 const details=load(),faculty={ucid:'100',preferredFullName:'Doe, Jane',email:'jane@example.ca',office:''};
 assert.deepEqual(plain(details.diff(null,faculty,'faculty')), [
  {field:'ucid',label:'UCID',before:null,after:'100'},
  {field:'preferredFullName',label:'Preferred name',before:null,after:'Doe, Jane'},
  {field:'email',label:'Email',before:null,after:'jane@example.ca'}
 ]);
 assert.deepEqual(plain(details.diff(faculty,null,'faculty')), [
  {field:'ucid',label:'UCID',before:'100',after:null},
  {field:'preferredFullName',label:'Preferred name',before:'Doe, Jane',after:null},
  {field:'email',label:'Email',before:'jane@example.ca',after:null}
 ]);
});
})();

// ------------------------------------------------------------------------
// merged from tests/audit-r02-adfa-edit-integrity.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));

function loadSelection(){
 const context={window:{},Date};
 vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
 // Field ownership is derived from the canonical modules, so the harness must load them.
 vm.runInNewContext(fs.readFileSync(path.join(root,'office-capabilities.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'session-workflow.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context);
 return context.window.UCVM_TIMETABLE_SELECTION;
}

const original={
 id:'s1',date:'2026-10-07',week:6,semester:'fall',year:1,
 course:'204',courseName:'Foundations I',type:'LEC',start:'08:30',end:'09:30',timeUnknown:false,
 topic:'Passports',room:'A101',
 assignments:[{ucid:'1001',facultyId:'1001',name:'Alex Faculty',role:'Lecture'}],
 facultyIds:['1001'],instructor:'Alex Faculty',labDetails:[]
};
const actor={uid:'admin-1',email:'admin@ucalgary.ca',name:'Admin User',role:'administrator'};
const faculty=new Map([
 ['1001',{__id:'1001',preferredFullName:'Alex Faculty'}],
 ['1002',{__id:'1002',preferredFullName:'Blair Faculty'}]
]);

test('R02 partial source write contract does not invent an empty facultyIds field',()=>{
 const maintenance=require('../index-maintenance.js');
 assert.equal(typeof maintenance.sessionPatchForWrite,'function');
 assert.deepEqual(plain(maintenance.sessionPatchForWrite({room:'B202'})),{room:'B202'});
 assert.deepEqual(plain(maintenance.sessionPatchForWrite({assignments:[{facultyId:'1002'}]})),{
  assignments:[{facultyId:'1002'}],facultyIds:['1002']
 });
});

test('R02 ADFA is faculty-only and cannot change a scheduling field',()=>{
 const api=loadSelection();
 const edited={...plain(original),room:'B202'};
 const plan=plain(api.planChanges([original],[edited],actor,123,faculty,{role:'administrator'}));
 assert.deepEqual(plan.updates,[]);
 assert.ok(plan.errors.some(error=>/ADFA cannot change room/i.test(error)),JSON.stringify(plan.errors));
});

test('R02 ADFA faculty-only edit carries the private assignment fields into the source patch',()=>{
 const api=loadSelection();
 const assignments=[{ucid:'1002',facultyId:'1002',name:'Blair Faculty',role:'Lecture'}];
 const edited={...plain(original),assignments,facultyIds:['1002'],instructor:'Blair Faculty'};
 const plan=plain(api.planChanges([original],[edited],actor,123,faculty,{role:'administrator'}));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates.length,1);
 assert.deepEqual(plan.updates[0].data.assignments,assignments);
 assert.deepEqual(plan.updates[0].data.facultyIds,['1002']);
 assert.equal(plan.updates[0].data.instructor,'Blair Faculty');
 assert.equal(Object.hasOwn(plan.updates[0].data,'labDetails'),false);
 assert.deepEqual(plan.logs[0].changes.map(change=>change.field),['assignments']);
 assert.deepEqual(plan.logs[0].relatedFacultyIds,['1001','1002']);
});

test('R02 ADFA is faculty-only and cannot change date or course',()=>{
 const api=loadSelection();
 const edited={...plain(original),date:'2027-01-11',week:1,semester:'winter',course:'305',courseName:'Clinical Skills II'};
 const plan=plain(api.planChanges([original],[edited],actor,123,faculty,{role:'administrator'}));
 assert.deepEqual(plan.updates,[]);
 const refusal=plan.errors.find(error=>/ADFA cannot change/i.test(error));
 assert.ok(refusal,JSON.stringify(plan.errors));
 assert.match(refusal,/date/);
 assert.match(refusal,/course/);
});

test('R02 multi-session save uses the partial-write serializer instead of the full-session serializer',()=>{
 const js=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
 const start=js.indexOf('async function saveSelectedChanges');
 const end=js.indexOf('\n  function openSessionDetail',start);
 const fn=js.slice(start,end);
 assert.match(fn,/firestoreSafeSessionPatch\(update\.data\)/);
 assert.doesNotMatch(fn,/firestoreSafeSession\(update\.data\)/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/audit-r03-calendar-health.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));

function load(){
 const window={};
 vm.runInNewContext(fs.readFileSync(path.join(root,'calendar-session.js'),'utf8'),{window});
 vm.runInNewContext(fs.readFileSync(path.join(root,'calendar-session-maintenance.js'),'utf8'),{window});
 return window.UCVM_CALENDAR_SESSION_MAINTENANCE;
}

const sourceData={course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructor:'Jane Smith'};
const cleanData={sessionId:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructorNames:['Jane Smith'],instructor:'Jane Smith'};

function fakeDb({source=sourceData,calendar=cleanData}={}){
 const state={
  sessions:new Map(source===null?[]:[['s1',structuredClone(source)]]),
  calendar_sessions:new Map(calendar===null?[]:[['s1',structuredClone(calendar)]])
 };
 const docRef=(collection,id)=>({collection,id});
 return {
  state,
  collection(name){
   return {
    async get(){
     return {docs:[...state[name].entries()].map(([id,data])=>({id,data:()=>structuredClone(data)}))};
    },
    doc(id){return docRef(name,String(id));}
   };
  },
  async runTransaction(fn){
   const tx={
    async get(ref){const data=state[ref.collection].get(ref.id);return {exists:data!==undefined,data:()=>structuredClone(data)};},
    set(ref,data){state[ref.collection].set(ref.id,structuredClone(data));},
    delete(ref){state[ref.collection].delete(ref.id);}
   };
   return fn(tx);
  }
 };
}

test('R03 verify treats Firestore document ids as metadata, not calendar payload fields',async()=>{
 const report=await load().verify(fakeDb());
 assert.deepEqual(plain({ok:report.ok,mismatchCount:report.mismatchCount,mismatches:report.mismatches}),{ok:true,mismatchCount:0,mismatches:[]});
});

test('R03 verify still rejects a stored id field inside calendar data',async()=>{
 const report=await load().verify(fakeDb({calendar:{...cleanData,id:'should-not-be-stored'}}));
 assert.equal(report.ok,false);
 assert.deepEqual(plain(report.mismatches[0]),{id:'s1',kind:'private_field',field:'id'});
});

test('R03 repair returns healthy after replacing a contaminated calendar document',async()=>{
 const db=fakeDb({calendar:{...cleanData,facultyIds:['private-faculty-id']}});
 const before=await load().verify(db);
 assert.equal(before.ok,false);
 assert.equal(before.mismatches[0].kind,'private_field');
 const after=await load().repair(db,before,{uid:'owner-1'});
 assert.deepEqual(plain({ok:after.ok,mismatchCount:after.mismatchCount,mismatches:after.mismatches}),{ok:true,mismatchCount:0,mismatches:[]});
 assert.deepEqual(db.state.calendar_sessions.get('s1'),cleanData);
});
})();

// ------------------------------------------------------------------------
// merged from tests/audit-r04-mixed-request.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function loadRequestApi(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'approval-routing.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'approval-request.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_REQUEST;
}

function loadFinalizer(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'calendar-session.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'approval-finalizer.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_FINALIZER;
}

function source(){
  return {
    id:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,
    date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',
    instructor:'Jane Smith; Alex Faculty',facultyIds:['1001','1002'],
    assignments:[{ucid:'1001',name:'Jane Smith',doeCredit:1.25},{ucid:'1002',name:'Alex Faculty',doeCredit:1}]
  };
}

test('R04 mixed Faculty swap preserves Date and LAB Topic in one routed request',()=>{
  const api=loadRequestApi();
  const records=api.buildRecords({
    requestId:'r-r04',
    requester:{uid:'u1',name:'Faculty One',role:'faculty'},
    now:'STAMP',
    payload:{
      requestType:'faculty_swap',
      sessionId:'s1',
      base:source(),
      patch:{date:'2027-03-23',topic:'Advanced suturing'},
      assignmentIndex:0,
      fromFaculty:{facultyId:'1001',name:'Jane Smith'},
      toFaculty:{candidateKey:'opaque-k2',name:'Dr. New'},
      reason:'Coverage and schedule update'
    }
  });

  assert.equal(records.publicRecord.patchPublic.date,'2027-03-23');
  assert.equal(records.publicRecord.patchPublic.topic,'Advanced suturing');
  assert.equal(records.publicRecord.patchPublic.instructor,'Dr. New');
  assert.deepEqual(Array.from(records.workflow.requiredOffices),['adc','lab','adfa']);
  assert.deepEqual(Array.from(records.workflow.scopes.adc),['date']);
  assert.deepEqual(Array.from(records.workflow.scopes.lab),['topic']);
  assert.deepEqual(Array.from(records.workflow.scopes.adfa),['assignments','instructor']);
  assert.ok(records.privateRecord);
});

test('R04 final Faculty apply combines approved public edits with the assignment change atomically',()=>{
  const api=loadFinalizer();
  const current=source();
  const request={
    id:'r-r04',
    sessionId:'s1',
    basePublic:{
      course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,
      date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',
      instructor:'Jane Smith; Alex Faculty'
    },
    patchPublic:{date:'2027-03-23',topic:'Advanced suturing',instructor:'Dr. New'},
    currentFacultyName:'Jane Smith',
    proposedFacultyName:'Dr. New'
  };
  const privateRecord={assignmentChange:{assignmentIndex:0,from:{facultyId:'1001'},to:{candidateKey:'opaque-k2'}}};

  const plan=api.planFacultySwap({
    request,
    source:current,
    privateRecord,
    resolved:{facultyId:'1003',name:'Dr. New',kind:'faculty'}
  });

  assert.equal(plan.sourcePatch.date,'2027-03-23');
  assert.equal(plan.sourcePatch.topic,'Advanced suturing');
  assert.equal(plan.sourcePatch.assignments[0].ucid,'1003');
  assert.equal(plan.sourcePatch.assignments[1].ucid,'1002');
  assert.deepEqual(Array.from(plan.sourcePatch.facultyIds),['1003','1002']);
  assert.equal(plan.sourcePatch.instructor,'Dr. New; Alex Faculty');
  assert.equal(plan.calendar.date,'2027-03-23');
  assert.equal(plan.calendar.topic,'Advanced suturing');
  assert.equal(plan.calendar.instructor,'Dr. New; Alex Faculty');
  assert.deepEqual(new Set(plan.changedFields),new Set(['date','topic','assignments','facultyIds','instructor']));
});
})();

// ------------------------------------------------------------------------
// merged from tests/audit-r05-approval-timing.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function context(files){
  const ctx={window:{}};
  vm.createContext(ctx);
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
  return ctx.window;
}

function base(){
  return {
    course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,
    date:'2027-03-22',start:'09:00',end:'10:00',timeUnknown:false,
    type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',instructor:'Dr Old'
  };
}

test('R05 scheduling core identifies an invalid timing patch while leaving unrelated edits unchanged',()=>{
  const w=context(['scheduling-core.js']);
  const invalid=w.UCVM_SCHEDULING.validateSessionTimingChange(base(),{start:'11:00',end:'10:00'});
  assert.equal(invalid.status,'invalid');
  assert.equal(invalid.reason,'end_not_after_start');
  assert.deepEqual(Array.from(invalid.changedFields),['start']);

  const unchanged=w.UCVM_SCHEDULING.validateSessionTimingChange(
    {...base(),start:'11:00',end:'10:00'},
    {topic:'Advanced suturing'}
  );
  assert.equal(unchanged.status,'unchanged');
});

test('R05 initial routed request rejects a newly introduced reversed interval',()=>{
  const w=context(['scheduling-core.js','approval-routing.js','approval-request.js']);
  assert.throws(()=>w.UCVM_APPROVAL_REQUEST.buildRecords({
    requestId:'r1',requester:{uid:'u1',name:'Faculty One',role:'hicc'},now:'STAMP',
    payload:{requestType:'session_edit',sessionId:'s1',base:base(),patch:{start:'11:00',end:'10:00'}}
  }),/invalid session timing/i);
});

test('R05 requester resubmission rejects an invalid returned timing edit',()=>{
  const w=context(['scheduling-core.js','approval-routing.js','approval-state.js','approval-lifecycle.js']);
  const request={
    id:'r2',requestType:'session_edit',status:'update_required',revision:1,
    editableFields:['start','end'],basePublic:base(),patchPublic:{start:'09:30',end:'10:30'}
  };
  assert.throws(()=>w.UCVM_APPROVAL_LIFECYCLE.planRequesterResubmission({
    request,publicEdits:{start:'11:00',end:'10:00'},now:'NOW'
  }),/invalid session timing/i);
});

test('R05 public finalizer refuses a reversed interval instead of producing a write plan',()=>{
  const w=context(['scheduling-core.js','calendar-session.js','approval-finalizer.js']);
  const request={
    id:'r3',sessionId:'s1',basePublic:base(),
    patchPublic:{start:'11:00',end:'10:00'}
  };
  const calendar={sessionId:'s1',...base(),instructorNames:['Dr Old']};
  assert.throws(()=>w.UCVM_APPROVAL_FINALIZER.planPublicApply({request,calendar}),/invalid session timing/i);
});

test('R05 mixed Faculty finalizer also refuses invalid public timing before applying assignment data',()=>{
  const w=context(['scheduling-core.js','calendar-session.js','approval-finalizer.js']);
  const source={
    id:'s1',...base(),
    assignments:[{ucid:'f1',name:'Dr Old'},{ucid:'f9',name:'Dr Other'}],
    facultyIds:['f1','f9'],instructor:'Dr Old; Dr Other'
  };
  const request={
    id:'r4',sessionId:'s1',
    basePublic:{...base(),instructor:'Dr Old; Dr Other'},
    patchPublic:{start:'11:00',end:'10:00',instructor:'Dr New'},
    currentFacultyName:'Dr Old',proposedFacultyName:'Dr New'
  };
  const privateRecord={assignmentChange:{assignmentIndex:0,from:{facultyId:'f1'},to:{candidateKey:'opaque'}}};
  assert.throws(()=>w.UCVM_APPROVAL_FINALIZER.planFacultySwap({
    request,source,privateRecord,resolved:{facultyId:'f2',name:'Dr New',kind:'faculty'}
  }),/invalid session timing/i);
});

test('R05 timeUnknown remains valid for approval paths without inventing times',()=>{
  const w=context(['scheduling-core.js','approval-routing.js','approval-request.js']);
  const records=w.UCVM_APPROVAL_REQUEST.buildRecords({
    requestId:'r5',requester:{uid:'u1',name:'Faculty One',role:'hicc'},now:'STAMP',
    payload:{requestType:'session_edit',sessionId:'s1',base:base(),patch:{start:'',end:'',timeUnknown:true}}
  });
  assert.equal(records.publicRecord.patchPublic.timeUnknown,true);
  assert.equal(records.publicRecord.patchPublic.start,'');
  assert.equal(records.publicRecord.patchPublic.end,'');
});
})();
