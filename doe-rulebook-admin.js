(function(root,factory){
 const api=factory(root,root&&root.UCVM_DOE_API);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_RULEBOOK_ADMIN=api;
})(typeof window!=='undefined'?window:null,function(root,DOE_API){
 'use strict';
 const REVIEW_STATUSES=Object.freeze(['needs_review','confirmed_unchanged','updated','new','retired']);
 const RULE_GROUPS=Object.freeze([
  {key:'assigned-teaching',label:'Assigned Teaching',hint:'Lecture, SRL, Laboratory'},
  {key:'course-coordination',label:'Course Coordination',hint:'Unit-based tiers'},
  {key:'clinical-rotations',label:'Clinical Rotations',hint:'Participant & Coordinator'},
  {key:'supervision',label:'Supervision',hint:'All trainee types'},
  {key:'hicc-visc',label:'HICC / VISC',hint:'Course & subject mappings'},
  {key:'reserve-logic',label:'Reserve Logic',hint:'Teaching & Trainee'},
  {key:'other-approved',label:'Other / Approved Activities',hint:'Capped and approved allocations'}
 ]);
 const state={bundle:null,editable:false,reload:null,wired:false,historyVersionId:'',historyLoading:null};
 const text=value=>String(value??'').trim();
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const doc=()=>root?.document||null;
 const $=id=>doc()?.getElementById(id)||null;
 function referenceView(row={}){
  const parts=[];
  if(text(row.title))parts.push(text(row.title));
  if(text(row.section))parts.push(`§${text(row.section)}`);
  if(text(row.table))parts.push(text(row.table));
  if(row.page!==undefined&&row.page!==null&&text(row.page))parts.push(`p.${text(row.page)}`);
  if(!parts.length&&text(row.referenceId))parts.push(text(row.referenceId));
  return{reference:parts.join(' · '),note:text(row.adminNote||row.note)};
 }
 function nextAcademicYear(value){
  const match=text(value).match(/^(\d{4})-(\d{2})$/);if(!match)return'';
  const start=Number(match[1])+1;return`${start}-${String((start+1)%100).padStart(2,'0')}`;
 }
 function statusText(value){return({needs_review:'Needs Review',confirmed_unchanged:'Confirmed Unchanged',updated:'Updated',new:'New',retired:'Retired'})[text(value)]||'Needs Review'}
 function setStatus(message,tone=''){
  const node=$('doe-rulebook-api-status');if(!node)return;
  node.textContent=message;node.dataset.tone=tone;
 }
 function switchPanel(name){
  const d=doc();if(!d)return;
  d.querySelectorAll('[data-doe-rulebook-tab]').forEach(node=>node.classList.toggle('active',node.dataset.doeRulebookTab===name));
  d.querySelectorAll('[data-doe-rulebook-panel]').forEach(node=>node.classList.toggle('hidden',node.dataset.doeRulebookPanel!==name));
  if(name==='history')loadHistory().catch(error=>setStatus(error.message||String(error),'error'));
 }
 function actionText(value){
  return text(value).replace(/_/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase())||'DOE change';
 }
 function historyRows(rows=[]){
  const year=text(state.bundle?.version?.academicYear);
  if(!rows.length)return'<tr><td colspan="5" class="empty">No audit history is recorded for this Policy Version.</td></tr>';
  return rows.map(row=>{
   const when=text(row.changedAt||row.publishedAt||row.calculatedAt),category=text(row.entityType||row.category||'policy'),entity=text(row.entityId),actor=text(row.changedByName||row.changedByEmail||row.changedBy||'System');
   const detail=[actionText(row.action),entity&&entity!==text(row.policyVersionId)?entity:''].filter(Boolean).join(' · ');
   return`<tr><td>${esc(when?new Date(when).toLocaleString():'—')}</td><td>${esc(text(row.academicYear)||year||'—')}</td><td>${esc(actionText(category))}</td><td><strong>${esc(detail||'DOE change')}</strong></td><td>${esc(actor)}</td></tr>`;
  }).join('');
 }
 async function loadHistory({force=false}={}){
  const body=$('doe-rulebook-history-body'),versionId=text(state.bundle?.version?.policyVersionId);
  if(!body)return[];
  if(!versionId){body.innerHTML='<tr><td colspan="5" class="empty">Select a Policy Version to view its audit history.</td></tr>';return[]}
  if(!DOE_API?.listAudit){body.innerHTML='<tr><td colspan="5" class="empty">Rule Book audit history is unavailable.</td></tr>';return[]}
  if(!force&&state.historyLoading&&state.historyVersionId===versionId)return state.historyLoading;
  state.historyVersionId=versionId;
  body.innerHTML='<tr><td colspan="5" class="empty">Loading Rule Book audit history…</td></tr>';
  state.historyLoading=DOE_API.listAudit(versionId).then(rows=>{
   if(state.historyVersionId===versionId)body.innerHTML=historyRows(Array.isArray(rows)?rows:[]);
   return rows;
  }).catch(error=>{
   if(state.historyVersionId===versionId)body.innerHTML=`<tr><td colspan="5" class="empty">Could not load Rule Book audit history: ${esc(error?.message||String(error))}</td></tr>`;
   throw error;
  }).finally(()=>{state.historyLoading=null});
  return state.historyLoading;
 }
 function renderMappingRows(rows,type,editable=true){
  const values=Array.isArray(rows)?rows:[];
  if(!values.length)return`<tr><td colspan="6" class="empty">No ${type==='course'?'course':'VISC subject'} mappings are configured for this Draft.</td></tr>`;
  return values.map(row=>{
   const ref=referenceView(row.reference||row);
   const key=type==='course'?text(row.courseCode):text(row.subjectKey||row.displayName);
   const value=type==='course'?`${Number(row.unitCount||0)} unit(s)`:text(row.curriculumStage)||'—';
   return`<tr><td><strong>${esc(key)}</strong></td><td>${esc(value)}</td><td>${esc(ref.reference||'Reference required')}</td><td><span class="doe-review-pill" data-review="${esc(text(row.reviewStatus)||'needs_review')}">${esc(statusText(row.reviewStatus))}</span></td><td>${esc(text(row.adminNote)||'—')}</td><td><button class="btn btn-small" type="button" data-doe-mapping-edit="${esc(text(row.mappingId))}" data-doe-mapping-type="${type}" ${editable?'':'disabled'}>Edit</button></td></tr>`;
  }).join('');
 }
 function referenceRows(bundle){
  const references=new Map((bundle?.references||[]).map(row=>[text(row.referenceId),row]));
  const decorate=rows=>(rows||[]).map(row=>({...row,reference:references.get(text(row.referenceId))||{referenceId:text(row.referenceId)}}));
  return{course:decorate(bundle?.courseMappings),subject:decorate(bundle?.subjectMappings)};
 }
 function renderBundle(bundle,{editable=false,reload=null}={}){
  state.bundle=bundle||null;state.editable=Boolean(editable);state.reload=typeof reload==='function'?reload:null;state.historyVersionId='';
  const decorated=referenceRows(bundle||{}),courseBody=$('doe-course-mapping-body'),subjectBody=$('doe-visc-mapping-body');
  if(courseBody)courseBody.innerHTML=renderMappingRows(decorated.course,'course',state.editable);
  if(subjectBody)subjectBody.innerHTML=renderMappingRows(decorated.subject,'subject',state.editable);
  for(const id of ['doe-add-course-mapping','doe-add-visc-mapping','doe-add-reference','doe-edit-reserve']){const button=$(id);if(button)button.disabled=!state.editable}
  renderReferences();renderReserveSummary();
  const historyPanel=doc()?.querySelector('[data-doe-rulebook-panel="history"]');
  if(historyPanel&&!historyPanel.classList.contains('hidden'))loadHistory({force:true}).catch(error=>setStatus(error.message||String(error),'error'));
  return bundle;
 }

 function renderReferences(){
  const target=$('doe-reference-list');if(!target)return;
  const rows=state.bundle?.references||[];
  target.innerHTML=rows.map(row=>`<button type="button" class="btn btn-small" data-doe-reference-edit="${esc(row.referenceId)}" ${state.editable?'':'disabled'}>${esc(referenceView(row).reference||row.referenceId)} · ${esc(statusText(row.reviewStatus))}</button>`).join(' ')||'<span class="muted">No References configured.</span>';
 }
 function renderReserveSummary(){
  const target=$('doe-reserve-summary'),row=state.bundle?.version?.reservePolicy;if(!target)return;
  target.textContent=row?`≤ ${Number(row.splitThreshold||0)}% split · high teaching ceiling ${Number(row.highTeachingTraineeCeiling||0)}% · teaching-focused ceiling ${Number(row.teachingFocusedTraineeCeiling||0)}% · ${Number(row.rollingAverageYears||0)}-year average · ${statusText(row.reviewStatus)}`:'Reserve policy not configured';
 }
 function normalizeMappingDraft(type,input={}){
  const common={mappingId:text(input.mappingId),referenceId:text(input.referenceId),reviewStatus:text(input.reviewStatus)||'needs_review',adminNote:text(input.adminNote),enabled:input.enabled!==false};
  if(type==='course')return{...common,courseCode:text(input.courseCode).toUpperCase(),unitCount:Number(input.unitCount)};
  if(type==='subject')return{...common,subjectKey:text(input.subjectKey).toLowerCase(),curriculumStage:text(input.curriculumStage)};
  throw new Error('Unsupported DOE mapping type.');
 }
 function mappingRows(type){return type==='course'?(state.bundle?.courseMappings||[]):(state.bundle?.subjectMappings||[])}
 function mappingId(type){
  const uuid=root?.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return`${type==='course'?'course':'subject'}-mapping-${uuid}`;
 }
 function populateReferences(selected=''){
  const select=$('doe-mapping-reference-id');if(!select)return;
  select.innerHTML=(state.bundle?.references||[]).map(row=>`<option value="${esc(row.referenceId)}">${esc(referenceView(row).reference||row.referenceId)}</option>`).join('');
  if(selected)select.value=selected;
 }
 function closeMappingEditor(){$('doe-mapping-editor')?.classList.add('hidden')}
 function openMappingEditor(type,id=''){
  if(!state.editable||state.bundle?.version?.status!=='draft')throw new Error('Select an editable Draft Policy Version first.');
  const row=mappingRows(type).find(item=>text(item.mappingId)===text(id))||{};
  $('doe-mapping-type').value=type;$('doe-mapping-id').value=text(row.mappingId);
  const course=type==='course';
  $('doe-mapping-course-code-wrap')?.classList.toggle('hidden',!course);$('doe-mapping-unit-count-wrap')?.classList.toggle('hidden',!course);
  $('doe-mapping-subject-key-wrap')?.classList.toggle('hidden',course);$('doe-mapping-curriculum-stage-wrap')?.classList.toggle('hidden',course);
  $('doe-mapping-editor-title').textContent=course?(id?'Edit Course Mapping':'Add Course Mapping'):(id?'Edit VISC Subject Mapping':'Add VISC Subject Mapping');
  $('doe-mapping-course-code').value=text(row.courseCode);$('doe-mapping-unit-count').value=row.unitCount??'';
  $('doe-mapping-subject-key').value=text(row.subjectKey);$('doe-mapping-curriculum-stage').value=text(row.curriculumStage);
  populateReferences(text(row.referenceId));
  $('doe-mapping-review-status').value=text(row.reviewStatus)||(id?'updated':'new');
  $('doe-mapping-admin-note').value=text(row.adminNote);$('doe-mapping-enabled').checked=row.enabled!==false;
  $('doe-mapping-editor')?.classList.remove('hidden');
 }
 async function saveMapping(){
  const type=text($('doe-mapping-type')?.value),versionId=text(state.bundle?.version?.policyVersionId);
  if(!state.editable||state.bundle?.version?.status!=='draft'||!versionId)throw new Error('Select an editable Draft Policy Version first.');
  const raw={
   mappingId:text($('doe-mapping-id')?.value)||mappingId(type),courseCode:text($('doe-mapping-course-code')?.value),unitCount:$('doe-mapping-unit-count')?.value,
   subjectKey:text($('doe-mapping-subject-key')?.value),curriculumStage:text($('doe-mapping-curriculum-stage')?.value),referenceId:text($('doe-mapping-reference-id')?.value),
   reviewStatus:text($('doe-mapping-review-status')?.value),adminNote:text($('doe-mapping-admin-note')?.value),enabled:$('doe-mapping-enabled')?.checked!==false
  };
  const draft=normalizeMappingDraft(type,raw);
  if(!draft.referenceId)throw new Error('Reference is required.');
  if(type==='course'&&(!draft.courseCode||!Number.isFinite(draft.unitCount)||draft.unitCount<=0))throw new Error('Course code and positive course units are required.');
  if(type==='subject'&&!draft.subjectKey)throw new Error('VISC subject key is required.');
  setStatus('Saving Draft mapping…');
  const saved=type==='course'
   ?await DOE_API.saveCourseMapping(versionId,draft)
   :await DOE_API.saveSubjectMapping(versionId,draft);
  closeMappingEditor();setStatus('Draft mapping saved. Validate the Rule Book before publication.','success');
  if(state.reload)await state.reload();
  else{
   const key=type==='course'?'courseMappings':'subjectMappings',rows=[...(state.bundle?.[key]||[])],at=rows.findIndex(row=>text(row.mappingId)===text(saved.mappingId));
   if(at>=0)rows[at]=saved;else rows.push(saved);state.bundle={...state.bundle,[key]:rows};renderBundle(state.bundle,{editable:state.editable,reload:state.reload});
  }
  return saved;
 }
 function fillReferenceSelect(id,selected=''){
  const select=$(id);if(!select)return;
  select.innerHTML=(state.bundle?.references||[]).map(row=>`<option value="${esc(row.referenceId)}">${esc(referenceView(row).reference||row.referenceId)}</option>`).join('');
  if(selected)select.value=selected;
 }
 function closeReferenceEditor(){$('doe-reference-editor')?.classList.add('hidden')}
 function openReferenceEditor(id=''){
  if(!state.editable||state.bundle?.version?.status!=='draft')throw new Error('Select an editable Draft Policy Version first.');
  const row=(state.bundle?.references||[]).find(item=>text(item.referenceId)===text(id))||{};
  $('doe-reference-editor-title').textContent=id?'Edit DOE Reference':'Add DOE Reference';
  $('doe-reference-id').value=text(row.referenceId);$('doe-reference-id').disabled=Boolean(id);$('doe-reference-title').value=text(row.title);$('doe-reference-version-date').value=text(row.versionDate).slice(0,10);$('doe-reference-section').value=text(row.section);$('doe-reference-table').value=text(row.table);$('doe-reference-page').value=row.page??'';$('doe-reference-effective-date').value=text(row.effectiveDate).slice(0,10);$('doe-reference-document-link').value=text(row.documentLink);$('doe-reference-review-status').value=text(row.reviewStatus)||(id?'updated':'new');$('doe-reference-admin-note').value=text(row.adminNote);
  $('doe-reference-editor')?.classList.remove('hidden');
 }
 async function saveReference(){
  const versionId=text(state.bundle?.version?.policyVersionId);if(!state.editable||!versionId)throw new Error('Select an editable Draft Policy Version first.');
  const reference={referenceId:text($('doe-reference-id')?.value),title:text($('doe-reference-title')?.value),versionDate:text($('doe-reference-version-date')?.value),section:text($('doe-reference-section')?.value),table:text($('doe-reference-table')?.value),page:$('doe-reference-page')?.value===''?null:Number($('doe-reference-page')?.value),effectiveDate:text($('doe-reference-effective-date')?.value),documentLink:text($('doe-reference-document-link')?.value),reviewStatus:text($('doe-reference-review-status')?.value),adminNote:text($('doe-reference-admin-note')?.value)};
  if(!reference.referenceId||!reference.title)throw new Error('Reference ID and Document title are required.');
  const saved=await DOE_API.saveReference(versionId,reference);closeReferenceEditor();setStatus('Reference saved. Draft validation is now outdated.','success');if(state.reload)await state.reload();return saved;
 }
 function closeReserveEditor(){$('doe-reserve-editor')?.classList.add('hidden')}
 function openReserveEditor(){
  if(!state.editable||state.bundle?.version?.status!=='draft')throw new Error('Select an editable Draft Policy Version first.');
  const row=state.bundle?.version?.reservePolicy||{};
  $('doe-reserve-split-threshold').value=row.splitThreshold??'';$('doe-reserve-split-ratio').value=row.splitRatio??'';$('doe-reserve-high-ceiling').value=row.highTeachingTraineeCeiling??'';$('doe-reserve-teaching-focused-ceiling').value=row.teachingFocusedTraineeCeiling??'';$('doe-reserve-rolling-years').value=row.rollingAverageYears??'';fillReferenceSelect('doe-reserve-reference-id',text(row.referenceId));$('doe-reserve-review-status').value=text(row.reviewStatus)||'needs_review';
  $('doe-reserve-editor')?.classList.remove('hidden');
 }
 async function saveReservePolicy(){
  const versionId=text(state.bundle?.version?.policyVersionId);if(!state.editable||!versionId)throw new Error('Select an editable Draft Policy Version first.');
  const reservePolicy={strategy:'flexible_teaching_reserve',splitThreshold:Number($('doe-reserve-split-threshold')?.value),splitRatio:Number($('doe-reserve-split-ratio')?.value),highTeachingTraineeCeiling:Number($('doe-reserve-high-ceiling')?.value),teachingFocusedTraineeCeiling:Number($('doe-reserve-teaching-focused-ceiling')?.value),rollingAverageYears:Number($('doe-reserve-rolling-years')?.value),referenceId:text($('doe-reserve-reference-id')?.value),reviewStatus:text($('doe-reserve-review-status')?.value)};
  const saved=await DOE_API.saveReservePolicy(versionId,reservePolicy);closeReserveEditor();setStatus('Reserve Logic saved. Draft validation is now outdated.','success');if(state.reload)await state.reload();return saved;
 }

 async function copyPreviousYear(){
  if(!DOE_API?.copyPolicyYear)throw Error('DOE API is unavailable.');
  const year=$('doe-policy-year')?.value||'';
  const target=nextAcademicYear(year);if(!target)throw Error('Select a valid Academic Year first.');
  if(root.confirm&&!root.confirm(`Copy ${year} DOE rules to ${target} as a Draft? All copied items will require annual review.`))return;
  setStatus(`Copying ${year} to ${target}…`);
  const result=await DOE_API.copyPolicyYear(year,target);
  setStatus(`${target} Draft created. Review every copied rule and mapping before validation.`,'success');
  await root?.UCVM_DOE_POLICY_ADMIN?.load?.();
  return result;
 }
 async function validateCurrentDraft(){
  if(!DOE_API?.validateDraft)throw Error('DOE API is unavailable.');
  const version=$('doe-policy-version')?.value||'';if(!version)throw Error('Select a Draft Policy Version first.');
  setStatus('Validating the Draft against authoritative assignments…');
  const report=await DOE_API.validateDraft(version);
  setStatus(report.valid?'Annual Rule Book validation passed.':`Validation found ${report.errors?.length||0} blocking issue(s).`,report.valid?'success':'error');
  return report;
 }
 function wire(){
  const d=doc();if(!d||state.wired)return false;state.wired=true;
  d.querySelectorAll('[data-doe-rulebook-tab]').forEach(button=>button.addEventListener('click',()=>switchPanel(button.dataset.doeRulebookTab)));
  $('doe-copy-previous-year')?.addEventListener('click',()=>copyPreviousYear().catch(error=>setStatus(error.message||String(error),'error')));
  $('doe-rulebook-validate')?.addEventListener('click',()=>validateCurrentDraft().catch(error=>setStatus(error.message||String(error),'error')));
  $('doe-add-course-mapping')?.addEventListener('click',()=>{try{openMappingEditor('course')}catch(error){setStatus(error.message,'error')}});
  $('doe-add-visc-mapping')?.addEventListener('click',()=>{try{openMappingEditor('subject')}catch(error){setStatus(error.message,'error')}});
  $('doe-course-mapping-body')?.addEventListener('click',event=>{const button=event.target.closest?.('[data-doe-mapping-edit]');if(button)openMappingEditor('course',button.dataset.doeMappingEdit)});
  $('doe-visc-mapping-body')?.addEventListener('click',event=>{const button=event.target.closest?.('[data-doe-mapping-edit]');if(button)openMappingEditor('subject',button.dataset.doeMappingEdit)});
  $('doe-mapping-close')?.addEventListener('click',closeMappingEditor);$('doe-mapping-cancel')?.addEventListener('click',closeMappingEditor);
  $('doe-mapping-save')?.addEventListener('click',()=>saveMapping().catch(error=>setStatus(error.message||String(error),'error')));
  $('doe-add-reference')?.addEventListener('click',()=>{try{openReferenceEditor()}catch(error){setStatus(error.message,'error')}});
  $('doe-reference-list')?.addEventListener('click',event=>{const button=event.target.closest?.('[data-doe-reference-edit]');if(button)openReferenceEditor(button.dataset.doeReferenceEdit)});
  $('doe-reference-close')?.addEventListener('click',closeReferenceEditor);$('doe-reference-cancel')?.addEventListener('click',closeReferenceEditor);$('doe-reference-save')?.addEventListener('click',()=>saveReference().catch(error=>setStatus(error.message||String(error),'error')));
  $('doe-edit-reserve')?.addEventListener('click',()=>{try{openReserveEditor()}catch(error){setStatus(error.message,'error')}});$('doe-reserve-close')?.addEventListener('click',closeReserveEditor);$('doe-reserve-cancel')?.addEventListener('click',closeReserveEditor);$('doe-reserve-save')?.addEventListener('click',()=>saveReservePolicy().catch(error=>setStatus(error.message||String(error),'error')));
  return true;
 }
 if(root?.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',wire);else wire()}
 return{REVIEW_STATUSES,RULE_GROUPS,referenceView,nextAcademicYear,statusText,renderMappingRows,renderBundle,historyRows,loadHistory,normalizeMappingDraft,switchPanel,wire,openMappingEditor,saveMapping,openReferenceEditor,saveReference,openReserveEditor,saveReservePolicy,copyPreviousYear,validateCurrentDraft};
});
