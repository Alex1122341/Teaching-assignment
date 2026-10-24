(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PAWS_AFC_FORMS=api;})(typeof window==='undefined'?null:window,function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const base64=bytes=>{if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');let s='';const b=new Uint8Array(bytes);for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);};
 function savePdf(result,id){
  if(result.contentType!=='application/pdf'||!result.bytes?.byteLength||result.bytes.byteLength>2097152)throw Error('Invalid document response.');
  const url=root.URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'})),a=root.document.createElement('a');a.href=url;a.download='afc-form-'+id+'.pdf';a.click();root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
 }
 function createController({api,host,getUser=()=>root?.firebase?.auth?.().currentUser,getFaculty=()=>[],facultyName=r=>(root?.PAWS_FACULTY_NAME||(typeof module==='object'&&module.exports?require('./faculty-name'):null)).format(r,'Name unavailable'),randomUUID=()=>root.crypto.randomUUID(),download=savePdf}){
  let generation=0,read=false,enabled=false,busy=false,facultyId='',selected=null,key='',documents=[],cursor=null,message='',success=null,openedUid='';
  const uid=()=>String(getUser()?.uid||''),current=(g,u)=>g===generation&&u===uid();
  function render(){
   host.innerHTML=`<section class="afc-forms-card" aria-labelledby="afc-upload-heading"><header><h3 id="afc-upload-heading">Upload AFC Form</h3><p>Save an original PDF for the selected faculty member. Uploaded files are not an approval and do not create an absence record.</p></header><div class="field-grid"><label class="field"><span class="field-label">Faculty</span><select class="select" data-form-faculty ${busy||!read?'disabled':''}><option value="">Select active faculty…</option>${getFaculty().filter(r=>r.active!==false).map(r=>`<option value="${esc(r.facultyId)}" ${r.facultyId===facultyId?'selected':''}>${esc(facultyName(r))}</option>`).join('')}</select></label><label class="field"><span class="field-label">PDF document</span><input class="input" type="file" accept="application/pdf,.pdf" data-form-file ${busy||!enabled||!facultyId?'disabled':''}><span class="aux-note">PDF only · maximum2MiB · up to100 pages</span></label></div>${selected?`<p class="afc-form-preview"><strong>${esc(selected.name)}</strong> · ${selected.size.toLocaleString()} bytes · PDF<br><span class="aux-note">Metadata preview only. No reasons or dates are extracted.</span></p>`:''}<div class="form-actions"><button class="btn btn-primary" type="button" data-form-upload ${busy||!enabled||!selected||!facultyId?'disabled':''}>${busy?'Working…':'Upload PDF'}</button><span role="status" aria-live="polite" class="toolbar-note">${esc(message||(!enabled?'Document upload is currently unavailable.':''))}</span></div>${success?`<p class="afc-form-preview">Uploaded and confirmed: <strong>${esc(success.fileName)}</strong> · ${Number(success.pageCount)} page(s) <button class="btn" type="button" data-form-success>Download PDF</button></p>`:''}<h4>Uploaded documents${facultyId?' for selected faculty':''}</h4>${facultyId&&read?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Document</th><th>Size</th><th>Pages</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>${documents.map(d=>`<tr><td>${esc(d.fileName)}</td><td>${Number(d.byteLength).toLocaleString()} bytes</td><td>${Number(d.pageCount)}</td><td>${esc(String(d.createdAtUtc).replace('T',' ').slice(0,19))} UTC</td><td><button class="btn" type="button" data-form-download="${esc(d.documentId)}" ${busy?'disabled':''}>Download PDF</button></td></tr>`).join('')||'<tr><td colspan="5">No uploaded documents.</td></tr>'}</tbody></table></div>${cursor?'<button class="btn" type="button" data-form-more>Load more documents</button>':''}`:'<p class="aux-note">Select a faculty member to view authorized uploaded documents.</p>'}</section>`;
   const bind=(s,event,fn)=>{const n=host.querySelector(s);if(n)n[event]=fn;};
   bind('[data-form-faculty]','onchange',e=>chooseFaculty(e.target.value));bind('[data-form-file]','onchange',e=>selectFile(e.target.files?.[0]));bind('[data-form-upload]','onclick',upload);bind('[data-form-more]','onclick',()=>list(true));bind('[data-form-success]','onclick',()=>getDocument(success?.documentId));
   for(const n of host.querySelectorAll('[data-form-download]'))n.onclick=()=>getDocument(n.getAttribute('data-form-download'));
  }
  async function open(){const u=uid();if(openedUid!==u)clear();else if(busy){render();return;}openedUid=u;const g=++generation;enabled=false;read=false;success=null;documents=[];render();try{const caps=await api.afcFormCapabilities();if(current(g,u)){read=caps.read===true;enabled=caps.upload===true;render();if(facultyId&&read)await list();}}catch(_){if(current(g,u)){selected=null;key='';message='Document access is unavailable.';render();}}}
  async function chooseFaculty(id){if(busy)return;generation++;facultyId=getFaculty().some(r=>r.facultyId===id&&r.active!==false)?id:'';selected=null;key='';success=null;documents=[];cursor=null;message='';render();if(facultyId)await list();}
  async function list(more=false){if(!read||!facultyId||busy)return;const g=generation,u=uid();busy=true;render();try{const r=await api.listAfcForms({facultyId,limit:25,...(more&&cursor?{cursor}:{})});if(current(g,u)){documents=more?[...documents,...r.documents]:r.documents;cursor=r.nextCursor;}}catch(_){if(current(g,u))message='Documents could not be loaded.';}finally{if(current(g,u)){busy=false;render();}}}
  async function selectFile(file){if(busy)return;selected=null;key='';success=null;message='';if(file){if(!enabled||!facultyId)message='Select a faculty member and verify upload permission first.';else if(!/^(?!\s)[^\\/:*?"<>|\x00-\x1f]+\.pdf$/i.test(file.name)||file.name.length>180||(file.type&&file.type!=='application/pdf')||file.size<1||file.size>2097152)message='Choose a PDF up to2MiB.';else{selected=file;key=randomUUID();}}render();}
  async function upload(){
   if(busy||!enabled||!read||!selected||!facultyId)return;
   const g=generation,u=uid(),file=selected,boundFaculty=facultyId,boundKey=key;busy=true;message='Validating and uploading PDF…';render();
   try{
    const bytes=await file.arrayBuffer();if(bytes.byteLength!==file.size||bytes.byteLength>2097152)throw Error('The selected file changed. Select it again.');if(!current(g,u))return;
    const r=await api.uploadAfcForm({requestId:boundKey,facultyId:boundFaculty,fileName:file.name,contentType:'application/pdf',fileBase64:base64(bytes)});if(!current(g,u))return;
    if(!r.document?.documentId||r.document.fileName!==file.name||r.document.byteLength!==file.size)throw Error('Upload response was incomplete.');
    success=r.document;selected=null;key='';cursor=null;message='Uploaded and confirmed. Existing absence and approval records are unchanged.';
    try{const listed=await api.listAfcForms({facultyId:boundFaculty,limit:25});if(current(g,u)){documents=listed.documents;cursor=listed.nextCursor;}}catch(_){if(current(g,u))message+=' Document list refresh unavailable; use the confirmed download link.';}
   }catch(e){if(current(g,u))message=(!Number(e?.status)||e.status>=500)?'Upload status is unconfirmed. Retry with the same upload key; the server prevents duplicates.':(e.message||'The PDF could not be uploaded.');}
   finally{if(current(g,u)){busy=false;render();}}
  }
  async function getDocument(id){if(busy||!read||!id)return;const g=generation,u=uid();busy=true;message='Downloading authorized document…';render();try{const r=await api.getAfcFormDocument(id);if(current(g,u)){download(r,id);message='Document downloaded.';}}catch(_){if(current(g,u))message='Document download is unavailable. Reload to verify your current permissions.';}finally{if(current(g,u)){busy=false;render();}}}
  function clear(){generation++;openedUid='';read=false;enabled=false;busy=false;facultyId='';selected=null;key='';documents=[];cursor=null;message='';success=null;host.innerHTML='';}
  return Object.freeze({open,chooseFaculty,selectFile,upload,list,getDocument,clear});
 }
 const validId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
 function documentAction(record){return validId(record?.documentId)?`<button class="btn btn-small" type="button" data-afc-document="${esc(record.documentId)}">Download PDF</button>`:'<span class="muted" title="No PDF original was archived for this record">N/A</span>';}
 function createRecordAttachment({api,host,getUser,getFacultyId,randomUUID=()=>root.crypto.randomUUID()}){
  let generation=0,openedUid='',enabled=false,busy=false,selected=null,key='',boundFaculty='',confirmed=null,message='',invalid=false;
  const uid=()=>String(getUser()?.uid||''),current=(g,u,f)=>generation===g&&uid()===u&&String(getFacultyId()||'')===f;
  const cancelled=()=>Object.assign(Error('The faculty or account changed. Review the AFC form again; any confirmed original remains in its faculty archive.'),{status:409,code:'AFC_CONTEXT_CHANGED'});
  function render(){host.innerHTML=`<section class="afc-record-pdf"><label class="field"><span class="field-label">Archive original AFC PDF (optional)</span><input class="input" type="file" accept="application/pdf,.pdf" data-afc-record-pdf ${busy||!enabled||!getFacultyId()?'disabled':''}><span class="aux-note">PDF · up to 2MiB / 100 pages. Archived with the manual record; this is not an approval. Records without an original show N/A.</span></label>${selected?`<p>${esc(selected.name)} · ${Number(selected.size).toLocaleString()} bytes</p>`:''}${confirmed?`<p>Original archived: ${esc(confirmed.fileName)}. ${documentAction(confirmed)}<br><small>The AFC record is confirmed only after Create AFC Record succeeds.</small></p>`:''}<p role="status" aria-live="polite">${esc(message||(!enabled?'PDF upload access is unavailable. You may create an AFC record without a PDF.':''))}</p></section>`;const input=host.querySelector('[data-afc-record-pdf]');if(input)input.onchange=e=>selectFile(e.target.files?.[0]);}
  async function open(){const u=uid();if(openedUid!==u)clear();if(busy)return;openedUid=u;const g=++generation;try{const caps=await api.afcFormCapabilities();if(g===generation&&uid()===u){enabled=caps.upload===true;render();}}catch(_){if(g===generation&&uid()===u){enabled=false;render();}}}
  function facultyChanged(){generation++;busy=false;selected=null;key='';boundFaculty='';confirmed=null;message='';invalid=false;render();}
  function selectFile(file){if(busy)return;generation++;selected=null;confirmed=null;key='';message='';invalid=false;boundFaculty=String(getFacultyId()||'');if(file){if(!enabled||!validId(boundFaculty)){invalid=true;message='Select the AFC faculty and verify PDF upload permission first.';}else if(typeof file.name!=='string'||file.name.length>180||!/^(?!\s)[^\\/:*?"<>|\x00-\x1f]+\.pdf$/i.test(file.name)||(file.type&&file.type!=='application/pdf')||file.size<1||file.size>2097152){invalid=true;message='Choose a PDF up to 2MiB.';}else{selected=file;key=randomUUID();}}render();}
  async function prepare(facultyId){
   if(invalid)throw Object.assign(Error(message),{status:400,code:'INVALID_DOCUMENT'});
   if(!selected&&!confirmed)return null;
   if(busy||openedUid!==uid()||facultyId!==boundFaculty||String(getFacultyId()||'')!==facultyId)throw cancelled();
   if(confirmed)return confirmed.documentId;
   if(!enabled)throw Object.assign(Error('PDF upload access is unavailable.'),{status:503,code:'WRITE_DISABLED'});
   const g=generation,u=uid(),file=selected;busy=true;message='Archiving original PDF before creating the AFC record…';render();
   try{const bytes=await file.arrayBuffer();if(!current(g,u,facultyId))throw cancelled();if(bytes.byteLength!==file.size||bytes.byteLength>2097152)throw Object.assign(Error('The PDF changed. Select it again.'),{status:400});
    const r=await api.uploadAfcForm({requestId:key,facultyId,fileName:file.name,contentType:'application/pdf',fileBase64:base64(bytes)});if(!current(g,u,facultyId))throw cancelled();
    if(!validId(r.document?.documentId)||r.document.facultyId?.toLowerCase()!==facultyId.toLowerCase()||r.document.fileName!==file.name||r.document.byteLength!==file.size)throw Error('Archive confirmation is incomplete. Retry the same original.');
    confirmed=r.document;selected=null;message='PDF archived. Creating its AFC record…';return confirmed.documentId;
   }catch(e){if(current(g,u,facultyId))message=(!Number(e.status)||e.status>=500)?'PDF archive status is unconfirmed. Retry with the same file/key; do not create a second upload.':e.message;throw e;}
   finally{if(current(g,u,facultyId)){busy=false;render();}}
  }
  function clear(){generation++;openedUid='';enabled=false;busy=false;selected=null;key='';boundFaculty='';confirmed=null;message='';invalid=false;host.innerHTML='';}
  return {open,selectFile,prepare,facultyChanged,clear};
 }
 function createDocumentDownloader({api,getUser,notify=()=>{},download=savePdf}){
  const busy=new Set();return async id=>{if(!validId(id)||busy.has(id))return;const owner=String(getUser()?.uid||'');if(!owner)return;busy.add(id);try{const file=await api.getAfcFormDocument(id);if(String(getUser()?.uid||'')!==owner)return;download(file,id);notify('AFC PDF downloaded.');}catch(_){if(String(getUser()?.uid||'')===owner)notify('AFC PDF download is unavailable. Verify your current access.',true);}finally{busy.delete(id);}};
 }
 function createArchiveController({api,host,getUser,getFacultyId}){
  let generation=0,documents=[],cursor=null,message='',busy=false;
  function render(){host.innerHTML=`<div class="section-title">Archived AFC originals</div><div class="afc-wrap"><p class="aux-note">Original files archived for this faculty member. Unlinked originals may remain when record creation was not completed.</p>${documents.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Document</th><th>Uploaded</th><th>PDF</th></tr></thead><tbody>${documents.map(d=>`<tr><td>${esc(d.fileName)}</td><td>${esc(String(d.createdAtUtc||'N/A').slice(0,10))}</td><td>${documentAction(d)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No archived originals.</p>'}${cursor?'<button type="button" class="btn" data-afc-archive-more>Load more PDFs</button>':''}<p role="status">${esc(message)}</p></div>`;const more=host.querySelector('[data-afc-archive-more]');if(more){more.disabled=busy;more.onclick=()=>load(true);}}
  async function load(more=false){
   if(busy)return;
   const g=++generation,u=String(getUser()?.uid||''),f=String(getFacultyId()||'');
   if(!u||!validId(f)){clear();return;}
   const current=()=>g===generation&&u===String(getUser()?.uid||'')&&f===String(getFacultyId()||'')&&host.isConnected!==false;
   busy=true;
   try{
    const r=await api.listAfcForms({facultyId:f,limit:25,...(more&&cursor?{cursor}:{})});
    if(!current())return;
    documents=more?[...documents,...r.documents]:r.documents;cursor=r.nextCursor;message='';
   }catch(_){if(current()){documents=[];cursor=null;message='Archived originals could not be loaded. Verify your current access.';}}
   finally{if(g===generation){if(current()){busy=false;render();}else clear();}}
  }
  function clear(){generation++;documents=[];cursor=null;busy=false;host.innerHTML='';}
  return {load,clear};
 }
 return {createController,createRecordAttachment,documentAction,createDocumentDownloader,createArchiveController};
});
