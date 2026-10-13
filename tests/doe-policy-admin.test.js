'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

const ADMIN=require('../doe-policy-admin.js');

test('Faculty Dashboard exposes a first-class DOE Rules tab and editor surfaces',()=>{
 const html=read('faculty-admin.html');
 assert.match(html,/data-tab="doe-rules"[^>]*>DOE Rules</);
 assert.match(html,/id="doe-rules-view"/);
 for(const id of [
  'doe-policy-year','doe-policy-version','doe-policy-status',
  'doe-new-year','doe-clone-draft','doe-validate','doe-preview',
  'doe-publish','doe-archive','doe-recalculate',
  'doe-rules-body','doe-rule-editor','doe-exceptions-body','doe-impact-preview'
 ]) assert.match(html,new RegExp(`id="${id}"`),id);
 for(const section of ['teaching','role','supervision','target','exceptions']){
  assert.match(html,new RegExp(`data-doe-section="${section}"`),section);
 }
});

test('DOE policy admin loads API client, not browser policy storage or calculation modules',()=>{
 const html=read('faculty-admin.html');
 for(const name of ['doe-api-client.js','doe-policy-admin.js'])assert.ok(html.indexOf(name)>=0,name);
 for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-repository.js','doe-policy-firestore.js','doe-policy-service.js'])assert.equal(html.indexOf(name),-1,name);
 assert.ok(html.indexOf('doe-api-client.js')<html.indexOf('doe-policy-admin.js'));
 assert.match(html,/doe-policy-admin\.css/);
});

test('Developer is highest DOE policy role while Administrator stays Draft-only',()=>{
 const regular=ADMIN.capabilities({role:'adfa_regular'});
 assert.deepEqual(regular,{
  initialize:true,editDraft:true,validate:true,preview:true,publish:false,archive:false,recalculate:false
 });
 const legacy=ADMIN.capabilities({role:'administrator'});
 assert.equal(legacy.editDraft,true);
 assert.equal(legacy.publish,false);

 for(const role of ['developer','adfa_general','owner']){
  const cap=ADMIN.capabilities({role});
  assert.equal(cap.initialize,true,role);
  assert.equal(cap.editDraft,true,role);
  assert.equal(cap.publish,true,role);
  assert.equal(cap.archive,true,role);
  assert.equal(cap.recalculate,true,role);
 }
});

test('Faculty-side self-service roles cannot initialize DOE Rules administration',()=>{
 for(const role of ['faculty','hicc','visc','adc','lab','other_office']){
  const cap=ADMIN.capabilities({role});
  assert.equal(cap.initialize,false,role);
  assert.equal(cap.editDraft,false,role);
 }
 const js=read('faculty-admin.js');
 assert.match(js,/UCVM_DOE_POLICY_ADMIN/);
 assert.match(js,/doe-rules/);
});

test('structured Rule Builder normalizes selectors inputs parameters and tiers without executable code',()=>{
 const rule=ADMIN.normalizeRuleDraft({
  ruleId:'r1',
  policyVersionId:'v1',
  ruleKey:'teaching.lecture.standard',
  name:'Lecture',
  category:'teaching',
  calculationMode:'per_hour',
  resultKind:'credit',
  priority:'100',
  enabled:true,
  selectors:[{field:'activityType',operator:'equals',valueText:'LEC'}],
  inputs:[{inputName:'hours',inputType:'number',required:true,source:'session'}],
  parameters:[{name:'rate',valueNumber:'0.30'}],
  tiers:[]
 });
 assert.equal(rule.priority,100);
 assert.equal(rule.selectors[0].field,'activityType');
 assert.equal(rule.inputs[0].inputName,'hours');
 assert.equal(rule.parameters[0].valueNumber,.3);
 assert.equal(rule.calculationMode,'per_hour');
});

