'use strict';
window.UCVM_AFC_ACTIONS=(()=>{
 const stamp=()=>firebase.firestore.FieldValue.serverTimestamp(),b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)};
 async function decide({db,user,profile,request,action,signature,rejectionReason=''}){
  const ref=db.doc(`afc_requests/${request.id}`),batch=db.batch(),audit=db.collection('afc_audit').doc(),actor=profile?.name||user.email||user.uid;
  if(action==='recommend')batch.update(ref,{status:'pending_admin',reportToSignature:{...signature,signedOnBehalf:String(request.reportToUid||'')!==user.uid},updatedAt:stamp()});
  else if(action==='reject')batch.update(ref,{status:'rejected',rejectionReason,rejectedSignature:signature,updatedAt:stamp()});
  else if(action==='approve'){
   const swapIndexUpdate=await UCVM_INDEX_MAINTENANCE.prepareFacultySwapAfcUpdate(db,request.facultyId,request.startDate,request.endDate);
   await UCVM_ASSETS.ensureAfcPdf();
   const complete={...request,status:'approved',adminSignature:signature},bytes=await UCVM_AFC_PDF.render(complete),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),sha256=[...digest].map(x=>x.toString(16).padStart(2,'0')).join(''),size=350000,chunks=[];for(let i=0;i<bytes.length;i+=size)chunks.push(bytes.subarray(i,i+size));
   batch.update(ref,{status:'approved',adminSignature:signature,pdfChunkCount:chunks.length,pdfSha256:sha256,pdfByteLength:bytes.length,approvedAt:stamp(),updatedAt:stamp()});chunks.forEach((part,i)=>batch.set(ref.collection('pdf_chunks').doc(String(i).padStart(3,'0')),{index:i,base64:b64(part),sha256}));
   batch.update(db.doc(`faculty/${request.facultyId}`),{awayFromCampusRecords:firebase.firestore.FieldValue.arrayUnion({requestId:request.id,startDate:request.startDate,endDate:request.endDate,workDays:request.workDays,purpose:request.reason==='vacation'?'Vacation':request.purposeDestination,status:'approved',sourceName:'AFC request',approvedAt:new Date().toISOString()}),updatedAt:stamp(),updatedBy:user.uid,updatedByName:actor});
   if(swapIndexUpdate)batch.set(swapIndexUpdate.ref,{...swapIndexUpdate.data,generatedAt:stamp()});
  } else throw Error('Unsupported AFC decision.');
  batch.set(audit,{action:`afc_${action}`,requestId:request.id,requesterUid:request.requesterUid,reportToUid:request.reportToUid||'',changedBy:user.uid,changedByName:actor,changedAt:stamp()});await batch.commit();
 }
 async function withdraw({db,user,profile,request}){
  if(!db||!user||!request?.id)throw Error('A signed-in requester and AFC request are required.');
  const ref=db.doc(`afc_requests/${request.id}`),audit=db.collection('afc_audit').doc(),actor=profile?.name||user.email||user.uid;
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref),current=snap.data()||{};
   if(current.requesterUid!==user.uid)throw Error('Only the requester can withdraw this AFC request.');
   if(!['pending_report_to','pending_admin'].includes(current.status))throw Error('This AFC request can no longer be withdrawn.');
   tx.update(ref,{status:'withdrawn',withdrawnBy:user.uid,withdrawnAt:stamp(),updatedAt:stamp()});
   tx.set(audit,{action:'afc_withdraw',requestId:request.id,requesterUid:user.uid,reportToUid:current.reportToUid||'',changedBy:user.uid,changedByName:actor,changedAt:stamp()});
  });
 }
 return{decide,withdraw};
})();
