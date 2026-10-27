'use strict';
// Testing site only.
//
// Features the old testing site had that beta (PAWS) does not. They are added
// to the PAWS pages here, each marked with a small "T" badge, so testers can
// tell them apart from real beta features. They use the same PAWS API as the
// rest of the page (on the test site that API runs in the browser on sample
// data). This file is published only on the testing site.
(function (root) {
  if (!root || !root.document) return;
  const doc = root.document;
  const BADGE_TITLE = 'Testing site only – not on beta';
  const ACADEMIC_YEAR = '2026-27';
  const YEAR_RANGE = { start: '2026-07-01', end: '2027-06-30' };
  const ADMIN_ROLES = new Set(['developer', 'owner', 'administrator', 'adfa_general', 'adfa_regular', 'admin']);
  const FACULTY_ROLES = new Set(['faculty', 'hicc', 'visc']);
  const CLOSURES = [
    ['2026-07-01', 'Canada Day'], ['2026-08-03', 'Heritage Day'], ['2026-09-07', 'Labour Day'],
    ['2026-09-30', 'National Day for Truth and Reconciliation'], ['2026-10-12', 'Thanksgiving Day'],
    ['2026-11-11', 'Remembrance Day'], ['2026-12-25', 'Christmas Day'],
    ['2026-12-28', 'Holiday Observance — University Closed'], ['2026-12-29', 'Holiday Observance — University Closed'],
    ['2026-12-30', 'Holiday Observance — University Closed'], ['2026-12-31', 'Holiday Observance — University Closed'],
    ['2027-01-01', "New Year's Day"], ['2027-02-15', 'Family Day'], ['2027-03-26', 'Good Friday'],
    ['2027-03-29', 'Easter Monday'], ['2027-05-24', 'Victoria Day']
  ];

  const state = { showCcc: true, showClosures: true, allSemesters: false, campus: '' };

  // ---------------------------------------------------------------- helpers
  const $ = id => doc.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const badge = () => `<span class="testing-only-badge" title="${BADGE_TITLE}" aria-label="${BADGE_TITLE}">T</span>`;
  const el = html => { const t = doc.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const hhmm = value => String(value || '').slice(0, 5);
  const num = (value, digits = 2) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—');
  const uuid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
  const roleOf = user => String((user && user.role) || '').toLowerCase();

  async function api(path, { method = 'GET', body } = {}) {
    const origin = root.PAWS_API_ORIGIN_CONFIG && root.PAWS_API_ORIGIN_CONFIG.apiOrigin;
    const user = root.firebase && root.firebase.auth && root.firebase.auth().currentUser;
    if (!origin || !user) throw new Error('Sign in first.');
    const token = await user.getIdToken();
    const response = await root.fetch(new URL(path, origin).href, {
      method,
      headers: Object.assign({ authorization: 'Bearer ' + token }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((json && json.error && json.error.message) || `Request failed (${response.status}).`);
    return json;
  }

  function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && source[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const clean = rows.filter(r => r.some(c => String(c).trim() !== ''));
    if (!clean.length) return [];
    const head = clean[0].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? '').trim()])));
  }
  const pick = (row, ...keys) => { for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k]; return ''; };
  const csvCell = value => { const s = String(value ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = doc.createElement('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function readFile(input) {
    return new Promise((resolve, reject) => {
      const file = input.files && input.files[0];
      if (!file) return reject(new Error('Choose a file first.'));
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsText(file);
    });
  }

  let toastTimer = 0;
  function toast(message, isError) {
    let box = $('testing-only-toast');
    if (!box) { box = el('<div id="testing-only-toast" class="testing-only-toast" role="status"></div>'); doc.body.appendChild(box); }
    box.innerHTML = `${badge()} ${esc(message)}`; box.classList.toggle('is-error', !!isError); box.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('show'), 4500);
  }

  function openPanel(title, { wide = false } = {}) {
    closePanel();
    const overlay = el(`<div class="testing-only-overlay" id="testing-only-overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="testing-only-dialog${wide ? ' wide' : ''}"><div class="testing-only-head"><h2>${esc(title)} ${badge()}</h2><button type="button" class="testing-only-close" aria-label="Close">×</button></div>
      <p class="testing-only-note">Testing site only. This feature is not on beta.</p><div class="testing-only-body">Loading…</div></div></div>`);
    overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('.testing-only-close')) closePanel(); });
    doc.body.appendChild(overlay);
    return overlay.querySelector('.testing-only-body');
  }
  function closePanel() { const old = $('testing-only-overlay'); if (old) old.remove(); }
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });

  function table(columns, rows, empty = 'Nothing to show.') {
    if (!rows.length) return `<p class="testing-only-empty">${esc(empty)}</p>`;
    return `<div class="testing-only-table-wrap"><table class="testing-only-table"><thead><tr>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(c => `<td>${c.html ? c.html(row) : esc(c.value(row))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const pill = (textValue, tone) => `<span class="testing-only-pill ${tone || ''}">${esc(textValue)}</span>`;
  const failure = (node, error) => { node.innerHTML = `<p class="testing-only-status is-error">${esc(error.message || error)}</p>`; };

  function installStyle() {
    if ($('testing-only-style')) return;
    const style = doc.createElement('style'); style.id = 'testing-only-style';
    style.textContent = `
.testing-only-badge{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;margin-left:4px;border-radius:3px;background:#b45309;color:#fff;font:800 10px/1 Arial,sans-serif;vertical-align:middle;cursor:help;flex:none}
.testing-only-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.45);display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;overflow:auto}
.testing-only-dialog{background:var(--surface,#fff);color:var(--text,#111);width:min(760px,100%);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.3);padding:18px 20px;border:1px solid var(--border,#ddd)}
.testing-only-dialog.wide{width:min(1180px,100%)}
.testing-only-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.testing-only-head h2{margin:0;font-size:18px}
.testing-only-close{border:0;background:none;font-size:26px;line-height:1;cursor:pointer;color:inherit}
.testing-only-note{margin:4px 0 12px;font-size:12px;color:#92400e}
.testing-only-table-wrap{overflow:auto;max-height:62vh;border:1px solid var(--border,#ddd);border-radius:8px}
.testing-only-table{border-collapse:collapse;width:100%;font-size:12.5px}.testing-only-table th,.testing-only-table td{padding:6px 8px;border-bottom:1px solid var(--border,#e5e7eb);text-align:left;vertical-align:top}
.testing-only-table th{position:sticky;top:0;background:var(--surface2,#f8fafc);font-weight:700}
.testing-only-empty{padding:14px;color:#64748b}
.testing-only-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}
.testing-only-row input,.testing-only-row select{padding:5px 8px;border:1px solid var(--border,#cbd5e1);border-radius:6px;background:var(--surface,#fff);color:inherit}
.testing-only-btn{padding:6px 11px;border:1px solid var(--border,#cbd5e1);border-radius:6px;background:var(--surface2,#f8fafc);color:inherit;cursor:pointer;font-weight:600}
.testing-only-btn.primary{background:#b45309;border-color:#b45309;color:#fff}
.testing-only-btn:disabled{opacity:.55;cursor:default}
.testing-only-tabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}.testing-only-tabs .testing-only-btn.active{background:#fde68a;border-color:#b45309;color:#111}
.testing-only-pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;background:#e2e8f0;color:#0f172a}
.testing-only-pill.good{background:#dcfce7;color:#14532d}.testing-only-pill.warn{background:#fef3c7;color:#78350f}.testing-only-pill.bad{background:#fee2e2;color:#7f1d1d}
.testing-only-status{font-size:12.5px;margin:8px 0;white-space:pre-wrap}.testing-only-status.is-error{color:#b91c1c}
.testing-only-check{display:inline-flex;align-items:center;gap:5px;font-size:13px;white-space:nowrap}
.testing-only-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);opacity:0;pointer-events:none;z-index:2147483001;background:#1e293b;color:#fff;padding:9px 14px;border-radius:8px;font-size:13px;transition:.2s}
.testing-only-toast.show{opacity:1;transform:translateX(-50%)}.testing-only-toast.is-error{background:#991b1b}
.testing-only-notify{position:fixed;right:16px;bottom:16px;z-index:2147482000;max-width:340px;background:var(--surface,#fff);color:var(--text,#111);border:1px solid #b45309;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:12px 14px;font-size:13px}
.testing-only-notify h3{margin:0 0 6px;font-size:14px}.testing-only-notify ul{margin:0 0 8px;padding-left:18px}
.testing-only-closure{background:repeating-linear-gradient(45deg,#fef3c7,#fef3c7 6px,#fde68a 6px,#fde68a 12px)!important;color:#78350f!important;border-color:#b45309!important}
.testing-only-panel{padding:14px}
.testing-only-section{margin:16px 0;padding:12px;border:1px dashed #b45309;border-radius:10px}
.testing-only-section h3{margin:0 0 6px;font-size:14px}
`;
    doc.head.appendChild(style);
  }

  // ------------------------------------------------------------- Timetable
  function closureRows() {
    return CLOSURES.map(([date, name]) => ({
      id: 'testing-only-closure-' + date, testingOnlyRow: true, isWorkingActivity: true, readOnlyActivity: true,
      date, start: '07:30', end: '17:00', course: 'University closed', topic: name, type: 'Closure', room: '', instructor: '',
      sourceActivity: { label: name, category: 'university_closure', startDate: date, endDate: date }
    }));
  }

  function mountTimetable() {
    const rerender = () => { try { root.UCVM_TIMETABLE_TESTING_HOOKS && root.UCVM_TIMETABLE_TESTING_HOOKS.render(); } catch (_) {} };

    // Semester "All"
    const semesterRow = $('semester-btn-row');
    if (semesterRow && !semesterRow.querySelector('.testing-only-semester-all')) {
      const all = el(`<button type="button" class="pill-btn testing-only-semester-all" title="${BADGE_TITLE}">All${badge()}</button>`);
      semesterRow.appendChild(all);
      all.addEventListener('click', () => {
        state.allSemesters = true;
        semesterRow.querySelectorAll('[data-semester]').forEach(b => b.classList.remove('active'));
        all.classList.add('active');
        const list = $('cal-list-btn'); if (list) list.click(); else rerender();
        toast('Semester "All": showing the whole academic year in List view.');
      });
      semesterRow.addEventListener('click', event => { if (event.target.closest('[data-semester]')) { state.allSemesters = false; all.classList.remove('active'); } });
    }

    // Show CCC / Show University Closures
    const reset = $('reset-filters');
    if (reset && !$('testing-only-filter-item')) {
      const item = el(`<div class="fbar-item" id="testing-only-filter-item"><span class="fbar-label">Show${badge()}</span>
        <div class="testing-only-row" style="margin:0"><label class="testing-only-check"><input type="checkbox" id="testing-only-show-ccc" checked> CCC</label>
        <label class="testing-only-check"><input type="checkbox" id="testing-only-show-closures" checked> University Closures</label></div></div>`);
      reset.parentNode.insertBefore(item, reset);
      $('testing-only-show-ccc').addEventListener('change', e => { state.showCcc = e.target.checked; rerender(); });
      $('testing-only-show-closures').addEventListener('change', e => { state.showClosures = e.target.checked; rerender(); });
    }

    // Course List view button
    const toggle = doc.querySelector('.cal-view-toggle');
    if (toggle && !$('testing-only-course-list-btn')) {
      const button = el(`<button class="cal-view-btn" id="testing-only-course-list-btn" type="button">Course List${badge()}</button>`);
      toggle.appendChild(button);
      button.addEventListener('click', openCourseList);
    }

    // Select Sessions (bulk edit) badge
    const select = $('select-sessions-btn');
    if (select && !select.querySelector('.testing-only-badge')) select.insertAdjacentHTML('beforeend', badge());

    // Workflow buttons
    const nav = doc.querySelector('.faculty-workflow-nav');
    if (nav && !$('testing-only-approvals-btn')) {
      nav.insertAdjacentHTML('beforeend', `<button class="fbar-reset hidden" id="testing-only-approvals-btn" type="button">All Approvals${badge()}</button>
        <button class="fbar-reset hidden" id="testing-only-work-queue-btn" type="button">Work Queue${badge()}</button>
        <button class="fbar-reset hidden" id="testing-only-requests-btn" type="button">Requests${badge()}</button>`);
      $('testing-only-approvals-btn').addEventListener('click', openApprovals);
      $('testing-only-work-queue-btn').addEventListener('click', openWorkQueue);
      $('testing-only-requests-btn').addEventListener('click', openRequests);
    }

    const applyUser = user => {
      const role = roleOf(user);
      $('testing-only-approvals-btn')?.classList.toggle('hidden', !ADMIN_ROLES.has(role));
      $('testing-only-work-queue-btn')?.classList.toggle('hidden', !ADMIN_ROLES.has(role));
      $('testing-only-requests-btn')?.classList.toggle('hidden', !FACULTY_ROLES.has(role));
      if (user) showNotifications(user);
    };
    root.addEventListener('ucvm-timetable-user', event => applyUser(event.detail && event.detail.user));
    const current = root.UCVM_TIMETABLE_TESTING_HOOKS && root.UCVM_TIMETABLE_TESTING_HOOKS.currentUser();
    if (current) applyUser(current);

    const body = $('calendar-body');
    const markClosures = () => body.querySelectorAll('[data-session-id^="testing-only-closure-"]').forEach(b => b.classList.add('testing-only-closure'));
    if (body && root.MutationObserver) new MutationObserver(markClosures).observe(body, { childList: true, subtree: true });
  }

  async function openCourseList() {
    const body = openPanel('Course List', { wide: true });
    try {
      const { sessions = [] } = await api(`/api/v1/sessions?start=${YEAR_RANGE.start}&end=${YEAR_RANGE.end}`);
      const map = new Map();
      for (const s of sessions) {
        const key = s.courseCode || '—';
        const row = map.get(key) || { course: key, name: s.courseName || '', year: s.curriculumYear || '', sessions: 0, types: new Set(), faculty: new Set(), first: s.date, last: s.date };
        row.sessions++; row.types.add(s.sessionType);
        String(s.instructorNames || '').split(';').map(x => x.trim()).filter(Boolean).forEach(n => row.faculty.add(n));
        if (s.date < row.first) row.first = s.date;
        if (s.date > row.last) row.last = s.date;
        map.set(key, row);
      }
      const rows = [...map.values()].sort((a, b) => String(a.year).localeCompare(String(b.year)) || a.course.localeCompare(b.course));
      body.innerHTML = `<div class="testing-only-row"><input type="search" id="testing-only-course-search" placeholder="Search course or faculty…"><span>${rows.length} courses · ${sessions.length} sessions · ${ACADEMIC_YEAR}</span></div><div id="testing-only-course-table"></div>`;
      const draw = () => {
        const q = String($('testing-only-course-search').value || '').toLowerCase();
        const shown = rows.filter(r => !q || `${r.course} ${r.name} ${[...r.faculty].join(' ')}`.toLowerCase().includes(q));
        $('testing-only-course-table').innerHTML = table([
          { label: 'Year', value: r => r.year }, { label: 'Course', value: r => r.course }, { label: 'Name', value: r => r.name },
          { label: 'Sessions', value: r => r.sessions }, { label: 'Types', value: r => [...r.types].join(', ') },
          { label: 'Faculty', value: r => [...r.faculty].join('; ') }, { label: 'First', value: r => r.first }, { label: 'Last', value: r => r.last },
          { label: '', html: r => `<button type="button" class="testing-only-btn" data-show-course="${esc(r.course)}">Show in timetable</button>` }
        ], shown, 'No courses match.');
      };
      body.addEventListener('input', draw); draw();
      body.addEventListener('click', event => {
        const button = event.target.closest('[data-show-course]'); if (!button) return;
        const search = $('search-input');
        if (search) { search.value = button.dataset.showCourse; search.dispatchEvent(new Event('input', { bubbles: true })); search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
        closePanel(); $('cal-list-btn')?.click();
      });
    } catch (error) { failure(body, error); }
  }

  const AFC_STAGE = { pending_report_to: 'Waiting for Report-to', pending_admin: 'Waiting for Admin', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn' };
  const afcTone = status => (status === 'approved' ? 'good' : status === 'rejected' ? 'bad' : status === 'withdrawn' ? '' : 'warn');

  async function openApprovals() {
    const body = openPanel('All Approvals', { wide: true });
    try {
      const [afc, swaps] = await Promise.all([api('/api/v1/afc-requests'), api('/api/v1/swaps/queue')]);
      const afcRows = (afc.afcRequests || []).filter(r => r.status === 'pending_report_to' || r.status === 'pending_admin');
      const swapRows = (swaps.requests || []).filter(r => r.status === 'pending');
      body.innerHTML = `<p>One list of everything waiting for a decision. Use <strong>Open</strong> to decide it in the beta screen.</p>
        <h3>Away from Campus (AFC) requests (${afcRows.length})</h3>${table([
          { label: 'Faculty', value: r => r.facultyName }, { label: 'Dates', value: r => `${r.startDate} → ${r.endDate}` },
          { label: 'Reason', value: r => r.reason }, { label: 'Stage', html: r => pill(AFC_STAGE[r.status] || r.status, 'warn') },
          { label: 'Submitted', value: r => String(r.submittedAtUtc || '').slice(0, 10) },
          { label: '', html: () => '<button type="button" class="testing-only-btn" data-open="afc">Open</button>' }
        ], afcRows, 'No AFC requests are waiting.')}
        <h3 style="margin-top:14px">Timetable (SWAP) requests (${swapRows.length})</h3>${table([
          { label: 'Course', value: r => r.courseCode }, { label: 'Date', value: r => r.date }, { label: 'Topic', value: r => r.topic },
          { label: 'Requested by', value: r => r.requesterName || '' }, { label: 'Next step', html: r => pill(String(r.nextStage || '').toUpperCase(), 'warn') },
          { label: '', html: () => '<button type="button" class="testing-only-btn" data-open="swap">Open</button>' }
        ], swapRows, 'No SWAP requests are waiting.')}`;
      body.addEventListener('click', event => {
        const target = event.target.closest('[data-open]'); if (!target) return;
        closePanel();
        if (target.dataset.open === 'swap') $('swap-inbox-btn')?.click(); else $('afc-request-btn')?.click();
      });
    } catch (error) { failure(body, error); }
  }

  async function openWorkQueue() {
    const body = openPanel('Work Queue', { wide: true });
    try {
      const [tasks, sessions] = await Promise.all([
        api(`/api/v1/scheduling-tasks?academicYear=${ACADEMIC_YEAR}`),
        api(`/api/v1/sessions?start=${YEAR_RANGE.start}&end=${YEAR_RANGE.end}`)
      ]);
      const typeById = new Map((sessions.sessions || []).map(s => [s.id, String(s.sessionType || '').toUpperCase()]));
      const all = (tasks.tasks || []).map(t => ({ ...t, sessionType: typeById.get(t.sessionId) || '' }));
      const groups = {
        open: { label: 'Open Work', rows: all.filter(t => String(t.reviewStatus || '').toLowerCase() === 'unreviewed') },
        adc: { label: 'ADC Work', rows: all.filter(t => t.sessionType !== 'LAB') },
        lab: { label: 'LAB Work', rows: all.filter(t => t.sessionType === 'LAB') }
      };
      let active = 'open';
      const draw = () => {
        const g = groups[active];
        body.innerHTML = `<div class="testing-only-tabs">${Object.entries(groups).map(([key, value]) => `<button type="button" class="testing-only-btn${key === active ? ' active' : ''}" data-group="${key}">${esc(value.label)} (${value.rows.length})</button>`).join('')}</div>
          <p>Open Work = anything not reviewed yet. ADC Work = timetable issues outside LAB sessions. LAB Work = issues on LAB sessions.</p>
          ${table([
            { label: 'Date', value: r => r.date || '' }, { label: 'Course', value: r => r.courseCode || '' }, { label: 'Type', value: r => r.sessionType || '' },
            { label: 'Faculty', value: r => r.displayName || '' }, { label: 'Issue', value: r => String(r.type || '').replace(/_/g, ' ') },
            { label: 'Severity', html: r => pill(r.severity || '', /review/i.test(r.severity) ? 'warn' : 'bad') },
            { label: 'Status', html: r => pill(r.reviewStatus || '', /unreviewed/i.test(r.reviewStatus) ? 'warn' : 'good') }
          ], g.rows, 'Nothing in this queue.')}`;
      };
      body.addEventListener('click', event => { const b = event.target.closest('[data-group]'); if (b) { active = b.dataset.group; draw(); } });
      draw();
    } catch (error) { failure(body, error); }
  }

  async function openRequests() {
    const body = openPanel('My Requests', { wide: true });
    try {
      const uid = root.firebase.auth().currentUser.uid;
      const [afc, swaps] = await Promise.all([api('/api/v1/afc-requests'), api('/api/v1/swaps/queue')]);
      const mineAfc = (afc.afcRequests || []).filter(r => r.requesterFirebaseUid === uid);
      const mineSwaps = (swaps.requests || []).filter(r => r.isMine);
      body.innerHTML = `<h3>My AFC requests (${mineAfc.length})</h3>${table([
          { label: 'Dates', value: r => `${r.startDate} → ${r.endDate}` }, { label: 'Reason', value: r => r.reason },
          { label: 'Status', html: r => pill(AFC_STAGE[r.status] || r.status, afcTone(r.status)) }, { label: 'Updated', value: r => String(r.updatedAtUtc || '').slice(0, 10) }
        ], mineAfc, 'You have no AFC requests.')}
        <h3 style="margin-top:14px">My SWAP requests (${mineSwaps.length})</h3>${table([
          { label: 'Course', value: r => r.courseCode }, { label: 'Date', value: r => r.date }, { label: 'Topic', value: r => r.topic },
          { label: 'Status', html: r => pill(r.status, r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : 'warn') },
          { label: 'Next step', value: r => String(r.nextStage || '').toUpperCase() }
        ], mineSwaps, 'You have no SWAP requests.')}`;
    } catch (error) { failure(body, error); }
  }

  let notifiedUid = '';
  async function showNotifications(user) {
    const uid = root.firebase && root.firebase.auth().currentUser && root.firebase.auth().currentUser.uid;
    if (!uid || notifiedUid === uid) return; notifiedUid = uid;
    try { if (root.sessionStorage.getItem('testing-only-notified-' + uid)) return; } catch (_) {}
    const role = roleOf(user);
    try {
      const [afc, swaps] = await Promise.all([api('/api/v1/afc-requests'), api('/api/v1/swaps/queue')]);
      const requests = afc.afcRequests || [], items = [];
      if (ADMIN_ROLES.has(role)) {
        const a = requests.filter(r => r.status === 'pending_admin').length;
        const s = (swaps.requests || []).filter(r => r.status === 'pending').length;
        if (a) items.push(`${a} AFC request${a === 1 ? '' : 's'} waiting for Admin`);
        if (s) items.push(`${s} SWAP request${s === 1 ? '' : 's'} waiting for a decision`);
      }
      const reportTo = requests.filter(r => r.status === 'pending_report_to' && r.reportToFirebaseUid === uid).length;
      if (reportTo) items.push(`${reportTo} AFC request${reportTo === 1 ? '' : 's'} waiting for you as Report-to`);
      const decided = requests.filter(r => r.requesterFirebaseUid === uid && ['approved', 'rejected'].includes(r.status)).length;
      if (decided) items.push(`${decided} of your AFC requests ${decided === 1 ? 'has' : 'have'} a decision`);
      if (!items.length || $('testing-only-notify')) return;
      const box = el(`<div class="testing-only-notify" id="testing-only-notify" role="status"><h3>Workflow notifications${badge()}</h3><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        <button type="button" class="testing-only-btn" data-notify-open>Open</button> <button type="button" class="testing-only-btn" data-notify-close>Dismiss</button></div>`);
      doc.body.appendChild(box);
      box.addEventListener('click', event => {
        if (event.target.closest('[data-notify-open]')) (ADMIN_ROLES.has(role) ? openApprovals : openRequests)();
        if (event.target.closest('[data-notify-open],[data-notify-close]')) { box.remove(); try { root.sessionStorage.setItem('testing-only-notified-' + uid, '1'); } catch (_) {} }
      });
    } catch (_) { /* notifications are best effort */ }
  }

  // -------------------------------------------------------- Faculty Dashboard
  function legacySeed() {
    const seed = root.UCVM_PAGES_DEMO_SEED;
    return seed && Array.isArray(seed.documents) ? seed.documents : [];
  }
  function campusByUcid() {
    const index = legacySeed().find(d => d.path === 'settings/faculty_index');
    return new Map(((index && index.data && index.data.entries) || []).filter(e => e.id).map(e => [String(e.id), e.campus || '']));
  }

  function mountFacultyDashboard() {
    const hooks = () => root.UCVM_FACULTY_ADMIN_TESTING_HOOKS;
    const campuses = campusByUcid();

    // Lookup: Campus filter
    const rank = $('filter-rank');
    if (rank && !$('testing-only-campus')) {
      const values = [...new Set([...campuses.values()].filter(Boolean))].sort();
      const wrap = el(`<span class="testing-only-row" style="margin:0;display:inline-flex"><select class="select" id="testing-only-campus" aria-label="Campus" title="${BADGE_TITLE}"><option value="">All campuses</option>${values.map(v => `<option>${esc(v)}</option>`).join('')}</select>${badge()}</span>`);
      rank.parentNode.insertBefore(wrap, rank);
      $('testing-only-campus').addEventListener('change', e => { state.campus = e.target.value; try { hooks() && hooks().renderLookup(); } catch (_) {} });
      $('lookup-reset')?.addEventListener('click', () => { state.campus = ''; $('testing-only-campus').value = ''; });
    }
    root.UCVM_TESTING_ONLY.keepFaculty = row => !state.campus || campuses.get(String(row.ucid || '')) === state.campus;

    // Lookup: Import Away from Campus
    const lookupToolbar = $('lookup-search') && $('lookup-search').closest('.toolbar');
    if (lookupToolbar && !$('testing-only-afc-import-btn')) {
      lookupToolbar.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn-secondary testing-only-admin hidden" id="testing-only-afc-import-btn">Import Away from Campus${badge()}</button>`);
      $('testing-only-afc-import-btn').addEventListener('click', openAfcImport);
    }

    // Teaching Summary: Teaching Data Synchronization / Import Legacy Workload DOE Breakdown
    const summaryToolbar = $('summary-search') && $('summary-search').closest('.toolbar');
    if (summaryToolbar && !$('testing-only-teaching-sync-btn')) {
      summaryToolbar.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn-secondary testing-only-admin hidden" id="testing-only-teaching-sync-btn">Teaching Data Synchronization${badge()}</button>
        <button type="button" class="btn btn-secondary testing-only-admin hidden" id="testing-only-legacy-doe-btn">Import Legacy Workload DOE Breakdown${badge()}</button>`);
      $('testing-only-teaching-sync-btn').addEventListener('click', openTeachingSync);
      $('testing-only-legacy-doe-btn').addEventListener('click', openLegacyDoeImport);
    }

    // New tabs
    const nav = doc.querySelector('nav.tabs');
    const firstPanel = $('lookup-view');
    const TABS = [
      ['t-sessional', 'Sessional / Other', renderSessional],
      ['t-doe-reconciliation', 'DOE Reconciliation', renderReconciliation],
      ['t-faculty-database', 'Faculty Database', renderFacultyDatabase],
      ['t-data-health', 'Derived Index Health', renderDataHealth]
    ];
    if (nav && firstPanel && !nav.querySelector('[data-tab="t-sessional"]')) {
      for (const [key, label, render] of TABS) {
        const button = el(`<button class="tab testing-only-admin hidden" type="button" data-tab="${key}">${esc(label)}${badge()}</button>`);
        nav.appendChild(button);
        const panel = el(`<section id="${key}-view" class="panel hidden testing-only-panel" aria-label="${esc(label)}"></section>`);
        firstPanel.parentNode.appendChild(panel);
        button.addEventListener('click', event => {
          event.stopImmediatePropagation();
          nav.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
          firstPanel.parentNode.querySelectorAll(':scope > section.panel').forEach(section => section.classList.toggle('hidden', section !== panel));
          render(panel);
        });
      }
      nav.addEventListener('click', event => {
        const tab = event.target.closest('.tab');
        if (tab && !String(tab.dataset.tab || '').startsWith('t-')) TABS.forEach(([key]) => $(key + '-view')?.classList.add('hidden'));
      });
    }

    // Show admin-only pieces once the user is known.
    let tries = 0;
    const timer = setInterval(() => {
      const user = hooks() && hooks().currentUser();
      if (!user && ++tries < 120) return;
      clearInterval(timer);
      const admin = ADMIN_ROLES.has(roleOf(user));
      doc.querySelectorAll('.testing-only-admin').forEach(node => node.classList.toggle('hidden', !admin));
    }, 250);
  }

  async function facultyRoster() {
    const { faculty = [] } = await api('/api/v1/dashboard/faculty');
    return faculty;
  }
  function facultyResolver(faculty) {
    const byUcid = new Map(faculty.map(f => [String(f.ucid), f]));
    const byEmail = new Map(faculty.map(f => [String(f.email).toLowerCase(), f]));
    const byName = new Map();
    faculty.forEach(f => { byName.set(String(f.displayName).toLowerCase(), f); byName.set(`${f.preferredLastName}, ${f.preferredFirstName}`.toLowerCase(), f); });
    return value => { const v = String(value || '').trim().toLowerCase(); return byUcid.get(v) || byEmail.get(v) || byName.get(v) || null; };
  }

  function importDialog({ title, help, template, templateName, onPreview, onImport }) {
    const body = openPanel(title, { wide: true });
    body.innerHTML = `<p>${help}</p><div class="testing-only-row"><input type="file" accept=".csv,text/csv" id="testing-only-file"><button type="button" class="testing-only-btn" id="testing-only-template">Download template</button>
      <button type="button" class="testing-only-btn" id="testing-only-preview">Preview</button><button type="button" class="testing-only-btn primary" id="testing-only-import" disabled>Import</button></div>
      <div class="testing-only-status" id="testing-only-import-status"></div><div id="testing-only-import-preview"></div>`;
    let prepared = null;
    const status = (message, error) => { const node = $('testing-only-import-status'); node.textContent = message; node.classList.toggle('is-error', !!error); };
    $('testing-only-template').onclick = () => download(templateName, template, 'text/csv');
    $('testing-only-preview').onclick = async () => {
      try {
        status('Reading file…');
        prepared = await onPreview(parseCsv(await readFile($('testing-only-file'))));
        $('testing-only-import-preview').innerHTML = prepared.html; status(prepared.message, prepared.errors > 0); $('testing-only-import').disabled = !prepared.ready;
      } catch (error) { prepared = null; status(error.message, true); $('testing-only-import').disabled = true; }
    };
    $('testing-only-import').onclick = async () => {
      if (!prepared || !prepared.ready) return;
      $('testing-only-import').disabled = true; status('Importing…');
      try { status(await onImport(prepared)); toast('Import finished.'); }
      catch (error) { status(error.message, true); $('testing-only-import').disabled = false; }
    };
  }
  const checkCell = r => (r.problem ? pill(r.problem, 'bad') : pill('OK', 'good'));
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);

  function openAfcImport() {
    importDialog({
      title: 'Import Away from Campus', templateName: 'away-from-campus-template.csv',
      template: 'faculty,start date,end date,purpose\n30001001,2026-11-16,2026-11-20,Conference\n',
      help: 'Upload a CSV with columns <strong>faculty</strong> (UCID, email or name), <strong>start date</strong>, <strong>end date</strong> and <strong>purpose</strong>. Rows are saved as AFC records.',
      async onPreview(rows) {
        const resolve = facultyResolver(await facultyRoster());
        const out = rows.map((row, i) => {
          const who = resolve(pick(row, 'faculty', 'ucid', 'email', 'name'));
          const startDate = pick(row, 'startdate', 'start'), endDate = pick(row, 'enddate', 'end') || startDate, purpose = pick(row, 'purpose', 'reason', 'notes');
          const problem = !who ? 'Faculty not found' : !isDate(startDate) || !isDate(endDate) ? 'Dates must be YYYY-MM-DD' : endDate < startDate ? 'End is before start' : '';
          return { line: i + 2, who, startDate, endDate, purpose, problem };
        });
        const errors = out.filter(r => r.problem).length;
        return { rows: out, errors, ready: out.length > 0 && !errors, message: `${out.length} rows read, ${errors} with problems.`, html: table([
          { label: 'Line', value: r => r.line }, { label: 'Faculty', value: r => (r.who ? r.who.displayName : '—') }, { label: 'Start', value: r => r.startDate },
          { label: 'End', value: r => r.endDate }, { label: 'Purpose', value: r => r.purpose }, { label: 'Check', html: checkCell }
        ], out) };
      },
      async onImport(prepared) {
        const result = await api('/api/v1/dashboard/afc-records/batch', { method: 'POST', body: { requestId: uuid(), rows: prepared.rows.map(r => ({ facultyId: r.who.facultyId, startDate: r.startDate, endDate: r.endDate, purpose: r.purpose })) } });
        return `${(result.rows || prepared.rows).length} Away from Campus records saved. They show in AFC Records and on the timetable.`;
      }
    });
  }

  function openTeachingSync() {
    importDialog({
      title: 'Teaching Data Synchronization', templateName: 'teaching-sessions-template.csv',
      template: 'year,course,type,date,start,end,topic,room,faculty\n1,VTMD 206,LEC,2026-11-17,10:00,10:50,Synchronized lecture,HSB 1403,30001001\n',
      help: 'Upload teaching sessions as CSV with columns <strong>year, course, type, date, start, end, topic, room, faculty</strong> (faculty: UCID, email or name; separate several with ";"). New sessions are added to the timetable.',
      async onPreview(rows) {
        const resolve = facultyResolver(await facultyRoster());
        const out = rows.map((row, i) => {
          const names = String(pick(row, 'faculty', 'instructor', 'instructors')).split(';').map(x => x.trim()).filter(Boolean);
          const faculty = names.map(resolve);
          const r = { line: i + 2, year: pick(row, 'year', 'curriculumyear'), course: pick(row, 'course', 'coursecode'), type: pick(row, 'type', 'sessiontype').toUpperCase(), date: pick(row, 'date'), start: hhmm(pick(row, 'start', 'starttime')), end: hhmm(pick(row, 'end', 'endtime')), topic: pick(row, 'topic'), room: pick(row, 'room'), names, faculty };
          r.problem = !/^[1-4]$/.test(r.year) ? 'Year must be 1–4' : !r.course ? 'Course is required' : !r.type ? 'Type is required' : !isDate(r.date) ? 'Date must be YYYY-MM-DD'
            : !/^\d{2}:\d{2}$/.test(r.start) || !/^\d{2}:\d{2}$/.test(r.end) || r.end <= r.start ? 'Check start/end time' : faculty.some(f => !f) ? 'Faculty not found' : '';
          return r;
        });
        const errors = out.filter(r => r.problem).length;
        return { rows: out, errors, ready: out.length > 0 && !errors, message: `${out.length} sessions read, ${errors} with problems.`, html: table([
          { label: 'Line', value: r => r.line }, { label: 'Year', value: r => r.year }, { label: 'Course', value: r => r.course }, { label: 'Type', value: r => r.type },
          { label: 'Date', value: r => r.date }, { label: 'Time', value: r => `${r.start}–${r.end}` }, { label: 'Topic', value: r => r.topic },
          { label: 'Faculty', value: r => r.faculty.map((f, k) => (f ? f.displayName : r.names[k] + ' (?)')).join('; ') }, { label: 'Check', html: checkCell }
        ], out) };
      },
      async onImport(prepared) {
        const sessions = prepared.rows.map(r => ({ academicYear: ACADEMIC_YEAR, curriculumYear: r.year, courseCode: r.course, sessionType: r.type, date: r.date, startTime: r.start, endTime: r.end, topic: r.topic, room: r.room || null, assignments: r.faculty.map(f => ({ facultyId: f.facultyId, teachingRole: r.type === 'LAB' ? 'Lab Primary' : 'Lecture' })) }));
        const result = await api('/api/v1/sessions/batch', { method: 'POST', body: { requestId: uuid(), sessions } });
        return `${(result.sessions || []).length} sessions added to the timetable. DOE was recalculated for the faculty involved.`;
      }
    });
  }

  function openLegacyDoeImport() {
    const ROLES = ['Course Coordinator', 'HICC', 'VISC', 'Course Coordinator / HICC', 'Rotation / Week Lead', 'CCC', 'Trainee / Supervision', 'Special Project', 'Other'];
    importDialog({
      title: 'Import Legacy Workload DOE Breakdown', templateName: 'legacy-doe-breakdown-template.csv',
      template: 'faculty,role type,scope,doe,notes\n30001001,Special Project,Curriculum review 2026-27,2.5,From legacy workload sheet\n',
      help: `Upload the legacy DOE breakdown as CSV with columns <strong>faculty, role type, scope, doe, notes</strong>. Each row becomes a manual DOE adjustment for ${ACADEMIC_YEAR}. Role type must be one of: ${ROLES.map(esc).join(', ')}.`,
      async onPreview(rows) {
        const resolve = facultyResolver(await facultyRoster());
        const out = rows.map((row, i) => {
          const raw = pick(row, 'doe', 'doevalue', 'value');
          const r = { line: i + 2, who: resolve(pick(row, 'faculty', 'ucid', 'name', 'email')), roleType: ROLES.find(x => x.toLowerCase() === pick(row, 'roletype', 'role').toLowerCase()) || '', scope: pick(row, 'scope', 'scopetext', 'description'), doe: raw === '' ? NaN : Number(raw), notes: pick(row, 'notes') };
          r.problem = !r.who ? 'Faculty not found' : !r.roleType ? 'Unknown role type' : !r.scope ? 'Scope is required' : !Number.isFinite(r.doe) ? 'DOE must be a number' : r.doe < 0 && !r.notes ? 'Negative DOE needs notes' : '';
          return r;
        });
        const errors = out.filter(r => r.problem).length;
        return { rows: out, errors, ready: out.length > 0 && !errors, message: `${out.length} rows read, ${errors} with problems.`, html: table([
          { label: 'Line', value: r => r.line }, { label: 'Faculty', value: r => (r.who ? r.who.displayName : '—') }, { label: 'Role type', value: r => r.roleType },
          { label: 'Scope', value: r => r.scope }, { label: 'DOE %', value: r => r.doe }, { label: 'Check', html: checkCell }
        ], out) };
      },
      async onImport(prepared) {
        let saved = 0; const failed = [];
        for (const r of prepared.rows) {
          try {
            await api('/api/v1/doe/manual-assignments', { method: 'POST', body: { facultyId: r.who.facultyId, academicYear: ACADEMIC_YEAR, expectedRevision: 0, roleType: r.roleType, scopeText: r.scope, doeValue: r.doe, notes: r.notes, requestId: uuid() } });
            saved++;
          } catch (error) { failed.push(`Line ${r.line}: ${error.message}`); }
        }
        if (failed.length) throw new Error(`${saved} saved. Not saved:\n${failed.join('\n')}`);
        return `${saved} manual DOE adjustments saved. Open a faculty member's DOE worksheet to see them.`;
      }
    });
  }

  function panelShell(panel, title, note) {
    panel.innerHTML = `<h2>${esc(title)} ${badge()}</h2><p class="testing-only-note">Testing site only. ${note}</p><div class="testing-only-panel-body">Loading…</div>`;
    return panel.querySelector('.testing-only-panel-body');
  }

  async function renderSessional(panel) {
    const out = panelShell(panel, 'Sessional / Other', 'Faculty who are not on a regular professor appointment, plus inactive records.');
    try {
      let all; try { all = (await api('/api/v1/dashboard/faculty?status=all')).faculty || []; } catch (_) { all = await facultyRoster(); }
      const rows = all.filter(f => /sessional|instructor|other/i.test(`${f.rank} ${f.recordType}`) || f.recordType !== 'Faculty' || !f.active);
      out.innerHTML = table([
        { label: 'Name', value: r => r.displayName }, { label: 'UCID', value: r => r.ucid }, { label: 'Rank', value: r => r.rank }, { label: 'Record type', value: r => r.recordType },
        { label: 'FTE', value: r => r.fte }, { label: 'Sessions', value: r => r.sessionCount }, { label: 'Status', html: r => pill(r.active ? 'Active' : 'Inactive', r.active ? 'good' : '') }
      ], rows, 'No sessional or other faculty.');
    } catch (error) { failure(out, error); }
  }

  async function renderReconciliation(panel) {
    const out = panelShell(panel, 'DOE Reconciliation', `Compares the legacy (old testing site) Assigned Teaching DOE with the PAWS server worksheet for ${ACADEMIC_YEAR}.`);
    try {
      const [faculty, sheets] = await Promise.all([facultyRoster(), api(`/api/v1/doe/worksheets?academicYear=${ACADEMIC_YEAR}`)]);
      const legacy = new Map(legacySeed().filter(d => d.path.startsWith('faculty/')).map(d => [String(d.data.ucid), d.data]));
      const byId = new Map(faculty.map(f => [f.facultyId, f]));
      const seen = new Set(), rows = [];
      for (const w of sheets.worksheets || []) {
        const f = byId.get(w.facultyId) || {}, old = legacy.get(String(f.ucid));
        seen.add(String(f.ucid));
        const legacyDoe = old && old.facultySummary2026_27 ? Number(old.facultySummary2026_27.assignedTeachingDOE) : null;
        const serverDoe = Number(w.assignedTeachingDoe);
        let status = 'Matched';
        if (legacyDoe === null) status = 'Server Only';
        else if (Number(w.missingMappingCount) > 0) status = 'Missing Mapping';
        else if (w.status === 'needs_review') status = 'Needs Review';
        else if (Math.abs(legacyDoe - serverDoe) > 0.01) status = 'DOE Difference';
        rows.push({ name: w.displayName, ucid: f.ucid || '', legacyDoe, serverDoe, diff: legacyDoe === null ? null : serverDoe - legacyDoe, status, issues: (w.issueCodes || []).join(', ') });
      }
      for (const [ucid, data] of legacy) {
        if (!seen.has(ucid)) rows.push({ name: `${data.firstName} ${data.lastName}`, ucid, legacyDoe: Number(data.facultySummary2026_27 && data.facultySummary2026_27.assignedTeachingDOE), serverDoe: null, diff: null, status: 'Legacy Only', issues: '' });
      }
      const tone = { Matched: 'good', 'DOE Difference': 'bad', 'Missing Mapping': 'bad', 'Needs Review': 'warn', 'Legacy Only': 'warn', 'Server Only': 'warn' };
      const counts = Object.keys(tone).map(k => `${pill(k, tone[k])} ${rows.filter(r => r.status === k).length}`).join(' &nbsp; ');
      out.innerHTML = `<p>${counts}</p>${legacy.size ? '' : '<p class="testing-only-status is-error">Legacy DOE data is not available here.</p>'}` + table([
        { label: 'Faculty', value: r => r.name }, { label: 'UCID', value: r => r.ucid }, { label: 'Legacy DOE %', value: r => (r.legacyDoe === null ? '—' : num(r.legacyDoe)) },
        { label: 'Server DOE %', value: r => (r.serverDoe === null ? '—' : num(r.serverDoe)) }, { label: 'Difference', value: r => (r.diff === null ? '—' : num(r.diff)) },
        { label: 'Status', html: r => pill(r.status, tone[r.status]) }, { label: 'Issues', value: r => r.issues }
      ], rows.sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name)));
    } catch (error) { failure(out, error); }
  }

  async function renderFacultyDatabase(panel) {
    panel.innerHTML = `<h2>Faculty Database ${badge()}</h2><p class="testing-only-note">Testing site only. The full Faculty table with add, import and export.</p>
      <div class="testing-only-row"><input type="search" id="testing-only-fdb-search" placeholder="Search name, UCID, email…">
      <button type="button" class="testing-only-btn primary" id="testing-only-fdb-add">+ Add Faculty</button>
      <label class="testing-only-btn">Import JSON<input type="file" accept=".json,application/json" id="testing-only-fdb-import" hidden></label>
      <button type="button" class="testing-only-btn" id="testing-only-fdb-json">Export JSON</button><button type="button" class="testing-only-btn" id="testing-only-fdb-csv">Export CSV</button></div>
      <div class="testing-only-status" id="testing-only-fdb-status"></div><div id="testing-only-fdb-table">Loading…</div>`;
    const status = (m, e) => { const n = $('testing-only-fdb-status'); n.textContent = m; n.classList.toggle('is-error', !!e); };
    const FIELDS = ['displayName', 'preferredFirstName', 'preferredLastName', 'ucid', 'email', 'rank', 'recordType', 'stream', 'fte', 'teachingArea', 'professionalCategory', 'reportsToName', 'active', 'sessionCount', 'roleCount', 'afcCount'];
    let faculty = [];
    const draw = () => {
      const q = String($('testing-only-fdb-search').value || '').toLowerCase();
      const rows = faculty.filter(f => !q || `${f.displayName} ${f.ucid} ${f.email} ${f.rank}`.toLowerCase().includes(q));
      $('testing-only-fdb-table').innerHTML = table([
        { label: 'Name', value: r => r.displayName }, { label: 'UCID', value: r => r.ucid }, { label: 'Email', value: r => r.email }, { label: 'Rank', value: r => r.rank },
        { label: 'Record type', value: r => r.recordType }, { label: 'FTE', value: r => r.fte }, { label: 'Teaching area', value: r => r.teachingArea }, { label: 'Reports to', value: r => r.reportsToName || '' },
        { label: 'Status', html: r => pill(r.active ? 'Active' : 'Inactive', r.active ? 'good' : '') },
        { label: '', html: r => `<button type="button" class="testing-only-btn" data-fdb-toggle="${esc(r.facultyId)}" data-active="${r.active ? '1' : '0'}" data-updated="${esc(r.updatedAtUtc)}">${r.active ? 'Deactivate' : 'Restore'}</button>` }
      ], rows, 'No faculty match.');
    };
    const load = async () => {
      try { faculty = (await api('/api/v1/dashboard/faculty?status=all')).faculty || []; } catch (_) { faculty = await facultyRoster(); }
      faculty.sort((a, b) => String(a.preferredLastName).localeCompare(String(b.preferredLastName))); draw();
    };
    panel.addEventListener('input', event => { if (event.target.id === 'testing-only-fdb-search') draw(); });
    panel.addEventListener('click', async event => {
      const toggle = event.target.closest('[data-fdb-toggle]');
      if (toggle) {
        const action = toggle.dataset.active === '1' ? 'deactivate' : 'restore';
        if (action === 'deactivate' && !root.confirm('Deactivate this Faculty record?')) return;
        try {
          await api(`/api/v1/dashboard/faculty/${encodeURIComponent(toggle.dataset.fdbToggle)}/${action}`, { method: 'POST', body: { expectedUpdatedAtUtc: toggle.dataset.updated, confirm: true } });
          status(`Faculty ${action === 'deactivate' ? 'deactivated' : 'restored'}.`); await load();
        } catch (error) { status(error.message, true); }
      }
      if (event.target.id === 'testing-only-fdb-json') download('faculty-database.json', JSON.stringify(faculty.map(f => Object.fromEntries(FIELDS.map(k => [k, f[k]]))), null, 2), 'application/json');
      if (event.target.id === 'testing-only-fdb-csv') download('faculty-database.csv', [FIELDS.join(','), ...faculty.map(f => FIELDS.map(k => csvCell(f[k])).join(','))].join('\n'), 'text/csv');
      if (event.target.id === 'testing-only-fdb-add') openAddFaculty(load);
    });
    panel.addEventListener('change', async event => {
      if (event.target.id !== 'testing-only-fdb-import') return;
      try {
        const rows = JSON.parse(await readFile(event.target)); event.target.value = '';
        if (!Array.isArray(rows)) throw new Error('The JSON file must contain a list of faculty.');
        const demo = root.UCVM_PAWS_DEMO_API && root.UCVM_PAWS_DEMO_API.testingOnly;
        let added = 0, skipped = 0; const problems = [];
        for (const row of rows) {
          if (faculty.some(f => String(f.ucid) === String(row.ucid))) { skipped++; continue; }
          if (!demo) { problems.push(`${row.ucid}: adding Faculty needs the testing site's sample data`); continue; }
          try { demo.addFaculty(row, root.firebase.auth().currentUser.uid); added++; } catch (error) { problems.push(`${row.ucid || '?'}: ${error.message}`); }
        }
        status(`${added} added, ${skipped} already existed (left unchanged).${problems.length ? '\n' + problems.join('\n') : ''}`, problems.length > 0);
        await load();
      } catch (error) { status(error.message, true); }
    });
    try { await load(); } catch (error) { status(error.message, true); }
  }

  function openAddFaculty(onSaved) {
    const body = openPanel('Add Faculty');
    const demo = root.UCVM_PAWS_DEMO_API && root.UCVM_PAWS_DEMO_API.testingOnly;
    body.innerHTML = `<p>On PAWS, Faculty records come from HR, so beta has no "Add Faculty". On the testing site this adds a sample record.</p>
      <form id="testing-only-add-form"><div class="testing-only-row"><input name="preferredFirstName" placeholder="First name" required><input name="preferredLastName" placeholder="Last name" required><input name="ucid" placeholder="UCID (8 digits)" required pattern="\\d{8}"></div>
      <div class="testing-only-row"><input name="email" type="email" placeholder="Email"><select name="rank"><option>Assistant Professor</option><option>Associate Professor</option><option>Professor</option><option>Sessional</option></select>
      <input name="fte" type="number" step="0.1" min="0" max="1" placeholder="FTE" value="1"><input name="contractTeachingDoe" type="number" step="0.5" min="0" max="100" placeholder="Teaching DOE %" value="40"></div>
      <div class="testing-only-row"><input name="teachingArea" placeholder="Teaching area"><button class="testing-only-btn primary" type="submit"${demo ? '' : ' disabled'}>Save</button></div></form>
      <div class="testing-only-status" id="testing-only-add-status">${demo ? '' : 'Adding Faculty needs the testing site sample data.'}</div>`;
    $('testing-only-add-form').addEventListener('submit', async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      try { const saved = demo.addFaculty(data, root.firebase.auth().currentUser.uid); closePanel(); toast(`${saved.displayName} added.`); if (onSaved) await onSaved(); }
      catch (error) { const n = $('testing-only-add-status'); n.textContent = error.message; n.classList.add('is-error'); }
    });
  }

  async function renderDataHealth(panel) {
    panel.innerHTML = `<h2>Derived Index Health ${badge()}</h2><p class="testing-only-note">Testing site only. On the old site this checked the Firestore summary indexes. PAWS keeps its data in SQL, so here the same check confirms that the summary numbers agree with the underlying records.</p>
      <div class="testing-only-row"><button type="button" class="testing-only-btn primary" id="testing-only-health-verify">Verify</button><button type="button" class="testing-only-btn" id="testing-only-health-rebuild">Rebuild (recalculate DOE)</button></div>
      <div class="testing-only-status" id="testing-only-health-status">Not checked yet.</div><div id="testing-only-health-table"></div>`;
    const status = (m, e) => { const n = $('testing-only-health-status'); n.textContent = m; n.classList.toggle('is-error', !!e); };
    async function verify() {
      status('Checking…');
      const [faculty, sessions, sheets] = await Promise.all([
        facultyRoster(), api(`/api/v1/sessions?start=${YEAR_RANGE.start}&end=${YEAR_RANGE.end}`), api(`/api/v1/doe/worksheets?academicYear=${ACADEMIC_YEAR}`)
      ]);
      const active = faculty.filter(f => f.active);
      const list = sessions.sessions || [], works = sheets.worksheets || [];
      const linkCount = list.reduce((n, x) => { try { return n + JSON.parse(x.assignmentsJson || '[]').filter(a => active.some(f => f.facultyId === a.facultyId)).length; } catch (_) { return n; } }, 0);
      const checks = [
        { name: 'Faculty session links (sessions vs Faculty summary)', expected: linkCount, actual: active.reduce((n, f) => n + Number(f.sessionCount || 0), 0) },
        { name: 'DOE worksheets for active Faculty', expected: active.length, actual: works.filter(w => active.some(f => f.facultyId === w.facultyId)).length },
        { name: 'Sessions with no faculty', expected: 0, actual: list.filter(x => !x.instructorNames).length, warnOnly: true },
        { name: 'Worksheets needing review', expected: 0, actual: works.filter(w => w.status === 'needs_review').length, warnOnly: true }
      ];
      const bad = checks.filter(c => c.expected !== c.actual && !c.warnOnly).length, warn = checks.filter(c => c.expected !== c.actual && c.warnOnly).length;
      $('testing-only-health-table').innerHTML = table([
        { label: 'Check', value: c => c.name }, { label: 'Expected', value: c => c.expected }, { label: 'Found', value: c => c.actual },
        { label: 'Result', html: c => (c.expected === c.actual ? pill('HEALTHY', 'good') : pill(c.warnOnly ? 'REVIEW' : 'MISMATCH', c.warnOnly ? 'warn' : 'bad')) }
      ], checks);
      status(`${bad ? 'MISMATCH' : warn ? 'HEALTHY (some items to review)' : 'HEALTHY'} · checked ${new Date().toLocaleString('en-CA')}`, bad > 0);
    }
    panel.addEventListener('click', async event => {
      try {
        if (event.target.id === 'testing-only-health-verify') await verify();
        if (event.target.id === 'testing-only-health-rebuild') {
          status('Recalculating DOE…');
          await api('/api/v1/doe/recalculate', { method: 'POST', body: { academicYear: ACADEMIC_YEAR, requestId: uuid() } });
          await verify(); toast('DOE recalculated.');
        }
      } catch (error) { status(error.message, true); }
    });
  }

  // ---------------------------------------------------------------- Password
  function mountPassword() {
    const form = doc.querySelector('form');
    if (!form || $('testing-only-reset-section')) return;
    const section = el(`<section class="testing-only-section" id="testing-only-reset-section"><h3>Forgot your password? ${badge()}</h3>
      <p>Send a password reset link by email. On beta only an administrator can send a reset.</p>
      <form id="testing-only-reset-form" class="testing-only-row"><input type="email" id="testing-only-reset-email" placeholder="Your UCalgary email" required>
      <button class="testing-only-btn primary" type="submit">Email me a reset link</button></form><div class="testing-only-status" id="testing-only-reset-status"></div></section>`);
    form.parentNode.insertBefore(section, form.nextSibling);
    const fill = () => { const user = root.firebase && root.firebase.auth && root.firebase.auth().currentUser; if (user && user.email && !$('testing-only-reset-email').value) $('testing-only-reset-email').value = user.email; };
    fill(); setTimeout(fill, 1500);
    $('testing-only-reset-form').addEventListener('submit', async event => {
      event.preventDefault();
      const email = $('testing-only-reset-email').value.trim(), out = $('testing-only-reset-status');
      try {
        const auth = root.firebase.auth();
        const demo = root.UCVM_FRONTEND_DEMO_MODE === true || !!root.UCVM_PAWS_DEMO_API;
        if (!demo) await auth.sendPasswordResetEmail(email);
        out.textContent = demo ? `Demo: a reset link would be sent to ${email}. The testing site does not send real emails.` : `If ${email} has an account, a reset link is on its way.`;
        out.classList.remove('is-error');
      } catch (error) { out.textContent = error.message || 'The reset email could not be sent.'; out.classList.add('is-error'); }
    });
  }

  // -------------------------------------------------------------------- start
  root.UCVM_TESTING_ONLY = {
    selectSessions: true,
    keepSession: s => state.showCcc || !s.isCcc,
    allSemesters: viewMode => state.allSemesters && viewMode !== 'week' && viewMode !== 'day',
    calendarRows: rows => (state.showClosures ? rows.concat(closureRows()) : rows),
    keepFaculty: null
  };

  function start() {
    installStyle();
    try {
      if ($('calendar-body')) mountTimetable();
      if ($('lookup-view')) mountFacultyDashboard();
      if (/password\.html$/.test(String(root.location && root.location.pathname || ''))) mountPassword();
    } catch (error) { console.error('[testing-only]', error); }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : null);
