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
// merged from tests/faculty-account-planner.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const planner=require('../faculty-account-planner.js');

test('source HICC and VISC roles become unique managed roles with workload DOE',()=>{
 const faculty={facultySummary2026_27:{roles:[
  {type:'HICC',assignment:'VMED 501'},
  {type:'HICC',assignment:'VMED 501'},
  {type:'VISC',assignment:'VISC'}
 ]},workloadPolicy2026_27:{credits:[
  {sourceRoleType:'HICC',assignment:'VMED 501',appliedDOE:2},
  {sourceRoleType:'VISC',assignment:'VISC',operationalDOE:1.5}
 ]}};
 const roles=planner.normalizedManagedRoles(faculty);
 assert.deepEqual(roles.map(row=>row.type),['HICC','VISC']);
 assert.deepEqual(roles.map(row=>row.doeCredit),[2,1.5]);
 assert.ok(roles.every(row=>row.importedFrom==='facultySummary2026_27'));
});

test('existing managed role wins over matching imported source role',()=>{
 const faculty={managedRoles2026_27:[{type:'HICC',assignment:'VMED 501',action:'add',doeCredit:3,notes:'Approved custom value'}],facultySummary2026_27:{roles:[{type:'HICC',assignment:'VMED 501',doe:2}]}};
 const roles=planner.normalizedManagedRoles(faculty);
 assert.equal(roles.length,1);
 assert.equal(roles[0].doeCredit,3);
 assert.equal(roles[0].notes,'Approved custom value');
});

test('HICC is primary while every faculty-facing role is preserved',()=>{
 assert.deepEqual(planner.facultyRoles({facultySummary2026_27:{roles:[{type:'VISC'},{type:'HICC'}]}}),['hicc','visc','faculty']);
 assert.equal(planner.primaryRole(['visc','hicc','faculty']),'hicc');
 assert.equal(planner.primaryRole(['visc','faculty']),'visc');
});

test('indexed faculty role types drive account access planning',()=>{
 const faculty={__id:'f1',active:true,preferredFullName:'Alpha',email:'alpha@ucalgary.ca',roleTypes:['VISC','HICC']};
 assert.deepEqual(planner.facultyRoles(faculty),['hicc','visc','faculty']);
});

test('provision plan creates valid active faculty and protects privileged accounts',()=>{
 const faculty=[
  {__id:'f1',active:true,preferredFullName:'Alpha, A',email:'alpha@ucalgary.ca',facultySummary2026_27:{roles:[{type:'HICC'}]}},
  {__id:'f2',active:true,preferredFullName:'Beta, B',email:'beta@ucalgary.ca'},
  {__id:'f3',active:true,preferredFullName:'No Email'},
  {__id:'f4',active:true,preferredFullName:'Duplicate',email:'BETA@ucalgary.ca'},
  {__id:'f5',active:false,preferredFullName:'Inactive',email:'inactive@ucalgary.ca'}
 ];
 const users=[{uid:'owner-1',facultyId:'f1',email:'alpha@ucalgary.ca',role:'owner',active:true}];
 const result=planner.plan(faculty,users,new Set());
 assert.equal(result.create.length,0);
 assert.equal(result.protected.length,1);
 assert.equal(result.missingEmail.length,1);
 assert.equal(result.duplicateEmail.length,2);
 assert.equal(result.inactive.length,1);
});

test('provision plan updates existing faculty profiles without replacing UID',()=>{
 const faculty=[{__id:'f1',active:true,preferredFullName:'Alpha',email:'alpha@ucalgary.ca',facultySummary2026_27:{roles:[{type:'VISC'}]}}];
 const users=[{uid:'auth-123',facultyId:'f1',email:'alpha@ucalgary.ca',role:'faculty',active:true}];
 const result=planner.plan(faculty,users,new Set(['alpha@ucalgary.ca']));
 assert.equal(result.update.length,1);
 assert.equal(result.update[0].uid,'auth-123');
 assert.equal(result.update[0].role,'visc');
 assert.deepEqual(result.update[0].facultyRoles,['visc','faculty']);
});

test('account provisioning leaves DOE workload records untouched',()=>{
 const faculty=[{__id:'f1',active:true,preferredFullName:'Alpha',email:'alpha@ucalgary.ca',facultySummary2026_27:{roles:[{type:'HICC',assignment:'501'}]}}];
 const result=planner.plan(faculty,[],new Set());
 assert.deepEqual(result.roleUpdates,[]);
 assert.deepEqual(result.create[0].facultyRoles,['hicc','faculty']);
});

