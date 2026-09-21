'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
const check=(name,fn)=>test('DOE policy security: '+name,{skip:!enabled},fn);
const FIRESTORE_ADAPTER=enabled?require('../doe-policy-firestore.js'):null;
const DOE_ENGINE=enabled?require('../doe-policy-engine.js'):null;
const DOE_SERVICE=enabled?require('../doe-policy-service.js'):null;
let env;

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({
  projectId:'demo-ucvm-doe-policy',
  firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}
 });
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  const users=[
   ['general','adfa_general'],['owner','owner'],['regular','adfa_regular'],
   ['legacy-admin','administrator'],['other','other_office'],
   ['faculty','faculty'],['hicc','hicc'],['visc','visc'],['adc','adc'],['lab','lab']
  ];
  for(const [uid,role] of users){
   await db.doc(`users/${uid}`).set({role,active:true,mustChangePassword:false,email:`${uid}@example.test`});
  }
  await db.doc('doe_policies/ucvm-workload-2027-28').set({
   policyId:'ucvm-workload-2027-28',academicYear:'2027-28',name:'UCVM Workload Policy 2027-28',
   currentActiveVersionId:'ucvm-workload-2027-28-v1'
  });
  await db.doc('doe_policy_versions/ucvm-workload-2027-28-v1').set({
   policyVersionId:'ucvm-workload-2027-28-v1',policyId:'ucvm-workload-2027-28',
   academicYear:'2027-28',versionNumber:1,status:'active',revision:1,lastImpactRunId:''
  });
  await db.doc('doe_policy_versions/ucvm-workload-2027-28-v2').set({
   policyVersionId:'ucvm-workload-2027-28-v2',policyId:'ucvm-workload-2027-28',
   academicYear:'2027-28',versionNumber:2,status:'draft',revision:1,lastImpactRunId:'old-preview'
  });
  await db.doc('doe_rules/r-active').set({
   ruleId:'r-active',policyVersionId:'ucvm-workload-2027-28-v1',
   ruleKey:'teaching.lecture.standard',category:'teaching',calculationMode:'per_hour',
   resultKind:'credit',priority:100,enabled:true
  });
  await db.doc('doe_rules/r-draft').set({
   ruleId:'r-draft',policyVersionId:'ucvm-workload-2027-28-v2',
   ruleKey:'teaching.lecture.standard',category:'teaching',calculationMode:'per_hour',
   resultKind:'credit',priority:100,enabled:true
  });
  await db.doc('doe_policies/ucvm-workload-2028-29').set({
   policyId:'ucvm-workload-2028-29',academicYear:'2028-29',name:'UCVM Workload Policy 2028-29',
   currentActiveVersionId:'ucvm-workload-2028-29-v1'
  });
  await db.doc('doe_policy_versions/ucvm-workload-2028-29-v1').set({
   policyVersionId:'ucvm-workload-2028-29-v1',policyId:'ucvm-workload-2028-29',
   academicYear:'2028-29',versionNumber:1,status:'active',revision:1
  });
  await db.doc('doe_policy_versions/ucvm-workload-2028-29-v2').set({
   policyVersionId:'ucvm-workload-2028-29-v2',policyId:'ucvm-workload-2028-29',
   academicYear:'2028-29',versionNumber:2,status:'draft',revision:1,
   lastImpactRunId:'',lastValidatedRevision:null,rulesChecksum:''
  });
  await db.doc('doe_rules/r-2028-lecture').set({
   ruleId:'r-2028-lecture',policyVersionId:'ucvm-workload-2028-29-v2',
   ruleKey:'teaching.lecture.standard',category:'teaching',calculationMode:'per_hour',
   resultKind:'credit',priority:100,enabled:true
  });
  await db.doc('doe_rule_selectors/sel-2028-lecture').set({
   selectorId:'sel-2028-lecture',ruleId:'r-2028-lecture',policyVersionId:'ucvm-workload-2028-29-v2',
   field:'activityType',operator:'equals',valueText:'LEC',order:1
  });
  await db.doc('doe_rule_parameters/param-2028-rate').set({
   parameterId:'param-2028-rate',ruleId:'r-2028-lecture',policyVersionId:'ucvm-workload-2028-29-v2',
   name:'rate',valueNumber:.3,unit:'percent_per_hour',required:true,order:1
  });
  await db.doc('doe_rule_inputs/input-2028-hours').set({
   ruleInputId:'input-2028-hours',ruleId:'r-2028-lecture',policyVersionId:'ucvm-workload-2028-29-v2',
   inputName:'hours',inputType:'number',required:true,source:'session',unit:'hours'
  });
 });
});

