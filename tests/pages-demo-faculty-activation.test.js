'use strict';
// Synthetic Frontend Demo acceptance: future Faculty, lifecycle and assignments.
// No live SQL, Firestore, real accounts, or production source records are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../tools/pages-demo-api/store.js');
const { createDemoRuntime } = require('../tools/pages-demo-api/runtime.js');
const { createSessionRepository } = require('../tools/pages-demo-api/repos/core.js');
const { createTeachingAssignmentRepository } = require('../tools/pages-demo-api/repos/ta.js');
const { createFacultyAdminRepository } = require('../tools/pages-demo-api/repos/admin-write.js');

const START = '2027-06-01';
const today = '2026-11-01T12:00:00.000Z';
function setup() {
  let instant = today;
  const store = createStore({now:()=>new Date(instant)});
  const admin = store.tables.users.find(u => u.baseRole === 'developer' || u.baseRole === 'owner' || u.baseRole === 'adfa_general');
  const ordinary = store.tables.users.find(u => u.baseRole === 'faculty' || u.baseRole === 'hicc');
  assert.ok(admin, 'Synthetic administrator exists');
  assert.ok(ordinary, 'Synthetic faculty identity exists');
  return {store, admin, ordinary, route:createDemoRuntime(store), setNow:next=>{ instant=next; }};
}
async function send(s, who, route, method='GET', body) {
  const init = {method,headers:{authorization:'Bearer demo-token-'+who.firebaseUid}};
  if (body !== undefined) { init.headers['content-type']='application/json'; init.body=JSON.stringify(body); }
  return s.route(new Request('https://pages-demo.invalid'+route,init));
}
function newFaculty(s, input={}) {
  const base = s.store.tables.faculty.find(f => f.active && f.profile && f.ucid);
  assert.ok(base);
  const profile = {...base.profile};
  delete profile.profileVersion;
  return {
    preferredFirstName:'Future',preferredLastName:'Hire',displayName:'Future Hire',
    ucid:'PREHIRE-2027-001',email:'future.hire@example.test',recordType:'faculty',
    stream:'Clinical',rank:'Assistant Professor',fte:1,reportsToFacultyId:null,
    activationDate:START, professionalProfile:profile, ...input
  };
}
async function create(s, input={}) {
  const r = await send(s,s.admin,'/api/v1/dashboard/faculty','POST',newFaculty(s,input));
  assert.equal(r.status,201,JSON.stringify(r.jsonBody));
  assert.ok(r.jsonBody.faculty?.facultyId);
  return r.jsonBody.faculty;
}

test('a permitted admin creates a future Faculty record that stays Pending Start and cannot be duplicated',async()=>{
  const s=setup(); const row=await create(s);
  assert.equal(row.activationDate,START);
  assert.equal(row.administrativeActive,true);
  assert.equal(row.active,false);
  const pending=await send(s,s.admin,'/api/v1/dashboard/faculty?status=pending');
  assert.equal(pending.status,200);
  assert.equal(pending.jsonBody.faculty.some(f=>f.facultyId===row.facultyId),true);
  const inactive=await send(s,s.admin,'/api/v1/dashboard/faculty?status=inactive');
  assert.equal(inactive.jsonBody.faculty.some(f=>f.facultyId===row.facultyId),false);
  const active=await send(s,s.admin,'/api/v1/dashboard/faculty?status=active');
  assert.equal(active.jsonBody.faculty.some(f=>f.facultyId===row.facultyId),false);
  const duplicate=await send(s,s.admin,'/api/v1/dashboard/faculty','POST',newFaculty(s,{email:'FUTURE.HIRE@example.test'}));
  assert.equal(duplicate.status,409);
  assert.equal(s.store.tables.faculty.filter(f=>f.ucid==='PREHIRE-2027-001').length,1);
});

test('faculty and HICC cannot create Faculty or read the complete Pending roster',async()=>{
  const s=setup();
  const created=await send(s,s.ordinary,'/api/v1/dashboard/faculty','POST',newFaculty(s));
  assert.equal(created.status,403);
  assert.equal(s.store.tables.faculty.some(f=>f.ucid==='PREHIRE-2027-001'),false);
  const pending=await send(s,s.ordinary,'/api/v1/dashboard/faculty?status=pending');
  assert.equal(pending.status,403);
});