test('deterministic DOE assignment facts exclude editable final doeCredit',()=>{
 const row=planner.normalizeDoeAssignment({academicYear:'2027-28',type:'HICC',courseCode:'VTMD 204',doeCredit:12,notes:'role fact'});
 assert.equal(row.academicYear,'2027-28');
 assert.equal(row.roleType,'HICC');
 assert.equal(row.courseCode,'VTMD 204');
 assert.equal(Object.hasOwn(row,'doeCredit'),false);
});

test('legacy managed HICC role is classified for migration without losing its old credit',()=>{
 const row=planner.classifyLegacyManagedRole({type:'HICC',assignment:'VTMD 204',doeCredit:12});
 assert.equal(row.classification,'assignment_fact_candidate');
 assert.equal(row.legacyDoeCredit,12);
 assert.equal(row.facts.roleType,'HICC');
 assert.equal(row.facts.courseCode,'VTMD 204');
});

test('account provisioning never rewrites workload DOE role records',()=>{
 const faculty=[{__id:'f1',active:true,preferredFullName:'Alpha',email:'alpha@ucalgary.ca',facultySummary2026_27:{roles:[{type:'HICC',assignment:'VTMD 204'}]}}];
 const result=planner.plan(faculty,[],new Set());
 assert.deepEqual(result.roleUpdates,[]);
 assert.deepEqual(result.create[0].facultyRoles,['hicc','faculty']);
});

test('Faculty role editor submits assignment facts to DOE API and has no editable deterministic DOE field',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.resolve(__dirname,'..','faculty-admin-enhancements.js'),'utf8');
 assert.match(source,/UCVM_DOE_API\.saveRoleAssignment/);
 assert.doesNotMatch(source,/class="input ucvm-role-doe"/);
 assert.doesNotMatch(source,/>DOE credit %</);
});