after(async()=>{if(env)await env.cleanup()});

check('ADFA Regular can read DOE configuration while non-ADFA roles cannot',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['general','owner','regular','legacy-admin']){
  const db=env.authenticatedContext(uid).firestore();
  await assertSucceeds(db.doc('doe_policy_versions/ucvm-workload-2027-28-v2').get());
  await assertSucceeds(db.collection('doe_rules').where('policyVersionId','==','ucvm-workload-2027-28-v2').get());
 }
 for(const uid of ['other','faculty','hicc','visc','adc','lab']){
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(db.doc('doe_policy_versions/ucvm-workload-2027-28-v2').get());
 }
});

check('browser Firestore repository cannot edit a Draft after API cutover',async()=>{
 const db=env.authenticatedContext('regular').firestore();
 const repo=FIRESTORE_ADAPTER.createFirestoreRepository({db});
 await assert.rejects(()=>repo.saveDraftRule({
  ruleId:'r-draft',policyVersionId:'ucvm-workload-2027-28-v2',ruleKey:'teaching.lecture.standard',
  category:'teaching',calculationMode:'per_hour',resultKind:'credit',priority:100,enabled:true,name:'Forged Lecture'
 },1,{uid:'regular',name:'Regular Admin',email:'regular@example.test'}));
 const stored=await db.doc('doe_rules/r-draft').get();
 assert.notEqual(stored.data().name,'Forged Lecture');
});

check('stale Draft revision fails closed',async()=>{
 const db=env.authenticatedContext('regular').firestore();
 const repo=FIRESTORE_ADAPTER.createFirestoreRepository({db});
 await assert.rejects(
  ()=>repo.saveDraftRule({
   ruleId:'r-draft',
   policyVersionId:'ucvm-workload-2027-28-v2',
   ruleKey:'teaching.lecture.standard',
   category:'teaching',calculationMode:'per_hour',resultKind:'credit',priority:100,enabled:true
  },999,{uid:'regular'}),
  error=>error&&error.code==='POLICY_REVISION_CONFLICT'
 );
});

check('ADFA Regular cannot mutate Active rules or activate a Draft directly',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('regular').firestore();
 await assertFails(db.doc('doe_rules/r-active').update({name:'forged'}));
 await assertFails(db.doc('doe_policy_versions/ucvm-workload-2027-28-v2').update({status:'active'}));
});

check('Other Office and Faculty-side roles cannot create or modify DOE configuration',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['other','faculty','hicc','visc','adc','lab']){
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(db.doc(`doe_rules/forged-${uid}`).set({
   ruleId:`forged-${uid}`,policyVersionId:'ucvm-workload-2027-28-v2',
   ruleKey:'forged',category:'teaching',calculationMode:'fixed',resultKind:'credit',priority:1,enabled:true
  }));
 }
});

check('publication, calculation and audit evidence are server-write-only to browser clients',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const general=env.authenticatedContext('general').firestore();
 const stamp=require('firebase/firestore').serverTimestamp;
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await db.doc('doe_publications/pub-test').set({publicationId:'pub-test',policyVersionId:'ucvm-workload-2027-28-v1',policyRevision:1,policyChecksum:'historical-checksum',impactRunId:'historical-impact',publishedBy:'general',publishedAt:'2026-09-18T20:00:00Z'});
  await db.doc('doe_calculation_records/calc-test').set({calculationId:'calc-test',policyVersionId:'ucvm-workload-2027-28-v1',facultyId:'f1',resultDoe:1.8,calculatedBy:'server'});
  await db.doc('doe_audit_log/audit-test').set({auditId:'audit-test',policyVersionId:'ucvm-workload-2027-28-v1',action:'validation_run',changedBy:'server'});
 });
 await assertFails(general.doc('doe_publications/pub-forged').set({publicationId:'pub-forged',policyVersionId:'ucvm-workload-2027-28-v1',publishedBy:'general'}));
 await assertFails(general.doc('doe_publications/pub-test').update({policyChecksum:'changed'}));
 await assertFails(general.doc('doe_calculation_records/calc-forged').set({calculationId:'calc-forged',policyVersionId:'ucvm-workload-2027-28-v1',facultyId:'f1',resultDoe:99,calculatedBy:'general',calculatedAt:stamp()}));
 await assertFails(general.doc('doe_calculation_records/calc-test').update({resultDoe:9}));
 await assertFails(general.doc('doe_audit_log/audit-forged').set({auditId:'audit-forged',policyVersionId:'ucvm-workload-2027-28-v1',action:'validation_run',changedBy:'general',changedAt:stamp()}));
 await assertFails(general.doc('doe_audit_log/audit-test').update({action:'changed'}));
});

