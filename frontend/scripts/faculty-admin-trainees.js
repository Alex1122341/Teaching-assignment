(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PAWS_TRAINEES=api;})(typeof window==='undefined'?globalThis:window,function(root){
 'use strict';
 const CATEGORIES=['undergrad','vetm506','preceptor','im','grad_primary','grad_cosupervised','postdoc'];
 const LABELS=['Undergraduate','VETM 506','Fourth-year preceptor','IM','Graduate primary','Graduate co-supervisor','Postdoc'];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const showFaculty=value=>root?.PAWS_FACULTY_NAME?.format?.(value)||String(value||'');
 const value=v=>v===null||v===undefined?'Not provided':esc(v);
 const doe=v=>v===null||v===undefined?'Not provided':Number.isFinite(Number(v))?esc(Number(v).toLocaleString('en-CA',{maximumFractionDigits:4}))+'%':'Not provided';
 const stamp=user=>JSON.stringify(user?{uid:user.uid,role:user.role,facultyId:user.facultyId}:null);
 function defaultYear(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));const start=Number(parts.year)-(parts.month<'05'?1:0);return `${start}-${String((start+1)%100).padStart(2,'0')}`;}
 function createController({api,getAcademicYear,getUser,onState=()=>{},download=()=>{},onClear=()=>{}}){
  let generation=0,dead=false,current={rows:[],summary:null,total:0,nextCursor:null,busy:false,canExport:false,coverage:[],message:''},filters={},observedYear=getAcademicYear();
  const emit=()=>onState({...current});
  const reset=()=>{current={rows:[],summary:null,total:0,nextCursor:null,busy:false,canExport:false,coverage:[],message:''};};
  async function load(more=false,input={}){
   if(dead||!getUser()?.uid||more&&(current.busy||!current.nextCursor))return;
   const id=++generation,identity=stamp(getUser());
   if(!more){const external=getAcademicYear(),changed=external!==observedYear;observedYear=external;filters={academicYear:input.academicYear||(changed?external:null)||filters.academicYear||external||defaultYear(),query:String(input.query??filters.query??'').trim(),category:input.category===undefined?filters.category||null:input.category||null};reset();}
   current={...current,academicYear:filters.academicYear,busy:true,canExport:false,message:'Loading trainee evidence…'};emit();
   try{
    const result=await api.dashboardTrainees({...filters,limit:25,...(more?{cursor:current.nextCursor}:{})});
    if(dead||id!==generation||identity!==stamp(getUser()))return;
    if(result.academicYear!==filters.academicYear||!Array.isArray(result.rows))throw Error('Refresh to load the selected academic year.');
    const rows=more?[...current.rows,...result.rows]:result.rows,seen=new Set();
    current={...result,rows:rows.filter(row=>!seen.has(row.facultyId)&&seen.add(row.facultyId)),busy:false,canExport:true,message:''};
    current.message=`${current.rows.length} of ${current.total} faculty records · ${filters.academicYear}`;emit();
   }catch(error){if(dead||id!==generation||identity!==stamp(getUser()))return;reset();current.message=error?.code==='TRAINEE_CURSOR_CONFLICT'?'Results changed. Search again to refresh.':'Trainee evidence could not be loaded. Search again to retry.';emit();}
  }
  function clear(){++generation;reset();onClear();emit();}
  return {state:()=>({...current}),refresh:input=>load(false,input),more:()=>load(true),dirty(){++generation;current={...current,busy:false,canExport:false,nextCursor:null,message:'Search to apply the changed filters.'};emit();},
   async export(){if(dead||!current.canExport||current.busy)return;const id=generation,identity=stamp(getUser());current={...current,busy:true};emit();try{const file=await api.exportDashboardTrainees({...filters});if(!dead&&id===generation&&identity===stamp(getUser()))download({...file,academicYear:filters.academicYear});}catch(_){if(id===generation){current.message='Download failed. Search again to retry.';current.canExport=false;}}finally{if(!dead&&id===generation){current.busy=false;emit();}}},
   clear,destroy(){clear();dead=true;}
  };
 }
 function renderRows(rows){
  return rows.map(r=>`<tr><th scope="row">${esc(showFaculty(r.displayName))}</th>${CATEGORIES.map((_,i)=>`<td>${value(r.rawCounts?.[i])}</td>`).join('')}<td>${value(r.supervisionAssignments??r.rawCounts?.reduce((a,n)=>a+(n??0),0))}</td><td>${doe(r.sourceDoe)}</td><td>${doe(r.currentRawDoe)}</td><td>${doe(r.currentAppliedDoe)}</td><td><span class="trainee-status">${esc(String(r.sourceStatus||'not_provided').replaceAll('_',' '))}</span></td><td>${r.privateNotes&&Object.keys(r.privateNotes).length?`<details><summary>Notes &amp; source</summary><dl>${Object.entries(r.privateNotes).map(([key,note])=>`<dt>${esc(key)}</dt><dd>${esc(note)}</dd>`).join('')}</dl><small>${r.sourceRef?esc(`${r.sourceRef.sheet}!${r.sourceRef.column}${r.sourceRef.row}`):'Source cell not provided'}</small></details>`:'Not provided'}</td></tr>`).join('')||'<tr><td colspan="14" class="trainee-empty">No permitted trainee records match these filters.</td></tr>';
 }
 function renderSummary(s,administrator=false){
  if(!s)return '';
  const cards=[['Known supervision assignments',value(s.supervisionAssignments)],...(administrator?[['Faculty with trainees',value(s.facultyWithTrainees)]]:[]),['Source / DOE issues',value(s.sourceIssues)],['Current raw supervision DOE',doe(s.rawSupervisionDoe)],['Current applied supervision DOE',doe(s.appliedSupervisionDoe)]];
  return `<div class="trainee-stats">${cards.map(([label,n])=>`<div><span>${label}</span><strong>${n}</strong></div>`).join('')}</div><dl class="trainee-categories">${CATEGORIES.map((key,i)=>`<div><dt>${LABELS[i]}</dt><dd>${value(s.categories?.[key])}</dd></div>`).join('')}</dl><p class="trainee-caption">Supervision assignments, not unique student headcount. ${value(s.missingCountCells)} source count cells unavailable. Blanks and previous-source records remain visible; known totals may be partial.</p>`;
 }
 function mount(host,{api=root.UCVM_PAWS_DATA,getAcademicYear=defaultYear,getUser=()=>null,isAdministrator=user=>root.UCVM?.admin?.(user)===true,onAcademicYearChange=()=>{}}={}){
  if(!host)throw Error('Trainee container required.');
  let attached=false,dead=false;const urls=new Set();
  const revoke=()=>{for(const url of urls)root.URL.revokeObjectURL(url);urls.clear();};
  const find=s=>host.querySelector(s);
  function download(file){
   if(file.contentType!=='text/csv; charset=utf-8'||!(file.bytes instanceof Uint8Array)||file.bytes.length>8388608)throw Error('Invalid trainee download.');
   const url=root.URL.createObjectURL(new root.Blob([file.bytes],{type:file.contentType}));urls.add(url);const a=root.document.createElement('a');a.href=url;a.download=`trainees-${file.academicYear}.csv`;root.document.body.appendChild(a);a.click();a.remove();root.setTimeout(()=>{root.URL.revokeObjectURL(url);urls.delete(url);},1000);
  }
  const controller=createController({api,getAcademicYear,getUser,download,onClear:revoke,onState:state=>{
   if(!attached)return;find('[data-trainee-status]').textContent=state.message;find('[data-trainee-stats]').innerHTML=renderSummary(state.summary,isAdministrator(getUser()));find('[data-trainee-rows]').innerHTML=renderRows(state.rows);
   find('[data-trainee-more]').disabled=state.busy||!state.nextCursor;find('[data-trainee-download]').disabled=state.busy||!state.canExport;find('[data-trainee-search]').disabled=state.busy;
   find('[data-trainee-coverage]').innerHTML=(state.coverage||[]).map(s=>`<li>${esc(s)}</li>`).join('');
  }});
  function attach(){
   if(attached||dead)return;attached=true;const year=getAcademicYear()||defaultYear(),start=Number(year.slice(0,4)),years=Array.from({length:5},(_,i)=>`${start+i-2}-${String((start+i-1)%100).padStart(2,'0')}`);
   host.innerHTML=`<section class="paws-trainees" aria-label="Annual trainees and supervision"><header class="trainee-heading"><div><h2>Trainees &amp; supervision</h2><p>Annual source evidence, supervision assignments and recorded DOE.</p></div><button class="btn" data-trainee-download type="button" disabled>Download filtered CSV</button></header>
    <form class="trainee-filters"><label class="trainee-search">Search faculty or source notes<input class="input" data-trainee-query type="search" maxlength="200" placeholder="Search keywords…"></label><label>Academic year<select class="select" data-trainee-year>${years.map(y=>`<option${y===year?' selected':''}>${esc(y)}</option>`).join('')}</select></label><label>Supervision category<select class="select" data-trainee-category><option value="">All categories</option>${CATEGORIES.map((c,i)=>`<option value="${c}">${LABELS[i]}</option>`).join('')}</select></label><button class="btn btn-primary" data-trainee-search type="submit">Search</button><button class="btn" data-trainee-reset type="button">Reset</button></form>
    <div data-trainee-stats></div><p class="trainee-caption" data-trainee-status role="status" aria-live="polite"></p><details class="trainee-coverage"><summary>Source coverage &amp; DOE</summary><ul data-trainee-coverage></ul><p>Source DOE is shown separately from current recorded raw and applied DOE. Missing source values and differences do not overwrite recorded allocations. Working-session notes do not add to these counts.</p></details>
    <div class="trainee-table-scroll" role="region" tabindex="0" aria-label="Trainee evidence table"><table><thead><tr>${['Faculty',...LABELS,'Known assignments','Source DOE','Current raw DOE','Current applied DOE','Source status','Notes'].map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody data-trainee-rows></tbody></table></div><footer class="trainee-paging"><span>25 records per page · download includes every matching permitted record.</span><button class="btn" data-trainee-more type="button" disabled>Load more</button></footer></section>`;
   const filters=()=>({academicYear:find('[data-trainee-year]').value,query:find('[data-trainee-query]').value,category:find('[data-trainee-category]').value||null});
   find('[data-trainee-year]').value=year;
   find('form').addEventListener('submit',e=>{e.preventDefault();controller.refresh(filters());});
   for(const selector of ['[data-trainee-query]','[data-trainee-category]'])find(selector).addEventListener('input',()=>controller.dirty());
   find('[data-trainee-category]').addEventListener('change',()=>controller.refresh(filters()));find('[data-trainee-year]').addEventListener('change',()=>{revoke();onAcademicYearChange(find('[data-trainee-year]').value);controller.refresh(filters());});
   find('[data-trainee-reset]').addEventListener('click',()=>{find('[data-trainee-query]').value='';find('[data-trainee-category]').value='';controller.refresh(filters());});
   find('[data-trainee-more]').addEventListener('click',()=>controller.more());find('[data-trainee-download]').addEventListener('click',()=>controller.export());
  }
  const clear=()=>{controller.clear();attached=false;host.innerHTML='';};
  const profileChanged=()=>clear();root.addEventListener?.('paws-profile',profileChanged);
  const auth=root.firebase?.auth?.();let uid=auth?.currentUser?.uid;const detach=auth?.onAuthStateChanged?.(user=>{if(user?.uid!==uid){uid=user?.uid;clear();}});
  const refresh=()=>{if(dead)return;attach();return controller.refresh();};refresh();
  return {refresh,clear,destroy(){clear();dead=true;controller.destroy();root.removeEventListener?.('paws-profile',profileChanged);if(typeof detach==='function')detach();}};
 }
 return {CATEGORIES,LABELS,createController,renderRows,renderSummary,mount};
});
