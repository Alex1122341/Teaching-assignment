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

check('Firestore repository lets ADFA Regular edit a Draft with revision bump and preview invalidation',async()=>{
 const db=env.authenticatedContext('regular').firestore();
 const repo=FIRESTORE_ADAPTER.createFirestoreRepository({db});
 const saved=await repo.saveDraftRule({
  ruleId:'r-draft',
  policyVersionId:'ucvm-workload-2027-28-v2',
  ruleKey:'teaching.lecture.standard',
  category:'teaching',
  calculationMode:'per_hour',
  resultKind:'credit',
  priority:100,
  enabled:true,
  name:'Updated Lecture'
 },1,{uid:'regular',name:'Regular Admin',email:'regular@example.test'});
 assert.equal(saved.version.revision,2);
 assert.equal(saved.version.lastImpactRunId,'');
 const stored=await db.doc('doe_rules/r-draft').get();
 assert.equal(stored.data().name,'Updated Lecture');
 const audits=await db.collection('doe_audit_log').where('policyVersionId','==','ucvm-workload-2027-28-v2').get();
 assert.equal(audits.size,1);
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
  },1,{uid:'regular'}),
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

check('publication, calculation and audit evidence cannot be rewritten',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const general=env.authenticatedContext('general').firestore();
 const stamp=require('firebase/firestore').serverTimestamp;

 await env.withSecurityRulesDisabled(async context=>{
  await context.firestore().doc('doe_publications/pub-test').set({
   publicationId:'pub-test',policyVersionId:'ucvm-workload-2027-28-v1',
   policyRevision:1,policyChecksum:'historical-checksum',impactRunId:'historical-impact',
   publishedBy:'general',publishedByName:'General',publishedAt:new Date('2026-09-18T20:00:00Z').toISOString()
  });
 });

 await assertFails(general.doc('doe_publications/pub-test').update({policyChecksum:'changed'}));
 await assertSucceeds(general.doc('doe_calculation_records/calc-test').set({
  calculationId:'calc-test',policyVersionId:'ucvm-workload-2027-28-v1',
  facultyId:'f1',resultDoe:1.8,calculatedBy:'general',calculatedAt:stamp()
 }));
 await assertFails(general.doc('doe_calculation_records/calc-test').update({resultDoe:9}));
 await assertSucceeds(general.doc('doe_audit_log/audit-test').set({
  auditId:'audit-test',policyVersionId:'ucvm-workload-2027-28-v1',
  action:'validation_run',changedBy:'general',changedByName:'General',changedByEmail:'general@example.test',changedAt:stamp()
 }));
 await assertFails(general.doc('doe_audit_log/audit-test').update({action:'changed'}));
});


check('General can validate and publish a current Draft atomically through the Firestore repository',async()=>{
 const db=env.authenticatedContext('general').firestore();
 const repo=FIRESTORE_ADAPTER.createFirestoreRepository({db});
 const service=DOE_SERVICE.createService({
  repository:repo,
  engine:DOE_ENGINE,
  actorProvider:()=>({uid:'general',name:'General Admin',email:'general@example.test',role:'adfa_general'}),
  clock:()=>new Date('2026-09-18T21:00:00Z'),
  datasetChecksumProvider:async()=>'dataset-security'
 });
 const validation=await service.validateDraft('ucvm-workload-2028-29-v2');
 assert.equal(validation.valid,true);

 await repo.createImpactRun({
  impactRunId:'impact-security',
  policyVersionId:'ucvm-workload-2028-29-v2',
  policyRevision:1,
  policyChecksum:validation.policyChecksum,
  inputDatasetChecksum:'dataset-security',
  status:'passed',
  runBy:'general',
  errorCount:0,warningCount:0
 });
 await repo.saveImpactEvidence('ucvm-workload-2028-29-v2',{
  revision:1,
  impactRunId:'impact-security',
  policyChecksum:validation.policyChecksum,
  inputDatasetChecksum:'dataset-security',
  actor:{uid:'general',name:'General Admin',email:'general@example.test'}
 });

 const published=await service.publish('ucvm-workload-2028-29-v2');
 assert.equal(published.version.status,'active');
 assert.equal((await db.doc('doe_policy_versions/ucvm-workload-2028-29-v1').get()).data().status,'archived');
 assert.equal((await db.doc('doe_policies/ucvm-workload-2028-29').get()).data().currentActiveVersionId,'ucvm-workload-2028-29-v2');
 const publications=await db.collection('doe_publications').where('policyVersionId','==','ucvm-workload-2028-29-v2').get();
 assert.equal(publications.size,1);
});
