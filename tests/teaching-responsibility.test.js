'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const responsibility=require('../teaching-responsibility.js');
const academic=require('../academic-responsibility.js');

const hicc=()=>responsibility.createResponsibility({
 id:'hicc-vtmd204',kind:'hicc',groupId:'year-2',label:'VTMD 204 HICC',
 academicScopeTokens:['hicc|VTMD 204|*']
});

test('stable responsibility keeps one package identity while Bill and Lisa rotate',()=>{
 const r=hicc();
 const packageId=responsibility.submissionDocumentId('2026-27',r.groupId,r.id);
 assert.equal(packageId,responsibility.submissionDocumentId('2026-27',r.groupId,r.id));
 assert.doesNotMatch(packageId,/bill|lisa/i);
 const lisa=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'lisa',facultyId:'f-lisa',windows:[{activeDate:'2026-09-01',expirationDate:'2027-03-01',sourceDoeAssignmentFactId:'doe-lisa'}]});
 const bill=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'bill',facultyId:'f-bill',windows:[{activeDate:'2027-03-01',expirationDate:'2027-05-01',sourceDoeAssignmentFactId:'doe-bill'}]});
 responsibility.validateResponsibilitySchedule(r,[lisa,bill]);
 assert.equal(responsibility.effectiveAssignee([lisa,bill],'2027-02-28').assigneeUid,'lisa');
 assert.equal(responsibility.effectiveAssignee([lisa,bill],'2027-03-01').assigneeUid,'bill');
});

test('one assignee may return later in the same year using multiple non-overlapping windows',()=>{
 const r=hicc();
 const bill=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'bill',windows:[
  {activeDate:'2026-09-01',expirationDate:'2026-10-01'},
  {activeDate:'2027-03-01',expirationDate:'2027-05-01'}
 ]});
 assert.equal(responsibility.scheduleActiveAt(bill,'2026-09-15'),true);
 assert.equal(responsibility.scheduleActiveAt(bill,'2026-10-01'),false);
 assert.equal(responsibility.scheduleActiveAt(bill,'2027-03-01'),true);
});

test('overlapping assignees fail closed but adjacent half-open windows are valid',()=>{
 const r=hicc(),bill=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'bill',windows:[{activeDate:'2026-09-01',expirationDate:'2027-03-01'}]});
 const lisaOverlap=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'lisa',windows:[{activeDate:'2027-02-28',expirationDate:'2027-05-01'}]});
 assert.throws(()=>responsibility.validateResponsibilitySchedule(r,[bill,lisaOverlap]),/overlapping effective assignees/i);
 const lisaAdjacent=responsibility.normalizeAssigneeSchedule({responsibilityId:r.id,academicYearKey:'2026-27',assigneeUid:'lisa',windows:[{activeDate:'2027-03-01',expirationDate:'2027-05-01'}]});
 assert.doesNotThrow(()=>responsibility.validateResponsibilitySchedule(r,[bill,lisaAdjacent]));
});

test('HICC scope belongs to the stable responsibility, not the temporary assignee profile',()=>{
 const profile=responsibility.scopeProfile(hicc());
 assert.equal(academic.hasScope(profile,'hicc',{course:'VTMD 204',subjectKey:'surgery'}),true);
 assert.equal(academic.hasScope(profile,'hicc',{course:'VTMD 205',subjectKey:'surgery'}),false);
});

test('VISC responsibility is group leadership and carries no HICC Course Subject tokens',()=>{
 const visc=responsibility.createResponsibility({id:'visc-year-2',kind:'visc',groupId:'year-2',label:'Year 2 VISC'});
 assert.deepEqual(visc.academicScopeTokens,[]);
 assert.equal(responsibility.scopeProfile(visc).role,'visc');
});

test('assignee Firestore path is directly resolvable from responsibility year and authenticated UID',()=>{
 assert.equal(responsibility.assigneePath('hicc-vtmd204','2026-27','uid-lisa'),'teaching_responsibilities/hicc-vtmd204/years/2026-27/assignees/uid-lisa');
});

