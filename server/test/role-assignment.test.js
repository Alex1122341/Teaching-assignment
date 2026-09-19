'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ENGINE=require('../../doe-policy-engine.js');
const {createCalculationService}=require('../src/doe/calculation-service.js');

const general={uid:'general',name:'General Admin',email:'general@example.test',role:'adfa_general'};
function bundle(){return{
 policy:{policyId:'p',academicYear:'2027-28',currentActiveVersionId:'v1'},version:{policyVersionId:'v1',policyId:'p',academicYear:'2027-28',status:'active'},exceptions:[],
 rules:[{ruleId:'hicc',ruleKey:'role.hicc.development',policyVersionId:'v1',category:'role',priority:100,enabled:true,calculationMode:'formula',formulaText:'units * rate',resultKind:'credit',referenceId:'ref',mappingRequirement:'course',selectors:[{field:'roleType',operator:'equals',valueText:'HICC'}],inputs:[{inputName:'units',required:true,source:'course_mapping.unitCount'}],parameters:[{name:'rate',valueNumber:2}],tiers:[]}],
 references:[{referenceId:'ref',title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5}],courseMappings:[{mappingId:'c204',academicYear:'2027-28',policyVersionId:'v1',courseCode:'VTMD 204',unitCount:6,enabled:true}],subjectMappings:[]
};}
function repository(){const writes=[];return{writes,getActivePolicyBundle:async()=>bundle(),async saveDoeAssignmentCalculation(payload){writes.push(structuredClone(payload));return payload.assignment;}}}

test('saveRoleAssignment calculates DOE server-side and atomically persists facts plus evidence',async()=>{
 const repo=repository();
 const service=createCalculationService({repository:repo,engine:ENGINE,idFactory:()=> 'calc-1',assignmentIdFactory:()=> 'role-1',clock:()=>new Date('2026-09-19T12:00:00Z')});
 const result=await service.saveRoleAssignment({actor:general,academicYear:'2027-28',facultyId:'f1',facts:{roleType:'HICC',courseCode:'VTMD 204',doeCredit:99}});
 assert.equal(result.assignment.assignmentFactId,'role-1');
 assert.equal(result.assignment.doeCredit,12);
 assert.equal(result.assignment.doeRuleKey,'role.hicc.development');
 assert.equal(Object.hasOwn(result.assignment.facts,'doeCredit'),false);
 assert.equal(repo.writes.length,1);
 assert.equal(repo.writes[0].calculationRecord.resultDoe,12);
 assert.equal(repo.writes[0].assignment.doeCalculationId,'calc-1');
});

test('non-admin cannot save a role assignment',async()=>{
 const service=createCalculationService({repository:repository(),engine:ENGINE});
 await assert.rejects(()=>service.saveRoleAssignment({actor:{uid:'f1',role:'faculty'},academicYear:'2027-28',facultyId:'f1',facts:{roleType:'HICC',courseCode:'VTMD 204'}}),error=>error.code==='FORBIDDEN');
});