test('Rule Test is a server action and browser admin does not expose a local evaluator',()=>{
 const source=read('doe-policy-admin.js');
 assert.equal(ADMIN.testRule,undefined);
 assert.match(source,/UCVM_DOE_API/);
 assert.match(source,/state\.service\.testRule/);
 assert.doesNotMatch(source,/engine\.calculate|engine\.validatePolicy|DEFAULT_ENGINE/);
});

test('Exception editor requires fixed DOE reason source and a concrete scope',()=>{
 assert.deepEqual(
  ADMIN.validateExceptionDraft({
   policyVersionId:'v1',scopeType:'session',scopeKey:'s1',fixedDoe:2.5,
   reason:'Approved operational exception',sourceReference:'Workload MASTER'
  }),
  []
 );
 const errors=ADMIN.validateExceptionDraft({
  policyVersionId:'v1',scopeType:'session',scopeKey:'',fixedDoe:'',
  reason:'',sourceReference:''
 });
 for(const code of ['EXCEPTION_SCOPE_REQUIRED','EXCEPTION_DOE_REQUIRED','EXCEPTION_REASON_REQUIRED','EXCEPTION_SOURCE_REQUIRED']){
  assert.ok(errors.some(error=>error.code===code),code);
 }
});


test('Impact Preview and Recalculate dataset/write authority is absent from the browser admin',()=>{
 const source=read('doe-policy-admin.js');
 assert.equal(ADMIN.buildImpactDataset,undefined);
 assert.equal(ADMIN.createFirestoreRecalculationWriter,undefined);
 assert.equal(ADMIN.applyRecalculationRowsToSource,undefined);
 assert.doesNotMatch(source,/UCVM_ADMIN_DATA\?\.refresh|stageCalculationRecord/);
 assert.match(source,/state\.service\.runImpactPreview/);
 assert.match(source,/state\.service\.runRecalculate/);
});

test('Impact Preview renderer exposes required summary metrics and per-faculty differences',()=>{
 const html=ADMIN.impactPreviewHtml({
  status:'passed',facultyCount:2,calculationCount:4,changedFacultyCount:1,
  largeIncreaseCount:1,largeDecreaseCount:0,errorCount:0,warningCount:1,
  policyVersionId:'v2',policyRevision:3,
  rows:[{
   facultyId:'f1',currentDoe:10,draftDoe:16,difference:6,
   affectedRules:['teaching.lecture.standard'],
   warnings:[{code:'LARGE_INCREASE',message:'Review increase'}],errors:[]
  }]
 });
 assert.match(html,/PASSED/);
 for(const value of ['Faculty checked','Calculations checked','Faculty changed','Large increases','Large decreases','Errors','Warnings']){
  assert.match(html,new RegExp(value));
 }
 assert.match(html,/f1/);
 assert.match(html,/10\.00%/);
 assert.match(html,/16\.00%/);
 assert.match(html,/\+6\.00%/);
 assert.match(html,/teaching\.lecture\.standard/);
});


test('Rule Book permission gates consume the authoritative version returned by bundle reload',()=>{
 const source=read('doe-policy-admin.js');
 const selectedStart=source.indexOf('function selectedVersion');
 const selectedEnd=source.indexOf('function isDraft',selectedStart);
 const selected=source.slice(selectedStart,selectedEnd);
 assert.match(selected,/state\.bundle\?\.version\?\.policyVersionId===selectedId/);
 const loadStart=source.indexOf('async function loadBundle');
 const loadEnd=source.indexOf('async function loadVersions',loadStart);
 const load=source.slice(loadStart,loadEnd);
 assert.match(load,/state\.bundle=await state\.service\.loadPolicyBundle/);
 assert.match(load,/state\.versions\[at\]=\{\.\.\.state\.versions\[at\],\.\.\.current\}/);
});


