'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEngine}=require('../frontend/scripts/multi-year-demo-model.js');
const source={
 faculty:[
  {facultyId:'f1',displayName:'Lee, Avery',active:true,contractTeachingDoe:40},
  {facultyId:'f2',displayName:'Hart, Morgan',active:false,contractTeachingDoe:30},
  {facultyId:'f3',displayName:'Young, Sam',active:true,contractTeachingDoe:35}
 ],
 users:[{firebaseUid:'owner',baseRole:'owner'},{firebaseUid:'adfa',baseRole:'adfa_general'},
        {firebaseUid:'lead',baseRole:'hicc',facultyId:'f1'},
        {firebaseUid:'fac1',baseRole:'faculty',facultyId:'f1'},
        {firebaseUid:'fac3',baseRole:'faculty',facultyId:'f3'}],
 courses:[{courseCode:'VTMD 306',courseName:'Clinical Skills',curriculumYear:2},{courseCode:'VTMD 304',courseName:'Anatomy',curriculumYear:2}],
 sessions:[
  {id:'s1',academicYear:'2026-27',courseCode:'VTMD 306',date:'2026-09-01',topic:'Skills One',sessionType:'LAB',startTime:'08:00',endTime:'10:00',room:'VLC',assignments:[{facultyId:'f1',teachingRole:'Lab lead',doeCredit:3},{facultyId:'f2',teachingRole:'Lab support',doeCredit:2}]},
  {id:'s2',academicYear:'2026-27',courseCode:'VTMD 306',date:'2026-09-02',topic:'Skills Two',sessionType:'LAB',startTime:'08:00',endTime:'10:00',room:'VLC',assignments:[{facultyId:'f1',teachingRole:'Instructor',doeCredit:2}]}],
 roles:[{roleAssignmentId:'r1',facultyId:'f1',roleType:'HICC',courseOrSubjectOrRotation:'VTMD 306: Clinical Skills',effectiveDate:'2026-05-01',expirationDate:'2027-04-30'}],
 afcRecords:[{afcRecordId:'a1',facultyId:'f1',startDate:'2026-09-01',endDate:'2026-09-01',active:true}],
 targets:[{facultyId:'f1',academicYear:'2026-27',effectiveTargetDoe:6,overrideDoe:7}]
};
const owner={uid:'owner',role:'owner'};
const adfa={uid:'adfa',role:'adfa_general'};
const lead={uid:'lead',role:'hicc',facultyId:'f1'};
const faculty1={uid:'fac1',role:'faculty',facultyId:'f1'};
const faculty3={uid:'fac3',role:'faculty',facultyId:'f3'};
const build=()=>createEngine({source,now:()=>new Date('2026-10-29T12:00:00Z')});
const req=(options={})=>({fromYear:'2026-27',toYear:'2027-28',code:'VTMD 306',options});

test('selective rollover defaults to one Catalog course while the new year starts empty',()=>{
 const m=build();m.createYear(owner,'2027-28');assert.deepEqual(m.getState().annual['2027-28'],{});
 const preview=m.previewRollover(adfa,req());assert.equal(preview.sourceReleaseVersion,1);
 assert.equal(preview.sessionCount,2);assert.deepEqual(m.getState().annual['2027-28'],{});
 const course=m.rolloverCourse(adfa,req());assert.equal(course.title,'Clinical Skills');
 assert.equal(course.working.length,0);assert.equal(course.published.length,0);
 assert.equal(course.finalizedRevision,0);assert.equal(m.getState().doe['2027-28'].policy.status,'draft');
 assert.deepEqual(m.getState().doe['2027-28'].overrides,{});
 assert.throws(()=>m.rolloverCourse(adfa,req()),/already exists|overwrite/i);
});

