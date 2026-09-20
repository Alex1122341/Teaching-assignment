(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_POLICY_ADMIN=api;
})(typeof window!=='undefined'?window:null,function(root){
 'use strict';

 const text=value=>String(value??'').trim();
 const number=value=>{
  if(value===null||value===undefined||value==='')return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
 };
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

 function normalizedRole(profile){
  const value=text(profile?.role||profile).toLowerCase();
  if(value==='owner')return'adfa_general';
  if(['administrator','admin'].includes(value))return'adfa_regular';
  return value;
 }

 function capabilities(profile){
  const role=normalizedRole(profile);
  const editDraft=['adfa_regular','adfa_general'].includes(role);
  const general=role==='adfa_general';
  return{
   initialize:editDraft,
   editDraft,
   validate:editDraft,
   preview:editDraft,
   publish:general,
   archive:general,
   recalculate:general
  };
 }

 function normalizeSelector(row={}){
  const valueNumber=number(row.valueNumber);
  const rawValues=Array.isArray(row.values)?row.values.map(value=>typeof value==='number'?value:text(value)).filter(value=>value!==''||typeof value==='number'):null;
  return{
   ...(text(row.selectorId)?{selectorId:text(row.selectorId)}:{}),
   field:text(row.field),
   operator:text(row.operator)||'equals',
   ...(rawValues?{values:rawValues}:valueNumber!==null?{valueNumber}:{valueText:text(row.valueText)})
  };
 }

 function normalizeInput(row={}){
  return{
   ...(text(row.ruleInputId)?{ruleInputId:text(row.ruleInputId)}:{}),
   inputName:text(row.inputName),
   inputType:text(row.inputType)||'number',
   required:row.required!==false,
   source:text(row.source),
   unit:text(row.unit)
  };
 }

 function normalizeParameter(row={}){
  const valueNumber=number(row.valueNumber);
  return{
   ...(text(row.parameterId)?{parameterId:text(row.parameterId)}:{}),
   name:text(row.name),
   ...(valueNumber!==null?{valueNumber}:{valueText:text(row.valueText)}),
   unit:text(row.unit),
   required:row.required!==false
  };
 }

 function normalizeTier(row={}){
  return{
   ...(text(row.tierId)?{tierId:text(row.tierId)}:{}),
   tierOrder:number(row.tierOrder)??0,
   fromValue:number(row.fromValue)??0,
   toValue:number(row.toValue),
   rate:number(row.rate),
   fixedCredit:number(row.fixedCredit)
  };
 }

 function normalizeRuleDraft(raw={}){
  return{
   ruleId:text(raw.ruleId),
   policyVersionId:text(raw.policyVersionId),
   ruleKey:text(raw.ruleKey),
   name:text(raw.name),
   category:text(raw.category)||'teaching',
   calculationMode:text(raw.calculationMode)||'fixed',
   resultKind:text(raw.resultKind)||'credit',
   priority:number(raw.priority)??0,
   enabled:raw.enabled!==false,
   referenceId:text(raw.referenceId),
   guidelineReference:text(raw.guidelineReference),
   sourceType:text(raw.sourceType),
   adminNote:text(raw.adminNote),
   mappingRequirement:text(raw.mappingRequirement),
   reviewStatus:text(raw.reviewStatus)||'needs_review',
   formulaText:text(raw.formulaText),
   selectors:(Array.isArray(raw.selectors)?raw.selectors:[]).map(normalizeSelector).filter(row=>row.field),
   inputs:(Array.isArray(raw.inputs)?raw.inputs:[]).map(normalizeInput).filter(row=>row.inputName),
   parameters:(Array.isArray(raw.parameters)?raw.parameters:[]).map(normalizeParameter).filter(row=>row.name),
   tiers:(Array.isArray(raw.tiers)?raw.tiers:[]).map(normalizeTier)
  };
 }

 function validateExceptionDraft(raw={}){
  const errors=[];
  const scopeType=text(raw.scopeType);
  const scopeKey=text(raw.scopeKey);
  if(scopeType&&scopeType!=='global'&&!scopeKey)errors.push({code:'EXCEPTION_SCOPE_REQUIRED',message:'A scoped exception requires a scope value.'});
  if(number(raw.fixedDoe)===null)errors.push({code:'EXCEPTION_DOE_REQUIRED',message:'Fixed DOE is required.'});
  if(!text(raw.reason))errors.push({code:'EXCEPTION_REASON_REQUIRED',message:'Exception reason is required.'});
  if(!text(raw.sourceReference))errors.push({code:'EXCEPTION_SOURCE_REQUIRED',message:'Source reference is required.'});
  if(!text(raw.policyVersionId))errors.push({code:'EXCEPTION_POLICY_REQUIRED',message:'Policy Version is required.'});
  return errors;
 }

 function recalculationConfirmationText(version={},preview={}){
  return `Recalculate DOE for Academic Year ${text(version.academicYear)||'—'} using Active policy ${text(version.policyVersionId)||'—'}? This will update ${Number(preview.assignmentsAffected||0)} DOE source row(s); ${Number(preview.changedDoeCount||0)} currently differ from the Active policy. Calculation evidence will be preserved and derived indexes refreshed.`;
 }

 const pct=value=>number(value)===null?'—':`${Number(value).toFixed(2)}%`;
 const signedPct=value=>{const parsed=number(value);if(parsed===null)return'—';return`${parsed>0?'+':''}${parsed.toFixed(2)}%`};

 function impactPreviewHtml(result={}){
  const status=text(result.status||'not run').toUpperCase(),rawRows=Array.isArray(result.rows)?result.rows:[];
  const mappingError=issue=>/(?:^|_)MAPPING_(?:REQUIRED|AMBIGUOUS)$/.test(text(issue?.code).toUpperCase());
  const rowStatus=row=>{
   if(text(row.impactStatus))return text(row.impactStatus);
   const rowErrors=Array.isArray(row.errors)?row.errors:[],current=number(row.currentDoe),draft=number(row.draftDoe),difference=number(row.difference);
   if(rowErrors.some(mappingError))return'missing_mapping';
   if(rowErrors.length||draft===null)return'needs_review';
   if(current===null)return'resolved_current_gap';
   if(difference!==null&&difference>1e-9)return'increase';
   if(difference!==null&&difference<-1e-9)return'decrease';
   return'unchanged';
  };
  const statusLabel=value=>({
   missing_mapping:'Missing Mapping',
   needs_review:'Draft Needs Review',
   resolved_current_gap:'Resolved Current Gap',
   increase:'Increase',
   decrease:'Decrease',
   unchanged:'Unchanged'
  })[text(value)]||'Draft Needs Review';
  const rows=rawRows.map(row=>{
   const impactStatus=rowStatus(row),issues=[...(row.warnings||[]),...(row.errors||[])];
   const missingMappingCount=row.missingMappingCount!==undefined?Number(row.missingMappingCount||0):issues.filter(mappingError).length;
   return{...row,impactStatus,missingMappingCount,issues};
  });
  const count=(key,fallback)=>result[key]!==undefined&&result[key]!==null&&result[key]!==''?Number(result[key]||0):fallback;
  const byStatus=value=>rows.filter(row=>row.impactStatus===value).length;
  const positive=rows.map(row=>number(row.difference)).filter(value=>value!==null&&value>0),negative=rows.map(row=>number(row.difference)).filter(value=>value!==null&&value<0);
  const largestIncrease=result.largestIncreaseDoe!==undefined&&result.largestIncreaseDoe!==null?number(result.largestIncreaseDoe):(positive.length?Math.max(...positive):null);
  const largestDecrease=result.largestDecreaseDoe!==undefined&&result.largestDecreaseDoe!==null?number(result.largestDecreaseDoe):(negative.length?Math.min(...negative):null);
  const affectedFallback=rows.filter(row=>row.impactStatus!=='unchanged').length;
  const affectedCalculationsFallback=rows.filter(row=>row.impactStatus!=='unchanged').reduce((sum,row)=>sum+Number(row.calculationCount||0),0);
  const metrics=[
   ['Faculty checked',Number(result.facultyCount||rows.length)],
   ['Calculations checked',Number(result.calculationCount||0)],
   ['Faculty changed',Number(result.changedFacultyCount||0)],
   ['Faculty affected',count('affectedFacultyCount',affectedFallback)],
   ['Calculations affected',count('affectedCalculationCount',affectedCalculationsFallback)],
   ['Increases',count('increaseCount',byStatus('increase'))],
   ['Decreases',count('decreaseCount',byStatus('decrease'))],
   ['Draft Needs Review',count('newNeedsReviewCount',rows.filter(row=>['needs_review','missing_mapping'].includes(row.impactStatus)).length)],
   ['Resolved current gaps',count('resolvedCurrentGapCount',byStatus('resolved_current_gap'))],
   ['Missing mapping',count('missingMappingCount',byStatus('missing_mapping'))],
   ['Largest increase',signedPct(largestIncrease)],
   ['Largest decrease',signedPct(largestDecrease)],
   ['Large increases',Number(result.largeIncreaseCount||0)],
   ['Large decreases',Number(result.largeDecreaseCount||0)],
   ['Errors',Number(result.errorCount||0)],
   ['Warnings',Number(result.warningCount||0)]
  ];
  const priority={missing_mapping:0,needs_review:1,resolved_current_gap:2,increase:3,decrease:3,unchanged:9};
  const sorted=rows.slice().sort((a,b)=>(priority[a.impactStatus]??8)-(priority[b.impactStatus]??8)||Math.abs(number(b.difference)||0)-Math.abs(number(a.difference)||0)||text(a.facultyId).localeCompare(text(b.facultyId)));
  const attention=sorted.filter(row=>['missing_mapping','needs_review','resolved_current_gap'].includes(row.impactStatus)||(row.warnings||[]).some(issue=>['LARGE_INCREASE','LARGE_DECREASE'].includes(text(issue.code))));
  const issueText=row=>row.issues.map(issue=>`${issue.code?issue.code+': ':''}${issue.message||''}`).join('; ')||({
   resolved_current_gap:'Current DOE was unavailable; the Draft now calculates a canonical value.',
   increase:'Draft DOE increases.',
   decrease:'Draft DOE decreases.'
  })[row.impactStatus]||'—';
  const statusPill=row=>`<span class="doe-impact-status" data-impact-status="${esc(row.impactStatus)}">${esc(statusLabel(row.impactStatus))}</span>`;
  const oldNew=row=>`${pct(row.currentDoe)} → ${pct(row.draftDoe)}`;
  const attentionRows=attention.map(row=>`<tr><td>${statusPill(row)}</td><td><strong>${esc(row.facultyId||'—')}</strong></td><td>${esc(oldNew(row))}</td><td>${esc(signedPct(row.difference))}</td><td>${esc(issueText(row))}</td></tr>`).join('');
  const allRows=sorted.map(row=>`<tr><td><strong>${esc(row.facultyId||'—')}</strong></td><td>${statusPill(row)}</td><td>${esc(oldNew(row))}</td><td>${esc(signedPct(row.difference))}</td><td>${esc((row.affectedRules||[]).join(', ')||'—')}</td><td>${esc(issueText(row))}</td></tr>`).join('');
  return `<div class="doe-preview-head"><div><strong>Impact Preview ${esc(status)}</strong><div class="doe-preview-meta">${esc(result.policyVersionId||'')} · revision ${esc(result.policyRevision??'—')}</div></div></div>
   <div class="doe-preview-summary">${metrics.map(([label,value])=>`<div class="doe-preview-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
   <div class="doe-preview-section"><h3>Attention queue</h3><div class="table-wrap"><table class="data-table doe-preview-table"><thead><tr><th>Status</th><th>Faculty</th><th>Current → Draft</th><th>Difference</th><th>Why it needs attention</th></tr></thead><tbody>${attentionRows||'<tr><td colspan="5" class="empty">No Impact Preview rows require additional attention.</td></tr>'}</tbody></table></div></div>
   <div class="doe-preview-section"><h3>All faculty impact</h3><div class="table-wrap"><table class="data-table doe-preview-table"><thead><tr><th>Faculty</th><th>Impact</th><th>Current → Draft</th><th>Difference</th><th>Affected Rules</th><th>Warnings / Errors</th></tr></thead><tbody>
    ${allRows||'<tr><td colspan="6" class="empty">No DOE-bearing records were found in the preview dataset.</td></tr>'}
   </tbody></table></div></div>`;
 }
 const state={
  initialized:false,
  profile:null,
  user:null,
  toast:null,
  service:null,
  policies:[],
  versions:[],
  bundle:null,
  selectedSection:'teaching',
  editingRule:null,
  editingException:null,
  wired:false
 };

 const doc=()=>root?.document||null;
 const $=id=>doc()?.getElementById(id)||null;
 const say=(message,error=false)=>{
  if(typeof state.toast==='function')state.toast(message,error);
  else if(root?.console)(error?root.console.error:root.console.log)(message);
 };

 function actor(){
  return{
   uid:text(state.user?.uid),
   name:text(state.user?.name||state.profile?.name),
   email:text(state.user?.email||state.profile?.email),
   role:text(state.profile?.role)
  };
 }

 function selectedVersion(){
  const selectedId=$('doe-policy-version')?.value||'';
  if(state.bundle?.version?.policyVersionId===selectedId)return state.bundle.version;
  return state.versions.find(version=>version.policyVersionId===selectedId)||state.bundle?.version||null;
 }

 function isDraft(){return selectedVersion()?.status==='draft'}

 function setStatus(message,tone=''){
  const el=$('doe-policy-status');
  if(!el)return;
  el.textContent=message||'No policy selected';
  el.dataset.tone=tone;
 }
 function setRecalculateStatus(message,tone=''){
  const el=$('doe-recalculate-status');if(!el)return;el.textContent=message||'';el.dataset.tone=tone;
 }

 function applyPermissions(){
  const cap=capabilities(state.profile),version=selectedVersion(),draft=version?.status==='draft',revision=Number(version?.revision||0);
  const validationCurrent=draft&&version?.lastValidationPassed===true&&Number(version?.lastValidatedRevision)===revision&&!!text(version?.rulesChecksum);
  const previewCurrent=validationCurrent&&!!text(version?.lastImpactRunId)&&Number(version?.lastImpactRevision)===revision&&text(version?.lastImpactChecksum)===text(version?.rulesChecksum)&&!!text(version?.lastImpactDatasetChecksum);
  const map={
   'doe-new-year':cap.editDraft,
   'doe-clone-draft':cap.editDraft,
   'doe-validate':cap.validate&&draft,
   'doe-preview':cap.preview&&validationCurrent,
   'doe-publish':cap.publish&&previewCurrent,
   'doe-archive':cap.archive&&version?.status==='active',
   'doe-recalculate':cap.recalculate&&version?.status==='active',
   'doe-add-rule':cap.editDraft&&draft,
   'doe-add-exception':cap.editDraft&&draft
  };
  for(const [id,enabled] of Object.entries(map)){
   const element=$(id);
   if(!element)continue;
   element.disabled=!enabled;
   element.setAttribute('aria-disabled',String(!enabled));
  }
  const previewButton=$('doe-preview');
  if(previewButton&&draft&&!validationCurrent)previewButton.title='Validate the current Draft revision first';
  const publishButton=$('doe-publish');
  if(publishButton&&cap.publish&&draft&&!previewCurrent)publishButton.title='A current passing Impact Preview is required';
  for(const id of ['doe-publish','doe-archive','doe-recalculate']){
   const element=$(id);
   if(element&&!cap.publish)element.title='ADFA General / Owner only';
  }
  if(!cap.recalculate)setRecalculateStatus('Administrative recalculation is ADFA General / Owner only.');
  else if(version?.status==='active')setRecalculateStatus('Run a dry-run preview before executing recalculation.');
  else setRecalculateStatus('Select the Active policy version to recalculate.');
 }

 function categoryForSection(section){
  return({teaching:'teaching',role:'role',supervision:'supervision',target:'target'}[section]||section);
 }

 function paramSummary(rule){
  const params=(rule.parameters||[]).map(parameter=>`${parameter.name}=${parameter.valueNumber??parameter.valueText??''}`);
  if(rule.calculationMode==='formula'&&rule.formulaText)return rule.formulaText;
  return params.join(', ')||'—';
 }

 function appliesSummary(rule){
  const selectors=rule.selectors||[];
  if(!selectors.length)return'All matching contexts';
  return selectors.map(selector=>`${selector.field} ${selector.operator} ${Array.isArray(selector.values)?selector.values.join(', '):(selector.valueNumber??selector.valueText??'')}`).join('; ');
 }

 function renderRuleRows(){
  const body=$('doe-rules-body');
  if(!body)return;
  if(!state.bundle){body.innerHTML='<tr><td colspan="10">Select a policy version.</td></tr>';return}
  if(state.selectedSection==='exceptions'){body.innerHTML='';renderExceptions();return}
  const category=categoryForSection(state.selectedSection);
  const rows=(state.bundle.rules||[]).filter(rule=>text(rule.category)===category);
  const draft=state.bundle.version?.status==='draft',cap=capabilities(state.profile);
  body.innerHTML=rows.map(rule=>`<tr data-doe-rule-id="${esc(rule.ruleId)}">
   <td><code>${esc(rule.ruleKey||rule.ruleId)}</code></td>
   <td>${esc(rule.name||'—')}</td>
   <td>${esc(appliesSummary(rule))}</td>
   <td>${esc(rule.calculationMode||'—')}</td>
   <td>${esc(paramSummary(rule))}</td>
   <td>${esc((rule.parameters||[]).find(p=>p.name==='cap')?.valueNumber??'—')}</td>
   <td class="doe-formula-cell">${esc(rule.formulaText||'—')}</td>
   <td>${esc(rule.guidelineReference||rule.sourceType||'—')}</td>
   <td><span class="doe-review-pill" data-review="${esc(rule.reviewStatus||'needs_review')}">${rule.enabled===false?'Disabled':esc((rule.reviewStatus||'needs_review').replaceAll('_',' '))}</span><div class="muted">${esc(state.bundle.version?.status||'')}</div></td>
   <td><button type="button" class="btn btn-small doe-edit-rule" data-rule-id="${esc(rule.ruleId)}" ${!draft||!cap.editDraft?'disabled':''}>Edit</button></td>
  </tr>`).join('')||'<tr><td colspan="10" class="empty">No rules in this section.</td></tr>';
  body.querySelectorAll('.doe-edit-rule').forEach(button=>button.addEventListener('click',()=>openRuleEditor(button.dataset.ruleId)));
 }

 function renderExceptions(){
  const body=$('doe-exceptions-body');
  if(!body)return;
  const rows=state.bundle?.exceptions||[],draft=state.bundle?.version?.status==='draft',cap=capabilities(state.profile);
  body.innerHTML=rows.map(row=>`<tr>
   <td>${esc(row.facultyId||'All')}</td><td>${esc(row.scopeType||'global')}</td><td>${esc(row.scopeKey||'—')}</td>
   <td>${number(row.fixedDoe)===null?'—':Number(row.fixedDoe).toFixed(2)+'%'}</td><td>${esc(row.reason||'—')}</td><td>${esc(row.sourceReference||'—')}</td>
   <td><button type="button" class="btn btn-small doe-edit-exception" data-exception-id="${esc(row.exceptionId)}" ${!draft||!cap.editDraft?'disabled':''}>Edit</button></td>
  </tr>`).join('')||'<tr><td colspan="7" class="empty">No policy exceptions.</td></tr>';
  body.querySelectorAll('.doe-edit-exception').forEach(button=>button.addEventListener('click',()=>openExceptionEditor(button.dataset.exceptionId)));
 }

 function renderSection(){
  doc()?.querySelectorAll('[data-doe-section]').forEach(button=>button.classList.toggle('active',button.dataset.doeSection===state.selectedSection));
  const rulesWrap=$('doe-rules-table-wrap'),exceptionsWrap=$('doe-exceptions-wrap');
  if(rulesWrap)rulesWrap.classList.toggle('hidden',state.selectedSection==='exceptions');
  if(exceptionsWrap)exceptionsWrap.classList.toggle('hidden',state.selectedSection!=='exceptions');
  renderRuleRows();
  if(state.selectedSection==='exceptions')renderExceptions();
 }

 function renderBundle(){
  const version=state.bundle?.version;
  if(!version){setStatus('No policy selected');return}
  setStatus(`${version.academicYear} · v${version.versionNumber} · ${String(version.status||'').toUpperCase()} · revision ${version.revision??0}`,version.status);
  applyPermissions();
  renderSection();
  root?.UCVM_DOE_RULEBOOK_ADMIN?.renderBundle?.(state.bundle,{editable:capabilities(state.profile).editDraft&&version.status==='draft',reload:()=>loadBundle(version.policyVersionId)});
 }

 function previewMessage(message,kind=''){
  const target=$('doe-impact-preview');
  if(!target)return;
  target.innerHTML=`<div class="doe-preview-empty ${esc(kind)}">${esc(message)}</div>`;
 }

 function markPreviewOutdated(){
  previewMessage('Impact Preview OUTDATED — validate this Draft revision again, then run a new Impact Preview.','outdated');
 }

 async function renderStoredPreview(){
  const version=state.bundle?.version,target=$('doe-impact-preview');
  if(!version||!target)return;
  const runId=text(version.lastImpactRunId);
  if(!runId){
   if(version.status==='draft'&&version.lastValidationPassed===true&&Number(version.lastValidatedRevision)===Number(version.revision||0))previewMessage('Validation is current. Run Impact Preview before Publish.');
   else if(version.status==='draft'&&Number(version.revision||0)>0)previewMessage('Impact Preview OUTDATED — validate this Draft revision again, then run a new Impact Preview.','outdated');
   else if(version.status==='draft')previewMessage('Validate this Draft revision before running Impact Preview.');
   else previewMessage('No stored Impact Preview for this policy version.');
   return;
  }
  const preview=await state.service.getImpactPreview(runId);
  if(!preview){previewMessage('Stored Impact Preview evidence could not be loaded.','outdated');return}
  target.innerHTML=impactPreviewHtml(preview);
 }

 async function loadBundle(versionId){
  if(!versionId){state.bundle=null;renderBundle();return}
  setStatus('Loading DOE policy…');
  state.bundle=await state.service.loadPolicyBundle(versionId);
  const current=state.bundle?.version;
  if(current){
   const at=state.versions.findIndex(version=>version.policyVersionId===current.policyVersionId);
   if(at>=0)state.versions[at]={...state.versions[at],...current};
   else state.versions.push({...current});
  }
  renderBundle();
  await renderStoredPreview();
 }

 async function loadVersions(){
  const policy=state.policies.find(row=>row.academicYear===$('doe-policy-year')?.value);
  state.versions=policy?await state.service.listVersions(policy.policyId):[];
  const select=$('doe-policy-version');
  if(!select)return;
  const previous=select.value;
  select.innerHTML=state.versions.slice().sort((a,b)=>Number(b.versionNumber||0)-Number(a.versionNumber||0))
   .map(version=>`<option value="${esc(version.policyVersionId)}">v${esc(version.versionNumber)} · ${esc(version.status)}</option>`).join('');
  const preferred=state.versions.find(version=>version.policyVersionId===previous)
   ||state.versions.slice().sort((a,b)=>Number(b.versionNumber||0)-Number(a.versionNumber||0))[0];
  if(preferred)select.value=preferred.policyVersionId;
  await loadBundle(select.value);
 }

 async function load(){
  if(!state.initialized)return false;
  state.policies=await state.service.listPolicies();
  const year=$('doe-policy-year');
  if(!year)return false;
  const previous=year.value;
  const values=[...new Set(state.policies.map(policy=>text(policy.academicYear)).filter(Boolean))].sort().reverse();
  year.innerHTML=values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  if(values.includes(previous))year.value=previous;
  await loadVersions();
  return true;
 }

 function rowId(prefix,index,existing){
  return text(existing)||`${text(state.bundle?.version?.policyVersionId||'draft')}--${prefix}--${index+1}`;
 }

 function selectorRow(row={},index=0){
  return`<div class="doe-builder-row doe-selector-row" data-id="${esc(row.selectorId||'')}">
   <input class="input doe-selector-field" placeholder="Field" value="${esc(row.field||'')}">
   <select class="select doe-selector-operator">${['equals','not_equals','in','not_in','gt','gte','lt','lte'].map(op=>`<option value="${op}" ${row.operator===op?'selected':''}>${op}</option>`).join('')}</select>
   <input class="input doe-selector-value" placeholder="Value" value="${esc(row.valueNumber??row.valueText??(Array.isArray(row.values)?row.values.join(', '):''))}">
  </div>`;
 }
 function inputRow(row={}){
  return`<div class="doe-builder-row doe-input-row" data-id="${esc(row.ruleInputId||'')}">
   <input class="input doe-input-name" placeholder="Input name" value="${esc(row.inputName||'')}">
   <select class="select doe-input-type"><option value="number" ${row.inputType!=='text'?'selected':''}>number</option><option value="text" ${row.inputType==='text'?'selected':''}>text</option></select>
   <input class="input doe-input-source" placeholder="Source" value="${esc(row.source||'')}">
   <label class="doe-check"><input type="checkbox" class="doe-input-required" ${row.required===false?'':'checked'}> Required</label>
  </div>`;
 }
 function parameterRow(row={}){
  return`<div class="doe-builder-row doe-parameter-row" data-id="${esc(row.parameterId||'')}">
   <input class="input doe-parameter-name" placeholder="Parameter" value="${esc(row.name||'')}">
   <input class="input doe-parameter-value" type="number" step="any" placeholder="Numeric value" value="${esc(row.valueNumber??'')}">
   <input class="input doe-parameter-unit" placeholder="Unit" value="${esc(row.unit||'')}">
  </div>`;
 }
 function tierRow(row={},index=0){
  return`<div class="doe-builder-row doe-tier-row" data-id="${esc(row.tierId||'')}">
   <input class="input doe-tier-from" type="number" step="any" placeholder="From" value="${esc(row.fromValue??'')}">
   <input class="input doe-tier-to" type="number" step="any" placeholder="To" value="${esc(row.toValue??'')}">
   <input class="input doe-tier-rate" type="number" step="any" placeholder="Rate" value="${esc(row.rate??'')}">
   <input class="input doe-tier-fixed" type="number" step="any" placeholder="Fixed" value="${esc(row.fixedCredit??'')}">
   <input type="hidden" class="doe-tier-order" value="${esc(row.tierOrder??index+1)}">
  </div>`;
 }

 function openRuleEditor(ruleId=''){
  if(!state.bundle||state.bundle.version?.status!=='draft')return;
  const rule=(state.bundle.rules||[]).find(row=>row.ruleId===ruleId)||{
   ruleId:'',policyVersionId:state.bundle.version.policyVersionId,ruleKey:'',name:'',category:categoryForSection(state.selectedSection==='exceptions'?'teaching':state.selectedSection),
   calculationMode:'fixed',resultKind:state.selectedSection==='target'?'target':'credit',priority:100,enabled:true,
   selectors:[],inputs:[],parameters:[],tiers:[]
  };
  state.editingRule=rule;
  const modal=$('doe-rule-editor');
  if(!modal)return;
  $('doe-rule-editor-title').textContent=ruleId?'Edit DOE Rule':'Add DOE Rule';
  $('doe-rule-key').value=rule.ruleKey||'';
  $('doe-rule-name').value=rule.name||'';
  $('doe-rule-category').value=rule.category||'teaching';
  $('doe-rule-mode').value=rule.calculationMode||'fixed';
  $('doe-rule-result-kind').value=rule.resultKind||'credit';
  $('doe-rule-priority').value=rule.priority??100;
  $('doe-rule-reference-id').value=rule.referenceId||'';
  $('doe-rule-guideline').value=rule.guidelineReference||'';
  $('doe-rule-source-type').value=rule.sourceType||'';
  $('doe-rule-admin-note').value=rule.adminNote||'';
  $('doe-rule-mapping-requirement').value=rule.mappingRequirement||'';
  $('doe-rule-review-status').value=rule.reviewStatus||'needs_review';
  $('doe-rule-enabled').checked=rule.enabled!==false;
  $('doe-rule-advanced').checked=rule.calculationMode==='formula';
  $('doe-rule-formula').value=rule.formulaText||'';
  $('doe-rule-formula-wrap').classList.toggle('hidden',rule.calculationMode!=='formula');
  $('doe-selector-rows').innerHTML=(rule.selectors||[]).map(selectorRow).join('');
  $('doe-input-rows').innerHTML=(rule.inputs||[]).map(inputRow).join('');
  $('doe-parameter-rows').innerHTML=(rule.parameters||[]).map(parameterRow).join('');
  $('doe-tier-rows').innerHTML=(rule.tiers||[]).map(tierRow).join('');
  $('doe-test-output').textContent='';
  modal.classList.remove('hidden');
 }

 function closeRuleEditor(){
  $('doe-rule-editor')?.classList.add('hidden');
  state.editingRule=null;
 }

 function parseSelectorValue(value,operator){
  const raw=text(value);
  if(['in','not_in'].includes(operator))return{values:raw.split(',').map(item=>item.trim()).filter(Boolean)};
  const numeric=number(raw);
  return numeric!==null&&/^(?:gt|gte|lt|lte)$/.test(operator)?{valueNumber:numeric}:{valueText:raw};
 }

 function readRuleEditor(){
  const current=state.editingRule||{};
  const selectors=[...doc().querySelectorAll('#doe-selector-rows .doe-selector-row')].map((row,index)=>{
   const operator=row.querySelector('.doe-selector-operator').value;
   return{
    selectorId:rowId('selector',index,row.dataset.id),
    field:row.querySelector('.doe-selector-field').value,
    operator,
    ...parseSelectorValue(row.querySelector('.doe-selector-value').value,operator)
   };
  });
  const inputs=[...doc().querySelectorAll('#doe-input-rows .doe-input-row')].map((row,index)=>({
   ruleInputId:rowId('input',index,row.dataset.id),
   inputName:row.querySelector('.doe-input-name').value,
   inputType:row.querySelector('.doe-input-type').value,
   source:row.querySelector('.doe-input-source').value,
   required:row.querySelector('.doe-input-required').checked
  }));
  const parameters=[...doc().querySelectorAll('#doe-parameter-rows .doe-parameter-row')].map((row,index)=>({
   parameterId:rowId('parameter',index,row.dataset.id),
   name:row.querySelector('.doe-parameter-name').value,
   valueNumber:row.querySelector('.doe-parameter-value').value,
   unit:row.querySelector('.doe-parameter-unit').value,
   required:true
  }));
  const tiers=[...doc().querySelectorAll('#doe-tier-rows .doe-tier-row')].map((row,index)=>({
   tierId:rowId('tier',index,row.dataset.id),
   tierOrder:number(row.querySelector('.doe-tier-order').value)??index+1,
   fromValue:row.querySelector('.doe-tier-from').value,
   toValue:row.querySelector('.doe-tier-to').value,
   rate:row.querySelector('.doe-tier-rate').value,
   fixedCredit:row.querySelector('.doe-tier-fixed').value
  }));
  const advanced=$('doe-rule-advanced').checked;
  return normalizeRuleDraft({
   ...current,
   ruleId:text(current.ruleId)||`${state.bundle.version.policyVersionId}--rule--${text($('doe-rule-key').value).replace(/[^A-Za-z0-9._-]+/g,'-')||Date.now()}`,
   policyVersionId:state.bundle.version.policyVersionId,
   ruleKey:$('doe-rule-key').value,
   name:$('doe-rule-name').value,
   category:$('doe-rule-category').value,
   calculationMode:advanced?'formula':$('doe-rule-mode').value,
   resultKind:$('doe-rule-result-kind').value,
   priority:$('doe-rule-priority').value,
   referenceId:$('doe-rule-reference-id').value,
   guidelineReference:$('doe-rule-guideline').value,
   sourceType:$('doe-rule-source-type').value,
   adminNote:$('doe-rule-admin-note').value,
   mappingRequirement:$('doe-rule-mapping-requirement').value,
   reviewStatus:$('doe-rule-review-status').value,
   enabled:$('doe-rule-enabled').checked,
   formulaText:advanced?$('doe-rule-formula').value:'',
   selectors,inputs,parameters,tiers
  });
 }

 async function saveRule(){
  const cap=capabilities(state.profile);
  if(!cap.editDraft||!isDraft())return;
  const draft=readRuleEditor();
  const saved=await state.service.saveRule(draft.policyVersionId,draft);
  closeRuleEditor();
  state.bundle=saved?.version?saved:await state.service.loadPolicyBundle(draft.policyVersionId);
  renderBundle();
  await renderStoredPreview();
  markPreviewOutdated();
  say('DOE Draft rule saved. Impact Preview is now outdated.');
 }

 function sampleInputs(){
  const raw=text($('doe-test-inputs')?.value);
  if(!raw)return{};
  const parsed=JSON.parse(raw);
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('Test inputs must be a JSON object.');
  return parsed;
 }

 async function runRuleTest(){
  try{
   const versionId=text(state.bundle?.version?.policyVersionId);
   if(!versionId)throw new Error('Policy Version is required.');
   const result=await state.service.testRule(versionId,readRuleEditor(),sampleInputs());
   $('doe-test-output').textContent=`Result: ${Number(result.resultDoe).toFixed(2)}% DOE · Rule: ${result.ruleKey||result.ruleId} · Inputs: ${JSON.stringify(result.inputs||{})} · Parameters: ${JSON.stringify(result.parameters||{})}`;
  }catch(error){
   $('doe-test-output').textContent=`${error.code||'ERROR'}: ${error.message||error}`;
  }
 }

 function openExceptionEditor(exceptionId=''){
  if(!state.bundle||state.bundle.version?.status!=='draft')return;
  const row=(state.bundle.exceptions||[]).find(item=>item.exceptionId===exceptionId)||{
   exceptionId:'',policyVersionId:state.bundle.version.policyVersionId,facultyId:'',scopeType:'global',scopeKey:'',fixedDoe:'',reason:'',sourceReference:'',enabled:true
  };
  state.editingException=row;
  $('doe-exception-id').value=row.exceptionId||'';
  $('doe-exception-faculty').value=row.facultyId||'';
  $('doe-exception-scope-type').value=row.scopeType||'global';
  $('doe-exception-scope-key').value=row.scopeKey||'';
  $('doe-exception-fixed').value=row.fixedDoe??'';
  $('doe-exception-reason').value=row.reason||'';
  $('doe-exception-source').value=row.sourceReference||'';
  $('doe-exception-editor').classList.remove('hidden');
 }
 function closeExceptionEditor(){$('doe-exception-editor')?.classList.add('hidden');state.editingException=null}
 async function saveException(){
  const current=state.editingException||{},version=state.bundle?.version;
  const row={
   ...current,
   exceptionId:text(current.exceptionId)||`${version.policyVersionId}--exception--${Date.now()}`,
   policyVersionId:version.policyVersionId,
   facultyId:text($('doe-exception-faculty').value),
   scopeType:text($('doe-exception-scope-type').value)||'global',
   scopeKey:text($('doe-exception-scope-key').value),
   fixedDoe:number($('doe-exception-fixed').value),
   reason:text($('doe-exception-reason').value),
   sourceReference:text($('doe-exception-source').value),
   enabled:true
  };
  const errors=validateExceptionDraft(row);
  if(errors.length){say(errors.map(error=>error.message).join(' '),true);return}
  await state.service.saveException(version.policyVersionId,row);
  closeExceptionEditor();
  await loadBundle(version.policyVersionId);
  markPreviewOutdated();
  say('Policy Exception saved. Impact Preview is now outdated.');
 }

 async function createPolicyYear(){
  const academicYear=root?.prompt?.('Academic Year (YYYY-YY), for example 2027-28:');
  if(!academicYear)return;
  const result=await state.service.createPolicyYear({academicYear});
  await load();
  if($('doe-policy-year'))$('doe-policy-year').value=result.policy.academicYear;
  await loadVersions();
 }

 async function cloneDraft(){
  const version=selectedVersion();
  if(!version)return;
  const result=await state.service.cloneAsDraft(version.policyVersionId);
  await load();
  $('doe-policy-year').value=result.version.academicYear;
  await loadVersions();
  $('doe-policy-version').value=result.version.policyVersionId;
  await loadBundle(result.version.policyVersionId);
  say(`Created Draft v${result.version.versionNumber}.`);
 }

 async function validateDraft(){
  const version=selectedVersion();
  if(!version)return;
  const result=await state.service.validateDraft(version.policyVersionId);
  const message=result.valid?`Validation passed · ${result.warnings.length} warning(s).`:`Validation failed · ${result.errors.length} error(s).`;
  say(message,!result.valid);
  await loadBundle(version.policyVersionId);
  if(result.valid)previewMessage('Validation is current. Run Impact Preview before Publish.');
  else previewMessage(`Validation failed: ${result.errors.map(error=>error.message).join(' ')}`,'outdated');
 }

 async function preview(){
  const version=selectedVersion();if(!version)return;
  previewMessage('Running Impact Preview…');
  const result=await state.service.runImpactPreview(version.policyVersionId);
  $('doe-impact-preview').innerHTML=impactPreviewHtml(result);
  await loadBundle(version.policyVersionId);
  $('doe-impact-preview').innerHTML=impactPreviewHtml(result);
  say(result.status==='passed'?'Impact Preview passed.':'Impact Preview contains blocking errors.',result.status!=='passed');
 }

 async function publish(){
  const version=selectedVersion();if(!version)return;
  await state.service.publish(version.policyVersionId);say('DOE Policy published.');await load();
 }
 async function archive(){
  const version=selectedVersion();if(!version)return;
  await state.service.archive(version.policyVersionId);say('DOE Policy archived.');await load();
 }
 async function recalculate(){
  const version=selectedVersion(),cap=capabilities(state.profile);
  if(!version)return;
  if(!cap.recalculate){setRecalculateStatus('Administrative recalculation is ADFA General / Owner only.','error');say('Administrative DOE recalculation is ADFA General / Owner only.',true);return}
  if(version.status!=='active'){setRecalculateStatus('Select the Active policy version before recalculating.','error');return}
  if(typeof state.service.previewRecalculate!=='function'||typeof state.service.runRecalculate!=='function'){say('Recalculate workflow is unavailable.',true);return}
  setRecalculateStatus('Running recalculation dry run…');
  const dryRun=await state.service.previewRecalculate({academicYear:version.academicYear,policyVersionId:version.policyVersionId,scope:'all'});
  setRecalculateStatus(`Dry run: ${dryRun.assignmentsAffected} source row(s), ${dryRun.changedDoeCount} changed, ${dryRun.errors.length} error(s), ${dryRun.warnings.length} warning(s).`);
  if(dryRun.errors.length){say('Recalculation dry run contains blocking errors.',true);return}
  const confirmation=recalculationConfirmationText(version,dryRun);
  if(typeof root?.confirm==='function'&&!root.confirm(confirmation))return;
  const execute=async options=>state.service.runRecalculate({
   academicYear:version.academicYear,policyVersionId:version.policyVersionId,scope:'all',...(options||{}),
   onProgress:progress=>setRecalculateStatus(progress.status==='completed'?`Recalculation complete: ${progress.completedRows}/${progress.totalRows}.`:`Recalculating DOE: ${progress.completedRows}/${progress.totalRows}…`)
  });
  try{
   const result=await execute();
   setRecalculateStatus(`Recalculation complete: ${result.completedRows}/${result.totalRows}. Derived indexes refreshed.`,'success');
   say('DOE recalculation completed.');
  }catch(error){
   if(error?.partialCommit&&Number.isFinite(Number(error.resumeFrom))){
    setRecalculateStatus(`Recalculation stopped after ${error.completedRows} committed row(s). Resume is available with batch ${error.batchId}.`,'error');
    const resumeMessage=`DOE recalculation partially committed ${error.completedRows} row(s). Resume batch ${error.batchId} from row ${error.resumeFrom}?`;
    if(typeof root?.confirm==='function'&&root.confirm(resumeMessage)){
     const result=await execute({resumeFrom:error.resumeFrom,batchId:error.batchId});
     setRecalculateStatus(`Recalculation complete: ${result.completedRows}/${result.totalRows}. Derived indexes refreshed.`,'success');
     say('DOE recalculation resumed and completed.');return;
    }
   }
   throw error;
  }
 }

 function addRow(containerId,renderer){
  const container=$(containerId);if(!container)return;
  const wrapper=doc().createElement('div');
  wrapper.innerHTML=renderer({},container.children.length);
  const node=wrapper.firstElementChild;if(node)container.appendChild(node);
 }

 function wire(){
  if(state.wired||!doc())return;
  state.wired=true;
  $('doe-policy-year')?.addEventListener('change',()=>loadVersions().catch(error=>say(error.message||error,true)));
  $('doe-policy-version')?.addEventListener('change',event=>loadBundle(event.target.value).catch(error=>say(error.message||error,true)));
  doc().querySelectorAll('[data-doe-section]').forEach(button=>button.addEventListener('click',()=>{state.selectedSection=button.dataset.doeSection;renderSection()}));
  $('doe-new-year')?.addEventListener('click',()=>createPolicyYear().catch(error=>say(error.message||error,true)));
  $('doe-clone-draft')?.addEventListener('click',()=>cloneDraft().catch(error=>say(error.message||error,true)));
  $('doe-validate')?.addEventListener('click',()=>validateDraft().catch(error=>say(error.message||error,true)));
  $('doe-preview')?.addEventListener('click',()=>preview().catch(error=>say(error.message||error,true)));
  $('doe-publish')?.addEventListener('click',()=>publish().catch(error=>say(error.message||error,true)));
  $('doe-archive')?.addEventListener('click',()=>archive().catch(error=>say(error.message||error,true)));
  $('doe-recalculate')?.addEventListener('click',()=>recalculate().catch(error=>say(error.message||error,true)));
  $('doe-add-rule')?.addEventListener('click',()=>openRuleEditor());
  $('doe-add-exception')?.addEventListener('click',()=>openExceptionEditor());
  $('doe-rule-close')?.addEventListener('click',closeRuleEditor);
  $('doe-rule-cancel')?.addEventListener('click',closeRuleEditor);
  $('doe-rule-save')?.addEventListener('click',()=>saveRule().catch(error=>say(error.message||error,true)));
  $('doe-rule-test')?.addEventListener('click',()=>runRuleTest().catch(error=>say(error.message||error,true)));
  $('doe-rule-advanced')?.addEventListener('change',event=>$('doe-rule-formula-wrap')?.classList.toggle('hidden',!event.target.checked));
  $('doe-add-selector')?.addEventListener('click',()=>addRow('doe-selector-rows',selectorRow));
  $('doe-add-input')?.addEventListener('click',()=>addRow('doe-input-rows',inputRow));
  $('doe-add-parameter')?.addEventListener('click',()=>addRow('doe-parameter-rows',parameterRow));
  $('doe-add-tier')?.addEventListener('click',()=>addRow('doe-tier-rows',tierRow));
  $('doe-exception-close')?.addEventListener('click',closeExceptionEditor);
  $('doe-exception-cancel')?.addEventListener('click',closeExceptionEditor);
  $('doe-exception-save')?.addEventListener('click',()=>saveException().catch(error=>say(error.message||error,true)));
 }

 function init({profile,user,toast}={}){
  const cap=capabilities(profile);
  if(!cap.initialize)return false;
  const api=root?.UCVM_DOE_API;
  if(!api?.listPolicies||!api?.loadPolicyBundle||!api?.saveRule)return false;
  state.profile=profile;state.user=user;state.toast=toast;state.service=api;
  state.initialized=true;
  wire();
  applyPermissions();
  return true;
 }

 function destroy(){
  state.initialized=false;state.profile=null;state.user=null;state.service=null;state.bundle=null;state.policies=[];state.versions=[];
 }

 return{
  capabilities,
  normalizeRuleDraft,
  validateExceptionDraft,
  impactPreviewHtml,
  recalculationConfirmationText,
  init,
  destroy,
  load,
  openRuleEditor,
  openExceptionEditor
 };
});
