'use strict';
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const {getStorage}=require('firebase-admin/storage');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onDocumentWrittenWithAuthContext}=require('firebase-functions/v2/firestore');
const {createHash}=require('node:crypto');
const {ROLES,normalizeRole,isAdmin,isGeneral,isFaculty,historyAll,changes}=require('./policy');
const {validateDraft,nextStatus}=require('./afc-policy');
const {renderAfcPdf}=require('./afc-pdf');
const path=require('node:path');
initializeApp();const db=getFirestore(),auth=getAuth();
const fail=(code,msg)=>{throw new HttpsError(code,msg)};
const str=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const id=v=>{const x=str(v);if(!x||x.includes('/'))fail('invalid-argument','Invalid record ID.');return x};
const stamp=()=>FieldValue.serverTimestamp();
async function actor(req,allowPassword=false){
 if(!req.auth)fail('unauthenticated','Please sign in.');
 const snap=await db.doc(`users/${req.auth.uid}`).get();const p=snap.data();
 if(!p?.active||!ROLES.includes(normalizeRole(p.role))||(!allowPassword&&p.mustChangePassword))fail('permission-denied','Account inactive or password change required.');
 if((req.auth.token.auth_time||0)<(p.validAfterSeconds||0))fail('unauthenticated','Please sign in again.');
 return {...p,uid:req.auth.uid,role:normalizeRole(p.role)};
}
function general(p){if(!isGeneral(p))fail('permission-denied','ADFA General is required.');}
function safeUser(d){const p=d.data();return {uid:d.id,name:p.name||'',email:p.email||'',facultyId:p.facultyId||'',role:normalizeRole(p.role),active:p.active===true,mustChangePassword:p.mustChangePassword===true};}
function audit(p,action,data={}){return {action,...data,changedBy:p.uid,changedByName:p.name||p.email||p.uid,changedByEmail:p.email||'',changedAt:stamp()};}
exports.managementData=onCall(async req=>{
 const p=await actor(req);if(!isGeneral(p)&&p.role!=='hicc')fail('permission-denied','User management is restricted.');
 const [u,g,f]=await Promise.all([db.collection('users').get(),isGeneral(p)?db.collection('faculty_groups').get():db.collection('faculty_groups').where('ownerUid','==',p.uid).get(),isGeneral(p)?db.collection('faculty').get():Promise.resolve(null)]);
 const list=u.docs.map(safeUser).filter(x=>isGeneral(p)||isFaculty(x));
 if(isGeneral(p)){for(let i=0;i<list.length;i+=100){const batch=list.slice(i,i+100),result=await auth.getUsers(batch.map(x=>({uid:x.uid})));for(const account of result.users){const item=batch.find(x=>x.uid===account.uid);item.email=account.email||item.email;}}}
 return {users:list,groups:g.docs.map(d=>({id:d.id,...d.data()})),faculty:f?f.docs.map(d=>({id:d.id,name:d.data().preferredFullName||d.data().hrFullName||d.id,email:d.data().email||''})):[]};
});
exports.saveAccount=onCall(async req=>{
 const p=await actor(req);general(p);const d=req.data||{},role=str(d.role),name=str(d.name),facultyId=str(d.facultyId),email=str(d.email).toLowerCase();
 if(!ROLES.includes(role)||!name||!/^\S+@\S+\.\S+$/.test(email))fail('invalid-argument','A valid name, email and role are required.');
 if(isFaculty({role})&&!facultyId)fail('invalid-argument','Link faculty accounts to a faculty record.');
 if(facultyId&&!(await db.doc(`faculty/${id(facultyId)}`).get()).exists)fail('invalid-argument','Faculty record not found.');
 let uid=d.uid?id(d.uid):null,created=false;
 if(uid){const account=await auth.getUser(uid);if(account.email?.toLowerCase()!==email)fail('invalid-argument','Existing account email cannot be changed here.');}
 if(!uid){try{const u=await auth.createUser({email,password:'ucvm2026',displayName:name});uid=u.uid;created=true;}catch(e){if(e.code==='auth/email-already-exists')fail('already-exists','This email already has an account. Link existing accounts during setup.');throw e}}
 try{
 await db.runTransaction(async tx=>{
  const ref=db.doc(`users/${uid}`),old=await tx.get(ref),generals=await tx.get(db.collection('users').where('role','==','adfa_general').where('active','==',true));
  if(!created&&!old.exists)fail('not-found','Account profile not found.');
  if(old.data()?.role==='adfa_general'&&(role!=='adfa_general'||d.active===false)&&generals.size<=1)fail('failed-precondition','Keep at least one active ADFA General.');
  const owned=await tx.get(db.collection('faculty_groups').where('ownerUid','==',uid));
  if(!owned.empty&&(role!=='hicc'||d.active===false))fail('failed-precondition','Reassign this HICC’s groups before changing their role or disabling them.');
  const memberships=await tx.get(db.collection('faculty_groups').where('memberUids','array-contains',uid));
  if(!memberships.empty&&!isFaculty({role}))fail('failed-precondition','Remove this account from faculty groups before assigning an ADFA role.');
  const patch={name,email,role,facultyId,active:d.active!==false,updatedAt:stamp()};
  if(created)Object.assign(patch,{mustChangePassword:true,createdAt:stamp()});
  tx.set(ref,patch,{merge:true});tx.create(db.collection('account_audit').doc(),audit(p,created?'account_created':'account_updated',{targetUid:uid,targetName:name,targetEmail:email,role,active:patch.active}));
 });
 }catch(e){if(created)await auth.deleteUser(uid);throw e}
 // Firestore active is authoritative; no role or password is stored in browser state as authority.
 return {uid};
});
async function passwordOperation(uid,fn){
 const ref=db.doc(`password_operations/${uid}`),key=db.collection('password_operations').doc().id;
 await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.exists&&Date.now()-s.data().startedAt<120000)fail('aborted','A password change is already in progress. Try again shortly.');tx.set(ref,{key,startedAt:Date.now()});});
 try{return await fn()}finally{await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.key===key)tx.delete(ref)})}
}
exports.resetAccountPassword=onCall({timeoutSeconds:60},async req=>{
 const p=await actor(req);general(p);const uid=id(req.data?.uid),ref=db.doc(`users/${uid}`);if(!(await ref.get()).exists)fail('not-found','Account not found.');
 return passwordOperation(uid,async()=>{
 // Block all existing sessions before changing the credential. No password enters a document or audit event.
 await ref.update({mustChangePassword:true,validAfterSeconds:Math.floor(Date.now()/1000)+1});
 await auth.updateUser(uid,{password:'ucvm2026'});await auth.revokeRefreshTokens(uid);
 await db.collection('account_audit').add(audit(p,'password_reset',{targetUid:uid}));return {ok:true};
 });
});
exports.changeOwnPassword=onCall({timeoutSeconds:60},async req=>{
 const p=await actor(req,true),password=req.data?.password;
 if(Date.now()/1000-(req.auth.token.auth_time||0)>300)fail('unauthenticated','Re-enter your current password.');
 if(typeof password!=='string'||password.length<8||password.length>128||password==='ucvm2026')fail('invalid-argument','Choose a new password of 8–128 characters.');
 return passwordOperation(p.uid,async()=>{
 await actor(req,true);
 await auth.updateUser(p.uid,{password});await auth.revokeRefreshTokens(p.uid);
 await db.doc(`users/${p.uid}`).update({mustChangePassword:false,validAfterSeconds:Math.floor(Date.now()/1000)+1});
 await db.collection('account_audit').add(audit(p,'password_changed',{targetUid:p.uid}));return {ok:true};
 });
});
exports.saveFacultyGroup=onCall(async req=>{
 const p=await actor(req);const d=req.data||{},ref=d.id?db.doc(`faculty_groups/${id(d.id)}`):db.collection('faculty_groups').doc();
 await db.runTransaction(async tx=>{
  const prev=await tx.get(ref),old=prev.data();
  if(!isGeneral(p)&&!(p.role==='hicc'&&old?.ownerUid===p.uid))fail('permission-denied','Only ADFA General or this group’s HICC may manage it.');
  const ownerUid=isGeneral(p)?id(d.ownerUid):old.ownerUid,name=isGeneral(p)?str(d.name):old.name;
  const courseIds=isGeneral(p)?[...new Set((Array.isArray(d.courseIds)?d.courseIds:[]).map(x=>str(x,20)).filter(Boolean))]:old.courseIds;
  const memberUids=[...new Set([ownerUid,...(Array.isArray(d.memberUids)?d.memberUids:[]).map(id)])];
  if(!name||memberUids.length>300)fail('invalid-argument','Group name is required; maximum 300 members.');
  const profiles=await Promise.all(memberUids.map(uid=>tx.get(db.doc(`users/${uid}`))));
  if(profiles.some(s=>!s.data()?.active||!isFaculty(s.data())||!s.data()?.facultyId))fail('invalid-argument','Groups require active faculty accounts linked to faculty records.');
  if(normalizeRole(profiles[0].data().role)!=='hicc')fail('invalid-argument','Each group must have an active HICC owner.');
  tx.set(ref,{name,ownerUid,courseIds,memberUids,updatedAt:stamp()});tx.create(db.collection('account_audit').doc(),audit(p,'group_saved',{groupId:ref.id,before:old||null,after:{name,ownerUid,courseIds,memberUids}}));
 });return {id:ref.id};
});
exports.deleteFacultyGroup=onCall(async req=>{
 const p=await actor(req);general(p);const ref=db.doc(`faculty_groups/${id(req.data?.id)}`);
 await db.runTransaction(async tx=>{const s=await tx.get(ref);if(!s.exists)fail('not-found','Group not found.');tx.delete(ref);tx.create(db.collection('account_audit').doc(),audit(p,'group_deleted',{groupId:ref.id,before:s.data()}));});return {ok:true};
});
exports.facultyDashboardData=onCall(async req=>{
 const p=await actor(req),g=await (isAdmin(p)?db.collection('faculty_groups'):db.collection('faculty_groups').where('memberUids','array-contains',p.uid)).get();
 const groups=g.docs.map(d=>({id:d.id,...d.data()})),uids=[...new Set(groups.flatMap(g=>g.memberUids))];
 const members=uids.length?(await db.getAll(...uids.map(uid=>db.doc(`users/${uid}`)))).filter(s=>s.exists).map(safeUser).filter(u=>u.active&&isFaculty(u)):[];
 return {groups,members};
});
exports.replaceGroupAssignment=onCall(async req=>{
 const p=await actor(req);if(!['hicc','visc'].includes(p.role))fail('permission-denied','An HICC or VISC role is required.');
 const {sessionId,groupId,targetUid,index,expected}=req.data||{};
 if(!Number.isInteger(index)||index<0)fail('invalid-argument','Invalid instructor line.');
 await db.runTransaction(async tx=>{
  const sr=db.doc(`sessions/${id(sessionId)}`),gr=db.doc(`faculty_groups/${id(groupId)}`);
  const [ss,gs,us]=await Promise.all([tx.get(sr),tx.get(gr),tx.get(db.doc(`users/${id(targetUid)}`))]);
  const s=ss.data(),g=gs.data(),u=us.data();
  if(!s||!g||!g.memberUids.includes(p.uid)||!g.memberUids.includes(targetUid)||!g.courseIds.includes(String(s.course))||!u?.active||!isFaculty(u))fail('permission-denied','Select a faculty member and course within your HICC group.');
  const assignments=(s.assignments||[]).map(a=>({...a})),old=assignments[index];if(!old)fail('not-found','Instructor line no longer exists.');
  if(JSON.stringify(old)!==JSON.stringify(expected))fail('aborted','This assignment changed. Refresh and try again.');
  const members=await Promise.all(g.memberUids.map(uid=>tx.get(db.doc(`users/${uid}`))));
  if(!old.ucid||!members.some(m=>m.data()?.active&&m.data()?.facultyId===String(old.ucid)))fail('permission-denied','The existing instructor must also belong to your group.');
  const fr=await tx.get(db.doc(`faculty/${id(u.facultyId)}`));if(!fr.exists)fail('failed-precondition','Linked faculty record is missing.');
  const name=fr.data().preferredFullName||fr.data().hrFullName||u.name;
  assignments[index]={...old,ucid:u.facultyId,name};
  const patch={assignments,instructor:assignments.map(a=>a.name).join('; '),updatedBy:p.uid,updatedByName:p.name,updatedAt:stamp()};
  if(String(s.type).toUpperCase()==='LAB'){const topics=new Map();for(const a of assignments){const t=a.topic||s.topic||'Lab';if(!topics.has(t))topics.set(t,[]);topics.get(t).push(a)}patch.labDetails=[...topics].map(([topic,aa])=>({topic,instructor:aa.map(a=>`${a.name}${a.role?' ('+a.role+')':''}`).join('; '),room:(s.labDetails||[]).find(x=>x.topic===topic)?.room||''}));}
  tx.update(sr,patch);
  // Callable writes use an atomic, server-authored audit event. The trigger skips only this exact update.
  const logRef=db.collection('audit_events').doc();tx.update(sr,{auditEventId:logRef.id});
  tx.create(logRef,audit(p,'update',{entity:'session',recordId:ss.id,course:s.course||'',date:s.date||'',topic:s.topic||'',changes:changes(s,{...s,...patch})}));
 });return {ok:true};
});
function logTrigger(collection,entity){return onDocumentWrittenWithAuthContext({document:`${collection}/{recordId}`,retry:true},async event=>{
 const before=event.data.before.exists?event.data.before.data():null,after=event.data.after.exists?event.data.after.data():null;
 // Only Admin SDK callable updates have unknown/service authentication and a NEW server-authored log marker.
 if(typeof after?.auditEventId==='string'&&!after.auditEventId.includes('/')&&after.auditEventId!==before?.auditEventId&&['unknown','system','service_account'].includes(event.authType)){
  const authored=await db.doc(`audit_events/${after.auditEventId}`).get();if(authored.exists&&authored.data().recordId===event.params.recordId)return;
 }
 const diff=changes(before,after);if(before&&after&&!diff.length)return;
 const uid=event.authId||'',user=uid?(await db.doc(`users/${uid}`).get()).data():null;
 const who={uid:uid||'system',name:user?.name||uid||'System / import',email:user?.email||''};
 const data=after||before||{},key=createHash('sha256').update(event.id).digest('hex');
 const log=audit(who,before?(after?'update':'delete'):'create',{entity,recordId:event.params.recordId,course:data.course||'',date:data.date||'',topic:data.topic||data.preferredFullName||data.hrFullName||'',changes:diff,authType:event.authType||'unknown'});
 log.changedAt=Timestamp.fromDate(new Date(event.time));
 try{await db.doc(`audit_events/${key}`).create(log)}catch(e){if(e.code!==6)throw e}
 });}
