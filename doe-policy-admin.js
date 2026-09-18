(function(root,factory){
 const engine=typeof module==='object'&&module.exports?require('./doe-policy-engine.js'):(root&&root.UCVM_DOE_POLICY_ENGINE);
 const api=factory(root,engine);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_POLICY_ADMIN=api;
})(typeof window!=='undefined'?window:null,function(root,DEFAULT_ENGINE){
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
   guidelineReference:text(raw.guidelineReference),
   sourceType:text(raw.sourceType),
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

 function testRule(rule,sample={},engine=DEFAULT_ENGINE){
  if(!engine)throw new Error('DOE Policy Engine is required.');
  const normalized=normalizeRuleDraft(rule);
  const validation=engine.validatePolicy({
   version:{policyVersionId:normalized.policyVersionId||'test-draft',academicYear:'test',status:'draft'},
   rules:[normalized],
   exceptions:[]
  });
  if(!validation.valid){
   const first=validation.errors[0];
   const error=new Error(first?.message||'DOE rule validation failed.');
   error.code=first?.code||'VALIDATION_FAILED';
   error.validation=validation;
   throw error;
  }
  return engine.calculate({
   version:{policyVersionId:normalized.policyVersionId||'test-draft',academicYear:'test',status:'draft'},
   rules:[normalized],
   exceptions:[]
  },sample);
 }

 function assignmentDoe(assignment={}){
  const direct=number(assignment.doeCredit);
  if(direct!==null)return direct;
  const rate=number(assignment.doeRate),hours=number(assignment.creditedHours);
  return rate!==null&&hours!==null?rate*hours:null;
 }

 function buildImpactDataset(data={},academicYear=''){
  const calculations=[];
  const sessions=Array.isArray(data?.sessions)?data.sessions:[];
  for(const session of sessions){
   const assignments=Array.isArray(session?.assignments)?session.assignments:[];
   assignments.forEach((assignment,index)=>{
    const facultyId=text(assignment?.ucid||assignment?.facultyId);
    if(!facultyId)return;
    const hours=number(assignment?.creditedHours);
    const role=text(assignment?.role);
    calculations.push({
     sourceEntityType:'session_assignment',
     sourceEntityId:`${text(session?.id)||'session'}--assignment--${index+1}`,
     sessionId:text(session?.id),
     assignmentId:text(assignment?.assignmentId)||`${text(session?.id)||'session'}--assignment--${index+1}`,
     facultyId,
     currentDoe:assignmentDoe(assignment),
     context:{
      category:'teaching',activityType:text(session?.type),teachingRole:role,role,
      hours,shifts:1,course:text(session?.course),date:text(session?.date),topic:text(session?.topic),
      semester:text(session?.semester),week:number(session?.week)
     }
    });
   });
  }
  const faculty=Array.isArray(data?.faculty)?data.faculty:[];
  for(const person of faculty){
   const facultyId=text(person?.__id||person?.ucid||person?.id);
   if(!facultyId)continue;
   const roles=Array.isArray(person?.managedRoles2026_27)?person.managedRoles2026_27:[];
   roles.forEach((managed,index)=>{
    const credit=Math.abs(number(managed?.doeCredit)??0);
    if(!credit&&!text(managed?.assignment)&&!text(managed?.type))return;
    const signed=text(managed?.action).toLowerCase()==='remove'?-credit:credit;
    calculations.push({
     sourceEntityType:'managed_role',sourceEntityId:`${facultyId}--managed-role--${index+1}`,facultyId,currentDoe:signed,
     context:{category:'role',roleType:text(managed?.type),assignment:text(managed?.assignment),action:text(managed?.action)||'add'}
    });
   });
  }
  return{academicYear:text(academicYear),calculations};
 }

 const pct=value=>number(value)===null?'—':`${Number(value).toFixed(2)}%`;
 const signedPct=value=>{const parsed=number(value);if(parsed===null)return'—';return`${parsed>0?'+':''}${parsed.toFixed(2)}%`};

 function impactPreviewHtml(result={}){
  const status=text(result.status||'not run').toUpperCase();
  const metrics=[
   ['Faculty checked',Number(result.facultyCount||0)],['Calculations checked',Number(result.calculationCount||0)],
   ['Faculty changed',Number(result.changedFacultyCount||0)],['Large increases',Number(result.largeIncreaseCount||0)],
   ['Large decreases',Number(result.largeDecreaseCount||0)],['Errors',Number(result.errorCount||0)],['Warnings',Number(result.warningCount||0)]
  ];
  const rows=Array.isArray(result.rows)?result.rows:[];
  return `<div class="doe-preview-head"><div><strong>Impact Preview ${esc(status)}</strong><div class="doe-preview-meta">${esc(result.policyVersionId||'')} · revision ${esc(result.policyRevision??'—')}</div></div></div>
   <div class="doe-preview-summary">${metrics.map(([label,value])=>`<div class="doe-preview-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
   <div class="table-wrap"><table class="data-table doe-preview-table"><thead><tr><th>Faculty</th><th>Current DOE</th><th>Draft DOE</th><th>Difference</th><th>Affected Rules</th><th>Warnings / Errors</th></tr></thead><tbody>
    ${rows.map(row=>{const issues=[...(row.warnings||[]),...(row.errors||[])].map(issue=>`${issue.code?issue.code+': ':''}${issue.message||''}`).join('; ');return`<tr><td>${esc(row.facultyId||'—')}</td><td>${esc(pct(row.currentDoe))}</td><td>${esc(pct(row.draftDoe))}</td><td>${esc(signedPct(row.difference))}</td><td>${esc((row.affectedRules||[]).join(', ')||'—')}</td><td>${esc(issues||'—')}</td></tr>`}).join('')||'<tr><td colspan="6" class="empty">No DOE-bearing records were found in the preview dataset.</td></tr>'}
   </tbody></table></div>`;
 }
 const state={
  initialized:false,
  db:null,
  profile:null,
  user:null,
  toast:null,
  repository:null,
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
  return state.versions.find(version=>version.policyVersionId===$('doe-policy-version')?.value)||state.bundle?.version||null;
 }

 function isDraft(){return selectedVersion()?.status==='draft'}

 function setStatus(message,tone=''){
  const el=$('doe-policy-status');
  if(!el)return;
  el.textContent=message||'No policy selected';
  el.dataset.tone=tone;
 }

 function applyPermissions(){
  const cap=capabilities(state.profile),draft=isDraft();
  const map={
   'doe-new-year':cap.editDraft,
   'doe-clone-draft':cap.editDraft,
   'doe-validate':cap.validate&&draft,
   'doe-preview':cap.preview&&draft,
   'doe-publish':cap.publish&&draft,
   'doe-archive':cap.archive&&selectedVersion()?.status==='active',
   'doe-recalculate':cap.recalculate&&selectedVersion()?.status==='active',
   'doe-add-rule':cap.editDraft&&draft,
   'doe-add-exception':cap.editDraft&&draft
  };
  for(const [id,enabled] of Object.entries(map)){
   const element=$(id);
   if(!element)continue;
   element.disabled=!enabled;
   element.setAttribute('aria-disabled',String(!enabled));
  }
  for(const id of ['doe-publish','doe-archive','doe-recalculate']){
   const element=$(id);
   if(element&&!cap.publish)element.title='ADFA General / Owner only';
  }
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
   <td><span class="doe-status-badge">${rule.enabled===false?'Disabled':esc(state.bundle.version?.status||'')}</span></td>
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
 }

 async function loadBundle(versionId){
  if(!versionId){state.bundle=null;renderBundle();return}
  setStatus('Loading DOE policy…');
  state.bundle=await state.service.loadPolicyBundle(versionId);
  renderBundle();
 }

 async function loadVersions(){
  const policy=state.policies.find(row=>row.academicYear===$('doe-policy-year')?.value);
  state.versions=policy?await state.repository.listVersions(policy.policyId):[];
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
  state.policies=await state.repository.listPolicies();
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
  $('doe-rule-guideline').value=rule.guidelineReference||'';
  $('doe-rule-source-type').value=rule.sourceType||'';
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
   guidelineReference:$('doe-rule-guideline').value,
   sourceType:$('doe-rule-source-type').value,
   enabled:$('doe-rule-enabled').checked,
   formulaText:advanced?$('doe-rule-formula').value:'',
   selectors,inputs,parameters,tiers
  });
 }

 async function saveRule(){
  const cap=capabilities(state.profile);
  if(!cap.editDraft||!isDraft())return;
  const draft=readRuleEditor();
  const validation=(root?.UCVM_DOE_POLICY_ENGINE||DEFAULT_ENGINE).validatePolicy({
   version:state.bundle.version,rules:[draft],exceptions:[]
  });
  if(!validation.valid){say(validation.errors.map(error=>error.message).join(' '),true);return}
  let revision=Number(state.bundle.version.revision||0);
  const base={...draft};
  delete base.selectors;delete base.inputs;delete base.parameters;delete base.tiers;
  let saved=await state.repository.saveDraftRule(base,revision,actor());
  revision=Number(saved.version.revision||0);
  for(const selector of draft.selectors){
   saved=await state.repository.saveSelector({...selector,ruleId:draft.ruleId,policyVersionId:draft.policyVersionId},revision,actor());
   revision=Number(saved.version.revision||0);
  }
  for(const input of draft.inputs){
   saved=await state.repository.saveRuleInput({...input,ruleId:draft.ruleId,policyVersionId:draft.policyVersionId},revision,actor());
   revision=Number(saved.version.revision||0);
  }
  for(const parameter of draft.parameters){
   saved=await state.repository.saveParameter({...parameter,ruleId:draft.ruleId,policyVersionId:draft.policyVersionId},revision,actor());
   revision=Number(saved.version.revision||0);
  }
  for(const tier of draft.tiers){
   saved=await state.repository.saveTier({...tier,ruleId:draft.ruleId,policyVersionId:draft.policyVersionId},revision,actor());
   revision=Number(saved.version.revision||0);
  }
  closeRuleEditor();
  await loadBundle(draft.policyVersionId);
  say('DOE Draft rule saved. Impact Preview is now outdated.');
 }

 function sampleInputs(){
  const raw=text($('doe-test-inputs')?.value);
  if(!raw)return{};
  const parsed=JSON.parse(raw);
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('Test inputs must be a JSON object.');
  return parsed;
 }

 function runRuleTest(){
  try{
   const result=testRule(readRuleEditor(),sampleInputs(),root?.UCVM_DOE_POLICY_ENGINE||DEFAULT_ENGINE);
   $('doe-test-output').textContent=`Result: ${Number(result.resultDoe).toFixed(2)}% DOE · Rule: ${result.ruleKey||result.ruleId} · Inputs: ${JSON.stringify(result.inputs)} · Parameters: ${JSON.stringify(result.parameters)}`;
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
  await state.repository.saveException(row,Number(version.revision||0),actor());
  closeExceptionEditor();
  await loadBundle(version.policyVersionId);
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
 }

 async function preview(){
  if(typeof state.service.runImpactPreview!=='function'){
   $('doe-impact-preview').innerHTML='<div class="doe-preview-empty">Impact Preview simulation is enabled in the next implementation stage. Draft validation is available now.</div>';
   return;
  }
  const result=await state.service.runImpactPreview(selectedVersion().policyVersionId);
  $('doe-impact-preview').textContent=JSON.stringify(result,null,2);
  await loadBundle(selectedVersion().policyVersionId);
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
  if(typeof state.service.runRecalculate!=='function'){say('Recalculate will be enabled after the recalculation workflow is installed.',true);return}
  await state.service.runRecalculate({academicYear:selectedVersion().academicYear,policyVersionId:selectedVersion().policyVersionId});
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
  $('doe-rule-test')?.addEventListener('click',runRuleTest);
  $('doe-rule-advanced')?.addEventListener('change',event=>$('doe-rule-formula-wrap')?.classList.toggle('hidden',!event.target.checked));
  $('doe-add-selector')?.addEventListener('click',()=>addRow('doe-selector-rows',selectorRow));
  $('doe-add-input')?.addEventListener('click',()=>addRow('doe-input-rows',inputRow));
  $('doe-add-parameter')?.addEventListener('click',()=>addRow('doe-parameter-rows',parameterRow));
  $('doe-add-tier')?.addEventListener('click',()=>addRow('doe-tier-rows',tierRow));
  $('doe-exception-close')?.addEventListener('click',closeExceptionEditor);
  $('doe-exception-cancel')?.addEventListener('click',closeExceptionEditor);
  $('doe-exception-save')?.addEventListener('click',()=>saveException().catch(error=>say(error.message||error,true)));
 }

 function init({db,profile,user,toast}={}){
  const cap=capabilities(profile);
  if(!cap.initialize||!db)return false;
  const firestore=root?.UCVM_DOE_POLICY_FIRESTORE;
  const serviceFactory=root?.UCVM_DOE_POLICY_SERVICE;
  const engine=root?.UCVM_DOE_POLICY_ENGINE||DEFAULT_ENGINE;
  if(!firestore?.createFirestoreRepository||!serviceFactory?.createService||!engine)return false;
  state.db=db;state.profile=profile;state.user=user;state.toast=toast;
  state.repository=firestore.createFirestoreRepository({db});
  state.service=serviceFactory.createService({
   repository:state.repository,
   engine,
   actorProvider:actor
  });
  state.initialized=true;
  wire();
  applyPermissions();
  return true;
 }

 function destroy(){
  state.initialized=false;state.db=null;state.profile=null;state.user=null;state.repository=null;state.service=null;state.bundle=null;state.policies=[];state.versions=[];
 }

 return{
  capabilities,
  normalizeRuleDraft,
  validateExceptionDraft,
  testRule,
  buildImpactDataset,
  impactPreviewHtml,
  init,
  destroy,
  load,
  openRuleEditor,
  openExceptionEditor
 };
});