check('even ADFA General cannot publish DOE policy through browser Firestore writes',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const general=env.authenticatedContext('general').firestore();
 await assertFails(general.doc('doe_impact_runs/impact-browser-forged').set({
  impactRunId:'impact-browser-forged',policyVersionId:'ucvm-workload-2028-29-v2',policyRevision:1,policyChecksum:'forged',inputDatasetChecksum:'forged',status:'passed',runBy:'general'
 }));
 await assertFails(general.doc('doe_policy_versions/ucvm-workload-2028-29-v2').update({status:'active'}));
});

check('browser clients including General cannot write the administrative recalculation path',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const stamp=require('firebase/firestore').serverTimestamp;
 const regular=env.authenticatedContext('regular').firestore();
 const general=env.authenticatedContext('general').firestore();

 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await db.doc('sessions/recalc-s1').set({
   id:'recalc-s1',course:'VTMD 999',date:'2027-01-10',type:'LEC',assignments:[{assignmentId:'a1',ucid:'f1',role:'Lecture',doeCredit:.3}],facultyIds:['f1'],updatedBy:'seed'
  });
  await db.doc('calendar_sessions/recalc-s1').set({course:'VTMD 999',date:'2027-01-10',type:'LEC',facultyIds:['f1']});
 });

 await assertFails(regular.doc('doe_recalculation_batches/recalc-security').set({
  recalculationBatchId:'recalc-security',academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',status:'running',completedRows:0,totalRows:1,changedBy:'regular',changedByName:'Regular',updatedAt:stamp()
 }));
 await assertFails(regular.doc('sessions/recalc-s1').update({
  assignments:[{assignmentId:'a1',ucid:'f1',role:'Lecture',doeCredit:.6}],
  doeRecalculationBatchId:'recalc-security',doeRecalculationPolicyVersionId:'ucvm-workload-2027-28-v1',doeRecalculatedBy:'regular',doeRecalculatedAt:stamp(),updatedBy:'regular',updatedByName:'Regular',updatedAt:stamp()
 }));

 await assertFails(general.doc('doe_recalculation_batches/recalc-security').set({
  recalculationBatchId:'recalc-security',academicYear:'2027-28',policyVersionId:'ucvm-workload-2027-28-v1',status:'running',completedRows:0,totalRows:1,changedBy:'general',changedByName:'General',updatedAt:stamp()
 }));
 await assertFails(general.doc('doe_calculation_records/calc-recalc-security').set({
  calculationId:'calc-recalc-security',policyVersionId:'ucvm-workload-2027-28-v1',facultyId:'f1',sessionId:'recalc-s1',assignmentId:'a1',resultDoe:.6,recalculationBatchId:'recalc-security',trigger:'administrative_recalculation',calculatedBy:'general',calculatedAt:stamp()
 }));
});

check('ADFA Regular can read annual DOE mappings but cannot write Draft mappings directly',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('regular').firestore();
 const active=db.doc('doe_course_mappings/active-course-map');
 const draft=db.doc('doe_course_mappings/draft-course-map');

 await env.withSecurityRulesDisabled(async context=>{
  await context.firestore().doc('doe_course_mappings/active-course-map').set({
   mappingId:'active-course-map',policyVersionId:'ucvm-workload-2027-28-v1',academicYear:'2027-28',courseCode:'VTMD 204',unitCount:6,referenceId:'wg-active',reviewStatus:'confirmed_unchanged',enabled:true
  });
 });
 await assertSucceeds(active.get());
 await assertFails(active.update({unitCount:9}));

 await assertFails(draft.set({mappingId:'draft-course-map',policyVersionId:'ucvm-workload-2027-28-v2',academicYear:'2027-28',courseCode:'VTMD 302',unitCount:3,referenceId:'wg-draft',reviewStatus:'updated',enabled:true}));
});

check('non-admin roles cannot write annual DOE references or mappings',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['other','faculty','hicc','visc','adc','lab']){
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(db.doc(`doe_reference_sources/forged-${uid}`).set({
   referenceId:`forged-${uid}`,policyVersionId:'ucvm-workload-2027-28-v2',academicYear:'2027-28',title:'forged',reviewStatus:'updated'
  }));
 }
});


