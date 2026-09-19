'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const VIEW=require('../doe-worksheet-view.js');
const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

function fixture(overrides={}){
 return{
  facultyId:'f1',displayName:'Dr Example',academicYear:'2027-28',policyVersionId:'v1',status:'calculated',lastCalculatedAt:'2027-01-11T10:00:00Z',
  totals:{scheduledTeachingDoe:.6,roleDoe:12,rawSupervisionDoe:6,appliedSupervisionDoe:6,adjustmentDoe:1,assignedTeachingDoe:19.6,effectiveTargetDoe:40,remainingDoe:20.4},
  reserve:{initialTraineeReserve:15,appliedSupervision:6,unappliedSupervision:0},
  lines:[{lineId:'l1',category:'teaching',label:'VTMD 301 Lecture',calculationText:'2 hours × 0.30% = 0.60%',resultDoe:.6,status:'calculated',policyVersionId:'v1',ruleKey:'teaching.lecture.standard',calculationId:'c1',reference:{title:'UCVM Workload Guidelines',section:'6.2',table:'Table 1',page:3}}],
  errors:[],...overrides
 };
}

test('Lookup and DOE List normalize exactly the same worksheet totals',()=>{
 const worksheet=fixture();
 const lookup=VIEW.renderLookupDoe(worksheet);
 const list=VIEW.renderDoeListRow(worksheet);
 assert.equal(lookup.assignedDoe,list.assignedDoe);
 assert.equal(lookup.remainingDoe,list.remainingDoe);
 assert.equal(lookup.policyVersionId,list.policyVersionId);
 assert.equal(list.scheduledDoe,.6);
 assert.equal(list.roleDoe,12);
 assert.equal(list.appliedSupervisionDoe,6);
});

test('Needs Review never formats an unavailable assigned DOE as zero',()=>{
 const worksheet=fixture({status:'needs_review',totals:{...fixture().totals,assignedTeachingDoe:null,remainingDoe:null},errors:[{code:'DOE_LINE_UNAVAILABLE'}]});
 const summary=VIEW.worksheetSummary(worksheet);
 assert.equal(summary.assignedDoe,null);
 assert.equal(summary.remainingDoe,null);
 assert.equal(VIEW.percent(summary.assignedDoe),'Unavailable');
 assert.equal(VIEW.statusView(worksheet).key,'needs_review');
});

test('an explicit calculated zero remains a real zero',()=>{
 const worksheet=fixture({totals:{...fixture().totals,assignedTeachingDoe:0,remainingDoe:40}});
 assert.equal(VIEW.worksheetSummary(worksheet).assignedDoe,0);
 assert.equal(VIEW.percent(0),'0.00%');
});

test('worksheet detail renders immutable rule and Reference provenance',()=>{
 const html=VIEW.worksheetHtml(fixture());
 assert.match(html,/VTMD 301 Lecture/);
 assert.match(html,/2 hours × 0\.30% = 0\.60%/);
 assert.match(html,/teaching\.lecture\.standard/);
 assert.match(html,/UCVM Workload Guidelines/);
 assert.match(html,/§6\.2/);
 assert.match(html,/Table 1/);
 assert.match(html,/p\.3/);
 assert.match(html,/c1/);
});

test('Faculty Lookup and DOE List consume the server worksheet API when configured',()=>{
 const lookup=read('faculty-admin.js');
 const list=read('faculty-admin-enhancements.js');
 assert.match(lookup,/UCVM_DOE_API\.getFacultyWorksheet/);
 assert.match(lookup,/UCVM_DOE_WORKSHEET_VIEW/);
 assert.match(list,/UCVM_DOE_API\.listFacultyDoe/);
 assert.match(list,/UCVM_DOE_WORKSHEET_VIEW/);
});

test('Lookup and DOE List fail closed instead of rendering legacy DOE when API is unavailable',()=>{
 const lookup=read('faculty-admin.js');
 const list=read('faculty-admin-enhancements.js');
 assert.doesNotMatch(lookup,/if\(!doeApiConfigured\(\)\)return legacySummaryHtml/);
 assert.match(lookup,/DOE API[^\n]*not configured|authoritative DOE[^\n]*unavailable/i);
 assert.doesNotMatch(list,/if\(!apiDoeReady\(\)\)return legacyDoeRows\(\)/);
 assert.match(list,/authoritative DOE[^\n]*unavailable|DOE API[^\n]*required/i);
});
