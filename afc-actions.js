'use strict';
window.UCVM_AFC_ACTIONS=(()=>{
 const stamp=()=>firebase.firestore.FieldValue.serverTimestamp(),b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)};
 async function decide({db,user,profile,request,action,signature,rejectionReason=''}){
  const ref=db.doc(`afc_requests/${request.id}`),batch=db.batch(),audit=db.collection('afc_audit').doc(),actor=profile?.name||user.email||user.uid;
  if(action==='recommend')batch.update(ref,{status:'pending_admin',reportToSignature:{...signature,signedOnBehalf:String(request.reportToUid||'')!==user.uid},updatedAt:stamp()});
  else if(action==='reject')batch.update(ref,{status:'rejected',rejectionReason,rejectedSignature:signature,updatedAt:stamp()});
  else if(action==='approve'){
   const complete={...request,status:'approved',adminSignature:signature},bytes=await UCVM_AFC_PDF.render(complete),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),sha256=[...digest].map(x=>x.toString(16).padStart(2,'0')).join(''),size=350000,chunks=[];for(let i=0;i<bytes.length;i+=size)chunks.push(bytes.subarray(i,i+size));
   batch.update(ref,{status:'approved',adminSignature:signature,pdfChunkCount:chunks.length,pdfSha256:sha256,pdfByteLength:bytes.length,approvedAt:stamp(),updatedAt:stamp()});chunks.forEach((part,i)=>batch.set(ref.collection('pdf_chunks').doc(String(i).padStart(3,'0')),{index:i,base64:b64(part),sha256}));
   batch.update(db.doc(`faculty/${request.facultyId}`),{awayFromCampusRecords:firebase.firestore.FieldValue.arrayUnion({requestId:request.id,startDate:request.startDate,endDate:request.endDate,workDays:request.workDays,purpose:request.reason==='vacation'?'Vacation':request.purposeDestination,status:'approved',sourceName:'AFC request',approvedAt:new Date().toISOString()}),updatedAt:stamp(),updatedBy:user.uid,updatedByName:actor});
  } else throw Error('Unsupported AFC decision.');
  batch.set(audit,{action:`afc_${action}`,requestId:request.id,requesterUid:request.requesterUid,reportToUid:request.reportToUid||'',changedBy:user.uid,changedByName:actor,changedAt:stamp()});await batch.commit();
 }
 return{decide};
})();
