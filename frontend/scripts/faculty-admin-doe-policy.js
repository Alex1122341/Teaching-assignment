(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const text=v=>String(v??'').trim();
  function create({api,getAcademicYear,getFaculty=()=>[],canAdmin=()=>false,canPublish=()=>false,canRecalculate=()=>false}={}) {
    if(!api)throw new TypeError('The authenticated PAWS data client is required.');
    let host=null,policy=null,history=[],book=null,activeBook=null,activePolicy=null,busy=false,metadataDirty=false,loadedYear='',firstLoad=true,recalcPreview=null;
    const node=id=>host?.querySelector(`#doe-policy-${id}`);
    const year=()=>text(node('year')?.value||getAcademicYear?.());
    const id=()=>text(policy?.version?.policyVersionId);
    const rev=()=>Number(policy?.version?.revision??0);
    const draft=()=>text(policy?.version?.status).toLowerCase()==='draft';
    const dirty=()=>metadataDirty||Boolean(book?.isDirty());
    const editable=()=>Boolean(id())&&draft()&&canAdmin()&&!busy;
    const say=(message,error=false)=>{node('status').textContent=message;node('status').classList.toggle('error',error);};
    const result=value=>{node('result').textContent=JSON.stringify(value,null,2);};
    function switchPanel(key){host.querySelectorAll('[data-policy-panel]').forEach(n=>n.hidden=n.dataset.policyPanel!==key);host.querySelectorAll('[data-policy-tab]').forEach(n=>{n.classList.toggle('active',n.dataset.policyTab===key);n.setAttribute('aria-pressed',String(n.dataset.policyTab===key));});}
    function gate(){
      if(!host||!book)return;
      const v=policy?.version||{},open=book.editorOpen(),changed=dirty(),active=text(v.status).toLowerCase()==='active';
      const checks={
        'new-draft':!canAdmin(),'clone':!canAdmin()||!id()||changed||open,'copy':!canAdmin()||!id()||changed||open,
        'save':!editable()||open,'validate':!editable()||changed||open,'impact':!editable()||changed||open,
        'publish':!canPublish()||!draft()||changed||open||v.validatedRevision==null||Number(v.validatedRevision)!==rev()||v.impactRevision==null||Number(v.impactRevision)!==rev(),
        'archive':!canPublish()||!draft()||changed||open,
        'recalculate-preview':!canRecalculate()||!active||!(policy?.rules||[]).length,
        'recalculate':!canRecalculate()||!active||!recalcPreview||recalcPreview.policyVersionId!==id()||Number(recalcPreview.policyRevision)!==rev()||Number(node('limit').value)!==recalcPreview.limit
      };
      for(const [key,disabled] of Object.entries(checks))node(key).disabled=busy||disabled;
      for(const key of ['year','history','history-load','load-active','copy-year','limit'])node(key).disabled=busy;
      for(const key of ['version-label','source'])node(key).disabled=busy||Boolean(policy)&&!draft()||!canAdmin();
      node('unsaved').textContent=changed?'Unsaved changes. Save Draft before validation, preview or lifecycle actions.':'';
      node('publish').title='Requires saved changes, validation and impact evidence for this exact Draft revision.';
      book.setLocked(busy);
    }
    function render(){
      const v=policy?.version||{};
      if(activePolicy?.version&&text(activePolicy.version.academicYear)!==year()){activeBook?.setBundle({});node('active-title').textContent='Active Rules · load this Academic Year to view its published policy';}
      node('history').value=id();
      node('version-label').value=v.versionLabel||'';node('source').value=v.sourceReference||'';
      node('meta').textContent=policy?`${v.status} · ${v.academicYear} · revision ${rev()} · ${v.policyVersionId}`:'No policy selected.';
      node('context').textContent=policy&&text(v.status).toLowerCase()==='active'&&!(policy.rules||[]).length?'This Active version is a legacy contract / FTE source snapshot with no configured policy rules. Choose the normalized Draft from Policy Version to review rules.':draft()?'Draft Rule Book: changes require Save Draft, validation and Impact Preview before publication.':policy?'This version is read only. Clone as Draft to propose changes.':'Choose an annual policy version. The interface supplies no default rates.';
      metadataDirty=false;book.setBundle(policy);gate();
      const preview=policy?.impactPreview;
      node('impact-evidence').textContent=preview?`Recorded Impact Preview · revision ${preview.revision}${Number(preview.revision)!==rev()?' · outdated for this version':''}`:'No recorded Impact Preview returned for this version.';
      node('impact-saved').textContent=preview?JSON.stringify(preview,null,2):'';
    }
    function ensureSaved(){if(book.editorOpen())throw new Error('Apply or cancel the open editor first.');if(dirty())throw new Error('Save Draft changes before this action.');}
    function leave(){if(book.editorOpen()){say('Apply or cancel the open editor first.',true);return false;}return !dirty()||window.confirm('Discard unsaved Draft changes and load another version?');}
    async function run(action){if(busy)return;busy=true;gate();try{await action();}catch(e){say(e.message||'DOE operation failed.',true);if(e.code||e.errors||e.details)result({code:e.code,message:e.message,errors:e.errors,details:e.details,currentRevision:e.currentRevision});}finally{busy=false;gate();}}
    async function reload(versionId=id()){
      if(!versionId)throw new Error('The server did not return a policy version ID.');
      const bundle=await api.doePolicyVersion({policyVersionId:versionId});
      if(!bundle?.version?.policyVersionId)throw new Error('The server returned an incomplete policy version.');
      policy=bundle;loadedYear=text(bundle.version.academicYear);node('year').value=loadedYear;recalcPreview=null;render();
    }
    function renderHistory(){
      node('history').innerHTML='<option value="">Select a policy version…</option>'+history.map(r=>`<option value="${esc(r.policyVersionId)}">${esc(r.versionLabel||r.policyVersionId)} · ${esc(r.status)} · r${Number(r.revision)||0}</option>`).join('');node('history').value=id();
      node('history-list').innerHTML=history.length?`<div class="doe-table-scroll"><table class="doe-rule-table"><thead><tr><th>Version</th><th>Status / revision</th><th>Updated / actor</th><th>Published</th><th>Action</th></tr></thead><tbody>${history.map(r=>`<tr><td>${esc(r.versionLabel||r.policyVersionId)}<small>${esc(r.sourceReference)}</small></td><td>${esc(r.status)} · r${Number(r.revision)||0}</td><td>${esc(r.updatedAtUtc||r.createdAtUtc||'Not returned')}<small>${esc(r.updatedBy||r.createdBy||'')}</small></td><td>${esc(r.publishedAtUtc||'—')}</td><td><button class="btn btn-small" type="button" data-policy-history-id="${esc(r.policyVersionId)}">Load</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No policy versions recorded for this Academic Year.</div>';
    }
    async function historyRequest(){history=await api.doePolicyHistory({academicYear:year()});if(!Array.isArray(history))throw new Error('Policy history response must be a list.');renderHistory();}
    async function refreshActiveBanner(){
      try{activePolicy=await api.doeActivePolicy({academicYear:year()});}catch(error){if(error.code!=='ACTIVE_POLICY_NOT_FOUND')throw error;activePolicy=null;}
      activeBook.setBundle(activePolicy||{});
      node('active-title').textContent=activePolicy?.version?`Active Rules · ${activePolicy.version.academicYear} · ${activePolicy.version.versionLabel} · ${(activePolicy.rules||[]).length} rules`:'Active Rules · no published policy';
    }
    async function prepareWorkspace(){
      await refreshActiveBanner();
      if(activePolicy?.version&&canAdmin()){
        const value=await api.copyDoePolicy({sourcePolicyVersionId:activePolicy.version.policyVersionId,academicYear:activePolicy.version.academicYear,mode:'working_draft'});
        await reload(value?.version?.policyVersionId||value?.policyVersionId);await historyRequest();
        say('Working Draft ready. Reopening this page reuses the Draft based on the current Active policy. Active rules remain unchanged.');return;
      }
      const latest=history.filter(r=>text(r.status).toLowerCase()==='draft').sort((a,b)=>text(b.updatedAtUtc||b.createdAtUtc).localeCompare(text(a.updatedAtUtc||a.createdAtUtc)))[0];
      const selected=canAdmin()?latest||activePolicy?.version:activePolicy?.version;
      if(selected)await reload(selected.policyVersionId);
    }
    async function loadHistory(){return run(async()=>{await historyRequest();if(firstLoad&&!policy){firstLoad=false;await prepareWorkspace();}});}
    function mount(root){
      host=root;
      const input=(key,label,value='',extra='')=>`<label class="field"><span class="field-label">${label}</span><input class="input" id="doe-policy-${key}" value="${esc(value)}" ${extra}></label>`;
      const button=(key,label)=>`<button class="btn" id="doe-policy-${key}" type="button">${label}</button>`;
      host.innerHTML=`<div class="section doe-policy-header"><div><div class="section-title">Annual DOE Rule Book</div><p class="aux-note">Review annual rules, linked guidelines and canonical mappings. The authenticated University API records calculations and approvals.</p></div><div class="doe-policy-meta" id="doe-policy-meta"></div></div><div class="doe-policy-toolbar">${input('year','Academic Year',text(getAcademicYear?.()),'placeholder="2026-27" pattern="[0-9]{4}-[0-9]{2}"')}<label class="field"><span class="field-label">Policy Version</span><select class="select" id="doe-policy-history"></select></label>${button('history-load','Refresh Versions')}${button('load-active','Load Active')}</div><p class="aux-note" id="doe-policy-context"></p><div class="doe-policy-toolbar">${input('version-label','Version Label','','maxlength="128"')}${input('source','Source / Provenance','','maxlength="1000" placeholder="Approved Guidelines / MASTER source…"')}${button('new-draft','New Policy Year')}${button('clone','Clone as Draft')}</div><div class="doe-policy-toolbar">${input('copy-year','Copy target Academic Year','','placeholder="2027-28" pattern="[0-9]{4}-[0-9]{2}"')}${button('copy','Copy from Previous Year')}<span class="aux-note">Copy the selected source to a different year. Annual exceptions are excluded.</span></div><nav class="doe-rulebook-tabs" aria-label="DOE policy sections"><button class="btn" data-policy-tab="rules" type="button">Rule Book &amp; Mappings</button><button class="btn" data-policy-tab="preview" type="button">Preview &amp; Validate</button><button class="btn" data-policy-tab="history" type="button">History</button></nav><section class="section wide doe-policy-main-panel" data-policy-panel="rules"><div id="doe-policy-rulebook"></div></section><section class="section wide doe-policy-main-panel" id="doe-policy-section-preview" data-policy-panel="preview" hidden><div class="section-title">Preview &amp; Validate</div><p class="aux-note">Save Draft first. Validation identifies missing rules, mappings, references and facts. Impact Preview records evidence for this revision without changing current allocations.</p><div class="form-actions">${button('validate','Validate Rule Book')}${button('impact','Impact Preview')}</div><pre class="doe-policy-result" id="doe-policy-result" aria-live="polite">No validation or preview requested.</pre><details><summary id="doe-policy-impact-evidence"></summary><pre class="doe-policy-result" id="doe-policy-impact-saved"></pre></details></section><section class="section wide doe-policy-main-panel" id="doe-policy-section-history" data-policy-panel="history" hidden><div class="section-title">Policy Version History</div><p class="aux-note">Recorded annual version status, revision, publication and actor information returned by the server.</p><div class="doe-policy-history-list" id="doe-policy-history-list"></div></section><section class="section wide" id="doe-policy-section-actions"><div class="section-title">Draft &amp; Lifecycle Actions</div><p class="aux-note" id="doe-policy-unsaved"></p><div class="form-actions">${button('save','Save Draft')}${button('publish','Publish')}${button('archive','Archive Draft')}</div><div class="form-actions">${input('limit','Recalculate batch size (max 250)','100','type="number" min="1" max="250"')}${button('recalculate-preview','Preview Recalculation')}${button('recalculate','Recalculate Active Policy')}</div><p class="aux-note">Recalculation applies to normalized assignment facts in the selected Active policy. Imported source totals and negotiated manual adjustments are separate. Preview the batch before confirming its recalculation.</p><p class="doe-policy-status" id="doe-policy-status" role="status" aria-live="polite"></p></section>`;
      host.innerHTML+=`<dialog class="doe-rule-dialog" id="doe-policy-create-dialog" aria-labelledby="doe-policy-create-title"><form id="doe-policy-create-form"><div class="doe-dialog-heading"><h3 id="doe-policy-create-title">New Policy Year</h3>${button('create-cancel','Cancel')}</div><p class="aux-note">Create an empty annual Draft with its approved source provenance. Rules and mappings are added after creation.</p><div class="doe-editor-grid">${input('create-year','Academic Year','','required pattern="[0-9]{4}-[0-9]{2}"')}${input('create-label','New Version Label','','required maxlength="128"')}${input('create-source','Approved Source / Provenance','','required maxlength="1000"')}</div><p id="doe-policy-create-error" class="error" role="alert"></p><div class="form-actions"><button class="btn btn-primary" id="doe-policy-create-submit" type="submit">Create Draft</button></div></form></dialog>`;
      if(!window.UCVM_FACULTY_DOE_RULEBOOK){say('The structured Rule Book asset could not load.',true);return;}
      host.innerHTML='<nav class="doe-rulebook-tabs" aria-label="DOE workspace"><button type="button" class="btn active" data-doe-workspace="draft" aria-pressed="true">Draft</button><button type="button" class="btn" data-doe-workspace="active" aria-pressed="false">Active Rules</button></nav><details class="doe-active-banner" id="doe-policy-active-banner"><summary id="doe-policy-active-title">Active Rules · published reference</summary><p class="aux-note">Read-only published rules. The Draft workspace below prepares changes; Save, Validate, Impact Preview and Publish determine when they become Active.</p><div id="doe-policy-active-rulebook"></div></details><section id="doe-policy-draft-workspace"><div class="doe-draft-heading"><h2>Draft workspace</h2><p>Choose a rule by its data entry point: Calendar or ADFA Dashboard. Examples are guidance, never automatic approved rates.</p></div>'+host.innerHTML+'</section>';
      activeBook=window.UCVM_FACULTY_DOE_RULEBOOK.create({editable:()=>false,getFaculty,idPrefix:'active-'});activeBook.mount(node('active-rulebook'));
      book=window.UCVM_FACULTY_DOE_RULEBOOK.create({editable,getFaculty,canAddRule:()=>canAdmin()&&Boolean(id())&&!busy,onStartDraft:async()=>{await run(async()=>{ensureSaved();await prepareWorkspace();});return editable();},onChange:gate,onError:m=>say(m,true)});book.mount(node('rulebook'));
      function action(key,fn){node(key).addEventListener('click',()=>{if(!node(key).disabled)return run(fn);});}
      host.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.doeWorkspace){const isDraft=b.dataset.doeWorkspace==='draft';node('draft-workspace').hidden=!isDraft;node('active-banner').open=!isDraft;host.querySelectorAll('[data-doe-workspace]').forEach(n=>{n.classList.toggle('active',n.dataset.doeWorkspace===b.dataset.doeWorkspace);n.setAttribute('aria-pressed',String(n.dataset.doeWorkspace===b.dataset.doeWorkspace));});}if(b.dataset.policyTab){switchPanel(b.dataset.policyTab);if(b.dataset.policyTab==='history')loadHistory();}if(b.dataset.policyHistoryId&&!busy&&leave())run(async()=>{await reload(b.dataset.policyHistoryId);say('Policy version loaded.');});});
      for(const key of ['version-label','source'])node(key).addEventListener('input',()=>{metadataDirty=true;gate();});
      node('year').addEventListener('change',()=>{if(!leave()){node('year').value=loadedYear;return;}if(!/^\d{4}-\d{2}$/.test(year())){node('year').value=loadedYear;say('Use a canonical Academic Year such as 2026-27.',true);return;}loadedYear=year();policy=null;history=[];firstLoad=true;recalcPreview=null;render();renderHistory();loadHistory();});
      node('history').addEventListener('change',()=>{const selected=node('history').value;if(!selected)return;if(!leave()){node('history').value=id();return;}run(async()=>{await reload(selected);say('Policy version loaded.');});});
      action('history-load',historyRequest);
      action('load-active',async()=>{if(!leave())return;const value=await api.doeActivePolicy({academicYear:year()});if(!value?.version)throw new Error('No Active policy exists for this Academic Year.');await reload(value.version.policyVersionId);node('history').value=id();say('Active version loaded.');});
      action('new-draft',async()=>{if(!canAdmin()||!leave())return;node('create-year').value=year();node('create-label').value='';node('create-source').value=text(policy?.version?.sourceReference);node('create-error').textContent='';node('create-dialog').showModal();});
      node('create-cancel').addEventListener('click',()=>{if(!busy)node('create-dialog').close();});
      node('create-form').addEventListener('submit',event=>{
        event.preventDefault();if(!canAdmin()||busy)return;
        return run(async()=>{
          node('create-submit').disabled=true;
          try{
            const payload={academicYear:text(node('create-year').value),versionLabel:text(node('create-label').value),sourceReference:text(node('create-source').value)};
            if(!/^\d{4}-\d{2}$/.test(payload.academicYear)||!payload.versionLabel||!payload.sourceReference)throw new Error('Canonical Academic Year, new version label and source provenance are required.');
            const value=await api.createDoePolicyDraft(payload);await reload(value?.version?.policyVersionId||value?.policyVersionId);await historyRequest();await refreshActiveBanner();node('create-dialog').close();say('Draft created. Add referenced rules and canonical mappings.');
          }catch(error){node('create-error').textContent=error.message;throw error;}finally{node('create-submit').disabled=false;}
        });
      });
      action('clone',async()=>{ensureSaved();const value=await api.copyDoePolicy({sourcePolicyVersionId:id(),academicYear:policy.version.academicYear,mode:'clone'});await reload(value?.version?.policyVersionId||value?.policyVersionId);await historyRequest();say('Cloned as Draft. Review copied rules and references.');});
      action('copy',async()=>{ensureSaved();const target=text(node('copy-year').value);if(!/^\d{4}-\d{2}$/.test(target)||target===policy.version.academicYear)throw new Error('Copy requires a different canonical target Academic Year.');const value=await api.copyDoePolicy({sourcePolicyVersionId:id(),academicYear:target});await reload(value?.version?.policyVersionId||value?.policyVersionId);await historyRequest();await refreshActiveBanner();say('Copied to an annual Draft. Review all copied items; prior exceptions were excluded.');});
      action('save',async()=>{if(book.editorOpen())throw new Error('Apply or cancel the open editor before saving.');const patch={...book.getPatch(),versionLabel:text(node('version-label').value),sourceReference:text(node('source').value)};if(!patch.versionLabel||!patch.sourceReference)throw new Error('Version label and source provenance are required.');const value=await api.saveDoePolicyDraft(id(),{expectedRevision:rev(),patch});await reload(value?.version?.policyVersionId||value?.policyVersionId||id());await historyRequest();say('Draft saved. Validate and run Impact Preview for its new revision.');});
      action('validate',async()=>{ensureSaved();switchPanel('preview');const value=await api.validateDoePolicyDraft(id(),{expectedRevision:rev()});result(value);await reload();say(value.valid?'Validation passed for this revision.':'Validation found issues. Review the listed rules and facts.',!value.valid);});
      action('impact',async()=>{ensureSaved();switchPanel('preview');const value=await api.previewDoePolicyImpact(id(),{expectedRevision:rev()});result(value);await reload();say('Impact Preview recorded. Current allocations are unchanged.');});
      action('publish',async()=>{ensureSaved();if(!window.confirm(`Publish ${policy.version.versionLabel} for ${policy.version.academicYear}, revision ${rev()}? This activates the reviewed annual rules.`))return;switchPanel('preview');result(await api.publishDoePolicyDraft(id(),{expectedRevision:rev()}));await reload();await historyRequest();await prepareWorkspace();say('Policy published. A working Draft is ready for the new Active policy; recalculation remains an explicit action.');});
      action('archive',async()=>{ensureSaved();if(!window.confirm('Archive this Draft policy version?'))return;const selected=id();await api.archiveDoePolicy(selected,{expectedRevision:rev()});await reload(selected);await historyRequest();say('Draft archived.');});
      const batchLimit=()=>{const limit=Number(node('limit').value);if(!Number.isInteger(limit)||limit<1||limit>250)throw new Error('Batch size must be a whole number between 1 and 250.');return limit;};
      action('recalculate-preview',async()=>{ensureSaved();const limit=batchLimit();switchPanel('preview');const value=await api.recalculateDoe({academicYear:policy.version.academicYear,limit,preview:true});result(value);if(value.preview!==true||value.policyVersionId!==id()||Number(value.policyRevision)!==rev())throw new Error('Preview does not match the selected Active version. Reload the policy before recalculating.');recalcPreview={...value,limit};say(`Recalculation preview: ${value.recordsProjected??0} normalized assignment records; ${value.needsReview??0} need review. No records changed.`);});
      action('recalculate',async()=>{ensureSaved();const limit=batchLimit();if(!recalcPreview)throw new Error('Preview this recalculation batch first.');if(!window.confirm(`Recalculate ${recalcPreview.recordsProjected??0} projected normalized assignment records for ${policy.version.academicYear} using Active policy ${policy.version.versionLabel}? ${recalcPreview.needsReview??0} records need review.`))return;switchPanel('preview');const value=await api.recalculateDoe({academicYear:policy.version.academicYear,limit,expectedPolicyVersionId:recalcPreview.policyVersionId,expectedPolicyRevision:recalcPreview.policyRevision});result(value);recalcPreview=null;say(`Recalculation created ${value.recordsCreated??0} records; ${value.remaining??0} remain. Review the returned evidence.`);});
      node('limit').addEventListener('input',()=>{recalcPreview=null;gate();});
      node('rulebook').addEventListener('click',()=>queueMicrotask(gate));node('rulebook').addEventListener('close',gate,true);
      loadedYear=year();switchPanel('rules');render();renderHistory();
    }
    return Object.freeze({mount,loadHistory});
  }
  window.UCVM_FACULTY_DOE_POLICY=Object.freeze({create});
})();
