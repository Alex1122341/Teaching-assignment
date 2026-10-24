(() => {
  'use strict';

    const ROLE_TYPES = ['Course Coordinator','HICC','VISC','Course Coordinator / HICC','Rotation / Week Lead','CCC','Trainee / Supervision','Special Project','Other'];
  const ROLE_CATEGORY = Object.freeze({
    'Course Coordinator':'course_coordination', HICC:'hicc', VISC:'visc',
    'Course Coordinator / HICC':'hicc', 'Rotation / Week Lead':'rotation', CCC:'course_coordination',
    'Trainee / Supervision':'supervision', 'Special Project':'approved_activity', Other:'other'
  });
  const OVERRIDE_REASONS = ['RSL','Mat Leave','Sick Leave','Special Event','Other'];
  const $ = (selector,root) => root.querySelector(selector.startsWith('#') || selector.startsWith('.') ? selector : `#${selector}`);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const text = value => String(value ?? '').trim();
  const finite = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const pct = value => finite(value) === null ? 'Needs Review' : `${Number(value).toFixed(2)}%`;

  function create({ api, academicYear, onSaved = () => {}, canWrite = () => false, canManualWrite } = {}) {
    if (!api) throw new TypeError('The authenticated PAWS data client is required.');
    if (typeof canManualWrite === 'function') return window.UCVM_FACULTY_DOE_MANUAL.create({api,academicYear,onSaved,canManualWrite,canWrite});
    let previewSequence = 0;

    function factsFor(row) {
      const roleType = text($('.role-type',row)?.value || row.dataset.roleType);
      const scopeText = text($('.role-scope',row)?.value || '');
      let prior = {};
      try { prior = JSON.parse(row.dataset.facts || '{}'); } catch (_) { prior = {}; }
      const facts = { ...prior, roleType, activityType: roleType, category: ROLE_CATEGORY[roleType], scopeText };
      delete facts.facultyId;
      delete facts.resultDoe;
      delete facts.doeCredit;
      delete facts.calculationId;
      if (roleType === 'VISC') facts.subjectKey = scopeText;
      else facts.courseCode = scopeText;
      return facts;
    }

    function status(node,message,isError=false) {
      if (!node) return;
      node.textContent = message;
      node.classList.toggle('error',isError);
      node.setAttribute('role','status');
      node.setAttribute('aria-live','polite');
    }

    function roleRow(line, writable) {
      const facts = line.facts || {};
      const roleType = text(line.roleType || facts.roleType) || 'Other';
      const scope = text(line.scopeText || line.subjectKey || line.courseCode || facts.scopeText || facts.subjectKey || facts.courseCode);
      const notes = text(line.notes);
      return `<div class="p4-doe-assignment" data-assignment-id="${esc(line.assignmentFactId)}" data-revision="${Number(line.revision)||0}" data-role-type="${esc(roleType)}">
        <div class="p4-doe-assignment-fields">
          <label class="field"><span class="field-label">Role Type</span><select class="select role-type" data-doe-field="roleType" ${writable?'':'disabled'}>${ROLE_TYPES.map(value=>`<option value="${esc(value)}" ${value===roleType?'selected':''}>${esc(value)}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Course / Subject / Scope</span><input class="input role-scope" data-doe-field="scope" value="${esc(scope)}" maxlength="256" ${writable?'':'disabled'}></label>
          <label class="field"><span class="field-label">Calculated DOE</span><output class="field-value doe-preview-value">${esc(pct(line.resultDoe))}</output></label>
          <label class="field"><span class="field-label">Notes</span><input class="input role-notes" data-doe-field="notes" value="${esc(notes)}" maxlength="1000" ${writable?'':'disabled'}></label>
        </div>
        <div class="p4-doe-row-footer"><span class="aux-note">Server · active · ${esc(line.status || 'Needs Review')}${line.ruleKey ? ` · ${esc(line.ruleKey)}` : ''}</span><span class="toolbar-note doe-row-status" role="status" aria-live="polite"></span>
          ${writable?`<button type="button" class="btn btn-small" data-doe-save-row>Save assignment</button><button type="button" class="btn btn-small btn-danger" data-doe-deactivate>Deactivate</button>`:''}
        </div>
      </div>`;
    }

    function legacyRows(lines) {
      const rows = (lines || []).filter(line => String(line.sourceEntityType||'').startsWith('legacy_'));
      if (!rows.length) return '';
      return `<div class="p4-doe-legacy"><h4>Legacy · read-only</h4><p class="aux-note">Historical rows are retained as evidence and are not included in authoritative DOE totals until a deterministic mapping is reviewed.</p>${rows.map(line=>`<div class="p4-doe-legacy-row"><span>${esc(line.roleType || line.sourceEntityType || 'Legacy assignment')} · ${esc(line.scopeText || 'scope unavailable')}</span><strong>${esc(pct(line.legacyResultDoe))}</strong><span>${esc(line.errorCode || 'Needs Review')}</span></div>`).join('')}</div>`;
    }

    function mount(form, faculty) {
      form.querySelector('#p4-doe-edit-section')?.remove();
      const year = text(academicYear());
      const section = document.createElement('section');
      section.id = 'p4-doe-edit-section';
      section.className = 'p4-doe-edit-section';
      section.innerHTML = `<div class="section-title">DOE Role Assignment · ${esc(year || 'Academic Year unavailable')}</div>
        <p class="aux-note">Access role and DOE assignment are separate. Active server assignments can be edited or deactivated here. Saving sends assignment facts to the DOE API; it re-matches the Active annual rule, recalculates on the server, and records new calculation evidence. Legacy rows remain read-only migration evidence.</p>
        <div id="p4-doe-active" class="p4-doe-active"><div class="empty">Loading authoritative DOE Worksheet…</div></div>
        <div class="p4-doe-new"><h4>Add DOE assignment</h4><div class="p4-doe-assignment-fields">
          <label class="field"><span class="field-label">Role Type</span><select class="select role-type" id="p4-doe-new-role">${ROLE_TYPES.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Course / Subject / Scope</span><input class="input role-scope" id="p4-doe-new-scope" maxlength="256" placeholder="Course code or canonical VISC subject key"></label>
          <label class="field"><span class="field-label">Calculated DOE</span><output class="field-value" id="p4-doe-new-result">Preview required</output></label>
          <label class="field"><span class="field-label">Notes</span><input class="input" id="p4-doe-new-notes" maxlength="1000"></label>
        </div><div class="p4-doe-row-footer"><span class="toolbar-note" id="p4-doe-new-status" role="status" aria-live="polite"></span>
          <button type="button" class="btn" id="p4-doe-preview-new">Preview DOE</button><button type="button" class="btn btn-primary" id="p4-doe-save-new" ${canWrite()?'':'disabled'}>Save assignment</button>
        </div></div>
        <div class="section-title p4-doe-override-title">Office DOE override · ${esc(year || 'Academic Year unavailable')}</div>
        <p class="aux-note">An approved override adjusts the annual Teaching target. It never overwrites Contract Teaching DOE. Clearing the override restores the contract value.</p>
        <div class="p4-doe-assignment-fields p4-doe-override-fields">
          <div class="field"><span class="field-label">Contract Teaching DOE</span><output id="p4-doe-contract" class="field-value">—</output></div>
          <label class="field"><span class="field-label">Override DOE %</span><input class="input" id="p4-doe-override-value" type="number" min="0" step="0.01"></label>
          <label class="field"><span class="field-label">Reason</span><select class="select" id="p4-doe-override-reason"><option value="">Select reason</option>${OVERRIDE_REASONS.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Special notes</span><input class="input" id="p4-doe-override-notes" maxlength="2000"></label>
        </div><div class="p4-doe-row-footer"><span class="toolbar-note" id="p4-doe-override-status" role="status" aria-live="polite"></span><button type="button" class="btn btn-primary" id="p4-doe-save-override" ${canWrite()?'':'disabled'}>Save Office DOE override</button><button type="button" class="btn" id="p4-doe-clear-override" ${canWrite()?'':'disabled'}>Clear override</button></div>`;
      const actions = form.querySelector('.form-actions');
      if (actions) form.insertBefore(section,actions); else form.appendChild(section);

      const load = async () => {
        try {
          const worksheet = await api.doeWorksheet({facultyId:faculty.facultyId,academicYear:year});
          if (form.dataset.facultyId !== String(faculty.facultyId)) return;
          section.dataset.worksheetStatus = worksheet.status || 'needs_review';
      const active = (worksheet.lines || []).filter(line => line.sourceEntityType === 'doe_assignment' && line.active !== false);
          const writable = canWrite();
          const rows = active.map(line=>roleRow(line,writable)).join('') || '<div class="empty">No active DOE role assignments.</div>';
          const target = worksheet.target || {};
          $('p4-doe-active',section).innerHTML = rows + legacyRows(worksheet.lines);
          $('p4-doe-active',section).querySelectorAll('.p4-doe-assignment').forEach((row,index)=>{row.dataset.facts=JSON.stringify(active[index]?.facts||{});});
          $('p4-doe-contract',section).textContent = pct(target.contractTeachingDoe);
          $('p4-doe-override-value',section).value = target.overrideDoe ?? '';
          $('p4-doe-override-reason',section).value = text(target.overrideReason);
          $('p4-doe-override-notes',section).value = text(target.overrideNotes);
        } catch (error) {
          $('p4-doe-active',section).innerHTML = `<div class="warn-box" role="alert">Worksheet could not be loaded: ${esc(error.message || 'DOE service unavailable.')}</div>`;
          status($('p4-doe-override-status',section),error.message || 'DOE target could not be loaded.',true);
        }
      };

      const preview = async row => {
        const result = row.querySelector('.doe-preview-value') || $('p4-doe-new-result',section);
        const feedback = row.querySelector('.doe-row-status') || $('p4-doe-new-status',section);
        const requestToken = String(++previewSequence);
        status(feedback,'Previewing with the active annual DOE rule…');
        delete row.dataset.previewFacts;
        delete row.dataset.previewResult;
        row.dataset.previewRequestToken = requestToken;
        try {
          const facts = factsFor(row);
          const resultValue = await api.doePreview({academicYear:year,facts:{...facts,facultyId:faculty.facultyId}});
          if (row.dataset.previewRequestToken !== requestToken || JSON.stringify(factsFor(row)) !== JSON.stringify(facts)) return null;
          result.textContent = pct(resultValue.resultDoe);
          row.dataset.previewFacts = JSON.stringify(facts);
          row.dataset.previewResult = String(resultValue.resultDoe);
          status(feedback,`${resultValue.ruleKey || 'Active policy'} · server preview`);
          return resultValue;
        } catch (error) {
          if (row.dataset.previewRequestToken !== requestToken) return null;
          result.textContent = error.code === 'COURSE_MAPPING_REQUIRED' || error.code === 'SUBJECT_MAPPING_REQUIRED' ? 'Needs Mapping' : 'Needs Review';
          delete row.dataset.previewFacts;
          delete row.dataset.previewResult;
          status(feedback,error.message || 'No authoritative DOE preview is available.',true);
          return null;
        }
      };

      const saveRow = async row => {
        const feedback = row.querySelector('.doe-row-status');
        if (!canWrite()) return status(feedback,'DOE assignment writes are disabled.',true);
        const facts = factsFor(row), id = text(row.dataset.assignmentId), revision = Number(row.dataset.revision);
        try {
          status(feedback,'Saving facts and recording a new server calculation…');
          await api.updateDoeAssignment(id,{academicYear:year,facultyId:faculty.facultyId,expectedRevision:revision,facts,notes:text($('.role-notes',row)?.value)});
          await load(); await onSaved(faculty.facultyId);
        } catch (error) { status(feedback,error.message || 'DOE assignment could not be saved.',true); }
      };

      section.addEventListener('change',event=>{
        const row=event.target.closest('.p4-doe-assignment');
        if(row&&event.target.matches('[data-doe-field="roleType"],[data-doe-field="scope"]')) preview(row);
        if(event.target.matches('#p4-doe-new-role')) preview(section.querySelector('.p4-doe-new'));
      });
      section.addEventListener('input',event=>{
        const row=event.target.closest('.p4-doe-assignment');
        if(row&&event.target.matches('[data-doe-field="scope"]')) preview(row);
        if(event.target.matches('#p4-doe-new-scope')) preview(section.querySelector('.p4-doe-new'));
      });
      section.addEventListener('click',async event=>{
        const row=event.target.closest('.p4-doe-assignment');
        if(event.target.closest('[data-doe-save-row]')&&row) return saveRow(row);
        if(event.target.closest('[data-doe-deactivate]')&&row){
          if(!window.confirm('Deactivate this DOE assignment? Its calculation evidence will remain available for audit.'))return;
          const feedback=row.querySelector('.doe-row-status');
          try{status(feedback,'Deactivating assignment…');await api.deactivateDoeAssignment(row.dataset.assignmentId,{academicYear:year,facultyId:faculty.facultyId,expectedRevision:Number(row.dataset.revision),reason:'Deactivated from Edit Faculty'});await load();await onSaved(faculty.facultyId)}catch(error){status(feedback,error.message||'DOE assignment could not be deactivated.',true)}
        }
        if(event.target.closest('#p4-doe-preview-new')) await preview(section.querySelector('.p4-doe-new'));
        if(event.target.closest('#p4-doe-save-new')){
          const row=section.querySelector('.p4-doe-new'),feedback=$('p4-doe-new-status',section);
          if(!canWrite())return status(feedback,'DOE assignment writes are disabled.',true);
          try{let facts=factsFor(row),previewFacts='';try{previewFacts=JSON.stringify(JSON.parse(row.dataset.previewFacts||'null'))}catch(_){}if(previewFacts!==JSON.stringify(facts)){const result=await preview(row);if(!result)return;facts=factsFor(row)}if(row.dataset.previewFacts!==JSON.stringify(facts))return;status(feedback,'Saving facts and recording a new server calculation…');await api.saveDoeAssignment({academicYear:year,facultyId:faculty.facultyId,facts,notes:text($('p4-doe-new-notes',section).value)});$('p4-doe-new-scope',section).value='';$('p4-doe-new-notes',section).value='';delete row.dataset.previewFacts;delete row.dataset.previewResult;$('p4-doe-new-result',section).textContent='Preview required';await load();await onSaved(faculty.facultyId)}catch(error){status(feedback,error.message||'DOE assignment could not be saved.',true)}
        }
        if(event.target.closest('#p4-doe-save-override')){
          const feedback=$('p4-doe-override-status',section),value=$('p4-doe-override-value',section).value.trim(),reason=text($('p4-doe-override-reason',section).value),notes=text($('p4-doe-override-notes',section).value);
          if(!canWrite())return status(feedback,'DOE target writes are disabled.',true);
          try{status(feedback,'Saving annual Faculty target…');await api.saveDoeTargetOverride(faculty.facultyId,{academicYear:year,override:value===''?null:{value:Number(value),reason,notes}});await load();await onSaved(faculty.facultyId);status(feedback,'Office DOE override saved.')}
          catch(error){status(feedback,error.message||'Office DOE override could not be saved.',true)}
        }
        if(event.target.closest('#p4-doe-clear-override')){
          const feedback=$('p4-doe-override-status',section);
          if(!canWrite())return status(feedback,'DOE target writes are disabled.',true);
          try{status(feedback,'Clearing override and restoring Contract Teaching DOE…');await api.saveDoeTargetOverride(faculty.facultyId,{academicYear:year,override:null});await load();await onSaved(faculty.facultyId);status(feedback,'Override cleared; Contract Teaching DOE is restored.')}
          catch(error){status(feedback,error.message||'Office DOE override could not be cleared.',true)}
        }
      });
      load();
    }

    return Object.freeze({ mount });
  }

  window.UCVM_FACULTY_DOE_EDIT = Object.freeze({ create });
})();
