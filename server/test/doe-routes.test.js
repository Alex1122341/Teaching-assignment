'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDoeRoutes}=require('../src/routes/doe-routes.js');

const general={uid:'g',role:'adfa_general'};
const regular={uid:'r',role:'adfa_regular'};
const faculty={uid:'f',role:'faculty',facultyId:'f1'};

test('preview-assignment never persists calculation evidence',async()=>{
 const calls=[];
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async input=>{calls.push(input);return{resultDoe:.6}}}});
 const result=await routes.handle({method:'POST',path:'/api/doe/preview-assignment',actor:faculty,body:{academicYear:'2027-28',facts:{hours:2}}});
 assert.equal(result.statusCode,200);
 assert.equal(result.body.resultDoe,.6);
 assert.equal(calls[0].persist,false);
});

test('calculate persists only for DOE administrators',async()=>{
 const calls=[];
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async input=>{calls.push(input);return{resultDoe:.6,calculationId:'c1'}}}});
 const denied=await routes.handle({method:'POST',path:'/api/doe/calculate',actor:faculty,body:{academicYear:'2027-28',facts:{hours:2}}});
 assert.equal(denied.statusCode,403);
 assert.equal(denied.body.code,'FORBIDDEN');
 const ok=await routes.handle({method:'POST',path:'/api/doe/calculate',actor:general,body:{academicYear:'2027-28',facts:{hours:2}}});
 assert.equal(ok.statusCode,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].persist,true);
});

test('annual policy copy is routed only for General administrators',async()=>{
 const calls=[];
 const routes=createDoeRoutes({
  calculationService:{calculateAssignment:async()=>({})},
  rulebookService:{
   copyAcademicYear:async input=>{calls.push(['copy',input]);return{version:{policyVersionId:'draft-2027'}}},
   validateAnnualReview:async()=>({valid:true,errors:[]})
  }
 });
 const denied=await routes.handle({method:'POST',path:'/api/doe/policy-years/2027-28/copy-from/2026-27',actor:regular,body:{}});
 assert.equal(denied.statusCode,403);
 const ok=await routes.handle({method:'POST',path:'/api/doe/policy-years/2027-28/copy-from/2026-27',actor:general,body:{}});
 assert.equal(ok.statusCode,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0][1].sourceYear,'2026-27');
 assert.equal(calls[0][1].targetYear,'2027-28');
});

test('annual draft validation routes dataset to rulebook service',async()=>{
 const calls=[];
 const routes=createDoeRoutes({
  calculationService:{calculateAssignment:async()=>({})},
  rulebookService:{
   copyAcademicYear:async()=>({}),
   validateAnnualReview:async(...args)=>{calls.push(args);return{valid:false,errors:[{code:'COURSE_MAPPING_REQUIRED'}]}}
  }
 });
 const response=await routes.handle({method:'POST',path:'/api/doe/drafts/draft-2027/validate',actor:regular,body:{dataset:{activeFacts:[{roleType:'HICC'}]}}});
 assert.equal(response.statusCode,200);
 assert.equal(response.body.valid,false);
 assert.equal(calls[0][0],'draft-2027');
 assert.equal(calls[0][1],undefined);
 assert.equal(calls[0][2].actor.uid,regular.uid);
});


test('role assignment save is server-authoritative and admin-only',async()=>{
 const calls=[];
 const routes=createDoeRoutes({calculationService:{
  calculateAssignment:async()=>({}),
  saveRoleAssignment:async input=>{calls.push(input);return{assignment:{assignmentFactId:'role-1',doeCredit:12}}}
 }});
 const denied=await routes.handle({method:'POST',path:'/api/doe/role-assignments',actor:faculty,body:{academicYear:'2027-28',facultyId:'f1',facts:{roleType:'HICC',courseCode:'VTMD 204',doeCredit:99}}});
 assert.equal(denied.statusCode,403);
 const ok=await routes.handle({method:'POST',path:'/api/doe/role-assignments',actor:general,body:{academicYear:'2027-28',facultyId:'f1',facts:{roleType:'HICC',courseCode:'VTMD 204',doeCredit:99}}});
 assert.equal(ok.statusCode,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].facultyId,'f1');
 assert.equal(calls[0].facts.doeCredit,99);
});

