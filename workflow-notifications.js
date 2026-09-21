'use strict';
window.UCVM_WORKFLOW_NOTIFICATIONS=(()=>{
 const COLLECTION='workflow_notifications';
 const KINDS=new Set(['request_assigned','request_resubmitted','office_decision','request_applied','request_withdrawn','assignment_recheck_required']);
 const OFFICES=new Set(['adc','lab','adfa']);
 const text=value=>String(value??'').trim();
 const esc=value=>text(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 function build({kind='',office='',request={},session={},message=''}={}){
  kind=text(kind);office=text(office).toLowerCase();
  if(!KINDS.has(kind))throw Error('Unsupported workflow notification.');
  if(!OFFICES.has(office))throw Error('Unsupported notification recipient.');
  const requestId=text(request.id||request.requestId),sessionId=text(session.id||session.sessionId||request.sessionId),course=text(session.course||request.course||request.basePublic?.course),date=text(session.date||request.date||request.patchPublic?.date||request.basePublic?.date).slice(0,10);
  const facultyDisplayName=text(request.proposedFacultyName||session.facultyDisplayName||session.instructor);
  return{recipientOffice:office,kind,requestId,sessionId,course,date,start:text(session.start||request.patchPublic?.start||request.basePublic?.start),end:text(session.end||request.patchPublic?.end||request.basePublic?.end),type:text(session.type||request.patchPublic?.type||request.basePublic?.type),topic:text(session.topic||request.topic||request.patchPublic?.topic||request.basePublic?.topic),facultyDisplayName,message:text(message).slice(0,1000),createdAt:null,readBy:[]};
 }
 function emitBatch(batch,db,event,createdAt){
  if(!batch?.set||!db?.collection)throw Error('Firestore batch is required.');
  const ref=db.collection(COLLECTION).doc(),payload={...build(event),createdAt};batch.set(ref,payload);return{id:ref.id,...payload};
 }
 function formatWhen(value){try{return value?.toDate?.().toLocaleString('en-CA',{timeZone:'America/Edmonton'})||''}catch{return''}}
 function label(kind){return({request_assigned:'New request',request_resubmitted:'Request resubmitted',office_decision:'Office decision',request_applied:'Request applied',request_withdrawn:'Request withdrawn',assignment_recheck_required:'Faculty assignment recheck'})[kind]||kind}
 function render(host,rows,user){
  host.innerHTML=`<div class="workflow-notifications-head"><strong>Workflow notifications</strong><button type="button" data-notification-close aria-label="Close">×</button></div><div class="workflow-notifications-list">${rows.length?rows.map(row=>{const unread=!(row.readBy||[]).includes(user.uid);return `<button type="button" class="workflow-notification ${unread?'unread':''}" data-notification-id="${esc(row.id)}"><span class="workflow-notification-title">${esc(label(row.kind))}${row.recipientOffice?` · ${esc(row.recipientOffice.toUpperCase())}`:''}</span><span>${esc([row.course,row.date,row.start&&row.end?`${row.start}–${row.end}`:''].filter(Boolean).join(' · '))}</span>${row.facultyDisplayName?`<span>Faculty: ${esc(row.facultyDisplayName)}</span>`:''}${row.message?`<span>${esc(row.message)}</span>`:''}<small>${esc(formatWhen(row.createdAt))}</small></button>`}).join(''):'<div class="workflow-notification-empty">No workflow notifications.</div>'}</div>`;
  host.classList.remove('hidden');
 }
 function mount({db,user,profile,host}={}){
  if(!db||!user||!host)return()=>{};
  const role=String(profile?.role||'').toLowerCase(),caps=window.UCVM_OFFICE_CAPABILITIES,offices=caps?.officesForProfile?.(profile)||[];
  if(!offices.length){host.classList.add('hidden');return()=>{}}
  const fullOverview=['developer','owner','adfa_general'].includes(role);
  let query=db.collection(COLLECTION);
  query=fullOverview?query.orderBy('createdAt','desc').limit(50):offices.length===1?query.where('recipientOffice','==',offices[0]).orderBy('createdAt','desc').limit(50):query.where('recipientOffice','in',offices).orderBy('createdAt','desc').limit(50);
  const unsubscribe=query.onSnapshot(snapshot=>render(host,snapshot.docs.map(doc=>({id:doc.id,...doc.data()})),user),error=>{console.warn('[workflow notifications]',error);host.classList.add('hidden')});
  host.onclick=event=>{if(event.target.closest?.('[data-notification-close]')){host.classList.add('hidden');return}const item=event.target.closest?.('[data-notification-id]');if(!item)return;db.collection(COLLECTION).doc(item.dataset.notificationId).update({readBy:firebase.firestore.FieldValue.arrayUnion(user.uid)}).catch(error=>console.warn('[workflow notification read]',error))};
  const assignmentRecheck=event=>{if(!offices.includes('adc'))return;const detail=event?.detail||{},batch=db.batch(),createdAt=firebase.firestore.FieldValue.serverTimestamp();emitBatch(batch,db,{kind:'assignment_recheck_required',office:'adfa',session:detail},createdAt);batch.commit().catch(error=>console.warn('[assignment recheck notification]',error))};
  window.addEventListener('ucvm:assignment-recheck-required',assignmentRecheck);
  return()=>{unsubscribe?.();window.removeEventListener('ucvm:assignment-recheck-required',assignmentRecheck)};
 }
 return Object.freeze({build,emitBatch,mount});
})();