exports.auditSession=logTrigger('sessions','session');
exports.auditFaculty=logTrigger('faculty','faculty');

const afcPublic=r=>{const out={...r};for(const[k,v]of Object.entries(out)){if(v&&typeof v.toDate==='function')out[k]=v.toDate().toISOString()}return out};
const sameFaculty=(a,f,p)=>{const ids=new Set([f.id,f.ucid,p.facultyId].map(String)),names=new Set([f.preferredFullName,f.hrFullName,f.name].filter(Boolean).map(x=>String(x).trim().toLowerCase()));return ids.has(String(a?.ucid||a?.facultyId||''))||names.has(String(a?.name||'').trim().toLowerCase())};
async function reportToIdentity(name){
 name=str(name);if(!name)return{};
 for(const field of ['preferredFullName','hrFullName','hrFirstLast','teachingAssignmentName']){const q=await db.collection('faculty').where(field,'==',name).limit(1).get();if(!q.empty){const u=await db.collection('users').where('facultyId','==',q.docs[0].id).where('active','==',true).limit(1).get();if(!u.empty)return{reportToFacultyId:q.docs[0].id,reportToUid:u.docs[0].id}}}
 return{};
}
function afcAudit(p,action,requestId,data={}){return audit(p,action,{requestId,...data})}

