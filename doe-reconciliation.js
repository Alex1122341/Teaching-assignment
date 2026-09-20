(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_RECONCILIATION=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';

 const text=value=>String(value??'').trim();
 const number=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null};
 const round=value=>Math.round(Number(value)*10000)/10000;
 const unique=values=>[...new Set((values||[]).map(text).filter(Boolean))];

 function summaryOf(faculty={}){
  const value=faculty?.facultySummary2026_27;
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 }
 function meaningfulManagedRoles(faculty={}){
  return(Array.isArray(faculty?.managedRoles2026_27)?faculty.managedRoles2026_27:[]).filter(row=>{
   if(!row||typeof row!=='object')return false;
   return Boolean(text(row.type||row.roleType)||text(row.assignment||row.courseCode||row.subjectKey)||number(row.doeCredit)!==null);
  });
 }
 function sourceRoles(faculty={}){
  const roles=summaryOf(faculty).roles;
  return Array.isArray(roles)?roles.filter(Boolean):[];
 }
 function legacyAssignedDoe(faculty={}){
  const summary=summaryOf(faculty),direct=number(summary.assignedTeachingDOE);
  if(direct!==null)return direct;
  const scheduled=number(summary.sourceScheduledTeachingDOE),nonTimetable=number(summary.sourceNonTimetableTeachingDOE);
  if(scheduled!==null||nonTimetable!==null)return round((scheduled||0)+(nonTimetable||0));
  const derived=number(faculty.assignedTeachingDOE??faculty.doeAssignedTeachingDOE);
  return derived;
 }
 function hasLegacyEvidence(faculty={}){
  const summary=summaryOf(faculty);
  return legacyAssignedDoe(faculty)!==null||
   meaningfulManagedRoles(faculty).length>0||
   sourceRoles(faculty).length>0||
   Boolean(faculty?.workloadPolicy2026_27&&typeof faculty.workloadPolicy2026_27==='object')||
   Boolean(text(faculty.facultySummarySource2026_27||summary.sourceName));
 }
 function serverFactCount(server={}){
  const direct=number(server.serverFactCount);
  if(direct!==null)return direct;
  return['teachingLineCount','roleAssignmentCount','supervisionLineCount','adjustmentLineCount']
   .reduce((sum,key)=>sum+(number(server[key])||0),0);
 }
 function issueCodes(server={}){
  const codes=[...(Array.isArray(server.issueCodes)?server.issueCodes:[])];
  if(text(server.status).toLowerCase()==='error'&&!codes.length)codes.push('DOE_CALCULATION_ERROR');
  if(text(server.status).toLowerCase()==='needs_review'&&!codes.length)codes.push('DOE_NEEDS_REVIEW');
  return unique(codes);
 }
 function isMappingCode(code){return /(?:^|_)MAPPING_(?:REQUIRED|AMBIGUOUS)$/.test(text(code).toUpperCase())}
 function statusLabel(status){
  return({
   matched:'Matched',
   different_doe:'DOE Difference',
   legacy_only:'Legacy Only',
   server_only:'Server Only',
   missing_mapping:'Missing Mapping',
   needs_review:'Needs Review'
  })[text(status)]||'Needs Review';
 }
 function reconcileFaculty(faculty={},server=null,{tolerance=.25}={}){
  const facultyId=text(faculty?.__id||faculty?.facultyId||server?.facultyId),displayName=text(faculty?.preferredFullName||faculty?.hrFullName||server?.displayName||facultyId);
  const legacyDoe=legacyAssignedDoe(faculty),legacyEvidence=hasLegacyEvidence(faculty),serverExists=Boolean(server&&typeof server==='object');
  const worksheetDoe=serverExists?number(server.assignedTeachingDoe):null;
  const difference=legacyDoe!==null&&worksheetDoe!==null?round(worksheetDoe-legacyDoe):null;
  const codes=serverExists?issueCodes(server):[];
  const mappingCount=serverExists?(number(server.missingMappingCount)||codes.filter(isMappingCode).length):0;
  const needsReview=serverExists&&(
   ['needs_review','error','unavailable'].includes(text(server.status).toLowerCase())||
   (number(server.issueCount)||0)>0||
   (number(server.unratedLineCount)||0)>0||
   codes.length>0||
   worksheetDoe===null
  );
  const flags=[];
  let status='matched';
  if(mappingCount>0||codes.some(isMappingCode)){status='missing_mapping';flags.push('missing_mapping','needs_review')}
  else if(needsReview){status='needs_review';flags.push('needs_review')}
  else if(!serverExists&&legacyEvidence){status='legacy_only';flags.push('legacy_only')}
  else if(serverExists&&!legacyEvidence){status='server_only';flags.push('server_only')}
  else if(!serverExists&&!legacyEvidence){status='needs_review';flags.push('needs_review','no_evidence')}
  else if(difference!==null&&Math.abs(difference)>Math.abs(Number(tolerance)||0)){status='different_doe';flags.push('different_doe')}
  const sourceRoleCount=sourceRoles(faculty).length,legacyManagedRoleCount=meaningfulManagedRoles(faculty).length,serverRoleCount=serverExists?(number(server.roleAssignmentCount)||0):0;
  if(serverExists&&legacyManagedRoleCount!==serverRoleCount)flags.push('role_count_mismatch');
  return{
   facultyId,displayName,status,statusLabel:statusLabel(status),flags:unique(flags),
   legacyAssignedDoe:legacyDoe,worksheetAssignedDoe:worksheetDoe,differenceDoe:difference,
   sourceRoleCount,legacyManagedRoleCount,serverRoleCount,serverFactCount:serverExists?serverFactCount(server):0,
   issueCount:serverExists?(number(server.issueCount)||codes.length):0,issueCodes:codes,missingMappingCount:mappingCount,
   policyVersionId:serverExists?text(server.policyVersionId):'',calculationStatus:serverExists?text(server.status||server.calculationStatus):'not_found',
   lastCalculatedAt:serverExists?text(server.lastCalculatedAt):'',legacyEvidence,serverExists,
   faculty,server
  };
 }
 function buildReconciliationRows(facultyRows=[],serverRows=[],options={}){
  const facultyById=new Map((Array.isArray(facultyRows)?facultyRows:[]).map(row=>[text(row?.__id||row?.facultyId),row]).filter(([id])=>id));
  const serverById=new Map((Array.isArray(serverRows)?serverRows:[]).map(row=>[text(row?.facultyId),row]).filter(([id])=>id));
  const ids=[...new Set([...facultyById.keys(),...serverById.keys()])];
  return ids.map(id=>reconcileFaculty(facultyById.get(id)||{__id:id},serverById.get(id)||null,options))
   .sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.facultyId.localeCompare(b.facultyId));
 }
 const priority={missing_mapping:0,needs_review:1,legacy_only:2,different_doe:3,server_only:4,matched:9};
 function workQueue(rows=[]){
  return(Array.isArray(rows)?rows:[]).filter(row=>row&&row.status!=='matched')
   .sort((a,b)=>(priority[a.status]??8)-(priority[b.status]??8)||a.displayName.localeCompare(b.displayName)||a.facultyId.localeCompare(b.facultyId));
 }
 function summarize(rows=[]){
  const list=Array.isArray(rows)?rows:[];
  const counts={total:list.length,matched:0,different_doe:0,legacy_only:0,server_only:0,missing_mapping:0,needs_review:0,actionable:0};
  for(const row of list){if(Object.hasOwn(counts,row.status))counts[row.status]++;if(row.status!=='matched')counts.actionable++}
  return counts;
 }

 return Object.freeze({
  legacyAssignedDoe,meaningfulManagedRoles,sourceRoles,hasLegacyEvidence,serverFactCount,issueCodes,
  reconcileFaculty,buildReconciliationRows,workQueue,summarize,statusLabel
 });
});