test('Impact Preview renderer presents operational risk categories and attention queue',()=>{
 const html=ADMIN.impactPreviewHtml({
  status:'passed',policyVersionId:'v2',policyRevision:4,facultyCount:5,calculationCount:9,
  changedFacultyCount:2,increaseCount:1,decreaseCount:1,unchangedCount:1,newNeedsReviewCount:1,
  resolvedCurrentGapCount:1,missingMappingCount:1,largestIncreaseDoe:6,largestDecreaseDoe:-4,
  largeIncreaseCount:1,largeDecreaseCount:0,errorCount:1,warningCount:1,
  rows:[
   {facultyId:'increase',currentDoe:10,draftDoe:16,difference:6,impactStatus:'increase',affectedRules:['teaching.lecture'],warnings:[{code:'LARGE_INCREASE',message:'Review increase'}],errors:[]},
   {facultyId:'mapping',currentDoe:12,draftDoe:null,difference:null,impactStatus:'missing_mapping',missingMappingCount:1,affectedRules:[],warnings:[],errors:[{code:'COURSE_MAPPING_REQUIRED',message:'Course mapping required'}]},
   {facultyId:'resolved',currentDoe:null,draftDoe:8,difference:null,impactStatus:'resolved_current_gap',currentUnavailableCount:1,affectedRules:['role.hicc'],warnings:[],errors:[]}
  ]
 });
 for(const value of ['Increases','Decreases','Draft Needs Review','Resolved current gaps','Missing mapping','Largest increase','Largest decrease','Attention queue','All faculty impact']){
  assert.match(html,new RegExp(value));
 }
 assert.match(html,/10\.00%\s*→\s*16\.00%/);
 assert.match(html,/Missing Mapping/);
 assert.match(html,/Resolved Current Gap/);
 assert.match(html,/COURSE_MAPPING_REQUIRED/);
});


test('Frontend Demo Rule Book uses a separate read-only service without declaring the authoritative DOE API configured',()=>{
 const source=read('doe-policy-admin.js');
 assert.match(source,/UCVM_FRONTEND_DEMO_MODE===true\?root\?\.UCVM_PAGES_DEMO\?\.doeRulebook/);
 assert.match(source,/state\.demoReadOnly=Boolean\(demoService\?\.readOnly\|\|labService\?\.readOnly\)/);
 assert.match(source,/Frontend Demo · NON-AUTHORITATIVE · READ-ONLY/);
 assert.match(source,/editable:!state\.demoReadOnly/);
});

const ACTION_IDS=['doe-new-year','doe-clone-draft','doe-validate','doe-preview','doe-publish','doe-archive','doe-recalculate','doe-add-rule','doe-add-exception','doe-rulebook-validate','doe-copy-previous-year'];
const activeVersion={policyVersionId:'y-v1',academicYear:'2026-27',status:'active',revision:1};
const draftVersion={policyVersionId:'y-v2',academicYear:'2026-27',status:'draft',revision:3};
const validatedDraft={...draftVersion,lastValidationPassed:true,lastValidatedRevision:3,rulesChecksum:'sum'};
const previewedDraft={...validatedDraft,lastImpactRunId:'run',lastImpactRevision:3,lastImpactChecksum:'sum',lastImpactDatasetChecksum:'data'};

test('every disabled DOE Rules action explains why in read-only Demo and Lab modes',()=>{
 for(const [labReadOnly,pattern] of [[false,/Frontend Demo is read-only/],[true,/Firebase Lab is read-only/]]){
  const result=ADMIN.actionAvailability({profile:{role:'adfa_general'},version:previewedDraft,demoReadOnly:true,labReadOnly,academicYear:'2026-27',existingYears:['2026-27']});
  for(const id of ACTION_IDS){
   assert.equal(result[id].enabled,false,id);
   assert.match(result[id].reason,pattern,id);
  }
  assert.match(result.nextStep,pattern);
 }
});

