'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEngine,STORAGE_KEY}=require('../frontend/scripts/multi-year-demo-model.js');

const source={
 faculty:[
  {facultyId:'demo-f1',displayName:'Demo Avery',active:true,appointmentValid:true},
  {facultyId:'demo-f2',displayName:'Demo Rowan',active:true,appointmentValid:true},
  {facultyId:'demo-f3',displayName:'Demo Mira',active:true,appointmentValid:true},
  {facultyId:'demo-f4',displayName:'Demo Selin',active:true,appointmentValid:true},
  {facultyId:'demo-inactive',displayName:'Demo Retired',active:false}
 ],
 users:[{firebaseUid:'demo-owner',baseRole:'owner'},{firebaseUid:'demo-adfa',baseRole:'adfa_general'},
   {firebaseUid:'demo-fac1',baseRole:'faculty',facultyId:'demo-f1'}],
 courses:[{courseCode:'VTMD 200',courseName:'Course A'},{courseCode:'VTMD 304',courseName:'Course B'},
   {courseCode:'VTMD 422',courseName:'Course C'},{courseCode:'VTMD 306',courseName:'Course D'}],
 sessions:[{id:'older',academicYear:'2026-27',courseCode:'VTMD 200',date:'2026-09-01',
   topic:'Earlier',assignments:[{facultyId:'demo-f1',doeCredit:3}]}]
};
const owner={uid:'demo-owner',role:'owner'};
const adfa={uid:'demo-adfa',role:'adfa_general'};
const faculty={uid:'demo-fac1',role:'faculty',facultyId:'demo-f1'};
const storage=()=>{
 const map=new Map();return{getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
};
const make=(options={})=>createEngine({source,now:()=>new Date('2026-11-01T12:00:00Z'),...options});

test('fresh Testing Demo preloads a distinct 2027-28 sample while retaining original 2026-27 records',()=>{
 const m=make({sampleYear2027:true});
 const state=m.getState(),courses=state.annual['2027-28'];
 assert.equal(state.years['2027-28'].status,'planning');
 assert.deepEqual(Object.keys(courses),['VTMD 200','VTMD 304','VTMD 422']);
 assert.equal(state.annual['2026-27']['VTMD 200'].working[0].id,'older');
 assert.equal(state.annual['2026-27']['VTMD 200'].published[0].sessions[0].date,'2026-09-01');
 assert.equal(Object.values(courses).reduce((sum,c)=>sum+c.working.length,0),9);
 assert.equal(Object.values(courses).reduce((sum,c)=>sum+(c.published.at(-1)?.sessions.length||0),0),5);
 assert.equal(m.getCalendar(adfa,'2027-28').length,9);
 assert.equal(m.getTeaching(adfa,'2027-28').length,5);
 assert.equal(m.getTeaching(faculty,'2027-28').length,2);
 assert.equal(m.getDoe(faculty,'2027-28').status,'pending');
 assert.ok(m.getWorkingDoe(adfa,'2027-28').some(r=>r.base>0));
 assert.equal(m.getConflicts(adfa,'2027-28').length,1);
 assert.equal(state.audit.at(-1).event,'synthetic_2027_28_sample_loaded');
 assert.ok(Object.values(courses).every(c=>c.sampleFixture===true));
});
test('fixture supports Published, pending changes and Draft-only review states',()=>{
 const m=make({sampleYear2027:true}),s=m.getState();
 const a=s.annual['2027-28']['VTMD 200'];
 const b=s.annual['2027-28']['VTMD 304'];
 const c=s.annual['2027-28']['VTMD 422'];
 assert.equal(a.published.length,1);
 assert.equal(a.revision,a.finalizedRevision);
 assert.equal(b.published.length,1);
 assert.equal(b.revision,2);
 assert.equal(b.finalizedRevision,1);
 assert.equal(b.published[0].sessions.length,2);
 assert.equal(b.working.length,3);
 assert.equal(c.published.length,0);
 assert.equal(c.finalizedRevision,0);
 const review=m.previewPublication(adfa,'2027-28','VTMD 304');
 assert.ok(review.issues.some(x=>x.code==='NOT_FINALIZED'));
 assert.equal(review.diff.added,1);
 assert.ok(review.diff.assignmentChanges>=1);
 assert.equal(review.canPublish,false);
 m.finalizeCourse(adfa,'2027-28','VTMD 304');
 assert.equal(m.previewPublication(adfa,'2027-28','VTMD 304').canPublish,true);
});
test('manual sample import works only for Owner into an empty academic year',()=>{
 const m=make();m.createYear(owner,'2027-28');
 assert.deepEqual(m.getState().annual['2027-28'],{});
 assert.throws(()=>m.seed2027Sample(adfa),/Owner only/);
 assert.equal(m.seed2027Sample(owner).courses,3);
 assert.throws(()=>m.seed2027Sample(owner),/will not overwrite/);
 const before=m.getState();
 assert.equal(before.annual['2026-27']['VTMD 200'].working.length,1);
});
test('existing local 2027-28 edits are preserved after site update and sample cannot replace them',()=>{
 const local=storage();
 const original=make({storage:local});
 original.createYear(owner,'2027-28');
 original.addCourse(adfa,'2027-28','VTMD 306');
 const later=make({storage:local,sampleYear2027:true});
 assert.deepEqual(Object.keys(later.getState().annual['2027-28']),['VTMD 306']);
 assert.throws(()=>later.seed2027Sample(owner),/will not overwrite/);
 assert.equal(later.getState().annual['2027-28']['VTMD 306'].working.length,0);
});
test('existing empty 2027-28 year remains untouched until Owner chooses to load sample',()=>{
 const local=storage();
 make({storage:local}).createYear(owner,'2027-28');
 const later=make({storage:local,sampleYear2027:true});
 assert.deepEqual(later.getState().annual['2027-28'],{});
 assert.equal(later.seed2027Sample(owner).workingSessions,9);
 assert.equal(JSON.parse(local.getItem(STORAGE_KEY)).annual['2027-28']['VTMD 200'].working.length,3);
});
test('reopening a seeded Testing browser does not double-import sample data or reset edits',()=>{
 const local=storage();
 const first=make({storage:local,sampleYear2027:true});
 first.addSession(adfa,'2027-28','VTMD 422',{date:'2028-03-02',topic:'Added by tester'});
 const before=first.getState();
 const later=make({storage:local,sampleYear2027:true});
 assert.equal(later.getState().annual['2027-28']['VTMD 422'].working.length,4);
 assert.equal(later.getState().audit.length,before.audit.length);
 assert.equal(later.getState().annual['2026-27']['VTMD 200'].working.length,1);
});
test('demo reset restores the 2027-28 sample and erases only local multi-year edits',()=>{
 const m=make({sampleYear2027:true});
 m.addSession(adfa,'2027-28','VTMD 422',{date:'2028-03-02',topic:'Only local change'});
 assert.equal(m.getState().annual['2027-28']['VTMD 422'].working.length,4);
 m.reset();
 assert.equal(m.getState().annual['2027-28']['VTMD 422'].working.length,3);
 assert.equal(m.getState().annual['2026-27']['VTMD 200'].working.length,1);
});
