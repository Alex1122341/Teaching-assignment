(() => {
  'use strict';
  const facultyName = (record, fallback = '') => window.PAWS_FACULTY_NAME.format(record, fallback);
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const bind = (node,event,handler) => { if(!node)return; if(typeof node.addEventListener==='function')node.addEventListener(event,handler); else node[`on${event}`]=handler; };
  function create({ canWrite, getFaculty, getSelectedDetail, getFacultyDetail, onChanged, onEditOpen, notify }) {
    let editSequence = 0;
    let saving = false;
    function actions(f) {
      if (!canWrite() || !f?.facultyId || !f.updatedAtUtc) return '';
      return `<div class="faculty-admin-actions"><button type="button" class="btn btn-primary" data-faculty-edit="1">Edit Faculty</button>${f.active === false ? '<button type="button" class="btn" data-faculty-restore="1">Restore Faculty</button>' : '<button type="button" class="btn" data-faculty-deactivate="1">Deactivate Faculty</button>'}</div>`;
    }
    function editAction(facultyId) { return canWrite() && facultyId ? `<button type="button" class="btn btn-small" data-faculty-edit-id="${esc(facultyId)}">Edit Faculty</button>` : ''; }
    function relationshipWarning(linked = {}) {
      const count = key => Number(linked[key]) || 0;
      return `<div class="faculty-link-warning" role="note"><strong>Linked records remain attached:</strong> ${count('activeUserProfileCount')} active login(s), ${count('currentTeachingSessionCount')} future teaching session(s), ${count('currentRoleCount')} current role(s), and ${count('currentTeachingResponsibilityCount')} current teaching responsibility assignment(s). Deactivation will not delete these records or disable linked accounts.</div>`;
    }
    function control(name, label, value, options = {}) {
      const attrs = `${options.max ? ` maxlength="${options.max}"` : ''}${options.step ? ` step="${options.step}"` : ''}`;
      return `<label class="field ${options.full || options.max >= 4000 ? 'full' : ''}"><span class="field-label">${esc(label)}</span>${options.max >= 4000 ? `<textarea class="textarea" rows="3" name="${esc(name)}"${attrs}>${esc(value ?? '')}</textarea>` : `<input class="input" name="${esc(name)}" type="${options.type || 'text'}" value="${esc(value ?? '')}"${attrs}>`}</label>`;
    }
    function open(f, profile = {}, detail = {}) {
      if (saving || !canWrite() || !f?.facultyId || !f.updatedAtUtc) return;
      ++editSequence;
      const p = profile || {}, roster = getFaculty();
      const lab = f.dataBackend === 'firestore';
      const fields = new Map([
        ['preferredFirstName','Preferred first name',f.preferredFirstName,128],['preferredLastName','Preferred last name',f.preferredLastName,128],
        ['displayName','Stored display name',f.storedDisplayName ?? f.displayName,260],['ucid','UCID',f.ucid,64],['email','Email',f.email,256],
        ['recordType','Record type',f.recordType,32],['stream','Stream',f.stream,128],['rank','Rank',f.rank,128]
      ].map(([key,label,value,max]) => [key, control(key,label,value,{max})]));
      fields.set('fte',control('fte','FTE',f.fte,{type:'number',step:'0.0001'}));
      fields.set('reportsToFacultyId',`<label class="field"><span class="field-label">Reports to</span><select class="select" name="reportsToFacultyId"><option value="">No supervisor</option>${roster.filter(r => r.facultyId !== f.facultyId).map(r => `<option value="${esc(r.facultyId)}" ${r.facultyId === f.reportsToFacultyId ? 'selected' : ''}>${esc(facultyName(r, r.facultyId))}${r.active === false ? ' · inactive' : ''}</option>`).join('')}${f.reportsToFacultyId && !roster.some(r => r.facultyId === f.reportsToFacultyId) ? `<option selected value="${esc(f.reportsToFacultyId)}">${esc(f.reportsToFacultyId)} · current linked record</option>` : ''}</select></label>`);
      const profileFields = [
        ['teachingArea','Teaching area',512],['professionalCategory','Professional category',256],['serviceDate','Service date'],
        ['priorYearsExperience','Prior years experience',null,'number','0.01'],['dvmEarnedDate','DVM earned date',64],['dvmType','DVM type',256],
        ['mastersEarnedDate','Masters earned date',64],['mastersArea','Masters area',4000],['phdEarnedDate','PhD earned date',64],['phdArea','PhD area',4000],
        ['boardCertifiedDate','Board certified date',64],['boardCertification','Board certification',4000],
        ['boardCertificationCount','Board certification count',null,'number','0.01'],['abvmaLicenseNumber','ABVMA license number',128],['abvmaMemberType','ABVMA member type',512]
      ];
      profileFields.forEach(([key,label,max,type,step]) => fields.set(key,control(key,label,p[key],{max,type,step})));
      const group = (title, content) => `<section class="form-section"><h3 class="form-section-title">${title}</h3><div class="field-grid">${content.join('')}</div></section>`;
      const identityKeys = ['preferredFirstName','preferredLastName','displayName','ucid','email','reportsToFacultyId'];
      const appointmentKeys = ['recordType','stream','rank','fte','serviceDate','priorYearsExperience'];
      const specialtyKeys = profileFields.map(([key]) => key).filter(key => !appointmentKeys.includes(key));
      const controls = keys => keys.map(key => fields.get(key));
      const idInfo = `<div class="field full"><span class="field-label">Faculty ID (immutable)</span><div class="field-value">${esc(f.facultyId)}</div></div>`;
      $('faculty-record-fields').innerHTML = lab
        ? group('Identity & contact', [idInfo, ...controls(['preferredFirstName', 'preferredLastName'])]) + group('Appointment', controls(['rank', 'fte']))
        : group('Identity & contact', [idInfo, ...controls(identityKeys)]) + group('Appointment', controls(appointmentKeys)) + group('Specialty & education', controls(specialtyKeys));
      $('faculty-record-title').textContent = `Edit Faculty · ${facultyName(f, f.facultyId)}`;
      const form = $('faculty-record-form'); form.dataset.facultyId = f.facultyId; form.dataset.expectedUpdatedAtUtc = f.updatedAtUtc;
      form.dataset.backend = lab ? 'firestore' : 'sql';
      form.dataset.expectedProfileVersion = p.profileVersion || '';
      $('faculty-record-status').textContent = ''; $('faculty-record-save').disabled = false;
      if (!$('faculty-record-editor').open) $('faculty-record-editor').showModal();
      if (typeof onEditOpen === 'function') onEditOpen(form, f, p, detail);
    }
    async function editById(facultyId) {
      if (!canWrite() || !facultyId || typeof getFacultyDetail !== 'function') return;
      const sequence = ++editSequence;
      try {
        const detail = await getFacultyDetail(facultyId);
        if (sequence !== editSequence) return;
        if (!detail?.faculty) throw new Error('Faculty detail could not be loaded from the PAWS University API.');
        open(detail.faculty, detail.professionalProfile || {}, detail);
      } catch (error) { if (sequence === editSequence) notify(error?.message || 'Faculty detail could not be loaded.', true); }
    }
    function payload(form) {
      const value = name => form.elements.namedItem(name)?.value ?? '';
      const str = name => String(value(name)).trim() || null;
      const num = name => String(value(name)).trim() === '' ? null : Number(value(name));
      if (form.dataset.backend === 'firestore') return {
        expectedUpdatedAtUtc: form.dataset.expectedUpdatedAtUtc,
        preferredFirstName: str('preferredFirstName'), preferredLastName: str('preferredLastName'),
        rank: String(value('rank')).trim(), fte: num('fte')
      };
      return {
        expectedUpdatedAtUtc: form.dataset.expectedUpdatedAtUtc,
        expectedProfileVersion: form.dataset.expectedProfileVersion || null,
        preferredFirstName: str('preferredFirstName'), preferredLastName: str('preferredLastName'), displayName: String(value('displayName')).trim(),
        ucid: str('ucid'), email: str('email'), recordType: String(value('recordType')).trim(), stream: str('stream'), rank: str('rank'),
        fte: num('fte'), reportsToFacultyId: str('reportsToFacultyId'), professionalProfile: {
          teachingArea: str('teachingArea'), professionalCategory: str('professionalCategory'), serviceDate: str('serviceDate'),
          priorYearsExperience: num('priorYearsExperience'), dvmEarnedDate: str('dvmEarnedDate'), dvmType: str('dvmType'),
          mastersEarnedDate: str('mastersEarnedDate'), mastersArea: str('mastersArea'), phdEarnedDate: str('phdEarnedDate'), phdArea: str('phdArea'),
          boardCertifiedDate: str('boardCertifiedDate'), boardCertification: str('boardCertification'), boardCertificationCount: num('boardCertificationCount'),
          abvmaLicenseNumber: str('abvmaLicenseNumber'), abvmaMemberType: str('abvmaMemberType')
        }
      };
    }
    async function submit(event) {
      event.preventDefault(); const form = event.currentTarget, button = $('faculty-record-save'), status = $('faculty-record-status');
      if (saving) return;
      const id = form.dataset.facultyId;
      saving = true;
      $('faculty-record-cancel').disabled = true; $('faculty-record-close').disabled = true;
      try {
        button.disabled = true; status.textContent = 'Saving canonical Faculty record…';
        await UCVM_PAWS_DATA.updateDashboardFaculty(id,payload(form));
        $('faculty-record-editor').close(); notify('Faculty record saved.'); await onChanged(id);
      } catch (error) { status.textContent = error?.message || 'Faculty record could not be saved.'; button.disabled = false; }
      finally { saving = false; $('faculty-record-cancel').disabled = false; $('faculty-record-close').disabled = false; }
    }
    async function deactivate(f, linked) {
      const links = [`${Number(linked.activeUserProfileCount)||0} active login(s)`,`${Number(linked.currentTeachingSessionCount)||0} future teaching session(s)`,`${Number(linked.currentRoleCount)||0} current role(s)`,`${Number(linked.currentTeachingResponsibilityCount)||0} current responsibility assignment(s)`].join(', ');
      if (!window.confirm(`Deactivate ${facultyName(f, f.facultyId)}?\n\nThis only marks the Faculty record inactive. It does not delete linked records, disable user accounts, or remove teaching, role, appointment, DOE, or AFC history.\n\nCurrently linked: ${links}.\n\nContinue?`)) return;
      try { await UCVM_PAWS_DATA.deactivateDashboardFaculty(f.facultyId,{expectedUpdatedAtUtc:f.updatedAtUtc,confirm:true}); notify('Faculty record deactivated; linked records were preserved.'); await onChanged(f.facultyId,'inactive'); }
      catch (error) { notify(error?.message || 'Faculty record could not be deactivated.',true); }
    }
    async function restore(f) {
      if (!window.confirm(`Restore ${facultyName(f, f.facultyId)} as the same Faculty record? Its Faculty ID and existing relationships will be preserved.`)) return;
      try { await UCVM_PAWS_DATA.restoreDashboardFaculty(f.facultyId,{expectedUpdatedAtUtc:f.updatedAtUtc}); notify('Existing Faculty record restored.'); await onChanged(f.facultyId,'active'); }
      catch (error) { notify(error?.message || 'Faculty record could not be restored.',true); }
    }
    return Object.freeze({
      actions, editAction, relationshipWarning,
      bind() {
        const close = () => { if (!saving) { ++editSequence; $('faculty-record-editor')?.close(); } };
        bind($('faculty-record-cancel'),'click',close);
        bind($('faculty-record-close'),'click',close);
        bind($('faculty-record-editor'),'cancel',event => { if (saving) event.preventDefault(); else ++editSequence; });
        bind($('faculty-record-form'),'submit',submit);
        bind(document,'click',event => {
          const action = event.target?.closest?.('[data-faculty-edit-id]');
          if (!action || !canWrite()) return;
          event.preventDefault(); event.stopPropagation(); editById(action.dataset.facultyEditId);
        });
        bind($('profile-pane'),'click',event => {
          const action = event.target?.closest?.('[data-faculty-edit],[data-faculty-deactivate],[data-faculty-restore]');
          if (!action) return;
          const detail = getSelectedDetail();
          const f = detail?.faculty;
          if (!f || !canWrite()) return;
          if (action.hasAttribute('data-faculty-edit')) open(f,detail.professionalProfile || {}, detail);
          else if (action.hasAttribute('data-faculty-deactivate')) deactivate(f,detail.linkedRecords || {});
          else restore(f);
        });
      }
    });
  }
  window.UCVM_FACULTY_ADMIN_MANAGEMENT = Object.freeze({ create });
})();
