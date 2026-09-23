'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const groups=require('../teaching-assignment-groups.js');

const responsibilities=[
 {id:'visc-bovine',kind:'visc',label:'Bovine VISC'},
 {id:'hicc-bovine-medicine',kind:'hicc',groupId:'bovine',label:'Bovine Medicine HICC',academicScopeTokens:['hicc|VTMD 506|medicine']},
 {id:'hicc-bovine-surgery',kind:'hicc',groupId:'bovine',label:'Bovine Surgery HICC',academicScopeTokens:['hicc|VTMD 506|surgery']}
];
const bovine=()=>({id:'bovine',name:'Bovine',leaderViscResponsibilityId:'visc-bovine',hiccResponsibilityIds:['hicc-bovine-medicine','hicc-bovine-surgery'],active:true});

test('normalizes a group using stable responsibility IDs, never assignee UIDs',()=>{
 const group=groups.createGroup(bovine());
 assert.deepEqual(group.hiccResponsibilityIds,['hicc-bovine-medicine','hicc-bovine-surgery']);
 assert.equal(group.leaderViscResponsibilityId,'visc-bovine');
 assert.equal(Object.hasOwn(group,'hiccUids'),false);
 assert.equal(Object.hasOwn(group,'leaderViscUid'),false);
});

test('validates VISC leader and HICC membership against stable responsibilities',()=>{
 const result=groups.validateGroupResponsibilities(bovine(),{responsibilities});
 assert.equal(result.leaderViscResponsibility.kind,'visc');
 assert.equal(result.hiccResponsibilities.length,2);
 assert.throws(()=>groups.validateGroupResponsibilities({...bovine(),leaderViscResponsibilityId:'hicc-bovine-medicine'},{responsibilities}),/leader/i);
 assert.throws(()=>groups.validateGroupResponsibilities({...bovine(),hiccResponsibilityIds:['visc-bovine']},{responsibilities}),/HICC responsibility/i);
});

test('group identifiers, duplicate HICCs, and inactive responsibilities fail closed',()=>{
 assert.throws(()=>groups.createGroup({...bovine(),id:'Bovine Team'}),/canonical lowercase slug/i);
 assert.throws(()=>groups.createGroup({...bovine(),hiccResponsibilityIds:['hicc-bovine-medicine','hicc-bovine-medicine']}),/duplicate HICC/i);
 const inactive=responsibilities.map(row=>row.id==='hicc-bovine-surgery'?{...row,active:false}:row);
 assert.throws(()=>groups.validateGroupResponsibilities(bovine(),{responsibilities:inactive}),/inactive HICC/i);
});

test('submission identity is deterministic ta-sub-v2 and independent of current assignee',()=>{
 const a=groups.submissionDocumentId('2026-27','bovine','hicc-bovine-medicine');
 const b=groups.submissionDocumentId('2026-27','bovine','hicc-bovine-medicine');
 assert.equal(a,b);
 assert.match(a,/^ta-sub-v2__/);
 assert.doesNotMatch(a,/bill|lisa|uid/i);
});

test('trusted session ownership derives submission locator from year group and HICC responsibility',()=>{
 const row=groups.sessionOwnership({academicYear:'2026-27',teachingAssignmentGroupId:'bovine',responsibleHiccResponsibilityId:'hicc-bovine-medicine'});
 assert.equal(row.teachingAssignmentSubmissionId,groups.submissionDocumentId('2026-27','bovine','hicc-bovine-medicine'));
 assert.equal(groups.ownershipMatchesGroup(bovine(),{academicYear:'2026-27',...row}),true);
 assert.equal(groups.ownershipMatchesGroup(bovine(),{academicYear:'2026-27',...row,responsibleHiccResponsibilityId:'hicc-other'}),false);
});

test('VISC may explicitly lead multiple groups without broad implicit authority',()=>{
 const rows=[
  bovine(),
  {id:'equine',name:'Equine',leaderViscResponsibilityId:'visc-bovine',hiccResponsibilityIds:['hicc-equine'],active:true},
  {id:'small-animal',name:'Small Animal',leaderViscResponsibilityId:'visc-small-animal',hiccResponsibilityIds:['hicc-small-animal'],active:true},
  {id:'inactive',name:'Inactive',leaderViscResponsibilityId:'visc-bovine',hiccResponsibilityIds:['hicc-inactive'],active:false}
 ];
 assert.deepEqual(groups.groupsLedByViscResponsibility(rows,'visc-bovine').map(row=>row.id),['bovine','equine']);
 assert.deepEqual(groups.groupsLedByViscResponsibility(rows,'VISc-Bovine'),[]);
});

test('same VISC responsibility can lead multiple groups only through explicit group configuration',()=>{
 const visc={id:'visc-shared',kind:'visc',label:'Shared VISC'};
 const bovineResp=[visc,{id:'hicc-bovine',kind:'hicc',groupId:'bovine',label:'Bovine HICC',academicScopeTokens:['hicc|VTMD 506|*']}];
 const equineResp=[visc,{id:'hicc-equine',kind:'hicc',groupId:'equine',label:'Equine HICC',academicScopeTokens:['hicc|VTMD 507|*']}];
 assert.doesNotThrow(()=>groups.validateGroupResponsibilities({id:'bovine',name:'Bovine',leaderViscResponsibilityId:'visc-shared',hiccResponsibilityIds:['hicc-bovine']},{responsibilities:bovineResp}));
 assert.doesNotThrow(()=>groups.validateGroupResponsibilities({id:'equine',name:'Equine',leaderViscResponsibilityId:'visc-shared',hiccResponsibilityIds:['hicc-equine']},{responsibilities:equineResp}));
});
