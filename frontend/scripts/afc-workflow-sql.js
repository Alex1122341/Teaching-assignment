'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_AFC_SQL=api.createSqlAfcWorkflow({root});
})(typeof window==='undefined'?globalThis:window,function(){
  const TERMS_VERSION='ucvm-afc-terms-page2-v1';
  const TERMS_SOURCE='absence-from-campus-app.pdf#page=2';
  const AFC_REQUEST_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SELF_ROLES=new Set(['faculty','hicc','visc']);
  const ADMIN_ROLES=new Set(['developer','owner','administrator','adfa_general','adfa_regular','admin']);

  function normalizeRole(value){
    return String(value??'').trim().toLowerCase().replace(/[\s-]+/g,'_');
  }

  function requestActions(request,{uid='',role=''}={}){
    const actor=String(uid??'').trim(),normalizedRole=normalizeRole(role),isAdmin=ADMIN_ROLES.has(normalizedRole);
    const status=String(request?.status??'').trim();
    const requester=String(request?.requesterFirebaseUid??'').trim();
    const reportTo=String(request?.reportToFirebaseUid??'').trim();
    const canWithdraw=SELF_ROLES.has(normalizedRole)&&requester===actor&&['pending_report_to','pending_admin'].includes(status);
    const canRecommend=status==='pending_report_to'&&(isAdmin||(SELF_ROLES.has(normalizedRole)&&reportTo===actor));
    const canApprove=status==='pending_admin'&&isAdmin;
    const canReject=canRecommend||canApprove;
    // UX-07: an approved request can change dates. Faculty start a new approval;
    // the ADFA office changes them directly. Pending requests are withdrawn instead.
    const approved=status==='approved'&&!String(request?.supersededByAfcRequestId??'').trim();
    const canChangeDates=approved&&SELF_ROLES.has(normalizedRole)&&requester===actor;
    const canOfficeChangeDates=approved&&isAdmin;
    return{canWithdraw,canRecommend,canReject,canApprove,canChangeDates,canOfficeChangeDates};
  }

  function createSqlAfcWorkflow(options={}){
    const root=options.root||(typeof window==='undefined'?globalThis:window);
    const doc=options.document||root.document;
    const getClient=options.dataClient?()=>options.dataClient:()=>root.UCVM_PAWS_DATA;
    const getAuth=options.auth?()=>options.auth:()=>root.firebase?.auth?.()||{};
    let mode='dashboard';
    const getProfile=options.profile||(()=>{const source=mode==='timetable'?root.UCVM_PAGE_DATA:root.UCVM_FACULTY_DATA;return source?.profile?.()||{}});
    const roleResolver=options.roleResolver||(value=>{try{return root.UCVM?.role?.(value)??value}catch(_){return value}});
    const signatureCapture=options.signatureCapture||((input)=>root.UCVM_SIGNATURE?.capture?.(input));
    const ask=options.prompt||((message)=>root.prompt?.(message));
    const FormDataCtor=options.FormData||root.FormData||globalThis.FormData;
    const escape=options.escapeHtml||((value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    let requests=[],writeCapabilities={requestLifecycle:false,decisions:false,approvedArtifactCreation:false,dateChange:false},changeTargetId='',officeEditId='',loaded=false,busy=false,panelId='afc-panel',applicantSignature=null,submitInFlight=false,submitOutcomeUnconfirmed=false;
    const downloadInFlight=new Map();
    const panel=()=>doc?.getElementById?.(panelId)||null;
    function syncSubmitButton(){const currentForm=doc?.getElementById?.('afc-sql-form'),button=currentForm?.querySelector?.('button[type="submit"]');if(button)button.disabled=submitInFlight||submitOutcomeUnconfirmed;}
    const profile=()=>getProfile()||{};
    const actorRole=()=>normalizeRole(roleResolver(profile().role??profile().baseRole??''));
    const user=()=>getAuth()?.currentUser||null;
    const uid=()=>String(user()?.uid??'').trim();
    const client=()=>{const value=getClient();if(!value)throw Error('The PAWS University API is unavailable.');return value};
    const e=escape;
    const showFaculty = value => root.PAWS_FACULTY_NAME?.format?.(value) || String(value??'');

    function actionsFor(request){return requestActions(request,{uid:uid(),role:actorRole()})}
    function unavailableMessage(){
      const messages=[];
      if(!writeCapabilities.requestLifecycle)messages.push('Submitting and withdrawing AFC requests are currently unavailable.');
      if(!writeCapabilities.decisions)messages.push('AFC recommendations and decisions are currently unavailable.');
      if(!writeCapabilities.approvedArtifactCreation)messages.push('Creating a missing approved AFC PDF is currently unavailable; existing approved PDFs remain downloadable.');
      return messages.length?'<p class="afc-note" role="status">'+messages.map(e).join(' ')+'</p>':'';
    }
    function statusLabel(value){return({pending_report_to:'Pending Reports To approval',pending_admin:'Pending ADMIN approval',approved:'Approved',rejected:'Rejected',withdrawn:'Withdrawn',superseded:'Replaced by new dates'}[value]||value||'Unknown')}
    const PENDING=['pending_report_to','pending_admin'];
    function openChangeFor(id){return requests.find(row=>String(row.replacesAfcRequestId??'')===String(id)&&PENDING.includes(String(row.status??'')))||null}
    function formHtml(){
      if(!SELF_ROLES.has(actorRole())||!writeCapabilities.requestLifecycle)return'';
      const displayName=profile().displayName||user()?.displayName||user()?.email||'Signed-in account';
      const original=changeTargetId?findRequest(changeTargetId):null;
      const reason=original?.reason==='business_other'?'business_other':'vacation';
      const changeNote=original?'<p class="afc-note" role="status">Changing the dates of your approved request ('+e(original.startDate)+' – '+e(original.endDate)+'). Enter the new dates, sign again and submit. It goes through approval again; your current approved dates stay in effect until the new dates are approved. <button type="button" id="afc-sql-change-cancel">Cancel date change</button></p>':'';
      return '<details class="afc-new"'+(original?' open':'')+'><summary>'+(original?'Change dates of an approved AFC request':'New AFC request')+'</summary><form id="afc-sql-form">'+changeNote+
        '<p class="afc-autofill">Submitting as '+e(showFaculty(displayName))+'. The simulated Testing API determines faculty identity and workflow routing.</p>'+
        '<div class="afc-grid"><label>'+(original?'New start date':'Start date')+'<input type="date" name="startDate" required value="'+e(original?.startDate||'')+'"></label>'+
        '<label>'+(original?'New end date':'End date')+'<input type="date" name="endDate" required value="'+e(original?.endDate||'')+'"></label>'+
        '<label>Reason<select name="reason" required><option value="vacation"'+(reason==='vacation'?' selected':'')+'>Vacation</option><option value="business_other"'+(reason==='business_other'?' selected':'')+'>Business / Other</option></select></label></div>'+
        '<label>Contact address<textarea name="contactAddress" required maxlength="500"></textarea></label>'+
        '<label>Phone number<input type="tel" name="contactPhone" required maxlength="50"></label>'+
        '<label id="afc-sql-purpose-wrap"'+(reason==='business_other'?'':' hidden')+'>Purpose and destination<textarea name="purposeDestination" maxlength="1000">'+e(original?.purposeDestination||'')+'</textarea></label>'+
        '<label>Coverage arrangements (required when the server finds teaching during this period)<textarea name="coverage" maxlength="2000">'+e(original?.coverage||'')+'</textarea></label>'+
        '<label class="afc-terms"><input type="checkbox" name="termsAccepted" required> I have reviewed and accept the <a href="absence-from-campus-app.pdf#page=2" target="_blank" rel="noopener">AFC Terms &amp; Conditions (page 2)</a>.</label>'+
        '<div class="afc-signature-control"><button class="btn btn-secondary" type="button" id="afc-sql-sign">Choose signature</button><span><strong id="afc-sql-signature-status">Not signed</strong><small>Type, draw, or upload a signature image.</small></span></div>'+
        '<div class="afc-submit-row"><button class="btn btn-primary" type="submit">'+(original?'Submit date change for approval':'Submit AFC request')+'</button><span id="afc-sql-submit-status" role="status"></span></div>'+
      '</form></details>';
    }

    function card(request){
      const id=String(request.afcRequestId??''),a=actionsFor(request),status=String(request.status??'');
      const details=['<p>'+e(request.startDate)+' – '+e(request.endDate)+' · '+e(request.workDays)+' workday(s) · '+e(request.reason==='vacation'?'Vacation':'Business / Other')+'</p>'];
      if(request.purposeDestination)details.push('<p><b>Purpose/destination:</b> '+e(request.purposeDestination)+'</p>');
      if(request.coverage)details.push('<p><b>Coverage:</b> '+e(request.coverage)+'</p>');
      if(request.rejectionReason)details.push('<p class="error"><b>Rejected:</b> '+e(request.rejectionReason)+'</p>');
      if(status==='approved')details.push('<p class="afc-note" role="status">Approved.</p>');
      const pendingChange=status==='approved'?openChangeFor(id):null;
      if(pendingChange)details.push('<p class="afc-note" role="status">A date change to '+e(pendingChange.startDate)+' – '+e(pendingChange.endDate)+' is waiting for approval. These dates stay in effect until it is approved.</p>');
      if(request.replacesAfcRequestId&&PENDING.includes(status))details.push('<p class="afc-note">Date change for an earlier approved request. The earlier dates stay in effect until this is approved.</p>');
      if(status==='superseded')details.push('<p class="afc-note">These dates were replaced by an approved date change. Change History shows the old and new dates.</p>');
      if(a.canWithdraw&&writeCapabilities.requestLifecycle)details.push('<p class="afc-note">To change the dates of a pending request, withdraw it and submit a new request.</p>');
      const controls=[];
      if(a.canWithdraw&&writeCapabilities.requestLifecycle)controls.push('<button type="button" data-afc-withdraw="'+e(id)+'">Withdraw request</button>');
      if(a.canRecommend&&writeCapabilities.decisions)controls.push('<button type="button" data-afc-action="recommend" data-afc-id="'+e(id)+'">Sign &amp; recommend</button>');
      if(a.canApprove&&writeCapabilities.decisions)controls.push('<button type="button" data-afc-action="approve" data-afc-id="'+e(id)+'">Sign &amp; approve</button>');
      if(a.canReject&&writeCapabilities.decisions)controls.push('<button type="button" data-afc-action="reject" data-afc-id="'+e(id)+'">Sign &amp; reject</button>');
      if(status==='approved'&&AFC_REQUEST_UUID.test(id))controls.push('<button type="button" data-afc-download="'+e(id)+'">Download Approved PDF</button>');
      if(a.canChangeDates&&!pendingChange&&writeCapabilities.requestLifecycle&&writeCapabilities.dateChange)controls.push('<button type="button" data-afc-change-dates="'+e(id)+'">Change dates</button>');
      if(a.canOfficeChangeDates&&!pendingChange&&writeCapabilities.dateChange&&request.versionToken)controls.push('<button type="button" data-afc-office-dates="'+e(id)+'">Edit dates</button>');
      const officeEditor=officeEditId===id&&a.canOfficeChangeDates&&!pendingChange&&writeCapabilities.dateChange?'<div class="afc-grid" data-afc-office-editor="'+e(id)+'"><label>New start date<input type="date" data-afc-office-start value="'+e(request.startDate)+'"></label><label>New end date<input type="date" data-afc-office-end value="'+e(request.endDate)+'"></label><span><button type="button" data-afc-office-save="'+e(id)+'">Save dates</button> <button type="button" data-afc-office-cancel="'+e(id)+'">Cancel</button></span><p class="afc-note">The ADFA office change applies immediately without a new approval. Change History records the old and new dates; the approved PDF keeps the originally approved dates.</p><p class="afc-note" role="status" id="afc-office-status-'+e(id)+'"></p></div>':'';
      if(a.canRecommend&&ADMIN_ROLES.has(actorRole()))details.push('<p class="afc-note">An administrator may sign on behalf of Reports To; the server remains authoritative.</p>');
      return '<article class="afc-card"><header><strong>'+e(showFaculty(request.facultyName))+'</strong><span class="afc-status '+e(status)+'">'+e(statusLabel(status))+'</span></header>'+
        details.join('')+(status==='approved'?'<p class="afc-note" role="status" id="afc-download-status-'+e(id)+'"></p>':'')+
        (controls.length?'<div class="afc-review">'+controls.join('')+'</div>':'')+officeEditor+'</article>';
    }

    function render(){
      const target=panel();if(!target)return;
      target.innerHTML='<div class="dashboard-heading"><div><h2>Absence from Campus</h2><p>Testing Demo: synthetic AFC requests are stored in this browser, not University SQL or Firestore.</p></div><button type="button" id="afc-sql-refresh">Refresh</button></div>'+
        unavailableMessage()+formHtml()+'<div class="afc-list">'+(requests.map(card).join('')||'<p>No AFC requests are visible to this account.</p>')+'</div>';
      bind();
    }

    function findRequest(id){return requests.find(row=>String(row.afcRequestId??'')===String(id??''))}
    function requireAction(id,action){
      const row=findRequest(id);if(!row)throw Error('This AFC request is not in the current server-scoped list. Refresh the list before acting.');
      const allowed=actionsFor(row);
      if(action==='withdraw'&&!writeCapabilities.requestLifecycle)throw Error('AFC request lifecycle writes are currently unavailable.');
      if(['recommend','approve','reject'].includes(action)&&!writeCapabilities.decisions)throw Error('AFC decisions are currently unavailable.');
      if(action==='withdraw'&&allowed.canWithdraw)return row;
      if(action==='recommend'&&allowed.canRecommend)return row;
      if(action==='approve'&&allowed.canApprove)return row;
      if(action==='reject'&&allowed.canReject)return row;
      if(action==='approve')throw Error('Only an administrator can approve a pending Admin-stage request.');
      if(action==='withdraw')throw Error('Only the requester may withdraw a request in a pending state.');
      throw Error('This account cannot make that decision at the current workflow stage.');
    }

    async function load(force=false){
      if((loaded&&!force)||busy)return requests;
      busy=true;const target=panel();if(target)target.innerHTML='<p class="afc-loading">Loading AFC requests…</p>';
      try{
        const api=client();const rows=await api.listAfcRequests();requests=Array.isArray(rows)?rows:[];
        try{writeCapabilities=await api.afcWriteCapabilities()}catch(_){writeCapabilities={requestLifecycle:false,decisions:false,approvedArtifactCreation:false,dateChange:false}}
        if(!writeCapabilities||typeof writeCapabilities!=='object')writeCapabilities={requestLifecycle:false,decisions:false,approvedArtifactCreation:false,dateChange:false};
        loaded=true;if(force&&submitOutcomeUnconfirmed)submitOutcomeUnconfirmed=false;render();return requests
      }
      catch(error){if(target)target.innerHTML='<p class="error">'+e(error?.message||'AFC requests could not be loaded.')+'</p>';throw error}
      finally{busy=false}
    }

    async function performWrite(send,description){
      let result;
      try{result=await send()}
      catch(cause){
        const status=Number(cause?.status);
        if((status>=400&&status<500)||(status===503&&cause?.code==='WRITE_DISABLED')||['UNAUTHENTICATED','TOKEN_REFRESH_FAILED'].includes(cause?.code))throw cause;
        const error=Error('The '+description+' outcome could not be confirmed. Refresh the request list before trying again.');
        error.code='OUTCOME_UNCONFIRMED';error.cause=cause;throw error;
      }
      if(!result?.afcRequestId){
        const error=Error('The server response could not confirm the '+description+'. Refresh the request list before trying again.');
        error.code='OUTCOME_UNCONFIRMED';throw error;
      }
      try{await load(true)}
      catch(_){
        const target=panel();
        if(target)target.innerHTML='<p class="error" role="status">'+e('The '+description+' was accepted, but the request list could not refresh. Use Refresh before acting again.')+'</p>';
      }
      return result;
    }

    async function submit(payload){
      if(!SELF_ROLES.has(actorRole()))throw Error('Only Faculty, HICC, or VISC accounts may submit an AFC request.');
      if(!writeCapabilities.requestLifecycle)throw Error('AFC request submissions are currently unavailable.');
      if(changeTargetId)return changeDates(changeTargetId,payload);
      const result=await performWrite(()=>client().submitAfcRequest(payload),'submission');
      applicantSignature=null;
      return result;
    }

    // UX-07: the requester's date change for an approved request (new approval).
    async function changeDates(id,payload){
      const row=findRequest(id);
      if(!row||!actionsFor(row).canChangeDates)throw Error('Only your own approved AFC request can have its dates changed. Withdraw a pending request and submit a new one.');
      if(!writeCapabilities.requestLifecycle||!writeCapabilities.dateChange)throw Error('Changing AFC dates is currently unavailable.');
      if(openChangeFor(id))throw Error('A date change for this request is already waiting for approval.');
      if(payload?.startDate===row.startDate&&payload?.endDate===row.endDate)throw Error('The new dates are the same as the approved dates.');
      const result=await performWrite(()=>client().submitAfcDateChange(id,{...payload,expectedVersion:row.versionToken}),'date change');
      applicantSignature=null;changeTargetId='';render();
      return result;
    }

    // UX-07: the ADFA office changes approved dates directly (no new approval).
    async function officeChangeDates(id,startDate,endDate){
      const row=findRequest(id);
      if(!row||!actionsFor(row).canOfficeChangeDates)throw Error('Only an approved request can have its dates changed by the ADFA office.');
      if(!writeCapabilities.dateChange)throw Error('Changing AFC dates is currently unavailable.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate))||!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))||endDate<startDate)throw Error('Choose a valid start and end date.');
      if(startDate===row.startDate&&endDate===row.endDate)throw Error('The new dates are the same as the current dates.');
      const result=await performWrite(()=>client().changeApprovedAfcDates(id,{expectedVersion:row.versionToken,startDate,endDate}),'date change');
      officeEditId='';render();
      return result;
    }

    async function withdraw(id){
      requireAction(id,'withdraw');
      return performWrite(()=>client().withdrawAfcRequest(id),'withdrawal');
    }

    async function decide(id,action,signature,rejectionReason=''){
      requireAction(id,action);
      if(!signature||typeof signature!=='object')throw Error('A signature is required for this decision.');
      const payload=action==='reject'?{signature,rejectionReason:String(rejectionReason??'').trim()}:{signature};
      if(action==='reject'&&!payload.rejectionReason)throw Error('A rejection reason is required.');
      const method={recommend:'recommendAfcRequest',reject:'rejectAfcRequest',approve:'approveAfcRequest'}[action];
      if(!method)throw Error('Unsupported AFC decision.');
      return performWrite(()=>client()[method](id,payload),action);
    }

    function artifactFilename(id,contentDisposition){
      const expected='afc-approved-'+id.toLowerCase()+'.pdf';
      const match=String(contentDisposition??'').match(/(?:^|;)\s*filename\s*=\s*"?([^";]+)"?\s*(?:;|$)/i);
      const supplied=String(match?.[1]??'');
      return supplied.toLowerCase()===expected?supplied:expected;
    }

    function saveApprovedPdf(id,artifact){
      if(String(artifact?.contentType??'').split(';',1)[0].trim().toLowerCase()!=='application/pdf'||!artifact?.bytes)
        throw Error('The approved PDF response was invalid.');
      const BlobCtor=root.Blob||globalThis.Blob,URLApi=root.URL||globalThis.URL;
      if(typeof BlobCtor!=='function'||typeof URLApi?.createObjectURL!=='function'||typeof URLApi?.revokeObjectURL!=='function'||typeof doc?.createElement!=='function')
        throw Error('This browser cannot download the approved PDF.');
      const blob=new BlobCtor([artifact.bytes],{type:'application/pdf'}),url=URLApi.createObjectURL(blob),anchor=doc.createElement('a');
      anchor.href=url;anchor.download=artifactFilename(id,artifact.contentDisposition);anchor.rel='noopener';
      try{doc.body?.appendChild?.(anchor);anchor.click()}
      finally{
        anchor.remove?.();
        const revoke=()=>URLApi.revokeObjectURL(url);
        if(typeof root.setTimeout==='function')root.setTimeout(revoke,0);else revoke();
      }
      return{filename:anchor.download,bytes:artifact.bytes};
    }

    function setDownloadStatus(id,message){
      const status=doc?.getElementById?.('afc-download-status-'+id);
      if(status)status.textContent=String(message??'');
    }

    function downloadApprovedArtifact(id){
      const row=findRequest(id);
      if(!row||String(row.status??'')!=='approved')throw Error('Only a finally approved request in the current server list can be downloaded.');
      const requestId=String(row.afcRequestId??'').trim();
      if(!AFC_REQUEST_UUID.test(requestId))throw Error('The approved request identifier is invalid.');
      if(downloadInFlight.has(requestId))return downloadInFlight.get(requestId);
      const operation=Promise.resolve().then(async()=>{
        setDownloadStatus(requestId,'Preparing approved PDF…');
        try{
          let artifact;
          try{artifact=await client().getApprovedAfcArtifact(requestId)}
          catch(error){
            if(error?.code!=='ARTIFACT_NOT_FOUND')throw error;
            if(!writeCapabilities.approvedArtifactCreation)throw Error('An approved PDF has not been created, and PDF creation is currently unavailable.');
            artifact=await client().createApprovedAfcArtifact(requestId);
          }
          const saved=saveApprovedPdf(requestId,artifact);
          setDownloadStatus(requestId,'Approved PDF downloaded.');
          return saved;
        }catch(error){
          setDownloadStatus(requestId,error?.message||'The approved PDF could not be downloaded.');
          throw error;
        }finally{downloadInFlight.delete(requestId)}
      });
      downloadInFlight.set(requestId,operation);
      return operation;
    }

    async function captureDecision(id,action){
      requireAction(id,action);
      const activeUser=user(),signer=profile().displayName||activeUser?.displayName||activeUser?.email||'Signed-in account';
      const signature=await signatureCapture({name:signer,email:activeUser?.email||'',uid:uid(),title:'Sign AFC '+action});
      if(!signature)return null;
      let rejectionReason='';
      if(action==='reject'){rejectionReason=String(ask('Reason for rejection:')??'').trim();if(!rejectionReason)return null}
      return decide(id,action,signature,rejectionReason);
    }

    function formPayload(form){
      if(!FormDataCtor)throw Error('Form submission is unavailable in this browser.');
      const values=new FormDataCtor(form),startDate=String(values.get('startDate')||'').trim(),endDate=String(values.get('endDate')||'').trim(),reason=String(values.get('reason')||'').trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||endDate<startDate)throw Error('Choose a valid start and end date.');
      if(!['vacation','business_other'].includes(reason))throw Error('Select Vacation or Business / Other.');
      if(values.get('termsAccepted')!=='on')throw Error('Review and accept the current AFC terms.');
      if(!applicantSignature)throw Error('Choose and confirm an electronic signature.');
      const purposeDestination=String(values.get('purposeDestination')||'').trim();
      if(reason==='business_other'&&!purposeDestination)throw Error('Purpose and destination are required.');
      return{
        startDate,endDate,reason,purposeDestination,
        coverage:String(values.get('coverage')||'').trim(),
        contactAddress:String(values.get('contactAddress')||'').trim(),
        contactPhone:String(values.get('contactPhone')||'').trim(),
        termsAccepted:true,termsVersion:TERMS_VERSION,termsSource:TERMS_SOURCE,
        applicantSignature
      };
    }

    function updateForm(){
      const form=doc?.getElementById?.('afc-sql-form');if(!form)return;
      const fields=new FormDataCtor(form),purpose=doc.getElementById('afc-sql-purpose-wrap');
      if(purpose)purpose.hidden=String(fields.get('reason')||'')!=='business_other';
    }

    function bind(){
      const form=doc?.getElementById?.('afc-sql-form');
      if(form){
        form.onchange=updateForm;
        syncSubmitButton();
        form.onsubmit=async event=>{
          event.preventDefault();
          if(submitInFlight||submitOutcomeUnconfirmed)return;
          submitInFlight=true;syncSubmitButton();
          const status=doc.getElementById('afc-sql-submit-status');if(status)status.textContent='Submitting…';
          try{
            const wasDateChange=Boolean(changeTargetId);
            await submit(formPayload(form));form.reset();
            const signatureStatus=doc.getElementById('afc-sql-signature-status');if(signatureStatus)signatureStatus.textContent='Not signed';
            const current=doc.getElementById('afc-sql-submit-status');if(current)current.textContent=wasDateChange?'Date change submitted for approval. Your current approved dates stay in effect until it is approved.':'Request submitted.';
          }catch(error){
            if(error?.code==='OUTCOME_UNCONFIRMED')submitOutcomeUnconfirmed=true;
            const current=doc.getElementById('afc-sql-submit-status');if(current)current.textContent=error?.message||'The request could not be submitted.';
          }finally{submitInFlight=false;syncSubmitButton()}
        };
        const sign=doc.getElementById('afc-sql-sign');
        if(sign)sign.onclick=async()=>{const status=doc.getElementById('afc-sql-signature-status'),activeUser=user();try{if(typeof signatureCapture!=='function')throw Error('The signature chooser did not load.');applicantSignature=await signatureCapture({name:profile().displayName||activeUser?.displayName||activeUser?.email||'',email:activeUser?.email||'',uid:uid(),title:'Sign AFC request'});if(status)status.textContent=applicantSignature?applicantSignature.mode+' signature ready · '+new Date(applicantSignature.signedAt).toLocaleString('en-CA'):'Not signed'}catch(error){if(status)status.textContent=error?.message||'Signature capture failed.'}};
      }
      const target=panel();if(!target?.querySelectorAll)return;
      const refresh=doc.getElementById('afc-sql-refresh');if(refresh)refresh.onclick=()=>load(true);
      const changeCancel=doc.getElementById('afc-sql-change-cancel');if(changeCancel)changeCancel.onclick=()=>{changeTargetId='';applicantSignature=null;render()};
      target.querySelectorAll('[data-afc-change-dates]').forEach(button=>button.onclick=()=>{changeTargetId=button.dataset.afcChangeDates;applicantSignature=null;render();doc.getElementById('afc-sql-form')?.scrollIntoView?.({block:'start'})});
      target.querySelectorAll('[data-afc-office-dates]').forEach(button=>button.onclick=()=>{officeEditId=button.dataset.afcOfficeDates;render()});
      target.querySelectorAll('[data-afc-office-cancel]').forEach(button=>button.onclick=()=>{officeEditId='';render()});
      target.querySelectorAll('[data-afc-office-save]').forEach(button=>button.onclick=async()=>{
        const id=button.dataset.afcOfficeSave,box=button.closest?.('[data-afc-office-editor]'),status=doc.getElementById('afc-office-status-'+id);
        button.disabled=true;if(status)status.textContent='Saving…';
        try{await officeChangeDates(id,box?.querySelector?.('[data-afc-office-start]')?.value||'',box?.querySelector?.('[data-afc-office-end]')?.value||'')}
        catch(error){const current=doc.getElementById('afc-office-status-'+id);if(current)current.textContent=error?.message||'AFC dates could not be changed.';button.disabled=false}
      });
      target.querySelectorAll('[data-afc-withdraw]').forEach(button=>button.onclick=()=>withdraw(button.dataset.afcWithdraw).catch(error=>root.alert?.(error.message)));
      target.querySelectorAll('[data-afc-action]').forEach(button=>button.onclick=()=>captureDecision(button.dataset.afcId,button.dataset.afcAction).catch(error=>root.alert?.(error.message)));
      target.querySelectorAll('[data-afc-download]').forEach(button=>button.onclick=async()=>{
        button.disabled=true;
        try{await downloadApprovedArtifact(button.dataset.afcDownload)}
        catch(error){root.alert?.(error?.message||'The approved PDF could not be downloaded.')}
        finally{button.disabled=false}
      });
    }

    function mount(configuration={}){
      const nextPanel=String(configuration.panelId||'afc-panel'),nextMode=configuration.mode==='timetable'?'timetable':'dashboard';
      if(nextPanel!==panelId||nextMode!==mode)loaded=false;
      panelId=nextPanel;mode=nextMode;return api;
    }

    const api={mount,load,submit,withdraw,changeDates,officeChangeDates,startDateChange:id=>{changeTargetId=String(id??'');render()},recommend:(id,signature)=>decide(id,'recommend',signature),reject:(id,signature,reason)=>decide(id,'reject',signature,reason),approve:(id,signature)=>decide(id,'approve',signature),downloadApprovedArtifact,decide,actionsFor,formPayload,getRequests:()=>[...requests],teachingListHtml:()=>'',unavailable:false};
    return api;
  }

  return{createSqlAfcWorkflow,requestActions,TERMS_VERSION,TERMS_SOURCE};
});
