(function(root){
 'use strict';
 const showFaculty=value=>root.PAWS_FACULTY_NAME?.format(value)||String(value||'');
 const TYPES={instructor_overlap:'Instructor overlap',afc_unavailable:'Unavailable',duplicate_assignment:'Duplicate assignment',duplicate_session_assignment:'Duplicate session assignment',invalid_schedule:'Invalid schedule',missing_schedule:'Missing schedule',calendar_activity_overlap:'Working activity overlap',calendar_time_unknown:'Working time not provided'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let panel,button,adapter,generation=0,owner=null,started=false,year='',years=[],params={},query='',mode='all';
 let tasks=[],navigation=[],requests=[],total=0,nextCursor=null,errors=[],notice='',loading=false,reviewBusy=false,facets={faculty:[],courses:[]};
 const currentOwner=()=>adapter?.identity?.()||String(Boolean(adapter?.hasUser()));
 const current=token=>token===generation&&adapter?.hasUser()&&owner===currentOwner();
 const pref=()=>{try{return localStorage.getItem('paws-tasks-open')!=='false';}catch(_){return true;}};
 function toggle(open){panel.hidden=!open;button.setAttribute('aria-expanded',String(open));document.body.classList.toggle('workspace-tasks-open',open);try{localStorage.setItem('paws-tasks-open',String(open));}catch(_){}}
 function clearData(){tasks=[];navigation=[];requests=[];total=0;nextCursor=null;errors=[];reviewBusy=false;}
 function resetIdentity(){clearData();year='';years=[];params={};query='';mode='all';facets={faculty:[],courses:[]};started=false;panel.querySelector('[data-task-search]').value='';panel.querySelectorAll('[data-task-filter]').forEach(node=>{node.value='';});}
 function updateOptions(){
  const options=(values,key,label,selected,placeholder,selectedLabel)=>`${placeholder?'<option value="">'+esc(placeholder)+'</option>':''}`+values.map(row=>`<option value="${esc(row[key])}" data-label="${esc(row[label])}"${String(row[key])===selected?' selected':''}>${esc(row[label])}</option>`).join('')+(selected&&!values.some(row=>String(row[key])===selected)?`<option value="${esc(selected)}" data-label="${esc(selectedLabel||selected)}" selected>${esc(selectedLabel||selected)} (not in current issues)</option>`:'');
  panel.querySelector('[data-task-year]').innerHTML=options(years.map(academicYear=>({academicYear})),'academicYear','academicYear',year,'');
  const facultySelect=panel.querySelector('[data-task-filter="facultyKey"]'),selectedFaculty=facultySelect.selectedOptions[0];
  facultySelect.innerHTML=options(facets.faculty.map(row=>({...row,displayName:showFaculty(row.displayName)})),'facultyKey','displayName',params.facultyKey,'All faculty in scope',selectedFaculty&&selectedFaculty.value===params.facultyKey?selectedFaculty.dataset.label:undefined);
  panel.querySelector('[data-task-filter="courseCode"]').innerHTML=options(facets.courses,'courseCode','courseCode',params.courseCode,'All courses');
 }
 function matchesSearch(item){return !query||[item.displayName,showFaculty(item.displayName),item.courseCode,item.date,item.type,item.title,item.reason,item.topic].join(' ').toLowerCase().includes(query);}
 function navigationVisible(item){
  if(params.facultyKey||params.type||params.reviewStatus||params.undated==='only')return false;
  return (!params.courseCode||item.courseCode===params.courseCode)&&(!params.start||item.date>=params.start&&item.date<params.end);
 }
 function card(task){
  const reviewed=task.reviewStatus==='Reviewed',status=reviewed?(task.severity==='Conflict'?'Reviewed · Conflict remains':'Reviewed · Issue remains'):'Unreviewed';
  const related=(task.relatedSessions||[]).map(session=>`<div class="workspace-conflict-reference"><small>${esc([session.courseCode?'VETM '+session.courseCode:'Course not provided',session.date,session.startTime,session.endTime].filter(Boolean).join(' · '))}</small><button type="button" data-open-session="${esc(session.id)}">Open conflicting session</button></div>`).join('');
  return `<article class="workspace-task workspace-issue" data-issue-key="${esc(task.issueKey)}"><div class="workspace-issue-badges"><span class="workspace-issue-severity ${task.severity==='Conflict'?'is-conflict':'is-review'}">${esc(task.severity)}</span><span>${esc(status)}</span></div><strong>${esc(TYPES[task.type]||'Schedule issue')}</strong><span>${esc(showFaculty(task.displayName||'Faculty not provided'))} · ${esc(task.courseCode?'VETM '+task.courseCode:'Course not provided')}</span><small>${esc(task.date||'Date not provided')} · ${esc(task.startTime&&task.endTime?task.startTime+'–'+task.endTime:'Time not provided')}</small><div class="workspace-issue-actions"><button type="button" data-open-session="${esc(task.sessionId)}">Open session</button>${task.canReview?`<button type="button" data-review-issue="${esc(task.issueKey)}"${loading||reviewBusy?' disabled':''}>${reviewed?'Reopen review':'Mark reviewed'}</button>`:''}</div>${related}</article>`;
 }
 function render(){
  if(!panel)return;
  const visibleNavigation=navigation.filter(navigationVisible),count=total+visibleNavigation.length+requests.length;
  button.textContent=loading?'Tasks (…)':`Tasks${count||errors.length?' ('+count+(errors.length?'+':'')+')':''}`;
  panel.querySelector('.workspace-task-caption').textContent=loading?'Loading authorized tasks…':`${total} schedule issues · ${tasks.length} loaded · All weeks`;
  panel.querySelectorAll('[data-filter]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.filter===mode)));
  const issueCards=mode==='requests'?[]:tasks.filter(matchesSearch).map(card);
  const otherItems=[...(mode==='requests'?[]:visibleNavigation),...(mode==='schedule'?[]:requests)].filter(matchesSearch);
  const otherCards=otherItems.map(item=>`<button type="button" class="workspace-task" data-id="${esc(item.id)}" data-kind="${esc(item.kind)}"><strong>${esc(item.title)}</strong><span>${esc(item.reason)}</span><small>${esc(item.date||'Date not provided')}</small>${item.topic?`<span class="workspace-task-topic">${esc(item.topic)}</span>`:''}</button>`);
  const messages=errors.map(message=>`<p role="alert">${esc(message)}</p>`).join('')+(notice?`<p role="status">${esc(notice)}</p>`:'');
  const list=panel.querySelector('.workspace-task-list');
  list.innerHTML=messages+(errors.length?'<button type="button" data-retry>Retry</button>':'')+issueCards.join('')+otherCards.join('')+(!loading&&!errors.length&&!issueCards.length&&!otherCards.length?'<p class="workspace-empty">No matching tasks in your authorized scope.</p>':'')+(nextCursor&&mode!=='requests'?`<button type="button" class="workspace-task-more" data-task-more${loading?' disabled':''}>Load more issues</button>`:'');
  list.querySelector('[data-retry]')?.addEventListener('click',()=>refresh());
  list.querySelector('[data-task-more]')?.addEventListener('click',()=>refresh({append:true}));
  list.querySelectorAll('[data-open-session]').forEach(node=>node.onclick=()=>adapter.openSession(node.dataset.openSession));
  list.querySelectorAll('[data-id]').forEach(node=>node.onclick=()=>node.dataset.kind==='requests'?root.PAWS_SWAP?.openDetail(node.dataset.id):adapter.openSession(node.dataset.id));
  list.querySelectorAll('[data-review-issue]').forEach(node=>node.onclick=()=>review(tasks.find(task=>task.issueKey===node.dataset.reviewIssue)));
 }
 async function review(task){
  if(!task?.canReview||reviewBusy||loading)return;
  const token=generation;reviewBusy=true;render();
  try{
   await root.UCVM_PAWS_DATA.reviewSchedulingTask(task.issueKey,{academicYear:year,expectedEvidenceVersion:task.evidenceVersion,expectedReviewVersion:task.reviewVersion,reviewStatus:task.reviewStatus==='Reviewed'?'Unreviewed':'Reviewed'});
   if(current(token))await refresh({message:'Review saved. Active issues remain visible until the schedule is corrected.'});
  }catch(error){if(current(token))await refresh({message:error?.code==='SCHEDULING_TASK_STALE'?'Scheduling data changed. Check the refreshed issue before reviewing again.':'Review was not saved. Check the refreshed queue and retry.'});}
  finally{if(current(token)){reviewBusy=false;render();}}
 }
 async function refresh({append=false,message=''}={}){
  if(!panel||!adapter)return;
  if(append&&loading)return;
  const token=++generation;
  if(!adapter.hasUser()){resetIdentity();owner=null;loading=false;notice='';render();button.hidden=true;panel.hidden=true;document.body.classList.remove('workspace-tasks-open');return;}
  const identity=currentOwner();if(owner!==identity){resetIdentity();owner=identity;}
  button.hidden=false;if(!started){started=true;toggle(pref());}
  if(!append)clearData();loading=true;notice=message;render();
  if(!append){
   const results=await Promise.allSettled([adapter.allSessions(),root.UCVM_PAWS_DATA.swapQueue()]);
   if(!current(token))return;
   if(results[1].status==='fulfilled')requests=(results[1].value.requests||[]).filter(row=>!['applied','approved','rejected','withdrawn'].includes(String(row.status).toLowerCase())).map(row=>({id:row.requestId,kind:'requests',title:'SWAP · '+(row.courseCode||'Session'),reason:[row.status,row.nextStage].filter(Boolean).join(' · '),date:row.date}));
   else errors.push('SWAP requests could not be loaded. Retry to refresh.');
   if(results[0].status==='fulfilled'){
    const sessions=results[0].value;years=[...new Set([...sessions.map(s=>String(s.academicYear||'')),year].filter(Boolean))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    if(!years.includes(year))year=years.includes(adapter.academicYear?.())?adapter.academicYear():years[0]||'';
    navigation=sessions.filter(s=>String(s.academicYear)===year&&['before','after'].includes(adapter.disposition(s).disposition)).map(s=>({id:s.id,kind:'schedule',title:'VETM '+(s.course||'Unknown course'),courseCode:s.course,topic:s.topic,reason:adapter.reason(s,adapter.disposition(s).disposition),date:s.date}));
   }else{year='';years=[];errors.push('Schedule scope could not be loaded. Retry to refresh.');}
  }
  try{
   if(Boolean(params.start)!==Boolean(params.end)){errors.push('Choose both date bounds to filter the schedule.');}
   else if(year){
    const data=await root.UCVM_PAWS_DATA.schedulingTasks({academicYear:year,...params,limit:50,...(append?{cursor:nextCursor}:{})});
    if(!current(token))return;
    if(!Array.isArray(data.tasks)||!Number.isInteger(data.total))throw Error('Invalid queue response');
    tasks=append?[...tasks,...data.tasks]:data.tasks;total=data.total;nextCursor=data.nextCursor||null;facets=data.filters||{faculty:[],courses:[]};
    years=[...new Set([...years,...(data.academicYears||[]).map(row=>row.academicYear)].filter(Boolean))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
   }
  }catch(error){
   if(!current(token))return;
   if(append&&error?.code==='SCHEDULING_TASK_STALE'){loading=false;return refresh({message:'Scheduling data changed. The queue was refreshed.'});}
   tasks=[];total=0;nextCursor=null;errors.push('Schedule issues could not be loaded. Retry to refresh.');
  }
  if(current(token)){loading=false;updateOptions();render();}
 }
 function configure(options){
  adapter=options;if(panel)return;
  button=document.createElement('button');button.type='button';button.className='workspace-tool';button.id='workspace-tasks-toggle';button.setAttribute('aria-controls','workspace-tasks');button.textContent='Tasks';document.querySelector('.timetable-top-actions').append(button);
  panel=document.createElement('aside');panel.id='workspace-tasks';panel.className='workspace-tasks';panel.setAttribute('aria-label','Academic-year tasks');
  panel.innerHTML=`<div class="workspace-task-heading"><h2>Tasks</h2><button type="button" data-close aria-label="Close tasks">×</button></div><p class="workspace-task-caption">All weeks · Your authorized scope</p><label class="workspace-task-search">Search loaded tasks<input type="search" data-task-search placeholder="Faculty, course or issue"></label><details class="workspace-task-filters"><summary>Schedule filters</summary><label>Academic year<select aria-label="Academic year" data-task-year></select></label><div class="workspace-task-date-filters"><label>From date<input type="date" data-task-filter="start"></label><label>Before date<input type="date" data-task-filter="end"></label></div><label>Faculty<select aria-label="Faculty" data-task-filter="facultyKey"></select></label><label>Course<select aria-label="Course" data-task-filter="courseCode"></select></label><label>Conflict type<select aria-label="Conflict type" data-task-filter="type"><option value="">All issue types</option>${Object.entries(TYPES).map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></label><label>Review status<select aria-label="Review status" data-task-filter="reviewStatus"><option value="">All active issues</option><option value="Unreviewed">Unreviewed</option><option value="Reviewed">Reviewed</option></select></label><label>Undated records<select aria-label="Undated records" data-task-filter="undated"><option value="">Include undated</option><option value="only">Undated only</option><option value="exclude">Dated only</option></select></label><p>Filters apply to schedule issues. SWAP requests use the search above.</p></details><div class="workspace-task-tabs"><button type="button" data-filter="all">All</button><button type="button" data-filter="schedule">Schedule</button><button type="button" data-filter="requests">Requests</button></div><div class="workspace-task-list" aria-live="polite"></div>`;
  document.body.append(panel);button.onclick=()=>{toggle(panel.hidden);if(!panel.hidden)refresh();};panel.querySelector('[data-close]').onclick=()=>toggle(false);
  panel.querySelector('[data-task-search]').oninput=event=>{query=event.target.value.toLowerCase().trim();render();};
  panel.querySelector('[data-task-year]').onchange=event=>{year=event.target.value;refresh();};
  panel.querySelectorAll('[data-task-filter]').forEach(node=>node.onchange=event=>{if(event.target.value)params[node.dataset.taskFilter]=event.target.value;else delete params[node.dataset.taskFilter];refresh();});
  panel.querySelectorAll('[data-filter]').forEach(node=>node.onclick=()=>{mode=node.dataset.filter;render();});
  toggle(pref());render();
 }
 root.PAWS_TASKS=Object.freeze({configure,refresh});
})(window);
