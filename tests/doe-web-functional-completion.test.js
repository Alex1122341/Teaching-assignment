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
 assert.equal(VIEW.sessionAssignmentLine({lines:[worksheet.lines[0]},'s1','')?.resultDoe,.6);
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
 assert.match(loader,/faculty-admin-enhancements\\.js/);
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