test('VISC responsibility may be reused by multiple explicitly configured groups',()=>{
 const visc=responsibility.createResponsibility({id:'visc-shared',kind:'visc',label:'Shared VISC'});
 assert.equal(visc.groupId,'');
 assert.deepEqual(visc.academicScopeTokens,[]);
});

test('safe assignee projection excludes DOE leave reasons and private notes while adding Calgary timestamps',()=>{
 const row=responsibility.safeAssigneeProjection({
  responsibilityId:'hicc-vtmd204',academicYearKey:'2026-27',assigneeUid:'lisa',facultyId:'f-lisa',enabled:true,
  windows:[{activeDate:'2026-09-01',expirationDate:'2027-03-01',sourceDoeAssignmentFactId:'doe-lisa'}],
  doeCredit:12,doeOverride:-2,notes:'RSL private note',afcReason:'private'
 });
 assert.equal(row.windows[0].activeAtIso,'2026-09-01T06:00:00.000Z');
 assert.equal(row.windows[0].expiresAtIso,'2027-03-01T07:00:00.000Z');
 for(const key of ['doeCredit','doeOverride','notes','afcReason'])assert.equal(Object.hasOwn(row,key),false,key);
});

for(const [field,value] of [
 ['id',['hicc-vtmd204']],['kind',['hicc']],['groupId',['year-2']],['label',false],['active','false'],['active',null],
 ['academicScopeTokens',[['hicc|VTMD 204|*']]],['academicScopeTokens',Array.from({length:65},(_,i)=>`hicc|VTMD ${200+i}|*`)]
])test(`responsibility rejects malformed supplied ${field}: ${JSON.stringify(value)}`,()=>{
 assert.throws(()=>responsibility.createResponsibility({...hicc(),[field]:value}));
});

test('VISC rejects a supplied non-list scope collection rather than discarding it',()=>{
 for(const academicScopeTokens of [null,'hicc|VTMD 204|*',{}])assert.throws(()=>responsibility.createResponsibility({id:'visc-year-2',kind:'visc',academicScopeTokens}));
});

const scheduleInput=()=>({responsibilityId:'hicc-vtmd204',academicYearKey:'2026-27',assigneeUid:'bill',facultyId:'f-bill',windows:[{activeDate:'2026-09-01',expirationDate:'2027-05-01'}]});
for(const [field,value] of [
 ['responsibilityId',['hicc-vtmd204']],['academicYearKey',['2026-27']],['assigneeUid',123],['facultyId',['f-bill']],['enabled','false'],['enabled',null],
 ['windows',[null]],['windows',[{}]],['windows',[{activeDate:'',expirationDate:''}]],
 ['windows',[{activeDate:['2026-09-01'],expirationDate:'2027-05-01'}]],
 ['windows',[{activeDate:'2026-09-01',expirationDate:'2027-05-01',sourceDoeAssignmentFactId:{}}]]
])test(`schedule rejects malformed supplied ${field}: ${JSON.stringify(value)}`,()=>{
 assert.throws(()=>responsibility.normalizeAssigneeSchedule({...scheduleInput(),[field]:value}));
});

test('explicit default date window remains valid and arbitrary valid coverage dates are retained',()=>{
 const temporal=require('../temporal-role-assignment.js');
 assert.deepEqual(responsibility.normalizeAssigneeSchedule({...scheduleInput(),windows:[temporal.defaultWindow('2026-27')]}).windows[0],{activeDate:'2026-09-01',expirationDate:'2027-05-01',sourceDoeAssignmentFactId:''});
 const row=responsibility.normalizeAssigneeSchedule({...scheduleInput(),windows:[{activeDate:'2026-06-01',expirationDate:'2027-08-31'}]});
 assert.equal(row.windows[0].activeDate,'2026-06-01');
 assert.equal(row.windows[0].expirationDate,'2027-08-31');
});

test('complete schedule validation rejects non-list input and duplicate assignee documents',()=>{
 assert.throws(()=>responsibility.validateResponsibilitySchedule(hicc(),{}));
 const first=scheduleInput(),second={...scheduleInput(),windows:[{activeDate:'2027-05-01',expirationDate:'2027-06-01'}]};
 assert.throws(()=>responsibility.validateResponsibilitySchedule(hicc(),[first,second]),/duplicate/i);
});
