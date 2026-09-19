'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRepository}=require('../src/doe/firestore-repository.js');

function fakeDb(seed={}){
  const stores=new Map(Object.entries(seed).map(([name,rows])=>[
    name,new Map(rows.map(row=>[String(row.id||row.__id||row.policyId||row.policyVersionId||row.ruleId||row.referenceId||row.mappingId),{...row}]))
  ]));
  const collection=name=>{
    if(!stores.has(name))stores.set(name,new Map());
    const store=stores.get(name);
    const api={
      doc(id){
        return{
          async get(){
            const row=store.get(String(id));
            return{exists:!!row,id:String(id),data:()=>row?{...row}:undefined};
          },
          async set(value,{merge=false}={}){
            const before=store.get(String(id))||{};
            store.set(String(id),merge?{...before,...value}:{...value});
          }
        };
      },
      where(field,op,value){
        assert.equal(op,'==');
        return{
          async get(){
            const docs=[...store.entries()]
              .filter(([,row])=>row?.[field]===value)
              .map(([id,row])=>({id,data:()=>({...row})}));
            return{docs,empty:docs.length===0};
          }
        };
      },
      async get(){
        const docs=[...store.entries()].map(([id,row])=>({id,data:()=>({...row})}));
        return{docs,empty:docs.length===0};
      }
    };
    return api;
  };
  const runTransaction=async work=>{
    const staged=[];
    const tx={
      async get(ref){return ref.get()},
      set(ref,value,options){staged.push([ref,value,options])}
    };
    const result=await work(tx);
    for(const [ref,value,options] of staged)await ref.set(value,options);
    return result;
  };
  return{collection,runTransaction,_stores:stores};
}

function fixture(){
  return fakeDb({
    doe_policies:[{id:'policy-2027',policyId:'policy-2027',academicYear:'2027-28',currentActiveVersionId:'active-v1'}],
    doe_policy_versions:[{id:'active-v1',policyVersionId:'active-v1',policyId:'policy-2027',academicYear:'2027-28',status:'active'}],
    doe_rules:[{id:'rule-hicc',ruleId:'rule-hicc',policyVersionId:'active-v1',ruleKey:'role.hicc.development',enabled:true}],
    doe_rule_selectors:[{id:'selector-hicc',selectorId:'selector-hicc',policyVersionId:'active-v1',ruleId:'rule-hicc',field:'roleType',operator:'equals',valueText:'HICC'}],
    doe_rule_parameters:[{id:'param-rate',parameterId:'param-rate',policyVersionId:'active-v1',ruleId:'rule-hicc',name:'rate',valueNumber:2}],
    doe_rule_tiers:[],
    doe_rule_inputs:[{id:'input-units',ruleInputId:'input-units',policyVersionId:'active-v1',ruleId:'rule-hicc',inputName:'units',required:true}],
    doe_exceptions:[],
    doe_reference_sources:[{id:'wg-6-4-t3',referenceId:'wg-6-4-t3',policyVersionId:'active-v1',academicYear:'2027-28',title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5,reviewStatus:'confirmed_unchanged'}],
    doe_course_mappings:[{id:'course-204-2027',mappingId:'course-204-2027',policyVersionId:'active-v1',academicYear:'2027-28',courseCode:'VTMD 204',unitCount:6,referenceId:'wg-6-4-t3',reviewStatus:'confirmed_unchanged',enabled:true}],
    doe_subject_mappings:[{id:'visc-anatomy-2027',mappingId:'visc-anatomy-2027',policyVersionId:'active-v1',academicYear:'2027-28',subjectKey:'anatomy',curriculumStage:'year_3',referenceId:'wg-6-4-t3',reviewStatus:'confirmed_unchanged',enabled:true}]
  });
}

