(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_WORKSHEET_VIEW=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const text=value=>String(value??'').trim();
 const number=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null};
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 function totalsOf(worksheet={}){return worksheet?.totals&&typeof worksheet.totals==='object'?worksheet.totals:worksheet||{}}
 function worksheetSummary(worksheet={}){
  const totals=totalsOf(worksheet);
  return{
   facultyId:text(worksheet.facultyId),displayName:text(worksheet.displayName),academicYear:text(worksheet.academicYear),
   scheduledDoe:number(totals.scheduledTeachingDoe),roleDoe:number(totals.roleDoe),rawSupervisionDoe:number(totals.rawSupervisionDoe),
   appliedSupervisionDoe:number(totals.appliedSupervisionDoe),adjustmentDoe:number(totals.adjustmentDoe),
   assignedDoe:number(totals.assignedTeachingDoe),targetDoe:number(totals.effectiveTargetDoe),remainingDoe:number(totals.remainingDoe),
   policyVersionId:text(worksheet.policyVersionId),calculationStatus:text(worksheet.status||worksheet.calculationStatus)||'unavailable',
   lastCalculatedAt:text(worksheet.lastCalculatedAt)
  };
 }
 function statusView(worksheet={}){
  const summary=worksheetSummary(worksheet),status=summary.calculationStatus.toLowerCase();
  if(status==='needs_review')return{key:'needs_review',label:'Needs Review'};
  if(status==='error')return{key:'error',label:'DOE unavailable'};
  if(summary.assignedDoe===null||summary.targetDoe===null||summary.remainingDoe===null)return{key:'unavailable',label:'DOE unavailable'};
  if(Math.abs(summary.remainingDoe)<=.25)return{key:'within',label:'Within target'};
  return summary.remainingDoe>0?{key:'remaining',label:`${Math.abs(summary.remainingDoe).toFixed(2)}% remaining`}:{key:'over',label:`${Math.abs(summary.remainingDoe).toFixed(2)}% over`};
 }
 function percent(value,{unavailable='Unavailable'}={}){const n=number(value);return n===null?unavailable:`${n.toFixed(2)}%`}
 function renderLookupDoe(worksheet={}){return{...worksheetSummary(worksheet),status:statusView(worksheet)}}
 function renderDoeListRow(worksheet={}){return{...worksheetSummary(worksheet),status:statusView(worksheet)}}
 function referenceText(reference={}){
  const parts=[];if(text(reference.title))parts.push(text(reference.title));if(text(reference.section))parts.push(`§${text(reference.section)}`);if(text(reference.table))parts.push(text(reference.table));if(text(reference.page))parts.push(`p.${text(reference.page)}`);return parts.join(' · ');
 }
 function lineResult(row={}){return number(row.resultDoe)===null?'Unavailable':percent(row.resultDoe)}
 function sessionAssignmentLine(worksheet={},sessionId='',assignmentId=''){
  const sid=text(sessionId),aid=text(assignmentId),lines=(Array.isArray(worksheet.lines)?worksheet.lines:[]).filter(row=>text(row.sourceEntityType)==='session_assignment'&&text(row.sourceEntityId)===sid);
  if(!lines.length)return null;
  if(aid){
   const exact=lines.find(row=>text(row.lineId)===`${sid}--${aid}`);
   if(exact)return exact;
   return null;
  }
  return lines.length===1?lines[0]:null;
 }
 function round(value){return Math.round(Number(value)*10000)/10000}
 function unique(values){return[...new Set((values||[]).map(text).filter(Boolean))]}
 function reconciliationSummaryOf(faculty={}){const value=faculty?.facultySummary2026_27;return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
 function meaningfulManagedRoles(faculty={}){
  return(Array.isArray(faculty?.managedRoles2026_27)?faculty.managedRoles2026_27:[]).filter(row=>row&&typeof row==='object'&&(text(row.type||row.roleType)||text(row.assignment||row.courseCode||row.subjectKey)||number(row.doeCredit)!==null));
 }
 function sourceRoles(faculty={}){const roles=reconciliationSummaryOf(faculty).roles;return Array.isArray(roles)?roles.filter(Boolean):[]}
 function legacyAssignedDoe(faculty={}){
  const summary=reconciliationSummaryOf(faculty),direct=number(summary.assignedTeachingDOE);if(direct!==null)return direct;
  const scheduled=number(summary.sourceScheduledTeachingDOE),nonTimetable=number(summary.sourceNonTimetableTeachingDOE);
  if(scheduled!==null||nonTimetable!==null)return round((scheduled||0)+(nonTimetable||0));
  return number(faculty.assignedTeachingDOE??faculty.doeAssignedTeachingDOE);
 }
 function hasLegacyEvidence(faculty={}){
  const summary=reconciliationSummaryOf(faculty);
  return legacyAssignedDoe(faculty)!==null||meaningfulManagedRoles(faculty).length>0||sourceRoles(faculty).length>0||Boolean(faculty?.workloadPolicy2026_27&&typeof faculty.workloadPolicy2026_27==='object')||Boolean(text(faculty.facultySummarySource2026_27||summary.sourceName));
 }
 function serverFactCount(server={}){
  const direct=number(server.serverFactCount);if(direct!==null)return direct;
  return['teachingLineCount','roleAssignmentCount','supervisionLineCount','adjustmentLineCount'].reduce((sum,key)=>sum+(number(server[key])||0),0);
 }
 function reconciliationIssueCodes(server={}){
  const codes=[...(Array.isArray(server.issueCodes)?server.issueCodes:[])],status=text(server.status).toLowerCase();
  if(status==='error'&&!codes.length)codes.push('DOE_CALCULATION_ERROR');
  if(status==='needs_review'&&!codes.length)codes.push('DOE_NEEDS_REVIEW');
  return unique(codes);
 }
 function isMappingCode(code){return/(?:^|_)MAPPING_(?:REQUIRED|AMBIGUOUS)$/.test(text(code).toUpperCase())}
 function reconciliationStatusLabel(status){return({matched:'Matched',different_doe:'DOE Difference',legacy_only:'Legacy Only',server_only:'Server Only',missing_mapping:'Missing Mapping',needs_review:'Needs Review'})[text(status)]||'Needs Review'}
 function reconcileFaculty(faculty={},server=null,{tolerance=.25}={}){
  const facultyId=text(faculty?.__id||faculty?.facultyId||server?.facultyId),displayName=text(faculty?.preferredFullName||faculty?.hrFullName||server?.displayName||facultyId);
  const legacyDoe=legacyAssignedDoe(faculty),legacyEvidence=hasLegacyEvidence(faculty),serverExists=Boolean(server&&typeof server==='object'),worksheetDoe=serverExists?number(server.assignedTeachingDoe):null;
  const difference=legacyDoe!==null&&worksheetDoe!==null?round(worksheetDoe-legacyDoe):null,codes=serverExists?reconciliationIssueCodes(server):[],mappingCount=serverExists?(number(server.missingMappingCount)||codes.filter(isMappingCode).length):0;
  const needsReview=serverExists&&(['needs_review','error','unavailable'].includes(text(server.status).toLowerCase())||(number(server.issueCount)||0)>0||(number(server.unratedLineCount)||0)>0||codes.length>0||worksheetDoe===null),flags=[];
  let status='matched';
  if(mappingCount>0||codes.some(isMappingCode)){status='missing_mapping';flags.push('missing_mapping','needs_review')}
  else if(needsReview){status='needs_review';flags.push('needs_review')}
  else if(!serverExists&&legacyEvidence){status='legacy_only';flags.push('legacy_only')}
  else if(serverExists&&!legacyEvidence){status='server_only';flags.push('server_only')}
  else if(!serverExists&&!legacyEvidence){status='needs_review';flags.push('needs_review','no_evidence')}
  else if(difference!==null&&Math.abs(difference)>Math.abs(Number(tolerance)||0)){status='different_doe';flags.push('different_doe')}
  const sourceRoleCount=sourceRoles(faculty).length,legacyManagedRoleCount=meaningfulManagedRoles(faculty).length,serverRoleCount=serverExists?(number(server.roleAssignmentCount)||0):0;
  if(serverExists&&legacyManagedRoleCount!==serverRoleCount)flags.push('role_count_mismatch');
  return{facultyId,displayName,status,statusLabel:reconciliationStatusLabel(status),flags:unique(flags),legacyAssignedDoe:legacyDoe,worksheetAssignedDoe:worksheetDoe,differenceDoe:difference,sourceRoleCount,legacyManagedRoleCount,serverRoleCount,serverFactCount:serverExists?serverFactCount(server):0,teachingLineCount:serverExists?(number(server.teachingLineCount)||0):0,supervisionLineCount:serverExists?(number(server.supervisionLineCount)||0):0,adjustmentLineCount:serverExists?(number(server.adjustmentLineCount)||0):0,unratedLineCount:serverExists?(number(server.unratedLineCount)||0):0,issueCount:serverExists?(number(server.issueCount)||codes.length):0,issueCodes:codes,missingMappingCount:mappingCount,policyVersionId:serverExists?text(server.policyVersionId):'',calculationStatus:serverExists?text(server.status||server.calculationStatus):'not_found',lastCalculatedAt:serverExists?text(server.lastCalculatedAt):'',legacyEvidence,serverExists,faculty,server};
 }
 function buildReconciliationRows(facultyRows=[],serverRows=[],options={}){
  const facultyById=new Map((Array.isArray(facultyRows)?facultyRows:[]).map(row=>[text(row?.__id||row?.facultyId),row]).filter(([id])=>id)),serverById=new Map((Array.isArray(serverRows)?serverRows:[]).map(row=>[text(row?.facultyId),row]).filter(([id])=>id));
  return[...new Set([...facultyById.keys(),...serverById.keys()])].map(id=>reconcileFaculty(facultyById.get(id)||{__id:id},serverById.get(id)||null,options)).sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.facultyId.localeCompare(b.facultyId));
 }
 const reconciliationPriority={missing_mapping:0,needs_review:1,legacy_only:2,different_doe:3,server_only:4,matched:9};
 function workQueue(rows=[]){return(Array.isArray(rows)?rows:[]).filter(row=>row&&row.status!=='matched').sort((a,b)=>(reconciliationPriority[a.status]??8)-(reconciliationPriority[b.status]??8)||a.displayName.localeCompare(b.displayName)||a.facultyId.localeCompare(b.facultyId))}
 function summarizeReconciliation(rows=[]){const list=Array.isArray(rows)?rows:[],counts={total:list.length,matched:0,different_doe:0,legacy_only:0,server_only:0,missing_mapping:0,needs_review:0,actionable:0};for(const row of list){if(Object.hasOwn(counts,row.status))counts[row.status]++;if(row.status!=='matched')counts.actionable++}return counts}
 function explainObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{}}
 function explainLabel(key){return text(key).replace(/_/g,' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/^./,ch=>ch.toUpperCase())}
 function explainValue(value){
  if(value===null||value===undefined||value==='')return'—';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(Array.isArray(value))return value.map(explainValue).join(', ');
  if(typeof value==='object')return Object.entries(value).map(([key,item])=>`${explainLabel(key)}: ${explainValue(item)}`).join(' · ');
  return String(value);
 }
 function explainLine(row={}){
  const detail=explainObject(row.explanation),rule=explainObject(detail.rule),facts=explainObject(detail.facts),inputs=explainObject(detail.inputs),parameters=explainObject(detail.parameters);
  return{
   lineId:text(row.lineId),title:text(row.label||row.lineId||'DOE line'),category:text(row.category),
   status:text(row.status||'unavailable'),errorCode:text(row.errorCode),resultDoe:number(row.resultDoe),resultText:lineResult(row),
   sourceEntityType:text(row.sourceEntityType),sourceEntityId:text(row.sourceEntityId),assignmentFactId:text(row.assignmentFactId),
   roleType:text(row.roleType),courseCode:text(row.courseCode),subjectKey:text(row.subjectKey),teachingRole:text(row.teachingRole),
   policyVersionId:text(row.policyVersionId),ruleId:text(row.ruleId),ruleKey:text(row.ruleKey),
   ruleName:text(rule.name||rule.label||rule.title),calculationMode:text(rule.calculationMode),ruleCategory:text(rule.category||row.category),
   formula:text(row.calculationText)||'Calculation detail unavailable',facts,inputs,parameters,
   referenceText:referenceText(row.reference||{}),reference:row.reference||null,
   calculationId:text(row.calculationId),calculatedAt:text(row.calculatedAt),trigger:text(detail.trigger),source:text(detail.source)
  };
 }
 function explainPairs(title,object){
  const entries=Object.entries(object||{});
  return`<section class="doe-explain-section"><h4>${esc(title)}</h4>${entries.length?`<dl class="doe-explain-pairs">${entries.map(([key,value])=>`<div><dt>${esc(explainLabel(key))}</dt><dd>${esc(explainValue(value))}</dd></div>`).join('')}</dl>`:'<div class="muted">No stored values for this calculation.</div>'}</section>`;
 }
 function explanationHtml(row={}){
  const x=explainLine(row),ruleRows={
   'Policy Version':x.policyVersionId||'Unavailable','Rule Key':x.ruleKey||'Unavailable','Rule ID':x.ruleId||'Unavailable',
   'Rule Name':x.ruleName||'Unavailable','Calculation Mode':x.calculationMode||'Unavailable','Category':x.ruleCategory||x.category||'Unavailable'
  },evidence={
   'Calculation ID':x.calculationId||'No calculation evidence','Calculated At':x.calculatedAt||'Unavailable',
   'Trigger':x.trigger||'Unavailable','Source':x.source||'Unavailable',
   'Source Entity': [x.sourceEntityType,x.sourceEntityId].filter(Boolean).join(' · ')||'Unavailable',
   'Assignment Fact ID':x.assignmentFactId||'—'
  };
  const issue=x.errorCode?`<div class="no-source"><strong>${esc(x.status||'Needs Review')}.</strong> ${esc(x.errorCode.replace(/_/g,' '))}</div>`:'';
  return`<div class="doe-explanation"><div class="doe-explain-hero"><div><div class="eyebrow">DOE explanation</div><h3>${esc(x.title)}</h3><div class="muted">${esc(x.category||'DOE line')}</div></div><div><strong>${esc(x.resultText)}</strong><div class="muted">${esc(x.status||'Unavailable')}</div></div></div>${issue}<section class="doe-explain-section"><h4>Calculation</h4><div class="doe-explain-formula">${esc(x.formula)}</div><div class="muted">Result: ${esc(x.resultText)}</div></section>${explainPairs('Source facts',x.facts)}${explainPairs('Inputs',x.inputs)}${explainPairs('Parameters',x.parameters)}${explainPairs('Rule & policy',ruleRows)}<section class="doe-explain-section"><h4>Reference</h4><div>${esc(x.referenceText||'Reference unavailable')}</div></section>${explainPairs('Calculation evidence',evidence)}</div>`;
 }
 function worksheetHtml(worksheet={}){
  const summary=worksheetSummary(worksheet),status=statusView(worksheet),lines=Array.isArray(worksheet.lines)?worksheet.lines:[],reserve=worksheet.reserve||{};
  const card=(label,value,sub='')=>`<div class="summary-card"><div class="summary-card-label">${esc(label)}</div><div class="summary-card-value">${esc(value)}</div>${sub?`<div class="summary-card-sub">${esc(sub)}</div>`:''}</div>`;
  const rows=lines.map(row=>{
   const ref=referenceText(row.reference||{}),rule=text(row.ruleKey||row.ruleId),calc=text(row.calculationText)||'Calculation detail unavailable';
   return`<tr><td><strong>${esc(row.label||row.lineId||'DOE line')}</strong><div class="muted">${esc(row.category||'')}</div></td><td>${esc(calc)}</td><td>${rule?`<strong>${esc(rule)}</strong>`:'—'}<div class="muted">${esc(row.policyVersionId||summary.policyVersionId||'—')}</div></td><td>${esc(ref||'Reference unavailable')}</td><td class="num"><button type="button" class="btn-link doe-explain-trigger" data-doe-explain-line="${esc(row.lineId)}"><strong>${esc(lineResult(row))}</strong></button><div class="muted">Explain DOE · ${esc(row.calculationId||'No calculation evidence')}</div></td></tr>`;
  }).join('')||'<tr><td colspan="5" class="empty">No DOE assignment lines are available for this Academic Year.</td></tr>';
  const errorNote=status.key==='needs_review'||status.key==='error'||status.key==='unavailable'?`<div class="no-source"><strong>${esc(status.label)}.</strong> ${esc((worksheet.errors||[]).map(error=>error.message||error.code).filter(Boolean).join(' · ')||'Required DOE data or provenance is incomplete.')}</div>`:'';
  return`<section class="section wide doe-worksheet"><div class="section-title">${esc(summary.academicYear||'Annual')} Teaching DOE · server worksheet</div><div class="summary-grid">${card('Assigned Teaching DOE',percent(summary.assignedDoe),status.label)}${card('Scheduled Teaching',percent(summary.scheduledDoe))}${card('Roles',percent(summary.roleDoe))}${card('Applied Supervision',percent(summary.appliedSupervisionDoe),number(summary.rawSupervisionDoe)!==null?`Raw ${percent(summary.rawSupervisionDoe)}`:'')}${card('Effective Target',percent(summary.targetDoe))}${card('Remaining / Over',summary.remainingDoe===null?'Unavailable':status.label)}${card('Policy Version',summary.policyVersionId||'Unavailable',summary.lastCalculatedAt?`Last calculated ${summary.lastCalculatedAt}`:'')}${card('Reserve',number(reserve.initialTraineeReserve)===null?'Unavailable':percent(reserve.initialTraineeReserve),number(reserve.unappliedSupervision)>0?`${percent(reserve.unappliedSupervision)} supervisory load not applied`:'' )}</div>${errorNote}<div class="assignment-wrap"><table class="activity-table doe-worksheet-table"><thead><tr><th>Assignment</th><th>Calculation</th><th>Rule / Policy</th><th>Reference</th><th class="num">DOE / Evidence</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
 }
 return Object.freeze({worksheetSummary,statusView,percent,referenceText,sessionAssignmentLine,renderLookupDoe,renderDoeListRow,legacyAssignedDoe,meaningfulManagedRoles,sourceRoles,hasLegacyEvidence,serverFactCount,reconciliationIssueCodes,reconcileFaculty,buildReconciliationRows,workQueue,summarizeReconciliation,reconciliationStatusLabel,explainLine,explanationHtml,worksheetHtml});
});
