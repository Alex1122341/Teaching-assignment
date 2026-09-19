/* HICC timetable + Spark-safe approval workflow for the main timetable only. */
(()=>{
 'use strict';
 if(!window.UCVM||typeof firebase==='undefined')return;
 const scheduling=window.UCVM_SCHEDULING,approvalScheduling=window.UCVM_APPROVAL_SCHEDULING;
 const officeCaps=window.UCVM_OFFICE_CAPABILITIES,officeView=window.UCVM_APPROVAL_OFFICE_VIEW,lifecycle=window.UCVM_APPROVAL_LIFECYCLE,finalizer=window.UCVM_APPROVAL_FINALIZER,approvalRequest=window.UCVM_APPROVAL_REQUEST,notifications=window.UCVM_WORKFLOW_NOTIFICATIONS;
 if(!scheduling||!approvalScheduling||!officeCaps||!officeView||!lifecycle||!finalizer||!approvalRequest)throw new Error('UCVM scheduling and routed approval helpers are required.');
 const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
 if(page&&page!=='index.html')return;

 const {auth,db}=UCVM.init();
 const $=id=>document.getElementById(id), esc=UCVM.esc;
 const REQUESTS='change_requests', SESSIONS='sessions', LOGS='session_change_log', WORKFLOWS='change_request_workflow', APPROVALS='change_request_approvals', PRIVATE_REQUESTS='change_request_private', REQUEST_AUDIT='change_request_audit', CALENDAR='calendar_sessions', SWAP_INDEX='faculty_swap_index';
 let me=null,user=null,role='',sessions=new Map(),people=[],peopleByUid=new Map(),groups=[],myGroups=[],hiccScope=new Set();
 let hiccMode=false,requests=[],afcRequests=[],requestUnsub=null,afcUnsub=null,sessionUnsub=null,groupUnsub=null,peopleLoading=null,renderQueued=false,requestLoadToken=0;
 let approvalFaculty=[],approvalFacultyById=new Map(),approvalFacultyLoaded=false;
 let approvalSessionsComplete=false,approvalSessionDatesLoaded=new Set(),openApprovalFromHash=location.hash==='#approvals';
 let requestsReady=false,afcRequestsReady=false,notificationUnsub=null;

 const css=document.createElement('style');
 css.id='ucvm-approval-workflow-style';
 css.textContent=`
 .workflow-btn{padding:5px 12px;font-size:12px;font-weight:650;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-2);white-space:nowrap}
 .workflow-btn:hover,.workflow-btn.active{border-color:var(--uc-red,#d6001c);color:var(--uc-red,#d6001c)}
 .workflow-count{display:inline-flex;min-width:18px;height:18px;padding:0 5px;align-items:center;justify-content:center;margin-left:4px;border-radius:999px;background:var(--uc-red,#d6001c);color:#fff;font-size:9px;font-weight:800}
 .workflow-modal-box{width:min(1080px,96vw)!important;max-height:90vh;overflow:auto}
 .workflow-note{font-size:11px;color:var(--text-3);line-height:1.45;margin:6px 0 12px}
 .workflow-card{border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin:8px 0;background:var(--surface)}
 .workflow-card.pending{border-left:4px solid #b7791f}.workflow-card.approved{border-left:4px solid #287a3f}.workflow-card.rejected{border-left:4px solid #b91c1c}
 .workflow-card-head{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}.workflow-card-title{font-weight:800}.workflow-card-meta{font-size:10px;color:var(--text-3)}
 .workflow-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.workflow-grid .form-field{margin:0}
 .workflow-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.workflow-pill{display:inline-block;padding:2px 6px;border:1px solid var(--border);border-radius:999px;font-size:9.5px;font-weight:750}
 .workflow-hidden-by-hicc{display:none!important}.workflow-session-pending{outline:2px dashed #b7791f;outline-offset:-2px}
 .workflow-swap-pending{outline:3px solid var(--uc-red,#d6001c)!important;outline-offset:1px!important;box-shadow:0 0 0 4px rgba(214,0,28,.16),0 5px 14px rgba(86,0,12,.2)!important}
 .workflow-swap-pending-label{position:absolute;top:3px;right:3px;z-index:3;display:inline-flex;align-items:center;padding:2px 5px;border-radius:3px;background:var(--uc-red,#d6001c);color:#fff;font-size:8px;font-weight:900;line-height:1.2;letter-spacing:.04em;white-space:nowrap;pointer-events:none}
 .schedule-list tr.workflow-swap-pending{outline:none!important;box-shadow:none!important}.schedule-list tr.workflow-swap-pending>td{background:#fff1f2!important;border-top:2px solid var(--uc-red,#d6001c);border-bottom:2px solid var(--uc-red,#d6001c)}
 .schedule-list tr.workflow-swap-pending>td:first-child{border-left:4px solid var(--uc-red,#d6001c)}.schedule-list tr.workflow-swap-pending>td:last-child{border-right:2px solid var(--uc-red,#d6001c)}
 .schedule-list .workflow-swap-pending-label{position:static;margin-right:6px;vertical-align:middle}
 .workflow-approval-change{margin-top:6px;font-size:11px}.workflow-approval-change strong{display:inline-block;min-width:90px}
 .workflow-impact{margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2)}
 .workflow-impact-title{font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3);margin-bottom:7px}
 .workflow-impact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
 .workflow-person{border:1px solid var(--border);border-radius:var(--radius);padding:8px;background:var(--surface)}
 .workflow-person-name{font-weight:800;margin-bottom:4px}.workflow-metric{font-size:10.5px;line-height:1.5;color:var(--text-2)}
 .workflow-check{margin-top:5px;padding:5px 7px;border-radius:4px;font-size:10px;font-weight:700}.workflow-check.ok{background:#ecfdf3;color:#166534;border:1px solid #a7d7b5}.workflow-check.warn{background:#fff1f2;color:#b91c1c;border:1px solid #f3b4ba}.workflow-check.unknown{background:var(--surface-3);color:var(--text-3);border:1px solid var(--border)}
 .workflow-credit{margin-bottom:7px;font-size:11px;font-weight:750}.workflow-edit-impact{display:flex;flex-direction:column;gap:6px}
 @media(max-width:680px){.workflow-grid,.workflow-impact-grid{grid-template-columns:1fr}}
 `;
 document.head.appendChild(css);

 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 const stamp=()=>firebase.firestore.FieldValue.serverTimestamp();
 const roleIsFaculty=r=>['faculty','hicc','visc'].includes(UCVM.role(r));
 const office=()=>officeCaps.officeForRole(role);
 const isOfficeApprover=()=>['adc','lab','adfa'].includes(office());
 const isAdfaApprover=()=>office()==='adfa';
 const isApprover=isAdfaApprover;
 const ownFacultyId=()=>String(me?.facultyId||me?.facultyDirectoryMatch?.id||'').trim();
 const ownAliases=()=>new Set([me?.name,me?.instructor,me?.facultyDirectoryMatch?.name,user?.displayName].map(norm).filter(Boolean));
 const peopleName=p=>String(p?.name||p?.email||p?.uid||'');
 const assignedArray=s=>Array.isArray(s?.assignments)&&s.assignments.length?s.assignments.map(a=>({...a})):(String(s?.instructor||'').split(';').map(x=>x.trim()).filter(Boolean).map(name=>({name,ucid:'',role:s?.type||''})));
 const sameVal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 const ymd=v=>String(v||'').slice(0,10);
 const num=UCVM.number;
 const fmtDoe=v=>v===null||v===undefined?'—':`${Number(v).toFixed(2)}%`;

 function facultyName(f){return String(f?.preferredFullName||f?.hrFirstLast||f?.hrFullName||f?.teachingAssignmentName||f?.facultySummary2026_27?.displayName||f?.__id||'Unknown faculty')}
 function facultyAliases(f){const out=new Set();[facultyName(f),f?.preferredFullName,f?.hrFirstLast,f?.hrFullName,f?.teachingAssignmentName,f?.facultySummary2026_27?.displayName].forEach(v=>{const k=norm(v);if(k)out.add(k)});if(f?.firstName&&f?.lastName)out.add(norm(`${f.firstName} ${f.lastName}`));const raw=String(f?.hrFullName||'').match(/^([^,]+),\s*(.+)$/);if(raw)out.add(norm(`${raw[2]} ${raw[1]}`));return out}
 function facultySummary(f){const x=f?.facultySummary2026_27;return x&&typeof x==='object'&&!Array.isArray(x)?x:null}
 function contractTeachingDoe(f){return [f?.doe?.teaching,f?.doeTeaching,f?.teachingDOE,f?.contractTeachingDOE].map(num).find(v=>v!==null)??null}
 function assignmentCredit(a){const c=num(a?.doeCredit);if(c!==null)return c;const r=num(a?.doeRate),h=num(a?.creditedHours);return r!==null&&h!==null?Number((r*h).toFixed(6)):null}
 function resolveFaculty(ref){const id=String(ref?.facultyId||ref?.ucid||'').trim();if(id&&approvalFacultyById.has(id))return approvalFacultyById.get(id);const key=norm(ref?.name||'');if(!key)return null;return approvalFaculty.find(f=>facultyAliases(f).has(key))||null}
 function indexFaculty(e){return{__id:String(e.id),preferredFullName:e.name||e.id,hrFullName:e.hrName||'',email:e.email||'',rank:e.rank||'',campus:e.campus||'',teachingArea:e.specialty||'',reportsTo:e.reportsTo||'',doe:e.contractTeachingDOE===null?{}:{teaching:e.contractTeachingDOE},facultySummary2026_27:e.assignedTeachingDOE===null?null:{assignedTeachingDOE:e.assignedTeachingDOE},__indexAssignedTeachingDOE:e.assignedTeachingDOE,__index:true}}
 function requestFacultyIds(requestRows){const ids=new Set();for(const r of requestRows||[]){for(const ref of [r.fromFaculty,r.toFaculty]){const id=String(ref?.facultyId||ref?.ucid||'').trim();if(id)ids.add(id)}const current=sessions.get(r.sessionId);for(const a of assignedArray(current)){const id=String(a?.ucid||a?.facultyId||'').trim();if(id)ids.add(id)}}return[...ids]}
 async function ensureApprovalFaculty(requestRows=requests,force=false){
  if(!isAdfaApprover())return;
  if(!approvalFacultyLoaded){const snap=await db.collection('settings').doc('faculty_index').get();approvalFaculty=snap.exists?(snap.data().entries||[]).map(indexFaculty):[];approvalFacultyById=new Map(approvalFaculty.map(f=>[String(f.__id),f]));approvalFacultyLoaded=true}
  const ids=requestFacultyIds(requestRows),missing=ids.filter(id=>force||approvalFacultyById.get(id)?.__index);
  const details=await Promise.all(missing.map(id=>db.collection('faculty').doc(id).get(force?{source:'server'}:undefined)));for(const snap of details)if(snap.exists){const old=approvalFacultyById.get(snap.id),row={__id:snap.id,...snap.data(),__indexAssignedTeachingDOE:old?.__indexAssignedTeachingDOE},at=approvalFaculty.indexOf(old);if(at>=0)approvalFaculty[at]=row;else approvalFaculty.push(row);approvalFacultyById.set(snap.id,row)}
 }
 async function ensureRequestSessions(requestRows){
  const ids=[...new Set((requestRows||[]).map(r=>String(r.sessionId||'')).filter(Boolean))],missing=ids.filter(id=>!sessions.has(id));
  const docs=await Promise.all(missing.map(id=>db.doc(`${SESSIONS}/${id}`).get()));for(const snap of docs)if(snap.exists)sessions.set(snap.id,{id:snap.id,...snap.data()});approvalSessionsComplete=true;
 }
 async function ensureFacultySessionContext(requestRows,force=false){
  const dates=[...new Set((requestRows||[]).flatMap(r=>[sessions.get(String(r.sessionId||''))?.date,r.patch?.date]).map(ymd).filter(Boolean))].filter(date=>force||!approvalSessionDatesLoaded.has(date));
  const sets=await Promise.all(dates.map(date=>db.collection(SESSIONS).where('date','==',date).get(force?{source:'server'}:undefined)));for(let i=0;i<sets.length;i++){for(const [id,row] of sessions)if(ymd(row.date)===dates[i])sessions.delete(id);for(const d of sets[i].docs)sessions.set(d.id,{id:d.id,...d.data()});approvalSessionDatesLoaded.add(dates[i])}
 }
 function buildDoeState(){
  const state=new Map(),aliases=new Map();
  for(const f of approvalFaculty){const s=facultySummary(f),fixed=num(s?.sourceNonTimetableTeachingDOE),sourceAssigned=num(s?.assignedTeachingDOE),indexedCurrent=num(f.__indexAssignedTeachingDOE);state.set(String(f.__id),{faculty:f,scheduled:0,fixed,sourceAssigned,indexedCurrent,contract:contractTeachingDoe(f)});for(const a of facultyAliases(f))if(!aliases.has(a))aliases.set(a,String(f.__id))}
  for(const sess of sessions.values())for(const a of assignedArray(sess)){let id=String(a?.ucid||'').trim();if(!id)id=aliases.get(norm(a?.name))||'';const row=state.get(id),credit=assignmentCredit(a);if(row&&credit!==null)row.scheduled+=credit}
  for(const row of state.values())row.current=row.indexedCurrent!==null?row.indexedCurrent:(row.fixed!==null?row.fixed+row.scheduled:(row.sourceAssigned!==null?row.sourceAssigned:null));
  return state;
 }
 function sessionHasFaculty(sess,f){const id=String(f?.__id||''),aliases=facultyAliases(f);return assignedArray(sess).some(a=>(id&&String(a?.ucid||'')===id)||aliases.has(norm(a?.name)))}
 function timetableCheck(f,date,start,end,excludeId='',timeUnknown=false){
  const check=scheduling.findFacultyConflicts({date:ymd(date),start,end,timeUnknown,sessions:[...sessions.values()],excludeSessionId:excludeId,isAssigned:s=>sessionHasFaculty(s,f)});
  return{status:check.status,available:check.status==='clear'?true:(check.status==='conflict'?false:null),conflicts:check.conflicts,possible:check.possibleConflicts,reason:check.reason==='target_time'?'time':(check.reason==='other_time_unknown'?'unknown':check.reason)};
 }
 function afcCheck(f,date){const d=ymd(date),records=Array.isArray(f?.awayFromCampusRecords)?f.awayFromCampusRecords:[];return{available:!records.some(x=>x&&x.startDate&&x.endDate&&String(x.startDate)<=d&&d<=String(x.endDate))}}
 function availabilityFor(f,date,start,end,excludeId='',timeUnknown=false){if(!f)return{available:null,afc:{available:null},tt:{available:null,conflicts:[],possible:[],reason:'faculty'}};const afc=afcCheck(f,date),tt=timetableCheck(f,date,start,end,excludeId,timeUnknown),bad=afc.available===false||tt.available===false;return{available:bad?false:(tt.available===null?null:true),afc,tt}}
 function conflictLabel(s){return `${s.course||'Course'} ${s.start||'—'}-${s.end||'—'}${s.topic?` · ${s.topic}`:''}`}
 function availabilityDetail(av,start,end){const parts=[];if(av.afc?.available===false)parts.push('AFC: Unavailable');if(av.tt?.available===false)parts.push(`Timetable conflict: ${av.tt.conflicts.map(conflictLabel).join('; ')}`);else if(av.tt?.available===true)parts.push(`Timetable clear ${start||'—'}-${end||'—'}`);else parts.push('Timetable check incomplete');if(av.tt?.possible?.length)parts.push(`Time-check needed: ${av.tt.possible.map(conflictLabel).join('; ')}`);return parts.join(' · ')}
 function availabilityHtml(av,start,end){const cls=av.available===true?'ok':av.available===false?'warn':'unknown',label=av.available===true?'Available / no conflict':av.available===false?'Conflict or unavailable':'Check needed';return `<div class="workflow-check ${cls}">${esc(label)} · ${esc(availabilityDetail(av,start,end))}</div>`}
 function doeProjectionText(current,projected,contract){let out=`Current assigned DOE: <strong>${fmtDoe(current)}</strong> → Projected: <strong>${fmtDoe(projected)}</strong>`;if(contract!==null){const rem=projected===null?null:contract-projected;out+=` · Contract Teaching DOE: <strong>${fmtDoe(contract)}</strong>`;if(rem!==null)out+=` · ${rem>=0?`${fmtDoe(rem)} remaining`:`${fmtDoe(Math.abs(rem))} over`}` }return out}

 function showModal(html){
  const modal=$('modal'); if(!modal)return;
  modal.innerHTML=`<div class="modal-box workflow-modal-box">${html}</div>`;
  modal.classList.add('open');
  modal.querySelectorAll('[data-workflow-close]').forEach(b=>b.onclick=()=>closeModal());
 }
 function closeModal(){const modal=$('modal');if(!modal)return;modal.classList.remove('open');modal.innerHTML=''}
 function toast(msg,error=false){
  const t=$('toast'); if(!t){alert(msg);return} t.textContent=msg;t.classList.toggle('error',error);t.classList.add('show');setTimeout(()=>t.classList.remove('show'),error?6000:3200);
 }

 async function ensureReplacementPeople(){
  if(people.length)return people;
  if(peopleLoading)return peopleLoading;
  // Reads the sanitized people index instead of listing /users. The index
  // carries only uid, display name, role, facultyId and normalised aliases, and
  // contains active accounts only - so no email, account state or office field
  // is exposed to a faculty-role reader.
  peopleLoading=db.doc('settings/people_index').get().then(snap=>{
    const entries=Array.isArray(snap.data()?.entries)?snap.data().entries:[];
    people=entries.filter(entry=>entry&&entry.uid).map(entry=>({...entry,role:UCVM.role(entry.role)}));
    peopleByUid=new Map(people.map(p=>[p.uid,p]));
    rebuildHiccScope();queueDecorate();return people;
  }).catch(e=>{console.warn('[workflow people]',e);return[]}).finally(()=>{peopleLoading=null});
  return peopleLoading;
 }
 function listenGroups(){
  if(groupUnsub){groupUnsub();groupUnsub=null}
  if(role!=='hicc'){groups=[];myGroups=[];hiccScope.clear();return}
  groupUnsub=db.collection('faculty_groups').where('ownerUid','==',user.uid).onSnapshot(q=>{
    groups=q.docs.map(d=>({id:d.id,...d.data()}));myGroups=groups;rebuildHiccScope();injectButtons();ensureReplacementPeople().then(()=>{rebuildHiccScope();queueDecorate()});
  },e=>console.warn('[workflow groups]',e));
 }
 function listenSessions(){
  if(sessionUnsub){sessionUnsub();sessionUnsub=null}
  if(!user)return;
  if(!window.UCVM_PAGE_DATA?.sessions)return;
  const sync=()=>{const rows=window.UCVM_PAGE_DATA.sessions();for(const s of rows)sessions.set(s.id,s);approvalSessionsComplete=false;rebuildHiccScope();queueDecorate()};
  window.addEventListener('ucvm:sessions-updated',sync);sync();sessionUnsub=()=>window.removeEventListener('ucvm:sessions-updated',sync);
 }
 async function loadRoutedBundle(id,seedApproval=null){
  const [requestSnap,workflowSnap]=await Promise.all([db.doc(`${REQUESTS}/${id}`).get(),db.doc(`${WORKFLOWS}/${id}`).get()]);
  if(!requestSnap.exists||!workflowSnap.exists)return null;
  const request={id:requestSnap.id,...requestSnap.data()},workflow={id:workflowSnap.id,...workflowSnap.data()};
  const approvalRows={};
  const required=[...new Set(workflow.requiredOffices||[])];
  const docs=await Promise.all(required.map(name=>db.doc(`${APPROVALS}/${id}_${name}`).get()));
  docs.forEach((snap,index)=>{if(snap.exists)approvalRows[required[index]]={id:snap.id,...snap.data()}});
  if(seedApproval?.office)approvalRows[seedApproval.office]=seedApproval;
  return{...request,_workflow:workflow,_approvals:approvalRows};
 }
 async function hydrateRoutedRows(rows,token){
  const out=[];
  for(const row of rows){
   if(token!==requestLoadToken)return[];
   if(row.requestSchema==='office-routing-v1'){const full=await loadRoutedBundle(row.id);if(full)out.push(full)}else out.push(row);
  }
  return out;
 }
 function sortRequests(rows){return rows.sort((a,b)=>((b.requestedAt?.toMillis?.()||0)-(a.requestedAt?.toMillis?.()||0)))}
 function commitRequestRows(rows,token){if(token!==requestLoadToken)return;requests=sortRequests(rows);requestsReady=true;injectButtons();queueDecorate()}
 function listenRequests(){
  if(requestUnsub){requestUnsub();requestUnsub=null}
  if(!user)return;
  const token=++requestLoadToken,currentOffice=office();
  if(currentOffice==='adc'||currentOffice==='lab'){
   const q=db.collection(APPROVALS).where('office','==',office());
   requestUnsub=q.onSnapshot(async snap=>{
    try{
     const own=snap.docs.map(d=>({id:d.id,...d.data()})),rows=[];
     for(const approval of own){const full=await loadRoutedBundle(String(approval.requestId||''),approval);if(full)rows.push(full)}
     commitRequestRows(rows,token);
    }catch(e){if(token===requestLoadToken){requestsReady=true;console.warn('[workflow office requests]',e);injectButtons()}}
   },e=>{if(token===requestLoadToken){requestsReady=true;console.warn('[workflow office requests]',e);injectButtons()}});
   return;
  }
  let q=db.collection(REQUESTS);
  if(!isAdfaApprover())q=q.where('requesterUid','==',user.uid);
  requestUnsub=q.onSnapshot(async snap=>{
   try{
    const base=snap.docs.map(d=>({id:d.id,...d.data()}));
    const rows=isAdfaApprover()?await hydrateRoutedRows(base,token):base;
    commitRequestRows(rows,token);
   }catch(e){if(token===requestLoadToken){requestsReady=true;console.warn('[workflow requests]',e);injectButtons()}}
  },e=>{if(token===requestLoadToken){requestsReady=true;console.warn('[workflow requests]',e);injectButtons()}});
 }
 function listenAfcRequests(){
  if(afcUnsub){afcUnsub();afcUnsub=null}
  afcRequests=[];if(!user||!isApprover()){afcRequestsReady=true;injectButtons();return}
  afcUnsub=db.collection('afc_requests').where('status','in',['pending_report_to','pending_admin']).limit(100).onSnapshot(s=>{afcRequests=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.submittedAt?.toMillis?.()||0)-(a.submittedAt?.toMillis?.()||0));afcRequestsReady=true;injectButtons()},e=>{afcRequestsReady=true;console.warn('[workflow AFC requests]',e);injectButtons()});
 }

 function groupTokens(g){
  const vals=[g?.name,g?.tag,g?.groupTag].flatMap(v=>Array.isArray(v)?v:[v]);
  return vals.map(norm).filter(Boolean);
 }
 function sessionTextTokens(s){
  const raw=[s?.course,s?.topic,s?.groupTag,s?.hicc,s?.category,...(Array.isArray(s?.groupTags)?s.groupTags:[])];
  return raw.map(norm).filter(Boolean);
 }
 function sessionMatchesGroup(s,g){
  if(!s||!g)return false;
  const courseIds=new Set((g.courseIds||[]).map(v=>norm(v)).filter(Boolean));
  if(courseIds.has(norm(s.course)))return true;
  const gt=groupTokens(g), st=sessionTextTokens(s);
  if(gt.some(t=>st.some(v=>v===t||v.includes(t)||t.includes(v))))return true;
  const memberProfiles=(g.memberUids||[]).map(uid=>peopleByUid.get(uid)).filter(Boolean);
  const facultyIds=new Set(memberProfiles.map(p=>String(p.facultyId||'').trim()).filter(Boolean));
  const aliases=new Set(memberProfiles.flatMap(p=>[p.name,...(p.aliases||[])].map(norm).filter(Boolean)));
  return assignedArray(s).some(a=>facultyIds.has(String(a.ucid||'').trim())||aliases.has(norm(a.name)));
 }
 function rebuildHiccScope(){
  hiccScope=new Set();
  if(role==='hicc')for(const [id,s] of sessions)if(myGroups.some(g=>sessionMatchesGroup(s,g)))hiccScope.add(id);
  queueDecorate();
 }

 function toolbar(){return document.querySelector('.cal-toolbar-right')}
 function mkButton(id,label){let b=$(id);if(b)return b;b=document.createElement('button');b.id=id;b.className='workflow-btn';b.type='button';b.textContent=label;return b}
 function maybeOpenApprovalFromHash(){
  if(!openApprovalFromHash||!isOfficeApprover()||!requestsReady||!afcRequestsReady)return;
  openApprovalFromHash=false;setTimeout(()=>openApprovalQueue(),0);
 }
 function injectButtons(){
  const bar=toolbar();if(!bar||!user)return;
  if(role==='hicc'){
    const b=mkButton('hicc-timetable-btn','HICC Timetable');
    if(!b.isConnected){const my=$('my-timetable-btn');my?.insertAdjacentElement('afterend',b)}
    b.onclick=()=>{hiccMode=!hiccMode;b.classList.toggle('active',hiccMode);b.textContent=hiccMode?'Show All Timetable':'HICC Timetable';if(hiccMode&&$('my-timetable-btn')?.textContent==='Show All Timetable')$('my-timetable-btn').click();queueDecorate()};
  }else $('hicc-timetable-btn')?.remove();

  if(roleIsFaculty(role)){
    const mine=requests.filter(r=>r.status==='pending').length,b=mkButton('my-requests-btn','Requests');
    b.innerHTML=`Requests${mine?` <span class="workflow-count">${mine}</span>`:''}`;
    if(!b.isConnected)bar.insertBefore(b,bar.firstChild);b.onclick=()=>openMyRequests();
  }else $('my-requests-btn')?.remove();

  if(isOfficeApprover()){
    const currentOffice=office(),pending=requests.filter(r=>r.requestSchema==='office-routing-v1'?r._approvals?.[currentOffice]?.status==='pending':(isAdfaApprover()&&r.status==='pending')).length+(isAdfaApprover()?afcRequests.filter(r=>['pending_report_to','pending_admin'].includes(r.status)).length:0),b=mkButton('approval-queue-btn','Approvals');
    const label=officeView.queueLabel(currentOffice,pending),plain=label.replace(/ \(\d+\)$/,'');
    b.innerHTML=`${esc(plain)}${pending?` <span class="workflow-count">${pending}</span>`:''}`;
    if(!b.isConnected)bar.insertBefore(b,bar.firstChild);b.onclick=()=>openApprovalQueue();
    maybeOpenApprovalFromHash();
  }else $('approval-queue-btn')?.remove();
 }

 function realignVisible(){
  document.querySelectorAll('.tg-day-col').forEach(col=>{
    const items=[...col.querySelectorAll('.tg-block:not(.workflow-hidden-by-hicc)')].map(block=>({block,start:parseFloat(block.style.top),end:parseFloat(block.style.top)+parseFloat(block.style.height)})).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)).sort((a,b)=>a.start-b.start||a.end-b.end);
    let active=[];
    for(const item of items){active=active.filter(x=>x.end>item.start+.0001);active.push(item);const count=active.length;if(count===1){item.block.style.left='2px';item.block.style.width='calc(100% - 4px)'}else active.forEach((x,i)=>{x.block.style.left=`calc(${i*(100/count)}% + 2px)`;x.block.style.width=`calc(${100/count}% - 4px)`})}
  });
 }
 function decorate(){
  renderQueued=false;
  const pendingIds=new Set(requests.filter(r=>r.status==='pending').map(r=>String(r.sessionId||'')));
  const pendingSwapIds=new Set(requests.filter(r=>r.status==='pending'&&r.requestType==='faculty_swap').map(r=>String(r.sessionId||'')));
  document.querySelectorAll('[data-session-id]').forEach(el=>{
    const id=String(el.dataset.sessionId||''),hasPendingSwap=pendingSwapIds.has(id);
    el.classList.toggle('workflow-hidden-by-hicc',hiccMode&&role==='hicc'&&!hiccScope.has(id));
    el.classList.toggle('workflow-session-pending',pendingIds.has(id));
    el.classList.toggle('workflow-swap-pending',hasPendingSwap);
    const labelHost=el.matches('tr')?el.querySelector('td:first-child'):el;
    const existingLabel=labelHost?.querySelector(':scope > .workflow-swap-pending-label');
    if(hasPendingSwap&&labelHost&&!existingLabel){const label=document.createElement('span');label.className='workflow-swap-pending-label';label.textContent='SWAP PENDING';labelHost.prepend(label)}
    else if(!hasPendingSwap)existingLabel?.remove();
  });
  if(hiccMode)realignVisible();
 }
 function queueDecorate(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(decorate)}
 new MutationObserver(m=>{if(m.some(x=>[...x.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('[data-session-id],.cal-toolbar-right')||n.querySelector?.('[data-session-id],.cal-toolbar-right'))))){injectButtons();queueDecorate()}}).observe(document.documentElement,{childList:true,subtree:true});

 function selfAssignmentIndexes(s){
  const fid=ownFacultyId(),aliases=ownAliases();return assignedArray(s).map((a,i)=>({a,i})).filter(x=>(fid&&String(x.a.ucid||'')===fid)||aliases.has(norm(x.a.name))).map(x=>x.i);
 }
 function groupForSession(s){return myGroups.find(g=>sessionMatchesGroup(s,g))||null}
 function personByFacultyId(id){return people.find(p=>String(p.facultyId||'')===String(id||''))||null}
 function optionPeople(list,excludeFacultyIds=new Set()){
  return list.filter(p=>p.facultyId&&!excludeFacultyIds.has(String(p.facultyId))).sort((a,b)=>peopleName(a).localeCompare(peopleName(b))).map(p=>`<option value="${esc(p.uid)}">${esc(peopleName(p))}</option>`).join('');
 }

 document.addEventListener('click',ev=>{
  if(!roleIsFaculty(role))return;
  const block=ev.target.closest?.('[data-session-id]');if(!block)return;
  const s=sessions.get(block.dataset.sessionId);if(!s)return;
  ev.preventDefault();ev.stopImmediatePropagation();ev.stopPropagation();openFacultySession(s);
 },true);

 function sessionSummary(s){return `<div class="workflow-card"><div class="workflow-card-title">${esc(s.course||'')} · ${esc(s.type||'')}</div><div>${esc(s.topic||'')}</div><div class="workflow-card-meta">${esc(ymd(s.date))} · ${esc(s.start||'')}–${esc(s.end||'')} · ${esc(s.room||'')}</div><div class="workflow-card-meta">Faculty: ${esc(assignedArray(s).map(a=>a.name).filter(Boolean).join('; ')||'TBD')}</div></div>`}
 function openFacultySession(s){
  const g=role==='hicc'?groupForSession(s):null,own=selfAssignmentIndexes(s),canHicc=!!g;
  showModal(`<div class="modal-header"><div class="modal-title">${esc(s.course||'')} · ${esc(s.topic||'')}</div><div class="modal-subtitle">Requests do not change the live timetable until ADFA approves them.</div></div><div class="modal-body">${sessionSummary(s)}${canHicc?`<div class="workflow-note">HICC scope: <strong>${esc(g.name||'')}</strong>. This session is included because its course/tag matches the group or a group member is assigned.</div>`:''}<div class="workflow-actions">${canHicc?'<button class="btn btn-primary" id="workflow-hicc-edit">Request session change</button><button class="btn btn-primary" id="workflow-hicc-swap">Request HICC faculty swap</button>':''}<button class="btn btn-secondary" id="workflow-self-swap">${own.length?'Request replacement for me':'Request to take this session'}</button></div></div><div class="modal-footer"><button class="btn btn-secondary" data-workflow-close>Close</button></div>`);
  $('workflow-self-swap').onclick=()=>{
   const openSelfReplacement=window.UCVM_SAFE_SWAP?.openSelfReplacement;
   if(own.length&&typeof openSelfReplacement==='function')return openSelfReplacement(s);
   return openSelfSwap(s);
  };
  if(canHicc){$('workflow-hicc-edit').onclick=()=>openHiccEdit(s,g);$('workflow-hicc-swap').onclick=()=>openHiccSwap(s,g)}
 }

 async function createRequest(payload){
  if(!window.UCVM_APPROVAL_REQUEST)throw Error('UCVM approval request helper is required.');
  await window.UCVM_APPROVAL_REQUEST.submit({db,requester:{uid:user.uid,name:me?.name||user.displayName||'Faculty',role},payload,now:stamp()});
  closeModal();toast('Request submitted for approval.');
 }
 function baseSnapshot(s){return window.UCVM_APPROVAL_REQUEST.publicSession(s)}

 function openHiccEdit(s,g){
  showModal(`<div class="modal-header"><div class="modal-title">Request HICC session change</div><div class="modal-subtitle">${esc(g.name)} · ADFA approval required</div></div><form id="workflow-edit-form"><div class="modal-body">${sessionSummary(s)}<div class="workflow-grid"><label class="form-field"><span class="form-label">Date</span><input class="form-input" name="date" type="date" value="${esc(ymd(s.date))}"></label><label class="form-field"><span class="form-label">Room</span><input class="form-input" name="room" value="${esc(s.room||'')}"></label><label class="form-field"><span class="form-label">Start</span><input class="form-input" name="start" type="time" value="${esc(s.start||'')}"></label><label class="form-field"><span class="form-label">End</span><input class="form-input" name="end" type="time" value="${esc(s.end||'')}"></label><label class="form-field" style="grid-column:1/-1"><span class="form-label">Session name / topic</span><input class="form-input" name="topic" value="${esc(s.topic||'')}"></label><label class="form-field"><span class="form-label">Type</span><input class="form-input" name="type" value="${esc(s.type||'')}"></label><label class="form-field"><span class="form-label">Reason / note</span><input class="form-input" name="reason" placeholder="Optional"></label></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
  $('workflow-edit-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),patch={date:f.get('date'),start:f.get('start'),end:f.get('end'),topic:String(f.get('topic')||'').trim(),type:String(f.get('type')||'').trim(),room:String(f.get('room')||'').trim()},before=baseSnapshot(s),changes=[];for(const k of Object.keys(patch))if(!sameVal(before[k],patch[k]))changes.push({field:k,before:before[k],after:patch[k]});if(!changes.length)return toast('No changes were entered.',true);try{await createRequest({requestType:'session_edit',scope:'hicc',groupId:g.id,groupName:g.name||'',sessionId:s.id,course:s.course||'',date:ymd(s.date),topic:s.topic||'',base:before,patch,changes,reason:String(f.get('reason')||'').trim()})}catch(e){toast(e.message,true)}};
 }

 async function openHiccSwap(s,g){
  await ensureReplacementPeople();
  const arr=assignedArray(s),members=(g.memberUids||[]).map(uid=>peopleByUid.get(uid)).filter(p=>p?.facultyId),existing=new Set(arr.map(a=>String(a.ucid||'')).filter(Boolean));
  if(!arr.length)return toast('This session has no assigned faculty to swap.',true);
  showModal(`<div class="modal-header"><div class="modal-title">Request HICC faculty swap</div><div class="modal-subtitle">${esc(g.name)} · group-member replacement · ADFA approval required</div></div><form id="workflow-hicc-swap-form"><div class="modal-body">${sessionSummary(s)}<label class="form-field"><span class="form-label">Replace current instructor</span><select class="form-select" name="out">${arr.map((a,i)=>`<option value="${i}">${esc(a.name||'Unknown')}</option>`).join('')}</select></label><label class="form-field"><span class="form-label">With HICC group member</span><select class="form-select" name="to">${optionPeople(members,existing)}</select></label><label class="form-field"><span class="form-label">Reason / note</span><input class="form-input" name="reason" placeholder="Optional"></label><div class="workflow-note">Only active dashboard accounts that are members of this HICC group are shown as HICC replacement candidates.</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
  $('workflow-hicc-swap-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),idx=Number(f.get('out')),incoming=peopleByUid.get(String(f.get('to')||'')),out=arr[idx];if(!out||!incoming)return toast('Select both faculty members.',true);try{await createSwapRequest(s,out,idx,incoming,'hicc',g,String(f.get('reason')||''))}catch(e){toast(e.message,true)}};
 }

 async function openSelfSwap(s){
  await ensureReplacementPeople();
  const arr=assignedArray(s),own=selfAssignmentIndexes(s),myPerson=people.find(p=>p.uid===user.uid)||{uid:user.uid,name:me?.name||me?.instructor||user.email,facultyId:ownFacultyId(),active:true};
  if(!myPerson.facultyId)return toast('Your account needs a linked faculty record before you can request a swap.',true);
  if(own.length){
    const idx=own[0],out=arr[idx],existing=new Set(arr.map(a=>String(a.ucid||'')).filter(Boolean));
    showModal(`<div class="modal-header"><div class="modal-title">Request replacement for me</div><div class="modal-subtitle">You are currently assigned. ADFA approval is required.</div></div><form id="workflow-self-swap-form"><div class="modal-body">${sessionSummary(s)}<div class="workflow-card">You: <strong>${esc(out.name||peopleName(myPerson))}</strong></div><label class="form-field"><span class="form-label">Replace me with</span><select class="form-select" name="to">${optionPeople(people.filter(p=>p.uid!==user.uid),existing)}</select></label><label class="form-field"><span class="form-label">Reason / note</span><input class="form-input" name="reason" placeholder="Optional"></label></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
    $('workflow-self-swap-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),incoming=peopleByUid.get(String(f.get('to')||''));if(!incoming)return toast('Choose a replacement faculty member.',true);try{await createSwapRequest(s,out,idx,incoming,'self',null,String(f.get('reason')||''))}catch(e){toast(e.message,true)}};
  }else{
    if(!arr.length)return toast('This session has no current instructor to replace.',true);
    showModal(`<div class="modal-header"><div class="modal-title">Request to take this session</div><div class="modal-subtitle">You are not currently assigned. Choose the instructor you would replace; ADFA approval is required.</div></div><form id="workflow-self-take-form"><div class="modal-body">${sessionSummary(s)}<label class="form-field"><span class="form-label">I will replace</span><select class="form-select" name="out">${arr.map((a,i)=>`<option value="${i}">${esc(a.name||'Unknown')}</option>`).join('')}</select></label><label class="form-field"><span class="form-label">Reason / note</span><input class="form-input" name="reason" placeholder="Optional"></label></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
    $('workflow-self-take-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),idx=Number(f.get('out')),out=arr[idx];if(!out)return toast('Choose an instructor to replace.',true);try{await createSwapRequest(s,out,idx,myPerson,'self',null,String(f.get('reason')||''))}catch(e){toast(e.message,true)}};
  }
 }

 async function createSwapRequest(s,out,idx,incoming,scope,g,reason){
  let fromFacultyId=String(out.ucid||''); if(scope==='self'&&selfAssignmentIndexes(s).includes(idx))fromFacultyId=ownFacultyId(); const toFacultyId=String(incoming.facultyId||'');
  if(!toFacultyId)throw Error('The replacement account has no linked faculty record.');
  await createRequest({requestType:'faculty_swap',scope,groupId:g?.id||'',groupName:g?.name||'',sessionId:s.id,course:s.course||'',date:ymd(s.date),topic:s.topic||'',base:baseSnapshot(s),assignmentIndex:idx,fromFaculty:{facultyId:fromFacultyId,name:out.name||''},toFaculty:{uid:incoming.uid||'',facultyId:toFacultyId,name:peopleName(incoming)},reason:String(reason||'').trim()});
 }

 function statusLabel(r){return({approved:'Approved',rejected:'Rejected',withdrawn:'Withdrawn',update_required:'Pending - Update required',pending:'Pending'})[r?.status]||'Pending'}
 function approvalMatrix(r){return Object.fromEntries(Object.entries(r?._approvals||{}).map(([name,row])=>[name,String(row?.status||'pending')]))}
 function fieldOffice(r,field){for(const name of ['adc','lab','adfa'])if((r?._workflow?.scopes?.[name]||[]).includes(field))return name;return''}
 function officeStatusText(r,name){const value=String(r?._approvals?.[name]?.status||'pending');return value.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
 function requestDetail(r,officeContext=false){
  if(r.requestSchema!=='office-routing-v1'){
   if(r.requestType==='faculty_swap')return `<div class="workflow-approval-change"><strong>Faculty swap</strong>${esc(r.fromFaculty?.name||'')} → ${esc(r.toFaculty?.name||'')}</div>`;
   return (r.changes||[]).map(c=>`<div class="workflow-approval-change"><strong>${esc(c.field)}</strong>${esc(c.before)} → ${esc(c.after)}</div>`).join('');
  }
  const view=officeView.requestView({office:officeContext?office():'',request:r,workflow:r._workflow||{},approvalMatrix:approvalMatrix(r)});
  const rows=view.fields.map(change=>{const owner=fieldOffice(r,change.field),state=owner&&officeContext?` <span class="workflow-pill">${esc(owner.toUpperCase())}: ${esc(officeStatusText(r,owner))}</span>`:'';return `<div class="workflow-approval-change${change.owned?'':' role-locked-field'}"><strong>${esc(change.field)}</strong>${esc(change.before)} → ${esc(change.after)}${state}</div>`}).join('');
  const faculty=view.faculty.proposedName?`<div class="workflow-approval-change${officeContext&&office()!=='adfa'?' role-locked-field':''}"><strong>Faculty Assignment</strong>${view.faculty.currentName?`${esc(view.faculty.currentName)} → `:''}${esc(view.faculty.proposedName)}${officeContext?` <span class="workflow-pill">ADFA: ${esc(officeStatusText(r,'adfa'))}</span>`:''}</div>`:'';
  return rows+faculty;
 }
 function routedActionHtml(r){
  const currentOffice=office(),own=r?._approvals?.[currentOffice];if(!own||own.status!=='pending'||r.status!=='pending')return'';
  const otherApproved=(r._workflow?.requiredOffices||[]).filter(name=>name!==currentOffice).every(name=>r._approvals?.[name]?.status==='approved');
  if(r._workflow?.hasFacultyChange&&currentOffice==='adfa'&&!otherApproved)return '<div class="workflow-note">Waiting for the other required office approvals before ADFA final approval and apply.</div>';
  return `<div class="workflow-actions"><button class="btn btn-primary" data-office-decision="approve" data-request-id="${esc(r.id)}">Approve${r._workflow?.hasFacultyChange&&currentOffice==='adfa'?' & apply':''}</button><button class="btn btn-secondary" data-office-decision="push_back" data-request-id="${esc(r.id)}">Push Back</button><button class="btn btn-secondary" data-office-decision="reject" data-request-id="${esc(r.id)}">Reject</button></div>`;
 }
 function requesterActionHtml(r){if(r.requestSchema!=='office-routing-v1'||!['pending','update_required'].includes(r.status))return'';return `<div class="workflow-actions">${r.status==='update_required'?`<button class="btn btn-primary" data-request-resubmit="${esc(r.id)}">Edit & Resubmit</button>`:''}<button class="btn btn-secondary" data-request-withdraw="${esc(r.id)}">Withdraw Request</button></div>`}
 function requestCard(r,admin=false){
  const when=r.requestedAt?.toDate?.().toLocaleString('en-CA',{timeZone:'America/Edmonton'})||'Pending timestamp';
  const routed=r.requestSchema==='office-routing-v1',currentOffice=office(),own=r?._approvals?.[currentOffice];
  const impact=admin&&isAdfaApprover()&&routed&&r.status==='pending'&&own?.status==='pending'?`<div class="workflow-impact" data-approval-impact="${esc(r.id)}"><div class="workflow-impact-title">DOE & schedule checks</div>Checking live DOE and timetable conflicts…</div>`:'';
  const actions=admin?(routed?routedActionHtml(r):(isAdfaApprover()&&r.status==='pending'?`<div class="workflow-actions"><button class="btn btn-primary" data-approve-request="${esc(r.id)}">Approve & apply</button><button class="btn btn-secondary" data-reject-request="${esc(r.id)}">Reject</button></div>`:'')):requesterActionHtml(r);
  return `<div class="workflow-card ${esc(r.status||'pending')}"><div class="workflow-card-head"><div><div class="workflow-card-title">${esc(r.course||r.basePublic?.course||'')} · ${esc(r.topic||r.basePublic?.topic||'')}</div><div class="workflow-card-meta">${esc(r.requesterName||r.requesterEmail||'')} · ${esc(UCVM.label(r.requesterRole||''))} · ${esc(when)}</div></div><span class="workflow-pill">${statusLabel(r)}</span></div>${requestDetail(r,admin)}${r.reason?`<div class="workflow-note">Reason: ${esc(r.reason)}</div>`:''}${r.requesterMessage?`<div class="workflow-note">Update requested: ${esc(r.requesterMessage)}</div>`:''}${impact}${actions}</div>`;
 }
 function afcStatus(s){return({pending_report_to:'Reports To signature needed',pending_admin:'ADMIN signature needed',approved:'Approved',rejected:'Rejected'})[s]||s}
 function afcCard(r,active=false){const when=r.submittedAt?.toDate?.().toLocaleString('en-CA',{timeZone:'America/Edmonton'})||'Pending timestamp',action=r.status==='pending_report_to'?'recommend':'approve';return `<div class="workflow-card ${esc(r.status||'pending')}"><div class="workflow-card-head"><div><div class="workflow-card-title">${esc(r.facultyName)} · AFC ${esc(r.startDate)} – ${esc(r.endDate)}</div><div class="workflow-card-meta">${esc(r.requesterEmail||'')} · ${esc(when)} · ${esc(r.workDays)} workday(s)</div></div><span class="workflow-pill">${esc(afcStatus(r.status))}</span></div><div class="workflow-note">Teaching cross-check: ${r.teachingSessions?.length?`${r.teachingSessions.length} assignment(s); coverage supplied`:'no teaching assignment found'}.</div>${active?`<div class="workflow-actions"><button class="btn btn-primary" data-afc-action="${action}" data-afc-id="${esc(r.id)}">${action==='recommend'?'Sign for Reports To & forward':'Sign & approve PDF'}</button><button class="btn btn-secondary" data-afc-action="reject" data-afc-id="${esc(r.id)}">Sign & reject</button></div>`:''}</div>`}
 function openMyRequests(){showModal(`<div class="modal-header"><div class="modal-title">My change requests</div><div class="modal-subtitle">Pending requests do not change the live timetable until all required approvals are complete.</div></div><div class="modal-body">${requests.map(r=>requestCard(r,false)).join('')||'<p>No requests yet.</p>'}</div><div class="modal-footer"><button class="btn btn-secondary" data-workflow-close>Close</button></div>`);document.querySelectorAll('[data-request-withdraw]').forEach(b=>b.onclick=()=>withdrawRoutedRequest(b.dataset.requestWithdraw));document.querySelectorAll('[data-request-resubmit]').forEach(b=>b.onclick=()=>openResubmitRequest(b.dataset.requestResubmit))}


 async function readRoutedBundleTx(tx,id,{includePrivate=false,includeCalendar=false,includeSource=false}={}){
  const requestRef=db.doc(`${REQUESTS}/${id}`),workflowRef=db.doc(`${WORKFLOWS}/${id}`),requestSnap=await tx.get(requestRef),workflowSnap=await tx.get(workflowRef);
  if(!requestSnap.exists||!workflowSnap.exists)throw Error('This request no longer exists.');
  const request={id:requestSnap.id,...requestSnap.data()},workflow={id:workflowSnap.id,...workflowSnap.data()};
  if(request.requestSchema!=='office-routing-v1')throw Error('This action is available only for routed requests.');
  const approvals={},approvalRefs={};
  for(const name of workflow.requiredOffices||[]){const ref=db.doc(`${APPROVALS}/${id}_${name}`),snap=await tx.get(ref);if(!snap.exists)throw Error(`Missing ${name.toUpperCase()} approval record.`);approvalRefs[name]=ref;approvals[name]={id:snap.id,...snap.data()}}
  let privateRecord=null,privateRef=null,calendar=null,calendarRef=null,source=null,sourceRef=null;
  if(includePrivate){privateRef=db.doc(`${PRIVATE_REQUESTS}/${id}`);const snap=await tx.get(privateRef);if(!snap.exists)throw Error('The private Faculty assignment record is missing.');privateRecord={id:snap.id,...snap.data()}}
  if(includeCalendar){calendarRef=db.doc(`${CALENDAR}/${request.sessionId}`);const snap=await tx.get(calendarRef);if(!snap.exists)throw Error('The sanitized calendar session no longer exists.');calendar={id:snap.id,...snap.data()}}
  if(includeSource){sourceRef=db.doc(`${SESSIONS}/${request.sessionId}`);const snap=await tx.get(sourceRef);if(!snap.exists)throw Error('The live source session no longer exists.');source={id:snap.id,...snap.data()}}
  return{requestRef,workflowRef,request,workflow,approvals,approvalRefs,privateRecord,privateRef,calendar,calendarRef,source,sourceRef};
 }
 function otherRequiredApproved(bundle,currentOffice){return(bundle.workflow.requiredOffices||[]).filter(name=>name!==currentOffice).every(name=>bundle.approvals?.[name]?.status==='approved')}
 async function decideRoutedRequest(id,decision){
  if(!isOfficeApprover())return;
  let message='';
  if(decision==='push_back'){message=String(prompt('What needs to be updated?','')||'').trim();if(!message)return toast('Push Back requires a message.',true)}
  if(decision==='reject'){const value=prompt('Reason for rejection:','');if(value===null)return;message=String(value||'').trim()}
  const currentOffice=office(),auditRef=db.collection(REQUEST_AUDIT).doc();let shouldFinalize=false;
  try{
   await db.runTransaction(async tx=>{
    const bundle=await readRoutedBundleTx(tx,id),own=bundle.approvals[currentOffice];
    if(!own||own.status!=='pending')throw Error('This office decision is no longer pending.');
    if(bundle.workflow.hasFacultyChange&&currentOffice==='adfa'&&decision==='approve'&&!otherRequiredApproved(bundle,currentOffice))throw Error('ADFA final approval waits until the other required offices approve.');
    const now=stamp(),plan=lifecycle.planDecision({request:bundle.request,workflow:bundle.workflow,approvals:bundle.approvals,office:currentOffice,decision,message,actor:{uid:user.uid,name:me?.name||user.email||''},now});
    tx.update(bundle.requestRef,plan.publicPatch);
    for(const [name,patch] of Object.entries(plan.approvalPatches))tx.update(bundle.approvalRefs[name],patch);
    tx.set(auditRef,plan.audit);
    if(notifications)for(const name of bundle.workflow.requiredOffices||[]){
     if(name===currentOffice)continue;
     notifications.emitBatch(tx,db,{kind:'office_decision',office:name,request:bundle.request,session:{id:bundle.request.sessionId,...(bundle.request.basePublic||{}),...(bundle.request.patchPublic||{})},message:decision==='push_back'?message:`${currentOffice.toUpperCase()} ${decision}`},now);
    }
    shouldFinalize=decision==='approve'&&plan.allRequiredApproved;
   });
   if(shouldFinalize)await finalizeRoutedRequest(id);else{toast(decision==='approve'?'Office scope approved.':decision==='push_back'?'Request returned for update.':'Request rejected.');closeModal()}
  }catch(e){console.error('[routed office decision]',e);toast(e.message,true)}
 }
 async function withdrawRoutedRequest(id){
  if(!user)return;if(!confirm('Withdraw this request? No timetable changes will be applied.'))return;
  const requestRef=db.doc(`${REQUESTS}/${id}`),auditRef=db.collection(REQUEST_AUDIT).doc();let cancelOffices=[];
  try{
   await db.runTransaction(async tx=>{const snap=await tx.get(requestRef);if(!snap.exists)throw Error('This request no longer exists.');const request={id:snap.id,...snap.data()};if(request.requesterUid!==user.uid)throw Error('Only the requester can withdraw this request.');const now=stamp(),plan=lifecycle.planRequesterWithdrawal({request,actor:{uid:user.uid,name:me?.name||user.email||''},now});cancelOffices=plan.cancelOffices;tx.update(requestRef,plan.publicPatch);tx.set(auditRef,plan.audit);if(notifications)for(const name of cancelOffices)notifications.emitBatch(tx,db,{kind:'request_withdrawn',office:name,request,session:{id:request.sessionId,...(request.basePublic||{}),...(request.patchPublic||{})}},now)});
   await Promise.allSettled(cancelOffices.map(name=>db.doc(`${APPROVALS}/${id}_${name}`).update({status:'cancelled',updatedAt:stamp()})));
   toast('Request withdrawn.');closeModal();
  }catch(e){console.error('[request withdraw]',e);toast(e.message,true)}
 }
 function editInput(field,value){const safe=esc(value??''),type=field==='date'?'date':['start','end'].includes(field)?'time':['year','week'].includes(field)?'number':'text';if(field==='timeUnknown')return `<label class="form-field"><span class="form-label">Time unknown</span><input name="${field}" type="checkbox" ${value===true?'checked':''}></label>`;return `<label class="form-field"><span class="form-label">${esc(field)}</span><input class="form-input" name="${esc(field)}" type="${type}" value="${safe}"></label>`}
 async function loadResubmitFacultyCandidates(){
  const snap=await db.collection('settings').doc(SWAP_INDEX).get();
  if(!snap.exists||!Array.isArray(snap.data()?.entries))throw Error('The Faculty replacement directory is not available. Please contact ADFA.');
  return snap.data().entries.filter(row=>row&&String(row.key||'').trim()&&String(row.name||'').trim()).map(row=>({key:String(row.key),name:String(row.name)}));
 }
 async function openResubmitRequest(id){
  const r=requests.find(row=>row.id===id);if(!r||r.status!=='update_required')return;
  const fields=r.editableFields||[],facultyReturned=fields.some(field=>['assignments','facultyIds','instructor'].includes(field)),publicFields=fields.filter(field=>!['assignments','facultyIds','instructor'].includes(field)),current={...(r.basePublic||{}),...(r.patchPublic||{})};
  try{
   const candidates=facultyReturned?await loadResubmitFacultyCandidates():[];
   const facultyEditor=facultyReturned?`<label class="form-field"><span class="form-label">Faculty replacement</span><select class="form-select" name="facultyChoice" required><option value="" selected disabled>Choose a replacement</option>${candidates.map(row=>`<option value="candidate:${esc(row.key)}">${esc(row.name)}</option>`).join('')}<optgroup label="Other replacement types"><option value="special:sessional">Sessional</option><option value="special:other">Other</option></optgroup></select></label><label class="form-field"><span class="form-label">Reason / note (required for Sessional / Other)</span><input class="form-input" name="facultyReason" type="text" maxlength="500" value="${esc(r.reason||'')}"></label>`:'';
   showModal(`<div class="modal-header"><div class="modal-title">Edit & Resubmit</div><div class="modal-subtitle">Only fields returned for update can be changed.</div></div><form id="workflow-resubmit-form"><div class="modal-body"><div class="workflow-grid">${publicFields.map(field=>editInput(field,current[field])).join('')}${facultyEditor}</div>${facultyReturned?`<div class="workflow-note">Faculty choices use the privacy-safe replacement directory. Internal Faculty identifiers are not loaded into this form.</div>`:''}</div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button type="submit" class="btn btn-primary">Resubmit</button></div></form>`);
   $('workflow-resubmit-form').onsubmit=async ev=>{ev.preventDefault();const form=new FormData(ev.currentTarget),edits={};for(const field of publicFields)edits[field]=field==='timeUnknown'?ev.currentTarget.elements[field]?.checked===true:form.get(field);const facultyChoice=facultyReturned?approvalRequest.facultyEditFromChoice(form.get('facultyChoice'),candidates):null,facultyReason=facultyReturned?String(form.get('facultyReason')||'').trim():undefined;if(facultyChoice?.privateTarget?.kind&&!facultyReason){toast('Enter a reason / note for a Sessional or Other replacement.',true);return}await resubmitRoutedRequest(id,edits,facultyChoice,facultyReason)};
  }catch(e){console.error('[open request resubmit]',e);toast(e.message,true)}
 }
 async function resubmitRoutedRequest(id,edits,facultyChoice=null,facultyReason=undefined){
  const requestRef=db.doc(`${REQUESTS}/${id}`),workflowRef=db.doc(`${WORKFLOWS}/${id}`),auditRef=db.collection(REQUEST_AUDIT).doc();
  try{await db.runTransaction(async tx=>{const snap=await tx.get(requestRef);if(!snap.exists)throw Error('This request no longer exists.');const request={id:snap.id,...snap.data()};if(request.requesterUid!==user.uid)throw Error('Only the requester can resubmit this request.');const now=stamp(),plan=lifecycle.planRequesterResubmission({request,publicEdits:edits,facultyEdit:facultyChoice?{displayName:facultyChoice.displayName,scopeSignature:facultyChoice.scopeSignature}:{},facultyScopeSignature:request.requestType==='faculty_swap'?approvalRequest.facultyScopeSignature(request.proposedFacultyName):'',reason:facultyReason,now});
    const publicPatch={...plan.publicPatch,course:plan.publicPatch.patchPublic?.course??request.course,date:plan.publicPatch.patchPublic?.date??request.date,topic:plan.publicPatch.patchPublic?.topic??request.topic};tx.update(requestRef,publicPatch);tx.set(workflowRef,plan.workflow);
    if(facultyChoice){const privateRef=db.doc(`${PRIVATE_REQUESTS}/${id}`);tx.update(privateRef,{'assignmentChange.to':facultyChoice.privateTarget,revision:plan.publicPatch.revision,updatedAt:now})}
    for(const name of plan.cancelOffices)tx.update(db.doc(`${APPROVALS}/${id}_${name}`),{status:'cancelled',updatedAt:now});
    for(const [name,row] of Object.entries(plan.approvalWrites))tx.set(db.doc(`${APPROVALS}/${id}_${name}`),row,{merge:true});
    tx.set(auditRef,{...plan.audit,changedBy:user.uid,changedByName:me?.name||user.email||''});
    if(notifications)for(const name of Object.keys(plan.approvalWrites))notifications.emitBatch(tx,db,{kind:'request_resubmitted',office:name,request:{...request,...publicPatch},session:{id:request.sessionId,...(request.basePublic||{}),...(publicPatch.patchPublic||request.patchPublic||{})}},now);
   });toast('Request resubmitted for approval.');closeModal()}catch(e){console.error('[request resubmit]',e);toast(e.message,true)}
 }
 async function resolveRoutedReplacement(privateRecord,request){
  const target=privateRecord?.assignmentChange?.to||{};
  if(['sessional','other'].includes(String(target.kind||'').toLowerCase())){const kind=String(target.kind).toLowerCase(),fallback=kind==='sessional'?'Sessional':'Other';return{special:true,kind,facultyId:'',name:request.proposedFacultyName||fallback,faculty:null}}
  let facultyId=String(target.facultyId||'').trim();
  if(!facultyId&&target.candidateKey){const mapSnap=await db.doc('settings/faculty_swap_map').get({source:'server'}),mapping=(mapSnap.data()?.entries||[]).find(row=>String(row?.key||'')===String(target.candidateKey));facultyId=String(mapping?.facultyId||'').trim()}
  if(!facultyId)throw Error('The replacement Faculty identity could not be resolved.');
  const facultySnap=await db.doc(`faculty/${facultyId}`).get({source:'server'});if(!facultySnap.exists)throw Error('The replacement Faculty record no longer exists.');const faculty={__id:facultySnap.id,...facultySnap.data()};return{special:false,kind:'faculty',facultyId,name:request.proposedFacultyName||facultyName(faculty),faculty};
 }
 async function routedFacultyPreflight(request,source,privateRecord,resolved){
  const plan=finalizer.planFacultySwap({request,source,privateRecord,resolved}),next={...source,...plan.sourcePatch},warnings=[];let check={status:'clear',conflicts:[],possibleConflicts:[]};
  if(resolved.faculty){const records=Array.isArray(resolved.faculty.awayFromCampusRecords)?resolved.faculty.awayFromCampusRecords:[],date=ymd(next.date);if(records.some(row=>row?.startDate&&row?.endDate&&String(row.startDate)<=date&&date<=String(row.endDate)))warnings.push(`${resolved.name}: Unavailable (AFC).`);const day=await db.collection(SESSIONS).where('date','==',date).get({source:'server'}),aliases=facultyAliases(resolved.faculty);check=scheduling.findFacultyConflicts({date,start:next.start,end:next.end,timeUnknown:next.timeUnknown===true,sessions:day.docs.map(doc=>({id:doc.id,...doc.data()})),excludeSessionId:source.id,isAssigned:s=>assignedArray(s).some(a=>String(a.ucid||a.facultyId||'')===resolved.facultyId||aliases.has(norm(a.name)))});if(check.conflicts?.length)warnings.push(`${resolved.name}: timetable conflict - ${check.conflicts.map(conflictLabel).join('; ')}.`);if(check.possibleConflicts?.length)warnings.push(`${resolved.name}: timetable check incomplete.`)}
  return{plan,warnings,check};
 }
 // UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer
 // Current Spark/client architecture requires ADFA to finalize requests containing private Faculty changes.
 // Move final apply to a trusted UCalgary backend transaction/service during the database/API migration.
 async function finalizeRoutedRequest(id){
  const requestSnap=await db.doc(`${REQUESTS}/${id}`).get({source:'server'}),workflowSnap=await db.doc(`${WORKFLOWS}/${id}`).get({source:'server'});if(!requestSnap.exists||!workflowSnap.exists)throw Error('This request no longer exists.');const request={id:requestSnap.id,...requestSnap.data()},workflow={id:workflowSnap.id,...workflowSnap.data()},currentOffice=office();
  const approvalDocs=await Promise.all((workflow.requiredOffices||[]).map(name=>db.doc(`${APPROVALS}/${id}_${name}`).get({source:'server'}))),approvalRows={};approvalDocs.forEach((snap,index)=>{if(snap.exists)approvalRows[workflow.requiredOffices[index]]={id:snap.id,...snap.data()}});if(!lifecycle.requiredApproved(workflow,approvalRows))throw Error('All required office approvals must be complete before applying this request.');
  if(workflow.hasFacultyChange&&currentOffice!=='adfa')throw Error('ADFA must complete a request that changes Faculty assignment.');
  let resolved=null,preflight=null,conflictOverride=null;
  if(workflow.hasFacultyChange){const [privateSnap,sourceSnap]=await Promise.all([db.doc(`${PRIVATE_REQUESTS}/${id}`).get({source:'server'}),db.doc(`${SESSIONS}/${request.sessionId}`).get({source:'server'})]);if(!privateSnap.exists||!sourceSnap.exists)throw Error('Required private Faculty/session data is missing.');resolved=await resolveRoutedReplacement(privateSnap.data(),request);preflight=await routedFacultyPreflight(request,{id:sourceSnap.id,...sourceSnap.data()},privateSnap.data(),resolved);const warningText=preflight.warnings.length?`\n\nWARNING — availability/conflict checks:\n- ${preflight.warnings.join('\n- ')}`:'';if(approvalScheduling.requiresOverride(preflight.check)){if(!confirm(`TIMETABLE CONFLICT DETECTED${warningText}\n\nOverride and apply this Faculty change? The override will be audited.`))throw Error('Approval cancelled.');conflictOverride={...approvalScheduling.overrideAudit({uid:user.uid,name:me?.name||'ADFA administrator'},preflight.check.conflicts),confirmedAt:stamp()}}else if(!confirm(`Apply the fully approved Faculty change to the live timetable?${warningText}`))throw Error('Approval cancelled.')}
  else if(!confirm('All required offices approved. Apply this request to the live timetable?'))throw Error('Approval cancelled.');
  const auditRef=db.collection(REQUEST_AUDIT).doc(),logRef=db.collection(LOGS).doc();let beforeAfter=null;
  await db.runTransaction(async tx=>{const bundle=await readRoutedBundleTx(tx,id,{includePrivate:workflow.hasFacultyChange,includeCalendar:!workflow.hasFacultyChange,includeSource:workflow.hasFacultyChange});if(bundle.request.status!=='pending')throw Error('This request is no longer pending.');if(bundle.request.appliedRevision===bundle.request.revision||bundle.request.appliedAt)throw Error('This request revision was already applied.');if(!lifecycle.requiredApproved(bundle.workflow,bundle.approvals))throw Error('All required office approvals must be complete before applying this request.');if(bundle.workflow.hasFacultyChange&&currentOffice!=='adfa')throw Error('ADFA must complete a request that changes Faculty assignment.');const now=stamp();let applyPlan,before;
    if(bundle.workflow.hasFacultyChange){applyPlan=finalizer.planFacultySwap({request:bundle.request,source:bundle.source,privateRecord:bundle.privateRecord,resolved});before=bundle.source;tx.set(bundle.sourceRef,{...applyPlan.sourcePatch,approvalRequestId:id,approvalRevision:bundle.request.revision,updatedBy:user.uid,updatedByName:me?.name||user.email||'',updatedAt:now},{merge:true});tx.set(db.doc(`${CALENDAR}/${bundle.request.sessionId}`),applyPlan.calendar)}
    else{applyPlan=finalizer.planPublicApply({request:bundle.request,calendar:bundle.calendar});before=bundle.calendar;tx.set(db.doc(`${SESSIONS}/${bundle.request.sessionId}`),{...applyPlan.sourcePatch,approvalRequestId:id,approvalRevision:bundle.request.revision,updatedBy:user.uid,updatedByName:me?.name||user.email||'',updatedAt:now},{merge:true});tx.set(bundle.calendarRef,applyPlan.calendar)}
    const after={...before,...applyPlan.sourcePatch};beforeAfter={before,after};const changes=applyPlan.changedFields.map(field=>({field,before:before?.[field]??null,after:after?.[field]??null}));tx.set(logRef,{action:bundle.workflow.hasFacultyChange?'swap_faculty':'approved_session_edit',override:conflictOverride,requestId:id,sessionId:bundle.request.sessionId,course:after.course||bundle.request.course||'',date:ymd(after.date),topic:after.topic||'',instructors:bundle.workflow.hasFacultyChange?assignedArray(after).map(a=>a.name).filter(Boolean):[],changes,changedBy:user.uid,changedByName:me?.name||user.email||'',changedByEmail:user.email||'',changedAt:now});tx.set(auditRef,{requestId:id,event:'request_applied',revision:bundle.request.revision,office:currentOffice,changedBy:user.uid,changedByName:me?.name||user.email||'',changedAt:now});tx.update(bundle.requestRef,{status:'approved',editableFields:[],requesterMessage:'',appliedRevision:bundle.request.revision,appliedAt:now,updatedAt:now});
    if(notifications)for(const name of bundle.workflow.requiredOffices||[])notifications.emitBatch(tx,db,{kind:'request_applied',office:name,request:bundle.request,session:{id:bundle.request.sessionId,...applyPlan.calendar}},now);
   });
  if(isAdfaApprover()&&beforeAfter)await window.UCVM_PAGE_DATA?.updateDerivedIndexes?.([beforeAfter]);toast('All required approvals are complete. Changes applied to the live timetable.');closeModal();
 }

 function swapImpactHtml(r,current){
  const arr=assignedArray(current),fromId=String(r.fromFaculty?.facultyId||''),fromName=norm(r.fromFaculty?.name),idx=arr.findIndex(a=>(fromId&&String(a.ucid||'')===fromId)||(fromName&&norm(a.name)===fromName)),out=idx>=0?arr[idx]:null,outF=resolveFaculty(r.fromFaculty),inF=resolveFaculty(r.toFaculty),credit=assignmentCredit(out),state=buildDoeState(),outState=outF?state.get(String(outF.__id)):null,inState=inF?state.get(String(inF.__id)):null,outCurrent=outState?.current??null,inCurrent=inState?.current??null,outProjected=outCurrent!==null&&credit!==null?outCurrent-credit:null,inProjected=inCurrent!==null&&credit!==null?inCurrent+credit:null,outAv=availabilityFor(outF,current.date,current.start,current.end,current.id,current.timeUnknown===true),inAv=availabilityFor(inF,current.date,current.start,current.end,current.id,current.timeUnknown===true);
  return `<div class="workflow-impact-title">DOE & schedule checks</div><div class="workflow-credit">Session DOE credit transferred: ${credit===null?'Unrated / unavailable':fmtDoe(credit)} · ${esc(ymd(current.date))} ${esc(current.start||'—')}–${esc(current.end||'—')}</div><div class="workflow-impact-grid"><div class="workflow-person"><div class="workflow-person-name">Outgoing · ${esc(r.fromFaculty?.name||facultyName(outF))}</div><div class="workflow-metric">${doeProjectionText(outCurrent,outProjected,outState?.contract??contractTeachingDoe(outF))}</div>${availabilityHtml(outAv,current.start,current.end)}</div><div class="workflow-person"><div class="workflow-person-name">Incoming · ${esc(r.toFaculty?.name||facultyName(inF))}</div><div class="workflow-metric">${doeProjectionText(inCurrent,inProjected,inState?.contract??contractTeachingDoe(inF))}</div>${availabilityHtml(inAv,current.start,current.end)}</div></div>`;
 }
 function routedSwapImpactHtml(r,current,privateRecord,resolved){
  const change=privateRecord?.assignmentChange||{},arr=assignedArray(current),index=Number(change.assignmentIndex)||0,out=arr[index]||null,outRef={facultyId:String(change.from?.facultyId||out?.ucid||''),name:r.currentFacultyName||out?.name||''},outF=resolveFaculty(outRef),inF=resolved?.faculty||null,credit=assignmentCredit(out),state=buildDoeState(),outState=outF?state.get(String(outF.__id)):null,inState=inF?state.get(String(inF.__id)):null,outCurrent=outState?.current??null,inCurrent=inState?.current??null,outProjected=outCurrent!==null&&credit!==null?outCurrent-credit:null,inProjected=inCurrent!==null&&credit!==null?inCurrent+credit:null,outAv=availabilityFor(outF,current.date,current.start,current.end,current.id,current.timeUnknown===true),incomingName=resolved?.name||r.proposedFacultyName||'Replacement Faculty';
  const incoming=resolved?.special?`<div class="workflow-person"><div class="workflow-person-name">Incoming · ${esc(incomingName)}</div><div class="workflow-metric">DOE/AFC/availability checks will be completed by ADFA when the specific Faculty record is resolved.</div><div class="workflow-check unknown">Specific Faculty identity not yet assigned.</div></div>`:(()=>{const inAv=availabilityFor(inF,current.date,current.start,current.end,current.id,current.timeUnknown===true);return `<div class="workflow-person"><div class="workflow-person-name">Incoming · ${esc(incomingName)}</div><div class="workflow-metric">${doeProjectionText(inCurrent,inProjected,inState?.contract??contractTeachingDoe(inF))}</div>${availabilityHtml(inAv,current.start,current.end)}</div>`})();
  return `<div class="workflow-impact-title">DOE, AFC & schedule checks</div><div class="workflow-credit">Session DOE credit transferred: ${credit===null?'Unrated / unavailable':fmtDoe(credit)} · ${esc(ymd(current.date))} ${esc(current.start||'—')}–${esc(current.end||'—')}</div><div class="workflow-impact-grid"><div class="workflow-person"><div class="workflow-person-name">Outgoing · ${esc(r.currentFacultyName||out?.name||facultyName(outF))}</div><div class="workflow-metric">${doeProjectionText(outCurrent,outProjected,outState?.contract??contractTeachingDoe(outF))}</div>${availabilityHtml(outAv,current.start,current.end)}</div>${incoming}</div>`;
 }
 function editImpactHtml(r,current){
  const patch=r.patchPublic||r.patch||{},date=patch.date||current.date,start=patch.start||current.start,end=patch.end||current.end,state=buildDoeState(),rows=assignedArray(current).map(a=>{const f=resolveFaculty({facultyId:a.ucid,name:a.name}),st=f?state.get(String(f.__id)):null,av=availabilityFor(f,date,start,end,current.id,current.timeUnknown===true&&start===current.start&&end===current.end),credit=assignmentCredit(a);return `<div class="workflow-person"><div class="workflow-person-name">${esc(a.name||facultyName(f))}</div><div class="workflow-metric">Session DOE: <strong>${credit===null?'Unrated':fmtDoe(credit)}</strong> · Current assigned DOE: <strong>${fmtDoe(st?.current??null)}</strong> · DOE is unchanged by this date/time/topic edit.</div>${availabilityHtml(av,start,end)}</div>`}).join('');
  return `<div class="workflow-impact-title">DOE & proposed-time conflict checks</div><div class="workflow-credit">Proposed session: ${esc(ymd(date))} ${esc(start||'—')}–${esc(end||'—')}. All currently assigned faculty are checked against their other live timetable sessions.</div><div class="workflow-edit-impact">${rows||'<div class="workflow-check unknown">No assigned faculty were found to check.</div>'}</div>`;
 }
async function hydrateApprovalImpacts(){if(!isAdfaApprover())return;
  await ensureRequestSessions(requests);await ensureApprovalFaculty(requests);await ensureFacultySessionContext(requests);
  for(const el of document.querySelectorAll('[data-approval-impact]')){const r=requests.find(x=>x.id===el.dataset.approvalImpact),current=r?sessions.get(r.sessionId):null;if(!r||!current){el.innerHTML='<div class="workflow-impact-title">DOE & schedule checks</div><div class="workflow-check warn">The live session could not be found. Do not approve until reviewed manually.</div>';continue}try{if(r.requestSchema==='office-routing-v1'&&r._workflow?.hasFacultyChange){const privateSnap=await db.doc(`${PRIVATE_REQUESTS}/${r.id}`).get({source:'server'});if(!privateSnap.exists)throw Error('The private Faculty assignment record is missing.');const privateRecord=privateSnap.data(),resolved=await resolveRoutedReplacement(privateRecord,r);el.innerHTML=routedSwapImpactHtml(r,current,privateRecord,resolved)}else el.innerHTML=r.requestType==='faculty_swap'?swapImpactHtml(r,current):editImpactHtml(r,current)}catch(e){console.error('[approval impact]',e);el.innerHTML=`<div class="workflow-impact-title">DOE & schedule checks</div><div class="workflow-check unknown">Unable to calculate checks: ${esc(e.message)}</div>`}}
 }
 async function openApprovalQueue(){
  const currentOffice=office(),pending=requests.filter(r=>r.requestSchema==='office-routing-v1'?r._approvals?.[currentOffice]?.status==='pending':(isAdfaApprover()&&r.status==='pending')),done=requests.filter(r=>r.requestSchema==='office-routing-v1'?r._approvals?.[currentOffice]?.status!=='pending':r.status!=='pending').slice(0,20),afcPending=isAdfaApprover()?afcRequests:[];
  const heading=currentOffice==='adc'?'ADC approval queue':currentOffice==='lab'?'LAB approval queue':'ADFA approval queue';
  const subtitle=isAdfaApprover()?'Timetable Faculty decisions retain live DOE/AFC/conflict checks.':'Only your office-owned fields are actionable; other fields are read-only context.';
  const afcHtml=isAdfaApprover()?`<h3>AFC requests (${afcPending.length})</h3>${afcPending.map(r=>afcCard(r,true)).join('')||'<p>No pending AFC requests.</p>'}`:'';
  showModal(`<div class="modal-header"><div class="modal-title">${esc(heading)}</div><div class="modal-subtitle">${esc(subtitle)}</div></div><div class="modal-body">${afcHtml}<h3${isAdfaApprover()?' style="margin-top:18px"':''}>Timetable requests (${pending.length})</h3>${pending.map(r=>requestCard(r,true)).join('')||'<p>No pending timetable requests for this office.</p>'}${done.length?`<h3 style="margin-top:18px">Recent decisions</h3>${done.map(r=>requestCard(r,true)).join('')}`:''}</div><div class="modal-footer"><button class="btn btn-secondary" data-workflow-close>Close</button></div>`);
  document.querySelectorAll('[data-office-decision]').forEach(b=>b.onclick=()=>decideRoutedRequest(b.dataset.requestId,b.dataset.officeDecision));
  document.querySelectorAll('[data-approve-request]').forEach(b=>b.onclick=()=>approveRequest(b.dataset.approveRequest));
  document.querySelectorAll('[data-reject-request]').forEach(b=>b.onclick=()=>rejectRequest(b.dataset.rejectRequest));
  document.querySelectorAll('[data-afc-action]').forEach(b=>b.onclick=()=>decideAfc(b.dataset.afcId,b.dataset.afcAction));
  if(isAdfaApprover())try{await hydrateApprovalImpacts()}catch(e){toast(`DOE/conflict checks could not load: ${e.message}`,true)}
 }

 async function decideAfc(id,action){const r=afcRequests.find(x=>x.id===id);if(!r||!isApprover())return;let rejectionReason='';if(action==='reject'){rejectionReason=prompt('Reason for rejection:')?.trim()||'';if(!rejectionReason)return}const signature=await UCVM_SIGNATURE.capture({name:me?.name||user.email||'',email:user.email||'',uid:user.uid,title:`Sign AFC ${action}`});if(!signature){openApprovalQueue();return}try{await UCVM_AFC_ACTIONS.decide({db,user,profile:me,request:r,action,signature,rejectionReason});toast(action==='approve'?'AFC approved and signed PDF created.':action==='recommend'?'AFC signed and forwarded to ADMIN.':'AFC rejected.');closeModal()}catch(e){toast(e.message,true)}}

 function validateBase(current,base,fields){for(const f of fields)if(!sameVal(f==='date'?ymd(current[f]):current[f],base?.[f]))return false;return true}
 function approvalWarnings(r,current){
  const warnings=[];
  if(r.requestType==='faculty_swap'){
    const outF=resolveFaculty(r.fromFaculty),inF=resolveFaculty(r.toFaculty),outAv=availabilityFor(outF,current.date,current.start,current.end,current.id,current.timeUnknown===true),inAv=availabilityFor(inF,current.date,current.start,current.end,current.id,current.timeUnknown===true);
    if(outAv.available!==true)warnings.push(`Outgoing ${r.fromFaculty?.name||facultyName(outF)}: ${availabilityDetail(outAv,current.start,current.end)}`);
    if(inAv.available!==true)warnings.push(`Incoming ${r.toFaculty?.name||facultyName(inF)}: ${availabilityDetail(inAv,current.start,current.end)}`);
  }else if(r.requestType==='session_edit'){
    const date=r.patch?.date||current.date,start=r.patch?.start||current.start,end=r.patch?.end||current.end;
    for(const a of assignedArray(current)){const f=resolveFaculty({facultyId:a.ucid,name:a.name}),av=availabilityFor(f,date,start,end,current.id,current.timeUnknown===true&&start===current.start&&end===current.end);if(av.available!==true)warnings.push(`${a.name||facultyName(f)}: ${availabilityDetail(av,start,end)}`)}
  }
  return warnings;
 }
 function approvalConflictOverride(r,current){
  const impacted=[];
  const add=check=>{for(const conflict of check?.conflicts||[])impacted.push(conflict)};
  if(r.requestType==='faculty_swap'){
    const incoming=resolveFaculty(r.toFaculty),av=availabilityFor(incoming,current.date,current.start,current.end,current.id,current.timeUnknown===true);if(approvalScheduling.requiresOverride(av.tt))add(av.tt);
  }else if(r.requestType==='session_edit'&&(r.changes||[]).some(change=>['date','start','end'].includes(change.field))){
    const date=r.patch?.date||current.date,start=r.patch?.start||current.start,end=r.patch?.end||current.end;
    for(const assignment of assignedArray(current)){const faculty=resolveFaculty({facultyId:assignment.ucid,name:assignment.name}),av=availabilityFor(faculty,date,start,end,current.id,current.timeUnknown===true&&start===current.start&&end===current.end);if(approvalScheduling.requiresOverride(av.tt))add(av.tt)}
  }
  if(!impacted.length)return null;
  return{...approvalScheduling.overrideAudit({uid:user.uid,name:me?.name||'ADFA administrator'},impacted),confirmedAt:stamp()};
 }
 async function approveRequest(id){
  if(!isApprover())return;
  const requestSnap=await db.doc(`${REQUESTS}/${id}`).get({source:'server'});
  if(!requestSnap.exists)return;const r={id:requestSnap.id,...requestSnap.data()};if(r.status!=='pending')return;
  const ref=db.doc(`${SESSIONS}/${r.sessionId}`),snap=await ref.get({source:'server'});if(!snap.exists)return toast('The session no longer exists. Reject or review this request manually.',true);const current={id:snap.id,...snap.data()};
  sessions.set(String(current.id),current);
  let patch={},log={};
  if(r.requestType==='session_edit'){
    const fields=(r.changes||[]).map(c=>c.field);if(!validateBase(current,r.base,fields))return toast('This session changed after the request was submitted. Approval is blocked to prevent overwriting newer data.',true);
    patch={...(r.patch||{})};
    const timeChanged=['start','end'].some(field=>Object.prototype.hasOwnProperty.call(patch,field)&&patch[field]!==current[field]);
    const proposed={...current,...patch,timeUnknown:timeChanged?false:current.timeUnknown===true};
    if(scheduling.validateSessionTiming(proposed).status==='invalid')return toast('Approval blocked: enter a valid date and time interval before resubmitting.',true);
    if(timeChanged)patch.timeUnknown=false;
    log={action:'approved_session_edit',changes:r.changes||[]};
  }else if(r.requestType==='faculty_swap'){
    if(!validateBase(current,r.base,['course','date','start','end','topic','type','room']))return toast('This session changed after the swap request was submitted. Approval is blocked.',true);
    const arr=assignedArray(current),fromId=String(r.fromFaculty?.facultyId||''),fromName=norm(r.fromFaculty?.name),idx=arr.findIndex(a=>(fromId&&String(a.ucid||'')===fromId)||(fromName&&norm(a.name)===fromName));if(idx<0)return toast('The outgoing instructor is no longer assigned. Approval is blocked.',true);
    const incoming={...(arr[idx]||{}),ucid:String(r.toFaculty?.facultyId||''),name:r.toFaculty?.name||'',category:'Faculty',source:'Approved swap request',swappedFrom:{ucid:String(arr[idx]?.ucid||''),name:arr[idx]?.name||''},swappedAt:new Date().toISOString()};arr[idx]=incoming;patch={assignments:arr,instructor:arr.map(a=>a.name).filter(Boolean).join('; ')};log={action:'swap_faculty',fromFaculty:r.fromFaculty||{},toFaculty:r.toFaculty||{},role:incoming.role||current.type||''};
  }else return;
  if(patch.assignments)patch.facultyIds=UCVM_DATA_INDEX.sessionFacultyIds({...current,...patch});
  await ensureApprovalFaculty([r],true);await ensureFacultySessionContext([r],true);
  const warnings=approvalWarnings(r,current),warningText=warnings.length?`\n\nWARNING — availability/conflict checks:\n- ${warnings.join('\n- ')}`:'',conflictOverride=approvalConflictOverride(r,current);
  if(conflictOverride){
    if(!confirm(`TIMETABLE CONFLICT DETECTED${warningText}\n\nOverride and approve despite the timetable conflict(s)? This override will be recorded in the audit log.`))return;
  }else if(!confirm(`Approve and apply this ${r.requestType==='faculty_swap'?'faculty swap':'session change'} to the live timetable?${warningText}`))return;
  try{
    const after={...current,...patch},batch=db.batch(),reqRef=db.doc(`${REQUESTS}/${id}`),logRef=db.collection(LOGS).doc();batch.set(ref,{...patch,updatedBy:user.uid,updatedByName:me?.name||user.email||'',updatedAt:stamp()},{merge:true});batch.set(logRef,{...log,requestId:id,sessionId:r.sessionId,course:current.course||r.course||'',date:ymd(patch.date||current.date),topic:patch.topic||current.topic||'',override:conflictOverride,changedBy:user.uid,changedByName:me?.name||user.email||'',changedByEmail:user.email||'',changedAt:stamp()});batch.update(reqRef,{status:'approved',approvedBy:user.uid,approvedByName:me?.name||user.email||'',approvedAt:stamp(),appliedAt:stamp()});await batch.commit();await window.UCVM_PAGE_DATA?.updateDerivedIndexes?.([{before:current,after}]);toast('Approved and applied to the live timetable.');closeModal();
  }catch(e){console.error(e);toast(e.message,true)}
 }
 async function rejectRequest(id){
  if(!isApprover())return;const reason=prompt('Optional rejection reason:','')??null;if(reason===null)return;try{await db.doc(`${REQUESTS}/${id}`).update({status:'rejected',rejectedBy:user.uid,rejectedByName:me?.name||user.email||'',rejectedAt:stamp(),rejectionReason:String(reason||'').trim()});toast('Request rejected.');closeModal()}catch(e){toast(e.message,true)}
 }

 auth.onAuthStateChanged(async u=>{
  user=u;me=null;role='';hiccMode=false;sessions.clear();people=[];peopleByUid=new Map();peopleLoading=null;requests=[];afcRequests=[];requestsReady=false;afcRequestsReady=false;approvalFaculty=[];approvalFacultyById=new Map();approvalFacultyLoaded=false;approvalSessionDatesLoaded=new Set();if(notificationUnsub){notificationUnsub();notificationUnsub=null}if(sessionUnsub){sessionUnsub();sessionUnsub=null}if(requestUnsub){requestUnsub();requestUnsub=null}if(afcUnsub){afcUnsub();afcUnsub=null}if(groupUnsub){groupUnsub();groupUnsub=null}
  if(!u){injectButtons();queueDecorate();return}
  try{const d=window.UCVM_PAGE_DATA?.profileSnapshot?await window.UCVM_PAGE_DATA.profileSnapshot(u.uid):await db.doc(`users/${u.uid}`).get();me=d.data()||{};await UCVM.ready(u,me);role=UCVM.role(me.role);notificationUnsub=notifications&&notifications.mount?notifications.mount({db,user:u,profile:me,host:$('workflow-notifications')}):null;listenGroups();listenSessions();listenRequests();listenAfcRequests();injectButtons()}catch(e){console.warn('[approval workflow init]',e)}
 });
})();