test('active policy bundle includes structured references and annual mappings',async()=>{
  const repo=createRepository(fixture());
  const bundle=await repo.getActivePolicyBundle('2027-28');
  assert.equal(bundle.version.status,'active');
  assert.equal(bundle.rules[0].ruleKey,'role.hicc.development');
  assert.equal(bundle.rules[0].parameters[0].valueNumber,2);
  assert.deepEqual(bundle.courseMappings,[{
    mappingId:'course-204-2027',policyVersionId:'active-v1',academicYear:'2027-28',courseCode:'VTMD 204',unitCount:6,referenceId:'wg-6-4-t3',reviewStatus:'confirmed_unchanged',enabled:true
  }]);
  assert.deepEqual(bundle.subjectMappings,[{
    mappingId:'visc-anatomy-2027',policyVersionId:'active-v1',academicYear:'2027-28',subjectKey:'anatomy',curriculumStage:'year_3',referenceId:'wg-6-4-t3',reviewStatus:'confirmed_unchanged',enabled:true
  }]);
  assert.equal(bundle.references[0].referenceId,'wg-6-4-t3');
});

test('annual mapping lookup is academic-year scoped and fail-closed',async()=>{
  const repo=createRepository(fixture());
  assert.equal((await repo.getCourseMapping('2027-28','VTMD 204')).unitCount,6);
  assert.equal(await repo.getCourseMapping('2026-27','VTMD 204'),null);
  assert.equal((await repo.getSubjectMapping('2027-28','anatomy')).curriculumStage,'year_3');
  assert.equal(await repo.getSubjectMapping('2027-28','missing'),null);
});

test('draft configuration writes reject Active versions',async()=>{
  const repo=createRepository(fixture());
  await assert.rejects(
    ()=>repo.saveDraftCourseMapping({mappingId:'new-map',policyVersionId:'active-v1',academicYear:'2027-28',courseCode:'VTMD 999',unitCount:3}),
    error=>error.code==='POLICY_NOT_DRAFT'
  );
});

test('rule inputs use the canonical ruleInputId business key',async()=>{
  const repo=createRepository(fixture());
  const rules=await repo.listRules('active-v1');
  assert.equal(rules[0].inputs[0].ruleInputId,'input-units');
  assert.equal(Object.hasOwn(rules[0].inputs[0],'inputId'),false);
});

test('policy bundle can be loaded directly by Draft version',async()=>{
  const db=fixture();
  db._stores.get('doe_policy_versions').set('draft-v2',{policyVersionId:'draft-v2',policyId:'policy-2027',academicYear:'2027-28',status:'draft'});
  const repo=createRepository(db);
  const bundle=await repo.getPolicyBundleByVersion('draft-v2');
  assert.equal(bundle.policy.policyId,'policy-2027');
  assert.equal(bundle.version.status,'draft');
});

test('annual draft writer persists policy configuration and leaves history out',async()=>{
  const db=fakeDb({doe_policies:[],doe_policy_versions:[],doe_rules:[],doe_rule_selectors:[],doe_rule_parameters:[],doe_rule_tiers:[],doe_rule_inputs:[],doe_exceptions:[],doe_reference_sources:[],doe_course_mappings:[],doe_subject_mappings:[],doe_calculation_records:[],doe_audit_log:[]});
  const repo=createRepository(db);
  const payload={
    policy:{policyId:'p-2028',academicYear:'2028-29',currentActiveVersionId:''},
    version:{policyVersionId:'v-2028',policyId:'p-2028',academicYear:'2028-29',status:'draft'},
    references:[{referenceId:'ref-1',policyVersionId:'v-2028',academicYear:'2028-29',title:'Guide'}],
    rules:[{ruleId:'r1',ruleKey:'teaching.lecture.standard',policyVersionId:'v-2028',selectors:[{selectorId:'s1',ruleId:'r1',policyVersionId:'v-2028'}],parameters:[],tiers:[],inputs:[{ruleInputId:'i1',ruleId:'r1',policyVersionId:'v-2028',inputName:'hours'}]}],
    courseMappings:[],subjectMappings:[],exceptions:[],publications:[{publicationId:'do-not-write'}],calculationRecords:[{calculationId:'do-not-write'}],impactRuns:[{impactRunId:'do-not-write'}]
  };
  await repo.createPolicyYearDraft(payload,{actor:{uid:'g1'}});
  assert.ok(db._stores.get('doe_policies').has('p-2028'));
  assert.ok(db._stores.get('doe_policy_versions').has('v-2028'));
  assert.ok(db._stores.get('doe_rule_inputs').has('i1'));
  assert.equal(db._stores.get('doe_calculation_records').size,0);
  const bundle=await repo.getPolicyBundleByVersion('v-2028');
  assert.equal(bundle.rules[0].inputs[0].ruleInputId,'i1');
});


