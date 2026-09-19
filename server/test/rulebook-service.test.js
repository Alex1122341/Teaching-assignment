'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ENGINE=require('../../doe-policy-engine.js');
const {createRulebookService}=require('../src/doe/rulebook-service.js');

const general={uid:'g1',name:'General Admin',email:'g@ucalgary.ca',role:'adfa_general'};
const regular={uid:'r1',name:'Regular Admin',role:'adfa_regular'};
const faculty={uid:'f1',role:'faculty'};

function sourceBundle(){
  return{
    policy:{policyId:'policy-2026',academicYear:'2026-27',name:'UCVM Workload 2026-27',requiredRuleKeys:['role.hicc.development','role.visc.development']},
    version:{policyVersionId:'active-2026-v1',policyId:'policy-2026',academicYear:'2026-27',versionNumber:1,status:'active',revision:3,reservePolicy:{strategy:'flexible_teaching_reserve',splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3,referenceId:'ref-hicc',reviewStatus:'confirmed_unchanged'}},
    references:[{referenceId:'ref-hicc',policyVersionId:'active-2026-v1',academicYear:'2026-27',title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5,reviewStatus:'confirmed_unchanged'}],
    rules:[
      {ruleId:'rule-hicc',ruleKey:'role.hicc.development',mappingRequirement:'course',policyVersionId:'active-2026-v1',category:'role',enabled:true,priority:100,calculationMode:'formula',formulaText:'units * rate',resultKind:'credit',referenceId:'ref-hicc',reviewStatus:'confirmed_unchanged',selectors:[{selectorId:'sel-hicc',ruleId:'rule-hicc',policyVersionId:'active-2026-v1',field:'roleType',operator:'equals',valueText:'HICC'}],parameters:[{parameterId:'par-hicc',ruleId:'rule-hicc',policyVersionId:'active-2026-v1',name:'rate',valueNumber:2}],tiers:[],inputs:[{ruleInputId:'input-hicc',ruleId:'rule-hicc',policyVersionId:'active-2026-v1',inputName:'units',required:true,source:'course_mapping.unitCount'}]},
      {ruleId:'rule-visc',ruleKey:'role.visc.development',mappingRequirement:'subject',policyVersionId:'active-2026-v1',category:'role',enabled:true,priority:100,calculationMode:'fixed',resultKind:'credit',referenceId:'ref-hicc',reviewStatus:'confirmed_unchanged',selectors:[{selectorId:'sel-visc',ruleId:'rule-visc',policyVersionId:'active-2026-v1',field:'roleType',operator:'equals',valueText:'VISC'}],parameters:[{parameterId:'par-visc',ruleId:'rule-visc',policyVersionId:'active-2026-v1',name:'fixed',valueNumber:5}],tiers:[],inputs:[]}
    ],
    courseMappings:[{mappingId:'course-204',policyVersionId:'active-2026-v1',academicYear:'2026-27',courseCode:'VTMD 204',unitCount:6,referenceId:'ref-hicc',reviewStatus:'confirmed_unchanged',enabled:true}],
    subjectMappings:[{mappingId:'subject-anatomy',policyVersionId:'active-2026-v1',academicYear:'2026-27',subjectKey:'anatomy',curriculumStage:'year_2',referenceId:'ref-hicc',reviewStatus:'confirmed_unchanged',enabled:true}],
    exceptions:[
      {exceptionId:'keep',policyVersionId:'active-2026-v1',facultyId:'f1',fixedDoe:1,reason:'Recurring approved activity',sourceReference:'Dean approval',recurring:true,enabled:true},
      {exceptionId:'drop',policyVersionId:'active-2026-v1',facultyId:'f2',fixedDoe:2,reason:'One-time adjustment',sourceReference:'2026 memo',recurring:false,enabled:true}
    ]
  };
}

function fakeRepository(){
  const stored={drafts:[]};
  return{
    stored,
    async getActivePolicyBundle(year){assert.equal(year,'2026-27');return structuredClone(sourceBundle())},
    async getPolicyForYear(year){return year==='2027-28'?null:sourceBundle().policy},
    async createPolicyYearDraft(payload){stored.drafts.push(structuredClone(payload));return structuredClone(payload)},
    async getPolicyBundleByVersion(id){
      const draft=stored.drafts.find(row=>row.version.policyVersionId===id);
      return draft?structuredClone(draft):null;
    }
  };
}

function ids(){let n=0;return kind=>`${kind}-${++n}`}

