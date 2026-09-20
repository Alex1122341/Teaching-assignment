/* Owner / Administrator faculty-dashboard enhancements for 2026-27 DOE management. */
(()=>{
 'use strict';
 const page=(location.pathname.split('/').pop()||'').toLowerCase();
 if(page!=='faculty-admin.html'||!window.UCVM||!window.UCVM_FACULTY_DOE||!window.UCVM_DATA_INDEX||typeof firebase==='undefined')return;
 const {auth,db}=UCVM.init(),$=id=>document.getElementById(id),esc=UCVM.esc;
 const YEAR='2026-27';
 const ROLE_TYPES=['Course Coordinator','HICC','VISC','Course Coordinator / HICC','Rotation / Week Lead','CCC','Trainee / Supervision','Special Project','Other'];
 const OVERRIDE_REASONS=['','RSL','Mat Leave','Sick Leave','Special Event','Other'];
 let user=null,profile=null,faculty=[],sessions=[],facultyById=new Map(),facultyUnsub=null,sessionUnsub=null,pendingExtra=null,roleAppendQueued=false,serverDoeRows=[],serverDoeYear='',serverDoeLoaded=false,serverDoeLoading=false,serverDoeError='',reconciliationLoading=null;
 const num=v=>{if(v===undefined||v===null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 const summary=f=>f?.facultySummary2026_27&&typeof f.facultySummary2026_27==='object'?f.facultySummary2026_27:null;
 const managedRoles=f=>Array.isArray(f?.managedRoles2026_27)?f.managedRoles2026_27:[];
 const roleEffect=r=>{const value=Math.abs(num(r?.doeCredit)||0);return r?.action==='remove'?-value:value};
 const facultyName=f=>String(f?.preferredFullName||f?.hrFirstLast||f?.hrFullName||summary(f)?.displayName||f?.__id||'');
 function apiDoeReady(){return Boolean(window.UCVM_DOE_API?.isConfigured?.()&&window.UCVM_DOE_WORKSHEET_VIEW)}
 function demoDoeReady(){return Boolean(window.UCVM_FRONTEND_DEMO_MODE&&window.UCVM_PAGES_DEMO?.doeRows&&window.UCVM_DOE_WORKSHEET_VIEW)}
 function doeDataReady(){return apiDoeReady()||demoDoeReady()}
 function doeListAcademicYear(){return String($('doe-policy-year')?.value||YEAR).trim()||YEAR}
 async function loadDoeList({force=false}={}){
  const year=doeListAcademicYear();
  if(demoDoeReady()){
   serverDoeRows=window.UCVM_PAGES_DEMO.doeRows(year);serverDoeYear=year;serverDoeLoaded=true;serverDoeLoading=false;serverDoeError='';renderDoeList();queueManagedRoles();return serverDoeRows;
  }
  if(!apiDoeReady())return[];
  const shared=window.UCVM_ADMIN_DATA;
  if(!shared?.loadDoeSummaryList||!shared?.doeList)throw Error('Shared Faculty Dashboard DOE cache is unavailable.');
  const snapshot=shared.doeList();
  if(!force&&snapshot?.loaded&&snapshot.academicYear===year){
   serverDoeRows=Array.isArray(snapshot.rows)?snapshot.rows:[];serverDoeYear=year;serverDoeLoaded=true;serverDoeError=snapshot.error||'';renderDoeList();queueManagedRoles();return serverDoeRows;
  }
  if(serverDoeLoading&&!force)return serverDoeRows;
  serverDoeLoading=true;serverDoeError='';renderDoeList();
  try{
   await shared.loadDoeSummaryList({force});
   const next=shared.doeList();
   serverDoeRows=Array.isArray(next?.rows)?next.rows:[];serverDoeYear=next?.academicYear||year;serverDoeLoaded=Boolean(next?.loaded);serverDoeError=next?.error||'';
   return serverDoeRows;
  }finally{serverDoeLoading=false;renderDoeList();queueManagedRoles()}
 }
 function legacyDoeRows(){
  const built=window.UCVM_DATA_INDEX.buildFacultyIndex(faculty,sessions),entries=new Map((built.entries||[]).map(row=>[String(row.id),row]));
  return faculty.filter(f=>f.active!==false).map(f=>{
   const entry=entries.get(String(f.__id))||window.UCVM_DATA_INDEX.facultyEntry(String(f.__id),f,{}),diff=entry.remainingDOE;
   let status=entry.calculationStatus==='error'?'error':'unavailable';if(status!=='error'&&diff!==null)status=Math.abs(diff)<=.25?'within':diff>0?'remaining':'over';
   return{f,scheduled:entry.scheduledDOE,roleDoe:entry.managedRoleDOE,rawSupervisionDoe:null,appliedSupervisionDoe:null,adjustmentDoe:entry.sourceNonTimetableTeachingDOE,assigned:entry.calculationStatus==='error'?null:entry.assignedTeachingDOE,target:entry.effectiveTargetDOE,diff,status,policyVersionId:entry.policyVersionId||'—',calculationStatus:entry.calculationStatus||'unavailable',lastCalculatedAt:''};
  });
 }
 function buildDoeRows(){
  if(!doeDataReady())return faculty.filter(f=>f.active!==false).map(f=>({f,scheduled:null,roleDoe:null,rawSupervisionDoe:null,appliedSupervisionDoe:null,adjustmentDoe:null,assigned:null,target:null,diff:null,status:'unavailable',policyVersionId:'—',calculationStatus:'DOE backend not configured',lastCalculatedAt:''}));
  if(!serverDoeLoaded||serverDoeYear!==doeListAcademicYear())return[];
  return serverDoeRows.map(row=>{const view=window.UCVM_DOE_WORKSHEET_VIEW.renderDoeListRow(row),id=String(view.facultyId||row.facultyId||''),f=facultyById.get(id)||{__id:id,preferredFullName:view.displayName||row.displayName||id,active:true};return{f,scheduled:view.scheduledDoe,roleDoe:view.roleDoe,rawSupervisionDoe:view.rawSupervisionDoe,appliedSupervisionDoe:view.appliedSupervisionDoe,adjustmentDoe:view.adjustmentDoe,assigned:view.assignedDoe,target:view.targetDoe,diff:view.remainingDoe,status:view.status.key,policyVersionId:view.policyVersionId||'—',calculationStatus:view.calculationStatus,lastCalculatedAt:view.lastCalculatedAt};});
 }
 const pct=(v,d=2)=>v===null?'—':`${Number(v).toFixed(d)}%`;
 function specialty(f){const v=f?.teachingAreaEmphasis||f?.teachingArea||f?.boardSpecialties||f?.boardCertification||'';return String(v).split(/\n|;/)[0].trim()}
 function statusText(r){if(['error','needs_review','unavailable'].includes(r.status))return r.status==='needs_review'?'Needs Review':'DOE unavailable';if(r.diff===null)return'DOE unavailable';if(r.status==='within')return'Within target';if(r.status==='remaining')return`${pct(r.diff)} remaining`;return`${pct(Math.abs(r.diff))} over`}
 function overrideNote(f){const o=window.UCVM_FACULTY_DOE.override(f);if(o.value===null)return'—';return [o.reason,o.notes].filter(Boolean).join(' · ')||'Office override'}
 function managedRolesText(f){const rs=managedRoles(f);return rs.length?rs.map(r=>`${r.action==='remove'?'Remove':'Add'} ${r.type}${r.assignment?` — ${r.assignment}`:''} (${roleEffect(r)>=0?'+':''}${pct(roleEffect(r))})`).join('; '):'—'}

 function installStyles(){if($('ucvm-doe-enhancement-style'))return;const s=document.createElement('style');s.id='ucvm-doe-enhancement-style';s.textContent=`
 #doe-list-view .doe-filter-grid{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px;border-bottom:1px solid var(--border)}
 #doe-list-view .doe-filter-grid .input{min-width:220px;flex:1}#doe-list-view .doe-filter-grid .select{min-width:150px}
 #doe-list-view .doe-status-pill{display:inline-flex;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid var(--border)}
 #doe-list-view .doe-status-pill.within{background:#ecfdf3;color:#166534;border-color:#a7d7b5}#doe-list-view .doe-status-pill.remaining{background:#fff8e6;color:#8a5d00;border-color:#ebcd83}#doe-list-view .doe-status-pill.over,#doe-list-view .doe-status-pill.error{background:#fff1f2;color:#b91c1c;border-color:#f3b4ba}#doe-list-view .doe-status-pill.needs_review{background:#fff8e6;color:#8a5d00;border-color:#ebcd83}#doe-list-view .doe-status-pill.unavailable{background:#f3f4f6;color:#6b7280}
 #doe-list-view .doe-override{font-weight:800;color:var(--navy)}#doe-list-view .doe-note-cell{max-width:260px;white-space:normal;line-height:1.35}
 .ucvm-role-help{margin:0 0 10px;padding:10px 12px;border:1px solid #dbe4f3;border-radius:7px;background:#f7faff;font-size:11px;line-height:1.5;color:var(--text2)}
 .ucvm-managed-role-row{display:grid;grid-template-columns:1.15fr 1.35fr 1.2fr 1.5fr auto;gap:7px;align-items:end;padding:8px;border:1px solid var(--border);border-radius:7px;margin-bottom:7px;background:var(--surface2)}
 .ucvm-managed-role-row label{display:flex;flex-direction:column;gap:3px}.ucvm-managed-role-row .form-label{font-size:9px}.ucvm-role-remove{align-self:end}.ucvm-override-grid{display:grid;grid-template-columns:1fr 1fr 2fr;gap:9px}
 .ucvm-managed-source{display:inline-block;margin-left:4px;padding:1px 5px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:9px;font-weight:800}
 #doe-reconciliation-view .doe-reconciliation-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px;border-bottom:1px solid var(--border)}#doe-reconciliation-view .doe-reconciliation-toolbar .input{min-width:220px;flex:1}#doe-reconciliation-view .doe-reconciliation-toolbar .select{min-width:170px}#doe-reconciliation-view .reconciliation-status{display:inline-flex;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid var(--border)}#doe-reconciliation-view .reconciliation-status.matched{background:#ecfdf3;color:#166534;border-color:#a7d7b5}#doe-reconciliation-view .reconciliation-status.different_doe{background:#fff8e6;color:#8a5d00;border-color:#ebcd83}#doe-reconciliation-view .reconciliation-status.legacy_only,#doe-reconciliation-view .reconciliation-status.server_only{background:#eef2ff;color:#3730a3;border-color:#c7d2fe}#doe-reconciliation-view .reconciliation-status.missing_mapping,#doe-reconciliation-view .reconciliation-status.needs_review{background:#fff1f2;color:#b91c1c;border-color:#f3b4ba}#doe-reconciliation-view .reconciliation-kpis{padding:12px}#doe-reconciliation-view .reconciliation-section{padding:0 12px 14px}#doe-reconciliation-view .reconciliation-section h3{margin:14px 0 8px;font-size:14px}
 @media(max-width:900px){.ucvm-managed-role-row,.ucvm-override-grid{grid-template-columns:1fr 1fr}.ucvm-managed-role-row .ucvm-role-notes{grid-column:1/-1}}
 `;document.head.appendChild(s)}
 function renameDashboard(){
  if(document.documentElement.dataset.ucvmDashboardRenamed==='1')return;
  document.documentElement.dataset.ucvmDashboardRenamed='1';
  document.title='Faculty Dashboard';
  const bt=document.querySelector('.brand-title');if(bt)bt.textContent='Faculty Dashboard';
  const gt=document.querySelector('.gate-title');if(gt)gt.textContent='Faculty Dashboard';
  const gc=document.querySelector('.gate-copy');if(gc)gc.innerHTML='This dashboard is restricted to active <strong>Developer, Owner, Administrator, or Other Office</strong> accounts. Faculty can use the <a href="index.html">Timetable</a> for teaching, AFC requests, and personal change history.';
 }

 function ensureDoeView(){
  const tabs=document.querySelector('.tabs');if(!tabs||$('doe-list-tab'))return;
  const tab=document.createElement('button');tab.className='tab';tab.id='doe-list-tab';tab.dataset.tab='doe-list';tab.type='button';tab.textContent='DOE List';const rolesTab=[...tabs.querySelectorAll('.tab')].find(x=>x.dataset.tab==='roles');(rolesTab||tabs.lastElementChild)?.insertAdjacentElement('afterend',tab);
  const main=document.querySelector('main.shell');if(!main)return;
  const sec=document.createElement('section');sec.id='doe-list-view';sec.className='panel hidden';sec.innerHTML=`<div class="doe-filter-grid"><input class="input" id="doe-list-search" placeholder="Search faculty, specialty, role or notes…"><select class="select" id="doe-rank-filter"><option value="">All ranks</option></select><select class="select" id="doe-specialty-filter"><option value="">All specialties</option></select><select class="select" id="doe-status-filter"><option value="">All DOE status</option><option value="within">Within target</option><option value="remaining">Remaining / under</option><option value="over">Overage</option><option value="needs_review">Needs Review</option><option value="error">Calculation error</option><option value="unavailable">Unavailable</option></select><button class="btn" id="doe-list-reset">Reset</button></div><div class="doe-note">DOE List requires the same authoritative server-generated Faculty DOE Worksheet as Lookup. If the DOE API is unavailable, DOE is shown as unavailable rather than falling back to legacy calculations.</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Faculty</th><th>Rank</th><th>Specialty</th><th>Effective Target</th><th>Scheduled</th><th>Roles</th><th>Raw Supervision</th><th>Applied Supervision</th><th>Adjustments</th><th>Assigned DOE</th><th>Remaining / Overage</th><th>Policy Version</th><th>Status</th><th>Actions</th></tr></thead><tbody id="doe-list-body"></tbody></table></div>`;main.appendChild(sec);
  tab.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));['lookup','summary','roles','doe-rules','doe-reconciliation','sessional','database','history'].forEach(id=>$(`${id}-view`)?.classList.add('hidden'));sec.classList.remove('hidden');loadDoeList().catch(error=>console.error(error));renderDoeList()};
  document.querySelectorAll('.tab').forEach(t=>{if(t===tab)return;t.addEventListener('click',()=>sec.classList.add('hidden'))});
  ['doe-list-search','doe-rank-filter','doe-specialty-filter','doe-status-filter'].forEach(id=>$(id)?.addEventListener(id==='doe-list-search'?'input':'change',renderDoeList));
  $('doe-list-reset').onclick=()=>{['doe-list-search','doe-rank-filter','doe-specialty-filter','doe-status-filter'].forEach(id=>$(id).value='');renderDoeList()};
  $('roles-search')?.addEventListener('input',()=>setTimeout(queueManagedRoles,180));$('role-type-filter')?.addEventListener('change',()=>setTimeout(queueManagedRoles,0));const roleTab=[...document.querySelectorAll('.tab')].find(x=>x.dataset.tab==='roles');roleTab?.addEventListener('click',()=>setTimeout(queueManagedRoles,0));
 }

 function reconciliationRows(){
  const api=window.UCVM_DOE_WORKSHEET_VIEW;if(!api)return[];
  return api.buildReconciliationRows(faculty.filter(f=>f.active!==false),serverDoeRows);
 }
 function reconciliationIssueText(row){
  const codes=Array.isArray(row.issueCodes)?row.issueCodes:[],parts=[];
  if(row.status==='legacy_only')parts.push('Legacy/source evidence has no current server Worksheet row');
  if(row.status==='server_only')parts.push('Current server DOE exists without legacy/source DOE evidence');
  if(row.status==='different_doe'&&row.differenceDoe!==null)parts.push(`Worksheet differs from source by ${row.differenceDoe>0?'+':''}${pct(row.differenceDoe)}`);
  if(row.flags?.includes('role_count_mismatch'))parts.push(`Legacy managed roles ${row.legacyManagedRoleCount} vs server roles ${row.serverRoleCount}`);
  for(const code of codes.slice(0,4))parts.push(String(code).replace(/_/g,' '));
  if(!parts.length&&row.status!=='matched')parts.push('Review DOE evidence and current assignment facts');
  return parts.join(' · ')||'No reconciliation issues';
 }
 function reconciliationBadge(row){return `<span class="reconciliation-status ${esc(row.status)}">${esc(row.statusLabel||'Needs Review')}</span>`}
 function reconciliationCards(rows){
  const counts=window.UCVM_DOE_WORKSHEET_VIEW?.summarizeReconciliation?.(rows)||{},card=(label,value)=>`<div class="summary-card"><div class="summary-card-label">${esc(label)}</div><div class="summary-card-value">${esc(value??0)}</div></div>`;
  return[card('Faculty compared',counts.total||0),card('Matched',counts.matched||0),card('Action queue',counts.actionable||0),card('DOE differences',counts.different_doe||0),card('Missing mapping',counts.missing_mapping||0),card('Needs Review',counts.needs_review||0),card('Legacy only',counts.legacy_only||0),card('Server only',counts.server_only||0)].join('');
 }
 function filteredReconciliationRows(rows){
  const q=norm($('doe-reconciliation-search')?.value),status=$('doe-reconciliation-status')?.value||'',issue=$('doe-reconciliation-issue')?.value||'';
  return rows.filter(row=>{
   const blob=norm([row.displayName,row.facultyId,row.status,row.statusLabel,row.policyVersionId,(row.issueCodes||[]).join(' '),reconciliationIssueText(row)].join(' '));
   const issueMatch=!issue||(issue==='role_count_mismatch'?row.flags?.includes('role_count_mismatch'):(row.issueCodes||[]).some(code=>String(code).includes(issue)));
   return(!q||blob.includes(q))&&(!status||row.status===status)&&issueMatch;
  });
 }
 function wireReconciliationActions(){
  document.querySelectorAll('[data-reconcile-view]').forEach(button=>button.onclick=()=>window.dispatchEvent(new CustomEvent('ucvm:doe-open-faculty',{detail:{facultyId:button.dataset.reconcileView}})));
  document.querySelectorAll('[data-reconcile-edit]').forEach(button=>button.onclick=()=>openBaseEditor(button.dataset.reconcileEdit));
 }
 function renderReconciliation(){
  const body=$('doe-reconciliation-body'),queueBody=$('doe-reconciliation-queue-body'),summaryBox=$('doe-reconciliation-summary');if(!body||!queueBody||!summaryBox)return;
  if(!window.UCVM_DOE_WORKSHEET_VIEW){body.innerHTML=queueBody.innerHTML='<tr><td colspan="10" class="empty">DOE reconciliation logic is unavailable.</td></tr>';summaryBox.innerHTML='';return}
  if(!doeDataReady()){body.innerHTML=queueBody.innerHTML='<tr><td colspan="10" class="empty">DOE data is not configured on this host. Reconciliation will become available when either the Frontend Demo fixtures or the trusted DOE backend are connected.</td></tr>';summaryBox.innerHTML='';return}
  if(serverDoeLoading||!serverDoeLoaded||serverDoeYear!==doeListAcademicYear()){body.innerHTML=queueBody.innerHTML='<tr><td colspan="10" class="empty">Loading authoritative DOE summary for reconciliation…</td></tr>';summaryBox.innerHTML='';return}
  if(serverDoeError){body.innerHTML=queueBody.innerHTML=`<tr><td colspan="10" class="empty">${esc(serverDoeError)}</td></tr>`;summaryBox.innerHTML='';return}
  const allRows=reconciliationRows(),rows=filteredReconciliationRows(allRows),queue=window.UCVM_DOE_WORKSHEET_VIEW.workQueue(rows),formatDiff=value=>value===null?'—':`${value>0?'+':''}${pct(value)}`;
  summaryBox.innerHTML=reconciliationCards(allRows);
  queueBody.innerHTML=queue.map(row=>`<tr><td><strong>${esc(row.displayName)}</strong><div class="muted">${esc(row.facultyId)}</div></td><td>${reconciliationBadge(row)}</td><td>${pct(row.legacyAssignedDoe)} → <strong>${pct(row.worksheetAssignedDoe)}</strong></td><td>${formatDiff(row.differenceDoe)}</td><td class="doe-note-cell">${esc(reconciliationIssueText(row))}</td><td><button class="btn btn-small" data-reconcile-view="${esc(row.facultyId)}">View DOE</button> <button class="btn btn-small" data-reconcile-edit="${esc(row.facultyId)}">Edit Faculty</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No actionable reconciliation rows match these filters.</td></tr>';
  body.innerHTML=rows.map(row=>`<tr><td><strong>${esc(row.displayName)}</strong><div class="muted">${esc(row.facultyId)}</div></td><td>${pct(row.legacyAssignedDoe)}<div class="muted">source roles ${row.sourceRoleCount} · managed ${row.legacyManagedRoleCount}</div></td><td><strong>${pct(row.worksheetAssignedDoe)}</strong><div class="muted">${esc(row.calculationStatus||'—')}</div></td><td>${formatDiff(row.differenceDoe)}</td><td>${row.serverFactCount}<div class="muted">roles ${row.serverRoleCount}</div></td><td>${row.unratedLineCount||0}</td><td class="doe-note-cell">${esc(reconciliationIssueText(row))}</td><td>${esc(row.policyVersionId||'—')}</td><td>${reconciliationBadge(row)}</td><td><button class="btn btn-small" data-reconcile-view="${esc(row.facultyId)}">View DOE</button> <button class="btn btn-small" data-reconcile-edit="${esc(row.facultyId)}">Edit Faculty</button></td></tr>`).join('')||'<tr><td colspan="10" class="empty">No reconciliation rows match these filters.</td></tr>';
  wireReconciliationActions();
 }
 async function loadReconciliationData(){
  if(reconciliationLoading)return reconciliationLoading;
  reconciliationLoading=(async()=>{
   const shared=window.UCVM_ADMIN_DATA;
   if(typeof shared?.ensureAdminDataset==='function')await shared.ensureAdminDataset();
   faculty=(shared?.faculty?.()||faculty).sort((a,b)=>facultyName(a).localeCompare(facultyName(b)));facultyById=new Map(faculty.map(f=>[String(f.__id),f]));sessions=shared?.sessions?.()||sessions;
   if(doeDataReady())await loadDoeList();
   renderReconciliation();
   return reconciliationRows();
  })().finally(()=>{reconciliationLoading=null});
  return reconciliationLoading;
 }
 function ensureReconciliationView(){
  const tabs=document.querySelector('.tabs');if(!tabs||$('doe-reconciliation-tab'))return;
  const listTab=$('doe-list-tab');if(!listTab)return;
  const tab=document.createElement('button');tab.className='tab';tab.id='doe-reconciliation-tab';tab.dataset.tab='doe-reconciliation';tab.type='button';tab.textContent='DOE Reconciliation';listTab.insertAdjacentElement('afterend',tab);
  const main=document.querySelector('main.shell');if(!main)return;
  const sec=document.createElement('section');sec.id='doe-reconciliation-view';sec.className='panel hidden';const reconciliationIntro=demoDoeReady()?'<strong>Frontend Demo reconciliation.</strong> The Worksheet/server columns use synthetic demo fixtures so you can test Matched, DOE Difference, Missing Mapping and Needs Review states. These values are not authoritative and are never written to a backend.':'<strong>Read-only reconciliation.</strong> Compare legacy/source workload evidence with current server DOE facts and the authoritative Worksheet. This page never publishes, recalculates, or writes DOE.';sec.innerHTML=`<div class="doe-note">${reconciliationIntro}</div><div class="summary-grid reconciliation-kpis" id="doe-reconciliation-summary"></div><div class="doe-reconciliation-toolbar"><input class="input" id="doe-reconciliation-search" placeholder="Search faculty, issue, policy or status…"><select class="select" id="doe-reconciliation-status"><option value="">All reconciliation status</option><option value="missing_mapping">Missing Mapping</option><option value="needs_review">Needs Review</option><option value="different_doe">DOE Difference</option><option value="legacy_only">Legacy Only</option><option value="server_only">Server Only</option><option value="matched">Matched</option></select><select class="select" id="doe-reconciliation-issue"><option value="">All issue types</option><option value="MAPPING_REQUIRED">Mapping required</option><option value="PROVENANCE">Provenance</option><option value="role_count_mismatch">Role count mismatch</option></select><button type="button" class="btn" id="doe-reconciliation-reset">Reset</button></div><div class="reconciliation-section"><h3>Needs Review work queue</h3><div class="doe-note">Actionable rows are prioritized before matched rows. Use View DOE for calculation evidence or Edit Faculty for assignment facts and approved target overrides.</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Faculty</th><th>Priority</th><th>Legacy → Worksheet</th><th>Difference</th><th>Why it needs attention</th><th>Actions</th></tr></thead><tbody id="doe-reconciliation-queue-body"></tbody></table></div></div><div class="reconciliation-section"><h3>All reconciliation</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Faculty</th><th>Legacy/source DOE</th><th>Worksheet DOE</th><th>Difference</th><th>Server facts</th><th>Unrated</th><th>Issues</th><th>Policy</th><th>Status</th><th>Actions</th></tr></thead><tbody id="doe-reconciliation-body"></tbody></table></div></div>`;main.appendChild(sec);
  tab.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));['lookup','summary','roles','doe-list','doe-rules','sessional','database','history'].forEach(id=>$(`${id}-view`)?.classList.add('hidden'));sec.classList.remove('hidden');renderReconciliation();loadReconciliationData().catch(error=>{console.error(error);serverDoeError=error?.message||String(error);renderReconciliation()})};
  document.querySelectorAll('.tab').forEach(other=>{if(other===tab)return;other.addEventListener('click',()=>sec.classList.add('hidden'))});
  ['doe-reconciliation-search','doe-reconciliation-status','doe-reconciliation-issue'].forEach(id=>$(id)?.addEventListener(id==='doe-reconciliation-search'?'input':'change',renderReconciliation));
  $('doe-reconciliation-reset').onclick=()=>{['doe-reconciliation-search','doe-reconciliation-status','doe-reconciliation-issue'].forEach(id=>$(id).value='');renderReconciliation()};
 }
 function updateDoeFilters(){if(!$('doe-rank-filter'))return;const ranks=[...new Set(faculty.map(f=>String(f.rank||f.currentTitle||'').trim()).filter(Boolean))].sort(),specs=[...new Set(faculty.map(specialty).filter(Boolean))].sort();const fill=(id,vals,label)=>{const e=$(id),old=e.value;e.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(vals.includes(old))e.value=old};fill('doe-rank-filter',ranks,'All ranks');fill('doe-specialty-filter',specs,'All specialties')}
 function renderDoeList(){
  if(!$('doe-list-body'))return;if(doeDataReady()&&serverDoeLoading){$('doe-list-body').innerHTML='<tr><td colspan="14" class="empty">Loading authoritative DOE worksheets…</td></tr>';return}if(doeDataReady()&&serverDoeLoaded&&serverDoeError){$('doe-list-body').innerHTML=`<tr><td colspan="14" class="empty">${esc(serverDoeError)} DOE values are unavailable until the server responds.</td></tr>`;return}const q=norm($('doe-list-search')?.value),rank=$('doe-rank-filter')?.value||'',spec=$('doe-specialty-filter')?.value||'',status=$('doe-status-filter')?.value||'';
  const rows=buildDoeRows().filter(r=>{const f=r.f,blob=norm([facultyName(f),f.rank,f.currentTitle,specialty(f),f.boardSpecialties,r.policyVersionId,r.calculationStatus].join(' '));return(!q||blob.includes(q))&&(!rank||String(f.rank||f.currentTitle||'')===rank)&&(!spec||specialty(f)===spec)&&(!status||r.status===status)}),format=v=>doeDataReady()?window.UCVM_DOE_WORKSHEET_VIEW.percent(v):pct(v);
  $('doe-list-body').innerHTML=rows.map(r=>`<tr><td><strong>${esc(facultyName(r.f))}</strong><div class="muted">${esc(r.f.__id||'')}</div></td><td>${esc(r.f.rank||r.f.currentTitle||'—')}</td><td>${esc(specialty(r.f)||'—')}</td><td>${format(r.target)}</td><td>${format(r.scheduled)}</td><td>${format(r.roleDoe)}</td><td>${format(r.rawSupervisionDoe)}</td><td>${format(r.appliedSupervisionDoe)}</td><td>${format(r.adjustmentDoe)}</td><td><strong>${format(r.assigned)}</strong></td><td><span class="doe-status-pill ${r.status}">${esc(statusText(r))}</span><div class="muted">${r.diff===null?'Unavailable':format(r.diff)}</div></td><td>${esc(r.policyVersionId)}</td><td>${esc(r.calculationStatus)}${r.lastCalculatedAt?`<div class="muted">${esc(r.lastCalculatedAt)}</div>`:''}</td><td><button class="btn btn-small" data-doe-view="${esc(r.f.__id)}">View DOE</button> <button class="btn btn-small" data-doe-edit="${esc(r.f.__id)}">Edit Faculty</button></td></tr>`).join('')||'<tr><td colspan="14" class="empty">No faculty match these filters.</td></tr>';
  document.querySelectorAll('[data-doe-view]').forEach(b=>b.onclick=()=>window.dispatchEvent(new CustomEvent('ucvm:doe-open-faculty',{detail:{facultyId:b.dataset.doeView}})));document.querySelectorAll('[data-doe-edit]').forEach(b=>b.onclick=()=>openBaseEditor(b.dataset.doeEdit));
 }
 function openBaseEditor(id){const tab=[...document.querySelectorAll('.tab')].find(x=>x.dataset.tab==='database');tab?.click();setTimeout(()=>{const b=[...document.querySelectorAll('[data-edit]')].find(x=>x.dataset.edit===id);if(b)b.click()},60)}

 function roleFactsFromRow(row){
  const roleType=String(row.querySelector('.ucvm-role-type')?.value||'Other').trim(),scope=String(row.querySelector('.ucvm-role-assignment')?.value||'').trim(),notes=String(row.querySelector('.ucvm-role-notes-input')?.value||'').trim(),assignmentFactId=String(row.dataset.assignmentId||'').trim();
  const facts={roleType,notes};if(assignmentFactId)facts.assignmentFactId=assignmentFactId;
  if(roleType==='VISC')facts.subjectKey=scope;else facts.courseCode=scope;
  return facts;
 }
 function roleRowHtml(r={},options={}){
  const legacy=options.legacy===true,server=options.server===true,typeValue=r.roleType||r.type||'Other',type=ROLE_TYPES.includes(typeValue)?typeValue:'Other',scope=r.assignment||r.courseCode||r.subjectKey||'',assignmentFactId=server?String(r.assignmentFactId||''):'',legacyDoe=num(r.doeCredit);
  if(legacy)return `<div class="ucvm-managed-role-row" data-legacy="1"><label><span class="form-label">Role type</span><input class="input" value="${esc(type)}" disabled></label><label><span class="form-label">Course / subject / scope</span><input class="input" value="${esc(scope)}" disabled></label><label><span class="form-label">Legacy DOE</span><input class="input" value="${legacyDoe===null?'—':pct(roleEffect(r))}" disabled></label><label class="ucvm-role-notes"><span class="form-label">Legacy note</span><input class="input" value="${esc(r.notes||'Historical managed role retained for migration')}" disabled></label><span class="source-pill source-manual">Legacy · read-only</span></div>`;
  const calculated=server&&legacyDoe!==null?`${pct(legacyDoe)} · ${esc(r.doeRuleKey||r.doeRuleId||'server rule')}`:'Calculated by DOE API';
  return `<div class="ucvm-managed-role-row" data-legacy="0" data-assignment-id="${esc(assignmentFactId)}" data-dirty="${server?'0':'1'}"><label><span class="form-label">Role type</span><select class="select ucvm-role-type">${ROLE_TYPES.map(x=>`<option ${x===type?'selected':''}>${esc(x)}</option>`).join('')}</select></label><label><span class="form-label">Course / subject / scope</span><input class="input ucvm-role-assignment" value="${esc(scope)}" placeholder="e.g., VTMD 204 or Anatomy"></label><label><span class="form-label">Calculated DOE</span><div class="input ucvm-role-calculated" aria-live="polite">${calculated}</div></label><label class="ucvm-role-notes"><span class="form-label">Notes</span><input class="input ucvm-role-notes-input" value="${esc(r.notes||r.facts?.notes||'')}" placeholder="Optional assignment note"></label><button type="button" class="btn btn-small btn-danger ucvm-role-remove">${server?'Deactivate':'Remove row'}</button>${server?'<span class="source-pill source-manual">Server · active</span>':''}</div>`;
 }
 async function previewRoleRow(row){
  if(row?.dataset?.legacy==='1')return;const output=row?.querySelector('.ucvm-role-calculated');if(!output)return;
  const facts=roleFactsFromRow(row),scope=facts.courseCode||facts.subjectKey;if(!scope){output.textContent='Enter course / subject';return}
  if(!window.UCVM_DOE_API?.isConfigured?.()){output.textContent='DOE API required';return}
  output.textContent='Calculating…';
  try{const result=await window.UCVM_DOE_API.previewAssignment(doeListAcademicYear(),facts);output.textContent=`${pct(result.resultDoe)} · ${result.reference?.section?`§${result.reference.section}`:'policy rule'}`}catch(error){output.textContent=error?.code==='COURSE_MAPPING_REQUIRED'||error?.code==='SUBJECT_MAPPING_REQUIRED'?'Needs mapping':(error?.message||'Needs Review')}
 }
 function wireRoleRows(section){
  if(!Array.isArray(section._removedRoleIds))section._removedRoleIds=[];
  section.querySelectorAll('.ucvm-role-remove').forEach(button=>{if(button.dataset.wired==='1')return;button.dataset.wired='1';button.onclick=()=>{const row=button.closest('.ucvm-managed-role-row'),id=String(row?.dataset?.assignmentId||'').trim();if(id&&!section._removedRoleIds.includes(id))section._removedRoleIds.push(id);row?.remove()}});
  section.querySelectorAll('.ucvm-managed-role-row[data-legacy="0"]').forEach(row=>{
   if(row.dataset.wired==='1')return;row.dataset.wired='1';
   const mark=()=>{row.dataset.dirty='1'};
   row.querySelector('.ucvm-role-type')?.addEventListener('change',()=>{mark();previewRoleRow(row)});
   const scope=row.querySelector('.ucvm-role-assignment');scope?.addEventListener('input',()=>{mark();clearTimeout(row._doeTimer);row._doeTimer=setTimeout(()=>previewRoleRow(row),250)});
   scope?.addEventListener('change',()=>{mark();previewRoleRow(row)});
   row.querySelector('.ucvm-role-notes-input')?.addEventListener('input',mark);
   if(row.dataset.dirty==='1')previewRoleRow(row);
  });
  const add=section.querySelector('#ucvm-add-managed-role');if(add&&add.dataset.wired!=='1'){add.dataset.wired='1';add.onclick=()=>{const box=section.querySelector('#ucvm-managed-role-rows');box.insertAdjacentHTML('beforeend',roleRowHtml({type:'Course Coordinator'}));wireRoleRows(section)}}
 }
 async function enhanceEditor(form){
  const id=String(form.elements?.namedItem('ucid')?.value||'').trim(),key=id||'__new__';if(form.dataset.ucvmDoeEnhanced===key&&form.querySelector('#ucvm-doe-role-section'))return;form.dataset.ucvmDoeEnhanced=key;const f=facultyById.get(id)||{},year=doeListAcademicYear();let override=window.UCVM_FACULTY_DOE.override(f),serverRoles=[];
  if(id&&apiDoeReady()){
   const [worksheetResult,rolesResult]=await Promise.allSettled([window.UCVM_DOE_API.getFacultyWorksheet(id,year),window.UCVM_DOE_API.listRoleAssignments(id,year)]);
   if(worksheetResult.status==='fulfilled'){const target=worksheetResult.value?.target||{};if(target.targetId||String(target.source||'').startsWith('legacy_'))override={value:num(target.overrideDoe),reason:String(target.overrideReason||''),notes:String(target.overrideNotes||'')}}
   else console.warn('DOE target lookup failed; using legacy migration fallback.',worksheetResult.reason);
   if(rolesResult.status==='fulfilled')serverRoles=Array.isArray(rolesResult.value)?rolesResult.value:[];else console.warn('DOE role assignment lookup failed.',rolesResult.reason);
  }
  form._ucvmDoeBeforeOverride=override.value===null?null:{year,value:override.value,reason:override.reason||'',notes:override.notes||''};
  form.querySelector('#ucvm-doe-role-section')?.remove();const sec=document.createElement('div');sec.id='ucvm-doe-role-section';sec.innerHTML=`<div class="form-section"><div class="form-section-title">DOE assignment facts · ${esc(year)}</div><div class="ucvm-role-help"><strong>Access role and DOE assignment are separate.</strong> Active server assignments can be edited or deactivated here. Saving an edit sends facts only; the DOE API re-matches the Active annual rule, recalculates DOE, and records new immutable evidence. Legacy ${YEAR} rows remain read-only migration evidence.</div><div id="ucvm-managed-role-rows">${serverRoles.map(r=>roleRowHtml(r,{server:true})).join('')}${managedRoles(f).map(r=>roleRowHtml(r,{legacy:true})).join('')}</div><button type="button" class="btn" id="ucvm-add-managed-role">+ Add DOE assignment</button></div><div class="form-section"><div class="form-section-title">Office DOE override · ${esc(year)}</div><div class="ucvm-role-help">Use an override only when the office approves a different annual teaching target, for example RSL, maternity leave, sick leave or a special event. Contract DOE is read from the Faculty record on the server; the approved override is stored in the canonical annual target and used by Lookup and DOE List immediately.</div><div class="ucvm-override-grid"><label class="form-field"><span class="form-label">Override DOE %</span><input class="input" id="ucvm-override-doe" type="number" min="0" step="0.01" value="${override.value===null?'':esc(override.value)}" placeholder="Leave blank for none"></label><label class="form-field"><span class="form-label">Reason</span><select class="select" id="ucvm-override-reason">${OVERRIDE_REASONS.map(x=>`<option value="${esc(x)}" ${override.reason===x?'selected':''}>${esc(x||'Select reason')}</option>`).join('')}</select></label><label class="form-field"><span class="form-label">Special notes</span><input class="input" id="ucvm-override-notes" value="${esc(override.notes||'')}" placeholder="RSL dates, leave context, special event, approval note…"></label></div></div>`;form.appendChild(sec);wireRoleRows(sec);
 }
 function readEditorExtras(form){const section=form.querySelector('#ucvm-doe-role-section'),roles=[...form.querySelectorAll('.ucvm-managed-role-row[data-legacy="0"][data-dirty="1"]')].map(roleFactsFromRow).filter(r=>r.courseCode||r.subjectKey),removedRoleIds=[...(section?._removedRoleIds||[])];const ov=num($('ucvm-override-doe')?.value),reason=String($('ucvm-override-reason')?.value||''),notes=String($('ucvm-override-notes')?.value||'').trim(),year=doeListAcademicYear();return{roles,removedRoleIds,override:ov===null?null:{year,value:ov,reason,notes}}}
 function waitForEditorSave(p){let n=0;const timer=setInterval(async()=>{n++;const modal=$('edit-modal'),closed=modal?.classList.contains('hidden');if(closed){clearInterval(timer);try{await saveExtras(p)}catch(e){console.error(e);const t=$('toast');if(t){t.textContent='Faculty saved, but DOE assignment/override update failed: '+e.message;t.classList.add('show','error')}}}else if(n>=40){clearInterval(timer)}},250)}
 async function saveExtras(p){
  const u=auth.currentUser;if(!u||!p?.id)return;const roles=p.after.roles||[],removedRoleIds=p.after.removedRoleIds||[],beforeOverride=p.before.override||null,afterOverride=p.after.override||null,overrideChanged=JSON.stringify(beforeOverride)!==JSON.stringify(afterOverride);
  if(roles.length||removedRoleIds.length||overrideChanged){if(!window.UCVM_DOE_API?.isConfigured?.())throw Error('DOE API is required to save DOE assignments or targets.')}
  for(const assignmentFactId of removedRoleIds)await window.UCVM_DOE_API.deactivateRoleAssignment(assignmentFactId);
  for(const facts of roles)await window.UCVM_DOE_API.saveRoleAssignment({academicYear:doeListAcademicYear(),facultyId:p.id,facts});
  if(overrideChanged)await window.UCVM_DOE_API.saveFacultyTarget(p.id,doeListAcademicYear(),afterOverride?{value:afterOverride.value,reason:afterOverride.reason,notes:afterOverride.notes}:null);
  if(roles.length||removedRoleIds.length||overrideChanged){serverDoeLoaded=false;const refresh=window.UCVM_ADMIN_DATA?.refreshDoeFaculty;if(typeof refresh==='function')await refresh(p.id);else await loadDoeList({force:true})}
 }

 function appendManagedRoleRows(){
  const body=$('roles-body'),filter=$('role-type-filter');if(!body)return;body.querySelectorAll('tr[data-ucvm-managed-role]').forEach(r=>r.remove());
  const currentTypes=serverDoeRows.flatMap(row=>(row.roleAssignments||[]).map(r=>r.roleType).filter(Boolean));
  const legacyTypes=faculty.flatMap(f=>managedRoles(f).map(r=>r.type)).filter(Boolean);
  const types=[...new Set([...currentTypes,...legacyTypes])].sort();
  if(filter)types.forEach(t=>{if(![...filter.options].some(o=>o.value===t)){const o=document.createElement('option');o.value=t;o.textContent=t;filter.appendChild(o)}});
  const q=norm($('roles-search')?.value),type=filter?.value||'',currentRows=[],legacyRows=[];
  for(const summaryRow of serverDoeRows){
   const f=facultyById.get(String(summaryRow.facultyId||''))||{__id:String(summaryRow.facultyId||''),preferredFullName:summaryRow.displayName||summaryRow.facultyId};
   for(const r of summaryRow.roleAssignments||[]){
    const assignment=r.courseCode||r.subjectKey||'',blob=norm(`${facultyName(f)} ${r.roleType} ${assignment} ${r.ruleKey}`);
    if((!q||blob.includes(q))&&(!type||r.roleType===type))currentRows.push({f,r,assignment});
   }
  }
  for(const f of faculty)for(const r of managedRoles(f)){
   const blob=norm(`${facultyName(f)} ${r.type} ${r.assignment} ${r.notes}`);
   if((!q||blob.includes(q))&&(!type||r.type===type))legacyRows.push({f,r});
  }
  currentRows.forEach(({f,r,assignment})=>{
   const tr=document.createElement('tr');tr.dataset.ucvmManagedRole='1';tr.dataset.source='server';
   const doe=num(r.resultDoe),status=String(r.status||'').toLowerCase(),credit=doe===null||['needs_review','error'].includes(status)?'<span class="doe-status-pill needs_review">Needs Review</span>':`<strong>${pct(doe)}</strong>`;
   const ref=r.reference?window.UCVM_DOE_WORKSHEET_VIEW.referenceText(r.reference):'';
   tr.innerHTML=`<td><strong>${esc(facultyName(f))}</strong></td><td><span class="role-chip">${esc(r.roleType||'Role')}</span><span class="ucvm-managed-source">Current server</span></td><td>${esc(assignment||'—')}</td><td>Authoritative assignment</td><td>${credit}</td><td>${esc(r.ruleKey||r.ruleId||'Needs Review')}${ref?`<div class="muted">${esc(ref)}</div>`:''}</td><td>${esc(r.assignmentFactId||'—')}</td>`;body.appendChild(tr);
  });
  legacyRows.forEach(({f,r})=>{
   const tr=document.createElement('tr');tr.dataset.ucvmManagedRole='1';tr.dataset.source='legacy';const effect=roleEffect(r);
   tr.innerHTML=`<td><strong>${esc(facultyName(f))}</strong></td><td><span class="role-chip">${esc(r.type)}</span><span class="ucvm-managed-source">Legacy</span></td><td>${esc(r.assignment||'—')}</td><td>${esc(r.action==='remove'?'Approved removal':'Migration evidence')}</td><td><span class="muted">Historical ${effect>=0?'+':''}${pct(effect)}</span></td><td>Legacy ${YEAR} migration evidence · not current DOE authority</td><td>${esc(r.notes||'—')}</td>`;body.appendChild(tr);
  });
 }
 function queueManagedRoles(){if(roleAppendQueued)return;roleAppendQueued=true;requestAnimationFrame(()=>{roleAppendQueued=false;appendManagedRoleRows()})}
 function scheduleRoleAppend(delay=220){setTimeout(queueManagedRoles,Math.max(0,Number(delay)||0))}

 function subscribe(){
  if(facultyUnsub)facultyUnsub();if(sessionUnsub)sessionUnsub();
  const syncFaculty=()=>{faculty=(window.UCVM_ADMIN_DATA?.faculty?.()||[]).sort((a,b)=>facultyName(a).localeCompare(facultyName(b)));facultyById=new Map(faculty.map(f=>[String(f.__id),f]));updateDoeFilters();if(doeDataReady())loadDoeList().catch(error=>console.error(error));renderDoeList();renderReconciliation();queueManagedRoles()};
  const syncSessions=()=>{sessions=window.UCVM_ADMIN_DATA?.sessions?.()||[];renderDoeList();renderReconciliation()};
  const syncDoe=()=>{const snapshot=window.UCVM_ADMIN_DATA?.doeList?.();if(snapshot){serverDoeRows=Array.isArray(snapshot.rows)?snapshot.rows:[];serverDoeYear=snapshot.academicYear||'';serverDoeLoaded=Boolean(snapshot.loaded);serverDoeError=snapshot.error||'';renderDoeList();renderReconciliation();queueManagedRoles()}};
  window.addEventListener('ucvm:admin-faculty-updated',syncFaculty);window.addEventListener('ucvm:admin-sessions-updated',syncSessions);window.addEventListener('ucvm:admin-doe-list-updated',syncDoe);
  facultyUnsub=()=>{window.removeEventListener('ucvm:admin-faculty-updated',syncFaculty);window.removeEventListener('ucvm:admin-doe-list-updated',syncDoe)};sessionUnsub=()=>window.removeEventListener('ucvm:admin-sessions-updated',syncSessions);syncFaculty();syncSessions();syncDoe()
 }
 function watchDom(){
  const inspect=()=>{ensureDoeView();ensureReconciliationView();renameDashboard();const form=$('edit-form');if(form&&form.children.length&&form.elements?.namedItem('ucid'))enhanceEditor(form)};inspect();
  new MutationObserver(inspect).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('submit',ev=>{const form=ev.target;if(form?.id!=='edit-form'||!form.querySelector('#ucvm-doe-role-section'))return;const id=String(form.elements.namedItem('ucid')?.value||'').trim(),f=facultyById.get(id)||{},after=readEditorExtras(form);pendingExtra={id,name:String(form.elements.namedItem('preferredFullName')?.value||facultyName(f)||id),before:{roles:managedRoles(f),override:form._ucvmDoeBeforeOverride??null},after};waitForEditorSave(pendingExtra)},true)
 }
 installStyles();watchDom();$('roles-search')?.addEventListener('input',()=>scheduleRoleAppend(220));$('role-type-filter')?.addEventListener('change',()=>scheduleRoleAppend(30));$('doe-policy-year')?.addEventListener('change',()=>{serverDoeLoaded=false;serverDoeRows=[];serverDoeError='';if(doeDataReady())loadDoeList({force:true}).catch(error=>console.error(error));renderReconciliation()});
 const startFromPage=()=>{const sharedProfile=window.UCVM_ADMIN_DATA?.profile?.();if(!sharedProfile||sharedProfile.active!==true||!UCVM.admin(sharedProfile))return false;profile=sharedProfile;subscribe();return true};
 auth.onAuthStateChanged(u=>{user=u;profile=null;if(facultyUnsub)facultyUnsub();if(sessionUnsub)sessionUnsub();facultyUnsub=sessionUnsub=null;if(!u)return;if(!startFromPage())window.addEventListener('ucvm:admin-ready',startFromPage,{once:true})});
})();