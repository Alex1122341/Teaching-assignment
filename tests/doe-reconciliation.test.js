'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('reconciliation classifies matched and DOE-difference rows from source evidence versus server Worksheet totals',()=>{
  const R=require('../doe-worksheet-view.js');
  const faculty={__id:'f1',preferredFullName:'Dr One',facultySummary2026_27:{assignedTeachingDOE:40},managedRoles2026_27:[{type:'HICC',assignment:'VTMD 204',doeCredit:12}]};
  const matched=R.reconcileFaculty(faculty,{facultyId:'f1',assignedTeachingDoe:40,status:'calculated',policyVersionId:'v1',roleAssignmentCount:1,issueCodes:[]});
  assert.equal(matched.status,'matched');
  assert.equal(matched.legacyAssignedDoe,40);
  assert.equal(matched.worksheetAssignedDoe,40);
  assert.equal(matched.differenceDoe,0);
  const changed=R.reconcileFaculty(faculty,{facultyId:'f1',assignedTeachingDoe:43,status:'calculated',policyVersionId:'v1',roleAssignmentCount:1,issueCodes:[]});
  assert.equal(changed.status,'different_doe');
  assert.equal(changed.differenceDoe,3);
});

test('reconciliation distinguishes legacy-only, server-only, Needs Review, and missing mapping',()=>{
  const R=require('../doe-worksheet-view.js');
  const legacy={__id:'legacy',facultySummary2026_27:{assignedTeachingDOE:18}};
  assert.equal(R.reconcileFaculty(legacy,null).status,'legacy_only');

  const serverOnly=R.reconcileFaculty({__id:'server'},{
    facultyId:'server',assignedTeachingDoe:20,status:'calculated',policyVersionId:'v1',roleAssignmentCount:1,issueCodes:[]
  });
  assert.equal(serverOnly.status,'server_only');

  const review=R.reconcileFaculty({__id:'review',facultySummary2026_27:{assignedTeachingDOE:20}},{
    facultyId:'review',assignedTeachingDoe:null,status:'needs_review',issueCodes:['DOE_SOURCE_PROVENANCE_INCOMPLETE'],issueCount:1
  });
  assert.equal(review.status,'needs_review');

  const mapping=R.reconcileFaculty({__id:'map',facultySummary2026_27:{assignedTeachingDOE:20}},{
    facultyId:'map',assignedTeachingDoe:null,status:'needs_review',issueCodes:['COURSE_MAPPING_REQUIRED'],issueCount:1,missingMappingCount:1
  });
  assert.equal(mapping.status,'missing_mapping');
  assert.ok(mapping.flags.includes('needs_review'));
});

test('reconciliation rows include source-role and server-fact counts and build an actionable work queue',()=>{
  const R=require('../doe-worksheet-view.js');
  const faculty=[
    {__id:'a',preferredFullName:'A',facultySummary2026_27:{assignedTeachingDOE:10,roles:[{type:'HICC'}]},managedRoles2026_27:[{type:'HICC',doeCredit:1}]},
    {__id:'b',preferredFullName:'B',facultySummary2026_27:{assignedTeachingDOE:10}}
  ];
  const server=[
    {facultyId:'a',assignedTeachingDoe:10,status:'calculated',policyVersionId:'v1',roleAssignmentCount:1,teachingLineCount:2,supervisionLineCount:0,adjustmentLineCount:0,issueCodes:[]},
    {facultyId:'b',assignedTeachingDoe:null,status:'needs_review',policyVersionId:'v1',roleAssignmentCount:0,teachingLineCount:1,supervisionLineCount:0,adjustmentLineCount:0,issueCodes:['SUBJECT_MAPPING_REQUIRED'],missingMappingCount:1}
  ];
  const rows=R.buildReconciliationRows(faculty,server);
  assert.equal(rows[0].sourceRoleCount,1);
  assert.equal(rows[0].legacyManagedRoleCount,1);
  assert.equal(rows[0].serverFactCount,3);
  const queue=R.workQueue(rows);
  assert.deepEqual(queue.map(row=>row.facultyId),['b']);
  assert.equal(queue[0].status,'missing_mapping');
});