test('copy year copies configuration but not history or one-time exceptions',async()=>{
  const repository=fakeRepository();
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids(),clock:()=>new Date('2026-09-19T12:00:00Z')});
  const result=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  assert.equal(result.version.academicYear,'2027-28');
  assert.equal(result.version.status,'draft');
  assert.equal(result.policy.currentActiveVersionId,'');
  assert.equal(result.version.reservePolicy.reviewStatus,'needs_review');
  assert.ok(result.rules.every(row=>row.reviewStatus==='needs_review'));
  assert.ok(result.courseMappings.every(row=>row.reviewStatus==='needs_review'));
  assert.ok(result.subjectMappings.every(row=>row.reviewStatus==='needs_review'));
  assert.ok(result.references.every(row=>row.reviewStatus==='needs_review'));
  assert.equal(result.exceptions.length,1);
  assert.equal(result.exceptions[0].recurring,true);
  assert.notEqual(result.rules[0].ruleId,'rule-hicc');
  assert.notEqual(result.references[0].referenceId,'ref-hicc');
  assert.equal(result.rules[0].referenceId,result.references[0].referenceId);
  assert.equal(result.courseMappings[0].referenceId,result.references[0].referenceId);
  assert.deepEqual(result.publications,[]);
  assert.deepEqual(result.calculationRecords,[]);
  assert.deepEqual(result.impactRuns,[]);
});

test('copy year is General/Owner only and refuses an existing target year',async()=>{
  const repository=fakeRepository();
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  await assert.rejects(()=>service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:regular}),error=>error.code==='FORBIDDEN');
  repository.getPolicyForYear=async year=>year==='2027-28'?{policyId:'already'}:sourceBundle().policy;
  await assert.rejects(()=>service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general}),error=>error.code==='POLICY_YEAR_EXISTS');
});

test('annual validation blocks copied rows still needing review',async()=>{
  const repository=fakeRepository();
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  const copied=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  const report=await service.validateAnnualReview(copied.version.policyVersionId,{activeFacts:[]},{actor:regular});
  assert.equal(report.valid,false);
  assert.ok(report.errors.some(error=>error.code==='ANNUAL_REVIEW_REQUIRED'));
});

test('publish validation blocks active HICC assignments with missing course mapping',async()=>{
  const repository=fakeRepository();
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  const copied=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  const draft=repository.stored.drafts[0];
  for(const group of ['rules','references','courseMappings','subjectMappings'])for(const row of draft[group])row.reviewStatus='confirmed_unchanged';
  draft.courseMappings=[];
  const report=await service.validateAnnualReview(copied.version.policyVersionId,{activeFacts:[
    {facultyId:'f3',category:'role',roleType:'HICC',courseCode:'VTMD 999'}
  ]},{actor:regular});
  assert.equal(report.valid,false);
  assert.ok(report.errors.some(error=>error.code==='COURSE_MAPPING_REQUIRED'));
});

test('annual validation blocks VISC assignment missing subject mapping',async()=>{
  const repository=fakeRepository();
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  const copied=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  const draft=repository.stored.drafts[0];
  for(const group of ['rules','references','courseMappings','subjectMappings'])for(const row of draft[group])row.reviewStatus='confirmed_unchanged';
  draft.subjectMappings=[];
  const report=await service.validateAnnualReview(copied.version.policyVersionId,{activeFacts:[
    {facultyId:'f2',category:'role',roleType:'VISC',subjectKey:'pharmacology'}
  ]},{actor:regular});
  assert.equal(report.valid,false);
  assert.ok(report.errors.some(error=>error.code==='SUBJECT_MAPPING_REQUIRED'));
});

test('fully reviewed complete draft validates successfully',async()=>{
  const repository=fakeRepository();
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  const copied=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  const draft=repository.stored.drafts[0];
  for(const group of ['rules','references','courseMappings','subjectMappings','exceptions'])for(const row of draft[group])row.reviewStatus='confirmed_unchanged';
  draft.version.reservePolicy.reviewStatus='confirmed_unchanged';
  draft.subjectMappings[0].curriculumStage='year_3';
  const report=await service.validateAnnualReview(copied.version.policyVersionId,{activeFacts:[
    {facultyId:'f1',category:'role',roleType:'HICC',courseCode:'VTMD 204'},
    {facultyId:'f2',category:'role',roleType:'VISC',subjectKey:'anatomy'}
  ]},{actor:regular});
  assert.equal(report.valid,true,JSON.stringify(report.errors));
  assert.deepEqual(report.errors,[]);
});

