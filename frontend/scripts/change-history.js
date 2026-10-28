(function(root,factory){
 'use strict';
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PAWS_CHANGE_HISTORY=api;
})(typeof window==='undefined'?globalThis:window,function(root){
 'use strict';
 const names=typeof module==='object'&&module.exports?require('./faculty-name'):root.PAWS_FACULTY_NAME;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const missing=value=>value===null||value===undefined||value===''||value==='Not recorded'||value==='—'?'N/A':String(value);
 function createHistoryController({api,scope,onState=()=>{},download=()=>{}}){
  let sequence=0,destroyed=false;
  const countName=scope==='dashboard'?'operations':'change rows';
  let state={rows:[],snapshot:null,total:0,offset:0,pageSize:100,busy:false,dirty:true,facets:{},coverage:[],message:'Apply filters to load recorded SQL history.'};
  const view=()=>({...state,canExport:Boolean(!destroyed&&!state.busy&&!state.dirty&&state.snapshot)});
  const emit=()=>onState(view());
  const update=patch=>{state={...state,...patch};emit();};
  const failed=error=>update({busy:false,snapshot:null,rows:[],total:0,dirty:true,message:error?.message||'Could not load history. Apply filters to retry.'});
  return Object.freeze({
   state:view,
   dirty(){if(destroyed)return;sequence++;update({dirty:true,busy:false,snapshot:null,message:'Filters changed. Apply filters before downloading.'});},
   async refresh(filters={}){
    if(destroyed)return;const version=++sequence;
    update({busy:true,dirty:true,rows:[],snapshot:null,total:0,message:'Loading recorded history…'});
    try{const result=await api.changeHistory({...filters,scope});if(destroyed||version!==sequence)return;
     update({...result,busy:false,dirty:false,message:result.total?`${result.total} filtered ${countName} · downloads include all ${countName}.`:'No recorded changes match these filters.'});
    }catch(error){if(!destroyed&&version===sequence)failed(error);}
   },
   async page(offset){
    if(!view().canExport)return;const version=++sequence,snapshot=state.snapshot;
    update({busy:true,message:'Loading page…'});
    try{const result=await api.changeHistoryPage(snapshot,offset);if(destroyed||version!==sequence)return;
     update({...result,busy:false,message:`${result.total} filtered ${countName} · downloads include all ${countName}.`});
    }catch(error){if(!destroyed&&version===sequence)failed(error);}
   },
   async export(format){
    if(!view().canExport)return;const version=++sequence,snapshot=state.snapshot;
    update({busy:true,message:'Preparing all filtered rows…'});
    try{const file=await api.changeHistoryExport(snapshot,format);if(destroyed||version!==sequence)return;
     await download(file,format);if(destroyed||version!==sequence)return;
     update({busy:false,message:`Downloaded ${file.rowCount} filtered ${countName}.`});
    }catch(error){if(!destroyed&&version===sequence){
     // These export-only rejections leave the authorized browsing snapshot valid.
     // Auth, scope, expiry and unknown failures retain the fail-closed path.
     if((error?.code==='HISTORY_LIMIT'&&error.status===413)||(error?.code==='HISTORY_EXPORT_BUSY'&&error.status===429))update({busy:false,message:error.message});
     else failed(error);
    }}
   },
   clear(message='History cleared. Apply filters to refresh.'){
    sequence++;state={rows:[],snapshot:null,total:0,offset:0,pageSize:100,busy:false,dirty:true,facets:{},coverage:[],message};emit();
   },
   destroy(){sequence++;destroyed=true;state={...state,rows:[],snapshot:null,total:0,busy:false,dirty:true};emit();}
  });
 }
 function valueCell(value){
  const text=missing(value);
  return text.length>24||/[\r\n]/.test(text)?`<details class="history-value"><summary><span class="history-preview">${esc(text.slice(0,100))}${text.length>100?'…':''}</span><span class="history-expand-label">Full value</span></summary><pre>${esc(text)}</pre></details>`:esc(text);
 }
 function renderRows(rows){
  return rows.map(row=>{
   const date=new Date(row.changeDate),valid=Number.isFinite(date.getTime());
   const when=valid?`<time datetime="${esc(date.toISOString())}" title="${esc(date.toISOString())} UTC">${esc(date.toLocaleString('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}))}</time><small>Calgary</small>`:'N/A';
   const endpoint=end=>{const d=row[end?'endDate':'startDate'],t=row[end?'endTime':'startTime'];return d?`${esc(d)}${t?' '+esc(t):''}`:'N/A';};
   const label=String(row.changeType||'N/A').replaceAll('_',' ');
   return `<tr><td>${when}</td><td><span>${esc(label)}</span><small>${esc(missing(row.domain))}</small></td><td>${row.course?`<strong>${esc(row.course)}</strong> · `:''}${valueCell(row.session||names.formatList(row.affectedFaculty))}${row.session&&row.affectedFaculty?`<small>${valueCell(names.formatList(row.affectedFaculty))}</small>`:''}</td><td class="history-change"><strong class="history-field">${esc(missing(row.field))}</strong><div class="history-from-to"><span><span class="history-value-label">From </span>${valueCell(row.previousValue)}</span><span aria-hidden="true"> → </span><span><span class="history-value-label">To </span>${valueCell(row.updatedValue)}</span></div></td><td><span class="history-date-range">${endpoint(false)}<br>${endpoint(true)}</span></td><td>${valueCell(names.format(row.actor))}</td></tr>`;
  }).join('')||'<tr><td colspan="6">No recorded changes to display.</td></tr>';
 }

 function renderOperationRows(rows){
  return rows.map(operation=>{
   const date=new Date(operation.changeDate),valid=Number.isFinite(date.getTime());
   const timestamp=valid?esc(date.toISOString()):'';
   const local=valid?esc(date.toLocaleString('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})):'';
   const when=valid?'<time datetime="'+timestamp+'" title="'+timestamp+' UTC">'+local+'</time><small>Calgary</small>':'N/A';
   const records=Array.isArray(operation.records)?operation.records:[];
   const changeCount=Number.isSafeInteger(operation.changeCount)?operation.changeCount:0;
   const recordCount=Number.isSafeInteger(operation.recordCount)?operation.recordCount:records.length;
   const dates=[operation.startDate,operation.endDate].filter(Boolean).map(esc);
   const range=dates.length===2?dates.join(' → '):dates[0]||'N/A';
   const details=records.map((record,i)=>{
    const fields=Array.isArray(record.changes)?record.changes:[];
    const fieldRows=fields.map(change=>'<tr><td>'+esc(missing(change.field))+'</td><td>'+valueCell(change.previousValue)+'</td><td>'+valueCell(change.updatedValue)+'</td></tr>').join('');
    const subject=[record.course,record.session].filter(Boolean).map(esc).join(' · ');
    const recordDates=[record.startDate,record.endDate].filter(Boolean).map(esc).join(' → ');
    return '<section class="history-operation-record"><h4>Record '+(i+1)+' of '+records.length+(record.affectedFaculty?' · '+esc(names.formatList(record.affectedFaculty)):'')+'</h4>'+
      (subject?'<p>'+subject+'</p>':'')+(recordDates?'<p>'+recordDates+'</p>':'')+
      '<table class="history-details-table"><thead><tr><th scope="col">Field</th><th scope="col">From</th><th scope="col">To</th></tr></thead><tbody>'+fieldRows+'</tbody></table></section>';
   }).join('');
   return '<tr class="history-operation-row"><td colspan="6" class="history-operation-cell"><details class="history-operation-group">'+
    '<summary class="history-operation-summary"><span>'+when+'</span><span><strong>'+esc(missing(operation.title||operation.changeType))+
    '</strong><small>'+esc(missing(operation.domain))+'</small></span><span>'+recordCount+' record'+(recordCount===1?'':'s')+
    '</span><span>'+changeCount+' field change'+(changeCount===1?'':'s')+' <small class="history-expand-prompt">View details</small></span><span class="history-date-range">'+range+
    '</span><span>'+esc(missing(names.format(operation.actor)))+'</span></summary><div class="history-operation-details">'+details+'</div></details></td></tr>';
  }).join('')||'<tr><td colspan="6">No recorded operations to display.</td></tr>';
 }
 function browserDownload(file,format){
  const types={csv:'text/csv; charset=utf-8',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  if(file.contentType!==types[format]||typeof file.fileBase64!=='string'||file.fileBase64.length>8388608)throw Error('The history download could not be validated. Refresh and retry.');
  const raw=root.atob(file.fileBase64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(bytes.length>6291456)throw Error('Narrow the filters before exporting.');
  const url=root.URL.createObjectURL(new root.Blob([bytes],{type:types[format]}));
  const link=root.document.createElement('a');link.href=url;link.download='paws-change-history.'+format;
  root.document.body.appendChild(link);link.click();link.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
 }
 function mount(host,{api=root.UCVM_PAWS_DATA,scope='mine',academicYear=null}={}){
  if(!host)throw Error('A history container is required.');
  const title={mine:'My Change History',timetable:'Calendar Changes',dashboard:'Dashboard History'}[scope];
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit'}).formatToParts(new Date()),parts=Object.fromEntries(local.map(p=>[p.type,p.value])),yearStart=Number(parts.year)-(parts.month<'05'?1:0);
  const defaultYear=scope==='dashboard'?'all':/^\d{4}-\d{2}$/.test(academicYear||'')?academicYear:`${yearStart}-${String((yearStart+1)%100).padStart(2,'0')}`;
  const field=(key,label,type='search',value='')=>`<label>${label}<input data-history-filter="${key}" type="${type}" value="${esc(value)}" maxlength="256"></label>`;
  host.innerHTML=`<section class="paws-change-history" aria-label="${title}"><div class="history-heading"><h3>${title}</h3><p>${scope==='timetable'?'Recorded teaching changes across the authorized timetable. Private AFC and DOE values are excluded.':scope==='mine'?'Changes affecting your teaching and working schedule, including changes made by others.':'Recorded Lookup, AFC and DOE Rule Book changes within your permissions.'}</p>${scope==='dashboard'?'<p class="history-reset-note" data-history-archive-note hidden></p>':''}</div>
   <form class="history-filters"><div class="history-search-row">${field('keyword','Search history (course, faculty, change, name…)')}<label>Academic year<select data-history-filter="academicYear"><option value="${esc(defaultYear)}">${esc(defaultYear==='all'?'All recorded years':defaultYear)}</option></select></label><div class="history-filter-actions"><button type="submit" data-history-apply>Search</button><button type="button" data-history-reset>Reset</button></div></div><details class="history-advanced"><summary>More filters</summary><div class="history-advanced-grid">${field('course','Course number')}${field('topic','Topic')}<label>VISC subject<select data-history-filter="viscSubject"><option value="">All recorded subjects</option><option value="__not_recorded__">Not recorded</option></select></label>
   <label>Faculty<select data-history-filter="faculty"><option value="">All recorded faculty</option></select></label>
   ${field('start','Changed on/after (UTC)','date')}${field('end','Changed before (UTC)','date')}
   <label>Change type<select data-history-filter="changeType"><option value="">All change types</option></select></label>
   <label>Domain<select data-history-filter="domain"><option value="">All permitted domains</option>${(scope==='dashboard'?['Lookup','AFC','DOE Rule Book','Working schedule']:scope==='mine'?['Teaching','Working schedule']:['Teaching']).map(v=>`<option>${v}</option>`).join('')}</select></label>
   </div></details></form>
   <div class="history-toolbar"><p data-history-status role="status" aria-live="polite"></p><div><button type="button" data-history-export="csv" disabled>Download CSV</button><button type="button" data-history-export="xlsx" disabled>Download Excel</button></div></div>
   <details class="history-coverage"><summary>History coverage and privacy</summary><ul data-history-coverage></ul><p>Search covers permitted changes in the selected academic year, or all years for Dashboard History. N/A means the source did not record a value. Expand a long value to read it in full.</p></details>
   <div class="history-table-scroll" tabindex="0" role="region" aria-label="Filtered change history table"><table><thead><tr>${(scope==='dashboard'?['Time','Operation / Domain','Affected records','Changes','Start / End','By whom']:['Time','Type / Domain','Session / Faculty','Change · From → To','Start / End','By whom']).map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody data-history-rows></tbody></table></div>
   <div class="history-paging"><button type="button" data-history-prev disabled>Previous</button><span data-history-page></span><button type="button" data-history-next disabled>Next</button></div></section>`;
  const find=selector=>host.querySelector(selector),form=find('form'),inputs=[...host.querySelectorAll('[data-history-filter]')];
  const filters=()=>Object.fromEntries(inputs.filter(input=>input.value).map(input=>[input.dataset.historyFilter,input.value]));
  let previousFacets=null;
  function options(key,rows){
   const select=find(`[data-history-filter="${key}"]`),selected=select.value,selectedName=select.selectedOptions[0]?.textContent||selected;
   const first={faculty:'All recorded faculty',changeType:'All change types',academicYear:'All recorded years',viscSubject:'All recorded subjects'}[key];
   select.innerHTML=(key==='academicYear'?(scope==='dashboard'?'<option value="all">All recorded years</option>':''):`<option value="">${first}</option>`)+rows.map(row=>`<option value="${esc(row.key)}">${esc(key==='faculty'?names.format(row.name):row.name)}</option>`).join('');
   // Preserve a selected filter even if its new result set is empty.
   if(selected&&!rows.some(row=>row.key===selected))select.insertAdjacentHTML('beforeend',`<option value="${esc(selected)}">${esc(selectedName)}</option>`);
   select.value=selected||(key==='academicYear'?defaultYear:'');
  }
  function render(state){
   if(scope==='dashboard'){
    const notice=find('[data-history-archive-note]');
    const first=typeof state.historyArchiveStartUtc==='string'&&Number.isFinite(Date.parse(state.historyArchiveStartUtc))?state.historyArchiveStartUtc:null;
    notice.hidden=!first;
    notice.textContent=first?'Historical operations restored since '+new Date(first).toLocaleDateString('en-CA',{timeZone:'UTC',year:'numeric',month:'short',day:'2-digit'})+' (UTC), grouped by recorded submission. All original SQL audits are preserved.':'';
   }
   find('[data-history-status]').textContent=state.message;
   find('[data-history-rows]').innerHTML=scope==='dashboard'?renderOperationRows(state.rows):renderRows(state.rows);
   host.querySelectorAll('[data-history-export]').forEach(button=>button.disabled=!state.canExport);
   find('[data-history-apply]').disabled=state.busy;
   find('[data-history-prev]').disabled=!state.canExport||state.offset===0;
   find('[data-history-next]').disabled=!state.canExport||state.offset+state.pageSize>=state.total;
   find('[data-history-page]').textContent=state.total?`${state.offset+1}–${Math.min(state.offset+state.pageSize,state.total)} of ${state.total}`:'0 rows';
   find('[data-history-coverage]').innerHTML=state.coverage.map(value=>`<li>${esc(value)}</li>`).join('');
   if(state.facets!==previousFacets){
    previousFacets=state.facets;options('faculty',state.facets.faculties||[]);
    options('viscSubject',[{key:'__not_recorded__',name:'Not recorded'},...(state.facets.viscSubjects||[]).map(value=>({key:value,name:value}))]);
    options('changeType',(state.facets.changeTypes||[]).map(value=>({key:value,name:value})));
    options('academicYear',[...new Set([defaultYear,...(state.facets.academicYears||[])])].sort().map(value=>({key:value,name:value})));
   }
  }
  const controller=createHistoryController({api,scope,onState:render,download:browserDownload});
  form.addEventListener('submit',event=>{event.preventDefault();controller.refresh(filters());});
  for(const input of inputs){input.addEventListener('input',()=>controller.dirty());input.addEventListener('change',()=>controller.dirty());}
  find('[data-history-reset]').addEventListener('click',()=>{form.reset();find('[data-history-filter="academicYear"]').value=defaultYear;controller.refresh(filters());});
  host.querySelectorAll('[data-history-export]').forEach(button=>button.addEventListener('click',()=>controller.export(button.dataset.historyExport)));
  find('[data-history-prev]').addEventListener('click',()=>controller.page(controller.state().offset-100));
  find('[data-history-next]').addEventListener('click',()=>controller.page(controller.state().offset+100));
  const clear=()=>controller.clear('Authorization changed. Apply filters to reload your permitted history.');
  const profileChanged=()=>clear();root.addEventListener?.('paws-profile',profileChanged);
  const auth=root.firebase?.auth?.();let authUid=auth?.currentUser?.uid||null;
  const detach=auth?.onAuthStateChanged?.(user=>{const next=user?.uid||null;if(next!==authUid){authUid=next;clear();}});
  render(controller.state());
  controller.refresh(filters());
  return {refresh:()=>controller.refresh(filters()),clear,destroy(){root.removeEventListener?.('paws-profile',profileChanged);if(typeof detach==='function')detach();controller.destroy();host.innerHTML='';}};
 }
 return {createHistoryController,renderRows,renderOperationRows,mount};
});
