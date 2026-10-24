'use strict';
const {validateMasterPreview}=require('../../server/src/master-refresh/master-refresh-service');
const {academicBounds,isoDate,manifestHash}=require('../../server/src/master-refresh/master-source-domain');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid=()=>Object.assign(Error('Complete typed MASTER CCC source required.'),{code:'INVALID_CCC_MASTER_SOURCE'});
function toTrustedCccRows(source){
 validateMasterPreview({domain:'appointments',academicYear:source?.academicYear,source,actorFirebaseUid:'trusted-read-only-ccc-plan'});
 const bounds=academicBounds(source.academicYear),seen=new Set();
 if(source.cccSlots.length<1||source.cccSlots.length>5000)throw invalid();
 const rows=source.cccSlots.map((slot,index)=>{
  const ref=slot.sourceRef;
  if(!ref||ref.sha256?.toUpperCase()!==source.sourceSha256.toUpperCase()||ref.sheet!=='CCC'||!Number.isInteger(ref.row)||ref.row<2||!['C','D','E'].includes(ref.column)||slot.slotKey!==`CCC!${ref.column}${ref.row}`||seen.has(slot.slotKey))throw invalid();
  seen.add(slot.slotKey);
  if(!isoDate(slot.startDate)||!isoDate(slot.endDate)||slot.startDate>slot.endDate||slot.startDate<bounds.startDate||slot.endDate>bounds.endDate)throw invalid();
  const unassigned=slot.staffingKind==='unassigned';
  if(unassigned?(slot.facultyId!==null||slot.staffingLabel!=='Locum'||slot.sourceName!=='Locum'):(slot.staffingKind!=='assigned'||!uuid.test(slot.facultyId||'')||slot.identityStatus!=='resolved'||slot.staffingLabel!==null))throw invalid();
  if(slot.blockLabel!==null&&slot.blockLabel!==undefined&&(typeof slot.blockLabel!=='string'||slot.blockLabel.length>1000))throw invalid();
  return{sourceRow:index+2,facultySourceId:unassigned?null:slot.facultyId,facultySourceName:null,startDate:slot.startDate,endDate:slot.endDate,courseCode:null,label:'CCC',staffingKind:slot.staffingKind,staffingLabel:unassigned?'Locum':null,blockLabel:slot.blockLabel??null,slotKey:slot.slotKey,sourceRef:{...ref},sourceEvidence:{sourceName:slot.sourceName,privateNotes:slot.privateNotes??null,closureText:slot.closureText??null},issues:[]};
 });
 const unassigned=rows.filter(r=>r.staffingKind==='unassigned').length;
 const payload={schemaVersion:2,academicYear:source.academicYear,sourceSha256:source.sourceSha256,sourceManifestSha256:source.manifestSha256,slotCounts:{total:rows.length,assigned:rows.length-unassigned,unassigned},rows};
 return{...payload,manifestSha256:manifestHash(payload)};
}
module.exports={toTrustedCccRows};
