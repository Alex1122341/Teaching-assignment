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
 assert.match(source,/state\.demoReadOnly=Boolean\(demoService\?\.readOnly\)/);
 assert.match(source,/Frontend Demo · NON-AUTHORITATIVE · READ-ONLY/);
 assert.match(source,/editable:!state\.demoReadOnly/);
});
