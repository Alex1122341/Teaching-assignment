(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PAWS_CALENDAR_ACTIVITIES=api.createCalendarActivityView({api:root.UCVM_PAWS_DATA,getUser:()=>root.firebase?.auth?.().currentUser});})(typeof window==='undefined'?null:window,function(root){
 'use strict';
 const placement=typeof module==='object'&&module.exports?require('./calendar-activity-placement'):root?.PAWS_ACTIVITY_PLACEMENT;
 const names=typeof module==='object'&&module.exports?require('./faculty-name'):root?.PAWS_FACULTY_NAME;
 const activityFacultyName=row=>row.staffingKind==='unassigned'?'Locum':names?.format({displayName:row.facultyDisplayName})||row.facultyDisplayName||'Not provided';
 // A superseded request is not an empty result. Callers that cache rows (the
 // timetable search cache) ask for onCancel:'throw' so cancellation can never be
 // mistaken for an authoritative empty range. Every other caller keeps the
 // historical [] return.
 const CANCELLED_CODE='CALENDAR_ACTIVITY_CANCELLED';
 function cancelledError(){const error=new Error('The calendar activity request was superseded.');error.name='AbortError';error.code=CANCELLED_CODE;return error;}
 function isCancelled(error){return error?.code===CANCELLED_CODE||error?.name==='AbortError';}
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
 function academicRange(value){const match=String(value||'').match(/^(\d{4})-(\d{2}|\d{4})$/);if(!match)return null;const start=Number(match[1]),end=start+1;if(String(end).slice(-match[2].length)!==match[2])return null;return {start:start+'-05-01',end:end+'-05-01'};}
 const labels={ccc:'CCC',rotation_participant:'Rotation participant',clinical_day:'Clinical day / PPVM',vetm581_rounds:'VETM 581 clinical rounds',vetm571_clinical_pharmacology:'VETM 571 clinical pharmacology',vetm591_presentations:'VETM 591 IM presentations',teaching_excellence:'Teaching excellence'};
 function createActivityTypeFilter({host=null,onChange=()=>{},activityCategories=null}={}){
  const options=[...['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam'].map(label=>({key:'teaching:'+label,label,group:'teaching'})),...Object.entries(labels).filter(([category])=>!Array.isArray(activityCategories)||activityCategories.includes(category)).map(([category,label])=>({key:'work:'+category,label,group:'work'}))];
  const defaults=options.slice();
  let selected=new Set(options.map(x=>x.key));
  const summary=()=>!selected.size?'No activity types':selected.size===options.length?'All activity types':`${selected.size} of ${options.length} activity types`;
  function position(){if(!host||!host.querySelector('details')?.open)return;const panel=host.querySelector('.activity-type-options'),anchor=host.getBoundingClientRect(),width=panel.getBoundingClientRect().width,viewport=host.ownerDocument.defaultView.innerWidth;panel.style.left=`${Math.max(16,Math.min(anchor.left,viewport-width-16))-anchor.left}px`;}
  function sync(){if(!host)return;const title=host.querySelector('[data-type-summary]');if(title)title.textContent=summary();host.querySelectorAll('[data-type-key]').forEach(input=>{input.checked=selected.has(input.value);});}
  function render(){if(!host)return;const open=host.querySelector('details')?.open;host.innerHTML=`<details class="activity-type-picker" ${open?'open':''}><summary data-type-summary>${esc(summary())}</summary><div class="activity-type-options"><div class="activity-type-actions"><button type="button" data-type-action="all">Select all types</button><button type="button" data-type-action="clear">Clear types</button></div>${[['teaching','Teaching sessions'],['work','Work activities']].map(([group,title])=>`<fieldset><legend>${title}</legend>${options.filter(x=>x.group===group).map(x=>`<label><input type="checkbox" data-type-key value="${esc(x.key)}" ${selected.has(x.key)?'checked':''}><span>${esc(x.label)}</span></label>`).join('')}</fieldset>`).join('')}</div></details>`;position();}
  const changed=()=>{sync();onChange();},selectAll=()=>{selected=new Set(options.map(x=>x.key));changed();};
  const api=Object.freeze({options:()=>options.map(x=>({...x})),selectedKeys:()=>[...selected],selectAll,reset:selectAll,clear(){selected.clear();changed();},
   setSessionTypes(types){let added=false;const all=selected.size===options.length;for(const value of types){const type=String(value||'').trim(),key='teaching:'+type;if(type.toUpperCase()==='CCC'||options.some(x=>x.key===key))continue;options.push({key,label:type||'Teaching type not provided',group:'teaching'});if(all)selected.add(key);added=true;}if(added)render();},
   resetForUser(){options.splice(0,options.length,...defaults);selected=new Set(options.map(x=>x.key));render();},
   setSelected(keys){selected=new Set(keys.filter(key=>options.some(x=>x.key===key)));changed();},summary,
   matchesSession:row=>selected.has(String(row.type||'').trim().toUpperCase()==='CCC'?'work:ccc':'teaching:'+String(row.type||'').trim()),
   matchesActivity:row=>selected.has('work:'+row.category)});
  host?.addEventListener('change',event=>{const input=event.target.closest('[data-type-key]');if(!input||!host.contains(input))return;if(input.checked)selected.add(input.value);else selected.delete(input.value);changed();});
  host?.addEventListener('click',event=>{const action=event.target.closest('[data-type-action]');if(!action||!host.contains(action))return;if(action.dataset.typeAction==='all')api.selectAll();else api.clear();});
  host?.addEventListener('toggle',position,true);if(host)host.ownerDocument.defaultView.addEventListener('resize',position);
  render();return api;
 }
 function times(row){const unique=new Map();for(const entry of Array.isArray(row.timeEvidence)?row.timeEvidence:[]){if(validDate(entry.date)&&entry.date>=row.startDate&&entry.date<=row.endDate&&validTime(entry.startTime)&&validTime(entry.endTime)&&entry.startTime<entry.endTime)unique.set(entry.date,{date:entry.date,startTime:entry.startTime,endTime:entry.endTime});}return [...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));}
 function renderRangeLane(activities,{start,end,filters={},heading='Work recorded beyond teaching sessions',pageSize=0,page=0}={}){
  const searchWords=String(filters.search||'').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const matching=(Array.isArray(activities)?activities:[]).filter(row=>validDate(row.startDate)&&validDate(row.endDate)&&(!start||row.endDate>=start)&&(!end||row.startDate<end)
   &&(!Array.isArray(filters.typeKeys)||filters.typeKeys.includes('work:'+row.category))
   &&(!filters.category||filters.category==='all'||row.category===filters.category)&&(!filters.facultyKey||row.facultyKey===filters.facultyKey)
   &&(row.category==='ccc'?filters.showCcc!==false:filters.showWorking!==false)
   &&searchWords.every(word=>[row.label,row.facultyDisplayName,activityFacultyName(row),row.staffingLabel,row.blockLabel,row.courseCode].join(' ').toLowerCase().includes(word)))
   .sort((a,b)=>a.startDate.localeCompare(b.startDate)||String(a.facultyDisplayName).localeCompare(String(b.facultyDisplayName)));
  const size=Number.isInteger(pageSize)&&pageSize>0?Math.min(pageSize,100):matching.length||1;
  const currentPage=Math.max(0,Math.min(Number.isInteger(page)?page:0,Math.ceil(matching.length/size)-1));
  const rows=matching.slice(currentPage*size,(currentPage+1)*size);
  const pages=matching.length>size?`<nav class="activity-toolbar" aria-label="Other working activity pages"><button class="btn" type="button" data-other-previous ${currentPage===0?'disabled':''}>Previous</button><span>${currentPage*size+1}–${Math.min((currentPage+1)*size,matching.length)} of ${matching.length}</span><button class="btn" type="button" data-other-next ${(currentPage+1)*size>=matching.length?'disabled':''}>Next</button></nav>`:'';
  const body=rows.map(row=>{
   const evidence=times(row),dayCount=(Date.parse(row.endDate)-Date.parse(row.startDate))/86400000+1,verified=evidence.length===dayCount;
   const name=activityFacultyName(row);
   return `<tr><td><strong>${esc(row.label||labels[row.category]||'Working activity')}</strong><span class="activity-category">${esc(labels[row.category]||'Working activity')}</span></td><td>${esc(name)}</td><td class="activity-source-dates">${esc(row.startDate)}<span>to ${esc(row.endDate)}</span><small>Original inclusive range</small></td><td><span class="activity-state ${verified?'activity-verified':'activity-review'}">${verified?'Time verified':'Needs Review'}</span>${evidence.length?evidence.map(value=>`<span class="activity-time">${esc(value.date)} · ${esc(value.startTime)}–${esc(value.endTime)}</span>`).join(''):'<span class="activity-time">Default time: 08:30–16:30</span>'}${!verified&&evidence.length?'<small>Other dates: Default time 08:30–16:30</small>':''}</td><td>${row.blockLabel?`<span>Block: ${esc(row.blockLabel)}</span>`:''}<span>Course: ${esc(row.courseCode||'Not provided')}</span><small>Room: Not provided · Group: Not provided</small></td></tr>`;
  }).join('');
  return `<section class="working-activity-section" aria-label="Working activities"><header><div><span class="activity-eyebrow">WORKING ACTIVITIES</span><h3>${esc(heading)}</h3></div><span class="activity-count">${matching.length} ${matching.length===1?'range':'ranges'}</span></header><p class="activity-note">Source date ranges are preserved, including weekends. Unconfirmed times remain Needs Review for SWAP.</p>${rows.length?`<div class="activity-table-wrap"><table class="activity-table"><thead><tr><th>Activity</th><th>Faculty</th><th>Source dates</th><th>Time / evidence</th><th>Details</th></tr></thead><tbody>${body}</tbody></table></div>`:'<p class="activity-empty">No working activities match this range and filter.</p>'}${pages}</section>`;
 }
 function createCalendarActivityView({api,getUser=()=>null}){
  let generation=0;
  const user=()=>String(getUser()?.uid||'');
  async function loadRange(range,{onCancel='empty'}={}){
   const token=++generation,uid=user();
   // A superseded request is a cancellation, not an empty range. onCancel:'throw'
   // lets a caching caller tell the two apart; the default keeps the previous []
   // contract for every existing caller.
   const cancelled=()=>{if(onCancel==='throw')throw cancelledError();return[];};
   if(!uid)return cancelled();
   const result=[],seen=new Set();let cursor=null;
   do{
    const page=await api.listCalendarActivities({...range,...(cursor?{cursor}:{})});if(token!==generation||uid!==user())return cancelled();
    if(!Array.isArray(page.activities))throw Error('Working activities could not be read. Teaching sessions remain available.');
    result.push(...page.activities);if(result.length>5000)throw Error('Working activity paging limit exceeded. Choose a smaller date range.');
    cursor=page.nextCursor||null;if(cursor){if(seen.has(cursor)||seen.size>=50)throw Error('Working activity paging cursor repeated.');seen.add(cursor);}
   }while(cursor);
   return result;
  }
  async function loadFacultyRange(facultyId,range,{self=false,onCancel='empty'}={}){
   if(self)return loadRange(range,{onCancel});
   const token=++generation,uid=user();
   const cancelled=()=>{if(onCancel==='throw')throw cancelledError();return[];};
   if(!uid)return cancelled();
   const mapping=await api.listCalendarActivities({...range,limit:1,includeFacultyKeys:true});if(token!==generation||uid!==user())return cancelled();
   const key=(mapping.facultyKeys||[]).find(value=>String(value.facultyId).toLowerCase()===String(facultyId).toLowerCase())?.facultyKey;
   if(!key)return[];
   return loadRange({...range,facultyKey:key},{onCancel});
  }
  const view={loadRange,loadFacultyRange,academicRange,createActivityTypeFilter,renderRangeLane,createOtherWorkTab,renderFacultyActivities:activities=>renderRangeLane((Array.isArray(activities)?activities:[]).filter(row=>row.staffingKind!=='unassigned')),clear(){generation++;},isCancelled};
  return Object.freeze({...view,createFacultySchedule:options=>createFacultySchedule({...options,view})});
 }
 function createFacultySchedule({view,getHost,getUser,getSelected,isSelf}){
  let generation=0;
  async function load(facultyId,year){
   const host=getHost(),token=++generation,uid=getUser()?.uid;if(!host)return;
   const range=academicRange(year);if(!range){host.textContent='Choose an academic year to view working activities.';return;}
   const current=()=>token===generation&&uid===getUser()?.uid&&host===getHost()&&String(getSelected()).toLowerCase()===String(facultyId).toLowerCase();
   try{const rows=await view.loadFacultyRange(facultyId,range,{self:isSelf()});if(current())host.innerHTML=view.renderFacultyActivities(rows);}
   catch(error){if(current())host.innerHTML='<p class="activity-notice activity-error" role="alert">Working activities could not be loaded. Teaching and profile data remain available.</p>';}
  }
  return Object.freeze({load,clear(){generation++;view.clear();}});
 }
 function createOtherWorkTab({host,api,getUser,getAcademicYear}){
  const view=createCalendarActivityView({api,getUser});
  let generation=0,rows=[],year=null,identity='',loadedIdentity='',range=null,active=false,page=0;
  const scope=()=>JSON.stringify([getUser()?.uid||'',getUser()?.role||'',root?.PAWS_SUPPORT?.contextId?.()||'']);
  const node=key=>host.querySelector(`[data-other-${key}]`);
  function paint(){
   if(!active)return;
   if(loadedIdentity!==scope()){if(loadedIdentity)node('results').innerHTML='';return;}
   node('results').innerHTML=renderRangeLane(rows,{...range,heading:'Other working activities',pageSize:50,page,filters:{search:node('search').value,category:node('category').value||'all'}});
   const previous=node('previous'),next=node('next');
   if(previous)previous.onclick=()=>{page=Math.max(0,page-1);paint();};if(next)next.onclick=()=>{page++;paint();};
  }
  async function load(){
   const token=++generation,stamp=scope(),selected=String(node('year').value||'').trim();
   rows=[];loadedIdentity='';page=0;range=academicRange(selected);year=selected;
   if(!range){node('results').innerHTML='<p class="activity-error" role="alert">Enter an academic year such as 2026-27.</p>';return;}
   if(!getUser()?.uid){node('results').textContent='Sign in to view your authorized working activities.';return;}
   node('results').innerHTML='<p class="activity-notice" role="status">Loading other working activities…</p>';
   const current=()=>active&&token===generation&&stamp===scope();
   try{
    const result=await view.loadRange(range,{onCancel:'throw'});if(!current())return;
    rows=placement.otherActivities(result);loadedIdentity=stamp;paint();
   }catch(error){if(!current())return;node('results').innerHTML='<p class="activity-error" role="alert">Other working activities could not be loaded. <button type="button" data-other-retry>Retry</button></p>';const retry=node('retry');if(retry)retry.onclick=load;}
  }
  function open(){
   if(!host)return Promise.resolve();active=true;
   const next=scope();if(identity!==next||!year){year=getAcademicYear();identity=next;}
   host.innerHTML=`<h2>Other working activities</h2><p class="activity-note">Work not placed in CCC, Rotation or the teaching timetable. Faculty may already be assigned. Dates and original time evidence remain unchanged.</p><div class="activity-toolbar"><label>Academic year<input data-other-year aria-label="Other work academic year" placeholder="2026-27" maxlength="7"></label><label>Search<input type="search" data-other-search aria-label="Search other working activities" placeholder="Faculty, activity, course or block"></label><label>Activity type<select data-other-category aria-label="Other working activity type"><option value="all">All other activity types</option>${Object.entries(labels).filter(([key])=>!['ccc','rotation_participant'].includes(key)).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select></label><button class="btn" type="button" data-other-refresh>Refresh</button><button class="btn" type="button" data-other-reset>Reset</button></div><div data-other-results aria-live="polite"></div>`;
   node('year').value=year;node('search').value='';node('category').value='all';
   node('year').onchange=load;node('search').oninput=()=>{page=0;paint();};node('category').onchange=()=>{page=0;paint();};node('refresh').onclick=load;
   node('reset').onclick=()=>{node('year').value=getAcademicYear();node('search').value='';node('category').value='all';return load();};
   return load();
  }
  return Object.freeze({open,clear(){active=false;++generation;view.clear();rows=[];loadedIdentity='';if(host)host.innerHTML='';}});
 }
 return {createCalendarActivityView,createActivityTypeFilter,createOtherWorkTab,renderRangeLane,academicRange,CANCELLED_CODE,isCancelled};
});
