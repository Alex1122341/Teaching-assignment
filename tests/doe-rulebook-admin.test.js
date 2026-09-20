'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('DOE Rules exposes the approved annual Rule Book workspace',()=>{
  const html=read('faculty-admin.html');
  for(const tab of ['rules','course-mapping','visc-subjects','preview','history'])assert.match(html,new RegExp(`data-doe-rulebook-tab=["']${tab}["']`));
  assert.match(html,/Copy from Previous Year/);
  assert.match(html,/Workload Guidelines/);
  for(const group of ['Assigned Teaching','Course Coordination','Clinical Rotations','Supervision','HICC \/ VISC','Reserve Logic','Other \/ Approved Activities'])assert.match(html,new RegExp(group));
  assert.match(html,/id=["']doe-course-mapping-body["']/);
  assert.match(html,/id=["']doe-visc-mapping-body["']/);
  assert.match(html,/id=["']doe-reference-panel["']/);
});

test('DOE API client defines the annual rulebook and worksheet contracts',()=>{
  const api=require('../doe-api-client.js');
  for(const name of ['copyPolicyYear','validateDraft','getPolicyYear','saveRule','saveCourseMapping','saveSubjectMapping','getFacultyWorksheet','listFacultyDoe','previewAssignment','saveRoleAssignment'])assert.equal(typeof api[name],'function',name);
});

test('Rule Book helper exposes annual review states and grouped rule sections',()=>{
  const admin=require('../doe-rulebook-admin.js');
  assert.deepEqual(admin.REVIEW_STATUSES,['needs_review','confirmed_unchanged','updated','new','retired']);
  assert.deepEqual(admin.RULE_GROUPS.map(row=>row.key),['assigned-teaching','course-coordination','clinical-rotations','supervision','hicc-visc','reserve-logic','other-approved']);
  const view=admin.referenceView({title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5,adminNote:'Annual review'});
  assert.equal(view.reference,'UCVM Workload Guidelines · §6.4 · Table 3 · p.5');
  assert.equal(view.note,'Annual review');
});

test('static manifest deploys API and Rule Book modules before DOE consumers',()=>{
  const manifest=JSON.parse(read('tools/static-assets.json'));
  assert.ok(manifest.includes('doe-api-client.js'));
  assert.ok(manifest.includes('doe-rulebook-admin.js'));
  const html=read('faculty-admin.html');
  assert.ok(html.indexOf('doe-api-client.js')<html.indexOf('doe-rulebook-admin.js'));
  assert.ok(html.indexOf('doe-rulebook-admin.js')<html.indexOf('faculty-admin.js'));
});

test('legacy Draft editor preserves annual reference and review metadata during transition',()=>{
  const policyAdmin=require('../doe-policy-admin.js');
  const row=policyAdmin.normalizeRuleDraft({
    ruleId:'r1',policyVersionId:'v1',ruleKey:'role.hicc.development',name:'HICC',category:'role',calculationMode:'formula',resultKind:'credit',priority:100,
    referenceId:'wg-6-4-t3',adminNote:'Reviewed against 2027-28 guideline',mappingRequirement:'course',reviewStatus:'updated'
  });
  assert.equal(row.referenceId,'wg-6-4-t3');
  assert.equal(row.adminNote,'Reviewed against 2027-28 guideline');
  assert.equal(row.mappingRequirement,'course');
  assert.equal(row.reviewStatus,'updated');
  const html=read('faculty-admin.html');
  assert.match(html,/id="doe-rule-reference-id"/);
  assert.match(html,/id="doe-rule-admin-note"/);
});

test('annual mapping editor exposes structured Course/VISC fields and is driven by the loaded Draft bundle',()=>{
  const html=read('faculty-admin.html');
  const adminSource=read('doe-rulebook-admin.js');
  const policySource=read('doe-policy-admin.js');
  for(const id of ['doe-mapping-editor','doe-mapping-course-code','doe-mapping-unit-count','doe-mapping-subject-key','doe-mapping-curriculum-stage','doe-mapping-reference-id','doe-mapping-review-status','doe-mapping-admin-note','doe-mapping-save'])assert.match(html,new RegExp(`id=["']${id}["']`),id);
  assert.match(adminSource,/saveCourseMapping/);
  assert.match(adminSource,/saveSubjectMapping/);
  assert.match(adminSource,/data-doe-mapping-edit/);
  assert.match(policySource,/UCVM_DOE_RULEBOOK_ADMIN.*renderBundle/);
});

test('mapping draft normalization keeps assignment facts separate from server-owned year/version',()=>{
  const admin=require('../doe-rulebook-admin.js');
  const course=admin.normalizeMappingDraft('course',{mappingId:'c1',courseCode:' vtmd 204 ',unitCount:'6',referenceId:'ref1',reviewStatus:'updated',adminNote:'Confirmed'});
  assert.deepEqual(course,{mappingId:'c1',courseCode:'VTMD 204',unitCount:6,referenceId:'ref1',reviewStatus:'updated',adminNote:'Confirmed',enabled:true});
  const subject=admin.normalizeMappingDraft('subject',{mappingId:'s1',subjectKey:' Anatomy ',curriculumStage:'year_3',referenceId:'ref1',reviewStatus:'confirmed_unchanged',adminNote:''});
  assert.equal(subject.subjectKey,'anatomy');
  assert.equal(subject.curriculumStage,'year_3');
  assert.equal(Object.hasOwn(subject,'academicYear'),false);
  assert.equal(Object.hasOwn(subject,'policyVersionId'),false);
});

test('Annual Rule Book has editable structured References and Reserve Logic',()=>{
  const html=read('faculty-admin.html'),source=read('doe-rulebook-admin.js');
  for(const id of ['doe-add-reference','doe-reference-list','doe-reference-editor','doe-reference-title','doe-reference-section','doe-reference-table','doe-reference-page','doe-reference-effective-date','doe-reference-review-status','doe-reference-admin-note','doe-reference-save','doe-edit-reserve','doe-reserve-editor','doe-reserve-split-threshold','doe-reserve-split-ratio','doe-reserve-high-ceiling','doe-reserve-teaching-focused-ceiling','doe-reserve-rolling-years','doe-reserve-reference-id','doe-reserve-review-status','doe-reserve-save'])assert.match(html,new RegExp(`id=["']${id}["']`),id);
  assert.match(source,/DOE_API\.saveReference/);
  assert.match(source,/DOE_API\.saveReservePolicy/);
});

test('DOE API client exposes Reference and Reserve Draft writes',()=>{
  const api=require('../doe-api-client.js');
  assert.equal(typeof api.saveReference,'function');
  assert.equal(typeof api.saveReservePolicy,'function');
});


test('Rule Book History is backed by the server DOE audit API',()=>{
 const api=require('../doe-api-client.js');
 assert.equal(typeof api.listAudit,'function');
 const source=read('doe-rulebook-admin.js');
 assert.match(source,/DOE_API\.listAudit/);
 assert.match(source,/doe-rulebook-history-body/);
 assert.match(source,/changedAt/);
 assert.match(source,/changedByName/);
});