exports.submitAfcRequest=onCall({timeoutSeconds:60},async req=>{
 const p=await actor(req);if(!isFaculty(p)||!p.facultyId)fail('permission-denied','A linked faculty, HICC or VISC account is required.');
 const fdoc=await db.doc(`faculty/${id(p.facultyId)}`).get();if(!fdoc.exists)fail('failed-precondition','Linked Faculty Directory record is missing.');
 const f={id:fdoc.id,...fdoc.data()},d=req.data||{},startDate=str(d.startDate,10),endDate=str(d.endDate,10);
 const sq=await db.collection('sessions').where('date','>=',startDate).where('date','<=',endDate).get();
 const teachingSessions=sq.docs.map(x=>({id:x.id,...x.data()})).filter(s=>(s.assignments||[]).some(a=>sameFaculty(a,f,p))).map(s=>({id:s.id,date:s.date||'',start:s.start||'',end:s.end||'',course:s.course||'',topic:s.topic||s.type||''}));
 const draft={startDate,endDate,reason:str(d.reason,30),purposeDestination:str(d.purposeDestination,1000),coverage:str(d.coverage,2000),signatureName:str(d.signatureName,160),attested:d.attested===true,teachingSessions};
 let workDays;try{workDays=validateDraft(draft)}catch(e){fail('invalid-argument',e.message)}
 const route=await reportToIdentity(f.reportsTo),ref=db.collection('afc_requests').doc(),now=new Date().toISOString();
 const record={requesterUid:p.uid,requesterEmail:p.email||'',facultyId:fdoc.id,facultyName:f.preferredFullName||f.hrFullName||p.name,facultySnapshot:{ucid:f.ucid||fdoc.id,firstName:f.firstName||'',lastName:f.lastName||'',rank:f.rank||f.currentTitle||'',currentTitle:f.currentTitle||'',appointmentType:f.appointmentType||'',primaryDepartment:f.primaryDepartment||f.department||'',expiryDate:f.expiryDate||''},reportsTo:f.reportsTo||'',...route,...draft,workDays,applicantSignature:{name:draft.signatureName,uid:p.uid,signedAt:now,attested:true},status:route.reportToUid?'pending_report_to':'pending_admin',submittedAt:stamp(),updatedAt:stamp()};
 await db.runTransaction(async tx=>{tx.create(ref,record);tx.create(db.collection('afc_audit').doc(),afcAudit(p,'afc_submitted',ref.id,{status:record.status,facultyId:fdoc.id}))});
 return{id:ref.id,status:record.status,workDays,teachingCount:teachingSessions.length};
});