check('authoritative DOE assignments cannot be written directly by browser clients',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['general','regular','faculty']){
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(db.doc(`doe_assignments/forged-${uid}`).set({
   assignmentFactId:`forged-${uid}`,academicYear:'2027-28',facultyId:'f1',category:'role',
   roleType:'HICC',courseCode:'VTMD 204',doeCredit:99,doePolicyVersionId:'ucvm-workload-2027-28-v1',
   doeRuleId:'r-active',doeRuleKey:'role.hicc.development',doeCalculationId:'fake',active:true
  }));
 }
});


check('DOE recalculation requests must be paired with the same authorized session mutation',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await db.doc('sessions/queue-s1').set({
   course:'505',courseName:'Clinical Skills',year:3,semester:'winter',week:8,date:'2027-03-22',start:'09:00',end:'11:00',timeUnknown:false,
   type:'LAB',topic:'Old Topic',room:'R1',instructor:'Dr Jane',assignments:[{facultyId:'f1',name:'Dr Jane',role:'Lab Support',creditedHours:2}],facultyIds:['f1'],
   updatedBy:'seed',updatedByName:'Seed',updatedAt:new Date('2026-09-01T00:00:00Z')
  });
  await db.doc('calendar_sessions/queue-s1').set({
   sessionId:'queue-s1',course:'505',courseName:'Clinical Skills',year:3,semester:'winter',week:8,date:'2027-03-22',start:'09:00',end:'11:00',timeUnknown:false,
   type:'LAB',topic:'Old Topic',room:'R1',instructor:'Dr Jane',instructorNames:['Dr Jane']
  });
 });
 const queue=(uid,id,stamp)=>({requestId:id,academicYear:'2026-27',sessionId:'queue-s1',sourceEntityType:'session_assignment',sourceEntityIds:[],facultyIds:[],trigger:'office_session_updated',status:'pending',requestedBy:uid,requestedByName:uid.toUpperCase(),requestedAt:stamp,previousStart:'09:00',previousEnd:'11:00',previousTimeUnknown:false});

 const regular=env.authenticatedContext('regular').firestore(),orphanStamp=serverTimestamp();
 await assertFails(regular.doc('doe_recalculation_requests/queue-orphan').set(queue('regular','queue-orphan',orphanStamp)));

 const adc=env.authenticatedContext('adc').firestore(),adcStamp=serverTimestamp(),adcBatch=adc.batch();
 adcBatch.update(adc.doc('sessions/queue-s1'),{room:'R2',updatedBy:'adc',updatedByName:'ADC',updatedAt:adcStamp});
 adcBatch.set(adc.doc('calendar_sessions/queue-s1'),{sessionId:'queue-s1',course:'505',courseName:'Clinical Skills',year:3,semester:'winter',week:8,date:'2027-03-22',start:'09:00',end:'11:00',timeUnknown:false,type:'LAB',topic:'Old Topic',room:'R2',instructor:'Dr Jane',instructorNames:['Dr Jane']});
 adcBatch.set(adc.doc('doe_recalculation_requests/queue-adc'),queue('adc','queue-adc',adcStamp));
 await assertSucceeds(adcBatch.commit());
 await assertFails(adc.doc('doe_recalculation_requests/queue-adc').update({status:'completed'}));

 const lab=env.authenticatedContext('lab').firestore(),labStamp=serverTimestamp(),labBatch=lab.batch();
 labBatch.update(lab.doc('sessions/queue-s1'),{topic:'New Topic',updatedBy:'lab',updatedByName:'LAB',updatedAt:labStamp});
 labBatch.set(lab.doc('calendar_sessions/queue-s1'),{sessionId:'queue-s1',course:'505',courseName:'Clinical Skills',year:3,semester:'winter',week:8,date:'2027-03-22',start:'09:00',end:'11:00',timeUnknown:false,type:'LAB',topic:'New Topic',room:'R2',instructor:'Dr Jane',instructorNames:['Dr Jane']});
 labBatch.set(lab.doc('doe_recalculation_requests/queue-lab'),queue('lab','queue-lab',labStamp));
 await assertSucceeds(labBatch.commit());

 const faculty=env.authenticatedContext('faculty').firestore(),facultyStamp=serverTimestamp();
 await assertFails(faculty.doc('doe_recalculation_requests/queue-faculty').set(queue('faculty','queue-faculty',facultyStamp)));
 await assertFails(regular.doc('doe_recalculation_requests/queue-forged').set({...queue('regular','queue-forged',serverTimestamp()),status:'completed'}));
});
