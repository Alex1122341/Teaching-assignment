(() => {
  'use strict';

  const FIREBASE_CONFIG = { apiKey: 'AIzaSyDS9VE2zTXv0656_Mh0uDXB67-mZ5Y_Lk', authDomain: 'tester-teaching.firebaseapp.com', projectId: 'tester-teaching', storageBucket: 'tester-teaching.firebasestorage.app', messagingSenderId: '566638053186', appId: '1:566638053186:web:90e04b52251c4b859baadb' };
  const $ = id => document.getElementById(id);
  const displayFaculty = value => window.PAWS_FACULTY_NAME.format(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const adminRoles = new Set(['owner','administrator','adfa_general','adfa_regular','admin']);
  const queueRoles = new Set(['hicc','visc',...adminRoles]);
  let profile = null, packages = [], selectedId = '', selectedPackage = null, capabilities = {}, facultyOptions = [], facultyEvidence = new Map();
  let auth = null, activeView = 'queue', busy = false, focusedAssignmentEditor = null;

  function academicYearNow() {
    const now = new Date(); const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    return `${start}-${String((start + 1) % 100).padStart(2,'0')}`;
  }
  function role() { return String(profile?.role || profile?.baseRole || '').trim().toLowerCase(); }
  function isAdmin() { return adminRoles.has(role()); }
  function setStatus(text, error = false) {
    const node = $('toast'); node.textContent = text; node.classList.toggle('error', error); node.classList.add('show');
    window.clearTimeout(setStatus.timer); setStatus.timer = window.setTimeout(() => node.classList.remove('show'), 4200);
  }
  function showGate(text) { $('gate-copy').textContent = text; document.body.classList.add('auth-locked'); $('auth-gate').classList.remove('hidden'); $('app').classList.add('hidden'); }
  function unlock() { document.body.classList.remove('auth-locked'); $('auth-gate').classList.add('hidden'); $('app').classList.remove('hidden'); }
  function dateText(value) { if (!value) return 'Not set'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? esc(value) : date.toLocaleString(); }
  function statusLabel(value) {
    return ({ draft:'HICC draft', changes_requested:'Changes requested', visc_review:'Waiting for VISC', visc_approved:'Ready for HICC final submit', submitted_to_adfad:'ADFAD review', adfad_finalized:'Finalized' })[value] || value || 'Unknown';
  }
  function nextAction(row) { return row.warning || row.nextAction || statusLabel(row.status); }
  function setBusy(value) { busy = value; document.querySelectorAll('[data-workflow-action], #publish-button, #reload-button').forEach(button => { if (button) button.disabled = value || button.dataset.gateDisabled === 'true'; }); }
  function currentWorking() {
    const revisions = Array.isArray(selectedPackage?.revisions) ? selectedPackage.revisions : [];
    return revisions.find(revision => Number(revision.revisionNumber) === Number(selectedPackage.workingRevision)) || revisions[0] || { revisionNumber:0, sessions:[] };
  }
  function assignmentsAsText(assignments = []) {
    return (Array.isArray(assignments) ? assignments : []).map(item => `${item.facultyId || ''} | ${item.teachingRole || ''}`).join('\n');
  }
  function parseAssignments(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const [facultyId, ...roleParts] = line.split('|');
      return { facultyId:facultyId.trim(), teachingRole:roleParts.join('|').trim() };
    });
  }
  function assignmentTextControl(session, purpose) {
    const contents = assignmentsAsText(session.assignments);
    return `<label class="assignment-editor">Canonical Faculty ID | teaching role<textarea data-assignment-for="${esc(session.sessionId)}" data-purpose="${purpose}" rows="2" placeholder="${isAdmin() ? 'Choose a canonical faculty below or enter UUID | Role' : 'Exact Faculty UUID | Role'}">${esc(contents)}</textarea><span>One assignment per line. Suggestions shown below remain suggestions until a final assignment is saved.</span></label>${purpose === 'final' ? `<div class="decision-evidence" data-evidence-for="${esc(session.sessionId)}"><span class="muted">Faculty capacity and DOE evidence loads after you enter a canonical Faculty ID.</span></div>` : ''}`;
  }
  function renderSessionRows(sessions, { editable = false, purpose = 'draft' } = {}) {
    if (!sessions.length) return '<p class="empty compact">No sessions are attached to this package.</p>';
    return sessions.map(session => `<article class="session-card"><div class="session-heading"><div><strong>${esc(session.courseCode || 'Course')}</strong><span>${esc(session.courseName || '')}</span></div><span class="session-date">${esc(session.sessionDate || 'Date not set')}</span></div><p class="session-topic">${esc(session.topic || 'Untitled session')} · ${esc(session.sessionType || 'Type not set')} · ${esc(session.startTime || '')}${session.endTime ? `–${esc(session.endTime)}` : ''}${session.room ? ` · ${esc(session.room)}` : ''}</p>${editable ? assignmentTextControl(session,purpose) : `<div class="assignment-lines"><strong>${purpose === 'final' ? 'Final assignment' : purpose === 'published' ? 'Published assignment' : 'Working proposal'}</strong>${(session.assignments || []).length ? (session.assignments || []).map(a => `<span>${esc(displayFaculty(a.facultyName || a.facultyId))}${a.facultyName && a.facultyId ? ` <small>${esc(a.facultyId)}</small>` : ''} · ${esc(a.teachingRole)}</span>`).join('') : '<span class="muted">No instructor assigned</span>'}</div>`}</article>`).join('');
  }
  function parseEditors(purpose) {
    return [...document.querySelectorAll(`textarea[data-purpose="${purpose}"]`)].map(input => ({
      sessionId:input.dataset.assignmentFor,
      assignments:parseAssignments(input.value)
    }));
  }
  function validateAssignments(sessions) {
    for (const session of sessions) {
      if (!uuid.test(session.sessionId)) return 'A session identifier is invalid. Refresh and try again.';
      const seen = new Set();
      for (const assignment of session.assignments) {
        if (!uuid.test(assignment.facultyId) || !assignment.teachingRole || assignment.teachingRole.length > 256) return 'Each assignment requires an exact canonical Faculty UUID and a teaching role.';
        if (seen.has(assignment.facultyId)) return 'A Faculty member may only appear once on a session.';
        seen.add(assignment.facultyId);
      }
    }
    return '';
  }
  function actionButton(action, label, { disabled = false, style = '' } = {}) {
    return `<button class="button ${style}" data-workflow-action="${action}" ${disabled ? 'disabled data-gate-disabled="true"' : ''}>${label}</button>`;
  }
  function renderDetail() {
    if (!selectedPackage) { $('detail-panel').innerHTML = '<div class="empty detail-empty"><span class="empty-icon">↗</span><h2>Select a package</h2><p>The detail view separates the working proposal, VISC review, ADFAD final assignment, and published release.</p></div>'; return; }
    const pkg = selectedPackage, working = currentWorking(), status = String(pkg.status || ''), isHicc = role() === 'hicc';
    const canEdit = isHicc && ['draft','changes_requested'].includes(status) && capabilities.taDraft === true;
    const canReview = role() === 'visc' && status === 'visc_review' && capabilities.taReview === true;
    const canFinalSubmit = isHicc && status === 'visc_approved' && capabilities.taDraft === true;
    const canFinalize = isAdmin() && status === 'submitted_to_adfad' && capabilities.taFinal === true;
    const reviewList = (pkg.reviews || []).map(review => `<li><strong>${esc(review.decision === 'push_back' ? 'Changes requested' : review.decision)}</strong><span>${esc(displayFaculty(review.actorName || 'Reviewer'))} · ${dateText(review.createdAtUtc)} · revision ${esc(review.revisionNumber)}</span>${review.comment ? `<p>${esc(review.comment)}</p>` : ''}</li>`).join('') || '<li class="muted">No review decisions yet.</li>';
    const contributionList = (pkg.contributions || []).map(item => `<li><strong>Suggestion · ${esc(displayFaculty(item.suggestedDisplayName))}</strong><span>${esc(item.suggestedByOffice)} · ${dateText(item.createdAtUtc)} · revision ${esc(item.revisionNumber)}</span>${item.note ? `<p>${esc(item.note)}</p>` : ''}</li>`).join('') || '<li class="muted">No suggestions recorded.</li>';
    const finalRows = (pkg.finalization || []).filter(row => row.sessionId).map(row => ({ sessionId:row.sessionId, courseCode:'Final assignment', topic:'', sessionDate:'', assignments:[{facultyId:row.facultyId,facultyName:row.facultyName,teachingRole:row.teachingRole}] }));
    const sourceSessions = (working.sessions || []).map(session => ({...session}));
    const finalEditable = sourceSessions.map(session => ({...session, assignments:(finalRows.find(row => row.sessionId === session.sessionId)?.assignments || session.assignments || [])}));
    $('detail-panel').innerHTML = `<div class="detail-header"><div><p class="eyebrow">${esc(pkg.academicYear)} · ${esc(pkg.groupName || pkg.groupId)}</p><h2>${esc(pkg.hiccLabel || 'HICC package')}</h2><p>${esc(pkg.packageIdentity || pkg.responsibleHiccResponsibilityId || '')}</p></div><span class="status-pill status-${esc(status)}">${esc(statusLabel(status))}</span></div>
      <div class="detail-meta"><div><span>Next action</span><strong>${esc(statusLabel(status))}</strong></div><div><span>Revision</span><strong>${esc(pkg.workingRevision || 0)}${pkg.approvedRevision ? ` · VISC approved ${esc(pkg.approvedRevision)}` : ''}</strong></div><div><span>Due</span><strong>${dateText(pkg.dueAtUtc)}</strong></div><div><span>Last activity</span><strong>${dateText(pkg.updatedAtUtc)}</strong></div></div>
      ${canEdit ? '<div class="notice">Edit the working proposal below. Changes create a new numbered revision; previous VISC approval never carries forward.</div>' : ''}
      <section class="detail-section"><div class="section-heading"><div><h3>Working proposal</h3><p>Revision ${esc(working.revisionNumber)} · changes here are not published.</p></div></div>${renderSessionRows(working.sessions || [],{editable:canEdit,purpose:'draft'})}${canEdit ? `<label class="note-field">Revision note<input id="revision-note" maxlength="1000" placeholder="What changed in this revision?"></label><div class="action-row">${actionButton('save-draft','Save working revision')}${pkg.workingRevision ? actionButton('submit','Submit to VISC') : ''}</div>` : ''}</section>
      <section class="detail-section"><div class="section-heading"><div><h3>VISC review history</h3><p>Decisions stay attached to the revision reviewed.</p></div></div><ul class="history-list">${reviewList}</ul>${canReview ? `<label class="note-field">Review comment<textarea id="review-comment" rows="3" maxlength="2000" placeholder="Required when requesting changes"></textarea></label><div class="action-row">${actionButton('push-back','Request changes')}${actionButton('approve','Approve revision')}</div>` : ''}${canFinalSubmit ? `<div class="notice success">Revision ${esc(pkg.approvedRevision)} is approved. HICC must explicitly final-submit it to ADFAD.</div><div class="action-row">${actionButton('final-submit','Final submit to ADFAD')}</div>` : ''}</section>
      <section class="detail-section"><div class="section-heading"><div><h3>Contribution suggestions</h3><p>Suggestions are informational and never become assignments automatically.</p></div></div><ul class="history-list">${contributionList}</ul>${isHicc && capabilities.taDraft && working.sessions?.length ? `<form class="inline-contribution" data-hicc-contribution="${esc(pkg.packageId)}" data-revision="${esc(pkg.workingRevision)}"><label>Session<select name="sessionId" required>${working.sessions.map(session=>`<option value="${esc(session.sessionId)}">${esc(session.courseCode)} · ${esc(session.topic || session.courseName || 'Session')}</option>`).join('')}</select></label><div class="contribution-form-row"><label>Opaque candidate key<input name="candidateKey" maxlength="128" required></label><label>Suggested display name<input name="suggestedDisplayName" maxlength="260" required></label></div><label>Note<textarea name="note" rows="2" maxlength="1000"></textarea></label><button class="button" type="submit">Add suggestion</button></form>` : ''}</section>
      <section class="detail-section"><div class="section-heading"><div><h3>ADFAD final assignment</h3><p>Authoritative assignment is separate from the HICC proposal and VISC decision.</p></div></div>${canFinalize ? `<p class="notice">Use exact canonical Faculty IDs. This action creates a new immutable finalization version.</p>${renderSessionRows(finalEditable,{editable:true,purpose:'final'})}<label class="note-field">Final note<textarea id="final-note" rows="3" maxlength="2000" placeholder="Decision context (optional)"></textarea></label><div class="action-row">${actionButton('save-final','Save final assignment')}</div>` : finalRows.length ? `<p class="version-label">Finalization version ${esc((pkg.finalization || [])[0]?.versionNumber || '')} · ${esc(displayFaculty((pkg.finalization || [])[0]?.actorName || ''))}</p>${renderSessionRows(finalRows,{purpose:'final'})}` : '<p class="muted">No ADFAD final assignment has been saved.</p>'}</section>
      <section class="detail-section"><div class="section-heading"><div><h3>Published state</h3><p>A later working or final change does not alter an existing release.</p></div></div><p class="muted">${status === 'adfad_finalized' ? (capabilities.taPublish ? 'This package is finalized and can be included when the academic year is published.' : 'Finalized; publication is currently disabled.') : 'This package has not reached final assignment.'}</p></section>
      <section class="detail-section"><div class="section-heading"><div><h3>Activity history</h3><p>Server audit events for this package.</p></div></div><div id="package-activity" class="activity-list"><span class="muted">Loading audit history…</span></div></section>
      ${isAdmin() && facultyOptions.length ? `<details class="faculty-reference"><summary>Canonical Faculty picker reference</summary><p>Use the exact active Faculty ID and display name returned by the authorized dashboard list.</p><ul>${facultyOptions.slice(0,200).map(f=>`<li><button type="button" class="link-button" data-copy-faculty="${esc(f.facultyId)}">${esc(displayFaculty(f.displayName || f.name || f.facultyId))} · ${esc(f.facultyId)}</button></li>`).join('')}</ul></details>` : ''}`;
    if (canReview) document.querySelectorAll('[data-workflow-action="approve"],[data-workflow-action="push-back"]').forEach(button => { button.dataset.revision = String(pkg.submittedRevision); });
    if (canFinalize) document.querySelectorAll('textarea[data-purpose="final"]').forEach(input => input.dataset.purpose = 'final');
    loadPackageHistory(pkg.packageId);
  }
  async function loadPackageHistory(packageId) {
    try {
      const history = await UCVM_PAWS_DATA.teachingAssignmentHistory(packageId), node = $('package-activity');
      if (!node) return;
      const activities = Array.isArray(history.activities) ? history.activities : [];
      node.innerHTML = activities.length ? activities.slice(0,40).map(item => `<div class="activity-row"><strong>${esc(item.eventType)}</strong><span>${esc(displayFaculty(item.actorName || 'PAWS user'))} · ${dateText(item.occurredAtUtc)}</span>${item.metadataJson ? `<details><summary>Details</summary><pre>${esc(item.metadataJson)}</pre></details>` : ''}</div>`).join('') : '<span class="muted">No recorded activity.</span>';
    } catch (error) { const node = $('package-activity'); if (node) node.textContent = apiError(error); }
  }
  async function loadQueue() {
    $('queue-list').innerHTML = '<p class="empty">Loading work queue…</p>';
    const year = $('academic-year').value.trim();
    try {
      packages = await UCVM_PAWS_DATA.teachingAssignmentWorkQueue({academicYear:year});
      $('queue-caption').textContent = `${packages.length} package${packages.length === 1 ? '' : 's'} in your server-authorized scope`;
      renderQueue();
      if (selectedId) await openPackage(selectedId);
    } catch (error) { packages = []; $('queue-list').innerHTML = `<p class="empty error-copy">${esc(apiError(error))}</p>`; }
  }
  function renderQueue() {
    const filter = $('queue-filter').value;
    const rows = packages.filter(row => filter === 'all' || (filter === 'hicc' && ['draft','changes_requested','visc_approved'].includes(row.status)) || (filter === 'visc' && row.status === 'visc_review') || (filter === 'final' && row.status === 'visc_approved') || (filter === 'adfad' && ['submitted_to_adfad','adfad_finalized'].includes(row.status)) || (filter === 'published' && row.status === 'adfad_finalized'));
    if (!rows.length) { $('queue-list').innerHTML = '<div class="empty compact"><strong>No packages match this view.</strong><p>Queue membership and scope are verified by the University API.</p></div>'; return; }
    $('queue-list').innerHTML = rows.map(row => `<button class="queue-card ${selectedId === row.packageId ? 'selected' : ''}" data-open-package="${esc(row.packageId)}"><span class="queue-card-top"><span class="status-pill status-${esc(row.status)}">${esc(statusLabel(row.status))}</span><span>${esc(row.academicYear)}</span></span><strong>${esc(row.groupName || row.groupId)}</strong><span>${esc(row.hiccLabel || row.responsibleHiccResponsibilityId || 'HICC scope unavailable')}</span><span>Revision ${esc(row.workingRevision || 0)} · Due ${esc(row.dueAtUtc ? new Date(row.dueAtUtc).toLocaleDateString() : 'not set')}</span><span class="next-action">${esc(nextAction(row))}</span><small>Updated ${dateText(row.lastActivityAtUtc)}</small></button>`).join('');
  }
  async function openPackage(packageId) {
    selectedId = packageId; $('detail-panel').innerHTML = '<p class="empty">Loading authorized package…</p>'; renderQueue();
    try { selectedPackage = await UCVM_PAWS_DATA.teachingAssignmentPackage(packageId); renderDetail(); }
    catch (error) { selectedPackage = null; $('detail-panel').innerHTML = `<p class="empty error-copy">${esc(apiError(error))}</p>`; }
  }
  async function loadPublished() {
    const node = $('published-content'); node.innerHTML = '<p class="empty">Loading published release…</p>';
    try {
      const release = await UCVM_PAWS_DATA.teachingAssignmentPublished({academicYear:$('academic-year').value.trim()});
      if (!release?.releaseId) { node.innerHTML = '<p class="empty">No publication exists for this academic year yet.</p>'; return; }
      node.innerHTML = `<div class="release-summary"><span class="release-mark">v${esc(release.versionNumber)}</span><div><strong>Release ${esc(release.releaseId)}</strong><p>Published ${dateText(release.publishedAtUtc)} by ${esc(release.publishedBy || 'PAWS administrator')}</p>${release.publicationNote ? `<p>${esc(release.publicationNote)}</p>` : ''}</div></div><div class="published-sessions">${renderSessionRows(release.sessions || [],{purpose:'published'})}</div>`;
    } catch (error) { node.innerHTML = `<p class="empty error-copy">${esc(apiError(error))}</p>`; }
  }
  async function loadReleaseHistory() {
    try {
      const releases = await UCVM_PAWS_DATA.teachingAssignmentPublicationHistory({academicYear:$('academic-year').value.trim()});
      $('release-history').innerHTML = releases.length ? `<div class="release-table">${releases.map(item => `<article class="release-row"><strong>Release ${esc(item.versionNumber)} ${item.isCurrent ? '<span class="status-pill status-current">Current</span>' : ''}</strong><span>${dateText(item.publishedAtUtc)} · ${esc(item.publishedBy || 'PAWS administrator')}</span><span>${esc(item.publishedSessionCount)} published sessions</span>${item.publicationNote ? `<p>${esc(item.publicationNote)}</p>` : ''}</article>`).join('')}</div>` : '<p class="empty">No releases have been published for this academic year.</p>';
    } catch (error) { $('release-history').innerHTML = `<p class="empty error-copy">${esc(apiError(error))}</p>`; }
  }
  function apiError(error) { return error?.message || 'The University API could not complete this request. Refresh and try again.'; }
  async function selectView(view) {
    if (view === 'queue' && !queueRoles.has(role())) view = 'published';
    if (view === 'contributions' && !['adc','lab'].includes(role())) view = 'published';
    if (['publish','releases'].includes(view) && !isAdmin()) view = 'published';
    activeView = view;
    document.querySelectorAll('.view-tab').forEach(button => button.classList.toggle('active',button.dataset.view === view));
    $('queue-view').classList.toggle('hidden',view !== 'queue');
    for (const name of ['contributions','published','releases','publish']) $(name+'-view').classList.toggle('hidden',view !== name);
    if (view === 'queue') await loadQueue();
    if (view === 'contributions') await loadContributionTargets();
    if (view === 'published') await loadPublished();
    if (view === 'releases') await loadReleaseHistory();
  }
  async function loadContributionTargets() {
    const node = $('contribution-targets'); node.innerHTML = '<p class="empty">Loading eligible open packages…</p>';
    try {
      const targets = await UCVM_PAWS_DATA.teachingAssignmentContributionTargets({academicYear:$('academic-year').value.trim()}), groups = new Map();
      for (const item of targets) { const rows=groups.get(item.packageId)||[]; rows.push(item); groups.set(item.packageId,rows); }
      node.innerHTML = groups.size ? [...groups.values()].map(rows => {
        const first=rows[0];
        return `<article class="contribution-package"><div><p class="eyebrow">${esc(first.academicYear)} · ${esc(first.groupName)}</p><h3>${esc(first.hiccLabel)} <span class="status-pill status-${esc(first.status)}">${esc(statusLabel(first.status))}</span></h3></div><form data-contribution-package="${esc(first.packageId)}" data-revision="${esc(first.revisionNumber)}"><label>Session<select name="sessionId" required>${rows.map(row=>`<option value="${esc(row.sessionId)}">${esc(row.courseCode)} · ${esc(row.topic || row.courseName || 'Session')} · ${esc(row.sessionDate || 'Date not set')}</option>`).join('')}</select></label><div class="contribution-form-row"><label>Opaque candidate key<input name="candidateKey" maxlength="128" required placeholder="Approved internal candidate key"></label><label>Suggested display name<input name="suggestedDisplayName" maxlength="260" required placeholder="Name for HICC review"></label></div><label>Note<textarea name="note" rows="2" maxlength="1000" placeholder="Optional context"></textarea></label><div class="action-row"><button class="button button-primary" type="submit">Save suggestion</button></div></form></article>`;
      }).join('') : '<p class="empty">There are no open draft packages for contribution in this academic year.</p>';
    } catch (error) { node.innerHTML = `<p class="empty error-copy">${esc(apiError(error))}</p>`; }
  }
  async function loadCapabilities() {
    try { capabilities = await UCVM_PAWS_DATA.teachingAssignmentWriteCapabilities(); }
    catch (_) { capabilities = {}; }
    $('capability-strip').textContent = `Draft / submit ${capabilities.taDraft ? 'available to current HICC scope' : 'closed'} · VISC review ${capabilities.taReview ? 'available to current group leads' : 'closed'} · ADFAD final ${capabilities.taFinal ? 'available to administrators' : 'closed'} · Publish ${capabilities.taPublish ? 'available to administrators' : 'closed'}`;
    $('publish-button').disabled = !isAdmin() || capabilities.taPublish !== true;
    $('publish-button').dataset.gateDisabled = String(!isAdmin() || capabilities.taPublish !== true);
  }
  async function loadFacultyReference() {
    if (!isAdmin()) return;
    try { facultyOptions = await UCVM_PAWS_DATA.dashboardFaculty({limit:200}); }
    catch (_) { facultyOptions = []; }
  }
  function formatEvidenceValue(value, suffix = '') { return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? 'Unavailable' : `${Number(value).toFixed(2)}${suffix}`; }
  async function loadDecisionEvidence() {
    const editors=[...document.querySelectorAll('textarea[data-purpose="final"]')];
    for(const input of editors){
      const sessionId=input.dataset.assignmentFor, node=document.querySelector(`[data-evidence-for="${CSS.escape(sessionId)}"]`), ids=[...new Set(parseAssignments(input.value).map(row=>row.facultyId).filter(id=>uuid.test(id)))];
      if(!node)continue;if(!ids.length){node.innerHTML='<span class="muted">Enter an exact canonical Faculty ID to view available decision evidence.</span>';continue;}
      node.innerHTML='<span class="muted">Loading stored Faculty and DOE evidence…</span>';
      try{
        const records=await Promise.all(ids.map(async id=>{const key=`${$('academic-year').value.trim()}::${id}`;if(!facultyEvidence.has(key))facultyEvidence.set(key,UCVM_PAWS_DATA.dashboardFacultyById(id,{academicYear:$('academic-year').value.trim()}));return [id,await facultyEvidence.get(key)];}));
        if(!node.isConnected||input.dataset.assignmentFor!==sessionId)continue;
        node.innerHTML=records.map(([id,data])=>{
          const faculty=data?.faculty||{}, target=data?.contractDoe?.teachingDoe, assignments=Array.isArray(data?.teachingAssignments)?data.teachingAssignments:[], roles=Array.isArray(data?.roles)?data.roles:[];
          const teaching=assignments.filter(item=>item.doeCredit!==null&&item.doeCredit!==undefined&&Number.isFinite(Number(item.doeCredit))).reduce((sum,item)=>sum+Number(item.doeCredit),0);
          const roleDoe=roles.filter(item=>item.effectiveDoe!==null&&item.effectiveDoe!==undefined&&Number.isFinite(Number(item.effectiveDoe))).reduce((sum,item)=>sum+Number(item.effectiveDoe),0);
          const teachingMissing=assignments.filter(item=>item.doeCredit===null||item.doeCredit===undefined).length,roleMissing=roles.filter(item=>item.effectiveDoe===null||item.effectiveDoe===undefined).length;
          const complete=teachingMissing===0&&roleMissing===0&&assignments.length+roles.length>0;
          return `<article class="evidence-card"><strong>${esc(displayFaculty(faculty.displayName||id))}</strong><span>${esc(id)} · FTE ${formatEvidenceValue(faculty.fte)}</span><div>Contract teaching target: ${formatEvidenceValue(target)} DOE</div><div>Known assigned teaching DOE: ${teaching.toFixed(2)} · ${teachingMissing} unresolved line(s)</div><div>Known role/service DOE: ${roleDoe.toFixed(2)} · ${roleMissing} unresolved line(s)</div><div>Total known DOE: ${(teaching+roleDoe).toFixed(2)} · ${complete?'Recorded lines complete':'Needs review'}</div><small>Decision support only. No DOE is inferred or written by this workflow.</small></article>`;
        }).join('');
      }catch(error){node.textContent=`Faculty decision evidence is unavailable: ${apiError(error)}`;}
    }
  }
  async function performAction(action, button) {
    if (!selectedPackage || busy) return;
    setBusy(true);
    const pkg = selectedPackage, expected = Number(pkg.workingRevision || 0);
    try {
      if (action === 'save-draft' || action === 'submit') {
        const sessions = parseEditors('draft'), invalid = validateAssignments(sessions); if (invalid) throw new Error(invalid);
        if (action === 'save-draft') await UCVM_PAWS_DATA.saveTeachingAssignmentDraft(pkg.packageId,{expectedWorkingRevision:expected,sessions,revisionNote:$('revision-note')?.value || null});
        else await UCVM_PAWS_DATA.submitTeachingAssignment(pkg.packageId,expected);
      } else if (action === 'approve' || action === 'push-back') {
        const comment = $('review-comment')?.value || '';
        if (action === 'push-back' && !comment.trim()) throw new Error('Add a reason before requesting changes.');
        await UCVM_PAWS_DATA.reviewTeachingAssignment(pkg.packageId,{revisionNumber:Number(button.dataset.revision),decision:action === 'approve' ? 'approved' : 'push_back',comment:comment || null});
      } else if (action === 'final-submit') {
        await UCVM_PAWS_DATA.finalSubmitTeachingAssignment(pkg.packageId,expected);
      } else if (action === 'save-final') {
        const assignments = parseEditors('final').flatMap(item => item.assignments.map(assignment => ({sessionId:item.sessionId,...assignment})));
        const invalid = validateAssignments(parseEditors('final')); if (invalid) throw new Error(invalid);
        await UCVM_PAWS_DATA.saveTeachingAssignmentFinalization(pkg.packageId,{expectedWorkingRevision:expected,assignments,finalNote:$('final-note')?.value || null});
      } else return;
      setStatus('Workflow action recorded. Reloading the server-confirmed state.');
      await loadCapabilities(); await loadQueue();
    } catch (error) { setStatus(apiError(error),true); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (busy || !isAdmin() || !capabilities.taPublish) return;
    if (!window.confirm(`Publish the complete finalized release for ${$('academic-year').value}? Faculty will see this new immutable release.`)) return;
    setBusy(true); $('publish-status').textContent = 'Publishing…';
    try { await UCVM_PAWS_DATA.publishTeachingAssignmentRelease({academicYear:$('academic-year').value.trim(),publicationNote:$('publication-note').value || null}); $('publish-status').textContent = 'Release published.'; setStatus('Publication complete.'); await loadReleaseHistory(); await loadPublished(); }
    catch (error) { $('publish-status').textContent = apiError(error); setStatus(apiError(error),true); }
    finally { setBusy(false); }
  }
  function bind() {
    document.querySelectorAll('.view-tab').forEach(button => button.addEventListener('click',() => selectView(button.dataset.view)));
    $('reload-button').addEventListener('click',() => selectView(activeView)); $('queue-filter').addEventListener('change',renderQueue); $('publish-button').addEventListener('click',publish);
    $('queue-list').addEventListener('click',event => { const button = event.target.closest('[data-open-package]'); if (button) openPackage(button.dataset.openPackage); });
    $('contribution-targets').addEventListener('submit',async event=>{
      const form=event.target.closest('[data-contribution-package]');if(!form)return;event.preventDefault();if(busy)return;
      const data=new FormData(form),packageId=form.dataset.contributionPackage;
      const payload={revisionNumber:Number(form.dataset.revision),sessionId:String(data.get('sessionId')||''),candidateKey:String(data.get('candidateKey')||'').trim(),suggestedDisplayName:String(data.get('suggestedDisplayName')||'').trim(),note:String(data.get('note')||'').trim()||null};
      if(!uuid.test(payload.sessionId)||!payload.candidateKey||!payload.suggestedDisplayName){setStatus('Choose a session and enter a candidate key and display name.',true);return;}
      setBusy(true);try{await UCVM_PAWS_DATA.addTeachingAssignmentContribution(packageId,payload);form.reset();setStatus('Suggestion recorded for HICC review.');}catch(error){setStatus(apiError(error),true);}finally{setBusy(false);}
    });
    $('detail-panel').addEventListener('click',event => {
      const action = event.target.closest('[data-workflow-action]'); if (action) { performAction(action.dataset.workflowAction,action); return; }
      const copy = event.target.closest('[data-copy-faculty]'); if (copy) { const target = focusedAssignmentEditor?.isConnected ? focusedAssignmentEditor : null; const id=copy.dataset.copyFaculty; if (target) { target.value += `${target.value.trim() ? '\n' : ''}${id} | Lecturer`; target.focus(); } else setStatus(`Canonical Faculty ID: ${id}`); }
    });
    $('detail-panel').addEventListener('focusin',event=>{if(event.target.matches('textarea[data-assignment-for]'))focusedAssignmentEditor=event.target;});
    $('detail-panel').addEventListener('focusout',event=>{if(event.target.matches('textarea[data-purpose="final"]'))loadDecisionEvidence();});
    $('detail-panel').addEventListener('submit',async event=>{
      const form=event.target.closest('[data-hicc-contribution]');if(!form)return;event.preventDefault();if(busy)return;
      const data=new FormData(form),payload={revisionNumber:Number(form.dataset.revision),sessionId:String(data.get('sessionId')||''),candidateKey:String(data.get('candidateKey')||'').trim(),suggestedDisplayName:String(data.get('suggestedDisplayName')||'').trim(),note:String(data.get('note')||'').trim()||null};
      if(!uuid.test(payload.sessionId)||!payload.candidateKey||!payload.suggestedDisplayName){setStatus('Choose a session and enter a candidate key and display name.',true);return;}
      setBusy(true);try{await UCVM_PAWS_DATA.addTeachingAssignmentContribution(form.dataset.hiccContribution,payload);setStatus('Suggestion recorded.');await openPackage(form.dataset.hiccContribution);}catch(error){setStatus(apiError(error),true);}finally{setBusy(false);}
    });
    $('academic-year').addEventListener('keydown',event => { if (event.key === 'Enter') selectView(activeView); });
  }
  async function start(user) {
    if (!user) { showGate('Sign in from the PAWS timetable to continue.'); return; }
    try {
      profile = await UCVM_PAWS_DATA.currentUser();
      if (!profile || profile.active !== true) { showGate('An active PAWS account is required.'); return; }
      if (profile.mustChangePassword === true) { location.replace('password.html'); return; }
      if (!queueRoles.has(role()) && role() !== 'faculty') { showGate('This account can’t access Teaching Assignments.'); return; }
      $('identity-chip').textContent = `${displayFaculty(profile.displayName || profile.name || user.displayName || user.email || 'PAWS user')} · ${role()}`;
      document.querySelectorAll('.admin-only').forEach(button => button.classList.toggle('hidden',!isAdmin()));
      document.querySelectorAll('.contributor-only').forEach(button => button.classList.toggle('hidden',!['adc','lab'].includes(role())));
      if (!queueRoles.has(role())) document.querySelector('[data-view="queue"]').classList.add('hidden');
      if (!['adc','lab'].includes(role())) $('contribution-tab').classList.add('hidden');
      unlock(); $('academic-year').value = academicYearNow(); bind(); await Promise.all([loadCapabilities(),loadFacultyReference()]);
      await selectView(queueRoles.has(role()) ? 'queue' : ['adc','lab'].includes(role()) ? 'contributions' : 'published');
    } catch (error) { console.error(error); showGate(apiError(error)); }
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth(); window.UCVMSessionGuard?.start(auth); auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    auth.onAuthStateChanged(start);
  } catch (error) { console.error(error); showGate('Firebase authentication could not be initialized.'); }
})();
