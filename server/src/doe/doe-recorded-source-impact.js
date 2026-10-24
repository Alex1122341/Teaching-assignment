'use strict';
const crypto=require('node:crypto');
const finite=v=>v===null||v===undefined||v===''?null:Number(v);
const roleCategory={HICC:'hicc',VISC:'visc','Course Coordinator':'course_coordination','Rotation Participant':'rotation','Designated Rotation Coordinator':'rotation',CCC:'rotation'};
const supervisionTypes=['Undergraduate Supervision','VETM 506','4th Year Preceptor','IM','Graduate Primary Supervisor','Graduate Co-supervisor','Postdoctoral Fellow'];
function sourceFacts(source,line){
 const facts={academicYear:source.academicYear,facultyId:source.facultyId,sourceEntityId:line.sourceEntityId,lineId:line.lineId,assignmentId:line.lineId,sourceEntityType:line.sourceEntityType,scopeText:line.scopeText,roleType:line.roleType,...(line.facts||{})};
 if(line.sourceEntityType==='legacy_session_assignment')return {...facts,category:'teaching',teachingRole:line.roleType,hours:line.doeQuantity??line.creditedHours};
 const code=String(line.scopeText||'').match(/^(?:VTMD|VETM|Vet Med)\s*(\d+)/i);
 const ccc={};
 if(line.roleType==='CCC')for(const name of ['shifts','halfDayDeduction']){
  if(Object.hasOwn(line.facts||{},name))continue;
  const match=String(line.facts?.sourceDetails||'').match(new RegExp('(?:^|\\|)\\s*'+name+'=(\\d+(?:\\.\\d+)?)'));
  if(match)ccc[name]=Number(match[1]);
 }
 return {...facts,...ccc,category:roleCategory[line.roleType]||line.category,courseLabel:line.scopeText,courseCode:code?'VTMD '+code[1]:null,subjectKey:line.roleType==='VISC'?line.scopeText:null,...(line.roleType==='Designated Rotation Coordinator'&&line.scopeText?{uniqueRotationTypes:1}:{})};
}
function recordedDataset(sources){
 return (sources||[]).flatMap(source=>(source.lines||[]).filter(l=>['legacy_session_assignment','legacy_role_assignment','supervision_source_snapshot','manual_doe_assignment'].includes(l.sourceEntityType)).map(line=>({source:{facultyId:source.facultyId,academicYear:source.academicYear},line}))).sort((a,b)=>String(a.line.lineId).localeCompare(String(b.line.lineId)));
}
function datasetChecksum(normalized,recorded){
 return crypto.createHash('sha256').update(JSON.stringify({normalized,recorded})).digest('hex');
}
async function projectRecordedSource({source,line,calculate}){
 const oldDoe=line.applicable===false?0:finite(line.resultDoe);
 const row={facultyId:source.facultyId,sourceEntityType:line.sourceEntityType,sourceEntityId:line.sourceEntityId,oldDoe};
 try{
  if(line.facts?.sourceAllocationStatus==='source_missing')throw Object.assign(Error('The source allocation is missing; retain the recorded value.'),{code:'SOURCE_ALLOCATION_MISSING'});
  let projectedDoe;
  if(line.sourceEntityType==='manual_doe_assignment')projectedDoe=oldDoe; // Signed negotiated adjustments remain outside reserve.
  else if(line.sourceEntityType==='supervision_source_snapshot'){
   const counts=line.facts?.counts;
   if(!Array.isArray(counts)){
    if(line.facts?.ownerConfirmedZero&&oldDoe===0)projectedDoe=0;
    else throw Object.assign(Error('Source supervision counts are unavailable.'),{code:'SUPERVISION_DATA_UNAVAILABLE'});
   }else{
    if(counts.length!==7)throw Object.assign(Error('Source supervision count layout changed.'),{code:'SUPERVISION_DATA_UNAVAILABLE'});
    projectedDoe=0;
    for(let i=0;i<counts.length;i++)projectedDoe+=Number((await calculate({academicYear:source.academicYear,category:'supervision',activityType:supervisionTypes[i],trainees:counts[i],facultyId:source.facultyId})).resultDoe);
   }
  }else projectedDoe=Number((await calculate(sourceFacts(source,line))).resultDoe);
  if(!Number.isFinite(projectedDoe))throw Object.assign(Error('DOE source projection is unavailable.'),{code:'REQUIRED_INPUT_MISSING'});
  const deltaDoe=oldDoe===null?null:Number((projectedDoe-oldDoe).toFixed(6));
  return {...row,projectedDoe,deltaDoe,status:deltaDoe===0?'unchanged':'calculated',issueCode:null};
 }catch(error){
  const issueCode=error.code||'NEEDS_REVIEW';
  return {...row,projectedDoe:null,deltaDoe:null,status:['COURSE_MAPPING_REQUIRED','SUBJECT_MAPPING_REQUIRED'].includes(issueCode)?'needs_mapping':'needs_review',issueCode};
 }
}
module.exports={recordedDataset,datasetChecksum,sourceFacts,projectRecordedSource};