test('bulk DOE summary exposes compact issue and fact metadata for reconciliation without full calculation records',async()=>{
  const {createWorksheetService}=require('../server/src/doe/worksheet-service.js');
  const repository={
    async getFacultyWorksheetSource(){return null},
    async listFacultyWorksheetSources(){return[{
      facultyId:'f1',academicYear:'2027-28',displayName:'Dr Example',policyStatus:'single',target:{effectiveTargetDoe:40},
      lines:[
        {lineId:'t1',category:'teaching',sourceEntityType:'session_assignment',sourceEntityId:'s1',resultDoe:28,status:'calculated',policyVersionId:'v1'},
        {lineId:'r1',category:'role',sourceEntityType:'doe_assignment',sourceEntityId:'r1',assignmentFactId:'r1',roleType:'HICC',courseCode:'VTMD 204',resultDoe:12,status:'calculated',ruleKey:'role.hicc',policyVersionId:'v1'},
        {lineId:'r2',category:'role',sourceEntityType:'doe_assignment',sourceEntityId:'r2',assignmentFactId:'r2',roleType:'VISC',subjectKey:'anatomy',resultDoe:null,status:'needs_review',errorCode:'SUBJECT_MAPPING_REQUIRED',policyVersionId:'v1'}
      ]
    }]}
  };
  const [row]=await createWorksheetService({repository}).listFacultyDoe({academicYear:'2027-28'});
  assert.equal(row.teachingLineCount,1);
  assert.equal(row.roleAssignmentCount,2);
  assert.equal(row.serverFactCount,3);
  assert.equal(row.unratedLineCount,1);
  assert.equal(row.missingMappingCount,1);
  assert.ok(row.issueCodes.includes('SUBJECT_MAPPING_REQUIRED'));
  assert.equal(Object.hasOwn(row,'lines'),false);
});

test('Faculty Dashboard has a read-only DOE Reconciliation tab and Needs Review work queue',()=>{
  const source=read('faculty-admin-enhancements.js');
  assert.match(source,/DOE Reconciliation/);
  assert.match(source,/doe-reconciliation-view/);
  assert.match(source,/doe-reconciliation-queue-body/);
  assert.match(source,/buildReconciliationRows/);
  assert.match(source,/workQueue/);
  assert.match(source,/data-reconcile-view/);
  assert.doesNotMatch(source.slice(source.indexOf('function renderReconciliation'),source.indexOf('function openBaseEditor')),/saveRoleAssignment|runRecalculate|publish\(/);
});

test('reconciliation reuses the existing DOE worksheet runtime and remains admin-only',()=>{
  const view=require('../doe-worksheet-view.js');
  assert.equal(typeof view.buildReconciliationRows,'function');
  assert.equal(typeof view.workQueue,'function');
  const source=read('faculty-admin.js');
  const loaderStart=source.indexOf('function ensureFacultyAdminEnhancements');
  const loaderEnd=source.indexOf('\nfunction',loaderStart+20);
  const loader=source.slice(loaderStart,loaderEnd);
  assert.match(loader,/faculty-admin-enhancements\.js/);
  assert.doesNotMatch(loader,/doe-reconciliation\.js/);
  const selfStart=source.indexOf('async function enterSelfMode');
  const selfEnd=source.indexOf('\nfunction',selfStart+20);
  assert.doesNotMatch(source.slice(selfStart,selfEnd),/ensureFacultyAdminEnhancements/);
});


test('Faculty Dashboard reconciliation enhancement parses as browser JavaScript',()=>{
  const source=read('faculty-admin-enhancements.js');
  assert.doesNotThrow(()=>new Function(source));
});


test('Frontend Demo feeds synthetic DOE summaries into reconciliation without enabling authoritative writes',()=>{
 const source=read('faculty-admin-enhancements.js');
 assert.match(source,/function demoDoeReady\(\)/);
 assert.match(source,/function doeDataReady\(\)/);
 assert.match(source,/UCVM_PAGES_DEMO\.doeRows\(year\)/);
 assert.match(source,/Frontend Demo reconciliation/);
 assert.match(source,/not authoritative/);
 const reconciliation=source.slice(source.indexOf('function renderReconciliation'),source.indexOf('function openBaseEditor'));
 assert.doesNotMatch(reconciliation,/saveRoleAssignment|runRecalculate|publish\(/);
 const admin=read('faculty-admin.js');
 assert.match(admin,/Teaching DOE · Frontend Demo preview/);
 assert.match(admin,/Synthetic DOE preview/);
});
