(function(root){
  'use strict';
  if(!root||!root.document||!root.PAWS_MULTI_YEAR_DEMO_MODEL)return;
  const doc=root.document;
  const E=value=>String(value===undefined||value===null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const roleCanWork=role=>['owner','developer','adfa_general','adfa_regular','administrator','admin','adc','lab','hicc','visc'].includes(role);
  const isAdfa=role=>['owner','developer','adfa_general','adfa_regular','administrator','admin'].includes(role);
  const opts=(items,value,label)=>items.map(item=>'<option value="'+E(value(item))+'">'+E(label(item))+'</option>').join('');
  let engine=null,selectedYear='',selectedCode='',tab='calendar',dialog=null,message='';
  function identity(){
    const demo=root.UCVM_PAWS_DEMO_API;
    const current=root.firebase&&root.firebase.auth&&root.firebase.auth().currentUser;
    if(!demo||!current)return null;
    const row=demo.store.tables.users.find(u=>u.firebaseUid===current.uid);
    return row&&row.active!==false?{uid:row.firebaseUid,role:String(row.baseRole||'faculty').toLowerCase(),facultyId:row.facultyId||null,name:row.displayName||row.firebaseUid}:null;
  }
  function load(){
    const demo=root.UCVM_PAWS_DEMO_API;
    if(!demo||!root.PAWS_MULTI_YEAR_DEMO_MODEL)throw Error('This workspace is only available in the PAWS browser-local Demo.');
    if(!engine)engine=root.PAWS_MULTI_YEAR_DEMO_MODEL.createEngine({storage:root.localStorage,source:demo.store.tables});
    return engine;
  }
  function actual(){const a=identity();if(!a)throw Error('Sign in to a synthetic Demo account before opening Academic Years.');return a;}
  function state(){return load().getState();}
  function current(){return state().annual[selectedYear]||{};}
  const facultyName=(s,id)=>s.faculty.find(f=>f.id===id)?.name||id||'Unassigned';
  function canEditCourse(s,a,code){if(isAdfa(a.role))return true;const fid=a.facultyId||s.users.find(u=>u.uid===a.uid)?.facultyId;return (s.roles[selectedYear]||[]).some(r=>r.status==='confirmed'&&r.facultyId===fid&&['HICC','Course Coordinator'].includes(r.roleType)&&r.scope.toUpperCase().startsWith(code));}
  function label(s,code){const row=s.annual[selectedYear]?.[code];if(!row)return code;const pub=row.published.at(-1);return code+' · '+row.title+(pub?' · Published v'+pub.version:(row.working.length?' · Draft':' · Empty Draft'))+(pub&&row.revision!==pub.revision?' · Changes Pending':'');}
  function table(headers,rows){if(!rows.length)return '<p class="paws-my-empty">No records for this view.</p>';
    return '<div class="paws-my-scroller"><table class="paws-my-table"><thead><tr>'+headers.map(h=>'<th>'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function input(label,name,type,extra){return '<label class="paws-my-field"><span>'+E(label)+'</span><input name="'+E(name)+'" type="'+E(type||'text')+'" '+(extra||'')+' required></label>';}
  function select(name,items,value,label){return '<select name="'+E(name)+'">'+opts(items,value,label)+'</select>';}
  function wrap(title,body){return '<section class="paws-my-panel"><h3>'+E(title)+'</h3>'+body+'</section>';}
  function guard(fn){try{const result=fn();message='Saved in this browser Demo only.';render();return result}catch(error){message=error.message||String(error);render();return null;}}
  function viewCalendar(a,s){
    if(['faculty','hicc','visc'].includes(a.role)&&s.years[selectedYear].status==='archived')return wrap('Historical Calendar','<p class="paws-my-warning">Archived Calendar is hidden for Faculty. Use Teaching or DOE to review your historical published records.</p>');
    const sessions=load().getCalendar(a,selectedYear);
    return wrap('Calendar · '+selectedYear,'<p class="paws-my-muted">'+(roleCanWork(a.role)&&!['faculty','hicc','visc'].includes(a.role)?'Staff Working sessions; archived years show the Published record.':'Published sessions visible to this Faculty.')+' This view is a browser-only simulation; the original Timetable remains unchanged.</p>'+table(['Date','Course','Topic','Type','Instructor','Room'],sessions.slice(0,140).map(x=>[E(x.date),E(x.courseCode),E(x.topic),E(x.sessionType),E(x.instructorNames||(x.assignments||[]).map(f=>facultyName(s,f.facultyId)).join('; ')),E(x.room)]))+'<p class="paws-my-muted">Showing '+Math.min(sessions.length,140)+' of '+sessions.length+' sessions.</p>');
  }
  function viewTeaching(a,s){
    const sessions=load().getTeaching(a,selectedYear);
    return wrap('Published Teaching · '+selectedYear,'<p class="paws-my-muted">Shows only the last formally Published Course version, including archived years. Working Draft is never shown here.</p>'+table(['Course','Date','Topic','Instructor','DOE credit'],sessions.slice(0,200).map(x=>[E(x.courseCode),E(x.date),E(x.topic),E((x.assignments||[]).map(f=>facultyName(s,f.facultyId)).join('; ')),E(isAdfa(a.role)||['faculty','hicc','visc'].includes(a.role)?(x.assignments||[]).reduce((n,f)=>n+(Number(f.doeCredit)||0),0):'Not available')])));
  }
  function viewCourses(a,s){
    const annual=s.annual[selectedYear]||{},yearState=s.years[selectedYear].status;
    const canPlan=roleCanWork(a.role)&&a.role!=='faculty';
    const codes=Object.keys(annual).filter(code=>canEditCourse(s,a,code)||annual[code].published.length>0).sort();
    if(!codes.includes(selectedCode))selectedCode=codes[0]||'';
    const canEdit=selectedCode&&canEditCourse(s,a,selectedCode);
    let html='<div class="paws-my-two"><div>'+wrap('Annual Courses',
       '<p class="paws-my-muted">Shared Catalog, separate Course/Session/Assignment records for every academic year.</p>'+
       (canPlan&&yearState!=='archived'?'<form data-my-form="add-course" class="paws-my-form"><label class="paws-my-field"><span>Select from Catalog</span>'+select('code',s.catalog.filter(c=>!annual[c.code]),c=>c.code,c=>c.code+' · '+c.title)+'</label><button type="submit">Add Course</button></form>':'')+
       '<div class="paws-my-course-list">'+codes.map(code=>'<button type="button" class="'+(code===selectedCode?'active':'')+'" data-my-select-course="'+E(code)+'">'+E(label(s,code))+'</button>').join('')+'</div>')+'</div><div>';
    if(!selectedCode||!annual[selectedCode])return html+wrap('Course detail','Select a Course to inspect its Working and Published information.')+'</div></div>';
    const row=annual[selectedCode],pub=row.published.at(-1),readWorking=canPlan&&canEdit,sessionRows=(readWorking?row.working:pub?.sessions||[]),prev=(String(Number(selectedYear.slice(0,4))-1)+'-'+String(Number(selectedYear.slice(0,4))%100).padStart(2,'0')),
      historical=(s.annual[prev]?.[selectedCode]?.published.at(-1)?.sessions)||[];
    let body='<p class="paws-my-muted">Annual title snapshot: '+E(row.title)+' · Working revision '+E(row.revision)+' · '+(pub?'Published version '+E(pub.version):'Not Published')+'</p>';
    if(canEdit&&yearState!=='archived'){
      if(isAdfa(a.role))body+='<button data-my-action="finalize">ADFAD Finalize Working revision</button> ';
      body+='<button data-my-action="publish">'+(pub?'Publish Changes':'Publish Course')+'</button>';
      body+='<form data-my-form="add-session" class="paws-my-form paws-my-grid">'+
        input('Date','date','date','min="'+selectedYear.slice(0,4)+'-05-01" max="'+String(Number(selectedYear.slice(0,4))+1)+'-04-30"')+
        input('Topic','topic','text','placeholder="Topic / Session"')+
        '<label class="paws-my-field"><span>Type</span>'+select('sessionType',['LEC','SRL','LAB','Other'],x=>x,x=>x)+'</label>'+
        '<label class="paws-my-field"><span>Faculty</span>'+select('facultyId',[{id:'',name:'Unassigned'},...s.faculty],f=>f.id,f=>f.name)+'</label>'+
        input('DOE credit','doeCredit','number','value="0" step="0.5"')+
        '<button type="submit">Add Session</button></form>';
    }
    body+=table(['Date / Topic','Assignments','Working actions'],sessionRows.slice(0,50).map(item=>{
      const editor=canEdit&&yearState!=='archived';
      const currentNames=(item.assignments||[]).map(x=>facultyName(s,x.facultyId)).join('; ');
      const edit=editor?'<form data-my-form="edit-assignment" data-session="'+E(item.id)+'" class="paws-my-inline">'+select('facultyId',[{id:'',name:'Unassigned'},...s.faculty],f=>f.id,f=>f.name)+'<button type="submit">Set Instructor</button></form>':'';
      const historic=editor&&historical.length?'<form data-my-form="copy-historical" data-session="'+E(item.id)+'" class="paws-my-inline">'+select('sourceId',historical,x=>x.id,x=>(x.topic||x.date)+' · '+(x.assignments||[]).map(y=>facultyName(s,y.facultyId)).join('; '))+'<button type="submit">Copy last year</button></form>':'';
      return [E(item.date)+' · '+E(item.topic),E(currentNames||'Unassigned'),edit+historic];
    }));
    body+='<p class="paws-my-muted">Showing '+Math.min(sessionRows.length,50)+' / '+sessionRows.length+' sessions. Historical assignment copying requires confirmation; only prior Published data is eligible.</p>';
    body+=wrap('Published release history',pub?table(['Version','Published by','Published at','Session count'],row.published.map(v=>[E(v.version),E(v.by),E(v.at),E(v.sessions.length)])):'<p>Not yet Published.</p>');
    return html+wrap(selectedCode+' · '+row.title,body)+'</div></div>';
  }
  function viewDoe(a,s){const d=s.doe[selectedYear],info=load().getDoe(a,selectedYear),admin=isAdfa(a.role),working=admin?load().getWorkingDoe(a,selectedYear):[];
    let body='<p><strong>Rule Book:</strong> '+E(d.policy.status)+' · <strong>Published DOE:</strong> '+(d.released?'Available':'Pending')+'</p>';
    if(admin&&s.years[selectedYear].status!=='archived'){
      if(d.policy.status!=='approved')body+='<button data-my-action="approve-doe">Approve annual DOE rules</button> ';
      if(!d.released)body+='<button data-my-action="publish-doe">Publish initial DOE</button>';
      body+='<form data-my-form="override" class="paws-my-form"><label class="paws-my-field"><span>Faculty</span>'+select('facultyId',s.faculty,x=>x.id,x=>x.name)+'</label>'+input('Manual override','value','number','step="0.5" value="10"')+'<button type="submit">Save Override</button></form>';
    }
    if(!d.released)body+='<p class="paws-my-warning">Pending · Faculty can see published Teaching but cannot see DOE until the initial DOE release.</p>';
    if(d.released){body+=table(['Faculty','Calculated','Override','Published effective','Review'],info.items.slice(0,80).map(x=>[E(facultyName(s,x.facultyId)),E(x.base),E(x.override===null?'—':x.override),E(x.effective),E(x.needsReview?'Needs ADFAD Review':'—')]));}
    if(admin)body+=wrap('Working DOE preview (internal only)',table(['Faculty','Working credit'],working.map(x=>[E(facultyName(s,x.facultyId)),E(x.base)])));
    return wrap('DOE · '+selectedYear,body);
  }
  function viewRoles(a,s){const showAll=isAdfa(a.role),roles=(s.roles[selectedYear]||[]).filter(r=>showAll||r.facultyId===a.facultyId);
    const body='<p class="paws-my-muted">Full-year eligible appointments are renewed for May 1–April 30. Partial/invalid records are Draft for ADFAD confirmation.</p>'+
      table(['Faculty','Role','Scope','Start','End','Status','Action'],roles.slice(0,200).map(r=>[E(facultyName(s,r.facultyId)),E(r.roleType),E(r.scope),E(r.start),E(r.end),E(r.status==='draft'?'Draft · '+(r.rolloverReason||'Review needed'):'Confirmed'),showAll&&r.status==='draft'&&s.years[selectedYear].status!=='archived'?'<button data-my-confirm-role="'+E(r.id)+'">Confirm</button>':'']));
    return wrap('Annual Roles & Appointments',body);
  }
  function viewArchive(a,s){const status=s.years[selectedYear].status,admin=isAdfa(a.role),isOwner=a.role==='owner';let html='<p><strong>Year status:</strong> '+E(status)+'</p>';
    if(isOwner){
      if(status==='archived')html+='<button data-my-action="restore">Restore Academic Year</button>';
      else html+='<button data-my-action="retire">Retire Academic Year</button>';
    }
    html+=wrap('Archive history',table(['Year','Archived at','Pending Course Drafts','Frozen conflicts'],s.archives.filter(x=>x.year===selectedYear).map(x=>[E(x.year),E(x.at),E(x.pending.join(', ')||'None'),E(x.conflicts.length)])));
    if(admin)html+=wrap('Live conflict check and shared AFC',
      '<p class="paws-my-muted">AFC records are shared by year. Retire freezes a conflict snapshot. Restore recalculates from the latest shared AFC.</p>'+
      '<form data-my-form="add-afc" class="paws-my-form"><label class="paws-my-field"><span>Faculty</span>'+select('facultyId',s.faculty,x=>x.id,x=>x.name)+'</label>'+input('Start','startDate','date','')+input('End','endDate','date','')+'<button type="submit">Add synthetic AFC</button></form>'+
      table(['Course','Date','Faculty'],load().getConflicts(a,selectedYear).map(x=>[E(x.courseCode),E(x.date),E(facultyName(s,x.facultyId))])));
    html+=wrap('Recent history',table(['When','Actor','Action'],s.audit.filter(x=>x.year===selectedYear).slice(-30).reverse().map(x=>[E(x.at),E(x.actor),E(x.event)])));
    return wrap('Archive / Restore',html);
  }
  function viewCatalog(a,s){let body='<p class="paws-my-muted">Global Catalog title changes apply only to courses created later. Existing annual Course snapshots remain unchanged.</p>';
    if(isAdfa(a.role))body+='<form data-my-form="update-catalog" class="paws-my-form"><label class="paws-my-field"><span>Catalog Course</span>'+select('code',s.catalog,c=>c.code,c=>c.code+' · '+c.title)+'</label>'+input('New title','title','text','maxlength="150"')+'<button type="submit">Update Catalog</button></form>';
    body+=table(['Course','Current Catalog title'],s.catalog.map(c=>[E(c.code),E(c.title)]));return wrap('Shared Course Catalog',body);
  }
  function render(){if(!dialog)return;const a=actual(),s=state();if(!s.years[selectedYear])selectedYear=load().getPreferredYear(a);
    const available=Object.keys(s.years).sort(),current=s.annual[selectedYear]||{};
    if(!current[selectedCode])selectedCode=Object.keys(current).sort()[0]||'';
    const showStaff=roleCanWork(a.role)&&a.role!=='faculty';
    const names=[['calendar','Calendar'],['teaching','Teaching'],['courses','Courses & Assignments'],['doe','DOE'],['roles','Roles'],['archive','Archive & AFC'],['catalog','Course Catalog']];
    const visible=names.filter(n=>!['courses','archive','catalog'].includes(n[0])||showStaff||n[0]==='courses'&&a.role==='faculty');
    let body='';try{body=({calendar:()=>viewCalendar(a,s),teaching:()=>viewTeaching(a,s),courses:()=>viewCourses(a,s),doe:()=>viewDoe(a,s),roles:()=>viewRoles(a,s),archive:()=>viewArchive(a,s),catalog:()=>viewCatalog(a,s)})[tab]();}catch(error){body=wrap('Access',E(error.message))}
    const createYear=a.role==='owner'&&s.years[selectedYear].status!=='archived'?'<button data-my-action="create-year" type="button">Create Next Year</button>':'';
    dialog.innerHTML='<div class="paws-my-shell"><header class="paws-my-head"><div><small>PAWS · Testing site only · Browser-local simulation</small><h2>Academic Year Workspace</h2><p>'+E(a.name)+' · '+E(a.role)+' · No database connection</p></div><button data-my-action="close" type="button" aria-label="Close Academic Year Workspace">Close ×</button></header>'+
      '<div class="paws-my-toolbar"><label>Academic Year <select data-my-year>'+opts(available,x=>x,x=>x+' · '+s.years[x].status)+'</select></label>'+createYear+'<button data-my-action="reset" type="button">Reset multi-year Demo</button></div>'+
      '<nav class="paws-my-tabs" aria-label="Multi-year test views">'+visible.map(x=>'<button class="'+(tab===x[0]?'active':'')+'" data-my-tab="'+E(x[0])+'" type="button">'+E(x[1])+'</button>').join('')+'</nav>'+
      (message?'<p class="paws-my-notice" role="status">'+E(message)+'</p>':'')+'<div class="paws-my-body">'+body+'</div></div>';
    const selectEl=dialog.querySelector('[data-my-year]');if(selectEl)selectEl.value=selectedYear;
  }
  function submitAction(form){const a=actual(),m=load(),values=Object.fromEntries(new FormData(form).entries()),kind=form.dataset.myForm;
    if(kind==='add-course')m.addCourse(a,selectedYear,values.code);
    if(kind==='add-session')m.addSession(a,selectedYear,selectedCode,{date:values.date,topic:values.topic,sessionType:values.sessionType,startTime:'08:30',endTime:'09:30',room:'',assignments:values.facultyId?[{facultyId:values.facultyId,teachingRole:'Instructor',doeCredit:Number(values.doeCredit)}]:[]});
    if(kind==='edit-assignment')m.editAssignment(a,selectedYear,selectedCode,form.dataset.session,values.facultyId);
    if(kind==='copy-historical'&&root.confirm('Copy the previous Published teacher into this Working Session?'))m.copyHistorical(a,selectedYear,selectedCode,form.dataset.session,values.sourceId);
    if(kind==='override')m.setOverride(a,selectedYear,values.facultyId,values.value);
    if(kind==='add-afc')m.addAfc(a,{afcRecordId:'demo-afc-'+Date.now(),facultyId:values.facultyId,startDate:values.startDate,endDate:values.endDate,active:true});
    if(kind==='update-catalog')m.updateCatalog(a,values.code,values.title);
  }
  function clickAction(action){const a=actual(),m=load();
    if(action==='close'){dialog.close();return;}
    if(action==='create-year'){
      const years=Object.keys(state().years).sort(),last=years[years.length-1],start=Number(last.slice(0,4))+1,next=start+'-'+String((start+1)%100).padStart(2,'0');
      m.createYear(a,next);selectedYear=next;selectedCode='';tab='courses';m.setPreferredYear(a,next);
    }
    if(action==='finalize')m.finalizeCourse(a,selectedYear,selectedCode);
    if(action==='publish'&&root.confirm('Publish the finalized Working Course for Faculty visibility?'))m.publishCourse(a,selectedYear,selectedCode);
    if(action==='approve-doe')m.approvePolicy(a,selectedYear);
    if(action==='publish-doe'&&root.confirm('Publish initial annual DOE for Faculty?'))m.publishDoe(a,selectedYear);
    if(action==='retire'){
      const s=state(),pending=Object.values(s.annual[selectedYear]||{}).filter(c=>!c.published.length||c.revision!==c.published.at(-1).revision).map(c=>c.code);
      if(root.confirm('Retire '+selectedYear+'? Published is official; '+pending.length+' Course(s) have unpublished Working content. Preserve all drafts read-only and freeze conflicts?'))m.retireYear(a,selectedYear,true);
    }
    if(action==='restore'&&root.confirm('Restore '+selectedYear+' and recalculate conflicts from current AFC?'))m.restoreYear(a,selectedYear);
    if(action==='reset'&&root.confirm('Reset only this browser-local multi-year workspace? Other PAWS Demo edits are unchanged.')){m.reset();selectedYear=m.getPreferredYear(a);selectedCode='';tab='calendar';}
  }
  function open(){try{
    const a=actual();load();selectedYear=load().getPreferredYear(a);selectedCode='';tab='calendar';message='';
    dialog=doc.createElement('dialog');dialog.id='paws-multi-year-demo';dialog.className='paws-my-dialog';doc.body.appendChild(dialog);
    dialog.addEventListener('close',()=>{dialog.remove();dialog=null;});
    dialog.addEventListener('click',event=>{
      const tabButton=event.target.closest('[data-my-tab]');if(tabButton){tab=tabButton.dataset.myTab;message='';render();return;}
      const course=event.target.closest('[data-my-select-course]');if(course){selectedCode=course.dataset.mySelectCourse;render();return;}
      const role=event.target.closest('[data-my-confirm-role]');if(role){guard(()=>load().confirmRole(actual(),selectedYear,role.dataset.myConfirmRole));return;}
      const action=event.target.closest('[data-my-action]');if(action)guard(()=>clickAction(action.dataset.myAction));
    });
    dialog.addEventListener('change',event=>{if(event.target.matches('[data-my-year]'))guard(()=>{const a=actual();selectedYear=event.target.value;selectedCode='';load().setPreferredYear(a,selectedYear);});});
    dialog.addEventListener('submit',event=>{event.preventDefault();guard(()=>submitAction(event.target));});
    dialog.showModal();render();
  }catch(error){root.alert(error.message||error);}}
  function mount(){if(doc.getElementById('paws-multi-year-open'))return;
    const target=doc.querySelector('.timetable-top-actions')||doc.querySelector('.top-actions')||doc.querySelector('.ucalgary-masthead-inner');if(!target)return;
    const button=doc.createElement('button');button.type='button';button.id='paws-multi-year-open';button.className='paws-my-launch';button.textContent='Academic Years · Demo';button.title='Test multi-year management using browser-local synthetic data';
    target.insertBefore(button,target.firstChild);button.addEventListener('click',open);
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount);else mount();
})(typeof window==='undefined'?null:window);