exports.listAfcRequests=onCall(async req=>{
 const p=await actor(req);let docs=[];
 if(historyAll(p))docs=(await db.collection('afc_requests').orderBy('submittedAt','desc').limit(100).get()).docs;
 else{const queries=[db.collection('afc_requests').where('requesterUid','==',p.uid).limit(100).get()];if(isFaculty(p))queries.push(db.collection('afc_requests').where('reportToUid','==',p.uid).limit(100).get());const sets=await Promise.all(queries),seen=new Map();for(const s of sets)for(const d of s.docs)seen.set(d.id,d);docs=[...seen.values()].sort((a,b)=>(b.data().submittedAt?.toMillis?.()||0)-(a.data().submittedAt?.toMillis?.()||0)).slice(0,100)}
 return{requests:docs.map(d=>({id:d.id,...afcPublic(d.data())}))};
});

exports.reviewAfcRequest=onCall({timeoutSeconds:60,memory:'512MiB'},async req=>{
 const p=await actor(req),requestId=id(req.data?.id),action=str(req.data?.action,20),signatureName=str(req.data?.signatureName,160),rejectionReason=str(req.data?.rejectionReason,1000),ref=db.doc(`afc_requests/${requestId}`),snap=await ref.get();if(!snap.exists)fail('not-found','AFC request not found.');
 const r=snap.data(),adfa=historyAll(p),reportTo=r.reportToUid===p.uid;if(!signatureName)fail('invalid-argument','Type the approver electronic signature.');if(action==='recommend'&&!reportTo&&!adfa)fail('permission-denied','Only Reports To or an ADFA administrator may recommend this request.');if(action==='approve'&&!adfa)fail('permission-denied','ADFA Administrator approval is required.');if(action==='reject'&&!reportTo&&!adfa)fail('permission-denied','You cannot reject this request.');if(action==='reject'&&!rejectionReason)fail('invalid-argument','A rejection reason is required.');
 let status;try{status=nextStatus(action,r)}catch(e){fail('failed-precondition',e.message)}const signedAt=new Date().toISOString(),patch={status,updatedAt:stamp()};
 if(action==='recommend')patch.reportToSignature={name:signatureName,uid:p.uid,signedAt,signedOnBehalf:adfa&&!reportTo};
 if(action==='reject')Object.assign(patch,{rejectionReason,rejectedSignature:{name:signatureName,uid:p.uid,signedAt}});
 if(action==='approve')patch.adminSignature={name:signatureName,uid:p.uid,signedAt};
 if(status==='approved'){
  const complete={...r,...patch},bytes=await renderAfcPdf(complete,path.join(__dirname,'templates','absence-from-campus-app.pdf')),pdfPath=`afc-approved/${requestId}.pdf`;
  await getStorage().bucket().file(pdfPath).save(bytes,{resumable:false,metadata:{contentType:'application/pdf',cacheControl:'private, no-store',metadata:{requestId}}});
  patch.pdfPath=pdfPath;patch.pdfSha256=createHash('sha256').update(bytes).digest('hex');patch.approvedAt=stamp();
  const facultyRef=db.doc(`faculty/${id(r.facultyId)}`);
  await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.data()?.status!==r.status)fail('aborted','This request changed. Refresh and try again.');tx.update(ref,patch);tx.update(facultyRef,{awayFromCampusRecords:FieldValue.arrayUnion({requestId,startDate:r.startDate,endDate:r.endDate,workDays:r.workDays,purpose:r.reason==='vacation'?'Vacation':r.purposeDestination,status:'approved',sourceName:'AFC request',approvedAt:signedAt}),updatedAt:stamp(),updatedBy:p.uid,updatedByName:p.name||p.email});tx.create(db.collection('afc_audit').doc(),afcAudit(p,'afc_approved',requestId,{facultyId:r.facultyId}))});
 }else await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.data()?.status!==r.status)fail('aborted','This request changed. Refresh and try again.');tx.update(ref,patch);tx.create(db.collection('afc_audit').doc(),afcAudit(p,`afc_${action}`,requestId,{status}))});
 return{status};
});

