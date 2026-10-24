'use strict';
const {createWorksheetService}=require('../doe/doe-worksheet-service');
const {manifestHash}=require('./master-source-domain');
const key=v=>String(v||'').toLowerCase();
const near=(a,b)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<0.000001;
const totals=worksheet=>({scheduledTeachingDoe:worksheet.totals.scheduledTeachingDoe,roleDoe:worksheet.totals.roleDoe,rawSupervisionDoe:worksheet.totals.rawSupervisionDoe,appliedSupervisionDoe:worksheet.totals.appliedSupervisionDoe,adjustmentDoe:worksheet.totals.adjustmentDoe,assignedTeachingDoe:worksheet.totals.assignedTeachingDoe,effectiveTargetDoe:worksheet.totals.effectiveTargetDoe,remainingDoe:worksheet.totals.remainingDoe});
async function guardFacultyAggregates({rows,worksheetSources=[],academicYear,domain}){
 const impacts=[];
 for(const id of [...new Set(rows.filter(r=>r.facultyId&&r.status==='matched').map(r=>key(r.facultyId)))]){
  const affected=rows.filter(r=>key(r.facultyId)===id&&r.status==='matched'&&r.isNew&&(domain==='trainees'?r.roleType==='Trainee Supervision':domain==='appointments'?r.roleType!=='Trainee Supervision':true));
  const matches=worksheetSources.filter(s=>key(s.facultyId)===id&&s.academicYear===academicYear),source=matches.length===1?matches[0]:null;
  if(!affected.length){if(!source)continue;}
  const proposed=source?structuredClone(source):null;
  if(proposed)for(const row of affected){
   if(row.roleType==='Trainee Supervision'){
    const normalized=proposed.lines.filter(l=>['supervision','trainee_supervision'].includes(String(l.category).toLowerCase())&&l.sourceEntityType!=='supervision_source_snapshot');
    if(!normalized.length){proposed.lines=proposed.lines.filter(l=>!['supervision','trainee_supervision'].includes(String(l.category).toLowerCase()));proposed.lines.push({lineId:'master-supervision',sourceEntityId:'master-supervision',sourceEntityType:'supervision_source_snapshot',category:'supervision',resultDoe:row.sourceDoe,status:'source_snapshot'});proposed.supervisionDataAvailable=true;}
   }else proposed.lines.push({lineId:'master-'+manifestHash({roleType:row.roleType,scope:row.scope}),sourceEntityType:'legacy_role_assignment',roleType:row.roleType,category:'role',scopeText:row.scope,resultDoe:row.sourceDoe,status:'recorded'});
  }
  const materialize=async data=>data?createWorksheetService({repository:{getFacultyWorksheetSource:async()=>data}}).buildFacultyWorksheet({facultyId:data.facultyId,academicYear}):null;
  const before=await materialize(source),after=await materialize(proposed),expectedRoleDelta=affected.filter(r=>r.roleType!=='Trainee Supervision').reduce((n,r)=>n+r.sourceDoe,0);
  let status='metadata_only';
  if(affected.length){
   const complete=before?.completeness.valuesComplete&&after?.completeness.valuesComplete;
   const unchangedSupervision=complete&&near(before.totals.rawSupervisionDoe,after.totals.rawSupervisionDoe)&&near(before.totals.appliedSupervisionDoe,after.totals.appliedSupervisionDoe);
   const normalizedMatches=affected.filter(r=>r.roleType==='Trainee Supervision').every(r=>near(r.sourceDoe,before?.totals.rawSupervisionDoe));
   status=!complete?'held_aggregate_unavailable':!unchangedSupervision||!normalizedMatches||!near(after.totals.assignedTeachingDoe-before.totals.assignedTeachingDoe,expectedRoleDelta)||!near(before.totals.remainingDoe-after.totals.remainingDoe,expectedRoleDelta)?'held_aggregate_change':'safe';
   for(const row of affected){row.aggregateStatus=status;if(status!=='safe')row.status=status;}
  }
  const evidence={facultyId:source?.facultyId||affected[0].facultyId,academicYear,status,before:before?totals(before):null,proposed:after?totals(after):null,expectedRoleDelta,sourceHash:source?manifestHash(source):null};
  impacts.push({...evidence,evidenceHash:manifestHash(evidence)});
 }
 return impacts;
}
module.exports={guardFacultyAggregates};
