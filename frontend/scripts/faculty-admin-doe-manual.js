(() => {
  'use strict';
  const ROLES = ['Course Coordinator','HICC','VISC','Course Coordinator / HICC','Rotation / Week Lead','CCC','Trainee / Supervision','Special Project','Other'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const text = value => String(value ?? '').trim();
  const pct = value => value === null || value === undefined ? 'Needs Review' : `${Number(value).toFixed(2)}%`;
  function create({api,academicYear,onSaved=()=>{},canManualWrite=()=>false,canWrite=()=>false}={}) {
    function mount(form,faculty) {
      form.querySelector('#p4-doe-edit-section')?.remove();
      const year = text(academicYear()), section = document.createElement('section');
      section.id='p4-doe-edit-section'; section.className='p4-doe-edit-section';
      let disposed = false, suggestions = [], worksheetReady = false;
      const current = () => !disposed && section.isConnected && String(form.dataset.facultyId).toLowerCase() === String(faculty.facultyId).toLowerCase();
      const status = (node,message,error=false) => { if(!node)return;node.textContent=message;node.classList.toggle('error',error); };
      const fields = (line={},writable=true) => `<div class="p4-doe-assignment-fields">
        <label class="field"><span class="field-label">Role Type</span><select class="select role-type" ${writable?'':'disabled'}>${ROLES.map(role=>`<option ${role===line.roleType?'selected':''}>${esc(role)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Course / Subject / Scope</span><input class="input role-scope" list="p4-doe-scope-options" maxlength="256" value="${esc(line.scopeText)}" placeholder="Select a suggestion or enter scope" ${writable?'':'disabled'}></label>
        <label class="field"><span class="field-label">DOE % · manual adjustment</span><input class="input role-doe" type="number" step="any" value="${esc(line.resultDoe ?? '')}" placeholder="e.g. -2, 0, 2.5" ${writable?'':'disabled'}></label>
        <label class="field"><span class="field-label">Notes · required for negative DOE</span><input class="input role-notes" maxlength="1000" value="${esc(line.notes)}" placeholder="Negotiated reason / dates" ${writable?'':'disabled'}></label>
      </div>`;
      section.innerHTML=`<div class="section-title">DOE Role Assignment · ${esc(year)}</div>
        <p class="aux-note">Access role and DOE assignment are separate. Enter negotiated DOE manually, including zero or a negative adjustment. Adjustments add to existing DOE; a -2% entry reduces the current total by 2 percentage points. Enter any helper's corresponding credit separately.</p>
        <datalist id="p4-doe-scope-options"></datalist><p class="aux-note" id="p4-doe-options-status" role="status" aria-live="polite">Loading existing course / subject suggestions…</p>
        <div id="p4-doe-active" class="p4-doe-active"><div class="empty">Loading DOE assignments…</div></div>
        <div class="p4-doe-new"><h4>Add DOE assignment</h4>${fields({},canManualWrite())}<div class="p4-doe-row-footer"><span class="toolbar-note doe-row-status" role="status" aria-live="polite"></span><button type="button" class="btn btn-primary" data-manual-save disabled>Save assignment</button></div></div>
        <div class="section-title p4-doe-override-title">Office DOE override · ${esc(year)}</div><p class="aux-note">Annual target values are separate from role adjustments. An approved override never overwrites Contract Teaching DOE.</p><div class="p4-doe-assignment-fields"><div class="field"><span class="field-label">Contract Teaching DOE</span><output id="p4-doe-contract" class="field-value">—</output></div><label class="field"><span class="field-label">Override DOE %</span><input id="p4-doe-override-value" class="input" type="number" min="0" step="0.01" ${canWrite()?'':'disabled'}></label><label class="field"><span class="field-label">Reason</span><select id="p4-doe-override-reason" class="select" ${canWrite()?'':'disabled'}><option value="">Select reason</option>${['RSL','Mat Leave','Sick Leave','Special Event','Other'].map(reason=>`<option>${reason}</option>`).join('')}</select></label><label class="field"><span class="field-label">Special notes</span><input id="p4-doe-override-notes" class="input" maxlength="2000" ${canWrite()?'':'disabled'}></label></div><div class="p4-doe-row-footer"><span id="p4-doe-override-status" class="toolbar-note" role="status" aria-live="polite"></span><button type="button" class="btn btn-primary" data-office-save ${canWrite()?'':'disabled'}>Save Office DOE override</button><button type="button" class="btn" data-office-clear ${canWrite()?'':'disabled'}>Clear override</button></div>`;
      const actions=form.querySelector('.form-actions'); if(actions)form.insertBefore(section,actions);else form.appendChild(section);
      const at = selector => section.querySelector(selector);
      const refreshSuggestions = async () => {
        try {
          const options=await api.manualDoeScopeSuggestions({academicYear:year}); if(!current())return;
          suggestions=options;
          at('#p4-doe-scope-options').innerHTML=[...new Set(options.map(option=>text(option.scopeText)).filter(Boolean))].map(scope=>`<option value="${esc(scope)}"></option>`).join('');
          status(at('#p4-doe-options-status'),'Choose an existing suggestion when it matches. Other scope text is also accepted.');
          return true;
        }catch(error){if(current())status(at('#p4-doe-options-status'),`Suggestions unavailable: ${error.message}. Retry by reopening Edit Faculty.`,true);return false;}
      };
      const load = async () => {
        worksheetReady=false;
        at('.p4-doe-new [data-manual-save]').disabled=true;
        try {
          const worksheet=await api.doeWorksheet({facultyId:faculty.facultyId,academicYear:year});if(!current())return false;
          const manual=(worksheet.lines||[]).filter(line=>line.sourceEntityType==='manual_doe_assignment'&&line.active!==false);
          const baseline=(worksheet.lines||[]).filter(line=>['legacy_role_assignment','doe_assignment'].includes(line.sourceEntityType));
          at('#p4-doe-active').innerHTML=manual.map(line=>`<div class="p4-doe-assignment" data-assignment-id="${esc(line.assignmentFactId)}" data-revision="${Number(line.revision)}">${fields(line,canManualWrite())}<div class="p4-doe-row-footer"><span class="aux-note">Manual adjustment · ${esc(pct(line.resultDoe))}</span><span class="toolbar-note doe-row-status" role="status" aria-live="polite"></span>${canManualWrite()?'<button type="button" class="btn btn-small" data-manual-save>Save assignment</button><button type="button" class="btn btn-small btn-danger" data-manual-deactivate>Deactivate</button>':''}</div></div>`).join('')+
            (baseline.length?`<div class="p4-doe-legacy"><h4>Existing role DOE · read-only</h4><p class="aux-note">Known source DOE remains included in totals. Add a manual adjustment above to change negotiated credit.</p>${baseline.map(line=>`<div class="p4-doe-legacy-row"><span>${esc(line.roleType)} · ${esc(line.scopeText||line.courseCode||line.subjectKey)}</span><strong>${esc(pct(line.resultDoe))}</strong></div>`).join('')}</div>`:'');
          at('#p4-doe-contract').textContent=pct(worksheet.target?.contractTeachingDoe);
          at('#p4-doe-override-value').value=worksheet.target?.overrideDoe??'';
          at('#p4-doe-override-reason').value=text(worksheet.target?.overrideReason);
          at('#p4-doe-override-notes').value=text(worksheet.target?.overrideNotes);
          worksheetReady=true;
          at('.p4-doe-new [data-manual-save]').disabled=!canManualWrite();
          return true;
        }catch(error){if(current()){at('#p4-doe-active').innerHTML=`<div class="warn-box" role="alert">${esc(error.message||'DOE could not be loaded.')}</div>`;status(at('.p4-doe-new .doe-row-status'),'Reopen Edit Faculty to reload existing assignments before saving.',true);}return false;}
      };
      section.addEventListener('change',event=>{
        if(!event.target.matches('.role-scope'))return;
        const key=text(event.target.value).replace(/\s+/g,' ').toLowerCase();
        const match=suggestions.find(option=>text(option.scopeText).replace(/\s+/g,' ').toLowerCase()===key);
        if(match)event.target.value=match.scopeText;
      });
      section.addEventListener('click',async event=>{
        const officeButton=event.target.closest('[data-office-save],[data-office-clear]');
        if(officeButton){
          const feedback=at('#p4-doe-override-status');if(!current()||!canWrite()||!worksheetReady||section.dataset.officeBusy==='true')return;
          const raw=text(at('#p4-doe-override-value').value),clear=officeButton.hasAttribute('data-office-clear');
          const override=clear||raw===''?null:{value:Number(raw),reason:at('#p4-doe-override-reason').value,notes:text(at('#p4-doe-override-notes').value)};
          section.dataset.officeBusy='true';officeButton.disabled=true;
          try{await api.saveDoeTargetOverride(faculty.facultyId,{academicYear:year,override});if(current()){await load();await onSaved(faculty.facultyId);status(feedback,'Office DOE override saved.');}}
          catch(error){if(current())status(feedback,error.message||'Office DOE override could not be saved.',true);}
          finally{delete section.dataset.officeBusy;if(current())officeButton.disabled=!canWrite();}return;
        }
        const button=event.target.closest('[data-manual-save],[data-manual-deactivate]');if(!button)return;
        const row=button.closest('.p4-doe-assignment,.p4-doe-new'),feedback=row.querySelector('.doe-row-status');
        if(!current()||row.dataset.busy==='true')return;
        if(!canManualWrite()||!worksheetReady)return status(feedback,'Manual DOE writes are unavailable.',true);
        const id=text(row.dataset.assignmentId),deactivate=button.hasAttribute('data-manual-deactivate');
        const payload={facultyId:faculty.facultyId,academicYear:year,expectedRevision:id?Number(row.dataset.revision):0};
        if(deactivate){if(!window.confirm('Deactivate this manual adjustment? Its audit history will remain.'))return;}
        else {
          payload.roleType=row.querySelector('.role-type').value;payload.scopeText=text(row.querySelector('.role-scope').value);
          const input=row.querySelector('.role-doe'),raw=text(input.value);payload.doeValue=Number(raw);payload.notes=text(row.querySelector('.role-notes').value);
          if(!payload.scopeText||!raw||!input.validity.valid||!Number.isFinite(payload.doeValue))return status(feedback,'Enter a scope and a numeric DOE percentage; zero and negative values are accepted.',true);
          if(payload.doeValue<0&&!payload.notes)return status(feedback,'Enter the negotiated reason in Notes for a negative adjustment.',true);
          if(!id){row.dataset.requestId ||= window.crypto.randomUUID();payload.requestId=row.dataset.requestId;}
        }
        row.dataset.busy='true';const buttons=[...row.querySelectorAll('button')];buttons.forEach(item=>{item.disabled=true;});
        try {
          status(feedback,deactivate?'Deactivating manual adjustment…':'Saving manual DOE adjustment…');
          if(deactivate)await api.deactivateManualDoeAssignment(id,payload);
          else await api.saveManualDoeAssignment(id,payload);
          if(!current())return;
          if(!id){row.querySelectorAll('input').forEach(input=>{input.value='';});delete row.dataset.requestId;}
          const reloaded=await load();
          status(at('.p4-doe-new .doe-row-status'),reloaded?'Manual adjustment saved.': 'Saved, but the refreshed worksheet could not be loaded. Reopen Edit Faculty.',!reloaded);
          try {await onSaved(faculty.facultyId);}catch(_){if(current())status(at('.p4-doe-new .doe-row-status'),'Saved. Refresh the dashboard to reload its totals.',true);}
        }catch(error){if(current())status(feedback,error.status===409?'This assignment changed. Reopen Edit Faculty before retrying.':error.message||'Manual DOE save failed.',true);}
        finally{delete row.dataset.busy;if(current())buttons.forEach(item=>{item.disabled=!canManualWrite()||!worksheetReady;});}
      });
      Promise.all([load(),refreshSuggestions()]);
      return () => {disposed=true;};
    }
    return Object.freeze({mount});
  }
  window.UCVM_FACULTY_DOE_MANUAL=Object.freeze({create});
})();
