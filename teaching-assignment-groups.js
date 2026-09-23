/* Pure Teaching Assignment group model. Persistence and Firestore Rules live elsewhere. */
(function(root,factory){
 const responsibilities=typeof module==='object'&&module.exports?require('./teaching-responsibility.js'):root?.UCVM_TEACHING_RESPONSIBILITY;
 const api=factory(responsibilities);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_TEACHING_ASSIGNMENT_GROUPS=api;
})(typeof window!=='undefined'?window:null,function(responsibilities){
 'use strict';
 if(!responsibilities)throw Error('Teaching Assignment groups require teaching-responsibility.');
 const ID=/^[a-z][a-z0-9_-]{0,63}$/;
 const text=value=>String(value??'').trim();
 function canonicalId(value,field='id'){
  const id=text(value);
  if(!ID.test(id))throw Error(`${field} must be a canonical lowercase slug.`);
  return id;
 }
 function createGroup(input={}){
  const id=canonicalId(input.id),name=text(input.name);
  if(!name||name.length>120)throw Error('Teaching Assignment group name must be 1 to 120 characters.');
  const leaderViscResponsibilityId=canonicalId(input.leaderViscResponsibilityId,'leaderViscResponsibilityId');
  const source=Array.isArray(input.hiccResponsibilityIds)?input.hiccResponsibilityIds:[];
  if(!source.length)throw Error('Teaching Assignment group requires at least one HICC responsibility.');
  const hiccResponsibilityIds=[];
  const seen=new Set();
  for(const value of source){
   const responsibilityId=canonicalId(value,'hiccResponsibilityId');
   if(seen.has(responsibilityId))throw Error('Teaching Assignment group contains duplicate HICC responsibilities.');
   seen.add(responsibilityId);hiccResponsibilityIds.push(responsibilityId);
  }
  return Object.freeze({
   id,name,leaderViscResponsibilityId,
   hiccResponsibilityIds:Object.freeze([...hiccResponsibilityIds]),
   active:input.active!==false
  });
 }
 function validateGroupResponsibilities(group,input={}){
  const g=createGroup(group),rows=Array.isArray(input.responsibilities)?input.responsibilities:[];
  const byId=new Map();
  for(const row of rows){
   const normalized=responsibilities.createResponsibility(row);
   if(byId.has(normalized.id))throw Error('Duplicate Teaching responsibility definition.');
   byId.set(normalized.id,normalized);
  }
  const leader=byId.get(g.leaderViscResponsibilityId);
  if(!leader||leader.kind!=='visc')throw Error('Group leader must be an active VISC responsibility.');
  if(leader.active===false)throw Error('Group leader VISC responsibility is inactive.');
  for(const id of g.hiccResponsibilityIds){
   const row=byId.get(id);
   if(!row||row.kind!=='hicc'||row.groupId!==g.id)throw Error('Every HICC responsibility must belong to the group.');
   if(row.active===false)throw Error('Group contains an inactive HICC responsibility.');
  }
  return Object.freeze({group:g,leaderViscResponsibility:leader,hiccResponsibilities:Object.freeze(g.hiccResponsibilityIds.map(id=>byId.get(id)))});
 }
 function groupContainsHicc(group,hiccResponsibilityId){
  let g;try{g=createGroup(group)}catch(_){return false}
  let id;try{id=canonicalId(hiccResponsibilityId,'hiccResponsibilityId')}catch(_){return false}
  return g.active===true&&g.hiccResponsibilityIds.includes(id);
 }
 function submissionDocumentId(academicYearKey,groupId,hiccResponsibilityId){
  return responsibilities.submissionDocumentId(academicYearKey,canonicalId(groupId,'groupId'),canonicalId(hiccResponsibilityId,'hiccResponsibilityId'));
 }
 function sessionOwnership(input={}){
  const teachingAssignmentGroupId=canonicalId(input.teachingAssignmentGroupId,'teachingAssignmentGroupId');
  const responsibleHiccResponsibilityId=canonicalId(input.responsibleHiccResponsibilityId,'responsibleHiccResponsibilityId');
  const academicYearKey=text(input.academicYear||input.academicYearKey);
  const teachingAssignmentSubmissionId=submissionDocumentId(academicYearKey,teachingAssignmentGroupId,responsibleHiccResponsibilityId);
  return Object.freeze({teachingAssignmentGroupId,responsibleHiccResponsibilityId,teachingAssignmentSubmissionId});
 }
 function ownershipMatchesGroup(group,ownership={}){
  let g,o;try{g=createGroup(group);o=sessionOwnership(ownership)}catch(_){return false}
  return g.active===true&&g.id===o.teachingAssignmentGroupId&&g.hiccResponsibilityIds.includes(o.responsibleHiccResponsibilityId);
 }
 function groupsLedByViscResponsibility(groups=[],viscResponsibilityId){
  let id;try{id=canonicalId(viscResponsibilityId,'leaderViscResponsibilityId')}catch(_){return[]}
  return (Array.isArray(groups)?groups:[]).map(row=>{try{return createGroup(row)}catch(_){return null}})
   .filter(row=>row&&row.active===true&&row.leaderViscResponsibilityId===id);
 }
 return Object.freeze({createGroup,validateGroupResponsibilities,groupContainsHicc,submissionDocumentId,sessionOwnership,ownershipMatchesGroup,groupsLedByViscResponsibility});
});
