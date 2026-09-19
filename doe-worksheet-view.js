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
 function worksheetHtml(worksheet={}){
  const summary=worksheetSummary(worksheet),status=statusView(worksheet),lines=Array.isArray(worksheet.lines)?worksheet.lines:[],reserve=worksheet.reserve||{};
  const card=(label,value,sub='')=>`<div class="summary-card"><div class="summary-card-label">${esc(label)}</div><div class="summary-card-value">${esc(value)}</div>${sub?`<div class="summary-card-sub">${esc(sub)}</div>`:''}</div>`;
  const rows=lines.map(row=>{
   const ref=referenceText(row.reference||{}),rule=text(row.ruleKey||row.ruleId),calc=text(row.calculationText)||'Calculation detail unavailable';
   return`<tr><td><strong>${esc(row.label||row.lineId||'DOE line')}</strong><div class="muted">${esc(row.category||'')}</div></td><td>${esc(calc)}</td><td>${rule?`<strong>${esc(rule)}</strong>`:'—'}<div class="muted">${esc(row.policyVersionId||summary.policyVersionId||'—')}</div></td><td>${esc(ref||'Reference unavailable')}</td><td class="num"><strong>${esc(lineResult(row))}</strong><div class="muted">${esc(row.calculationId||'No calculation evidence')}</div></td></tr>`;
  }).join('')||'<tr><td colspan="5" class="empty">No DOE assignment lines are available for this Academic Year.</td></tr>';
  const errorNote=status.key==='needs_review'||status.key==='error'||status.key==='unavailable'?`<div class="no-source"><strong>${esc(status.label)}.</strong> ${esc((worksheet.errors||[]).map(error=>error.message||error.code).filter(Boolean).join(' · ')||'Required DOE data or provenance is incomplete.')}</div>`:'';
  return`<section class="section wide doe-worksheet"><div class="section-title">${esc(summary.academicYear||'Annual')} Teaching DOE · server worksheet</div><div class="summary-grid">${card('Assigned Teaching DOE',percent(summary.assignedDoe),status.label)}${card('Scheduled Teaching',percent(summary.scheduledDoe))}${card('Roles',percent(summary.roleDoe))}${card('Applied Supervision',percent(summary.appliedSupervisionDoe),number(summary.rawSupervisionDoe)!==null?`Raw ${percent(summary.rawSupervisionDoe)}`:'')}${card('Effective Target',percent(summary.targetDoe))}${card('Remaining / Over',summary.remainingDoe===null?'Unavailable':status.label)}${card('Policy Version',summary.policyVersionId||'Unavailable',summary.lastCalculatedAt?`Last calculated ${summary.lastCalculatedAt}`:'')}${card('Reserve',number(reserve.initialTraineeReserve)===null?'Unavailable':percent(reserve.initialTraineeReserve),number(reserve.unappliedSupervision)>0?`${percent(reserve.unappliedSupervision)} supervisory load not applied`:'' )}</div>${errorNote}<div class="assignment-wrap"><table class="activity-table doe-worksheet-table"><thead><tr><th>Assignment</th><th>Calculation</th><th>Rule / Policy</th><th>Reference</th><th class="num">DOE / Evidence</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
 }
 return Object.freeze({worksheetSummary,statusView,percent,referenceText,renderLookupDoe,renderDoeListRow,worksheetHtml});
});
