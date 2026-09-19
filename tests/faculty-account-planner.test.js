'use strict';
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
