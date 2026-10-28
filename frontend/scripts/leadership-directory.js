(function(root,factory){
'use strict';
const lib=factory();
if(typeof module==='object'&&module.exports)module.exports=lib;
if(root&&root.document){
 // Teaching Schedule HICC–CC / VISC directory. Read-only; data comes from the authorized
 // /api/v1/dashboard/leadership-directory projection on every open and Refresh.
 const doc=root.document,overlay=doc.getElementById('leadership-directory-overlay');
 if(!overlay)return;
 const heading=doc.getElementById('leadership-directory-heading'),subtitle=doc.getElementById('leadership-directory-subtitle'),
  closeButton=doc.getElementById('leadership-directory-close'),refresh=doc.getElementById('leadership-directory-refresh'),
  showAll=doc.getElementById('leadership-directory-show-all'),search=doc.getElementById('leadership-directory-search'),
  sort=doc.getElementById('leadership-directory-sort'),clear=doc.getElementById('leadership-directory-clear'),status=doc.getElementById('leadership-directory-status'),
  body=doc.getElementById('leadership-directory-body');
 let kind='hicc-cc',academicYear='',data=null,loading=false,loadError=false,generation=0,previousFocus=null;
 const currentUid=()=>{try{return root.firebase?.auth?.().currentUser?.uid||'';}catch(_){return '';}};
 const open_=()=>!overlay.hidden;
 function render(){
  const list=lib.LISTS[kind];
  heading.textContent=list.title;
  subtitle.textContent='Academic year '+(academicYear||'—')+(data?.asOfDate?' · Status as of '+data.asOfDate:'');
  body.setAttribute('aria-busy',String(loading));
  // Disabling the focused element would blur it outside this modal's Tab handler.
  if(loading&&doc.activeElement===refresh)search.focus();
  refresh.disabled=loading;clear.disabled=!search.value;
  if(loading){status.textContent='Loading '+list.title+'…';body.innerHTML='<p class="leadership-directory-empty">Loading…</p>';return;}
  if(loadError){status.textContent=list.title+' could not be loaded.';body.innerHTML='<div class="leadership-directory-empty" role="alert"><p>The list is unavailable. Nothing is shown until it loads successfully.</p><button type="button" class="leadership-directory-retry" data-leadership-retry>Retry</button></div>';return;}
  const all=data?data[list.key]:[];
  const population=lib.projectedRows(all,{kind,showAll:showAll.checked});
  const total=lib.projectedRows(all,{kind,showAll:true}).length;
  const rows=lib.viewRows(all,{kind,showAll:showAll.checked,query:search.value,sort:sort.value});
  status.textContent=lib.countText(rows.length,total,showAll.checked)+(search.value.trim()?' · Search: '+search.value.trim():'');
  body.innerHTML=lib.renderTable(kind,rows,total-population.length,search.value.trim());
 }
 async function load(){
  if(!open_()||!currentUid())return;
  const token=++generation,uid=currentUid(),year=academicYear;loading=true;loadError=false;render();
  try{
   const response=await root.UCVM_PAWS_DATA.leadershipDirectory(year);
   if(token!==generation||uid!==currentUid()||!open_())return;
   data=lib.validateResponse(response,year);loading=false;render();
  }catch(_){if(token!==generation||!open_())return;data=null;loading=false;loadError=true;render();}
 }
 function open(nextKind,year){
  if(!lib.LISTS[nextKind]||!currentUid())return;
  kind=nextKind;academicYear=lib.validYear(year)?year:lib.calgaryAcademicYear();data=null;showAll.checked=false;search.value='';sort.value='scope';body.scrollTop=0;
  previousFocus=doc.activeElement;overlay.hidden=false;overlay.setAttribute('aria-hidden','false');
  overlay.querySelector('.leadership-directory-shell').setAttribute('aria-labelledby','leadership-directory-heading');
  closeButton.focus();load();
 }
 function close(){
  if(!open_())return;generation++;loading=false;loadError=false;data=null;body.textContent='';
  overlay.hidden=true;overlay.setAttribute('aria-hidden','true');
  if(previousFocus?.isConnected)previousFocus.focus();previousFocus=null;
 }
 closeButton.addEventListener('click',close);
 refresh.addEventListener('click',load);
 showAll.addEventListener('change',()=>{body.scrollTop=0;if(!loading)render();});
 const updateView=()=>{body.scrollTop=0;render();};
 const clearSearch=()=>{search.value='';updateView();search.focus();};
 search.addEventListener('input',updateView);sort.addEventListener('change',updateView);clear.addEventListener('click',clearSearch);
 body.addEventListener('click',event=>{if(event.target.closest?.('[data-leadership-retry]'))load();if(event.target.closest?.('[data-leadership-clear]'))clearSearch();});
 overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
 overlay.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key!=='Tab')return;
  const focusable=[...overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(el=>el.offsetParent!==null||el===doc.activeElement);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
 });
 // A signed-out or switched account must not keep another account's view.
 root.addEventListener('paws-profile',()=>{if(open_()){data=null;load();}});
 root.PAWS_LEADERSHIP_DIRECTORY=Object.freeze({open,close});
}
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const LISTS=Object.freeze({
  'hicc-cc':Object.freeze({key:'hiccCc',title:'HICC–CC List',scopeHeading:'Course / Subject',empty:'No HICC or Course Coordinator appointments are recorded for this academic year.'}),
  visc:Object.freeze({key:'visc',title:'VISC List',scopeHeading:'Subject',empty:'No VISC appointments are recorded for this academic year.'})
 });
 const ROLE_LABEL=Object.freeze({HICC:'HICC','Course Coordinator':'CC',VISC:'VISC'});
 const STATUS_LABEL=Object.freeze({active:'Active',inactive:'Inactive',upcoming:'Upcoming','dates-needed':'Dates needed'});
 const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 const validYear=y=>typeof y==='string'&&/^\d{4}-\d{2}$/.test(y)&&Number(y.slice(5))===(Number(y.slice(0,4))+1)%100;
 // Same Calgary academic-year rule as the Teaching Schedule (May 1 start); used only when the page has no year.
 function calgaryAcademicYear(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit'}).formatToParts(now);
  const y=Number(parts.find(p=>p.type==='year').value),m=Number(parts.find(p=>p.type==='month').value),start=m<5?y-1:y;
  return start+'-'+String((start+1)%100).padStart(2,'0');
 }
 function statusText(row){
  const label=STATUS_LABEL[row.status];
  if(row.status==='active')return label+' · '+(row.endDate?'Ends '+row.endDate:'No end date');
  if(row.status==='upcoming')return label+' · Starts '+row.startDate+' · '+(row.endDate?'Ends '+row.endDate:'No end date');
  if(row.status==='inactive')return label+' · '+(row.endDate?'Ended '+row.endDate:'No effective period recorded')+(row.nextStartDate?' · Resumes '+row.nextStartDate:'');
  return label+' · '+(row.endDate?'Start date not recorded · Ends '+row.endDate:'End date not recorded');
 }
 // Default view: Active and Dates needed (so incomplete records never disappear).
 const visibleRows=(rows,showAll)=>rows.filter(row=>showAll||row.status==='active'||row.status==='dates-needed');
 const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim();

 // Show HICC rather than CC for the same scoped appointment, without hiding
 // a currently serving CC behind an expired/future HICC.
 function sameDisplayPeriod(hicc,cc){
  // An active confirmed HICC supersedes an undated CC for the same title.
  // Do not hide a confirmed active CC behind an undated or expired HICC.
  if(hicc.status==='active'&&cc.status==='dates-needed')return true;
  if(hicc.status!==cc.status)return false;
  if(hicc.status==='active')return true;
  if(hicc.status==='dates-needed')
   return (hicc.startDate||'')===(cc.startDate||'')&&(hicc.endDate||'')===(cc.endDate||'');
  if(hicc.status==='upcoming'){
   if(!hicc.startDate||!cc.startDate)return false;
   return (!hicc.endDate||hicc.endDate>=cc.startDate)&&(!cc.endDate||cc.endDate>=hicc.startDate);
  }
  if(hicc.status==='inactive')
   return Boolean(hicc.endDate)&&hicc.endDate===cc.endDate&&
    (hicc.nextStartDate||'')===(cc.nextStartDate||'');
  return false;
 }
 function projectedRows(rows,{showAll=false,kind='hicc-cc'}={}){
  const population=visibleRows(rows,showAll);
  if(kind!=='hicc-cc')return population;
  const hiccs=population.filter(row=>row.roleType==='HICC'&&normalize(row.scope));
  return population.filter(row=>row.roleType!=='Course Coordinator'||!normalize(row.scope)||
   !hiccs.some(hicc=>normalize(hicc.scope)===normalize(row.scope)&&sameDisplayPeriod(hicc,row)));
 }
 function viewRows(rows,{showAll=false,query='',sort='scope',kind='hicc-cc'}={}){
  const words=normalize(query).split(/\s+/).filter(Boolean);
  const result=projectedRows(rows,{showAll,kind}).filter(row=>{
   const text=normalize([row.facultyName,row.scope,ROLE_LABEL[row.roleType],row.roleType,statusText(row),row.startDate,row.endDate].join(' '));
   return words.every(word=>text.includes(word));
  });
  const nameOrder=(a,b)=>a.facultyName.localeCompare(b.facultyName,'en',{sensitivity:'base'})||String(a.scope??'').localeCompare(String(b.scope??''),'en',{numeric:true});
  if(sort==='faculty')result.sort(nameOrder);
  if(sort==='end-date')result.sort((a,b)=>(a.endDate||'9999-99-99').localeCompare(b.endDate||'9999-99-99')||nameOrder(a,b));
  return result;
 }
 const countText=(shown,total,showAll)=>shown+' of '+total+' appointment'+(total===1?'':'s')+(showAll?'':' · Active and Dates needed shown');
 function validateResponse(value,year){
  if(!value||value.academicYear!==year||!validDate(value.asOfDate)||!Array.isArray(value.hiccCc)||!Array.isArray(value.visc)||value.hiccCc.length+value.visc.length>1000)throw Error('Invalid directory response');
  const check=(rows,types)=>rows.forEach(row=>{
   if(!row||!types.includes(row.roleType)||typeof row.facultyName!=='string'||!row.facultyName.trim()||!(row.status in STATUS_LABEL)
    ||(row.scope!==null&&typeof row.scope!=='string')||[row.startDate,row.endDate,row.nextStartDate].some(d=>d!=null&&!validDate(d)))throw Error('Invalid directory record');
  });
  check(value.hiccCc,['HICC','Course Coordinator']);check(value.visc,['VISC']);
  return value;
 }
 function renderTable(kind,rows,hidden=0,query=''){
  const list=LISTS[kind];
  if(!rows.length&&query)return '<div class="leadership-directory-empty"><p>No appointments match “'+escape(query)+'” in the selected status view.</p><button type="button" class="leadership-directory-retry" data-leadership-clear>Clear search</button></div>';
  if(!rows.length)return '<p class="leadership-directory-empty">'+(hidden?escape('No Active or Dates needed appointments. '+hidden+' inactive or upcoming record'+(hidden===1?' is':'s are')+' hidden; use “Show inactive / upcoming”.'):escape(list.empty))+'</p>';
  return '<table class="leadership-directory-table"><caption class="leadership-sr-only">'+escape(list.title)+'</caption><thead><tr><th scope="col">'+escape(list.scopeHeading)+'</th><th scope="col">Faculty</th></tr></thead><tbody>'+
   rows.map(row=>'<tr><td><span class="leadership-role leadership-role-'+escape(ROLE_LABEL[row.roleType].toLowerCase())+'">'+escape(ROLE_LABEL[row.roleType])+'</span> · '+
    (row.scope?'<span class="leadership-scope">'+escape(row.scope)+'</span>':'<span class="leadership-missing">Not recorded</span>')+'</td>'+
    '<td><span class="leadership-name">'+escape(row.facultyName)+'</span><span class="leadership-status leadership-status-'+escape(row.status)+'">'+escape(statusText(row))+'</span></td></tr>').join('')+
   '</tbody></table>';
 }
 return Object.freeze({LISTS,ROLE_LABEL,escape,validDate,validYear,calgaryAcademicYear,statusText,visibleRows,projectedRows,viewRows,countText,validateResponse,renderTable});
});