test('workflow preview routes return server-projected DOE and remain authenticated',async()=>{
 const calls=[];
 const routes=createDoeRoutes({
  calculationService:{calculateAssignment:async()=>({})},
  workflowPreviewService:{
   previewSessionChange:async input=>{calls.push(['session',input]);return{session:{id:'s1'}}},
   previewFacultyTransfer:async input=>{calls.push(['transfer',input]);return{incoming:{projectedAssignedDoe:10.57}}}
  }
 });
 const session=await routes.handle({method:'POST',path:'/api/doe/session-changes/preview',actor:general,body:{academicYear:'2027-28',afterSession:{id:'s1'}}});
 const transfer=await routes.handle({method:'POST',path:'/api/doe/faculty-transfer/preview',actor:general,body:{academicYear:'2027-28',sessionId:'s1',assignmentId:'a1',incomingFacultyId:'f2'}});
 assert.equal(session.statusCode,200);
 assert.equal(transfer.statusCode,200);
 assert.equal(transfer.body.incoming.projectedAssignedDoe,10.57);
 assert.equal(calls.length,2);
});

test('session change save is server-authoritative and admin-only',async()=>{
 const calls=[];
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},workflowPreviewService:{
  previewSessionChange:async()=>({}),previewFacultyTransfer:async()=>({}),
  saveSessionChange:async input=>{calls.push(input);return{session:{id:'s1',assignments:[{doeCredit:.57}]}}}
 }});
 const denied=await routes.handle({method:'POST',path:'/api/doe/session-changes',actor:faculty,body:{sessionId:'s1',afterSession:{assignments:[{doeCredit:99}]}}});
 assert.equal(denied.statusCode,403);
 const ok=await routes.handle({method:'POST',path:'/api/doe/session-changes',actor:general,body:{sessionId:'s1',afterSession:{assignments:[{doeCredit:99}]}}});
 assert.equal(ok.statusCode,200);
 assert.equal(ok.body.session.assignments[0].doeCredit,.57);
 assert.equal(calls.length,1);
});

test('policy administration routes delegate calculations to server policy service with role gates',async()=>{
 const calls=[];
 const policyAdminService={
  createPolicyYear:async input=>{calls.push(['create',input]);return{policy:{academicYear:input.academicYear}}},
  cloneDraft:async input=>{calls.push(['clone',input]);return{version:{policyVersionId:'v2'}}},
  validateDraft:async input=>{calls.push(['validate-policy',input]);return{valid:true,errors:[],warnings:[]}},
  testRule:async input=>{calls.push(['test-rule',input]);return{resultDoe:.6}},
  runImpactPreview:async input=>{calls.push(['impact',input]);return{status:'passed'}},
  publish:async input=>{calls.push(['publish',input]);return{status:'active'}},
  archive:async input=>{calls.push(['archive',input]);return{status:'archived'}},
  previewRecalculate:async input=>{calls.push(['recalc-preview',input]);return{errors:[],warnings:[]}},
  runRecalculate:async input=>{calls.push(['recalc',input]);return{batchId:'b1'}}
 };
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},policyAdminService});
 const create=await routes.handle({method:'POST',path:'/api/doe/policy-years',actor:regular,body:{academicYear:'2027-28'}});
 const clone=await routes.handle({method:'POST',path:'/api/doe/policy-versions/v1/clone',actor:regular,body:{}});
 const validate=await routes.handle({method:'POST',path:'/api/doe/drafts/v1/validate',actor:regular,body:{}});
 const testRule=await routes.handle({method:'POST',path:'/api/doe/drafts/v1/test-rule',actor:regular,body:{rule:{ruleId:'r1'},sample:{hours:2}}});
 const impact=await routes.handle({method:'POST',path:'/api/doe/drafts/v1/impact-preview',actor:regular,body:{}});
 const deniedPublish=await routes.handle({method:'POST',path:'/api/doe/drafts/v1/publish',actor:regular,body:{}});
 const publish=await routes.handle({method:'POST',path:'/api/doe/drafts/v1/publish',actor:general,body:{}});
 const archive=await routes.handle({method:'POST',path:'/api/doe/policy-versions/v1/archive',actor:general,body:{}});
 const previewRecalc=await routes.handle({method:'POST',path:'/api/doe/recalculate/preview',actor:general,body:{academicYear:'2027-28',policyVersionId:'v1',scope:'all'}});
 const recalc=await routes.handle({method:'POST',path:'/api/doe/recalculate',actor:general,body:{academicYear:'2027-28',policyVersionId:'v1',scope:'all'}});
 assert.equal(create.statusCode,200);
 assert.equal(clone.statusCode,200);
 assert.equal(validate.statusCode,200);
 assert.equal(testRule.body.resultDoe,.6);
 assert.equal(impact.statusCode,200);
 assert.equal(deniedPublish.statusCode,403);
 assert.equal(publish.statusCode,200);
 assert.equal(archive.statusCode,200);
 assert.equal(previewRecalc.statusCode,200);
 assert.equal(recalc.statusCode,200);
 assert.ok(calls.some(row=>row[0]==='validate-policy'&&row[1].actor.uid===regular.uid));
 assert.ok(calls.some(row=>row[0]==='publish'&&row[1].actor.uid===general.uid));
 assert.ok(calls.some(row=>row[0]==='recalc'&&row[1].actor.uid===general.uid));
});


