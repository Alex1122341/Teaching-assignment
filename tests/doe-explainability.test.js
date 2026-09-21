'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const VIEW=require('../doe-worksheet-view.js');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function line(overrides={}){
 return{
  lineId:'session-1--a1',category:'teaching',label:'VTMD 301 Lecture',
  sourceEntityType:'session_assignment',sourceEntityId:'session-1',teachingRole:'Lecture',courseCode:'VTMD 301',
  resultDoe:.6,status:'calculated',policyVersionId:'v1',ruleId:'r1',ruleKey:'teaching.lecture.standard',
  calculationId:'calc-1',calculatedAt:'2027-01-10T10:00:00Z',calculationText:'2 hours × 0.30% = 0.60%',
  reference:{title:'UCVM Workload Guidelines',section:'6.2',table:'Table 1',page:3},
  explanation:{
   source:'rule',trigger:'session_change',
   facts:{courseCode:'VTMD 301',teachingRole:'Lecture',creditedHours:2},
   inputs:{hours:2},
   parameters:{rate:.3},
   rule:{name:'Lecture standard',category:'teaching',calculationMode:'per_hour'}
  },
  ...overrides
 };
}

test('DOE explainability normalizes source facts, rule/policy, formula, inputs, result, reference and evidence',()=>{
 const explanation=VIEW.explainLine(line());
 assert.equal(explanation.title,'VTMD 301 Lecture');
 assert.equal(explanation.resultDoe,.6);
 assert.equal(explanation.resultText,'0.60%');
 assert.equal(explanation.policyVersionId,'v1');
 assert.equal(explanation.ruleKey,'teaching.lecture.standard');
 assert.equal(explanation.ruleName,'Lecture standard');
 assert.equal(explanation.calculationMode,'per_hour');
 assert.equal(explanation.formula,'2 hours × 0.30% = 0.60%');
 assert.deepEqual(explanation.facts,{courseCode:'VTMD 301',teachingRole:'Lecture',creditedHours:2});
 assert.deepEqual(explanation.inputs,{hours:2});
 assert.deepEqual(explanation.parameters,{rate:.3});
 assert.match(explanation.referenceText,/UCVM Workload Guidelines/);
 assert.equal(explanation.calculationId,'calc-1');
 assert.equal(explanation.trigger,'session_change');
});

test('DOE explanation HTML exposes evidence but escapes user/source text',()=>{
 const html=VIEW.explanationHtml(line({label:'<img src=x onerror=1>'}));
 assert.match(html,/Source facts/);
 assert.match(html,/Rule &amp; policy|Rule & policy/);
 assert.match(html,/Calculation/);
 assert.match(html,/Inputs/);
 assert.match(html,/Parameters/);
 assert.match(html,/calc-1/);
 assert.match(html,/VTMD 301/);
 assert.doesNotMatch(html,/<img src=x/);
 assert.match(html,/&lt;img/);
});

test('worksheet DOE results are explicit Explain DOE controls for both calculated and unavailable lines',()=>{
 const worksheet={
  facultyId:'f1',displayName:'Dr Example',academicYear:'2027-28',policyVersionId:'v1',status:'needs_review',
  totals:{scheduledTeachingDoe:null,roleDoe:0,rawSupervisionDoe:0,appliedSupervisionDoe:0,adjustmentDoe:0,assignedTeachingDoe:null,effectiveTargetDoe:40,remainingDoe:null},
  reserve:{},errors:[],
  lines:[line(),line({lineId:'role-1',label:'Unrated HICC',resultDoe:null,status:'needs_review',errorCode:'COURSE_MAPPING_REQUIRED',calculationId:'',explanation:{facts:{courseCode:'VTMD 204'},inputs:{},parameters:{},rule:{}}})]
 };
 const html=VIEW.worksheetHtml(worksheet);
 assert.match(html,/data-doe-explain-line="session-1--a1"/);
 assert.match(html,/data-doe-explain-line="role-1"/);
 assert.match(html,/Explain DOE/);
 assert.match(html,/Unavailable/);
});

test('Faculty Dashboard provides a reusable explanation modal and wires Worksheet Explain controls',()=>{
 const html=read('faculty-admin.html');
 const source=read('faculty-admin.js');
 for(const id of ['doe-explain-modal','doe-explain-title','doe-explain-body','doe-explain-close'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(source,/function openDoeExplanation/);
 assert.match(source,/function wireDoeExplanationButtons/);
 assert.match(source,/data-doe-explain-line/);
 assert.match(source,/UCVM_DOE_WORKSHEET_VIEW\.explanationHtml/);
 assert.match(source,/doe-explain-close/);
});
