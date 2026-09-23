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


test('role assignment dates are independent from DOE and a manual override may be negative',async()=>{
 const repo=repository();
 const service=createCalculationService({repository:repo,engine:ENGINE,idFactory:()=> 'calc-override',assignmentIdFactory:()=> 'role-override',clock:()=>new Date('2026-09-19T12:00:00Z')});
 const result=await service.saveRoleAssignment({actor:general,academicYear:'2027-28',facultyId:'f1',facts:{roleType:'HICC',courseCode:'VTMD 204',activeDate:'2027-09-15',expirationDate:'2028-03-01',doeOverride:-2.5,notes:'Acting coverage'}});
 assert.equal(result.calculation.calculatedDoe,12);
 assert.equal(result.calculation.overrideDoe,-2.5);
 assert.equal(result.calculation.resultDoe,-2.5);
 assert.equal(result.assignment.doeCalculatedCredit,12);
 assert.equal(result.assignment.doeOverride,-2.5);
 assert.equal(result.assignment.doeCredit,-2.5);
 assert.equal(result.assignment.activeDate,'2027-09-15');
 assert.equal(result.assignment.expirationDate,'2028-03-01');
 assert.equal(repo.writes[0].calculationRecord.resultDoe,-2.5);
 assert.equal(repo.writes[0].calculationRecord.policyCalculatedDoe,12);
 assert.match(repo.writes[0].calculationRecord.calculationText,/manual role override/i);
});

test('role assignment rejects an expiration date that is not later than the active date',async()=>{
 const service=createCalculationService({repository:repository(),engine:ENGINE});
 await assert.rejects(()=>service.saveRoleAssignment({actor:general,academicYear:'2027-28',facultyId:'f1',facts:{roleType:'HICC',courseCode:'VTMD 204',activeDate:'2028-03-01',expirationDate:'2028-03-01'}}),error=>error.code==='ROLE_DATE_WINDOW_INVALID');
});

test('saveRoleAssignment calculates DOE server-side and atomically persists facts plus evidence',async()=>{
 const repo=repository();
 const service=createCalculationService({repository:repo,engine:ENGINE,idFactory:()=> 'calc-1',assignmentIdFactory:()=> 'role-1',clock:()=>new Date('2026-09-19T12:00:00Z')});
 const result=await service.saveRoleAssignment({actor:general,academicYear:'2027-28',facultyId:'f1',facts:{roleType:'HICC',courseCode:'VTMD 204',doeCredit:99}});
 assert.equal(result.assignment.assignmentFactId,'role-1');
 assert.equal(result.assignment.doeCredit,12);
 assert.equal(result.assignment.doeCalculatedCredit,12);
 assert.equal(result.assignment.doeOverride,null);
 assert.equal(result.assignment.activeDate,'2027-09-01');
 assert.equal(result.assignment.expirationDate,'2028-05-01');
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

test('annual role copy shifts dates recalculates target DOE and clears case-specific override and notes',async()=>{
 const repo=repository();
 repo.listRoleAssignmentsForYear=async year=>year==='2026-27'?[{
  assignmentFactId:'old-role',academicYear:'2026-27',facultyId:'f1',category:'role',roleType:'HICC',courseCode:'VTMD 204',
  activeDate:'2026-09-15',expirationDate:'2027-03-01',doeCalculatedCredit:12,doeOverride:-2,doeCredit:-2,notes:'RSL acting coverage',
  facts:{roleType:'HICC',courseCode:'VTMD 204',activeDate:'2026-09-15',expirationDate:'2027-03-01',doeOverride:-2,notes:'RSL acting coverage',responsibilityId:'hicc-vtmd204'}
 }]:[];
 const service=createCalculationService({repository:repo,engine:ENGINE,idFactory:()=> 'calc-copy',assignmentIdFactory:()=> 'role-copy',clock:()=>new Date('2027-06-01T12:00:00Z')});
 const result=await service.copyRoleAssignmentsYear({actor:general,sourceYear:'2026-27',targetYear:'2027-28'});
 assert.equal(result.copied,1);
 const row=result.assignments[0];
 assert.equal(row.activeDate,'2027-09-15');
 assert.equal(row.expirationDate,'2028-03-01');
 assert.equal(row.doeCalculatedCredit,12);
 assert.equal(row.doeOverride,null);
 assert.equal(row.doeCredit,12);
 assert.equal(row.notes,'');
 assert.equal(row.responsibilityId,'hicc-vtmd204');
 assert.equal(row.copiedFromAssignmentFactId,'old-role');
 assert.equal(row.copiedFromAcademicYear,'2026-27');
});

test('annual role copy refuses a nonempty target and is general-admin only',async()=>{
 const repo=repository();
 repo.listRoleAssignmentsForYear=async year=>year==='2027-28'?[{assignmentFactId:'existing',academicYear:year,facultyId:'f1',category:'role',active:true}]:[];
 const service=createCalculationService({repository:repo,engine:ENGINE});
 await assert.rejects(()=>service.copyRoleAssignmentsYear({actor:general,sourceYear:'2026-27',targetYear:'2027-28'}),error=>error.code==='ROLE_COPY_TARGET_NOT_EMPTY');
 await assert.rejects(()=>service.copyRoleAssignmentsYear({actor:{uid:'r',role:'adfa_regular'},sourceYear:'2026-27',targetYear:'2027-28'}),error=>error.code==='FORBIDDEN');
});