test('faculty worksheet source joins canonical assignments, evidence, target, and version reserve policy',async()=>{
  const db=fixture();
  db._stores.get('doe_policy_versions').set('active-v1',{
    policyVersionId:'active-v1',policyId:'policy-2027',academicYear:'2027-28',status:'active',
    reservePolicy:{strategy:'flexible_teaching_reserve',splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3,referenceId:'wg-6-3-t2',reviewStatus:'confirmed_unchanged'}
  });
  db._stores.set('faculty',new Map([
    ['f1',{preferredFullName:'Dr Example',academicStream:'research_teaching',active:true}],
    ['f2',{preferredFullName:'Dr No Assignments',academicStream:'research_teaching',active:true}]
  ]));
  db._stores.set('doe_faculty_targets',new Map([
    ['target-f1',{targetId:'target-f1',academicYear:'2027-28',facultyId:'f1',contractTeachingDoe:40,effectiveTargetDoe:40,source:'contract',policyVersionId:'active-v1'}]
  ]));
  db._stores.set('doe_calculation_records',new Map([
    ['calc-session',{calculationId:'calc-session',academicYear:'2027-28',facultyId:'f1',policyVersionId:'active-v1',ruleId:'r-lec',ruleKey:'teaching.lecture.standard',category:'teaching',resultDoe:.6,calculationText:'2 hours × 0.30% = 0.60%',referenceSnapshot:{title:'UCVM Workload Guidelines',section:'6.2',table:'Table 1',page:3},inputsSnapshot:{hours:2},calculatedAt:'2027-01-10T10:00:00Z'}],
    ['calc-hicc',{calculationId:'calc-hicc',academicYear:'2027-28',facultyId:'f1',policyVersionId:'active-v1',ruleId:'r-hicc',ruleKey:'role.hicc.development',category:'role',resultDoe:12,calculationText:'6 units × 2.00% = 12.00%',referenceSnapshot:{title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5},inputsSnapshot:{units:6},calculatedAt:'2027-01-11T10:00:00Z'}]
  ]));
  db._stores.set('doe_assignments',new Map([
    ['role-1',{assignmentFactId:'role-1',academicYear:'2027-28',facultyId:'f1',category:'role',roleType:'HICC',courseCode:'VTMD 204',label:'HICC · VTMD 204',doeCredit:12,doePolicyVersionId:'active-v1',doeRuleId:'r-hicc',doeRuleKey:'role.hicc.development',doeCalculationId:'calc-hicc',active:true}]
  ]));
  db._stores.set('sessions',new Map([
    ['session-1',{academicYear:'2027-28',course:'VTMD 301',type:'LEC',assignments:[{assignmentId:'a1',facultyId:'f1',teachingRole:'Lecture',creditedHours:2,doeCredit:.6,doePolicyVersionId:'active-v1',doeRuleId:'r-lec',doeRuleKey:'teaching.lecture.standard',doeCalculationId:'calc-session'}]}]
  ]));
  const repo=createRepository(db);
  const source=await repo.getFacultyWorksheetSource('f1','2027-28');
  assert.equal(source.displayName,'Dr Example');
  assert.equal(source.stream,'research_teaching');
  assert.equal(source.target.effectiveTargetDoe,40);
  assert.equal(source.reservePolicy.splitThreshold,35);
  assert.equal(source.lines.length,2);
  assert.deepEqual(source.lines.map(row=>row.ruleKey).sort(),['role.hicc.development','teaching.lecture.standard']);
  assert.equal(source.lines.find(row=>row.ruleKey==='role.hicc.development').reference.page,5);
  assert.equal(source.lines.find(row=>row.ruleKey==='teaching.lecture.standard').calculationText,'2 hours × 0.30% = 0.60%');
  assert.deepEqual(await repo.listFacultyIdsForDoe('2027-28'),['f1','f2']);
});