test('User Management account provisioning cannot write legacy DOE workload role fields',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.resolve(__dirname,'..','user-management.js'),'utf8');
 const start=source.indexOf('async function previewProvision');
 const end=source.indexOf("$('signout')",start);
 const provisioning=source.slice(start,end);
 assert.doesNotMatch(provisioning,/managedRoles2026_27/);
 assert.doesNotMatch(provisioning,/applyRoleCleanup/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/faculty-admin-calendar-sync.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../faculty-admin.js'),'utf8');
test('legacy summary synchronization pairs every session set and delete with sanitized calendar and uses conservative batches',()=>{
 assert.match(source,/UCVM_CALENDAR_SESSION\.fromSource/);
 assert.match(source,/collection\(['"]calendar_sessions['"]\)/);
 assert.match(source,/for\(let i=0;i<p\.sessions\.length;i\+=8\)/);
 assert.match(source,/for\(let i=0;i<stale\.length;i\+=8\)/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/faculty-doe.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const DOE=require('../faculty-doe.js');

test('override DOE wins over contract DOE',()=>{
 assert.deepEqual(
  DOE.effectiveTarget({doe:{teaching:40},doeOverride2026_27:{value:25,reason:'RSL'}}),
  {value:25,source:'override',reason:'RSL'}
 );
});

test('contract DOE is used when no override exists',()=>{
 assert.deepEqual(DOE.effectiveTarget({doe:{teaching:40}}),{value:40,source:'contract',reason:''});
});

test('effective target recognizes indexed faculty values',()=>{
 assert.equal(DOE.effectiveTarget({contractTeachingDOE:30,overrideDOE:20,overrideReason:'Leave'}).value,20);
 assert.equal(DOE.targetLabel({contractTeachingDOE:30,overrideDOE:20,overrideReason:'Leave'}),'Override DOE 20.00% · Leave');
});

test('missing DOE has an unavailable label',()=>{
 assert.deepEqual(DOE.effectiveTarget({}),{value:null,source:'none',reason:''});
 assert.equal(DOE.targetLabel({}),'DOE unavailable');
});

test('server worksheet target is preferred when present',()=>{
 const target=DOE.effectiveTarget({doe:{teaching:40},__doeWorksheetSummary:{effectiveTargetDOE:30,policyVersionId:'target-v2'}});
 assert.equal(target.value,30);
 assert.equal(target.source,'worksheet');
 assert.equal(target.policyVersionId,'target-v2');
 assert.equal(DOE.targetLabel({__doeWorksheetSummary:{effectiveTargetDOE:30,policyVersionId:'target-v2'}}),'Worksheet DOE 30.00%');
});

test('browser compatibility target helper has no policy engine dependency',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../faculty-doe.js'),'utf8');
 assert.doesNotMatch(source,/DOE_POLICY_ENGINE|doe-policy-engine|calculateTarget\(/);
 const target=DOE.effectiveTarget({doe:{teaching:40},doeOverride2026_27:{value:25,reason:'RSL'}});
 assert.deepEqual(target,{value:25,source:'override',reason:'RSL'});
});
})();

// ------------------------------------------------------------------------
// merged from tests/faculty-lookup.test.js
// ------------------------------------------------------------------------
(() => {
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = ['faculty-admin.html','faculty-admin.js','faculty-admin.css']
  .map(name=>fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8')).join('\n');

test('Assigned AD is removed from faculty lookup, editor, filters, and exports', () => {
  assert.doesNotMatch(source, /id="filter-ad"|field\('Assigned AD'|\['assignedAD'|\['assignedAD','Assigned AD'/);
});

test('an existing DOE override is highlighted beside the faculty name', () => {
  assert.match(source, /doeOverride2026_27/);
  assert.match(source, /const numeric=UCVM\.number/);
  assert.match(source, /function overrideOf\(r\)\{const o=r\?\.doeOverride2026_27;return o&&numeric\(o\.value\)!==null\?o:null\}/);
  assert.match(source, /Override DOE \$\{Number\(o\.value\)\.toFixed\(2\)\}%/);
  assert.match(source, /override-badge/);
  assert.match(source, /Office DOE Override/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/faculty-self-dashboard.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('faculty, HICC, and VISC can open Faculty Dashboard from the timetable',()=>{
 const src=read('asset-loader.js');
 assert.match(src,/function enableFacultyDashboardLink\(\)/);
 assert.match(src,/\['faculty','hicc','visc'\]\.includes\(UCVM\.role\(profile\?\.role\)\)/);
 assert.match(src,/button\.classList\.remove\('hidden'\)/);
 assert.match(src,/window\.location\.href='faculty-admin\.html'/);
 assert.match(src,/ucvm:sessions-updated/);
});

test('faculty dashboard has a linked self-profile mode that does not subscribe to the faculty index',()=>{
 const src=read('faculty-admin.js');
 assert.match(src,/function isSelfServiceProfile\(p\)\{return \['faculty','hicc','visc'\]\.includes\(String\(p\?\.role\|\|''\)\.toLowerCase\(\)\)\}/);
 assert.match(src,/async function loadSelfFaculty\(facultyId\)/);
 assert.match(src,/db\.collection\(COLLECTION\)\.doc\(String\(facultyId\)\)\.get\(\)/);
 assert.match(src,/listenFacultySessions\(facultyId\)/);
 assert.match(src,/if\(isSelfServiceProfile\(p\)\)\{await enterSelfMode\(user,p\);return\}/);
 assert.match(src,/if\(UCVM\.admin\(p\)\)\{enterAdminMode\(user,p\);return\}/);
 const start=src.indexOf('async function enterSelfMode(user,p)');
 const end=src.indexOf('\nfunction enterAdminMode',start);
 assert.ok(start>=0&&end>start,'enterSelfMode must exist');
 const body=src.slice(start,end);
 assert.doesNotMatch(body,/subscribeFaculty\(/);
 assert.doesNotMatch(body,/subscribeSessions\(/);
 assert.doesNotMatch(body,/faculty_index/);
});

test('faculty self mode is full-width and removes admin navigation and editing',()=>{
 const src=read('faculty-admin.js');
 assert.match(src,/document\.body\.classList\.add\('faculty-self-mode'\)/);
 assert.match(src,/const editButton=selfMode\?'':/);
 assert.match(src,/body\.faculty-self-mode \.tabs/);
 assert.match(src,/body\.faculty-self-mode \.kpis/);
 assert.match(src,/body\.faculty-self-mode #lookup-view > \.toolbar/);
 assert.match(src,/body\.faculty-self-mode \.result-pane/);
 assert.match(src,/body\.faculty-self-mode \.lookup-grid\{display:block/);
});

test('faculty record rules use the linked facultyId for get and keep list admin-only',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/function ownFacultyId\(id\)\{return facultyMember\(\) && profile\(\)\.facultyId is string && profile\(\)\.facultyId == id;\}/);
 assert.match(rules,/match \/faculty\/\{id\} \{\s*allow get: if admin\(\) \|\| ownFacultyId\(id\);\s*allow list: if admin\(\);/s);
});

test('admin-only enhancements keep their data subscription behind the administrator check',()=>{
 const src=read('faculty-admin-enhancements.js');
 const start=src.indexOf('const startFromPage=()=>');
 assert.ok(start>=0,'admin enhancement gate must exist');
 const body=src.slice(start,start+500);
 assert.match(body,/UCVM\.admin\(sharedProfile\)/);
 assert.match(body,/subscribe\(\)/);
});
})();