test('copying session topics without schedule creates unscheduled Working-only sessions',()=>{
 const m=build();m.createYear(owner,'2027-28');
 const c=m.rolloverCourse(adfa,req({sessions:true}));
 assert.equal(c.working.length,2);
 assert.ok(c.working.every(s=>s.date===''&&s.startTime===''&&s.room===''&&s.assignments.length===0));
 assert.notEqual(c.working[0].id,'s1');
 const preview=m.previewPublication(adfa,'2027-28','VTMD 306');
 assert.ok(preview.issues.some(x=>x.code==='UNSCHEDULED_SESSION'&&x.severity==='block'));
 m.finalizeCourse(adfa,'2027-28','VTMD 306');
 assert.throws(()=>m.publishCourse(lead,'2027-28','VTMD 306'),/unscheduled|date|validation/i);
});

test('selective rollover copies last Published sessions and shifts dates only when requested',()=>{
 const m=build();m.createYear(owner,'2027-28');
 const p=m.previewRollover(adfa,req({sessions:true,schedule:true,instructors:true}));
 assert.equal(p.excludedInstructors,1);
 const c=m.rolloverCourse(adfa,req({sessions:true,schedule:true,instructors:true}));
 assert.equal(c.working[0].date,'2027-09-01');
 assert.equal(c.working[0].room,'VLC');
 assert.equal(c.working[0].assignments.length,1);
 assert.equal(c.working[0].assignments[0].facultyId,'f1');
 assert.equal(c.working[0].assignments[0].doeCredit,3);
 assert.equal(m.getTeaching(faculty1,'2027-28').length,0);
 assert.equal(m.getDoe(faculty1,'2027-28').status,'pending');
});

test('rollover rejects option dependencies, wrong year, missing scope and archived target',()=>{
 const m=build();m.createYear(owner,'2027-28');
 assert.throws(()=>m.rolloverCourse(adfa,req({instructors:true})),/session/i);
 assert.throws(()=>m.rolloverCourse(adfa,req({schedule:true})),/session/i);
 assert.throws(()=>m.previewRollover(faculty1,req()),/permission/i);
 assert.throws(()=>m.rolloverCourse(adfa,{...req(),fromYear:'2027-28'}),/previous|source/i);
 m.retireYear(owner,'2027-28',true);
 assert.throws(()=>m.rolloverCourse(adfa,req()),/archived|read.only/i);
});

test('published-only rollover cannot use unpublished previous Working changes',()=>{
 const m=build();m.createYear(owner,'2027-28');
 m.addSession(adfa,'2026-27','VTMD 306',{date:'2026-10-01',topic:'Not Published'});
 const c=m.rolloverCourse(adfa,req({sessions:true}));
 assert.equal(c.working.length,2);
 assert.ok(c.working.every(s=>s.topic!=='Not Published'));
});

test('publication review compares added assignments and DOE deltas without changing Published data',()=>{
 const m=build();m.createYear(owner,'2027-28');
 m.rolloverCourse(adfa,req({sessions:true,schedule:true,instructors:true}));
 const initial=m.previewPublication(adfa,'2027-28','VTMD 306');
 assert.ok(initial.issues.some(x=>x.code==='NOT_FINALIZED'));
 assert.equal(initial.diff.added,2);
 assert.equal(m.getTeaching(faculty1,'2027-28').length,0);
 m.finalizeCourse(adfa,'2027-28','VTMD 306');
 const ready=m.previewPublication(lead,'2027-28','VTMD 306');
 assert.equal(ready.canPublish,true);
 assert.equal(ready.doeImpact.find(x=>x.facultyId==='f1').delta,5);
 m.publishCourse(lead,'2027-28','VTMD 306');
 const after=m.previewPublication(lead,'2027-28','VTMD 306');
 assert.equal(after.canPublish,false);
 assert.ok(after.issues.some(x=>x.code==='NO_CHANGES'));
});