test('worksheet source fails closed when persisted rows span policy versions',async()=>{
  const db=fixture();
  db._stores.get('doe_policy_versions').set('active-v1',{policyVersionId:'active-v1',policyId:'policy-2027',academicYear:'2027-28',status:'active',reservePolicy:{splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3}});
  db._stores.set('faculty',new Map([['f1',{preferredFullName:'Dr Example',active:true}]]));
  db._stores.set('doe_faculty_targets',new Map([['target-f1',{targetId:'target-f1',academicYear:'2027-28',facultyId:'f1',effectiveTargetDoe:40,policyVersionId:'active-v1'}]]));
  db._stores.set('doe_assignments',new Map([['r1',{assignmentFactId:'r1',academicYear:'2027-28',facultyId:'f1',category:'role',doeCredit:2,doePolicyVersionId:'old-v0',doeCalculationId:'c1',active:true}]]));
  db._stores.set('sessions',new Map());
  db._stores.set('doe_calculation_records',new Map());
  const source=await createRepository(db).getFacultyWorksheetSource('f1','2027-28');
  assert.equal(source.policyStatus,'mixed');
  assert.equal(source.reservePolicy,null);
});

test('worksheet line fails closed when canonical DOE and immutable evidence disagree or evidence is missing',async()=>{
  const db=fixture();
  db._stores.get('doe_policy_versions').set('active-v1',{policyVersionId:'active-v1',policyId:'policy-2027',academicYear:'2027-28',status:'active',reservePolicy:{splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3}});
  db._stores.set('faculty',new Map([['f1',{preferredFullName:'Dr Example',active:true}]]));
  db._stores.set('doe_faculty_targets',new Map([['target-f1',{targetId:'target-f1',academicYear:'2027-28',facultyId:'f1',effectiveTargetDoe:40,policyVersionId:'active-v1'}]]));
  db._stores.set('doe_assignments',new Map([
    ['mismatch',{assignmentFactId:'mismatch',academicYear:'2027-28',facultyId:'f1',category:'role',doeCredit:12,doePolicyVersionId:'active-v1',doeRuleId:'r1',doeRuleKey:'role.hicc.development',doeCalculationId:'c1',active:true}],
    ['missing-evidence',{assignmentFactId:'missing-evidence',academicYear:'2027-28',facultyId:'f1',category:'role',doeCredit:2,doePolicyVersionId:'active-v1',doeRuleId:'r2',doeRuleKey:'role.rotation.coordinator',doeCalculationId:'missing-calc',active:true}]
  ]));
  db._stores.set('doe_calculation_records',new Map([
    ['c1',{calculationId:'c1',academicYear:'2027-28',facultyId:'f1',policyVersionId:'active-v1',ruleId:'r1',ruleKey:'role.hicc.development',category:'role',resultDoe:11.5}]
  ]));
  db._stores.set('sessions',new Map());
  const source=await createRepository(db).getFacultyWorksheetSource('f1','2027-28');
  const mismatch=source.lines.find(row=>row.lineId==='mismatch');
  const missing=source.lines.find(row=>row.lineId==='missing-evidence');
  assert.equal(mismatch.status,'error');
  assert.equal(mismatch.errorCode,'DOE_EVIDENCE_MISMATCH');
  assert.equal(missing.status,'needs_review');
  assert.equal(missing.errorCode,'CALCULATION_EVIDENCE_MISSING');
});


test('role assignment persistence atomically stores canonical assignment and immutable evidence',async()=>{
  const db=fakeDb({doe_assignments:[],doe_calculation_records:[],doe_audit_log:[]});
  const repo=createRepository(db);
  await repo.saveDoeAssignmentCalculation({
    assignment:{assignmentFactId:'role-1',academicYear:'2027-28',facultyId:'f1',category:'role',roleType:'HICC',courseCode:'VTMD 204',doeCredit:12,doePolicyVersionId:'v1',doeRuleId:'r1',doeRuleKey:'role.hicc.development',doeCalculationId:'calc-1',active:true},
    calculationRecord:{calculationId:'calc-1',academicYear:'2027-28',facultyId:'f1',policyVersionId:'v1',ruleId:'r1',ruleKey:'role.hicc.development',resultDoe:12},
    auditRecord:{auditId:'role-save-role-1-calc-1',policyVersionId:'v1',action:'doe_assignment_saved',entityType:'doe_assignment',entityId:'role-1'}
  });
  assert.equal(db._stores.get('doe_assignments').get('role-1').doeCredit,12);
  assert.equal(db._stores.get('doe_calculation_records').get('calc-1').resultDoe,12);
  assert.equal(db._stores.get('doe_audit_log').get('role-save-role-1-calc-1').entityId,'role-1');
  await assert.rejects(()=>repo.saveDoeAssignmentCalculation({
    assignment:{assignmentFactId:'role-1',doeCredit:13},
    calculationRecord:{calculationId:'calc-1',resultDoe:13},
    auditRecord:{auditId:'duplicate'}
  }),error=>error.code==='EVIDENCE_ALREADY_EXISTS');
});