exports.getAfcPdf=onCall({timeoutSeconds:60},async req=>{
 const p=await actor(req),requestId=id(req.data?.id),snap=await db.doc(`afc_requests/${requestId}`).get();if(!snap.exists)fail('not-found','AFC request not found.');const r=snap.data();if(!r.pdfPath||r.status!=='approved')fail('failed-precondition','The approved PDF is not ready.');if(!historyAll(p)&&r.requesterUid!==p.uid&&r.reportToUid!==p.uid)fail('permission-denied','This PDF is restricted to the faculty member, Reports To and ADFA administrators.');const [bytes]=await getStorage().bucket().file(r.pdfPath).download();return{filename:`AFC-${r.facultyId}-${r.startDate}-${r.endDate}.pdf`,base64:bytes.toString('base64'),sha256:r.pdfSha256||''};
});

exports.removeAssignedAdFields=onCall(async req=>{
 const p=await actor(req);general(p);const marker=db.doc('settings/migrations_assigned_ad_removed'),done=await marker.get();if(done.exists)return{ok:true,removed:0,alreadyDone:true};const q=await db.collection('faculty').get();let removed=0;for(let i=0;i<q.docs.length;i+=400){const batch=db.batch();for(const d of q.docs.slice(i,i+400)){if(Object.prototype.hasOwnProperty.call(d.data(),'assignedAD')){batch.update(d.ref,{assignedAD:FieldValue.delete()});removed++}}await batch.commit()}await db.runTransaction(async tx=>{tx.set(marker,{completedAt:stamp(),completedBy:p.uid,removed});tx.create(db.collection('account_audit').doc(),audit(p,'assigned_ad_removed',{removed}))});return{ok:true,removed};
});
