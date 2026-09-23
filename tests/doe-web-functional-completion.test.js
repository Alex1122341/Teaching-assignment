'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createWorksheetService}=require('../server/src/doe/worksheet-service.js');
const VIEW=require('../doe-worksheet-view.js');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Needs Review never turns an unrated worksheet section into a zero subtotal',async()=>{
 const repository={
  async getFacultyWorksheetSource(){
   return{
    facultyId:'f1',
    academicYear:'2027-28',
    displayName:'Dr Example',
    policyStatus:'single',
    target:{effectiveTargetDoe:40},
    lines:[
     {lineId:'s1--a1',category:'teaching',sourceEntityType:'session_assignment',sourceEntityId:'s1',resultDoe:.6,status:'calculated',policyVersionId:'v1'},
     {lineId:'s2--a2',category:'teaching',sourceEntityType:'session_assignment',sourceEntityId:'s2',resultDoe:null,status:'needs_review',policyVersionId:'v1'}
    ]
   };
  }
 };
 const worksheet=await createWorksheetService({repository}).buildFacultyWorksheet({facultyId:'f1',academicYear:'2027-28'});
 assert.equal(worksheet.status,'needs_review');
 assert.equal(worksheet.totals.scheduledTeachingDoe,null);
 assert.equal(worksheet.totals.assignedTeachingDoe,null);
});

test('worksheet view can resolve the authoritative DOE line for a timetable assignment',()=>{
 const worksheet={lines:[
  {lineId:'s1--a1',sourceEntityType:'session_assignment',sourceEntityId:'s1',resultDoe:.6,status:'calculated'},
  {lineId:'s1--a2',sourceEntityType:'session_assignment',sourceEntityId:'s1',resultDoe:.3,status:'calculated'}
 ]};
 assert.equal(VIEW.sessionAssignmentLine(worksheet,'s1','a2')?.resultDoe,.3);
 assert.equal(VIEW.sessionAssignmentLine(worksheet,'s1','missing'),null);
 assert.equal(VIEW.sessionAssignmentLine({lines:[worksheet.lines[0]]},'s1','')?.resultDoe,.6);
});

test('Faculty Lookup activity DOE cells use the server worksheet instead of raw legacy assignment credit',()=>{
 const source=read('faculty-admin.js');
 const start=source.indexOf('function activitiesHtml');
 const end=source.indexOf('function workloadBreakdownHtml',start);
 const fn=source.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(fn,/activityDoeHtml/);
 assert.doesNotMatch(fn,/x\.assignment\.doeCredit/);
});

