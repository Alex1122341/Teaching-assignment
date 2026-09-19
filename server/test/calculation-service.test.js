'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ENGINE=require('../../doe-policy-engine.js');
const {createCalculationService}=require('../src/doe/calculation-service.js');

const general={uid:'general',name:'General Admin',email:'general@example.test',role:'adfa_general'};

function hiccBundle({ambiguous=false}={}){
 const rule={
  ruleId:'rule-hicc',ruleKey:'role.hicc.development',policyVersionId:'active-v1',category:'role',priority:100,enabled:true,
  calculationMode:'formula',formulaText:'units * rate',resultKind:'credit',referenceId:'wg-6-4-t3',
  selectors:[{field:'roleType',operator:'equals',valueText:'HICC'}],
  inputs:[{inputName:'units',required:true,source:'course_mapping.unitCount'}],
  parameters:[{name:'rate',valueNumber:2,unit:'percent_per_unit'}],tiers:[]
 };
 return{
  policy:{policyId:'policy-2027',academicYear:'2027-28',currentActiveVersionId:'active-v1'},
  version:{policyVersionId:'active-v1',policyId:'policy-2027',academicYear:'2027-28',status:'active'},
  rules:ambiguous?[rule,{...rule,ruleId:'rule-hicc-2',ruleKey:'role.hicc.alt'}]:[rule],exceptions:[],
  references:[{referenceId:'wg-6-4-t3',title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5}],
  courseMappings:[{mappingId:'course-204',academicYear:'2027-28',policyVersionId:'active-v1',courseCode:'VTMD 204',unitCount:6,enabled:true}],subjectMappings:[]
 };
}

function fixtureRepository(bundle=hiccBundle()){
 const records=[];
 return{
  records,
  async getActivePolicyBundle(){return structuredClone(bundle)},
  async createCalculationRecord(row){records.push(structuredClone(row));return row;}
 };
}

test('HICC calculation resolves database course mapping and database rate',async()=>{
 const repository=fixtureRepository();
 const service=createCalculationService({repository,engine:ENGINE,idFactory:()=> 'calc-1',clock:()=>new Date('2026-09-19T12:00:00Z')});
 const result=await service.calculateAssignment({
  actor:general,academicYear:'2027-28',facts:{category:'role',roleType:'HICC',courseCode:'VTMD 204'}
 });
 assert.equal(result.resultDoe,12);
 assert.equal(result.inputs.units,6);
 assert.equal(result.ruleKey,'role.hicc.development');
 assert.equal(result.reference.section,'6.4');
 assert.match(result.calculationText,/6/);
 assert.match(result.calculationText,/2/);
});

test('missing required course mapping fails closed',async()=>{
 const repository=fixtureRepository({...hiccBundle(),courseMappings:[]});
 const service=createCalculationService({repository,engine:ENGINE});
 await assert.rejects(
  ()=>service.calculateAssignment({actor:general,academicYear:'2027-28',facts:{category:'role',roleType:'HICC',courseCode:'VTMD 999'}}),
  error=>error.code==='COURSE_MAPPING_REQUIRED'
 );
});

test('equal-priority rule ambiguity is returned as an error',async()=>{
 const service=createCalculationService({repository:fixtureRepository(hiccBundle({ambiguous:true})),engine:ENGINE});
 await assert.rejects(
  ()=>service.calculateAssignment({actor:general,academicYear:'2027-28',facts:{category:'role',roleType:'HICC',courseCode:'VTMD 204'}}),
  error=>error.code==='RULE_AMBIGUOUS'
 );
});

test('client-supplied doeCredit never overrides deterministic calculation',async()=>{
 const service=createCalculationService({repository:fixtureRepository(),engine:ENGINE});
 const result=await service.calculateAssignment({
  actor:general,academicYear:'2027-28',facts:{category:'role',roleType:'HICC',courseCode:'VTMD 204',doeCredit:99}
 });
 assert.equal(result.resultDoe,12);
 assert.notEqual(result.resultDoe,99);
 assert.equal(Object.hasOwn(result.inputs,'doeCredit'),false);
});

test('persisted calculation appends immutable evidence only when requested',async()=>{
 const repository=fixtureRepository();
 const service=createCalculationService({repository,engine:ENGINE,idFactory:()=> 'calc-1',clock:()=>new Date('2026-09-19T12:00:00Z')});
 await service.calculateAssignment({actor:general,academicYear:'2027-28',facts:{category:'role',roleType:'HICC',courseCode:'VTMD 204'},persist:false});
 assert.equal(repository.records.length,0);
 const result=await service.calculateAssignment({actor:general,academicYear:'2027-28',facts:{category:'role',roleType:'HICC',courseCode:'VTMD 204',facultyId:'f1'},persist:true});
 assert.equal(result.calculationId,'calc-1');
 assert.equal(repository.records.length,1);
 assert.equal(repository.records[0].resultDoe,12);
 assert.equal(repository.records[0].referenceSnapshot.section,'6.4');
 assert.equal(repository.records[0].calculatedBy,'general');
 assert.equal(repository.records[0].category,'role');
 assert.equal(repository.records[0].factsSnapshot.roleType,'HICC');
 assert.equal(repository.records[0].factsSnapshot.courseCode,'VTMD 204');
 assert.match(repository.records[0].calculationText,/6/);
});

test('database-declared subject mapping requirement fails closed before calculation',async()=>{
  const bundle=hiccBundle();
  bundle.rules=[{
    ruleId:'visc-rule',ruleKey:'role.visc.development',policyVersionId:'active-v1',category:'role',priority:100,enabled:true,
    calculationMode:'fixed',resultKind:'credit',mappingRequirement:'subject',referenceId:'wg-6-4-t3',
    selectors:[{field:'roleType',operator:'equals',valueText:'VISC'}],parameters:[{name:'fixed',valueNumber:5}],inputs:[]
  }];
  bundle.subjectMappings=[];
  const service=createCalculationService({repository:{getActivePolicyBundle:async()=>bundle},engine:ENGINE});
  await assert.rejects(
    ()=>service.calculateAssignment({actor:general,academicYear:'2027-28',facts:{category:'role',roleType:'VISC',subjectKey:'anatomy'}}),
    error=>error.code==='SUBJECT_MAPPING_REQUIRED'
  );
});