test('Regular admin saves Draft course and subject mappings with authoritative year/version',async()=>{
  const repository=fakeRepository();
  repository.saveDraftCourseMapping=async row=>{repository.stored.savedCourse=structuredClone(row);return structuredClone(row)};
  repository.saveDraftSubjectMapping=async row=>{repository.stored.savedSubject=structuredClone(row);return structuredClone(row)};
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  const copied=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  const versionId=copied.version.policyVersionId;
  const course=await service.saveCourseMapping({policyVersionId:versionId,actor:regular,mapping:{mappingId:'course-204-2027',academicYear:'WRONG',policyVersionId:'WRONG',courseCode:'VTMD 204',unitCount:6,referenceId:copied.references[0].referenceId,reviewStatus:'updated',adminNote:'Confirmed'}});
  const subject=await service.saveSubjectMapping({policyVersionId:versionId,actor:regular,mapping:{mappingId:'visc-anatomy-2027',academicYear:'WRONG',policyVersionId:'WRONG',subjectKey:'anatomy',curriculumStage:'year_3',referenceId:copied.references[0].referenceId,reviewStatus:'updated'}});
  assert.equal(course.academicYear,'2027-28');
  assert.equal(course.policyVersionId,versionId);
  assert.equal(subject.academicYear,'2027-28');
  assert.equal(subject.policyVersionId,versionId);
  assert.equal(repository.stored.savedCourse.unitCount,6);
});

test('mapping saves are Draft-admin only and fail closed on invalid facts',async()=>{
  const repository=fakeRepository();
  repository.saveDraftCourseMapping=async row=>row;
  repository.saveDraftSubjectMapping=async row=>row;
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  const copied=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  const versionId=copied.version.policyVersionId,referenceId=copied.references[0].referenceId;
  await assert.rejects(()=>service.saveCourseMapping({policyVersionId:versionId,actor:faculty,mapping:{mappingId:'c1',courseCode:'VTMD 204',unitCount:6,referenceId}}),error=>error.code==='FORBIDDEN');
  await assert.rejects(()=>service.saveCourseMapping({policyVersionId:versionId,actor:regular,mapping:{mappingId:'c1',courseCode:'VTMD 204',unitCount:0,referenceId}}),error=>error.code==='COURSE_MAPPING_INVALID');
  await assert.rejects(()=>service.saveSubjectMapping({policyVersionId:versionId,actor:regular,mapping:{mappingId:'s1',subjectKey:'anatomy',referenceId:''}}),error=>error.code==='SUBJECT_MAPPING_INVALID');
  repository.stored.drafts[0].version.status='active';
  await assert.rejects(()=>service.saveCourseMapping({policyVersionId:versionId,actor:regular,mapping:{mappingId:'c1',courseCode:'VTMD 204',unitCount:6,referenceId}}),error=>error.code==='POLICY_NOT_DRAFT');
});

test('mapping review state can remain Needs Review and Retired mappings are disabled',async()=>{
  const repository=fakeRepository();
  repository.saveDraftCourseMapping=async row=>structuredClone(row);
  repository.saveDraftSubjectMapping=async row=>structuredClone(row);
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  const copied=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  const versionId=copied.version.policyVersionId,referenceId=copied.references[0].referenceId;
  const pending=await service.saveCourseMapping({policyVersionId:versionId,actor:regular,mapping:{mappingId:'c1',courseCode:'VTMD 204',unitCount:6,referenceId,reviewStatus:'needs_review'}});
  assert.equal(pending.reviewStatus,'needs_review');
  assert.equal(pending.enabled,true);
  const retired=await service.saveSubjectMapping({policyVersionId:versionId,actor:regular,mapping:{mappingId:'s1',subjectKey:'anatomy',referenceId,reviewStatus:'retired',enabled:true}});
  assert.equal(retired.reviewStatus,'retired');
  assert.equal(retired.enabled,false);
});

test('Regular admin can maintain structured references and reserve policy on a Draft',async()=>{
  const repository=fakeRepository();
  repository.saveDraftReference=async row=>{repository.stored.savedReference=structuredClone(row);return structuredClone(row)};
  repository.saveDraftReservePolicy=async (policyVersionId,row)=>{repository.stored.savedReserve=structuredClone(row);return structuredClone(row)};
  const service=createRulebookService({repository,engine:ENGINE,idFactory:ids()});
  const copied=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  const versionId=copied.version.policyVersionId;
  const reference=await service.saveReference({policyVersionId:versionId,actor:regular,reference:{referenceId:'wg-2027-6-4',title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5,effectiveDate:'2027-07-01',reviewStatus:'updated',adminNote:'Annual source'}});
  assert.equal(reference.academicYear,'2027-28');
  assert.equal(reference.policyVersionId,versionId);
  const reserve=await service.saveReservePolicy({policyVersionId:versionId,actor:regular,reservePolicy:{strategy:'flexible_teaching_reserve',splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3,referenceId:'wg-2027-6-4',reviewStatus:'updated'}});
  assert.equal(reserve.splitThreshold,35);
  assert.equal(reserve.policyVersionId,undefined);
  assert.equal(repository.stored.savedReserve.referenceId,'wg-2027-6-4');
});