test('policy administration read and Draft-write routes stay behind the server boundary',async()=>{
 const calls=[];
 const policyAdminService={
  listPolicies:async input=>{calls.push(['policies',input]);return[{policyId:'p1'}]},
  listVersions:async input=>{calls.push(['versions',input]);return[{policyVersionId:'v1'}]},
  loadPolicyBundle:async input=>{calls.push(['bundle',input]);return{version:{policyVersionId:input.policyVersionId},rules:[],exceptions:[]}},
  getImpactPreview:async input=>{calls.push(['impact-read',input]);return{impactRunId:input.impactRunId,rows:[]}},
  saveRule:async input=>{calls.push(['save-rule',input]);return{rule:input.rule}},
  saveException:async input=>{calls.push(['save-exception',input]);return{exception:input.exception}}
 };
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},policyAdminService});
 assert.equal((await routes.handle({method:'GET',path:'/api/doe/policies',actor:regular})).statusCode,200);
 assert.equal((await routes.handle({method:'GET',path:'/api/doe/policies/p1/versions',actor:regular})).body[0].policyVersionId,'v1');
 assert.equal((await routes.handle({method:'GET',path:'/api/doe/policy-versions/v1/bundle',actor:regular})).body.version.policyVersionId,'v1');
 assert.equal((await routes.handle({method:'GET',path:'/api/doe/impact-runs/i1',actor:regular})).body.impactRunId,'i1');
 assert.equal((await routes.handle({method:'PUT',path:'/api/doe/drafts/v1/rules/r1',actor:regular,body:{rule:{ruleId:'r1'}}})).statusCode,200);
 assert.equal((await routes.handle({method:'PUT',path:'/api/doe/drafts/v1/exceptions/e1',actor:regular,body:{exception:{exceptionId:'e1'}}})).statusCode,200);
 assert.ok(calls.some(row=>row[0]==='save-rule'&&row[1].actor.uid===regular.uid));
});


test('faculty DOE worksheet is self-only for Faculty/HICC/VISC and DOE list is admin-only',async()=>{
 const calls=[];
 const worksheetService={
  buildFacultyWorksheet:async input=>{calls.push(['worksheet',input]);return{facultyId:input.facultyId,status:'calculated'}},
  listFacultyDoe:async input=>{calls.push(['list',input]);return[{facultyId:'f1'}]}
 };
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},worksheetService});
 const own=await routes.handle({method:'GET',path:'/api/doe/faculty/f1/worksheet',actor:faculty,query:{academicYear:'2027-28'}});
 assert.equal(own.statusCode,200);
 const other=await routes.handle({method:'GET',path:'/api/doe/faculty/f2/worksheet',actor:faculty,query:{academicYear:'2027-28'}});
 assert.equal(other.statusCode,403);
 const facultyList=await routes.handle({method:'GET',path:'/api/doe/list',actor:faculty,query:{academicYear:'2027-28'}});
 assert.equal(facultyList.statusCode,403);
 const adminOther=await routes.handle({method:'GET',path:'/api/doe/faculty/f2/worksheet',actor:general,query:{academicYear:'2027-28'}});
 assert.equal(adminOther.statusCode,200);
 const adminList=await routes.handle({method:'GET',path:'/api/doe/list',actor:general,query:{academicYear:'2027-28'}});
 assert.equal(adminList.statusCode,200);
 assert.deepEqual(calls.map(row=>row[0]),['worksheet','worksheet','list']);
});