test('DOE Rules actions follow the Draft → Validate → Impact Preview → Publish order with a reason at each step',()=>{
 const general={role:'adfa_general'},years=['2026-27'];
 const onActive=ADMIN.actionAvailability({profile:general,version:activeVersion,academicYear:'2026-27',existingYears:years});
 assert.deepEqual(['doe-validate','doe-preview','doe-publish'].map(id=>onActive[id].enabled),[false,false,false]);
 assert.match(onActive['doe-validate'].reason,/Select a Draft version first/);
 assert.equal(onActive['doe-archive'].enabled,true);
 assert.equal(onActive['doe-recalculate'].enabled,true);
 assert.equal(onActive['doe-clone-draft'].enabled,true);
 assert.match(onActive.nextStep,/Clone as Draft/);

 const draft=ADMIN.actionAvailability({profile:general,version:draftVersion,academicYear:'2026-27',existingYears:years});
 assert.equal(draft['doe-validate'].enabled,true);
 assert.equal(draft['doe-preview'].enabled,false);
 assert.match(draft['doe-preview'].reason,/Validate the current Draft revision first/);
 assert.match(draft['doe-publish'].reason,/Validate the current Draft revision first/);
 assert.match(draft['doe-archive'].reason,/Select the Active version first/);
 assert.match(draft.nextStep,/Validate this Draft/);

 const validated=ADMIN.actionAvailability({profile:general,version:validatedDraft,academicYear:'2026-27',existingYears:years});
 assert.equal(validated['doe-preview'].enabled,true);
 assert.match(validated['doe-publish'].reason,/Impact Preview/);

 const ready=ADMIN.actionAvailability({profile:general,version:previewedDraft,academicYear:'2026-27',existingYears:years});
 assert.equal(ready['doe-publish'].enabled,true);
 assert.equal(ready['doe-publish'].reason,'');
});

test('Publish, Archive, Recalculate and Copy name the roles allowed when the role is too low',()=>{
 for(const role of ['adfa_regular','administrator']){
  const result=ADMIN.actionAvailability({profile:{role},version:previewedDraft,academicYear:'2026-27',existingYears:['2026-27']});
  for(const id of ['doe-publish','doe-archive','doe-recalculate','doe-copy-previous-year']){
   assert.equal(result[id].enabled,false,`${role} ${id}`);
   assert.equal(result[id].reason,'ADFA General, Owner or Developer only',`${role} ${id}`);
  }
  assert.equal(result['doe-validate'].enabled,true,role);
  assert.equal(result['doe-preview'].enabled,true,role);
 }
 const faculty=ADMIN.actionAvailability({profile:{role:'faculty'},version:draftVersion,academicYear:'2026-27'});
 assert.match(faculty['doe-new-year'].reason,/Developer, ADFA General or ADFA Regular only/);
});

test('Copy from Previous Year names the year it creates and refuses a year that already exists',()=>{
 const free=ADMIN.actionAvailability({profile:{role:'owner'},version:activeVersion,academicYear:'2026-27',existingYears:['2026-27']});
 assert.equal(free['doe-copy-previous-year'].enabled,true);
 assert.equal(free['doe-copy-previous-year'].label,'Copy 2026-27 → 2027-28');
 assert.match(free['doe-copy-previous-year'].hint,/creates 2027-28 as a Draft from the 2026-27 Rule Book/);
 const taken=ADMIN.actionAvailability({profile:{role:'owner'},version:activeVersion,academicYear:'2026-27',existingYears:['2026-27','2027-28']});
 assert.equal(taken['doe-copy-previous-year'].enabled,false);
 assert.match(taken['doe-copy-previous-year'].reason,/2027-28 already has a Rule Book/);
});

test('DOE Rules page shows a next-step hint area and no longer mislabels General-only actions',()=>{
 assert.match(read('faculty-admin.html'),/id=["']doe-actions-hint["']/);
 const source=read('doe-policy-admin.js');
 assert.doesNotMatch(source,/Developer \/ Owner only/);
 assert.match(source,/element\.title=entry\.enabled\?/);
});
