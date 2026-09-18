'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

const ADMIN=require('../doe-policy-admin.js');
const ENGINE=require('../doe-policy-engine.js');

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

test('DOE policy runtime modules load before the admin controller',()=>{
 const html=read('faculty-admin.html');
 const order=[
  'doe-formula.js',
  'doe-policy-engine.js',
  'doe-policy-repository.js',
  'doe-policy-firestore.js',
  'doe-policy-service.js',
  'doe-policy-admin.js'
 ].map(name=>html.indexOf(name));
 for(const [index,value] of order.entries())assert.ok(value>=0,`missing DOE runtime index ${index}`);
 for(let index=1;index<order.length;index++)assert.ok(order[index-1]<order[index],`DOE runtime order ${index}`);
 assert.match(html,/doe-policy-admin\.css/);
});

test('ADFA Regular can edit Drafts but only General or Owner can publish/archive/recalculate',()=>{
 const regular=ADMIN.capabilities({role:'adfa_regular'});
 assert.deepEqual(regular,{
  initialize:true,editDraft:true,validate:true,preview:true,publish:false,archive:false,recalculate:false
 });
 const legacy=ADMIN.capabilities({role:'administrator'});
 assert.equal(legacy.editDraft,true);
 assert.equal(legacy.publish,false);

 for(const role of ['adfa_general','owner']){
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

test('Advanced Formula Test Rule delegates to canonical engine validation/evaluation',()=>{
 const rule=ADMIN.normalizeRuleDraft({
  ruleId:'formula',
  policyVersionId:'v1',
  ruleKey:'supervision.test',
  category:'supervision',
  calculationMode:'formula',
  formulaText:'min(trainees * rate, cap)',
  resultKind:'credit',
  priority:10,
  enabled:true,
  selectors:[],
  inputs:[{inputName:'trainees',required:true}],
  parameters:[{name:'rate',valueNumber:.5},{name:'cap',valueNumber:4}],
  tiers:[]
 });
 const result=ADMIN.testRule(rule,{trainees:12},ENGINE);
 assert.equal(result.resultDoe,4);
 assert.throws(
  ()=>ADMIN.testRule({...rule,formulaText:'window.alert(1)'},{trainees:12},ENGINE),
  error=>Boolean(error&&error.code)
 );
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
