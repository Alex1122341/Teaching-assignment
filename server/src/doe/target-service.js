'use strict';
const {randomUUID}=require('node:crypto');
const {ApiError}=require('../http/errors.js');

const adminRoles=new Set(['developer','owner','administrator','admin','adfa_general','adfa_regular']);
const text=value=>String(value??'').trim();
const role=value=>text(value).toLowerCase();
const finite=value=>{if(value===null||value===undefined||value==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null};

function contractTeachingDoe(faculty={}){
  for(const value of [faculty?.doe?.teaching,faculty?.doeTeaching,faculty?.teachingDOE,faculty?.contractTeachingDOE]){
    const numeric=finite(value);if(numeric!==null)return numeric;
  }
  return null;
}

function createTargetService({repository,clock=()=>new Date(),idFactory=randomUUID}={}){
  if(!repository?.getFacultyRecord||!repository?.getActivePolicyBundle||!repository?.saveFacultyTarget)throw new Error('DOE target service requires faculty, Active policy, and target repository methods.');
  async function saveFacultyTarget({actor={},facultyId,academicYear,override=null}={}){
    if(!adminRoles.has(role(actor.role)))throw new ApiError('FORBIDDEN','This account cannot edit Faculty DOE targets.',403);
    const id=text(facultyId),year=text(academicYear);
    if(!id||!year)throw new ApiError('DOE_TARGET_INVALID','Faculty ID and Academic Year are required.',422);
    const faculty=await repository.getFacultyRecord(id);
    if(!faculty)throw new ApiError('FACULTY_NOT_FOUND','Faculty record was not found.',404,{facultyId:id});
    const bundle=await repository.getActivePolicyBundle(year);
    const contract=contractTeachingDoe(faculty);
    let overrideDoe=null,overrideReason='',overrideNotes='';
    if(override!==null&&override!==undefined){
      overrideDoe=finite(override?.value);
      overrideReason=text(override?.reason);
      overrideNotes=text(override?.notes);
      if(overrideDoe===null||overrideDoe<0||!overrideReason)throw new ApiError('DOE_TARGET_OVERRIDE_INVALID','DOE target override requires a non-negative value and reason.',422);
    }
    const effective=overrideDoe!==null?overrideDoe:contract;
    if(effective===null)throw new ApiError('DOE_TARGET_UNAVAILABLE','Faculty contract Teaching DOE is unavailable and no approved override was supplied.',422,{facultyId:id,academicYear:year});
    const now=clock(),changedAt=now instanceof Date?now.toISOString():String(now),targetId=`${id}--${year}`,policyVersionId=text(bundle?.version?.policyVersionId);
    const target={targetId,facultyId:id,academicYear:year,contractTeachingDoe:contract,overrideDoe,overrideReason,overrideNotes,effectiveTargetDoe:effective,source:overrideDoe!==null?'approved_override':'contract',policyVersionId,active:true,updatedBy:text(actor.uid),updatedByName:text(actor.name),updatedAt:changedAt};
    const auditRecord={auditId:`faculty-target-${idFactory()}`,policyVersionId,action:'faculty_doe_target_saved',entityType:'faculty_doe_target',entityId:targetId,facultyId:id,academicYear:year,before:null,after:{...target},changedBy:text(actor.uid),changedByName:text(actor.name),changedByEmail:text(actor.email),changedAt};
    return repository.saveFacultyTarget({target,auditRecord});
  }
  return Object.freeze({saveFacultyTarget});
}

module.exports={createTargetService,contractTeachingDoe};