test('DOE List navigation owns the whole Faculty Dashboard panel state',()=>{
 const source=read('faculty-admin-enhancements.js');
 const start=source.indexOf('function ensureDoeView');
 const end=source.indexOf('function updateDoeFilters',start);
 const fn=source.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(fn,/dataset\.tab\s*=\s*['"]doe-list['"]/);
 assert.match(fn,/doe-rules/);
 assert.match(fn,/sessional/);
});


test('Faculty Dashboard actually loads deferred DOE admin enhancements for administrators only',()=>{
 const source=read('faculty-admin.js');
 const loaderStart=source.indexOf('function ensureFacultyAdminEnhancements');
 const loaderEnd=source.indexOf('\nfunction',loaderStart+20);
 const loader=source.slice(loaderStart,loaderEnd);
 assert.ok(loaderStart>=0);
 assert.match(loader,/faculty-admin-enhancements\.js/);
 const adminStart=source.indexOf('function enterAdminMode');
 const adminEnd=source.indexOf('\nfunction',adminStart+20);
 assert.match(source.slice(adminStart,adminEnd),/ensureFacultyAdminEnhancements/);
 const selfStart=source.indexOf('async function enterSelfMode');
 const selfEnd=source.indexOf('\nfunction',selfStart+20);
 assert.doesNotMatch(source.slice(selfStart,selfEnd),/ensureFacultyAdminEnhancements/);
});


test('Teaching Summary uses the authoritative bulk DOE list instead of the legacy derived index',()=>{
 const source=read('faculty-admin.js');
 assert.match(source,/UCVM_DOE_API\.listFacultyDoe/);
 const start=source.indexOf('function renderSummary');
 const end=source.indexOf('function allRoleRows',start);
 const fn=source.slice(start,end);
 assert.match(fn,/UCVM_DOE_WORKSHEET_VIEW\.renderDoeListRow/);
 assert.doesNotMatch(fn,/liveAssignedDOE\(/);
});


test('DOE role editor exposes dated responsibility windows and negative manual overrides without automatic proration',()=>{
 const source=read('faculty-admin-enhancements.js'),helper=read('temporal-role-assignment.js');
 assert.match(source,/ucvm-role-active-date/);
 assert.match(source,/ucvm-role-expiration-date/);
 assert.match(source,/ucvm-role-doe-override/);
 assert.doesNotMatch(source,/ucvm-role-doe-override[^\n]*min="0"/);
 assert.match(source,/effectiveDoe\(result\.resultDoe,facts\.doeOverride\)/);
 assert.match(helper,/half-open|\[activeDate, expirationDate\)/i);
});

test('Roles and Appointments exposes temporal status filtering notes and server role history',()=>{
 const html=read('faculty-admin.html'),enhancement=read('faculty-admin-enhancements.js'),core=read('faculty-admin.js');
 assert.match(html,/role-status-filter/);
 for(const label of ['Active','Scheduled','Expired','Inactive \/ deactivated'])assert.match(html,new RegExp(label));
 assert.match(enhancement,/roleAssignmentRecords/);
 assert.match(enhancement,/r\.notes/);
 assert.match(core,/roleAssignmentRecords/);
 assert.match(core,/statusAt/);
});

test('Current HICC and VISC KPI counts are temporal rather than annual-role counts',()=>{
 const source=read('faculty-admin.js'),start=source.indexOf('function updateKpis'),end=source.indexOf('function unique',start),fn=source.slice(start,end);
 assert.match(fn,/roleAssignmentRecords/);
 assert.match(fn,/statusAt/);
 assert.match(fn,/===['"]active['"]/);
});

test('DOE role editor loads, updates, and deactivates authoritative server assignments',()=>{
 const client=read('doe-api-client.js');
 assert.match(client,/listRoleAssignments/);
 assert.match(client,/deactivateRoleAssignment/);
 const source=read('faculty-admin-enhancements.js');
 assert.match(source,/UCVM_DOE_API\.listRoleAssignments/);
 assert.match(source,/UCVM_DOE_API\.deactivateRoleAssignment/);
 assert.match(source,/assignmentFactId/);
 assert.match(source,/removedRoleIds/);
});

test('DOE routes expose admin-only role assignment list and deactivate operations',()=>{
 const source=read('server/src/routes/doe-routes.js');
 assert.match(source,/role-assignments/);
 assert.match(source,/listRoleAssignments/);
 assert.match(source,/deactivateRoleAssignment/);
});


test('Faculty Lookup list uses one bulk DOE summary and reserves full worksheet loads for selected detail',()=>{
 const source=read('faculty-admin.js');
 const start=source.indexOf('function lookupDoeMeta');
 const end=source.indexOf('function display',start);
 const fn=source.slice(start,end);
 assert.match(fn,/doeListByFaculty/);
 assert.match(fn,/loadDoeSummaryList/);
 assert.match(fn,/selfMode/);
});

test('DOE list summaries carry authoritative target metadata for badges and management context',async()=>{
 const repository={
  async getFacultyWorksheetSource(){return null},
  async listFacultyWorksheetSources(){return[{facultyId:'f1',academicYear:'2027-28',displayName:'Dr Example',policyStatus:'single',target:{effectiveTargetDoe:25,overrideDoe:25,overrideReason:'RSL',source:'approved_override'},lines:[]}]}
 };
 const rows=await createWorksheetService({repository}).listFacultyDoe({academicYear:'2027-28'});
 assert.equal(rows[0].target.overrideDoe,25);
 assert.equal(rows[0].target.overrideReason,'RSL');
});


test('Roles and Appointments never presents legacy workload calculations as current DOE',()=>{
 const source=read('faculty-admin.js');
 const start=source.indexOf('function roleDoeHtml');
 const end=source.indexOf('function rolesHtml',start);
 const fn=source.slice(start,end);
 assert.match(fn,/cachedDoeWorksheet/);
 assert.match(fn,/server Worksheet/);
 assert.doesNotMatch(fn,/workloadOf\(/);
 assert.doesNotMatch(fn,/roleWorkloadMatches\(/);
});


test('bulk DOE summary carries current role assignments without full worksheet detail',async()=>{
 const repository={
  async getFacultyWorksheetSource(){return null},
  async listFacultyWorksheetSources(){return[{
   facultyId:'f1',academicYear:'2027-28',displayName:'Dr Example',policyStatus:'single',
   target:{effectiveTargetDoe:40},
   lines:[
    {lineId:'role-1',category:'role',sourceEntityType:'doe_assignment',sourceEntityId:'role-1',assignmentFactId:'role-1',roleType:'HICC',courseCode:'VTMD 204',resultDoe:12,status:'calculated',ruleKey:'role.hicc',policyVersionId:'v1'},
    {lineId:'s1--a1',category:'teaching',sourceEntityType:'session_assignment',sourceEntityId:'s1',resultDoe:.6,status:'calculated',policyVersionId:'v1'}
   ]
  }]}
 };
 const rows=await createWorksheetService({repository}).listFacultyDoe({academicYear:'2027-28'});
 assert.equal(rows[0].roleAssignmentCount,1);
 assert.deepEqual(rows[0].roleAssignments,[{
  assignmentFactId:'role-1',roleType:'HICC',courseCode:'VTMD 204',subjectKey:'',resultDoe:12,status:'calculated',ruleKey:'role.hicc',ruleId:'',reference:null,
  activeDate:'',expirationDate:'',notes:'',calculatedDoe:null,overrideDoe:null
 }]);
 assert.equal(Object.hasOwn(rows[0].roleAssignments[0],'calculationRecord'),false);
});

test('Faculty Dashboard exposes one shared bulk DOE cache to deferred enhancements',()=>{
 const core=read('faculty-admin.js'),enhancement=read('faculty-admin-enhancements.js');
 assert.match(core,/UCVM_ADMIN_DATA=.*doeList/);
 assert.match(core,/loadDoeSummaryList/);
 assert.match(enhancement,/UCVM_ADMIN_DATA\?\.doeList/);
 const start=enhancement.indexOf('async function loadDoeList');
 const end=enhancement.indexOf('function legacyDoeRows',start);
 assert.doesNotMatch(enhancement.slice(start,end),/UCVM_DOE_API\.listFacultyDoe/);
});

test('Roles and Appointments lists current server role assignments before legacy migration evidence',()=>{
 const source=read('faculty-admin-enhancements.js');
 const start=source.indexOf('function appendManagedRoleRows');
 const end=source.indexOf('function queueManagedRoles',start);
 const fn=source.slice(start,end);
 assert.match(fn,/roleAssignments/);
 assert.match(fn,/Current server/);
 assert.match(fn,/Legacy/);
});


test('Faculty Dashboard labels authoritative DOE summaries separately from legacy migration sources',()=>{
 const html=read('faculty-admin.html');
 assert.match(html,/Assigned DOE and current role counts come from the authoritative server DOE summary/);
 assert.match(html,/Current server role assignments are authoritative/);
 assert.match(html,/legacy migration evidence/i);
});


test('Roles search and type filters re-append current server and legacy evidence rows after the base table rerenders',()=>{
 const source=read('faculty-admin-enhancements.js');
 assert.match(source,/roles-search/);
 assert.match(source,/role-type-filter/);
 assert.match(source,/scheduleRoleAppend/);
});


test('Faculty Dashboard KPI strip uses authoritative bulk DOE and current server role assignments',()=>{
 const source=read('faculty-admin.js');
 const start=source.indexOf('function updateKpis');
 const end=source.indexOf('function unique',start);
 const fn=source.slice(start,end);
 assert.match(fn,/doeListByFaculty/);
 assert.match(fn,/roleAssignments/);
 assert.doesNotMatch(fn,/liveAssignedDOE\(/);
});

test('legacy workload import status is labelled as evidence rather than current DOE authority',()=>{
 const html=read('faculty-admin.html');
 const source=read('faculty-admin.js');
 assert.match(html,/Legacy workload evidence: checking/);
 assert.match(source,/legacy workload evidence/);
});


test('Faculty Profile role section includes current server assignments even when the legacy source summary has no roles',()=>{
 const source=read('faculty-admin.js');
 const start=source.indexOf('function serverRoleRows');
 const end=source.indexOf('function activityAssignmentId',start);
 const fn=source.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(fn,/roleAssignments/);
 assert.match(fn,/Current server/);
 assert.match(fn,/Source evidence/);
 assert.doesNotMatch(fn,/if\(!s\|\|!s\.roles\?\.length\)return/);
});


test('DOE assignment and target saves invalidate the selected Faculty Worksheet and refresh the shared bulk summary',()=>{
 const core=read('faculty-admin.js'),enhancement=read('faculty-admin-enhancements.js');
 assert.match(core,/async function refreshDoeFaculty/);
 assert.match(core,/doeWorksheetByFaculty\.delete/);
 assert.match(core,/loadDoeSummaryList\(\{force:true\}\)/);
 assert.match(core,/refreshDoeFaculty/);
 const start=enhancement.indexOf('async function saveExtras');
 const end=enhancement.indexOf('function appendManagedRoleRows',start);
 const save=enhancement.slice(start,end);
 assert.match(save,/UCVM_ADMIN_DATA\?\.refreshDoeFaculty/);
});


test('Roles tab keeps source-summary rows as evidence and reserves current DOE for Current server rows',()=>{
 const source=read('faculty-admin.js');
 const start=source.indexOf('function renderRoles');
 const end=source.indexOf('function renderSessional',start);
 const fn=source.slice(start,end);
 assert.match(fn,/Source summary/);
 assert.match(fn,/Source evidence only/);
 assert.doesNotMatch(fn,/roleDoeHtml\(/);
 assert.doesNotMatch(fn,/rolePolicyHtml\(/);
});


test('Teaching Summary Current Roles never falls back to legacy source-summary role counts',()=>{
 const source=read('faculty-admin.js');
 const start=source.indexOf('function renderSummary');
 const end=source.indexOf('function allRoleRows',start);
 const fn=source.slice(start,end);
 assert.match(fn,/roleAssignmentCount/);
 assert.doesNotMatch(fn,/\(s\.roles\|\|\[\]\)\.length/);
});