test('activation dates validate strictly and manual deactivation survives the scheduled start',async()=>{
  const s=setup();
  const bad=await send(s,s.admin,'/api/v1/dashboard/faculty','POST',newFaculty(s,{activationDate:'2027-02-30'}));
  assert.equal(bad.status,400);
  const row=await create(s);
  s.store.tables.users.push({firebaseUid:'demo-future-hire',baseRole:'faculty',facultyId:row.facultyId,active:true,mustChangePassword:false});
  const userRepo=require('../tools/pages-demo-api/repos/core.js').createUserRepository(s.store);
  assert.equal((await userRepo.findByUid('demo-future-hire')).active,false);
  s.setNow('2027-06-01T20:00:00.000Z');
  assert.equal((await userRepo.findByUid('demo-future-hire')).active,true);
  const detail=await send(s,s.admin,'/api/v1/dashboard/faculty/'+row.facultyId);
  assert.equal(detail.status,200);
  const version=detail.jsonBody.faculty.updatedAtUtc;
  const disabled=await send(s,s.admin,'/api/v1/dashboard/faculty/'+row.facultyId+'/deactivate','POST',{expectedUpdatedAtUtc:version,confirm:true});
  assert.equal(disabled.status,200,JSON.stringify(disabled.jsonBody));
  assert.equal(disabled.jsonBody.faculty.administrativeActive,false);
  assert.equal((await userRepo.findByUid('demo-future-hire')).active,false);
  const restored=await send(s,s.admin,'/api/v1/dashboard/faculty/'+row.facultyId+'/restore','POST',{expectedUpdatedAtUtc:disabled.jsonBody.faculty.updatedAtUtc});
  assert.equal(restored.status,200);
  assert.equal((await userRepo.findByUid('demo-future-hire')).active,true);
});

test('future Faculty may be scheduled only on or after their start; rescheduling fails before it',async()=>{
  const s=setup();const future=await create(s);
  const repo=createSessionRepository(s.store);
  const course=s.store.tables.courses.find(c=>c.curriculumYear===1);
  assert.ok(course);
  const fields={academicYear:'2027-28',curriculumYear:'1',courseCode:course.courseCode,sessionType:'LEC',
    date:'2027-05-31',startTime:'09:00:00',endTime:'10:00:00',topic:'Future Faculty trial',room:'Demo Lab',
    assignments:[{facultyId:future.facultyId,teachingRole:'Lecture'}]};
  await assert.rejects(()=>repo.createNew({session:fields}),error=>error.number===56551);
  const valid=await repo.createNew({session:{...fields,date:START}});
  assert.ok(valid.id);
  await assert.rejects(()=>repo.updateExisting({sessionId:valid.id,patch:{date:'2027-05-31'}}),error=>error.number===56551);
  await assert.rejects(()=>repo.replaceAssignments({sessionId:s.store.tables.sessions[0].id,assignments:fields.assignments}),error=>error.number===56551);
  assert.equal(s.store.tables.sessions.find(row=>row.id===valid.id).date,START);
});

test('teaching assignment draft/finalization also reject pre-start faculty ID',async()=>{
  const s=setup(); const future=await create(s);const repo=createTeachingAssignmentRepository(s.store);
  const packageRows=await repo.listWorkQueue({academicYear:s.store.tables.academicYear,role:'developer'});
  const draft=packageRows.find(r=>r.status==='draft');
  assert.ok(draft);
  const current=await repo.getPackage({packageId:draft.packageId,role:'developer'});
  const session=current.revisions.at(-1).sessions[0];
  await assert.rejects(()=>repo.saveDraft({packageId:draft.packageId,
    expectedWorkingRevision:current.workingRevision,
    sessions:[{sessionId:session.sessionId,assignments:[{facultyId:future.facultyId,teachingRole:'Lecture'}]}],
    actorFirebaseUid:s.admin.firebaseUid}),error=>error.number===56551);
});

test('Faculty editor exposes Add New, effective start date and the create API method',()=>{
  const root=path.resolve(__dirname,'..');
  const ui=fs.readFileSync(path.join(root,'frontend/scripts/faculty-admin-management.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'frontend/pages/faculty-admin.html'),'utf8');
  const client=fs.readFileSync(path.join(root,'frontend/scripts/paws-data-client.js'),'utf8');
  assert.match(html,/id="faculty-create-btn"/);
  assert.match(ui,/createDashboardFaculty/);
  assert.match(ui,/activationDate/);
  assert.match(client,/createDashboardFaculty/);
});