test('server repository loads canonical timetable sessions by document ID',async()=>{
  const db=fixture();
  db._stores.set('sessions',new Map([['s1',{academicYear:'2027-28',course:'VTMD 505',assignments:[]}]]));
  const session=await createRepository(db).getSession('s1');
  assert.equal(session.sessionId,'s1');
  assert.equal(session.course,'VTMD 505');
  assert.equal(await createRepository(db).getSession('missing'),null);
});

test('session DOE bundle persistence is atomic and calculation evidence is immutable',async()=>{
  const db=fakeDb({sessions:[{id:'s1',academicYear:'2027-28',course:'VTMD 505',assignments:[]}],calendar_sessions:[],doe_calculation_records:[],doe_audit_log:[]});
  const repo=createRepository(db);
  await repo.saveSessionCalculationBundle({
    session:{sessionId:'s1',academicYear:'2027-28',course:'VTMD 505',date:'2027-09-10',start:'09:00',end:'12:00',type:'LAB',topic:'Topic',room:'A101',assignments:[{assignmentId:'a1',facultyId:'f2',doeCredit:.57,doeCalculationId:'calc-s1'}]},
    calculationRecords:[{calculationId:'calc-s1',academicYear:'2027-28',facultyId:'f2',resultDoe:.57}],
    auditRecord:{auditId:'session-doe-s1',action:'session_doe_saved',entityType:'session',entityId:'s1'}
  });
  assert.equal(db._stores.get('sessions').get('s1').assignments[0].doeCredit,.57);
  assert.equal(db._stores.get('doe_calculation_records').get('calc-s1').resultDoe,.57);
  assert.equal(db._stores.get('doe_audit_log').get('session-doe-s1').entityId,'s1');
  assert.equal(db._stores.get('calendar_sessions').get('s1').sessionId,'s1');
  await assert.rejects(()=>repo.saveSessionCalculationBundle({
    session:{sessionId:'s1',assignments:[]},calculationRecords:[{calculationId:'calc-s1',resultDoe:9}],auditRecord:{auditId:'session-doe-s1-2'}
  }),error=>error.code==='EVIDENCE_ALREADY_EXISTS');
});


test('bulk Faculty DOE worksheet source loads all active faculty from one annual dataset',async()=>{
  const db=fixture();
  db._stores.get('doe_policy_versions').set('active-v1',{policyVersionId:'active-v1',policyId:'policy-2027',academicYear:'2027-28',status:'active',reservePolicy:{splitThreshold:35,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3}});
  db._stores.set('faculty',new Map([
    ['f1',{preferredFullName:'Dr One',academicStream:'research_teaching',active:true}],
    ['f2',{preferredFullName:'Dr Two',academicStream:'research_teaching',active:true}],
    ['inactive',{preferredFullName:'Inactive',active:false}]
  ]));
  db._stores.set('doe_faculty_targets',new Map([
    ['t1',{targetId:'t1',academicYear:'2027-28',facultyId:'f1',effectiveTargetDoe:40,policyVersionId:'active-v1'}],
    ['t2',{targetId:'t2',academicYear:'2027-28',facultyId:'f2',effectiveTargetDoe:30,policyVersionId:'active-v1'}]
  ]));
  db._stores.set('doe_assignments',new Map());
  db._stores.set('doe_calculation_records',new Map());
  db._stores.set('sessions',new Map());
  const rows=await createRepository(db).listFacultyWorksheetSources('2027-28');
  assert.deepEqual(rows.map(row=>row.facultyId),['f1','f2']);
  assert.deepEqual(rows.map(row=>row.target.effectiveTargetDoe),[40,30]);
});