test('AFC conflict warns but unassigned/invalid sessions are explicitly flagged',()=>{
 const m=build();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 306');
 m.addSession(adfa,'2027-28','VTMD 306',{id:'conflict',date:'2027-09-01',topic:'Lecture',sessionType:'LEC',startTime:'08:00',endTime:'09:00',room:'101',assignments:[{facultyId:'f1',doeCredit:2}]});
 m.addAfc(adfa,{afcRecordId:'a2',facultyId:'f1',startDate:'2027-09-01',endDate:'2027-09-01',active:true});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');
 const p=m.previewPublication(adfa,'2027-28','VTMD 306');
 assert.ok(p.issues.some(x=>x.code==='AFC_CONFLICT'&&x.severity==='warn'));
 assert.equal(p.canPublish,true);
});

test('year phase is role-gated and independent of Course-level release',()=>{
 const m=build();m.createYear(owner,'2027-28');
 assert.throws(()=>m.setYearPhase(faculty1,'2027-28','review'),/permission|approval/i);
 assert.equal(m.setYearPhase(adfa,'2027-28','review').status,'review');
 assert.equal(m.setYearPhase(owner,'2027-28','active').status,'active');
 m.retireYear(owner,'2027-28',true);
 assert.throws(()=>m.setYearPhase(adfa,'2027-28','planning'),/archived|read.only/i);
});

test('cross-year comparison respects Published-only data and self-only faculty DOE',()=>{
 const m=build();m.createYear(owner,'2027-28');
 m.rolloverCourse(adfa,req({sessions:true,schedule:true,instructors:true}));
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 const comparison=m.compareYears(faculty1,'2026-27','2027-28');
 assert.equal(comparison.rows.length,1);
 assert.equal(comparison.rows[0].facultyId,'f1');
 assert.equal(comparison.rows[0].left.teachingSessions,2);
 assert.equal(comparison.rows[0].right.teachingSessions,2);
 assert.equal(comparison.rows[0].right.doeStatus,'pending');
 const staff=m.compareYears(adfa,'2026-27','2027-28');
 assert.equal(staff.rows.length,3);
 assert.equal(staff.rows.find(r=>r.facultyId==='f1').left.doe,7);
 const another=m.compareYears(faculty3,'2026-27','2027-28');
 assert.equal(another.rows.length,1);assert.equal(another.rows[0].facultyId,'f3');
});

test('validation blocks publication with ineligible instructors',()=>{
 const m=build();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 306');
 m.addSession(adfa,'2027-28','VTMD 306',{date:'2027-09-01',topic:'Lab',assignments:[{facultyId:'f2',doeCredit:2}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');
 assert.ok(m.previewPublication(adfa,'2027-28','VTMD 306').issues.some(x=>x.code==='INACTIVE_FACULTY'&&x.severity==='block'));
 assert.throws(()=>m.publishCourse(lead,'2027-28','VTMD 306'),/validation/i);
});

test('publication validation flags same-year overlaps with another annual Course',()=>{
 const m=build();m.createYear(owner,'2027-28');
 m.addCourse(adfa,'2027-28','VTMD 306');m.addCourse(adfa,'2027-28','VTMD 304');
 m.addSession(adfa,'2027-28','VTMD 306',{id:'cross-a',date:'2027-09-15',topic:'Lab',startTime:'09:00',endTime:'11:00',room:'Lab 101',assignments:[{facultyId:'f1',doeCredit:2}]});
 m.addSession(adfa,'2027-28','VTMD 304',{id:'cross-b',date:'2027-09-15',topic:'Anatomy',startTime:'10:00',endTime:'12:00',room:'Lab 101',assignments:[{facultyId:'f1',doeCredit:2}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');
 const result=m.previewPublication(adfa,'2027-28','VTMD 306');
 assert.ok(result.issues.some(x=>x.code==='ROOM_CONFLICT'&&/VTMD 304/.test(x.message)));
 assert.ok(result.issues.some(x=>x.code==='INSTRUCTOR_CONFLICT'&&/VTMD 304/.test(x.message)));
 assert.equal(result.canPublish,true);
});
