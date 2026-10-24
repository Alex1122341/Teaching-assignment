(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const showFaculty=row=>root.PAWS_FACULTY_NAME?.format(row)||String(row?.displayName||'Name unavailable');
 const kinds={all:'All records',teaching:'Teaching',work:'Work beyond teaching',afc:'AFC / Leave',pending:'Pending absence',role:'Roles / Appointments'};
 const labels={busy:'Busy',away:'Away / Unavailable',tentative:'Tentative',ongoing:'Ongoing responsibility',time_unconfirmed:'Time unconfirmed',informational:'Recorded work (informational)'};
 function createFacultyAvailability({api,host,getSelfMode=()=>false}={}){
  if(!api||!host)throw Error('Availability host and data API required.');
  let generation=0,rosterGeneration=0,rosterTimer=null,selected='',cursor=null,items=[],loading=false,coverage=null,hasResult=false,roster=[];
  host.innerHTML='<div class="section-title">Faculty Availability</div><p class="aux-note">Read-only PAWS commitments, not a guarantee of open calendar time.</p>'+
   '<div class="availability-controls"><label>Faculty member<input id="availability-faculty" class="input" list="availability-faculty-options" autocomplete="off" placeholder="Search a faculty name"></label><datalist id="availability-faculty-options"></datalist>'+
   '<label>Dates<select id="availability-mode" class="select"><option value="upcoming">Ongoing and upcoming (default)</option><option value="from">From date onward</option><option value="range">Custom historical range</option></select></label>'+
   '<label id="availability-start-wrap" hidden>Start date<input id="availability-start" type="date" class="input"></label><label id="availability-end-wrap" hidden>End date<input id="availability-end" type="date" class="input"></label>'+
   '<label>Show<select id="availability-kind" class="select">'+Object.entries(kinds).map(([k,v])=>'<option value="'+esc(k)+'">'+esc(v)+'</option>').join('')+'</select></label>'+
   '<button type="button" class="btn btn-primary" id="availability-search">Search availability</button></div>'+
   '<div id="availability-status" class="aux-note" role="status" aria-live="polite">Select a faculty member.</div>'+
   '<div id="availability-summary"></div><div id="availability-events" class="availability-events"></div>'+
   '<button id="availability-more" class="btn" type="button" hidden>Load more records</button>';
  const $=id=>host.querySelector('#'+id);
  const picker=$('availability-faculty'),options=$('availability-faculty-options');
  const showModes=()=>{const mode=$('availability-mode').value;$('availability-start-wrap').hidden=mode==='upcoming';$('availability-end-wrap').hidden=mode!=='range';};
  $('availability-mode').addEventListener('change',showModes);
  const state=message=>{$('availability-status').textContent=message;};
  const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:'';
  function viewLine(event){
   const start=event.startDate?esc(event.startDate):'Date unknown',end=event.endDate&&event.endDate!==event.startDate?' – '+esc(event.endDate):'';
   const clock=event.startTime&&event.endTime?' · '+esc(event.startTime)+'–'+esc(event.endTime):'';
   const kind=kinds[event.kind]||'Record';
   const detail=event.detail?' · '+esc(event.detail):'';
   const evidence=Array.isArray(event.timeEvidence)?event.timeEvidence:[];
   const time=evidence.length?'<details><summary>Verified work times ('+evidence.length+')</summary>'+evidence.map(x=>'<div>'+esc(x.date)+' · '+esc(x.startTime)+'–'+esc(x.endTime)+'</div>').join('')+'</details>':'';
   return '<article class="availability-event"><div class="availability-event-top"><strong>'+esc(event.label)+'</strong><span class="availability-pill">'+esc(labels[event.availability]||'Needs review')+'</span></div>'+
    '<div class="availability-meta">'+start+end+clock+' · '+esc(kind)+detail+'</div>'+time+'</article>';
  }
  function render(){
   const counts=items.reduce((m,x)=>(m[x.kind]=(m[x.kind]||0)+1,m),{});
   $('availability-summary').innerHTML='<div class="availability-summary">'+Object.entries(counts).map(([k,n])=>'<span>'+esc(kinds[k]||k)+': <strong>'+n+'</strong></span>').join('')+'</div>'+
     ((coverage?.undatedSessions||coverage?.undatedRoles)?'<p class="availability-warning">Coverage warning: '+Number(coverage.undatedSessions||0)+' session(s) and '+Number(coverage.undatedRoles||0)+' role/appointment record(s) lack usable dates. This is incomplete coverage.</p>':'');
   $('availability-events').innerHTML=items.map(viewLine).join('')||(hasResult?'<p class="empty">No PAWS commitments found in the selected interval. No PAWS Conflict Found is not a guarantee of availability.</p>':'');
   $('availability-more').hidden=!cursor;
  }
  function dirty(message='Filters changed. Search again.'){
   generation++;selected='';items=[];cursor=null;coverage=null;hasResult=false;loading=false;
   $('availability-search').disabled=false;$('availability-more').disabled=false;render();state(message);
  }
  function cancelRoster(){rosterGeneration++;if(rosterTimer!==null){root.clearTimeout(rosterTimer);rosterTimer=null;}}
  async function loadRoster(search=''){
   cancelRoster();const token=rosterGeneration;
   state('Loading authorized faculty…');
   try{
    const value=await api.dashboardFaculty({search:search||null,limit:200,status:getSelfMode()?'active':'all'});
    if(token!==rosterGeneration)return;
    const rows=Array.isArray(value)?value:[],counts=new Map();
    rows.forEach(r=>{const n=showFaculty(r).toLowerCase();counts.set(n,(counts.get(n)||0)+1);});
    roster=rows.map((r,i)=>{const name=showFaculty(r);return {facultyId:r.facultyId,choice:counts.get(name.toLowerCase())>1?name+' · Faculty '+(i+1):name};});
    options.innerHTML=roster.map(r=>'<option value="'+esc(r.choice)+'"></option>').join('');
    if(!search&&roster.length===1){selected=String(roster[0].facultyId||'');picker.value=roster[0].choice;}
    state(roster.length===200?'Showing up to 200 matches. Type a more specific faculty name.':roster.length?'Select one faculty and search.':'No matching authorized faculty. Search another name.');
   }catch(error){if(token===rosterGeneration){roster=[];options.innerHTML='';state('Faculty list unavailable. Retry after signing in.');}}
  }
  async function search(more=false){
   if(loading)return;
   const before=generation;
   let matches=roster.filter(r=>r.choice.toLowerCase()===picker.value.trim().toLowerCase());
   if(!more&&matches.length!==1&&picker.value.trim()){
    await loadRoster(picker.value.trim());if(before!==generation)return;
    matches=roster.filter(r=>r.choice.toLowerCase()===picker.value.trim().toLowerCase());
   }
   if(more){if(!cursor)return;}else{
    if(matches.length!==1){state('Choose one unique faculty name from the list.');return;}
    selected=String(matches[0].facultyId||'');
   }
   const mode=$('availability-mode').value,startDate=date($('availability-start').value),endDate=date($('availability-end').value);
   if(!more&&((mode!=='upcoming'&&!startDate)||(mode==='range'&&(!endDate||endDate<startDate)))){state('Choose a valid start date and date range.');return;}
   loading=true;$('availability-search').disabled=true;$('availability-more').disabled=true;const token=more?generation:++generation;
   if(!more){items=[];cursor=null;coverage=null;hasResult=false;render();}
   state('Checking authorized SQL availability…');
   try{
    const result=await api.facultyAvailability({facultyId:selected,mode,startDate:mode==='upcoming'?null:startDate,endDate:mode==='range'?endDate:null,kind:$('availability-kind').value,cursor:more?cursor:null,limit:50});
    if(token!==generation)return;
    const seen=new Set(items.map(r=>r.eventKey));
    for(const row of result.items||[])if(!seen.has(row.eventKey)){items.push(row);seen.add(row.eventKey);}
    cursor=result.nextCursor||null;coverage=result.coverage||null;hasResult=true;render();
    state('Showing '+items.length+' of '+result.total+' records. '+(cursor?'More records available.':'Query complete.')+' PAWS does not include external calendar meetings.');
   }catch(error){if(token===generation)state('Availability unavailable ('+String(error?.code||'read failed')+'). No free-time conclusion can be made.');}
   finally{if(token===generation){loading=false;$('availability-search').disabled=false;$('availability-more').disabled=false;}}
  }
  $('availability-search').addEventListener('click',()=>search(false));
  $('availability-more').addEventListener('click',()=>search(true));
  for(const id of ['availability-faculty','availability-start','availability-end','availability-mode','availability-kind']){
   $(id).addEventListener('input',()=>dirty());$(id).addEventListener('change',()=>dirty());
  }
  picker.addEventListener('input',()=>{
   cancelRoster();if(roster.some(r=>r.choice.toLowerCase()===picker.value.trim().toLowerCase()))return;
   rosterTimer=root.setTimeout(()=>{rosterTimer=null;loadRoster(picker.value.trim());},200);
  });
  return Object.freeze({open:()=>{dirty('Loading authorized faculty…');return loadRoster();},clear:()=>{cancelRoster();dirty('Select a faculty member.');roster=[];picker.value='';options.innerHTML='';}});
 }
 root.PAWS_FACULTY_AVAILABILITY={createFacultyAvailability};
 if(root.document&&root.UCVM_PAWS_DATA){
   const host=root.document.getElementById('availability-view');
   const tab=root.document.querySelector('[data-tab="availability"]');
   if(host&&tab){
     const view=createFacultyAvailability({api:root.UCVM_PAWS_DATA,host,getSelfMode:()=>root.document.body.classList.contains('faculty-self-mode')});
     tab.addEventListener('click',()=>view.open());
     root.document.getElementById('signout-btn')?.addEventListener('click',()=>view.clear());
     root.firebase?.auth?.().onAuthStateChanged(()=>view.clear());
     let identity='';root.addEventListener('paws-profile',event=>{const p=event.detail?.profile;const key=JSON.stringify([p?.uid,p?.facultyId,p?.role,p?.baseRole,p?.active,event.detail?.support]);if(key!==identity){identity=key;view.clear();}});
   }
 }
})(typeof window!=='undefined'?window:globalThis);
