'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEngine}=require('../frontend/scripts/multi-year-demo-model.js');
const source={
  academicYear:'2026-27',
  faculty:[{facultyId:'f1',displayName:'Avery Lee',active:true,contractTeachingDoe:40},{facultyId:'f2',displayName:'Morgan Hart',active:true,contractTeachingDoe:30}],
  users:[{firebaseUid:'owner1',baseRole:'owner',displayName:'Demo Owner'},{firebaseUid:'adfa1',baseRole:'adfa_general',displayName:'Demo ADFAD'},{firebaseUid:'hicc1',baseRole:'hicc',facultyId:'f1',displayName:'Demo Lead'},{firebaseUid:'faculty1',baseRole:'faculty',facultyId:'f1',displayName:'Demo Faculty'},{firebaseUid:'other1',baseRole:'faculty',facultyId:'f2',displayName:'Another Faculty'}],
  courses:[{courseCode:'VTMD 306',courseName:'Clinical Skills',curriculumYear:2},{courseCode:'VTMD 304',courseName:'Anatomy',curriculumYear:2}],
  sessions:[{id:'s1',academicYear:'2026-27',courseCode:'VTMD 306',courseName:'Clinical Skills',date:'2026-09-01',topic:'Lab 1',sessionType:'LAB',startTime:'08:00',endTime:'10:00',room:'VLC',assignments:[{facultyId:'f1',teachingRole:'Lab Primary',doeCredit:3}]}],
  roles:[{roleAssignmentId:'r1',academicYear:'2026-27',facultyId:'f1',roleType:'HICC',courseOrSubjectOrRotation:'VTMD 306: Clinical Skills',effectiveDate:'2026-05-01',expirationDate:'2027-04-30'},{roleAssignmentId:'r2',academicYear:'2026-27',facultyId:'f2',roleType:'VISC',courseOrSubjectOrRotation:'Anatomy',effectiveDate:'2026-08-01',expirationDate:'2027-04-30'}],
  afcRecords:[{afcRecordId:'a1',facultyId:'f1',startDate:'2026-09-02',endDate:'2026-09-03',active:true}],
  targets:[{facultyId:'f1',academicYear:'2026-27',effectiveTargetDoe:12,overrideDoe:11}]
};
const owner={uid:'owner1',role:'owner'};
const adfa={uid:'adfa1',role:'adfa_general'};
const lead={uid:'hicc1',role:'hicc',facultyId:'f1'};
const faculty={uid:'faculty1',role:'faculty',facultyId:'f1'};
const other={uid:'other1',role:'faculty',facultyId:'f2'};
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
const engine=(storage=memory())=>createEngine({source,storage,now:()=>new Date('2026-10-29T18:00:00Z')});
test('initial 2026-27 Published teaching and DOE remain Faculty visible',()=>{
 const m=engine(); const t=m.getTeaching(faculty,'2026-27');
 assert.equal(t.length,1);assert.equal(t[0].assignments[0].facultyId,'f1');
 assert.equal(m.getDoe(faculty,'2026-27').status,'published');
 assert.equal(m.getDoe(faculty,'2026-27').items[0].effective,11);
 assert.equal(m.getTeaching(other,'2026-27').length,0);
});
test('create 2027-28 leaves annual courses empty and copies policy as Draft',()=>{
 const m=engine();m.createYear(owner,'2027-28');const s=m.getState();
 assert.equal(s.years['2027-28'].status,'planning');
 assert.deepEqual(s.annual['2027-28'],{});
 assert.equal(s.doe['2027-28'].policy.status,'draft');
 assert.equal(s.roles['2027-28'].find(r=>r.sourceId==='r1').status,'confirmed');
 assert.equal(s.roles['2027-28'].find(r=>r.sourceId==='r2').status,'draft');
 assert.throws(()=>m.createYear(owner,'2027-28'),/already exists/i);
});
test('new annual Course snapshots Catalog title and does not populate sessions',()=>{
 const m=engine();m.createYear(owner,'2027-28');
 m.addCourse(adfa,'2027-28','VTMD 306');
 m.updateCatalog(owner,'VTMD 306','Clinical Skills II');
 assert.equal(m.getState().annual['2027-28']['VTMD 306'].title,'Clinical Skills');
 assert.equal(m.getState().catalog.find(c=>c.code==='VTMD 306').title,'Clinical Skills II');
 assert.equal(m.getState().annual['2027-28']['VTMD 306'].working.length,0);
});
test('a scoped Course publisher must wait for finalization and cannot publish unrelated Course',()=>{
 const m=engine();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 306');
 m.addSession(adfa,'2027-28','VTMD 306',{id:'s2',date:'2027-09-01',topic:'Lab 1',sessionType:'LAB',startTime:'08:00',endTime:'10:00',assignments:[{facultyId:'f1',doeCredit:4}]});
 assert.throws(()=>m.publishCourse(lead,'2027-28','VTMD 306'),/finaliz/i);
 m.finalizeCourse(adfa,'2027-28','VTMD 306');
 const result=m.publishCourse(lead,'2027-28','VTMD 306');
 assert.equal(result.version,1);
 assert.equal(m.getTeaching(faculty,'2027-28').length,1);
 m.addCourse(adfa,'2027-28','VTMD 304');m.finalizeCourse(adfa,'2027-28','VTMD 304');
 assert.throws(()=>m.publishCourse(lead,'2027-28','VTMD 304'),/publisher|scope|permission/i);
});
test('Working edits remain private until next Course publication',()=>{
 const m=engine();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 306');
 m.addSession(adfa,'2027-28','VTMD 306',{id:'s2',date:'2027-09-01',topic:'Lab 1',assignments:[{facultyId:'f1',doeCredit:4}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 m.editAssignment(adfa,'2027-28','VTMD 306','s2','f2');
 assert.equal(m.getTeaching(faculty,'2027-28').length,1);
 assert.equal(m.getTeaching(other,'2027-28').length,0);
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 assert.equal(m.getTeaching(faculty,'2027-28').length,0);
 assert.equal(m.getTeaching(other,'2027-28').length,1);
});
test('initial DOE Pending, approved policy release, automatic sync with override retained',()=>{
 const m=engine();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 306');
 m.addSession(adfa,'2027-28','VTMD 306',{id:'s2',date:'2027-09-01',topic:'Lab 1',assignments:[{facultyId:'f1',doeCredit:4}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 assert.equal(m.getDoe(faculty,'2027-28').status,'pending');
 m.approvePolicy(adfa,'2027-28');m.publishDoe(adfa,'2027-28');
 assert.equal(m.getDoe(faculty,'2027-28').items[0].base,4);
 m.setOverride(adfa,'2027-28','f1',8);
 m.addSession(adfa,'2027-28','VTMD 306',{id:'s3',date:'2027-09-02',topic:'Lab 2',assignments:[{facultyId:'f1',doeCredit:3}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 const d=m.getDoe(faculty,'2027-28').items[0];
 assert.equal(d.effective,8);assert.equal(d.needsReview,true);
});
test('Owner Retire preserves draft, historical teaching/DOE, and freezes conflicts',()=>{
 const m=engine();const old=m.getState().annual['2026-27']['VTMD 306'].published.length;
 m.editAssignment(adfa,'2026-27','VTMD 306','s1','f2');
 m.retireYear(owner,'2026-27',true);
 assert.equal(m.getState().annual['2026-27']['VTMD 306'].published.length,old);
 assert.equal(m.getTeaching(faculty,'2026-27').length,1);
 assert.throws(()=>m.getCalendar(faculty,'2026-27'),/calendar|archived/i);
 assert.equal(m.getCalendar(adfa,'2026-27').length,1);
 assert.throws(()=>m.addCourse(adfa,'2026-27','VTMD 304'),/archived/i);
 const snap=JSON.stringify(m.getState().archives[0].conflicts);
 m.addAfc(adfa,{afcRecordId:'a2',facultyId:'f2',startDate:'2026-09-01',endDate:'2026-09-01',active:true});
 assert.equal(JSON.stringify(m.getState().archives[0].conflicts),snap);
 assert.throws(()=>m.restoreYear(adfa,'2026-27'),/owner/i);
 m.restoreYear(owner,'2026-27');
 assert.equal(m.getConflicts(adfa,'2026-27').length>0,true);
 assert.equal(JSON.stringify(m.getState().archives[0].conflicts),snap);
});
test('storage reload preserves publication and user-specific default year',()=>{
 const storage=memory();const a=engine(storage);a.createYear(owner,'2027-28');
 a.setPreferredYear(adfa,'2027-28');
 const b=engine(storage);
 assert.equal(b.getPreferredYear(adfa),'2027-28');
 assert.equal(b.getPreferredYear(faculty),'2026-27');
 assert.equal(Object.keys(b.getState().years).length,2);
});
test('other scoped HICC cannot edit VTMD 304, and retirement requires confirmation',()=>{
 const m=engine();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 304');
 assert.throws(()=>m.addSession(lead,'2027-28','VTMD 304',{id:'rogue',date:'2027-09-01'}),/scope|permission/i);
 assert.throws(()=>m.retireYear(owner,'2026-27'),/confirm/i);
});
test('working-session conflict checker responds to shared AFC, not only published state',()=>{
 const m=engine();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 306');
 m.addSession(adfa,'2027-28','VTMD 306',{id:'s9',date:'2027-09-01',topic:'Lab 2',assignments:[{facultyId:'f1',doeCredit:2}]});
 assert.equal(m.getConflicts(adfa,'2027-28').length,0);
 m.addAfc(adfa,{afcRecordId:'a3',facultyId:'f1',startDate:'2027-09-01',endDate:'2027-09-01',active:true});
 assert.equal(m.getConflicts(adfa,'2027-28').length,1);
});

test('DOE override review remains pending until ADFAD explicitly confirms',()=>{
 const m=engine();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 306');
 m.addSession(adfa,'2027-28','VTMD 306',{id:'review-s1',date:'2027-09-01',topic:'A',assignments:[{facultyId:'f1',doeCredit:4}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 m.approvePolicy(adfa,'2027-28');m.publishDoe(adfa,'2027-28');m.setOverride(adfa,'2027-28','f1',9);
 m.addSession(adfa,'2027-28','VTMD 306',{id:'review-s2',date:'2027-09-02',topic:'B',assignments:[{facultyId:'f1',doeCredit:3}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 assert.equal(m.getDoe(faculty,'2027-28').items[0].needsReview,true);
 m.addSession(adfa,'2027-28','VTMD 306',{id:'review-s3',date:'2027-09-03',topic:'C',assignments:[{facultyId:'f2',doeCredit:2}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 assert.equal(m.getDoe(faculty,'2027-28').items[0].needsReview,true);
});
test('publishing unchanged Working revision is rejected without duplicate release',()=>{
 const m=engine();const before=m.getState().annual['2026-27']['VTMD 306'].published.length;
 assert.throws(()=>m.publishCourse(adfa,'2026-27','VTMD 306'),/no changes|already published/i);
 assert.equal(m.getState().annual['2026-27']['VTMD 306'].published.length,before);
});

test('Faculty Calendar shows all Published sessions but no private DOE details',()=>{
 const m=engine();m.createYear(owner,'2027-28');m.addCourse(adfa,'2027-28','VTMD 306');
 m.addSession(adfa,'2027-28','VTMD 306',{id:'public-s1',date:'2027-09-01',topic:'Public Lab',sessionType:'LAB',assignments:[{facultyId:'f2',doeCredit:6}]});
 m.finalizeCourse(adfa,'2027-28','VTMD 306');m.publishCourse(lead,'2027-28','VTMD 306');
 const rows=m.getCalendar(faculty,'2027-28');
 assert.equal(rows.length,1);
 assert.equal(rows[0].instructorNames,'Morgan Hart');
 assert.equal(Object.hasOwn(rows[0],'assignments'),false);
 assert.doesNotMatch(JSON.stringify(rows),/doeCredit|facultyId/);
 assert.equal(m.getTeaching(faculty,'2027-28').length,0);
});
test('ADC Calendar projection omits private DOE credits',()=>{
 const m=engine();const adc={uid:'adc1',role:'adc'};
 const rows=m.getCalendar(adc,'2026-27');
 assert.ok(rows.length>0);
 assert.doesNotMatch(JSON.stringify(rows),/doeCredit/);
});

test('ordinary office roles cannot read private Published DOE or teaching credit',()=>{
 const m=engine();const adc={uid:'adc1',role:'adc'};
 assert.throws(()=>m.getDoe(adc,'2026-27'),/DOE.*denied|permission/i);
 const teaching=m.getTeaching(adc,'2026-27');
 assert.equal(teaching.length,1);
 assert.doesNotMatch(JSON.stringify(teaching),/doeCredit/);
});
test('unsupported office role receives no year data by default',()=>{
 const m=engine();const unknown={uid:'u1',role:'other_office'};
 assert.throws(()=>m.getCalendar(unknown,'2026-27'),/unsupported|permission/i);
 assert.throws(()=>m.getTeaching(unknown,'2026-27'),/unsupported|permission/i);
 assert.throws(()=>m.getDoe(unknown,'2026-27'),/unsupported|permission/i);
});

test('full-year Role with invalid next-year Faculty appointment becomes Draft',()=>{
 const data=structuredClone(source);
 data.faculty[1].active=true;data.faculty[1].appointmentValid=false;
 data.roles.push({roleAssignmentId:'r3',academicYear:'2026-27',facultyId:'f2',roleType:'HICC',courseOrSubjectOrRotation:'VTMD 304: Anatomy',effectiveDate:'2026-05-01',expirationDate:'2027-04-30'});
 const m=createEngine({source:data,storage:memory(),now:()=>new Date('2026-10-29T18:00:00Z')});
 m.createYear(owner,'2027-28');
 const r=m.getState().roles['2027-28'].find(x=>x.sourceId==='r3');
 assert.equal(r.status,'draft');
 assert.match(r.rolloverReason,/appointment/i);
});
test('legacy annual Role displayed dates never extend beyond April 30',()=>{
 const data=structuredClone(source);data.roles.push({roleAssignmentId:'r4',academicYear:'2026-27',facultyId:'f1',roleType:'HICC',courseOrSubjectOrRotation:'VTMD 304',effectiveDate:'2026-07-01',expirationDate:'2027-06-30'});
 const m=createEngine({source:data,storage:memory()});const roles=m.getState().roles['2026-27'];
 assert.equal(roles.find(r=>r.id==='r4').end,'2027-04-30');
});
