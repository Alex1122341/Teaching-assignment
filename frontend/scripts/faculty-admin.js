(() => {
  'use strict';

  const FIREBASE_CONFIG = { apiKey: 'AIzaSyDS9VE2zTXv0656_Mh0uDXB67-mZ5Y_LkY', authDomain: 'tester-teaching.firebaseapp.com', projectId: 'tester-teaching', storageBucket: 'tester-teaching.firebasestorage.app', messagingSenderId: '566638053186', appId: '1:566638053186:web:90e04b52251c4b859baadb', measurementId: 'G-F7HW5XX4JE' };
  const facultyName = (record, fallback = '') => window.PAWS_FACULTY_NAME.format(record, fallback);
  const VIEW = window.PAWS_DASHBOARD_VIEW_MODEL || {};
  const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const normalizeCurriculumYear = VIEW.normalizeCurriculumYear || (value => text(value) || 'Unassigned year');
  const groupTeachingAssignments = VIEW.groupTeachingAssignments || (() => []);
  const effectiveRoleDoe = VIEW.effectiveRoleDoe || (() => ({ mapped: null, override: null, effective: null, status: 'needs-review' }));
  const formatDoe = VIEW.formatDoe || (() => 'DOE unavailable');
  const $ = id => document.getElementById(id);
  const officeWorkspace = window.PAWS_OFFICE_WORKSPACE?.mount({document,window,page:'faculty'});
  const on = (element, event, handler) => {
    if (!element) return;
    if (typeof element.addEventListener === 'function') element.addEventListener(event, handler);
    else element[`on${event}`] = handler;
  };
  const present = value => !(value === undefined || value === null || value === '');
  const text = value => present(value) ? String(value).trim() : '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  const norm = value => text(value).toLowerCase();
  function pawsTimingEnabled() { return window.__pawsDashboardTiming === true; }
  function pawsTimingLog(label, started) { if (pawsTimingEnabled() && typeof performance?.now === 'function') console.log(`[PAWS dashboard timing] ${label}=${Math.round(performance.now() - started)}ms`); }

  const workImport=window.PAWS_ACTIVITY_IMPORT?.createAdminEntry({api:UCVM_PAWS_DATA,host:$('calendar-activity-import'),notify:showToast,getUser:()=>currentUser,canAdmin:()=>!selfMode && dashboardAdmin(currentUser),onCommitted:async()=>{
    otherWorkTab?.clear();invalidateFacultyDetails();await loadAdminDashboard();await loadAfcRecords(true);if(selectedId)await selectFacultyDetail(selectedId);
  }});
  const otherWorkTab=window.PAWS_CALENDAR_ACTIVITIES?.createOtherWorkTab({host:$('other-work-view'),api:UCVM_PAWS_DATA,getUser:()=>currentUser,getAcademicYear:otherWorkAcademicYear});
  let auth = null;
  let historyView = null;
  const traineesEntry=window.UCVM_ASSETS?.createTraineeEntry({host:$('trainees-view'),api:UCVM_PAWS_DATA,getUser:()=>currentUser,getAcademicYear:currentAcademicYear,isAdministrator:dashboardAdmin});
  const reportsEntry=window.UCVM_ASSETS?.createReportEntry({host:$('reports-view'),api:UCVM_PAWS_DATA,getUser:()=>currentUser,getAcademicYear:currentAcademicYear,isAdministrator:dashboardAdmin});
  function closeHistory(){historyView?.destroy();historyView=null;if($('faculty-history-dialog')?.open)$('faculty-history-dialog').close();}
  function openHistory(){
    if(!currentUser||!window.PAWS_CHANGE_HISTORY)return;
    closeHistory();
    historyView=window.PAWS_CHANGE_HISTORY.mount($('faculty-history-content'),{api:UCVM_PAWS_DATA,scope:'dashboard',academicYear:currentAcademicYear()});
    $('faculty-history-dialog').showModal();
  }
  let currentUser = null, authGeneration = 0;
  let faculty = [];
  let activeFaculty = [];
  const afcForms=window.PAWS_AFC_FORMS?.createRecordAttachment({api:UCVM_PAWS_DATA,host:$('afc-form-documents'),getUser:()=>currentUser,getFacultyId:()=>String($('afc-faculty')?.value||'')});
  const getAfcOriginal=window.PAWS_AFC_FORMS?.createDocumentDownloader({api:UCVM_PAWS_DATA,getUser:()=>currentUser,notify:showToast});
  let facultyArchive=null;
  const cccReplace=window.PAWS_CCC_REPLACEMENT?.createController({api:UCVM_PAWS_DATA,host:$('ccc-replacement'),getUser:()=>currentUser});
  let selectedId = null;
  let selectedDetail = null;
  let selfMode = false;
  let facultyStatus = 'active';
  let facultyAdminWriteEnabled = false;
  let doeWorksheetView = null;
  let doePolicyView = null;
  let dashboardSummary = null;
  let activeTab = 'lookup';
  let afcRecords = [];
  let afcLoaded = false;
  let lookupMetrics = null;
  let lookupMetricsGeneration = 0;
  let afcSubmitInFlight = false;
  const afcActions = window.UCVM_AFC_RECORDS.createActions({
    api: UCVM_PAWS_DATA, facultyName,
    canCancel: () => !selfMode && dashboardAdmin(currentUser) && UCVM_PAWS_DATA.afcCancelWriteEnabled?.() === true,
    canEdit: () => !selfMode && dashboardAdmin(currentUser) && UCVM_PAWS_DATA.afcEditWriteEnabled?.() === true,
    getRecords: () => afcRecords, render: () => renderAfcRecords(),
    refresh: async () => { invalidateFacultyDetails(); await loadAdminDashboard(); await loadAfcRecords(true); },
    refreshRecords: () => loadAfcRecords(true), notify: showToast, confirm: message => window.confirm(message)
  });
  let afcBatchRows = [{ facultyId: '', facultyEntry: '', startDate: '', endDate: '', purpose: '', dateErrors: {}, errors: [], status: 'EDIT' }];
  let afcBatchRequestId = '';
  let afcBatchReviewed = false;
  let detailLoadToken = 0;
  let detailGeneration = 0;
  const detailCache = new Map();
  const detailPending = new Map();
  function invalidateFacultyDetails() {
    ++detailGeneration; ++detailLoadToken;
    detailCache.clear(); detailPending.clear(); selectedDetail = null;
  }
  const aggregateCache = { teachingSummary: null, roles: null, doeOverview: null };

  function rosterRecord(row) {
    const r = row && typeof row === 'object' ? row : {};
    const first = text(r.preferredFirstName), last = text(r.preferredLastName), id = text(r.facultyId);
    return { __id: id, facultyId: id, preferredFirstName: first, preferredLastName: last,
      preferredFullName: facultyName(r, id), displayName: facultyName(r, id),
      ucid: text(r.ucid), email: text(r.email), recordType: text(r.recordType), stream: text(r.stream), rank: text(r.rank), fte: present(r.fte) ? r.fte : undefined,
      reportsToFacultyId: text(r.reportsToFacultyId), reportsToName: facultyName(r.reportsToName), active: r.active !== false, teachingArea: text(r.teachingArea), professionalCategory: text(r.professionalCategory),
      updatedAtUtc: text(r.updatedAtUtc),
      sessionCount: number(r.sessionCount), roleCount: number(r.roleCount), afcCount: number(r.afcCount), jointAppointmentCount: number(r.jointAppointmentCount) };
  }

  async function loadAdminDashboard() {
    const g=authGeneration;
    const started = typeof performance?.now === 'function' ? performance.now() : 0;
    setDashboardLoading(true);
    try {
      const [summary, rows, activeRows, canWrite, doeGates] = await Promise.all([
        UCVM_PAWS_DATA.dashboardSummary(),
        UCVM_PAWS_DATA.dashboardFaculty({ status: facultyStatus }),
        facultyStatus === 'active' ? Promise.resolve(null) : UCVM_PAWS_DATA.dashboardFaculty({ status: 'active' }),
        UCVM_PAWS_DATA.refreshFacultyAdminWriteCapabilities?.() ?? false,
        UCVM_PAWS_DATA.refreshDoeWriteCapabilities?.() ?? {},
        UCVM_PAWS_DATA.refreshAfcRecordWriteCapabilities?.() ?? {}
      ]);
      if(g!==authGeneration)return;
      dashboardSummary = summary && typeof summary === 'object' && !Array.isArray(summary) ? summary : {};
      facultyAdminWriteEnabled = canWrite === true;
      window.__pawsDoeWriteCapabilities = doeGates || {};
      faculty = (Array.isArray(rows) ? rows : []).map(rosterRecord);
      activeFaculty = facultyStatus === 'active' ? faculty : (Array.isArray(activeRows) ? activeRows : []).map(rosterRecord);
      updateAfcWriteControls();
      if ($('faculty-status-filter')) $('faculty-status-filter').value = facultyStatus;
      afcLoaded = false;
      lookupMetrics = null;
      updateFilters(); populateAfcFacultyOptions(); updateKpis(); updateStatus(); renderActiveTab();
      void loadLookupMetrics();
      pawsTimingLog('summary+faculty', started);
    } catch (error) { if(g!==authGeneration)return; console.error(error); markDashboardUnavailable(dashboardAuthFailureMessage(error)); }
  }

  function dashboardRawRole(value) { return String((value && typeof value === 'object' ? value.role : value) || '').toLowerCase(); }
  function dashboardRole(value) { return ({ owner: 'adfa_general', administrator: 'adfa_regular', other_office: 'other_office', adfa_general: 'adfa_general', adfa_regular: 'adfa_regular', admin: 'adfa_regular', editor: 'faculty', viewer: 'faculty' }[dashboardRawRole(value)] || dashboardRawRole(value)); }
  function dashboardAdmin(profile) { return ['developer', 'adfa_general', 'adfa_regular'].includes(dashboardRole(profile && profile.role)); }
  function dashboardGeneral(profile) { return ['developer', 'adfa_general'].includes(dashboardRole(profile && profile.role)); }
  function dashboardRoleLabel(value) { return ({ developer: 'Developer', owner: 'ADFAD Owner', adfa_general: 'ADFAD Owner', administrator: 'ADFAD Admin', adfa_regular: 'ADFAD Admin', admin: 'ADFAD Admin', other_office: 'Other Office', hicc: 'HICC', visc: 'VISC', faculty: 'Faculty', editor: 'Faculty', viewer: 'Faculty' }[dashboardRawRole(value)] || dashboardRawRole(value)); }
  function isSelfServiceProfile(p){return ['faculty','hicc','visc'].includes(String(p?.role||'').toLowerCase())}

  async function loadSelfFaculty(facultyId) {
    const g=authGeneration;
    if (!facultyId) throw new Error('Your account is not linked to a faculty profile. Please contact ADFA.');
    const rows = await UCVM_PAWS_DATA.dashboardFaculty();
    if(g!==authGeneration)return;
    const own = (Array.isArray(rows) ? rows : []).map(r => rosterRecord(r)).find(r => String(r.facultyId).toLowerCase()===String(facultyId).toLowerCase());
    if (!own) throw new Error('Your linked faculty profile could not be found. Please contact ADFA.');
    faculty = [own]; selectedId = own.__id;
    const cached = detailCache.get(String(facultyId));
    if (cached) { selectedDetail = cached; renderApiDetail(cached); return; }
    const detail = await UCVM_PAWS_DATA.dashboardFacultyById(facultyId);
    if(g!==authGeneration)return;
    detailCache.set(String(facultyId), detail); selectedDetail = detail; renderApiDetail(detail);
  }

  async function enterSelfMode(user, profile) {
    reportsEntry?.clear();$('reports-tab')?.classList.add('hidden');
    afcForms?.clear();
    cccReplace?.clear();
    selfMode = true; document.body.classList.add('faculty-self-mode'); installSelfModeStyles();
    currentUser = { uid: user.uid, email: user.email || '', name: facultyName(profile, user.displayName || user.email || 'Faculty'), role: profile.role };
    $('admin-chip').textContent = `${currentUser.name} · ${dashboardRoleLabel(profile.role)}`; $('user-management-link')?.classList.add('hidden'); $('afc-records-tab')?.classList.add('hidden');
    const heading = document.querySelector('.headline h1'), copy = document.querySelector('.headline p');
    if (heading) heading.textContent = 'My Faculty Profile';
    if (copy) copy.textContent = 'Your teaching, roles, appointments, availability, and stored DOE evidence.';
    unlock(profile); await loadSelfFaculty(profile.facultyId);
  }

  function enterAdminMode(user, profile) {
    $('reports-tab')?.classList.toggle('hidden',!dashboardAdmin(profile));
    selfMode = false; document.body.classList.remove('faculty-self-mode');
    currentUser = { uid: user.uid, email: user.email || '', name: facultyName(profile, user.displayName || user.email || 'Administrator'), role: profile.role };
    $('faculty-status-filter')?.classList.remove('hidden');
    $('admin-chip').textContent = `${currentUser.name} · ${dashboardRoleLabel(profile.role)}`; $('user-management-link')?.classList.toggle('hidden', !dashboardGeneral(profile)); $('afc-records-tab')?.classList.toggle('hidden', !dashboardAdmin(profile)); $('doe-rules-tab')?.classList.toggle('hidden', !dashboardAdmin(profile));
    unlock(profile); loadAdminDashboard();
  }

  function init() {
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth(); if (window.UCVMSessionGuard) window.UCVMSessionGuard.start(auth);
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {}); bindUI();
      if(cameFromTimetable())lock('Opening Dashboard…');
      auth.onAuthStateChanged(async user => {
        const generation=++authGeneration;
        currentUser=null; resetAuthData();
        if (!user) { currentUser = null; otherWorkTab?.clear();workImport?.clear();lock('You are not signed in. Return to the timetable and sign in.'); return; }
        try {
          lock('Checking Dashboard access…'); const meStarted = typeof performance?.now === 'function' ? performance.now() : 0; const profile = await UCVM_PAWS_DATA.currentUser(); pawsTimingLog('me', meStarted);
          if(generation!==authGeneration || auth.currentUser?.uid!==user.uid)return;
          if (!profile || profile.active !== true) { lock('This Dashboard requires an active UCVM account.'); return; }
          if (profile.mustChangePassword === true) { location.replace('password.html'); return; }
          if (isSelfServiceProfile(profile) && !profile.facultyId) { lock('Your account requires a linked faculty profile. Please contact ADFA.'); return; }
          if (isSelfServiceProfile(profile)) { window.UCVMSessionGuard?.clearNotice?.(); await enterSelfMode(user, profile); return; }
          if (dashboardAdmin(profile)) { window.UCVMSessionGuard?.clearNotice?.(); enterAdminMode(user, profile); return; }
          lock('This account does not have Faculty Dashboard access.');
        } catch (error) { if(generation!==authGeneration)return; console.error(error); if (error?.code === 'PASSWORD_CHANGE_REQUIRED') location.replace('password.html'); else lock(dashboardAuthFailureMessage(error)); }
      });
    } catch (error) { console.error(error); lock('Firebase could not initialize.'); }
  }

  function resetAuthData() {
    reportsEntry?.clear();$('reports-tab')?.classList.add('hidden');
    otherWorkTab?.clear();
    faculty=[]; activeFaculty=[]; afcRecords=[]; afcLoaded=false; selectedId=null; dashboardSummary=null; facultyAdminWriteEnabled=false;
    lookupMetrics=null; ++lookupMetricsGeneration; invalidateFacultyDetails();
    for(const key of Object.keys(aggregateCache))aggregateCache[key]=null;
    for(const id of ['result-list','profile-pane','summary-body','roles-body','doe-overview-body','afc-records-body'])if($(id))$(id).textContent='';
  }

  function bindUI() {
    on($('faculty-history-btn'),'click',openHistory);
    on($('faculty-history-close'),'click',closeHistory);
    on($('faculty-history-dialog'),'close',()=>{historyView?.destroy();historyView=null;});
    on($('lookup-search'), 'input', debounce(renderLookup)); on($('filter-rank'), 'change', renderLookup);
    on($('faculty-status-filter'), 'change', async () => { facultyStatus = $('faculty-status-filter').value || 'active'; invalidateFacultyDetails(); selectedId = null; await loadAdminDashboard(); });
    on($('doe-list-refresh'),'click',()=>loadDoeList(true));
    facultyManagement.bind();
    on($('lookup-reset'), 'click', () => { $('lookup-search').value = ''; $('filter-rank').value = ''; renderLookup(); });
    on($('lookup-clear'), 'click', () => { selectedId = null; selectedDetail = null; ++detailLoadToken; renderLookup(); });
    document.querySelectorAll('.tab').forEach(tab => on(tab, 'click', () => selectTab(tab.dataset.tab)));
    on($('summary-search'), 'input', renderTeachingSummary); on($('roles-search'), 'input', renderRoles);
    on($('role-type-filter'), 'change', renderRoles); on($('role-status-filter'), 'change', renderRoles); on($('role-as-of'), 'change', renderRoles); if ($('role-as-of')) $('role-as-of').value = window.PAWS_ROLE_PERIODS.today();
    on($('afc-search'), 'input', debounce(renderAfcRecords));
    on($('afc-reason-filter'), 'change', renderAfcRecords); on($('afc-active-filter'), 'change', renderAfcRecords); on($('afc-source-filter'), 'change', renderAfcRecords);
    on($('afc-record-form'), 'submit', submitAfcRecord);
    on($('afc-faculty'),'change',()=>afcForms?.facultyChanged());
    on($('profile-pane'),'click',event=>{const button=event.target?.closest?.('[data-afc-document]');if(button)getAfcOriginal?.(button.dataset.afcDocument);});
    on($('afc-form-documents'),'click',event=>{const button=event.target?.closest?.('[data-afc-document]');if(button)getAfcOriginal?.(button.dataset.afcDocument);});
    on($('afc-records-body'), 'click', event => {
      const pdf=event.target?.closest?.('[data-afc-document]');if(pdf)return getAfcOriginal?.(pdf.dataset.afcDocument);
      const button = event.target?.closest?.('[data-afc-cancel]');
      if (button) return cancelAfcRecord(button.dataset.afcCancel);
      afcActions.handleEditClick(event);
    });
    on($('afc-single-mode'), 'click', () => setAfcMode(false));
    on($('afc-batch-mode'), 'click', () => { setAfcMode(true); renderAfcBatchRows(); });
    on($('afc-batch-add-row'), 'click', () => { if (afcBatchRows.length >= 20) return setAfcBatchStatus('A batch can contain at most 20 rows.', true); afcBatchRows.push({ facultyId: '', facultyEntry: '', startDate: '', endDate: '', purpose: '', dateErrors: {}, errors: [], status: 'EDIT' }); invalidateAfcBatch(); renderAfcBatchRows(); });
    on($('afc-batch-rows'), 'input', updateAfcBatchField);
    on($('afc-batch-rows'), 'change', updateAfcBatchField);
    on($('afc-batch-rows'), 'click', event => { const button = event.target?.closest?.('[data-afc-batch-remove]'); if (!button) return; afcBatchRows.splice(Number(button.dataset.afcBatchRemove), 1); invalidateAfcBatch(); renderAfcBatchRows(); });
    on($('afc-batch-import-paste'), 'click', loadAfcBatchPaste);
    on($('afc-batch-clear'), 'click', () => { afcBatchRows = [{ facultyId: '', facultyEntry: '', startDate: '', endDate: '', purpose: '', dateErrors: {}, errors: [], status: 'EDIT' }]; $('afc-batch-paste').value = ''; invalidateAfcBatch(); renderAfcBatchRows(); setAfcBatchStatus('Batch cleared.'); });
    on($('afc-batch-validate'), 'click', () => { reviewAfcBatch(); renderAfcBatchRows(); });
    on($('afc-batch-submit'), 'click', submitAfcBatch);
    updateAfcWriteControls();
  }

  function updateAfcWriteControls() { window.UCVM_AFC_RECORDS.updateWriteControls(UCVM_PAWS_DATA, $, afcSubmitInFlight, afcSingleActions.isUnconfirmed()); }

  function selectTab(tabName) {
    if(tabName==='reports'&&!dashboardAdmin(currentUser))return;
    if(activeTab!==tabName)reportsEntry?.clear();
    if (selfMode&&!['lookup','trainees','availability','other-work'].includes(tabName)) return;
    if(activeTab!==tabName)otherWorkTab?.clear();
    if(activeTab!==tabName)traineesEntry?.clear();
    activeTab = tabName || 'lookup';
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === activeTab));
    ['lookup','availability','summary','roles','doe-overview','doe-list','doe-rules','afc-records','trainees','other-work','reports'].forEach(name => $(name + '-view')?.classList.toggle('hidden', name !== activeTab));
    renderActiveTab();
  }

  function renderActiveTab() {
  if(activeTab==='reports')return reportsEntry?.open();
  if(activeTab==='other-work')return otherWorkTab?.open();
  if(activeTab==='availability')return;
  if(activeTab==='trainees')return traineesEntry?.open();
  if (activeTab === 'summary') return loadTeachingSummary();
  if (activeTab === 'roles') return loadRoles();
    if (activeTab === 'doe-overview') return loadDoeOverview();
    if (activeTab === 'doe-list') return loadDoeList();
    if (activeTab === 'doe-rules') return doePolicyView?.loadHistory();
    if (activeTab === 'afc-records') { workImport?.open();if(!selfMode&&dashboardAdmin(currentUser)){afcForms?.open();cccReplace?.open();}return loadAfcRecords(); }
    renderLookup();
  }

  async function loadTeachingSummary() {
    const g=authGeneration;
    if (aggregateCache.teachingSummary) { renderTeachingSummary(); return; }
    const body = $('summary-body'); if (body) body.innerHTML = '<tr><td colspan="12" class="empty">Loading teaching summary…</td></tr>';
    try { const rows=await UCVM_PAWS_DATA.dashboardTeachingSummary(); if(g!==authGeneration)return; aggregateCache.teachingSummary=rows; renderTeachingSummary(); }
    catch (error) { if(g!==authGeneration)return; if (body) body.innerHTML = `<tr><td colspan="12" class="empty">${esc(detailFailureMessage(error))}</td></tr>`; }
  }

  async function loadRoles() {
    const g=authGeneration;
    if (aggregateCache.roles) { renderRoles(); return; }
    const body = $('roles-body'); if (body) body.innerHTML = '<tr><td colspan="14" class="empty">Loading roles…</td></tr>';
    try { const rows=await UCVM_PAWS_DATA.dashboardRoles(); if(g!==authGeneration)return; aggregateCache.roles=rows; fillRoleFilter(); renderRoles(); }
    catch (error) { if(g!==authGeneration)return; if (body) body.innerHTML = `<tr><td colspan="14" class="empty">${esc(detailFailureMessage(error))}</td></tr>`; }
  }

  async function loadDoeOverview() {
    const g=authGeneration;
    if (aggregateCache.doeOverview) { renderDoeOverview(); return; }
    const body = $('doe-overview-body'); if (body) body.innerHTML = '<div class="empty">Loading DOE overview…</div>';
    try { const rows=await UCVM_PAWS_DATA.dashboardDoeOverview(); if(g!==authGeneration)return; aggregateCache.doeOverview=rows; renderDoeOverview(); }
    catch (error) { if(g!==authGeneration)return; if (body) body.innerHTML = `<div class="empty">${esc(detailFailureMessage(error))}</div>`; }
  }

  const AFC_REASON_LABELS = Object.freeze({ university_travel: 'University Travel', vacation: 'Vacation', rsl: 'RSL', medical: 'Medical', mat: 'MAT', special: 'Special', other: 'Other' });
  const afcSingleActions = window.UCVM_AFC_RECORDS.createSingleActions({
    api: UCVM_PAWS_DATA, $, reasonLabels: AFC_REASON_LABELS, normalizeDate: (value, field) => window.UCVM_AFC_BATCH.normalizePastedDate(value, field),
    isBusy: () => afcSubmitInFlight, setBusy: value => { afcSubmitInFlight = value; },
    refreshRecords: () => loadAfcRecords(true), refreshDashboard: () => loadAdminDashboard(),attachment:afcForms,getUser:()=>currentUser
  });

  async function loadAfcRecords(force = false) {
    const g=authGeneration;
    const body = $('afc-records-body');
    if (!force && afcLoaded) { renderAfcRecords(); return; }
    if (body) body.innerHTML = '<tr><td colspan="9" class="empty">Loading AFC records…</td></tr>';
    try {
      const rows = await UCVM_PAWS_DATA.dashboardAfcRecords({ limit: 2000 });
      if(g!==authGeneration)return;
      afcRecords=rows;
      afcRecords = Array.isArray(afcRecords) ? afcRecords : [];
      afcLoaded = true;
      renderAfcRecords();
      const note = $('afc-load-note'); if (note) note.textContent = `Unified AFC view · ${afcRecords.length} record${afcRecords.length === 1 ? '' : 's'} loaded · maximum 2,000.`;
      return afcRecords;
    } catch (error) {
      if(g!==authGeneration)return;
      afcLoaded = false;
      afcRecords = [];
      if (body) body.innerHTML = `<tr><td colspan="9" class="empty">${esc(detailFailureMessage(error))}</td></tr>`;
      return null;
    }
  }

  function populateAfcFacultyOptions() {
    const element = $('afc-faculty'); if (!element) return;
    const old = element.value;
    const rows = faculty.filter(row => row.active !== false).sort((a, b) => String(a.displayName || a.facultyId).localeCompare(String(b.displayName || b.facultyId)));
    element.innerHTML = '<option value="">Select active faculty…</option>' + rows.map(row => `<option value="${esc(row.facultyId)}">${esc(afcFacultyLabel(row))}</option>`).join('');
    if (rows.some(row => row.facultyId === old)) element.value = old;
  }

  function fillAfcReasonFilter() {
    const list = $('afc-faculty-options');
    if (list) list.innerHTML = afcFacultyRows().map(row => '<option value="' + esc(afcFacultyLabel(row)) + '"></option>').join('');
    const element = $('afc-reason-filter'); if (!element) return;
    const old = element.value;
    element.innerHTML = '<option value="">All reasons</option>' + Object.entries(AFC_REASON_LABELS).map(([code, label]) => `<option value="${code}">${label}</option>`).join('');
    if (Object.prototype.hasOwnProperty.call(AFC_REASON_LABELS, old)) element.value = old;
  }

  function renderAfcRecords() {
    fillAfcReasonFilter();
    const body = $('afc-records-body'); if (!body) return;
    const query = norm($('afc-search')?.value);
    const reason = $('afc-reason-filter')?.value || '';
    const active = $('afc-active-filter')?.value || '';
    const source = $('afc-source-filter')?.value || '';
    const rows = afcRecords.filter(row => {
      const haystack = norm([row.facultyName, row.facultyId, row.notes, row.legacyPurpose, row.reason, row.reasonCode].filter(present).join(' '));
      return (!query || haystack.includes(query)) && (!reason || row.reasonCode === reason || (!row.reasonCode && norm(row.reason) === norm(AFC_REASON_LABELS[reason]))) && (!active || String(row.active !== false) === active) && (!source || norm(row.sourceKind || 'manual') === source);
    });
    body.innerHTML = window.UCVM_AFC_RECORDS.renderRows(rows, { facultyName, canCancel: !selfMode && dashboardAdmin(currentUser) && UCVM_PAWS_DATA.afcCancelWriteEnabled?.() === true, canEdit: afcActions.canEdit(), editingKey: afcActions.editingKey(), busy: afcActions.isBusy,renderPdf:window.PAWS_AFC_FORMS?.documentAction });
    document.querySelectorAll('[data-afc-person]').forEach(node => on(node, 'click', () => openFacultyFromAggregate(node.dataset.afcPerson)));
  }

  function cancelAfcRecord(key) { return afcActions.cancel(key); }

  function submitAfcRecord(event) { return afcSingleActions.submit(event); }

  function updateFilters() { fillSelect('filter-rank', unique('rank'), 'All ranks'); }
  function updateStatus() { const summary = dashboardSummary || {}, show = key => present(summary[key]) ? summary[key] : '—'; const status = $('sync-status'); if (status) status.textContent = `Faculty ${faculty.length} · sessions ${show('sessionCount')} · assignments ${show('assignmentCount')} · roles ${show('roleAssignmentCount')} · HICC ${show('hiccCount')} · VISC ${show('viscCount')} · AFC ${show('afcRecordCount')} · check needed ${show('checkNeededCount')}`; const note = $('summary-load-note'); if (note) note.textContent = `VetMed-Ops summary · academic year ${summary.academicYear || 'current'}`; }
  function updateKpis() { const summary = dashboardSummary || {}; const set = (id, key) => { const node = $(id); if (node) node.textContent = present(summary[key]) ? String(summary[key]) : '—'; }; [['kpi-total', 'activeFacultyCount'], ['kpi-sessions', 'sessionCount'], ['kpi-assignments', 'assignmentCount'], ['kpi-courses', 'courseCount'], ['kpi-roles', 'roleAssignmentCount'], ['kpi-hicc', 'hiccCount'], ['kpi-visc', 'viscCount'], ['kpi-afc', 'afcRecordCount'], ['kpi-grid', 'gridPositionableCount'], ['kpi-check', 'checkNeededCount']].forEach(([id, key]) => set(id, key)); }

  async function loadLookupMetrics() {
    if(selfMode||!dashboardAdmin(currentUser)||!UCVM_PAWS_DATA.doeWorksheets||!UCVM_PAWS_DATA.dashboardAfcRecords)return;
    const g=++lookupMetricsGeneration, data=await VIEW.fetchLookupMetrics(UCVM_PAWS_DATA,currentAcademicYear());
    if(g!==lookupMetricsGeneration||selfMode)return;
    lookupMetrics=data;
    if(activeTab==='lookup')renderLookup();
  }
  function renderLookup(focusId) {
    const active = document.activeElement;
    const focusFacultyId = typeof focusId === 'string' ? focusId : active?.matches?.('.person-select') ? active.closest('.person-row')?.dataset.id : null;
    const rows = filteredLookup(); const count = $('result-count'); if (count) count.textContent = rows.length;
    if (selectedId && !rows.some(row => row.__id === selectedId)) selectedId = null;
    const list = $('result-list'); if (list) list.innerHTML = rows.map(row => `<div class="person-row ${row.__id === selectedId ? 'active' : ''}" data-id="${esc(row.__id)}"><button type="button" class="person-select" aria-pressed="${row.__id === selectedId}"><span class="person-name">${esc(row.preferredFullName || row.__id)}${row.active === false ? ' <span class="faculty-inactive-badge">Inactive</span>' : ''}</span><span class="person-meta">${esc(row.rank)}${row.teachingArea ? ' · ' + esc(row.teachingArea) : ''}</span><span class="person-meta">${esc(display(row.sessionCount)+' sessions · '+display(row.roleCount)+' roles · '+VIEW.lookupMetricsText(row.facultyId,lookupMetrics))}</span></button>${facultyManagement.editAction(row.facultyId)}</div>`).join('') || '<div class="empty">No matching faculty.</div>';
    document.querySelectorAll('.person-select').forEach(node => on(node, 'click', event => { selectedId = node.closest('.person-row').dataset.id; selectedDetail = null; ++detailLoadToken; renderLookup(event.detail === 0 || document.activeElement === node ? selectedId : undefined); }));
    if (focusFacultyId) {
      const focusedRow = [...document.querySelectorAll('#result-list .person-row')].find(node => node.dataset.id === focusFacultyId);
      focusedRow?.querySelector('.person-select')?.focus({ preventScroll: true });
    }
    const selected = faculty.find(row => row.__id === selectedId); if (!selected) { selectedDetail = null; renderApiDetail(null); return; }
    if (detailCache.has(selected.__id)) { selectedDetail = detailCache.get(selected.__id); renderApiDetail(selectedDetail); return; }
    selectedDetail = null;
    renderDetailPending(selected); selectFacultyDetail(selected.__id);
  }

  function teachingSummaryDoeStatus(row = {}) {
    const teachingMissing = Math.max(0, Number(row.teachingMissingCount || 0));
    const roleMissing = Math.max(0, Number(row.roleMissingCount || 0));
    const notApplicable = Math.max(0, Number(row.teachingNotApplicableCount || 0));
    if (!teachingMissing && !roleMissing) return { label: 'Complete', className: 'doe-within', title: notApplicable ? `${notApplicable} teaching line(s) not applicable to DOE` : 'All applicable DOE lines resolved' };
    if (teachingMissing && roleMissing) return { label: `Teaching + Role Review (${teachingMissing + roleMissing})`, className: 'doe-under', title: `${teachingMissing} teaching and ${roleMissing} role line(s) unresolved` };
    if (teachingMissing) return { label: `Teaching Review (${teachingMissing})`, className: 'doe-under', title: `${teachingMissing} applicable teaching line(s) unresolved` };
    return { label: `Role Review (${roleMissing})`, className: 'doe-under', title: `${roleMissing} role line(s) unresolved` };
  }

  function renderTeachingSummary() {
    const body = $('summary-body'); if (!body) return; const query = norm($('summary-search')?.value); const rows = (aggregateCache.teachingSummary || []).filter(row => !query || norm(`${facultyName(row, row.facultyId)} ${row.displayName} ${row.facultyId}`).includes(query));
    body.innerHTML = rows.map(row => { const status = teachingSummaryDoeStatus(row); const effectiveTotal = row.effectiveDoeTotal ?? row.recordedDoeTotal; return `<tr><td><button type="button" class="btn-link summary-person" data-summary-person="${esc(row.facultyId)}">${esc(facultyName(row, row.facultyId))}</button>${facultyManagement.editAction(row.facultyId)}</td><td>${formatDoe(row.assignedTeachingDoe)}</td><td>${formatDoe(row.roleDoe)}</td><td>${formatDoe(effectiveTotal)}</td><td>${row.year1Assignments ?? 0}</td><td>${row.year2Assignments ?? 0}</td><td>${row.year3Assignments ?? 0}</td><td>${row.year4Assignments ?? 0}</td><td>${display(row.creditedHours)}</td><td>${row.courseCount ?? 0}</td><td>${row.sessionCount ?? 0}</td><td><span class="doe-status ${status.className}" title="${esc(status.title)}">${esc(status.label)}</span></td></tr>`; }).join('') || '<tr><td colspan="12" class="empty">No teaching summary rows.</td></tr>';
    document.querySelectorAll('[data-summary-person]').forEach(node => on(node, 'click', () => openFacultyFromAggregate(node.dataset.summaryPerson)));
  }

  function fillRoleFilter() { fillSelect('role-type-filter', [...new Set((aggregateCache.roles || []).map(row => text(row.roleType)).filter(Boolean))].sort(), 'All role types'); }
  function renderRoles() {
    const body = $('roles-body'); if (!body) return; const query = norm($('roles-search')?.value), type = $('role-type-filter')?.value || '';
    const rows = (aggregateCache.roles || []).filter(row => (!query || norm(`${facultyName(row, row.facultyId)} ${row.displayName} ${row.roleType} ${row.courseOrSubjectOrRotation} ${row.courseName}`).includes(query)) && (!type || row.roleType === type) && (!$('role-status-filter')?.value || window.PAWS_ROLE_PERIODS.status(row, $('role-as-of')?.value || undefined).key === $('role-status-filter').value));
    body.innerHTML = rows.map(row => { const doe = effectiveRoleDoe(row); return `<tr><td><button type="button" class="btn-link summary-person" data-summary-person="${esc(row.facultyId)}">${esc(facultyName(row, row.facultyId))}</button></td><td><span class="role-chip">${esc(row.roleType || 'Other')}</span></td><td>${esc(row.courseOrSubjectOrRotation || '—')}</td><td>${esc(row.courseName || '—')}</td><td>${esc(row.details || '—')}</td><td>${esc(window.PAWS_ROLE_PERIODS.status(row, $('role-as-of')?.value || undefined).label)}</td><td>${esc(window.PAWS_ROLE_PERIODS.summary(row))}</td><td>${rolePeriodsEditor.action(row)}</td><td>${formatDoe(doe.mapped)}</td><td>${formatDoe(doe.override)}</td><td>${formatDoe(doe.calculated)}</td><td>${formatDoe(doe.effective)}</td><td>${esc(doe.source || row.doeSource || (doe.effective === null ? 'missing' : 'stored'))}</td><td>${esc(row.doeOverrideReason || '—')}</td><td>${esc(row.specialNotes || '—')}</td></tr>`; }).join('') || '<tr><td colspan="15" class="empty">No role assignments.</td></tr>';
    document.querySelectorAll('[data-summary-person]').forEach(node => on(node, 'click', () => openFacultyFromAggregate(node.dataset.summaryPerson)));
  }

  function openFacultyFromAggregate(facultyId) {
    const id = text(facultyId);
    if (!id || selfMode || !faculty.some(row => row.__id === id)) return;
    selectedId = id;
    selectTab('lookup');
  }

  function renderDoeOverview() {
    const overview = aggregateCache.doeOverview || {}; const coverage = overview.contractTargetCoverage || {}; const cards = $('doe-overview-cards');
    if (cards) cards.innerHTML = [
      ['Contract Teaching target coverage', `${display(coverage.teachingTargetCount)} / ${display(coverage.activeFacultyCount)}`],
      ['Contract Teaching targets missing', coverage.missingTeachingTargetCount],
      ['Contract target coverage', coverage.coveragePercent === null || coverage.coveragePercent === undefined ? '—' : `${Number(coverage.coveragePercent).toFixed(1)}%`],
      ['Assigned Teaching DOE', formatDoe(overview.teachingDoe)],
      ['Role DOE', formatDoe(overview.roleDoe)],
      ['Effective DOE Total', formatDoe(overview.effectiveDoeTotal ?? overview.recordedDoeTotal)]
    ].map(([label, value]) => `<div class="doe-summary-card"><div class="doe-summary-label">${esc(label)}</div><div class="doe-summary-value">${esc(value)}</div></div>`).join('');
    const categories = Array.isArray(coverage.allocationCategories) ? coverage.allocationCategories : [];
    const categoryRows = categories.map(row => `<tr><td>${esc(row.categoryCode)}</td><td>${display(row.facultyCount)}</td><td>${display(row.allocationRowCount)}</td></tr>`).join('');
    const body = $('doe-overview-body'); if (body) body.innerHTML = `<div class="doe-note ${overview.partial ? 'warn-box' : ''}">Stored SessionAssignment DOE and RoleAssignment override/mapped DOE remain authoritative. The server-side DOE Calculator fills only deterministic gaps; missing required inputs remain review items.</div><div class="recon-grid"><div class="recon-card"><div class="recon-label">Assigned Teaching DOE lines unresolved</div><div class="recon-value">${display(overview.teachingMissingCount)}</div><div>${display(overview.teachingRecordedCount)} recorded + ${display(overview.teachingCalculatedCount)} calculated = ${display(overview.teachingResolvedCount)} / ${display(overview.teachingLineCount)} applicable lines resolved · ${display(overview.teachingNotApplicableCount)} not applicable</div></div><div class="recon-card"><div class="recon-label">Role DOE lines unresolved</div><div class="recon-value">${display(overview.roleMissingCount)}</div><div>${display(overview.roleRecordedCount)} recorded + ${display(overview.roleCalculatedCount)} calculated = ${display(overview.roleResolvedCount)} / ${display(overview.roleLineCount)} resolved</div></div><div class="recon-card"><div class="recon-label">Zero overrides preserved</div><div class="recon-value">${display(overview.overrideZeroCount)}</div></div><div class="recon-card"><div class="recon-label">Negative overrides preserved</div><div class="recon-value">${display(overview.overrideNegativeCount)}</div></div></div>${categoryRows ? `<div class="section-title">Non-Teaching Contract DOE category coverage</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Category</th><th>Faculty with source</th><th>Allocation rows</th></tr></thead><tbody>${categoryRows}</tbody></table></div>` : '<div class="empty">No non-Teaching contract DOE allocations are recorded for this academic year.</div>'}`;
  }

  function renderApiDetail(detail) {
    facultyArchive?.clear();facultyArchive=null;
    const pane = $('profile-pane'); if (!pane) return; const data = detail && typeof detail === 'object' ? detail : null; const facultyRecord = data?.faculty && typeof data.faculty === 'object' ? data.faculty : null;
    if (!facultyRecord) { pane.innerHTML = '<div class="empty">Select a faculty member to view their profile.</div>'; return; }
    const profile = data.professionalProfile && typeof data.professionalProfile === 'object' ? data.professionalProfile : null;
    const roles = Array.isArray(data.roles) ? data.roles : []; const assignments = Array.isArray(data.teachingAssignments) ? data.teachingAssignments : [];
    const badges = [facultyRecord.rank, present(facultyRecord.fte) ? `FTE ${facultyRecord.fte}` : '', facultyRecord.stream, facultyRecord.recordType].filter(Boolean).map(value => `<span class="badge">${esc(value)}</span>`).join('');
    const identity = field('Preferred name', facultyName(facultyRecord)) + field('HR name', facultyRecord.hrName || 'Not imported from an exact source match') + field('HR name source', facultyRecord.hrNameSource) + field('UCID', facultyRecord.ucid) + field('Email', facultyRecord.email) + field('Reports to', facultyName(facultyRecord.reportsToName));
    const appointment = field('Rank', facultyRecord.rank) + field('Stream', facultyRecord.stream) + field('FTE', facultyRecord.fte) + field('Record type', facultyRecord.recordType) + field('Service date', profile?.serviceDate) + field('Prior years experience', profile?.priorYearsExperience) + field('Active', facultyRecord.active === false ? 'No' : 'Yes');
    const professional = profile ? field('Teaching area', profile.teachingArea, true) + field('Professional category', profile.professionalCategory) + field('DVM earned', profile.dvmEarnedDate) + field('DVM type', profile.dvmType) + field('Masters earned', profile.mastersEarnedDate) + field('Masters area', profile.mastersArea, true) + field('PhD earned', profile.phdEarnedDate) + field('PhD area', profile.phdArea, true) + field('Board certified date', profile.boardCertifiedDate) + field('Board certification count', profile.boardCertificationCount) + field('Board certification', profile.boardCertification, true) + field('ABVMA license number', profile.abvmaLicenseNumber) + field('ABVMA member type', profile.abvmaMemberType) : '';
    const specialty = [profile?.teachingArea, profile?.boardCertification].filter(present);
    const specialtyHtml = specialty.length ? `<div class="specialty-box"><strong>Specialty / focus:</strong> ${specialty.map(esc).join(' · ')}</div>` : '';
    const joints = (Array.isArray(data.jointAppointments) ? data.jointAppointments : []).map((joint, index) => section(`Joint appointment ${index + 1}`, field('Home faculty', joint.homeFaculty) + field('Joint faculty', joint.jointFaculty) + field('FTE UCVM', joint.fteUcvm) + field('FTE other faculty', joint.fteOtherFaculty) + field('Expiry date', joint.expiryDate) + field('Notes', joint.notes, true))).join('');
    const rolesHtml = apiSection('Roles & Appointments', apiTable(['Role Type', 'Assignment', 'Course Name', 'Details', 'Status', 'Effective periods', 'Mapped DOE', 'Override DOE', 'Calculated DOE', 'Effective DOE', 'Source', 'Override Reason', 'Special Notes'], roles.map(role => { const effective = effectiveRoleDoe(role); return [role.roleType, role.courseOrSubjectOrRotation, role.courseName, role.details, window.PAWS_ROLE_PERIODS.status(role).label, window.PAWS_ROLE_PERIODS.summary(role), formatDoe(effective.mapped), formatDoe(effective.override), formatDoe(effective.calculated), formatDoe(effective.effective), effective.source || role.doeSource, role.doeOverrideReason, role.specialNotes]; })));
    const afcHtml = renderFacultyAfc(data.afcRecords);
    const scope = section('Identity / appointment metadata', field('Academic year', data.academicYear) + field('Teaching assignments', data.sessionCount) + field('Assignments needing time review', data.checkNeededCount), true);
    const canManage = !selfMode && dashboardAdmin(currentUser) && facultyAdminWriteEnabled;
    const linked = data.linkedRecords || {};
    const actions = facultyManagement.actions(facultyRecord);
    const relationshipNote = canManage && facultyRecord.active !== false ? facultyManagement.relationshipWarning(linked) : '';
    pane.innerHTML = `<div class="profile-header"><div><div class="profile-name">${esc(facultyName(facultyRecord, facultyRecord.facultyId))}</div><div class="profile-sub">${esc(facultyRecord.email || '')}${facultyRecord.ucid ? ' · UCID ' + esc(facultyRecord.ucid) : ''}</div><div class="badges">${badges}</div>${specialtyHtml}</div>${actions}</div>${relationshipNote}<div class="profile-sections">${renderContractDoe(data.contractDoe, facultyRecord)}${renderDoeRuleBook(data.doeRuleBook)}${afcHtml}${rolesHtml}${renderTeachingCourses(assignments)}${section('Identity & contact', identity)}${section('Appointment', appointment)}${profile ? section('Specialty & education', professional, true) : ''}${joints}${scope}<section id="faculty-doe-worksheet" class="section wide"><div class="empty">Loading authoritative DOE Worksheet…</div></section></div>`;
    loadDetailDoeWorksheet(facultyRecord.facultyId, text(data.academicYear) || currentAcademicYear());
    const archiveHost=$('faculty-afc-originals');if(archiveHost){facultyArchive=window.PAWS_AFC_FORMS?.createArchiveController({api:UCVM_PAWS_DATA,host:archiveHost,getUser:()=>currentUser,getFacultyId:()=>selectedId===facultyRecord.facultyId?facultyRecord.facultyId:''});facultyArchive?.load();}
  }

  function renderFacultyAfc(records) { return window.UCVM_AFC_RECORDS.profileAfc(records,{selfMode,renderPdf:window.PAWS_AFC_FORMS?.documentAction}); }

  function currentAcademicYear() { return text(dashboardSummary?.academicYear || ''); }
  function otherWorkAcademicYear() { return currentAcademicYear() || text(selectedDetail?.academicYear); }
  function doeValue(value) { return number(value) === null ? 'Needs Review' : `${Number(value).toFixed(2)}%`; }
  function loadDetailDoeWorksheet(facultyId, academicYear) {
    return doeWorksheetView?.loadDetail(facultyId, academicYear, $('faculty-doe-worksheet'), () => String(selectedId || '').toLowerCase() === String(facultyId || '').toLowerCase());
  }
  function loadDoeList(force = false) { return doeWorksheetView?.loadList(force); }

  function afcFacultyRows() { return activeFaculty.filter(row => row.active !== false).sort((a, b) => String(a.displayName || a.facultyId).localeCompare(String(b.displayName || b.facultyId))); }
  function afcFacultyLabel(row) { return window.UCVM_AFC_RECORDS.facultyLabel(row, afcFacultyRows(), facultyName); }
  function resolveAfcFaculty(value) { return window.UCVM_AFC_RECORDS.resolveFaculty(value, afcFacultyRows(), facultyName); }

  function setAfcMode(multi) {
    $('afc-record-form')?.classList.toggle('hidden', multi);
    $('afc-batch-form')?.classList.toggle('hidden', !multi);
    $('afc-single-mode')?.setAttribute('aria-pressed', String(!multi));
    $('afc-batch-mode')?.setAttribute('aria-pressed', String(multi));
  }
  function invalidateAfcBatch() { afcBatchReviewed = false; afcBatchRequestId = ''; const button = $('afc-batch-submit'); if (button) button.disabled = true; }
  function setAfcBatchStatus(message, isError = false) { const status = $('afc-batch-status'); if (status) { status.textContent = message; status.classList.toggle('error', isError); } }
  function updateAfcBatchField(event) {
    const input = event.target?.closest?.('[data-afc-batch-field]'); if (!input) return;
    const index = Number(input.dataset.rowIndex), field = input.dataset.afcBatchField, row = afcBatchRows[index]; if (!row) return;
    row.importError = '';
    if (field === 'facultyEntry') { row.facultyEntry = input.value; const match = resolveAfcFaculty(input.value); row.facultyId = match ? match.facultyId : ''; }
    else row[field] = input.value;
    if (field === 'startDate' || field === 'endDate') {
      row.dateErrors = { ...(row.dateErrors || {}), [field]: '' };
      row.errors = Object.values(row.dateErrors).filter(Boolean);
      row.status = row.errors.length ? 'INVALID' : 'EDIT';
    }
    invalidateAfcBatch();
    document.querySelectorAll('#afc-batch-rows tr').forEach(tr => { if (tr.children[4]) tr.children[4].textContent = 'Not reviewed'; });
    setAfcBatchStatus('Changes made. Validate and review all rows before submitting.');
    if (afcBatchReviewed) { reviewAfcBatch(); renderAfcBatchRows(); }
  }
  function validateAfcBatchRows() {
    return UCVM_AFC_BATCH.validateRows(afcBatchRows, resolveAfcFaculty);
  }
  function reviewAfcBatch() {
    const rows = validateAfcBatchRows(); afcBatchReviewed = true;
    const invalid = rows.filter(row => row.errors.length).length, valid = UCVM_AFC_BATCH.canSubmitRows(rows, afcSubmitInFlight);
    const button = $('afc-batch-submit'); if (button) button.disabled = !valid || afcSubmitInFlight;
    setAfcBatchStatus(invalid ? invalid + ' row(s) need review; nothing was submitted.' : rows.length + ' row(s) ready. Review all values before submitting.');
    return valid;
  }
  function renderAfcBatchRows() {
    const body = $('afc-batch-rows'); if (!body) return;
    body.innerHTML = afcBatchRows.map((row, index) => '<tr><td><input class="input" list="afc-faculty-options" data-afc-batch-field="facultyEntry" data-row-index="' + index + '" value="' + esc(row.facultyEntry || '') + '" aria-label="Faculty member row ' + (index + 1) + '" placeholder="Search active Faculty…"></td><td><input class="input" type="date" data-afc-batch-field="startDate" data-row-index="' + index + '" value="' + esc(row.startDate) + '" aria-label="Start date row ' + (index + 1) + '"></td><td><input class="input" type="date" data-afc-batch-field="endDate" data-row-index="' + index + '" value="' + esc(row.endDate) + '" aria-label="End date row ' + (index + 1) + '"></td><td><input class="input" maxlength="1000" data-afc-batch-field="purpose" data-row-index="' + index + '" value="' + esc(row.purpose) + '" aria-label="Purpose row ' + (index + 1) + '"></td><td>' + (row.errors?.length ? esc(row.status + ': ' + row.errors.join(' ')) : afcBatchReviewed ? esc(row.status) : 'Not reviewed') + '</td><td><button class="btn" type="button" data-afc-batch-remove="' + index + '" aria-label="Remove row ' + (index + 1) + '">Remove</button></td></tr>').join('') || '<tr><td colspan="6" class="empty">Add or paste rows to begin.</td></tr>';
  }
  function loadAfcBatchPaste() {
    const parsed = UCVM_AFC_BATCH.parsePaste($('afc-batch-paste')?.value || '', resolveAfcFaculty);
    if (parsed.error) return setAfcBatchStatus(parsed.error, true);
    afcBatchRows = parsed.rows;
    invalidateAfcBatch(); renderAfcBatchRows();
    setAfcBatchStatus(parsed.rows.length + ' pasted row(s) loaded. Validate and review before submit.');
  }
  async function submitAfcBatch() {
    if (afcSubmitInFlight || !reviewAfcBatch()) return;
    if (!afcBatchRequestId) afcBatchRequestId = crypto.randomUUID();
    const submit = $('afc-batch-submit'); afcSubmitInFlight = true; if (submit) submit.disabled = true;
    setAfcBatchStatus('Submitting the complete batch…');
    try {
      const outcome = await UCVM_PAWS_DATA.createDashboardAfcManualBatch({ requestId: afcBatchRequestId, rows: UCVM_AFC_BATCH.toApiRows(afcBatchRows) });
      afcBatchRows = []; afcBatchRequestId = ''; afcBatchReviewed = false;
      setAfcBatchStatus(UCVM_AFC_BATCH.successMessage(outcome));
      await loadAdminDashboard(); await loadAfcRecords(true); renderAfcBatchRows();
    } catch (error) {
      if (Array.isArray(error?.rows)) {
        for (const outcome of error.rows) {
          const row = afcBatchRows[Number(outcome.rowIndex)]; if (!row) continue;
          row.status = outcome.status || outcome.rowStatus || 'CONFLICT';
          row.errors = [row.status === 'ALREADY_EXISTS' ? 'Matching AFC record already exists.' : 'This row was not created. Review the batch conflict.'];
        }
        afcBatchReviewed = true; renderAfcBatchRows();
      }
      setAfcBatchStatus((error?.message || 'Batch could not be submitted.') + ' Resolve row conflicts and validate before retrying.', true);
    }
    finally {
      afcSubmitInFlight = false;
      if (afcBatchRows.length) reviewAfcBatch();
      else { const button = $('afc-batch-submit'); if (button) button.disabled = true; }
      renderAfcBatchRows();
    }
  }

  const DOE_PROFILE_RENDERER = window.UCVM_FACULTY_DOE_RENDERER.create({ esc, number, formatDoe, display, effectiveRoleDoe, groupTeachingAssignments });
  const { renderContractDoe, renderDoeRuleBook, renderTeachingCourses } = DOE_PROFILE_RENDERER;
  function renderDetailPending(row) { const pane = $('profile-pane'); if (pane) pane.innerHTML = row ? `<div class="empty">Loading ${esc(row.preferredFullName || row.__id)}…</div>` : '<div class="empty">Select a faculty member to view their profile.</div>'; }
  async function selectFacultyDetail(facultyId) {
    const started = typeof performance?.now === 'function' ? performance.now() : 0;
    const id = text(facultyId); if (!id || norm(selectedId) !== norm(id)) return;
    const token = ++detailLoadToken;
    const generation = detailGeneration;
    if (detailCache.has(id)) { selectedDetail = detailCache.get(id); renderApiDetail(selectedDetail); return; }
    let request = detailPending.get(id);
    if (!request) { request = UCVM_PAWS_DATA.dashboardFacultyById(id); detailPending.set(id, request); }
    try {
      const detail = await request;
      if (generation !== detailGeneration) return;
      detailCache.set(id, detail);
      if (token !== detailLoadToken || norm(selectedId) !== norm(id)) return;
      selectedDetail = detail; renderApiDetail(detail); pawsTimingLog('detail', started);
    } catch (error) {
      if (generation !== detailGeneration || token !== detailLoadToken || norm(selectedId) !== norm(id)) return;
      const pane = $('profile-pane'); if (pane) pane.innerHTML = `<div class="empty">${esc(detailFailureMessage(error))}</div>`;
    } finally { if (detailPending.get(id) === request) detailPending.delete(id); }
  }

  function apiTable(headers, rows) { return DOE_PROFILE_RENDERER.apiTable(headers, rows); }
  function apiSection(title, table) { return table ? `<section class="section wide"><div class="section-title">${esc(title)}</div>${table}</section>` : ''; }
  function display(value) { if (!present(value)) return '—'; if (typeof value === 'object') return JSON.stringify(value); return String(value); }
  function field(label, value, full = false) { return present(value) ? `<div class="field ${full ? 'full' : ''}"><div class="field-label">${esc(label)}</div><div class="field-value">${/source|reference/i.test(label) ? DOE_PROFILE_RENDERER.referenceBubble(display(value)) : esc(display(value))}</div></div>` : ''; }
  function section(title, body, wide = false) { return body.trim() ? `<section class="section ${wide ? 'wide' : ''}"><div class="section-title">${esc(title)}</div><div class="field-grid">${body}</div></section>` : ''; }
  function detailFailureMessage(error) { const status = Number(error?.status) || 0, code = String(error?.code || ''); if (status === 404 || code === 'FACULTY_NOT_FOUND') return 'This faculty record was not found in the Dashboard data source.'; if (status === 401 || code === 'UNAUTHENTICATED') return 'Your Dashboard session could not be verified. Your sign-in is still active.'; if (status === 403 || ['ROLE_DENIED', 'PROFILE_REQUIRED', 'FACULTY_LINK_REQUIRED'].includes(code)) return error?.message || 'This account cannot read that faculty record.'; if (status === 503 || code === 'SQL_UNAVAILABLE' || status === 0) return 'Faculty data is temporarily unavailable. Your sign-in is still active.'; return error?.message || 'Faculty detail could not be loaded.'; }
  function cameFromTimetable(){
    try{const ref=new URL(document.referrer||'',location.href);return ref.origin===location.origin&&(ref.pathname.endsWith('/')||ref.pathname.endsWith('/index.html'))}catch(_){return false}
  }
  function returnToTimetable(){
    traineesEntry?.clear();
    if(cameFromTimetable()&&history.length>1){history.back();return}
    location.href='index.html';
  }
  function dashboardAuthFailureMessage(error) { const status = Number(error?.status) || 0, code = String(error?.code || ''); if (status === 503 || code === 'SQL_UNAVAILABLE' || status === 0) return 'Faculty Dashboard is temporarily unavailable. Your sign-in is still active. Refresh this page to retry.'; if (status === 401 || code === 'UNAUTHENTICATED') return 'Your Dashboard session could not be verified. Your sign-in is still active. Refresh this page to retry.'; if (status === 403) return error?.message || 'This account does not have Faculty Dashboard access.'; return error?.message || 'Could not verify Faculty Dashboard access.'; }
  function setDashboardLoading(loading) { if (!loading) return; const status = $('sync-status'); if (status) status.textContent = 'Loading Dashboard…'; document.querySelectorAll('.kpi-value').forEach(node => { node.textContent = '…'; }); const list = $('result-list'); if (list) list.innerHTML = '<div class="empty">Loading faculty…</div>'; }
  function markDashboardUnavailable(message) { const status = $('sync-status'); if (status) status.textContent = message; document.querySelectorAll('.kpi-value').forEach(node => { node.textContent = '—'; }); const list = $('result-list'); if (list) list.innerHTML = `<div class="empty">${esc(message)}</div>`; const pane = $('profile-pane'); if (pane) pane.innerHTML = '<div class="empty">Faculty data is currently unavailable.</div>'; }
  function unique(key) { return [...new Set(faculty.map(row => text(row[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
  function fillSelect(id, values, label) { const element = $(id); if (!element) return; const old = element.value; element.innerHTML = `<option value="">${esc(label)}</option>` + values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join(''); if (values.includes(old)) element.value = old; }
  function searchBlob(row) { return [row.displayName, row.preferredFullName, row.preferredFirstName, row.preferredLastName, row.ucid, row.email, row.rank, row.stream, row.teachingArea, row.professionalCategory, row.reportsToName].filter(present).join(' ').toLowerCase(); }
  function filteredLookup() { const query = norm($('lookup-search')?.value), rank = $('filter-rank')?.value || '', testingOnly = window.UCVM_TESTING_ONLY; return faculty.filter(row => (!query || searchBlob(row).includes(query)) && (!rank || row.rank === rank) && (!testingOnly?.keepFaculty || testingOnly.keepFaculty(row))); }
  // Testing site only: hooks for testing-only-features.js (Campus filter, imports).
  window.UCVM_FACULTY_ADMIN_TESTING_HOOKS = Object.freeze({ renderLookup: () => renderLookup(), faculty: () => faculty.slice(), currentUser: () => currentUser });
  function showToast(message, isError = false) { const node = $('toast'); if (!node) return; node.textContent = String(message || ''); node.classList.toggle('error', isError); node.classList.add('show'); window.setTimeout(() => node.classList.remove('show'), 4500); }
  const facultyDoeEdit = window.UCVM_FACULTY_DOE_EDIT?.create({
    api: UCVM_PAWS_DATA,
    academicYear: currentAcademicYear,
    canWrite: () => !selfMode && dashboardAdmin(currentUser) && facultyAdminWriteEnabled && UCVM_PAWS_DATA.doeAdminWriteEnabled?.() === true,
    canManualWrite: () => !selfMode && dashboardAdmin(currentUser) && facultyAdminWriteEnabled && UCVM_PAWS_DATA.doeManualAssignmentWriteEnabled?.() === true,
    onSaved: async id => {
      doeWorksheetView?.invalidate();
      aggregateCache.roles = null;
      aggregateCache.teachingSummary = null;
      aggregateCache.doeOverview = null;
      invalidateFacultyDetails();
      if (selectedId) await selectFacultyDetail(selectedId);
      if (activeTab === 'doe-list') await loadDoeList(true);
      if (activeTab === 'summary') await loadTeachingSummary();
      if (activeTab === 'roles') await loadRoles();
      if (activeTab === 'doe-overview') await loadDoeOverview();
    }
  });
  const rolePeriodsEditor = (() => {
    let editRoles = [];
    const allRoles = () => [...(aggregateCache.roles || []), ...editRoles, ...(selectedDetail?.roles || []).map(r => ({...r,facultyId:selectedDetail.faculty.facultyId}))];
    const editor = window.PAWS_ROLE_PERIODS.create({
      canWrite: () => !selfMode && dashboardAdmin(currentUser) && facultyAdminWriteEnabled,
      getRoles: allRoles, notify: showToast,
      onChanged: async id => { aggregateCache.roles = null; invalidateFacultyDetails(); await loadRoles(); if (selectedId === id) await selectFacultyDetail(id); }
    });
    return {...editor,remember: detail => {editRoles=(detail.roles||[]).map(r=>({...r,facultyId:detail.faculty.facultyId}));},rolesFor: id => allRoles().filter((r,i,a) => r.facultyId===id && a.findIndex(x=>x.roleAssignmentId===r.roleAssignmentId)===i)};
  })();
  const facultyManagement = window.UCVM_FACULTY_ADMIN_MANAGEMENT.create({
    canWrite: () => !selfMode && dashboardAdmin(currentUser) && facultyAdminWriteEnabled,
    getFaculty: () => faculty,
    getSelectedDetail: () => selectedDetail,
    getFacultyDetail: facultyId => UCVM_PAWS_DATA.dashboardFacultyById(facultyId),
    onEditOpen: (form, f, p, detail) => { rolePeriodsEditor.remember(detail); facultyDoeEdit?.mount(form, f); const roles = rolePeriodsEditor.rolesFor(f.facultyId); form.querySelector('#faculty-record-fields')?.insertAdjacentHTML('beforeend', '<section class="form-section"><h3>Roles &amp; Appointments · effective periods</h3>' + roles.map(r => '<p>' + esc(r.roleType) + ' · ' + esc(r.courseOrSubjectOrRotation) + ' · ' + esc(window.PAWS_ROLE_PERIODS.status(r).label) + ' ' + rolePeriodsEditor.action(r) + '</p>').join('') + '</section>'); },
    notify: showToast,
    onChanged: async (id, requestedStatus) => {
      if (requestedStatus === 'inactive' && facultyStatus === 'active') facultyStatus = 'inactive';
      else if (requestedStatus === 'active' && facultyStatus === 'inactive') facultyStatus = 'active';
      if ($('faculty-status-filter')) $('faculty-status-filter').value = facultyStatus;
      selectedId = id; invalidateFacultyDetails(); await loadAdminDashboard(); await selectFacultyDetail(id);
    }
  });
  doeWorksheetView = window.UCVM_FACULTY_DOE_WORKSHEET.create({
    api: UCVM_PAWS_DATA, escapeHtml: esc, formatDoe: doeValue,
    finiteDoe: value => number(value), getFaculty: () => faculty,
    getAcademicYear: currentAcademicYear,
    editAction: facultyId => facultyManagement.editAction(facultyId),
    onView: openFacultyFromAggregate
  });
  doeWorksheetView.bindList();
  doePolicyView = window.UCVM_FACULTY_DOE_POLICY?.create({
    api: UCVM_PAWS_DATA,
    getFaculty: () => faculty,
    getAcademicYear: currentAcademicYear,
    canAdmin: () => !selfMode && dashboardAdmin(currentUser) && UCVM_PAWS_DATA.doeAdminWriteEnabled?.() === true,
    canPublish: () => !selfMode && dashboardGeneral(currentUser) && UCVM_PAWS_DATA.doePolicyPublishEnabled?.() === true,
    canRecalculate: () => !selfMode && dashboardGeneral(currentUser) && UCVM_PAWS_DATA.doeRecalculateEnabled?.() === true
  });
  doePolicyView?.mount($('doe-rules-content'));
  function installSelfModeStyles() { if ($('faculty-self-mode-style')) return; const style = document.createElement('style'); style.id = 'faculty-self-mode-style'; style.textContent = 'body.faculty-self-mode .tabs .tab:not([data-tab="lookup"]):not([data-tab="trainees"]):not([data-tab="availability"]):not([data-tab="other-work"]),body.faculty-self-mode .tabs a,body.faculty-self-mode .kpis,body.faculty-self-mode .summary-source-banner,body.faculty-self-mode #lookup-view > .toolbar,body.faculty-self-mode .result-pane,body.faculty-self-mode #sync-status{display:none!important}body.faculty-self-mode .lookup-grid{display:block;min-height:0}body.faculty-self-mode .profile-pane{width:100%;min-width:0;padding:18px}'; document.head.appendChild(style); }
  function lock(message) { reportsEntry?.clear();officeWorkspace?.sync(null);traineesEntry?.clear(); afcForms?.clear();facultyArchive?.clear();cccReplace?.clear();closeHistory();if($('faculty-history-btn'))$('faculty-history-btn').disabled=true;$('auth-gate').classList.remove('hidden'); $('gate-status').textContent = message; }
  function unlock(profile) { officeWorkspace?.sync(profile);if($('faculty-history-btn'))$('faculty-history-btn').disabled=false;$('auth-gate').classList.add('hidden'); }
  function debounce(fn, wait = 160) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

  $('gate-back').onclick = $('back-btn').onclick = returnToTimetable;
  $('signout-btn').onclick = async () => { otherWorkTab?.clear();traineesEntry?.clear(); if (auth) await auth.signOut(); location.href = 'index.html'; };
  init();
})();