test('Draft mapping routes delegate to Rule Book service and enforce admin access',async()=>{
 const calls=[];
 const rulebookService={
  saveCourseMapping:async input=>{calls.push(['course',input]);return{...input.mapping,academicYear:'2027-28',policyVersionId:input.policyVersionId}},
  saveSubjectMapping:async input=>{calls.push(['subject',input]);return{...input.mapping,academicYear:'2027-28',policyVersionId:input.policyVersionId}}
 };
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},rulebookService});
 const denied=await routes.handle({method:'PUT',path:'/api/doe/drafts/v1/course-mappings/c1',actor:faculty,body:{mapping:{mappingId:'c1',courseCode:'VTMD 204',unitCount:6,referenceId:'ref1'}}});
 assert.equal(denied.statusCode,403);
 const course=await routes.handle({method:'PUT',path:'/api/doe/drafts/v1/course-mappings/c1',actor:regular,body:{mapping:{mappingId:'client-wrong',courseCode:'VTMD 204',unitCount:6,referenceId:'ref1'}}});
 const subject=await routes.handle({method:'PUT',path:'/api/doe/drafts/v1/subject-mappings/s1',actor:regular,body:{mapping:{mappingId:'client-wrong',subjectKey:'anatomy',curriculumStage:'year_3',referenceId:'ref1'}}});
 assert.equal(course.statusCode,200);
 assert.equal(subject.statusCode,200);
 assert.equal(calls[0][1].mapping.mappingId,'c1');
 assert.equal(calls[1][1].mapping.mappingId,'s1');
 assert.equal(calls[0][1].actor.uid,regular.uid);
});

test('Draft Reference and Reserve routes use Rule Book service with admin role gates',async()=>{
 const calls=[];
 const rulebookService={
  saveReference:async input=>{calls.push(['reference',input]);return input.reference},
  saveReservePolicy:async input=>{calls.push(['reserve',input]);return input.reservePolicy}
 };
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},rulebookService});
 const denied=await routes.handle({method:'PUT',path:'/api/doe/drafts/v1/references/ref1',actor:faculty,body:{reference:{referenceId:'ref1',title:'Guide'}}});
 assert.equal(denied.statusCode,403);
 const ref=await routes.handle({method:'PUT',path:'/api/doe/drafts/v1/references/ref1',actor:regular,body:{reference:{referenceId:'wrong',title:'Guide',section:'6.4'}}});
 const reserve=await routes.handle({method:'PUT',path:'/api/doe/drafts/v1/reserve-policy',actor:regular,body:{reservePolicy:{splitThreshold:35}}});
 assert.equal(ref.statusCode,200);
 assert.equal(reserve.statusCode,200);
 assert.equal(calls[0][1].reference.referenceId,'ref1');
 assert.equal(calls[1][1].policyVersionId,'v1');
});

test('Faculty target writes are server-authoritative and admin-only',async()=>{
 const calls=[],targetService={saveFacultyTarget:async input=>{calls.push(input);return{facultyId:input.facultyId,effectiveTargetDoe:25}}};
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},targetService});
 const denied=await routes.handle({method:'PUT',path:'/api/doe/faculty/f1/target',actor:faculty,body:{academicYear:'2027-28',override:{value:25,reason:'RSL'},contractTeachingDoe:99}});
 assert.equal(denied.statusCode,403);
 const ok=await routes.handle({method:'PUT',path:'/api/doe/faculty/f1/target',actor:regular,body:{academicYear:'2027-28',override:{value:25,reason:'RSL'},contractTeachingDoe:99}});
 assert.equal(ok.statusCode,200);
 assert.equal(calls[0].facultyId,'f1');
 assert.equal(Object.hasOwn(calls[0],'contractTeachingDoe'),false);
});

test('policy year read route is admin-only and returns server policy year view',async()=>{
 const calls=[],policyAdminService={async getPolicyYear(input){calls.push(input);return{policy:{policyId:'p27',academicYear:'2027-28'},versions:[]}}};
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},policyAdminService});
 const denied=await routes.handle({method:'GET',path:'/api/doe/policy-years/2027-28',actor:faculty});
 assert.equal(denied.statusCode,403);
 const ok=await routes.handle({method:'GET',path:'/api/doe/policy-years/2027-28',actor:general});
 assert.equal(ok.statusCode,200);
 assert.equal(ok.body.policy.policyId,'p27');
 assert.equal(calls[0].academicYear,'2027-28');
});


test('Rule Book audit history is admin-only and version scoped',async()=>{
 const calls=[],policyAdminService={async listAudit(input){calls.push(input);return[{auditId:'a1',policyVersionId:input.policyVersionId}]}};
 const routes=createDoeRoutes({calculationService:{calculateAssignment:async()=>({})},policyAdminService});
 const denied=await routes.handle({method:'GET',path:'/api/doe/policy-versions/v1/audit',actor:faculty});
 assert.equal(denied.statusCode,403);
 const ok=await routes.handle({method:'GET',path:'/api/doe/policy-versions/v1/audit',actor:regular});
 assert.equal(ok.statusCode,200);
 assert.equal(ok.body[0].policyVersionId,'v1');
 assert.equal(calls[0].actor.uid,regular.uid);
});
