'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const load=()=>{const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'faculty-assignment.js'),'utf8'),ctx);return ctx.window.UCVM_FACULTY_ASSIGNMENT;};
const arr=value=>Array.from(value||[]);
const plain=value=>JSON.parse(JSON.stringify(value));

const drA={facultyId:'f-a',ucid:'f-a',name:'Dr A',role:'Lecture'};
const drB={facultyId:'f-b',ucid:'f-b',name:'Dr B',role:'Lecture'};
const drC={facultyId:'f-c',ucid:'f-c',name:'Dr C',role:'Lab Support'};
const session=extra=>({id:'s1',type:'LEC',topic:'Neuro',assignments:[],...extra});

test('adding two Faculty members keeps both in assignments',()=>{
 const api=load();
 const first=api.addFaculty(session(),drA);
 assert.equal(first.added,true);
 const second=api.addFaculty(first.session,drB);
 assert.equal(second.added,true);
 assert.equal(second.session.assignments.length,2);
 assert.deepEqual(plain(second.session.facultyIds),['f-a','f-b']);
 assert.equal(second.session.instructor,'Dr A; Dr B');
});

test('the same Faculty member cannot be added twice',()=>{
 const api=load();
 const once=api.addFaculty(session(),drA);
 const twice=api.addFaculty(once.session,{...drA,name:'Dr A (duplicate)'});
 assert.equal(twice.added,false);
 assert.equal(twice.reason,'duplicate_faculty');
 assert.equal(twice.session.assignments.length,1);
 // The same person under a different display name is still the same person.
 const renamed=api.addFaculty(once.session,{facultyId:'f-a',ucid:'f-a',name:'A. Different'});
 assert.equal(renamed.added,false);
});

test('a Faculty entry without an id is refused',()=>{
 const api=load();
 const result=api.addFaculty(session(),{name:'Nobody'});
 assert.equal(result.added,false);
 assert.equal(result.reason,'missing_faculty_id');
});

test('removing one Faculty member retains the remaining assignment',()=>{
 const api=load();
 let current=session();
 for(const person of [drA,drB,drC])current=api.addFaculty(current,person).session;
 assert.equal(current.assignments.length,3);
 const removed=api.removeFaculty(current,'f-b');
 assert.equal(removed.removed,true);
 assert.deepEqual(plain(removed.session.assignments).map(row=>row.facultyId),['f-a','f-c']);
 assert.deepEqual(plain(removed.session.facultyIds),['f-a','f-c']);
 assert.equal(removed.session.instructor,'Dr A; Dr C');
 const missing=api.removeFaculty(removed.session,'f-zzz');
 assert.equal(missing.removed,false);
 assert.equal(missing.reason,'not_assigned');
});

test('derived fields are recomputed from assignments, never edited directly',()=>{
 const api=load();
 const synced=api.syncSession({id:'s1',assignments:[drA,drB],facultyIds:['stale'],instructor:'Stale Name'});
 assert.deepEqual(plain(synced.facultyIds),['f-a','f-b']);
 assert.equal(synced.instructor,'Dr A; Dr B');
 assert.equal(api.instructorLine([drA,drB]),'Dr A; Dr B');
 assert.deepEqual(arr(api.facultyIds([drA,drA,drB])),['f-a','f-b']);
});

test('a multi-Faculty change is never collapsed to the first name in the audit',()=>{
 const api=load();
 const before=api.syncSession(session(),[drA,drB]);
 const after=api.syncSession(session(),[drA,drC]);
 const changes=plain(api.facultyChanges(before,after));
 const summary=changes.find(row=>row.field==='assignments');
 assert.deepEqual(summary.before,['Dr A','Dr B']);
 assert.deepEqual(summary.after,['Dr A','Dr C']);
 assert.equal(changes.find(row=>row.field==='facultyAdded').after[0],'Dr C');
 assert.equal(changes.find(row=>row.field==='facultyRemoved').before[0],'Dr B');
 assert.equal(api.describeFacultyChange(before,after),'Dr A; Dr B → Dr A; Dr C');
});

test('an unchanged Faculty list produces no audit record',()=>{
 const api=load();
 const before=api.syncSession(session(),[drA,drB]);
 const after=api.syncSession(session(),[drA,drB]);
 assert.deepEqual(plain(api.facultyChanges(before,after)),[]);
 assert.equal(api.describeFacultyChange(before,after),'');
});

test('conflict and availability checks see every assigned Faculty member',()=>{
 const api=load();
 const current=api.syncSession(session(),[drA,drB]);
 assert.deepEqual(arr(api.assignedFacultyKeys(current)),['f-a','f-b']);
 assert.deepEqual(arr(api.assignmentNames(current.assignments)),['Dr A','Dr B']);
});

test('a session with no assignment reports an empty, consistent state',()=>{
 const api=load();
 const empty=api.syncSession(session(),[]);
 assert.deepEqual(plain(empty.assignments),[]);
 assert.deepEqual(plain(empty.facultyIds),[]);
 assert.equal(empty.instructor,'');
 assert.equal(api.describeFacultyChange(session(),empty),'');
 assert.equal(api.instructorLine([]),'');
});
