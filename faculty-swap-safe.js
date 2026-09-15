/* Privacy-safe faculty self-replacement workflow layered over approval-workflow.js. */
(()=>{
 'use strict';
 if(!window.UCVM||typeof firebase==='undefined')return;
 const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
 const {auth,db}=UCVM.init();
 const REQUESTS='change_requests',SESSIONS='sessions',SWAP_INDEX='faculty_swap_index',SWAP_MAP='faculty_swap_map';
 const $=id=>document.getElementById(id),esc=UCVM.esc||((v)=>String(v??''));
 const stamp=()=>firebase.firestore.FieldValue.serverTimestamp();
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 const ymd=v=>String(v||'').slice(0,10);
 let user=null,profile=null,lastSessionId='';
 let adminInitPromise=null;

 function assignedArray(s){return Array.isArray(s?.assignments)&&s.assignments.length?s.assignments.map(a=>({...a})):(String(s?.instructor||'').split(';').map(x=>x.trim()).filter(Boolean).map(name=>({name,ucid:'',role:s?.type||''})))}
 function baseSnapshot(s){return{course:s?.course||'',date:ymd(s?.date),start:s?.start||'',end:s?.end||'',topic:s?.topic||'',type:s?.type||'',room:s?.room||'',assignments:assignedArray(s).map(a=>({ucid:String(a.ucid||''),name:a.name||'',role:a.role||'',category:a.category||'',creditedHours:a.creditedHours??null,doeRate:a.doeRate??null,doeCredit:a.doeCredit??null}))}}
 function sameVal(a,b){return JSON.stringify(a??null)===JSON.stringify(b??null)}
 function ownFacultyId(){return String(profile?.facultyId||profile?.facultyDirectoryMatch?.id||'').trim()}
 function ownAliases(){return new Set([profile?.name,profile?.instructor,profile?.facultyDirectoryMatch?.name,user?.displayName,user?.email?.split('@')[0]].map(norm).filter(Boolean))}
 function selfAssignmentIndexes(s){const fid=ownFacultyId(),aliases=ownAliases();return assignedArray(s).map((a,i)=>({a,i})).filter(x=>(fid&&String(x.a.ucid||x.a.facultyId||'')===fid)||aliases.has(norm(x.a.name))).map(x=>x.i)}
 function sessionById(id){return window.UCVM_PAGE_DATA?.sessions?.().find(s=>String(s.id)===String(id))||null}
 function showModal(html){const modal=$('modal');if(!modal)return false;modal.innerHTML=`<div class="modal-box workflow-modal-box">${html}</div>`;modal.classList.add('open');modal.querySelectorAll('[data-safe-swap-close]').forEach(b=>b.onclick=closeModal);return true}
 function closeModal(){const modal=$('modal');if(!modal)return;modal.classList.remove('open');modal.innerHTML=''}
 function toast(message,error=false){const t=$('toast');if(!t){alert(message);return}t.textContent=message;t.classList.toggle('error',error);t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),error?6500:3300)}
 function sessionSummary(s){return `<div class="workflow-card"><div class="workflow-card-title">${esc(s.course||'')} · ${esc(s.type||'')}</div><div>${esc(s.topic||'')}</div><div class="workflow-card-meta">${esc(ymd(s.date))} · ${esc(s.start||'')}–${esc(s.end||'')} · ${esc(s.room||'')}</div><div class="workflow-card-meta">Faculty: ${esc(assignedArray(s).map(a=>a.name).filter(Boolean).join('; ')||'TBD')}</div></div>`}
 function candidateAliases(candidate){return new Set([candidate?.name,...(Array.isArray(candidate?.aliases)?candidate.aliases:[])].map(norm).filter(Boolean))}
 function currentAssignmentNames(s){return new Set(assignedArray(s).map(a=>norm(a?.name)).filter(Boolean))}
 function isAlreadyAssigned(candidate,s){const names=currentAssignmentNames(s);return [...candidateAliases(candidate)].some(name=>names.has(name))}
 function specialReplacement(ref){return ['sessional','other'].includes(String(ref?.kind||'').toLowerCase())}
 function specialLabel(kind){return String(kind||'').toLowerCase()==='sessional'?'Sessional':'Other'}
 function canonicalName(f,id=''){return String(f?.preferredFullName||f?.hrFirstLast||f?.hrFullName||f?.teachingAssignmentName||id||'Faculty')}
 function facultyAliases(f){const set=new Set([canonicalName(f),f?.preferredFullName,f?.hrFirstLast,f?.hrFullName,f?.teachingAssignmentName,f?.facultySummary2026_27?.displayName].map(norm).filter(Boolean));if(f?.firstName&&f?.lastName)set.add(norm(`${f.firstName} ${f.lastName}`));return set}
 function timeMinutes(v){const m=String(v||'').trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);if(!m)return null;let h=Number(m[1]),min=Number(m[2]);if(m[3]){const ap=m[3].toUpperCase();if(h===12)h=0;if(ap==='PM')h+=12}return h<=23&&min<=59?h*60+min:null}
 function overlaps(aStart,aEnd,bStart,bEnd){const as=timeMinutes(aStart),ae=timeMinutes(aEnd),bs=timeMinutes(bStart),be=timeMinutes(bEnd);return ![as,ae,bs,be].some(v=>v===null)&&ae>as&&be>bs&&as<be&&bs<ae}

 async function loadCandidateContext(session){
  const date=ymd(session?.date);
  const [indexSnap,daySnap]=await Promise.all([
   db.collection('settings').doc(SWAP_INDEX).get(),
   db.collection(SESSIONS).where('date','==',date).get()
  ]);
  if(!indexSnap.exists||!Array.isArray(indexSnap.data()?.entries))throw Error('The faculty replacement directory has not been initialized yet. Please contact ADFA.');
  const candidates=indexSnap.data().entries.filter(c=>c&&c.key&&c.name&&!isAlreadyAssigned(c,session));
  const daySessions=daySnap.docs.map(d=>({id:d.id,...d.data()}));
  return{candidates,daySessions};
 }
 function candidateOption(candidate,daySessions,session){
  const assessment=UCVM_DATA_INDEX.assessSwapCandidate(candidate,daySessions,session),display=UCVM_DATA_INDEX.swapCandidateDisplay(assessment),suffix=display.detail?`${display.label} — ${display.detail}`:display.label;
  return{candidate,assessment,display,label:`${candidate.name} — ${suffix}`};
 }
 function availabilityBox(row){
  if(!row)return '<div class="workflow-check unknown">Choose a replacement.</div>';
  const cls=row.display.label==='Available'?'ok':row.display.label==='Unavailable'?'warn':'unknown';
  const detail=row.display.detail?` · ${esc(row.display.detail)}`:'';
  return `<div class="workflow-check ${cls}"><strong>${esc(row.display.label)}</strong>${detail}</div>`;
 }

 async function openSelfReplacement(session){
  if(!user||!profile)return toast('Sign in before submitting a request.',true);
  const arr=assignedArray(session),own=selfAssignmentIndexes(session);if(!own.length)return;
  const idx=own[0],out=arr[idx],fid=ownFacultyId();if(!fid)return toast('Your account needs a linked faculty record before you can request a replacement.',true);
  let context;try{context=await loadCandidateContext(session)}catch(error){return toast(error.message,true)}
  const rows=context.candidates.map(c=>candidateOption(c,context.daySessions,session)).sort((a,b)=>a.candidate.name.localeCompare(b.candidate.name));
  const rowByValue=new Map(rows.map(row=>[`faculty:${row.candidate.key}`,row]));
  const facultyOptions=rows.map(row=>`<option value="faculty:${esc(row.candidate.key)}">${esc(row.label)}</option>`).join('');
  const first=rows[0]||null;
  showModal(`<div class="modal-header"><div class="modal-title">Request replacement for me</div><div class="modal-subtitle">ADFA approval is required. Availability is checked for this session time.</div></div><form id="safe-self-swap-form"><div class="modal-body">${sessionSummary(session)}<div class="workflow-card">You: <strong>${esc(out.name||profile.name||user.email||'')}</strong></div><label class="form-field"><span class="form-label">Replace me with</span><select class="form-select" name="to" id="safe-swap-to">${facultyOptions}<optgroup label="Other replacement types"><option value="special:sessional">Sessional</option><option value="special:other">Other</option></optgroup></select></label><div id="safe-swap-availability">${availabilityBox(first)}</div><label class="form-field"><span class="form-label" id="safe-swap-reason-label">Reason / note</span><input class="form-input" id="safe-swap-reason" name="reason" placeholder="Optional"></label><div class="workflow-note">AFC-related unavailability is shown only as <strong>Unavailable</strong>. Timetable conflicts show only the conflicting course and time. ADFA rechecks the live schedule before approval.</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-safe-swap-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
  const select=$('safe-swap-to'),reason=$('safe-swap-reason'),reasonLabel=$('safe-swap-reason-label'),availability=$('safe-swap-availability');
  const sync=()=>{const value=String(select.value||''),special=value.startsWith('special:');reason.required=special;reason.placeholder=special?'Required for Sessional / Other':'Optional';reasonLabel.textContent=special?'Reason / note *':'Reason / note';availability.innerHTML=special?'<div class="workflow-check unknown">ADFA will review this replacement category manually.</div>':availabilityBox(rowByValue.get(value))};
  select.onchange=sync;sync();
  $('safe-self-swap-form').onsubmit=async ev=>{
   ev.preventDefault();const form=new FormData(ev.currentTarget),choice=String(form.get('to')||''),note=String(form.get('reason')||'').trim();let toFaculty;
   if(choice.startsWith('special:')){const kind=choice.split(':')[1];if(!note)return toast('Reason / note is required for Sessional or Other.',true);toFaculty={kind,name:specialLabel(kind)}}
   else{const row=rowByValue.get(choice);if(!row)return toast('Choose a replacement faculty member.',true);toFaculty={candidateKey:row.candidate.key,name:row.candidate.name}}
   const payload={status:'pending',requesterUid:user.uid,requesterName:profile.name||user.email||'',requesterEmail:user.email||profile.email||'',requesterRole:String(profile.role||'').toLowerCase(),requesterFacultyId:fid,requestedAt:stamp(),requestType:'faculty_swap',scope:'self',groupId:'',groupName:'',sessionId:session.id,course:session.course||'',date:ymd(session.date),topic:session.topic||'',base:baseSnapshot(session),assignmentIndex:idx,fromFaculty:{facultyId:fid,name:out.name||profile.name||''},toFaculty,reason:note};
   try{await db.collection(REQUESTS).add(payload);closeModal();toast('Request submitted to ADFA for approval.')}catch(error){console.error('[safe faculty swap request]',error);toast(error.message,true)}
  };
 }

 async function resolveCandidate(ref){
  if(specialReplacement(ref))return{special:true,kind:String(ref.kind).toLowerCase(),name:specialLabel(ref.kind),facultyId:'',faculty:null};
  const candidateKey=String(ref?.candidateKey||'').trim();if(!candidateKey)return null;
  const mapSnap=await db.collection('settings').doc(SWAP_MAP).get();if(!mapSnap.exists)return null;
  const mapping=(mapSnap.data().entries||[]).find(row=>String(row?.key||'')===candidateKey),facultyId=String(mapping?.facultyId||'').trim();if(!facultyId)return null;
  const facultySnap=await db.collection('faculty').doc(facultyId).get();if(!facultySnap.exists)return null;
  const faculty={__id:facultySnap.id,...facultySnap.data()};return{special:false,kind:'faculty',name:canonicalName(faculty,facultyId),facultyId,faculty};
 }
 function findOutgoingIndex(current,request){const arr=assignedArray(current),fromId=String(request?.fromFaculty?.facultyId||''),fromName=norm(request?.fromFaculty?.name);return arr.findIndex(a=>(fromId&&String(a.ucid||a.facultyId||'')===fromId)||(fromName&&norm(a.name)===fromName))}
 async function liveIncomingWarnings(resolved,current){
  if(!resolved||resolved.special)return[];const warnings=[],date=ymd(current.date),records=Array.isArray(resolved.faculty?.awayFromCampusRecords)?resolved.faculty.awayFromCampusRecords:[];
  if(records.some(r=>r?.startDate&&r?.endDate&&String(r.startDate)<=date&&date<=String(r.endDate)))warnings.push(`${resolved.name}: Unavailable (AFC).`);
  const q=await db.collection(SESSIONS).where('date','==',date).get(),aliases=facultyAliases(resolved.faculty),conflicts=[];
  for(const doc of q.docs){if(doc.id===current.id)continue;const s={id:doc.id,...doc.data()},has=assignedArray(s).some(a=>String(a.ucid||a.facultyId||'')===resolved.facultyId||aliases.has(norm(a.name)));if(!has)continue;if(overlaps(current.start,current.end,s.start,s.end))conflicts.push(`${s.course||'Course'} ${s.start||'—'}-${s.end||'—'}`)}
  if(conflicts.length)warnings.push(`${resolved.name}: timetable conflict — ${conflicts.join('; ')}.`);return warnings;
 }
 async function safeApproveRequest(requestId){
  if(!user||!UCVM.admin(profile))return;
  const [requestSnap]=await Promise.all([db.collection(REQUESTS).doc(requestId).get()]);if(!requestSnap.exists)return toast('This request no longer exists.',true);
  const request={id:requestSnap.id,...requestSnap.data()};if(request.status!=='pending'||request.requestType!=='faculty_swap')return;
  if(!request.toFaculty?.candidateKey&&!specialReplacement(request.toFaculty))return;
  const sessionRef=db.collection(SESSIONS).doc(request.sessionId),sessionSnap=await sessionRef.get();if(!sessionSnap.exists)return toast('The session no longer exists. Review this request manually.',true);
  const current={id:sessionSnap.id,...sessionSnap.data()};for(const field of ['course','date','start','end','topic','type','room'])if(!sameVal(field==='date'?ymd(current[field]):current[field],request.base?.[field]))return toast('This session changed after the request was submitted. Approval is blocked to protect newer data.',true);
  const idx=findOutgoingIndex(current,request);if(idx<0)return toast('The outgoing instructor is no longer assigned. Approval is blocked.',true);
  const resolved=await resolveCandidate(request.toFaculty);if(!resolved)return toast('The replacement faculty mapping could not be resolved. Rebuild the faculty swap directory before approving.',true);
  if(resolved.special&&!String(request.reason||'').trim())return toast('Sessional / Other requests require a reason or note.',true);
  const warnings=await liveIncomingWarnings(resolved,current),warningText=warnings.length?`\n\nWARNING — availability/conflict checks:\n- ${warnings.join('\n- ')}\n\nYou may override as ADFA, but review these conflicts first.`:'';
  if(!confirm(`Approve and apply this faculty replacement to the live timetable?${warningText}`))return;
  const arr=assignedArray(current),out=arr[idx]||{},incoming={...out,ucid:resolved.facultyId,name:resolved.name,category:resolved.special?specialLabel(resolved.kind):'Faculty',source:'Approved swap request',swappedFrom:{ucid:String(out.ucid||out.facultyId||''),name:out.name||''},swappedAt:new Date().toISOString()};
  if(resolved.special){delete incoming.facultyId;incoming.ucid=''}
  arr[idx]=incoming;const patch={assignments:arr,instructor:arr.map(a=>a.name).filter(Boolean).join('; '),facultyIds:UCVM_DATA_INDEX.sessionFacultyIds({...current,assignments:arr})},after={...current,...patch};
  const reqRef=db.collection(REQUESTS).doc(requestId),logRef=db.collection('session_change_log').doc(),batch=db.batch();
  batch.set(sessionRef,{...patch,updatedBy:user.uid,updatedByName:profile.name||user.email||'',updatedAt:stamp()},{merge:true});
  batch.set(logRef,{action:'swap_faculty',requestId,sessionId:current.id,course:current.course||request.course||'',date:ymd(current.date),topic:current.topic||'',fromFaculty:request.fromFaculty||{},toFaculty:{...request.toFaculty,facultyId:resolved.facultyId,name:resolved.name,category:incoming.category},role:incoming.role||current.type||'',changedBy:user.uid,changedByName:profile.name||user.email||'',changedByEmail:user.email||'',changedAt:stamp()});
  batch.update(reqRef,{status:'approved',approvedBy:user.uid,approvedByName:profile.name||user.email||'',approvedAt:stamp(),appliedAt:stamp()});
  try{await batch.commit();await window.UCVM_PAGE_DATA?.updateDerivedIndexes?.([{before:current,after}]);closeModal();toast('Approved and applied to the live timetable.')}catch(error){console.error('[safe faculty swap approval]',error);toast(error.message,true)}
 }

 async function maybeInitializeSwapDirectory(){
  if(adminInitPromise)return adminInitPromise;
  adminInitPromise=(async()=>{
   if(!user||!UCVM.admin(profile))return false;
   const indexSnap=await db.collection('settings').doc(SWAP_INDEX).get();if(indexSnap.exists&&indexSnap.data()?.schemaVersion==='ucvm-faculty-swap-index-v1')return true;
   const facultySnap=await db.collection('faculty').get(),rows=facultySnap.docs.map(d=>({__id:d.id,...d.data()}));
   await UCVM_INDEX_MAINTENANCE.writeFacultySwapIndexes(db,rows,{uid:user.uid,name:profile?.name||user.email||''});console.info('[faculty swap] initialized privacy-safe candidate directory');return true;
  })().catch(error=>{console.warn('[faculty swap directory init]',error);return false}).finally(()=>{adminInitPromise=null});
  return adminInitPromise;
 }

 function bindApprovalButtons(){
  document.querySelectorAll('[data-approve-request]').forEach(button=>{
   if(button.dataset.safeSwapWrapped==='1')return;const original=button.onclick;button.dataset.safeSwapWrapped='1';
   button.onclick=async ev=>{try{const snap=await db.collection(REQUESTS).doc(button.dataset.approveRequest).get(),r=snap.exists?snap.data():null;if(r?.requestType==='faculty_swap'&&(r?.toFaculty?.candidateKey||specialReplacement(r?.toFaculty))){ev?.preventDefault?.();return safeApproveRequest(button.dataset.approveRequest)}}catch(error){console.warn('[safe swap approval probe]',error)}return original?.call(button,ev)};
  });
 }
 function bindSelfSwapButton(){
  const button=$('workflow-self-swap');if(!button||button.dataset.safeSwapWrapped==='1'||!String(button.textContent||'').toLowerCase().includes('replacement for me'))return;
  const session=sessionById(lastSessionId);if(!session)return;button.dataset.safeSwapWrapped='1';button.onclick=()=>openSelfReplacement(session);
 }
 function bindModalOverrides(){bindSelfSwapButton();bindApprovalButtons()}

 if(page==='index.html'){
  document.addEventListener('click',event=>{const block=event.target.closest?.('[data-session-id]');if(block?.dataset?.sessionId)lastSessionId=String(block.dataset.sessionId)},true);
  new MutationObserver(bindModalOverrides).observe(document.documentElement,{childList:true,subtree:true});
 }
 if(page==='faculty-admin.html')window.addEventListener('ucvm:admin-ready',()=>{profile=window.UCVM_ADMIN_DATA?.profile?.()||profile;user=auth.currentUser;maybeInitializeSwapDirectory()});
 auth.onAuthStateChanged(async u=>{
  user=u;profile=null;if(!u)return;
  try{const snap=window.UCVM_PAGE_DATA?.profileSnapshot?await window.UCVM_PAGE_DATA.profileSnapshot(u.uid):await db.collection('users').doc(u.uid).get();profile=snap.exists?snap.data():null;if(profile&&UCVM.admin(profile))maybeInitializeSwapDirectory()}catch(error){console.warn('[faculty swap auth]',error)}
 });
 window.UCVM_SAFE_SWAP={openSelfReplacement,safeApproveRequest,maybeInitializeSwapDirectory};
})();
