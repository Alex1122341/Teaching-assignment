'use strict';
const {applyTeachingReserve}=require('./reserve-service.js');

const text=value=>String(value??'').trim();
const finite=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null};
const round=value=>value===null?null:Number(Number(value).toFixed(6));
function lineSection(category){
 const value=text(category).toLowerCase();
 if(['supervision','trainee_supervision'].includes(value))return'supervision';
 if(['adjustment','exception','approved_activity'].includes(value))return'adjustments';
 if(['role','rotation','course_coordination'].includes(value))return'roles';
 return'scheduledTeaching';
}
function sumLines(lines){return round(lines.reduce((sum,row)=>sum+(finite(row.resultDoe)||0),0))}
function policyVersion(lines){
 const ids=[...new Set(lines.map(row=>text(row.policyVersionId)).filter(Boolean))];
 return ids.length===1?ids[0]:ids.length>1?'mixed':'';
}
function createWorksheetService({repository}={}){
 if(!repository?.getFacultyWorksheetSource)throw new Error('Faculty DOE worksheet repository is required.');
 function materializeWorksheet(source,{facultyId,academicYear}={}){
  if(!source)return{facultyId:text(facultyId),academicYear:text(academicYear),status:'not_found',lines:[],errors:[{code:'FACULTY_DOE_SOURCE_NOT_FOUND',message:'Faculty DOE source was not found.'}],totals:{assignedTeachingDoe:null,effectiveTargetDoe:null,remainingDoe:null}};
  const lines=(Array.isArray(source.lines)?source.lines:[]).map(row=>({...row}));
  const errors=[];
  if(text(source.policyStatus).toLowerCase()==='mixed')errors.push({code:'MIXED_POLICY_VERSIONS',message:'Faculty DOE source rows span multiple policy versions and require review.'});
  if(text(source.policyStatus).toLowerCase()==='missing_version')errors.push({code:'POLICY_VERSION_NOT_FOUND',message:'Faculty DOE provenance references a missing policy version.'});
  for(const row of lines){
   if(finite(row.resultDoe)===null||['needs_review','error'].includes(text(row.status).toLowerCase()))errors.push({code:'DOE_LINE_UNAVAILABLE',message:'A DOE line is unavailable and requires review.',lineId:text(row.lineId),sourceEntityId:text(row.sourceEntityId)});
  }
  const target=finite(source.target?.effectiveTargetDoe);
  if(target===null)errors.push({code:'DOE_TARGET_UNAVAILABLE',message:'Effective Teaching DOE target is unavailable.'});
  const sections={scheduledTeaching:{lines:[]},roles:{lines:[]},supervision:{lines:[]},adjustments:{lines:[]}};
  for(const row of lines)sections[lineSection(row.category)].lines.push(row);
  sections.scheduledTeaching.subtotal=sumLines(sections.scheduledTeaching.lines);
  sections.roles.subtotal=sumLines(sections.roles.lines);
  sections.supervision.rawSubtotal=sumLines(sections.supervision.lines);
  sections.adjustments.subtotal=sumLines(sections.adjustments.lines);
  let reserve=null;
  if(!errors.length){
   try{
    reserve=applyTeachingReserve({
     teachingTarget:target,stream:source.stream,rawSupervision:sections.supervision.rawSubtotal,
     assignedTeaching:round(sections.scheduledTeaching.subtotal+sections.roles.subtotal+sections.adjustments.subtotal),policy:source.reservePolicy
    });
   }catch(error){errors.push({code:error.code||'RESERVE_CALCULATION_FAILED',message:error.message})}
  }
  sections.supervision.appliedSubtotal=reserve?reserve.appliedSupervision:null;
  const assigned=errors.length?null:round(sections.scheduledTeaching.subtotal+sections.roles.subtotal+sections.adjustments.subtotal+reserve.appliedSupervision);
  const lastCalculatedAt=lines.map(row=>text(row.calculatedAt)).filter(Boolean).sort().at(-1)||'';
  return{
   facultyId:text(source.facultyId||facultyId),academicYear:text(source.academicYear||academicYear),displayName:text(source.displayName),stream:text(source.stream),
   status:errors.length?'needs_review':'calculated',policyVersionId:policyVersion(lines),target:{...(source.target||{})},reservePolicy:{...(source.reservePolicy||{})},reserve,
   lines,sections,errors,
   totals:{
    scheduledTeachingDoe:sections.scheduledTeaching.subtotal,roleDoe:sections.roles.subtotal,rawSupervisionDoe:sections.supervision.rawSubtotal,
    appliedSupervisionDoe:sections.supervision.appliedSubtotal,adjustmentDoe:sections.adjustments.subtotal,
    assignedTeachingDoe:assigned,effectiveTargetDoe:target,remainingDoe:assigned===null||target===null?null:round(target-assigned)
   },lastCalculatedAt
  };
 }
 async function buildFacultyWorksheet({facultyId,academicYear}={}){
  const source=await repository.getFacultyWorksheetSource(text(facultyId),text(academicYear));
  return materializeWorksheet(source,{facultyId,academicYear});
 }
 async function listFacultyDoe({academicYear}={}){
  const year=text(academicYear),worksheets=[];
  if(repository.listFacultyWorksheetSources){
   const sources=await repository.listFacultyWorksheetSources(year);
   for(const source of sources||[])worksheets.push(materializeWorksheet(source,{facultyId:source?.facultyId,academicYear:year}));
  }else{
   if(!repository.listFacultyIdsForDoe)throw new Error('Faculty DOE list repository is required.');
   const ids=await repository.listFacultyIdsForDoe(year);
   for(const facultyId of ids||[])worksheets.push(await buildFacultyWorksheet({facultyId,academicYear:year}));
  }
  return worksheets.map(row=>({facultyId:row.facultyId,displayName:row.displayName,academicYear:row.academicYear,policyVersionId:row.policyVersionId,status:row.status,lastCalculatedAt:row.lastCalculatedAt,...row.totals}));
 }
 return Object.freeze({buildFacultyWorksheet,listFacultyDoe});
}
module.exports={createWorksheetService,lineSection};