test('Draft mapping mutation increments revision and invalidates validation/impact evidence',async()=>{
  const db=fixture();
  db._stores.get('doe_policy_versions').set('draft-v2',{
    policyVersionId:'draft-v2',policyId:'policy-2027',academicYear:'2027-28',status:'draft',revision:4,
    lastValidationPassed:true,lastValidatedRevision:4,lastValidatedChecksum:'old',rulesChecksum:'old',
    lastImpactRunId:'impact-old',lastImpactRevision:4,lastImpactChecksum:'old',lastImpactDatasetChecksum:'dataset-old',annualValidationValid:true
  });
  const repo=createRepository(db);
  await repo.saveDraftCourseMapping({mappingId:'course-new',policyVersionId:'draft-v2',academicYear:'2027-28',courseCode:'VTMD 999',unitCount:3,referenceId:'ref1',reviewStatus:'updated',enabled:true});
  const version=db._stores.get('doe_policy_versions').get('draft-v2');
  assert.equal(version.revision,5);
  assert.equal(version.lastValidationPassed,false);
  assert.equal(version.lastImpactRunId,'');
  assert.equal(version.annualValidationValid,false);
  assert.equal(db._stores.get('doe_course_mappings').get('course-new').unitCount,3);
});

test('Faculty target persistence stores canonical target plus audit atomically',async()=>{
 const db=fakeDb({doe_faculty_targets:[],doe_audit_log:[]}),repo=createRepository(db);
 await repo.saveFacultyTarget({target:{targetId:'f1--2027-28',facultyId:'f1',academicYear:'2027-28',effectiveTargetDoe:25},auditRecord:{auditId:'target-f1-1',action:'faculty_doe_target_saved',entityType:'faculty_doe_target',entityId:'f1--2027-28'}});
 assert.equal(db._stores.get('doe_faculty_targets').get('f1--2027-28').effectiveTargetDoe,25);
 assert.equal(db._stores.get('doe_audit_log').get('target-f1-1').action,'faculty_doe_target_saved');
});

test('2026-27 worksheet uses legacy target only as migration fallback when canonical target is absent',async()=>{
 const db=fakeDb({
  faculty:[{id:'f1',preferredFullName:'Dr Legacy',active:true,doe:{teaching:40},doeOverride2026_27:{value:25,reason:'RSL',notes:'Approved legacy'}}],
  doe_faculty_targets:[],doe_assignments:[],doe_calculation_records:[],sessions:[],doe_policy_versions:[]
 });
 const repo=createRepository(db),source=await repo.getFacultyWorksheetSource('f1','2026-27');
 assert.equal(source.target.contractTeachingDoe,40);
 assert.equal(source.target.overrideDoe,25);
 assert.equal(source.target.overrideReason,'RSL');
 assert.equal(source.target.effectiveTargetDoe,25);
 assert.equal(source.target.source,'legacy_override');
 assert.equal(source.target.targetId,'');
});

test('Faculty target audit captures the previous canonical target inside the atomic write',async()=>{
 const db=fakeDb({
  doe_faculty_targets:[{id:'f1--2027-28',targetId:'f1--2027-28',facultyId:'f1',academicYear:'2027-28',effectiveTargetDoe:40,source:'contract'}],
  doe_audit_log:[]
 }),repo=createRepository(db);
 await repo.saveFacultyTarget({
  target:{targetId:'f1--2027-28',facultyId:'f1',academicYear:'2027-28',effectiveTargetDoe:25,source:'approved_override'},
  auditRecord:{auditId:'target-change-1',action:'faculty_doe_target_saved',entityType:'faculty_doe_target',entityId:'f1--2027-28',before:null}
 });
 const audit=db._stores.get('doe_audit_log').get('target-change-1');
 assert.equal(audit.before.effectiveTargetDoe,40);
 assert.equal(audit.after.effectiveTargetDoe,25);
});
