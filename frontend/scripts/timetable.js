(() => {
  'use strict';

  const scheduling=window.UCVM_SCHEDULING,approvalScheduling=window.UCVM_APPROVAL_SCHEDULING;
  if(!scheduling||!approvalScheduling)throw new Error('UCVM scheduling core and approval policy are required.');

  const SESSION_COLLECTION = 'sessions';
  const SESSION_LOG_COLLECTION = 'session_change_log';
  const SPRING_BASE_MONDAY = new Date(2026, 3, 27);
  const FALL_BASE_MONDAY = new Date(2026, 7, 24);
  const WINTER_BASE_MONDAY = new Date(2027, 0, 4);
  const WEEK_COUNT = 17;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const SQL_SESSION_EDIT_ROLES = new Set(['developer','owner','administrator','adfa_general','adfa_regular','admin']);

  // Calendar search responsiveness. calendar-search.js is published before this
  // file and provides three primitives: a trailing-edge debounce for the search
  // field, a user/range/faculty-scoped cache for Working Activity rows, and one
  // delegated session click listener. When the module is absent the page keeps
  // the previous immediate-render behaviour, so a stale cached script cannot
  // turn the filter box into a dead input.
  const calendarSearch = window.UCVM_CALENDAR_SEARCH || null;
  const workingActivityCache = calendarSearch
    ? calendarSearch.createActivityCache({ ttlMs: calendarSearch.ACTIVITY_CACHE_TTL_MS })
    : null;
  const searchDebouncer = calendarSearch
    ? calendarSearch.createDebouncer({ delay: calendarSearch.SEARCH_DEBOUNCE_MS, invoke: () => render() })
    : null;
  // Calendar activity writers (imports, replacements) can announce themselves;
  // rows already in memory must never survive a confirmed change.
  window.addEventListener('ucvm:calendar-activities-updated', () => {resetWorkingCalendar();if(currentUser)render();});


  // Firebase Web configuration is public by design. This local harness uses the
  // separate Tester Teaching project for REAL Authentication and REAL role lookup.
  // Firebase Authentication remains live. Timetable session reads come from the same-origin PAWS University API backed by VetMed-Ops; no bundled timetable data is shipped with this page.
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDS9VE2zTXv0656_Mh0uDXB67-mZ5Y_LkY",
    authDomain: "tester-teaching.firebaseapp.com",
    projectId: "tester-teaching",
    storageBucket: "tester-teaching.firebasestorage.app",
    messagingSenderId: "566638053186",
    appId: "1:566638053186:web:90e04b52251c4b859baadb",
    measurementId: "G-F7HW5XX4JE"
  };
  const AUTH_SETTINGS_KEY = 'ucvm_email_phone_role_settings_v6';
  const DEFAULT_AUTH_SETTINGS = {
    allowedDomain: 'ucalgary.ca',
    allowedPhones: '',
    instructorAlias: 'Faculty 001'
  };
  let authSettings = loadAuthSettings();
  let auth = null;
  let db = null;
  let authInitialized = false;
  let recaptchaVerifier = null;
  let phoneConfirmation = null;
  let emailLoginInFlight = false;
  let phoneSendInFlight = false;
  let phoneVerifyInFlight = false;
  let interactiveLoginMethod = null;

  function loginPerformance() {
    return window.UCVM_LOGIN_PERFORMANCE || null;
  }
  function beginInteractiveLogin(method) {
    interactiveLoginMethod = method;
    const perf = loginPerformance();
    if (perf) {
      perf.begin({ method, flow: 'interactive' });
      markLoginStage('T1');
    }
  }
  function ensureRestoredLoginPerformance() {
    const perf = loginPerformance();
    const current = perf?.snapshot?.();
    if (!perf || (current && current.status === 'active')) return;
    perf.begin({ method: 'firebase', flow: 'restored-session' });
  }
  function markLoginStage(stage) {
    const perf = loginPerformance();
    if (!perf) return;
    try { perf.mark(stage); } catch (error) { console.warn('[login performance]', error); }
  }
  function failLoginPerformance(kind) {
    const perf = loginPerformance();
    if (!perf) return;
    try { perf.fail({ kind: kind || 'unknown' }); } catch (error) { console.warn('[login performance]', error); }
  }
  function setLoginProgress(message, active = true) {
    for (const id of ['email-login-status', 'phone-login-status', 'phone-code-status']) {
      const status = $(id);
      if (!status) continue;
      status.textContent = message || '';
      status.dataset.active = active ? 'true' : 'false';
    }
  }
  function settleInteractiveLogin(success) {
    emailLoginInFlight = false;
    phoneVerifyInFlight = false;
    const emailSubmit = $('email-login-submit');
    const phoneVerify = $('phone-verify-submit');
    if (emailSubmit) emailSubmit.disabled = false;
    if (phoneVerify) phoneVerify.disabled = false;
    if (success) {
      const perf = loginPerformance();
      if (perf) {
        try { perf.complete(); } catch (error) { console.warn('[login performance]', error); }
      }
    }
    interactiveLoginMethod = null;
  }

  function loadAuthSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_SETTINGS_KEY) || '{}');
      return { ...DEFAULT_AUTH_SETTINGS, ...saved };
    } catch (_) {
      return { ...DEFAULT_AUTH_SETTINGS };
    }
  }
  function saveAuthSettings(next) {
    authSettings = { ...DEFAULT_AUTH_SETTINGS, ...next };
    try { localStorage.setItem(AUTH_SETTINGS_KEY, JSON.stringify(authSettings)); } catch (_) {}
  }
  function parsePhoneList(value) {
    return String(value || '')
      .split(/[;,\n]+/)
      .map(x => x.replace(/\D/g, ''))
      .filter(Boolean);
  }
  function parseAllowedPhones() { return parsePhoneList(authSettings.allowedPhones); }
  function isAllowedEmail(email) {
    const domain = String(authSettings.allowedDomain || '').trim().toLowerCase().replace(/^@/, '');
    if (!domain) return true;
    return String(email || '').toLowerCase().endsWith('@' + domain);
  }
  function isAllowedPhone(phone) {
    const normalized = String(phone || '').replace(/\D/g, '');
    const allowed = parseAllowedPhones();
    if (!allowed.length) return true;
    return allowed.includes(normalized);
  }
  function normalizePhoneForFirebase(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (raw.startsWith('+')) return '+' + digits;
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
    return '+' + digits;
  }

  function setAppLocked(locked, status) {
    document.body.classList.toggle('auth-locked', !!locked);
    const gateStatus = $('gate-status');
    if (gateStatus && status) gateStatus.textContent = status;
  }

  // BETA-R4D-12B2A1 — bounded recovery affordance. Shows a single "Retry access"
  // action for recoverable failures. It reruns authorization/bootstrap only; it never
  // asks for credentials again, never polls, and never forces repeated token refreshes.
  function setAccessRecovery(action) {
    const button = $('gate-retry-access');
    if (!button) return;
    const enabled = typeof action === 'function';
    button.classList.toggle('hidden', !enabled);
    button.onclick = enabled
      ? async () => { button.disabled = true; try { await action(); } finally { button.disabled = false; } }
      : null;
  }

  // BETA-R4D-12B2A1 — a failed access bootstrap is classified, never fatal to the
  // Firebase session.
  //
  // AUTHENTICATION SESSION != API AVAILABILITY, and
  // AUTHENTICATION SESSION != APPLICATION AUTHORIZATION RESULT.
  //
  // So a cold start, a 503/SQL_UNAVAILABLE, a network error or an authorization
  // denial leaves the Firebase login intact and the protected timetable closed.
  // Only explicit identity-policy failures (handled before this point) sign out.
  async function applyAccessFailure(error, hooks) {
    const outcome = window.UCVM_AUTH_CONTINUITY.classifyAuthError(error);
    hooks.setLocked(true, outcome.message);
    hooks.setRecovery(outcome.recoverable ? hooks.retryAccess : null);
    hooks.toast(outcome.message, true);
    hooks.setStatus('Firebase Auth + SQL Access Ready');
    return outcome;
  }

  function shouldAutoRetryAccess(outcome, attempt, sameUser) {
    return Boolean(outcome?.recoverable && attempt === 0 && sameUser === true);
  }

  function waitForAccessRetry() {
    return new Promise(resolve => setTimeout(resolve, 1500));
  }

  function showSessionRestoreGate(){
    const copy=$('gate-copy');if(copy)copy.textContent='Restoring your PAWS session…';
    $('gate-sign-in')?.classList.add('hidden');$('gate-auth-setup')?.classList.add('hidden');
  }
  function showSignedOutGate(){
    const copy=$('gate-copy');if(copy)copy.textContent='Sign in with your authorized UCVM account to continue.';
    $('gate-sign-in')?.classList.remove('hidden');$('gate-auth-setup')?.classList.remove('hidden');
  }
  function prefetchDashboardShell(){
    const assets=[['faculty-admin.html','document'],['faculty-admin.css','style'],['faculty-admin.js','script'],['dashboard-view-model.js','script']];
    for(const [href,as] of assets){
      if([...document.querySelectorAll('link[data-paws-prefetch]')].some(x=>x.dataset.pawsPrefetch===href))continue;
      const link=document.createElement('link');link.rel='prefetch';link.href=href;link.as=as;link.dataset.pawsPrefetch=href;document.head.appendChild(link);
    }
  }

  function canEdit() {
    return UCVM.admin(currentUser);
  }

  function canEditExistingSqlSession() {
    return SQL_SESSION_EDIT_ROLES.has(String(currentUser?.role||'').trim().toLowerCase());
  }

  function requireSessionWrites() {
    const enabled = Boolean(window.UCVM_PAWS_DATA && window.UCVM_PAWS_DATA.sessionWritesEnabled());
    if (enabled) return true;
    const error = new Error('This timetable action is not available on the current VetMed-Ops API.');
    error.code = 'SQL_SESSION_WRITES_NOT_READY';
    toast(error.message, true);
    return false;
  }

  async function getRoleProfile() {
    if (!window.UCVM_PAWS_DATA) {
      const error = new Error('The PAWS data client is unavailable.');
      error.code = 'PAWS_DATA_CLIENT_MISSING';
      throw error;
    }
    const profile = await window.UCVM_PAWS_DATA.currentUser();
    const role = String(profile?.role || '').trim().toLowerCase();
    if (!role) {
      const error = new Error('The SQL access profile has no role.');
      error.code = 'ROLE_DENIED';
      throw error;
    }
    return {
      ...profile,
      name: profile.displayName || profile.name,
      role,
      active: profile.active === true,
      mustChangePassword: profile.mustChangePassword === true
    };
  }

  function isAdmin() { return UCVM.admin(currentUser); }

  // Public course catalog is embedded so the page has no dependency on scheduleDataBase.js.
  // Live dates, times, instructors, DOE assignments and availability remain Firestore-only.
  const COURSES = [
    {code:'200',year:1,name:'Introduction to Veterinary Medicine'},
    {code:'202',year:1,name:'Professional Identity Formation I'},
    {code:'204',year:1,name:'Exploring Veterinary Medicine I'},
    {code:'206',year:1,name:'Healthy Animals I'},
    {code:'211',year:1,name:'Practical Work Experience I'},
    {code:'213',year:1,name:'Animals As Populations'},
    {code:'215',year:1,name:'What Is A Veterinarian'},
    {code:'217',year:1,name:'Healthy Animals II'},
    {code:'302',year:2,name:'Professional Identity Formation II'},
    {code:'304',year:2,name:'Science of What Goes Wrong I'},
    {code:'306',year:2,name:'Science of What Goes Wrong II'},
    {code:'308',year:2,name:'Fundamentals of Diagnosis, Management and Treatment'},
    {code:'311',year:2,name:'Practical Work Experience II'},
    {code:'313',year:2,name:'Veterinarians in Society'},
    {code:'315',year:2,name:'Head, Oral, and Gastrointestinal'},
    {code:'317',year:2,name:'Endocrine, Renal, and Reproduction'},
    {code:'319',year:2,name:'Neonatal, Special Senses, Alternative Species'},
    {code:'440',year:3,name:'One Health and Veterinary Practice'},
    {code:'501',year:3,name:'Clinical Presentations III'},
    {code:'505',year:3,name:'Clinical Skills III'},
    {code:'506',year:3,name:'Investigative Veterinary Medicine and Science Communication'},
    {code:'508',year:3,name:'Professional Skills III'},
    {code:'521',year:3,name:'Equine Medicine and Surgery'},
    {code:'522',year:3,name:'Small Animal Medicine and Surgery'},
    {code:'523',year:3,name:'Anesthesiology and Therapeutics'},
    {code:'525',year:3,name:'Advanced Health Management'},
    {code:'530',year:3,name:'Selected Topics in Clinical Medicine'},
    {code:'531',year:3,name:'Selected Topics in Small Ruminant, South American Camelid and Non-traditional Livestock Production'},
    {code:'540',year:3,name:'Food Animal Medicine and Surgery'},
    {code:'541',year:3,name:'Theriogenology'},
    {code:'542',year:3,name:'Emergency and Critical Care'},
    {code:'550',year:3,name:'Zoological Medicine'},
    {code:'551',year:3,name:'Laboratory Animal Medicine'}
  ];

  const accounts = [
    { id: 'admin-001', name: 'Test Administrator', email: 'admin@ucvm.test', role: 'admin' },
    ...Array.from({ length: 120 }, (_, i) => {
      const n = String(i + 1).padStart(3, '0');
      return { id: `faculty-${n}`, name: `Faculty ${n}`, email: `faculty${n}@ucvm.test`, role: 'faculty' };
    })
  ];

  let sessions = [];
  let sessionUnsubscribe = null;
  let facultyUnsubscribe = null;
  let facultyDirectory = [];
  let currentFacultyRecord = null;
  let currentFacultyLoading = null;
  let currentFacultyLoadingKey = '';
  let facultyLoading = null;
  let sessionRangeKey = '';
  const sessionCache = new Map();
  const sessionCacheRanges = [];
  const sessionRangeLoads = new Map();
  const sessionCacheDates = new Set();
  const sessionDateLoads = new Map();
  const pageDataSubscribers = new Set();
  let allSessionsCache = null;
  let allSessionsOwnerUid = '';
  let allSessionsLoading = null;
  let allSessionsLoadingUid = '';
  let allSessionsLoadGeneration = 0;
  function sessionsFromAllCache(rows,range){
    if(!Array.isArray(rows))return null;
    if(!range)return rows.slice();
    const start=String(range.start||'').slice(0,10),end=String(range.end||'').slice(0,10);
    if(!start||!end)return rows.slice();
    return rows.filter(row=>row.date>=start&&row.date<=end);
  }
  const profileSnapshots=new Map();
  function pageProfile(){return currentUser?{...currentUser.profile,name:currentUser.name,email:currentUser.email,role:currentUser.role,facultyId:currentUser.profile?.facultyId||''}:null}
  function pageSessions(){return[...sessionCache.values()]}
  function fullSessionCacheForUser(user){
    const uid=String(user?.uid||'');
    return uid&&allSessionsOwnerUid===uid&&Array.isArray(allSessionsCache)?allSessionsCache:null;
  }
  function cachedSessionsForRange(user,range){
    return sessionsFromAllCache(fullSessionCacheForUser(user),range);
  }
  function publishPageData(){for(const callback of pageDataSubscribers){try{callback()}catch(error){console.error('[page data subscriber]',error)}}}
  function cacheSessionRange(range,rows){
    for(const [id,row] of sessionCache)if(row.date>=range.start&&row.date<=range.end)sessionCache.delete(id);
    for(const row of rows)sessionCache.set(row.id,row);
    if(!sessionCacheRanges.some(item=>item.start===range.start&&item.end===range.end))sessionCacheRanges.push({...range});
  }
  function mapPawsSessionRow(row){
    const academicYear=String(row?.academicYear||'');
    const curriculumYear=Number(row?.curriculumYear)||Number((academicYear.match(/\d+/)||[])[0])||1;
    const instructor=String(row?.instructorNames||'').trim();
    let canonicalAssignments=[];
    try {
      const raw=Array.isArray(row?.assignments)?row.assignments:JSON.parse(String(row?.assignmentsJson||'[]'));
      if(Array.isArray(raw))canonicalAssignments=raw.map(item=>({
        facultyId:String(item?.facultyId||''),ucid:String(item?.facultyId||''),
        name:String(item?.displayName||''),role:String(item?.teachingRole||''),active:item?.active===true||item?.active===1
      })).filter(item=>item.facultyId);
    } catch (_) { canonicalAssignments=[]; }
    const date=String(row?.date||'').slice(0,10);
    const position=date?academicPositionForDate(parseYmd(date)):{semester:'',week:null};
    return {
      id:String(row?.id||''),
      academicYear,
      date,
      year:curriculumYear,
      semester:position.semester,
      week:position.week,
      course:String(row?.courseCode||''),
      courseName:String(row?.courseName||''),
      topic:String(row?.topic||''),
      type:String(row?.sessionType||''),
      start:String(row?.startTime||'').slice(0,5),
      end:String(row?.endTime||'').slice(0,5),
      timeUnknown:!row?.startTime||!row?.endTime,
      room:String(row?.room||''),
      instructor,
      assignments:canonicalAssignments.length?canonicalAssignments:(instructor ? splitInstructorNames(instructor).map(name=>({name})) : []),
      unresolvedAssignmentCount:Number(row?.unresolvedAssignmentCount)||0,
      assignmentManagementAvailable:canonicalAssignments.every(item=>item.active===true)&&Number(row?.unresolvedAssignmentCount||0)===0,
      sourceSystem:'VetMed-Ops'
    };
  }
  async function fetchPawsSessions(range={}){
    if(!window.UCVM_PAWS_DATA)throw new Error('The PAWS data client is unavailable.');
    const rows=await window.UCVM_PAWS_DATA.listSessions(range);
    return rows.map(mapPawsSessionRow).filter(row=>row.id);
  }
  async function ensureSessionsForRange(start,end){
    const range={start:String(start||'').slice(0,10),end:String(end||'').slice(0,10)};
    if(!currentUser||!range.start||!range.end||range.start>range.end)return[];
    const cachedAll=cachedSessionsForRange(currentUser,range);
    if(cachedAll)return cachedAll;
    const covered=sessionCacheRanges.some(item=>item.start<=range.start&&item.end>=range.end);
    if(covered)return pageSessions().filter(row=>row.date>=range.start&&row.date<=range.end);
    const key=`${range.start}:${range.end}`;
    if(!sessionRangeLoads.has(key))sessionRangeLoads.set(key,fetchPawsSessions({start:range.start,end:ymd(addDays(parseYmd(range.end),1))}).then(rows=>{
      cacheSessionRange(range,rows);publishPageData();return rows.slice();
    }).finally(()=>sessionRangeLoads.delete(key)));
    return sessionRangeLoads.get(key);
  }
  async function ensureSessionsForDates(values,force=false){
    const dates=UCVM_DATA_INDEX.dateChunks(values).flat().sort();
    if(!dates.length||!currentUser)return[];
    if(force){
      const wanted=new Set(dates);
      for(const [id,row] of sessionCache)if(wanted.has(String(row.date||'').slice(0,10)))sessionCache.delete(id);
      dates.forEach(date=>sessionCacheDates.delete(date));
    }
    const rows=await ensureSessionsForRange(dates[0],dates[dates.length-1]);
    dates.forEach(date=>sessionCacheDates.add(date));
    return rows.filter(row=>dates.includes(String(row.date||'').slice(0,10)));
  }
  window.UCVM_PAGE_DATA={
    profile:()=>pageProfile(),
    academicYear:()=>viewMode==='list'?listAcademicYear:sqlAcademicYearForDate(ymd(weekStart(selectedWeek,selectedSemester))),
    faculty:()=>currentFacultyRecord,
    sessions:()=>pageSessions(),
    ensureSessionsForRange,
    subscribe:callback=>{pageDataSubscribers.add(callback);return()=>pageDataSubscribers.delete(callback)},
    facultyDirectory:()=>facultyDirectory.slice(),
    allSessions:()=>ensureAllSessions(),
    profileSnapshot:uid=>{
      if(!profileSnapshots.has(uid))profileSnapshots.set(uid,db.collection('users').doc(uid).get());
      return profileSnapshots.get(uid);
    }
  };
  let scheduleSource = 'vetmed-ops-pending';
  let currentUser = null;
  window.PAWS_SWAP?.configure({getUser:()=>currentUser,onChanged:async()=>{
    invalidateAllSessions();await Promise.all([refreshSessionScope(),window.PAWS_SWAP.refreshPending()]);render();window.PAWS_TASKS?.refresh();
  }});
  window.PAWS_TASKS?.configure({hasUser:()=>Boolean(currentUser),identity:()=>currentUser?.uid||'',academicYear:()=>listAcademicYear,allSessions:()=>ensureAllSessions({refresh:true,notify:false}),disposition:calendarTimingDisposition,reason:unpositionedReason,openSession:async id=>{
    const ownerUid=currentUser?.uid;
    let rows;
    try{rows=await ensureAllSessions({refresh:true,notify:false});}
    catch(_){if(ownerUid&&currentUser?.uid===ownerUid)toast('The session could not be refreshed. Retry from Tasks.',true);return;}
    if(!ownerUid||currentUser?.uid!==ownerUid)return;
    const session=rows.find(row=>row.id===id);
    if(!session){toast('This session is no longer available. Refresh Tasks.',true);return;}
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(session.date||''))){
      const date=parseYmd(session.date);if(!Number.isNaN(date.getTime())){
        const position=academicPositionForDate(date);selectedSemester=position.semester;selectedWeek=Math.max(1,Math.min(WEEK_COUNT,position.week));selectedDayIndex=Math.max(0,Math.min(4,date.getDay()-1));
        $('filter-month').value='all';$('search-input').value='';activityTypeFilter.reset();selectedYear='all';selectedCourses.clear();courseFilterActive=false;myTimetableOnly=false;populateCourseFilter();
        document.querySelectorAll('[data-year]').forEach(b=>b.classList.toggle('active',b.dataset.year==='all'));document.querySelectorAll('[data-semester]').forEach(b=>b.classList.toggle('active',b.dataset.semester===selectedSemester));renderWeekControls();syncWeekUI();await refreshSessionScope();
      }
    }
    if(currentUser?.uid===ownerUid)openSessionDetail(id,session);
  }});
  pageDataSubscribers.add(()=>{window.PAWS_TASKS?.refresh();});
  let canonicalWriteFaculty = [];
  let selectedWeek = 1;
  let selectedYear = 'all';
  let selectedSemester = 'fall';
  let viewMode = 'week';
  let listSessionMode = 'ALL';
  let listAcademicYear = '';
  let lastFacultyTeachingView = 'day';
  let selectedDayIndex = 0;
  let selectedCourses = new Set();
  let courseFilterActive = false;
  let workingActivityRenderToken = 0;
  let workingCalendarRows = [], workingCalendarScope = '';
  let renderedSessions = [];
  let colorsOn = true;
  let myTimetableOnly = false;
  const MAX_BULK_SESSION_ROWS = 200;
  let bulkRows = [];
  const sessionSelection = window.UCVM_TIMETABLE_SELECTION.create(200);
  const selectionViewFlow = window.UCVM_TIMETABLE_SELECTION.createViewFlow();
  const selectedSessionOriginals = new Map();
  let selectionMode = false;
  let reviewingSelection = false;
  let selectionDoeState = new Map();

  const $ = (id) => document.getElementById(id);
  let scheduleWorkspace = null;
  let contentFilterBatch = false;
  const activityTypeFilter = window.PAWS_CALENDAR_ACTIVITIES.createActivityTypeFilter({host:$('activity-type-filter'),activityCategories:['ccc','rotation_participant'],onChange:()=>{if(!contentFilterBatch)render();}});
  const activeFilterView = window.PAWS_SCHEDULE_FILTER_VIEW.mount($('schedule-active-filters'),{
    onRemove:changeContentFilter,onClear:()=>changeContentFilter('clear'),focusFallback:$('search-input')
  });
  const memoryStore = {};
  function storageGet(key) {
    try { return window.localStorage ? window.localStorage.getItem(key) : (memoryStore[key] ?? null); }
    catch { return memoryStore[key] ?? null; }
  }
  function storageSet(key, value) {
    try { if (window.localStorage) window.localStorage.setItem(key, value); else memoryStore[key] = value; }
    catch { memoryStore[key] = value; }
  }

  const SCHEDULE_FILTERS_KEY = 'ucvm-schedule-filters-expanded';
  function initialScheduleFiltersExpanded(media, stored) {
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return false;
  }
  function setScheduleFiltersExpanded(expanded, persist=true) {
    const panel=$('schedule-filter-panel'),button=$('schedule-filter-toggle');
    panel.hidden=!expanded;
    button.setAttribute('aria-expanded',String(expanded));
    const chevron=button.querySelector('.schedule-filter-chevron');
    if(chevron)chevron.textContent=expanded?'⌃':'⌄';
    if(expanded)syncWeekUI();
    if(persist)try{window.sessionStorage.setItem(SCHEDULE_FILTERS_KEY,String(expanded))}catch(_){ }
  }
  function initializeScheduleFilters(matchMedia=window.matchMedia.bind(window)) {
    let stored=null;
    try{stored=window.sessionStorage.getItem(SCHEDULE_FILTERS_KEY)}catch(_){ }
    setScheduleFiltersExpanded(initialScheduleFiltersExpanded(matchMedia('(max-width: 900px)'),stored),false);
    $('schedule-filter-toggle').addEventListener('click',()=>setScheduleFiltersExpanded($('schedule-filter-toggle').getAttribute('aria-expanded')!=='true'));
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
  function weekStart(week, semester = selectedSemester) {
    const base = semester === 'spring' ? SPRING_BASE_MONDAY : (semester === 'winter' ? WINTER_BASE_MONDAY : FALL_BASE_MONDAY);
    return addDays(base, (week - 1) * 7);
  }
  function academicPositionForDate(d) {
    const springStart = SPRING_BASE_MONDAY, springEnd = addDays(FALL_BASE_MONDAY, -1);
    const fallStart = FALL_BASE_MONDAY, fallEnd = addDays(WINTER_BASE_MONDAY, -1);
    const winterStart = WINTER_BASE_MONDAY, winterEnd = addDays(WINTER_BASE_MONDAY, WEEK_COUNT * 7 - 1);
    if (d >= springStart && d <= springEnd) return { semester:'spring', week:Math.floor((d-springStart)/86400000/7)+1 };
    if (d >= fallStart && d <= fallEnd) return { semester:'fall', week:Math.floor((d-fallStart)/86400000/7)+1 };
    if (d >= winterStart && d <= winterEnd) return { semester:'winter', week:Math.floor((d-winterStart)/86400000/7)+1 };
    return d < fallStart ? {semester:'spring',week:1} : {semester:'winter',week:1};
  }
  function setInitialAcademicPeriod() {
    const p = academicPositionForDate(new Date());
    selectedSemester = p.semester; selectedWeek = Math.max(1, Math.min(WEEK_COUNT, p.week));
    selectedDayIndex = Math.max(0, Math.min(4, (new Date().getDay() || 1) - 1));
    document.querySelectorAll('[data-semester]').forEach(x => x.classList.toggle('active', x.dataset.semester === selectedSemester));
  }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function formatDate(d) { return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); }
  function formatLongDate(d) { return d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
  function timeToMinutes(t) { return scheduling.parseTime(t); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c])); }

  function sessionTypeClass(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'rotation') return 'tg-type-rotation';
    if (normalized === 'ccc') return 'tg-type-ccc';
    if (normalized === 'lec') return 'tg-type-lec';
    if (normalized === 'lab') return 'tg-type-lab';
    if (normalized === 'srl') return 'tg-type-srl';
    if (normalized === 'quiz/midterm') return 'tg-type-quiz-midterm';
    if (normalized === 'osce') return 'tg-type-osce';
    if (normalized === 'exam') return 'tg-type-exam';
    return 'tg-type-other';
  }

  function updateScheduleSourceUI() {
    const live = scheduleSource === 'vetmed-ops';
    const sqlEditEnabled = Boolean(window.UCVM_PAWS_DATA && window.UCVM_PAWS_DATA.sessionEditEnabled?.());
    const canEditLiveSession = canEditExistingSqlSession() && sqlEditEnabled;
    const text = $('conn-text');
    if (text && currentUser) {
      if (live) text.textContent = `Authorized: ${UCVM.label(currentUser.role)} · VetMed-Ops timetable${canEditLiveSession ? '' : ' (read only)'}`;
      else if (scheduleSource === 'vetmed-ops-empty') text.textContent = `Authorized: ${UCVM.label(currentUser.role)} · No VetMed-Ops timetable sessions`;
      else if (scheduleSource === 'vetmed-ops-error') text.textContent = `Authorized: ${UCVM.label(currentUser.role)} · VetMed-Ops timetable unavailable`;
      else text.textContent = `Authorized: ${UCVM.label(currentUser.role)} · Connecting to VetMed-Ops timetable`;
    }
    const publish = $('publish-firestore-schedule');
    if (publish) {
      publish.classList.add('hidden');
      publish.disabled = true;
    }
  }

  function visibleSessionRange() {
    if (viewMode === 'month') {
      const wstart = weekStart(selectedWeek, selectedSemester);
      const monthChoice = $('filter-month').value;
      const month = monthChoice === 'all' ? wstart.getMonth() : Number(monthChoice);
      const year = month >= 4 ? 2026 : 2027;
      return { start:ymd(new Date(year, month, 1)), end:ymd(new Date(year, month + 1, 0)) };
    }
    const start = weekStart(selectedWeek, selectedSemester);
    if (viewMode === 'day') {
      const day = ymd(addDays(start, selectedDayIndex));
      return { start:day, end:day };
    }
    if (viewMode === 'list') return { start:ymd(new Date()), end:'9999-12-31' };
    return { start:ymd(start), end:ymd(addDays(start, 4)) };
  }

  async function subscribeSessions() {
    if (!currentUser) return false;
    const range=visibleSessionRange(), key=`${viewMode}:${range.start}:${range.end}`;
    if(sessionUnsubscribe&&sessionRangeKey===key)return true;
    if (sessionUnsubscribe) { try { sessionUnsubscribe(); } catch (_) {} }
    sessionRangeKey=key;
    let cancelled=false;
    sessionUnsubscribe=()=>{cancelled=true};
    try{
      const requestRange=viewMode==='list'?{}:{start:range.start,end:ymd(addDays(parseYmd(range.end),1))};
      const cachedAll=cachedSessionsForRange(currentUser,viewMode==='list'?null:range);
      const rows=cachedAll||await fetchPawsSessions(requestRange);
      if(cancelled)return false;
      sessions=rows;
      activityTypeFilter.setSessionTypes(rows.map(row=>row.type));
      cacheSessionRange(range,rows);
      publishPageData();
      window.dispatchEvent(new Event('ucvm:sessions-updated'));
      scheduleSource = sessions.length ? 'vetmed-ops' : 'vetmed-ops-empty';
      populateCourseFilter();
      updateScheduleSourceUI();
      render();
      return true;
    }catch(err){
      if(cancelled)return false;
      console.error('[VetMed-Ops timetable sessions]',err);
      sessions=[];
      scheduleSource='vetmed-ops-error';
      populateCourseFilter();
      updateScheduleSourceUI();
      toast('VetMed-Ops timetable data could not be loaded from the PAWS University API.',true);
      render();
      return false;
    }
  }

  function refreshSessionScope(){if(currentUser)return subscribeSessions();render();return Promise.resolve(true)}
  async function ensureAllSessions({refresh=false,notify=true}={}){
    const ownerUid=String(currentUser?.uid||'');
    if(!ownerUid)return[];
    const cached=fullSessionCacheForUser(currentUser);
    if(cached&&!refresh)return cached.slice();
    if(allSessionsLoading&&allSessionsLoadingUid===ownerUid)return allSessionsLoading;
    const generation=++allSessionsLoadGeneration;
    allSessionsLoadingUid=ownerUid;
    const load=fetchPawsSessions().then(rows=>{
      if(generation!==allSessionsLoadGeneration||String(currentUser?.uid||'')!==ownerUid)return[];
      allSessionsCache=rows.slice();
      allSessionsOwnerUid=ownerUid;
      for(const row of rows)sessionCache.set(row.id,row);
      if(notify)publishPageData();
      return rows.slice();
    }).finally(()=>{
      if(generation===allSessionsLoadGeneration){allSessionsLoading=null;allSessionsLoadingUid='';}
    });
    allSessionsLoading=load;
    return load;
  }
  function scheduleAllSessionsPrefetch(user,after){
    const ownerUid=String(user?.uid||'');
    if(!ownerUid)return;
    Promise.resolve(after).catch(()=>null).then(()=>{
      if(String(currentUser?.uid||'')!==ownerUid)return[];
      return ensureAllSessions();
    }).catch(error=>{if(String(currentUser?.uid||'')===ownerUid)console.warn('[VetMed-Ops session prefetch]',error)});
  }
  function invalidateAllSessions(){
    if(sessionUnsubscribe){try{sessionUnsubscribe()}catch(_){}sessionUnsubscribe=null}
    sessionRangeKey='';
    allSessionsLoadGeneration+=1;
    allSessionsCache=null;allSessionsOwnerUid='';allSessionsLoading=null;allSessionsLoadingUid='';
    sessionCacheRanges.length=0;sessionCacheDates.clear();
  }
  function swapNumeric(v){ if(v===undefined||v===null||v==='') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
  function swapNameKey(v){ return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' '); }
  const displayFaculty = value => window.PAWS_FACULTY_NAME.format(value);
  const displayFacultyList = value => window.PAWS_FACULTY_NAME.formatList(value);
  function swapFacultyName(f){ return String(f?.preferredFullName||f?.hrFirstLast||f?.hrFullName||f?.facultySummary2026_27?.displayName||f?.__id||''); }
  function swapSummary(f){ const x=f?.facultySummary2026_27; return x&&typeof x==='object'&&!Array.isArray(x)?x:null; }
  function swapFacultyAliases(f){ const out=new Set(); [swapFacultyName(f),f?.preferredFullName,f?.hrFullName,f?.hrFirstLast,f?.teachingAssignmentName,swapSummary(f)?.displayName].forEach(v=>{const k=swapNameKey(v);if(k)out.add(k)}); if(f?.firstName&&f?.lastName)out.add(swapNameKey(`${f.firstName} ${f.lastName}`)); return out; }
  function swapEffectiveTarget(f){return window.UCVM_FACULTY_DOE.effectiveTarget(f)}
  function swapAssignmentCredit(a){ const c=swapNumeric(a?.doeCredit); if(c!==null)return c; const r=swapNumeric(a?.doeRate),h=swapNumeric(a?.creditedHours); return r!==null&&h!==null?Number((r*h).toFixed(6)):null; }
  function swapAssignmentHours(a,s){ const h=swapNumeric(a?.creditedHours); if(h!==null)return h; if(s?.timeUnknown)return null; try{return blockHours(s.start,s.end)}catch{return null} }
  function awayRecordsForFaculty(f){return Array.isArray(f?.awayFromCampusRecords)?f.awayFromCampusRecords.filter(x=>x&&x.startDate&&x.endDate):[]}
  function facultyAvailability(f,dateYmd){
    const d=String(dateYmd||'').slice(0,10); if(!d)return{available:null,conflicts:[]};
    const conflicts=awayRecordsForFaculty(f).filter(x=>String(x.startDate)<=d&&d<=String(x.endDate)).sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate)));
    return{available:conflicts.length===0,conflicts};
  }
  function availabilityShort(av){if(av.available===null)return'Date not set';if(av.available)return'Available';return'Unavailable'}
  function availabilityDetail(av){if(av.available===null)return'Availability cannot be checked until a session date is set.';if(av.available)return'Available';return'Unavailable'}

  function sessionHasFaculty(sess,f){
    const id=String(f?.__id||''); const aliases=swapFacultyAliases(f);
    const arr=Array.isArray(sess?.assignments)?sess.assignments:[];
    if(arr.some(a=>String(a?.ucid||'')===id || aliases.has(swapNameKey(a?.name))))return true;
    return splitInstructorNames(sess?.instructor||'').some(n=>aliases.has(swapNameKey(n)));
  }
  function timetableAvailability(f,dateYmd,start,end,excludeSessionId='',options={}){
    const d=String(dateYmd||'').slice(0,10);
    if(!d)return{available:null,conflicts:[],possibleConflicts:[],reason:'date'};
    const context=options.sessions||pageSessions(),original=context.find(session=>String(session.id)===String(excludeSessionId));
    const timeUnknown=options.timeUnknown??(original?.timeUnknown===true&&start===original.start&&end===original.end);
    const check=scheduling.findFacultyConflicts({date:d,start,end,timeUnknown,sessions:context,excludeSessionId,isAssigned:sess=>sessionHasFaculty(sess,f)});
    return{status:check.status,available:check.status==='clear'?true:(check.status==='conflict'?false:null),conflicts:check.conflicts,possibleConflicts:check.possibleConflicts,reason:check.reason==='target_time'?'target-time':(check.reason==='other_time_unknown'?'other-time-unknown':check.reason)};
  }
  function facultyAssignmentAvailability(f,dateYmd,start,end,excludeSessionId='',options={}){
    const afc=facultyAvailability(f,dateYmd),tt=timetableAvailability(f,dateYmd,start,end,excludeSessionId,options);
    const unavailable=afc.available===false||tt.available===false;
    return{available:unavailable?false:(tt.available===null?null:true),afc,tt};
  }
  function reviewSchedulingChanges(rows,sourceSessions=pageSessions()){
    const effective=new Map(sourceSessions.map(session=>[String(session.id),session]));
    for(const row of rows)effective.set(String(row.id),row);
    const context=[...effective.values()];
    return rows.map(session=>{
      const checks=[],conflicts=new Map();
      for(const assignment of session.assignments||[]){
        const faculty=facultyForAssignment(assignment);if(!faculty)continue;
        const av=facultyAssignmentAvailability(faculty,session.date,session.start,session.end,session.id,{timeUnknown:session.timeUnknown===true,sessions:context});
        if(av.available!==true)checks.push({assignment,av});
        for(const conflict of av.tt.conflicts||[])conflicts.set(String(conflict.id),conflict);
      }
      return{session,checks,conflicts:[...conflicts.values()]};
    });
  }
  function confirmSchedulingChanges(rows,sourceSessions=pageSessions()){
    const reviews=reviewSchedulingChanges(rows,sourceSessions),warnings=[];
    for(const row of reviews)for(const check of row.checks)warnings.push(`${row.session.course||'Course'} ${row.session.date}: ${displayFaculty(check.assignment.name||'Faculty')} - ${assignmentAvailabilityDetail(check.av,row.session.date,row.session.start,row.session.end)}`);
    if(!warnings.length)return new Map();
    const conflict=reviews.some(row=>row.conflicts.length);
    const question=conflict?'TIMETABLE CONFLICT DETECTED. Override and save? This override will be recorded in the audit log.':'Availability check incomplete or unavailable. Continue as ADFA?';
    if(!confirm(`${question}\n\n${warnings.join('\n')}`))return null;
    return new Map(reviews.filter(row=>row.conflicts.length).map(row=>[String(row.session.id),{
      ...approvalScheduling.overrideAudit({uid:currentUser.uid,name:currentUser.name||'ADFA administrator'},row.conflicts),
      confirmedAt:firebase.firestore.FieldValue.serverTimestamp()
    }]));
  }
  function timetableConflictLabel(sess){
    const course=[sess?.course,sess?.courseName].filter(Boolean).join(' · '),topic=sess?.topic?` · ${sess.topic}`:'';
    const time=sess?.timeUnknown||!sess?.start||!sess?.end?'time not specified':`${sess.start}-${sess.end}`;
    return `${course||'Scheduled course'}${topic} (${time})`;
  }
  function assignmentAvailabilityShort(av){
    if(av.available===true)return'Available';
    if(av.available===null)return'Check needed';
    if(av.afc?.available===false&&av.tt?.available===false)return'Unavailable · timetable conflict';
    if(av.tt?.available===false)return`Conflict · ${av.tt.conflicts[0]?.course||'another course'}`;
    return'Unavailable';
  }
  function assignmentAvailabilityDetail(av,dateYmd,start,end){
    const parts=[];
    if(av.afc?.available===false)parts.push('AFC: Unavailable');
    if(av.tt?.available===false)parts.push(`Timetable conflict: ${av.tt.conflicts.map(timetableConflictLabel).join('; ')}`);
    else if(av.tt?.available===true)parts.push(`Timetable clear for ${start||'—'}-${end||'—'}`);
    else if(av.tt?.reason==='target-time')parts.push('Timetable overlap cannot be fully checked because this session time is not specified');
    if(av.tt?.possibleConflicts?.length)parts.push(`Time-check needed: ${av.tt.possibleConflicts.map(timetableConflictLabel).join('; ')}`);
    if(!parts.length)parts.push(`Availability cannot be checked for ${dateYmd||'this date'}`);
    return parts.join(' · ');
  }

  function unsubscribeFacultyDirectory(){ if(facultyUnsubscribe){try{facultyUnsubscribe()}catch(_){ } facultyUnsubscribe=null;} facultyDirectory=[];facultyLoading=null; }
  function clearCurrentFaculty(){currentFacultyRecord=null;currentFacultyLoading=null;currentFacultyLoadingKey='';publishPageData()}
  function ensureCurrentFaculty(){
    const requestedUser=currentUser;
    const requestedUid=String(requestedUser?.uid||'');
    const id=String(requestedUser?.profile?.facultyId||'').trim();
    const key=`${requestedUid}:${id}`;
    if(!db||!requestedUser||!id){clearCurrentFaculty();return Promise.resolve(null)}
    if(currentFacultyRecord&&String(currentFacultyRecord.id)===id)return Promise.resolve(currentFacultyRecord);
    if(currentFacultyLoading&&currentFacultyLoadingKey===key)return currentFacultyLoading;
    let load=null;
    load=db.collection('faculty').doc(id).get().then(doc=>{
      if(!currentUser||String(currentUser.uid||'')!==requestedUid||String(currentUser.profile?.facultyId||'').trim()!==id)return null;
      currentFacultyRecord=doc.exists?{id:doc.id,...doc.data()}:null;
      publishPageData();return currentFacultyRecord;
    }).catch(error=>{
      console.error('[current faculty load]',error);
      if(currentUser&&String(currentUser.uid||'')===requestedUid&&String(currentUser.profile?.facultyId||'').trim()===id){currentFacultyRecord=null;publishPageData()}
      return null;
    }).finally(()=>{if(currentFacultyLoading===load){currentFacultyLoading=null;currentFacultyLoadingKey=''}});
    currentFacultyLoading=load;
    currentFacultyLoadingKey=key;
    return load;
  }
  function scheduleOptionalFacultyEnrichment(user, profile) {
    return Promise.resolve().then(async () => {
      const expectedCurrentUser=currentUser;
      if (!expectedCurrentUser || expectedCurrentUser.uid !== user.uid) return;
      const priorInstructorKey=swapNameKey(expectedCurrentUser.instructorName);
      const priorFacultyContextId=String(currentFacultyRecord?.id||'');
      if (typeof UCVM.enrichFacultyIdentity === 'function') await UCVM.enrichFacultyIdentity(user, profile);
      if (currentUser !== expectedCurrentUser || currentUser.uid !== user.uid) return;
      const nextInstructorName=String(profile.instructor || currentUser.instructorName || authSettings.instructorAlias || 'Faculty 001');
      const instructorChanged=swapNameKey(nextInstructorName)!==priorInstructorKey;
      currentUser.instructorName=nextInstructorName;
      await ensureCurrentFaculty();
      if (currentUser !== expectedCurrentUser || currentUser.uid !== user.uid) return;
      const facultyContextChanged=String(currentFacultyRecord?.id||'')!==priorFacultyContextId;
      publishPageData();
      if ((instructorChanged || facultyContextChanged) && (sessions.length || sessionCache.size)) render();
    }).catch(error => console.warn('[optional faculty enrichment]', error));
  }
  function ensureFacultyDirectory(){
    if(!db||!UCVM.admin(currentUser))return Promise.resolve([]);
    if(facultyDirectory.length)return Promise.resolve(facultyDirectory.slice());
    if(facultyLoading)return facultyLoading;
    facultyLoading=Promise.all([db.collection('faculty').get(),db.collection('settings').doc('faculty_index').get()]).then(([snapshot,indexDoc])=>{
      const indexById=new Map((indexDoc.data()?.entries||[]).map(entry=>[String(entry.id),entry]));
      facultyDirectory=snapshot.docs.map(d=>({__indexAssignedTeachingDOE:indexById.get(d.id)?.assignedTeachingDOE,__id:d.id,...d.data()})).filter(f=>f.active!==false).sort((a,b)=>swapFacultyName(a).localeCompare(swapFacultyName(b)));
      window.dispatchEvent(new Event('ucvm:faculty-updated'));
      return facultyDirectory.slice();
    }).catch(err=>{console.error('[faculty load for admin tools]',err);facultyDirectory=[];toast('Faculty list could not be loaded. Check admin faculty read rules.',true);return[]}).finally(()=>{facultyLoading=null});
    return facultyLoading;
  }

  async function ensureCanonicalWriteFacultyDirectory(){
    if(canonicalWriteFaculty.length)return canonicalWriteFaculty.slice();
    const rows=await window.UCVM_PAWS_DATA.dashboardFaculty({limit:500});
    canonicalWriteFaculty=(Array.isArray(rows)?rows:[]).filter(row=>row?.active!==false&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(row?.facultyId||'')))
      .map(row=>({...row,__id:String(row.facultyId),name:String(row.displayName||'').trim()}))
      .sort((a,b)=>a.name.localeCompare(b.name));
    return canonicalWriteFaculty.slice();
  }

  function sqlAcademicYearForDate(date){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||''));
    if(!match)return '';
    const start=Number(match[2])>=5?Number(match[1]):Number(match[1])-1;
    return `${start}-${String((start+1)%100).padStart(2,'0')}`;
  }

  function buildSwapDoeState(){
    const state=new Map();
    for(const f of facultyDirectory){
      const summary=swapSummary(f),indexed=swapNumeric(f.__indexAssignedTeachingDOE),source=swapNumeric(summary?.assignedTeachingDOE);
      state.set(String(f.__id),{faculty:f,current:indexed??source,target:swapEffectiveTarget(f)});
    }
    return state;
  }

  function sessionAssignmentsForSwap(s){
    if(Array.isArray(s?.assignments)&&s.assignments.length)return s.assignments.map(a=>({...a}));
    return reconcileAssignments([],s?.instructor||'',s?.type||'',s?.start||'00:00',s?.end||'00:00',s?.topic||'');
  }
  function facultyForAssignment(a){
    const id=String(a?.ucid||'').trim(); if(id)return facultyDirectory.find(f=>String(f.__id)===id)||null;
    const key=swapNameKey(a?.name); if(!key)return null;
    return facultyDirectory.find(f=>swapFacultyAliases(f).has(key))||null;
  }
  function swapStatus(contract,projected){
    if(contract===null||projected===null)return{label:'No target',cls:'swap-unknown',remaining:null};
    const remaining=contract-projected;
    if(Math.abs(remaining)<=0.25)return{label:'At target',cls:'swap-within',remaining};
    if(remaining>0)return{label:'Under',cls:'swap-under',remaining};
    return{label:'Over',cls:'swap-over',remaining};
  }
  function swapPct(v,d=2){return v===null?'—':`${Number(v).toFixed(d)}%`}

  async function openSwapModal(sessionId,initialAssignmentIndex=0){
    if(!requireSessionWrites())return;
    if(!UCVM.admin(currentUser)){toast('Admin permission is required to swap faculty.',true);return;}
    if(scheduleSource!=='firestore'){toast('The synchronized live timetable must be loaded first.',true);return;}
    const s=sessions.find(x=>x.id===sessionId); if(!s)return;
    await Promise.all([ensureFacultyDirectory(),ensureSessionsForDates([s.date])]);
    const assignments=sessionAssignmentsForSwap(s); if(!assignments.length){toast('This course block has no faculty assignment to swap.',true);return;}
    if(!facultyDirectory.length){toast('Faculty directory could not be loaded.',true);return;}
    let selected=Math.min(Math.max(0,Number(initialAssignmentIndex)||0),assignments.length-1);
    const doeState=buildSwapDoeState();
    const renderSwap=()=>{
      const outgoing=assignments[selected], outgoingFaculty=facultyForAssignment(outgoing); const outgoingId=String(outgoing?.ucid||outgoingFaculty?.__id||'');
      const credit=swapAssignmentCredit(outgoing), outState=outgoingId?doeState.get(outgoingId):null; const outCurrent=outState?.current??null; const outAfter=(outCurrent!==null&&credit!==null)?outCurrent-credit:null;
      showModal(`
        <div class="modal-header"><div class="modal-title">SWAP Faculty · ${escapeHtml(s.course)} ${escapeHtml(s.type)}</div><div class="modal-subtitle">Admin-only reassignment. The Faculty Dashboard will update from the same Firestore session immediately after the swap.</div></div>
        <div class="modal-body">
          <div class="swap-session-card">
            <div class="swap-session-cell"><div class="swap-session-label">Date</div><div class="swap-session-value">${escapeHtml(formatLongDate(parseYmd(s.date)))}</div></div>
            <div class="swap-session-cell"><div class="swap-session-label">Time</div><div class="swap-session-value">${escapeHtml(s.timeUnknown?'Time not specified':`${s.start} - ${s.end}`)}</div></div>
            <div class="swap-session-cell"><div class="swap-session-label">Year / Course</div><div class="swap-session-value">Year ${escapeHtml(s.year)} · ${escapeHtml(s.course)}</div></div>
            <div class="swap-session-cell"><div class="swap-session-label">Topic</div><div class="swap-session-value">${escapeHtml(s.topic||'')}</div></div>
          </div>
          <label class="form-field"><span class="form-label">Swap out current faculty assignment</span><select class="form-select" id="swap-out-select">${assignments.map((a,i)=>`<option value="${i}" ${i===selected?'selected':''}>${escapeHtml(displayFaculty(a.name||'Unassigned'))} · ${escapeHtml(a.role||s.type||'')} · ${swapPct(swapAssignmentCredit(a))}</option>`).join('')}</select></label>
          <div class="swap-current-card"><div class="swap-current-title">Current assignment being removed</div><div class="swap-current-line"><span><strong>${escapeHtml(displayFaculty(outgoing?.name||'Unknown'))}</strong></span><span>Role: <strong>${escapeHtml(outgoing?.role||s.type||'')}</strong></span><span>DOE credit: <strong>${credit===null?'Unrated':swapPct(credit)}</strong></span><span>Current Assigned DOE: <strong>${swapPct(outCurrent)}</strong></span><span>After removal: <strong>${credit===null?'Unrated impact':swapPct(outAfter)}</strong></span></div></div>
          <div class="swap-search-row"><label class="form-field"><span class="form-label">Find replacement faculty</span><input class="form-input" id="swap-search" placeholder="Search name, specialty, teaching area, UCID..."></label></div>
          <div class="swap-help">Each candidate checks <strong>both AFC and the live timetable for overlapping courses at this exact date/time</strong>. For privacy, AFC only reports <strong>Unavailable</strong>; AFC reasons and dates are not shown here. The table then shows current Assigned Teaching DOE and projected Assigned DOE after this block is added. The current value uses the synchronized non-timetable/role source component plus live timetable DOE; detailed HICC/VISC/rotation/trainee policy breakdown is available in Faculty Dashboard. Effective DOE uses the approved Override DOE when present, otherwise Contract DOE. A timetable conflict or AFC absence is flagged as unavailable; uncertain records with an unspecified time are marked Check needed. Administrators may override after an explicit warning. The replacement inherits this assignment's role, credited hours and DOE rate. ${credit===null?'<strong>This activity has no numeric DOE rate in the source, so the projected DOE cannot be calculated.</strong>':''}</div>
          <div class="swap-table-wrap"><table class="swap-table"><thead><tr><th>Faculty</th><th>Availability</th><th>Effective DOE</th><th>Current Assigned DOE</th><th>Projected After Swap</th><th>Remaining / Over</th><th>DOE Status</th><th></th></tr></thead><tbody id="swap-candidate-body"></tbody></table></div>
        </div>
        <div class="modal-footer"><span class="form-hint">Swap is written to Firestore and logged in session_change_log.</span><button class="btn btn-secondary" id="swap-cancel">Cancel</button></div>`);
      const box=document.querySelector('#modal .modal-box'); if(box)box.classList.add('swap-wide');
      $('swap-cancel').onclick=closeModal;
      $('swap-out-select').onchange=e=>{selected=Number(e.target.value)||0;renderSwap()};
      const renderCandidates=()=>{
        const q=swapNameKey($('swap-search')?.value||'');
        const existingIds=new Set(assignments.map(a=>String(a.ucid||facultyForAssignment(a)?.__id||'')).filter(Boolean));
        const rows=facultyDirectory.filter(f=>{
          if(String(f.__id)===outgoingId)return false;
          if(existingIds.has(String(f.__id)))return false;
          if(q){const hay=swapNameKey([swapFacultyName(f),f.ucid,f.email,f.teachingArea,f.teachingAreaEmphasis,f.boardSpecialties,f.currentTitle,f.rank].filter(Boolean).join(' '));if(!hay.includes(q))return false;}
          return true;
        }).sort((a,b)=>{const aa=facultyAssignmentAvailability(a,s.date,s.start,s.end,s.id),bb=facultyAssignmentAvailability(b,s.date,s.start,s.end,s.id);const rank=x=>x.available===true?0:(x.available===null?1:2);const av=rank(aa)-rank(bb);return av||swapFacultyName(a).localeCompare(swapFacultyName(b))});
        $('swap-candidate-body').innerHTML=rows.map(f=>{
          const st=doeState.get(String(f.__id)); const current=st?.current??null; const projected=(current!==null&&credit!==null)?current+credit:null; const status=swapStatus(st?.target?.value??null,projected); const rem=status.remaining, av=facultyAssignmentAvailability(f,s.date,s.start,s.end,s.id);
          const afterText=credit===null?(current===null?'—':`${swapPct(current)} + unrated`):swapPct(projected);
          const remText=rem===null?'—':(rem>=0?`${rem.toFixed(2)}% remaining`:`${Math.abs(rem).toFixed(2)}% over`);
          const avHtml=av.available===false?`<span class="availability-pill availability-no">Unavailable</span><div class="availability-detail no">${escapeHtml(assignmentAvailabilityDetail(av,s.date,s.start,s.end))}</div>`:av.available===null?`<span class="availability-pill availability-none">Check needed</span><div class="availability-detail">${escapeHtml(assignmentAvailabilityDetail(av,s.date,s.start,s.end))}</div>`:`<span class="availability-pill availability-ok">Available</span><div class="availability-detail ok">${escapeHtml(assignmentAvailabilityDetail(av,s.date,s.start,s.end))}</div>`;
          const target=st?.target||{value:null,source:'none',reason:''},targetText=target.value===null?'—':`${swapPct(target.value)}${target.source==='override'?` <span class="doe-override-pill">Override${target.reason?` · ${escapeHtml(target.reason)}`:''}</span>`:''}`;
          return `<tr class="${av.available===false?'swap-unavailable':''}"><td><strong>${escapeHtml(displayFaculty(swapFacultyName(f)))}</strong><br><span class="form-hint">${escapeHtml(f.teachingArea||f.teachingAreaEmphasis||f.currentTitle||'')} ${f.ucid?`· ${escapeHtml(f.ucid)}`:''}</span></td><td>${avHtml}</td><td class="swap-num">${targetText}</td><td class="swap-num">${swapPct(current)}</td><td class="swap-num swap-projected">${afterText}</td><td class="swap-num">${remText}</td><td><span class="swap-status ${status.cls}">${status.label}</span></td><td><button class="btn btn-primary btn-swap-confirm" data-swap-faculty="${escapeHtml(f.__id)}">SWAP</button></td></tr>`;
        }).join('')||'<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-3)">No faculty match this search.</td></tr>';
        document.querySelectorAll('[data-swap-faculty]').forEach(btn=>btn.onclick=()=>performFacultySwap(s,assignments,selected,btn.dataset.swapFaculty,doeState));
      };
      $('swap-search').oninput=renderCandidates; renderCandidates();
    };
    renderSwap();
  }

  async function performFacultySwap(){
    toast('Faculty swaps must be completed through the PAWS University API.',true);
    return false;
  }

  async function initializeLiveSchedule() {
    if(!requireSessionWrites())return false;
    if (!UCVM.admin(currentUser)) { toast('Admin permission is required.', true); return; }
    if (confirm('The timetable is now sourced only from 2026-09-03 - All Faculty Summaries.xlsx. Open the Faculty Dashboard to replace and synchronize the source data?')) location.href='faculty-admin.html';
  }

  function init() {
    setInitialAcademicPeriod();
    populateCourseFilter();
    renderWeekControls();
    bindControls();
    bindCalendarSearchInput();
    updateAuthUI();
    setAppLocked(true, 'Checking login status...');
    initFirebaseAuth();
  }

  function courseCodes() { return [...new Set([...COURSES.map(c=>String(c.code)), ...sessions.map(x=>String(x.course||'')).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})); }
  function populateCourseFilter() {
    const host=$('filter-course-options'), codes=courseCodes();
    selectedCourses=new Set([...selectedCourses].filter(code=>codes.includes(code)));
    host.innerHTML=`<div class="course-multi-actions"><button type="button" data-course-all>Show all courses</button></div>${codes.map(code=>`<label class="course-multi-option"><input type="checkbox" data-course-choice value="${escapeHtml(code)}" ${selectedCourses.has(code)?'checked':''}> <span>${escapeHtml(code)}</span></label>`).join('')}`;
    const updateSummary=()=>{$('course-filter-summary').textContent=!courseFilterActive?'All Courses':selectedCourses.size===0?'No courses selected':selectedCourses.size===1?[...selectedCourses][0]:`${selectedCourses.size} courses selected`;};
    host.querySelectorAll('[data-course-choice]').forEach(box=>box.onchange=()=>{courseFilterActive=true;box.checked?selectedCourses.add(box.value):selectedCourses.delete(box.value);updateSummary();render()});
    host.querySelector('[data-course-all]').onclick=()=>{courseFilterActive=false;selectedCourses.clear();host.querySelectorAll('[data-course-choice]').forEach(x=>x.checked=false);updateSummary();render()};
    updateSummary();
  }

  function roleIsFaculty(profile){ return ['faculty','hicc','visc'].includes(String(profile?.role||'').trim().toLowerCase()); }
  function sessionBelongsToCurrentFaculty(s){
    if(!currentUser)return false;
    const facultyId=String(currentUser.profile?.facultyId||'').trim();
    if(s.isWorkingActivity)return s.activityOwnerUid===currentUser.uid&&Boolean(facultyId)&&s.activityFacultyId===facultyId;
    const aliases=new Set([currentUser.instructorName,currentUser.name,currentUser.email].map(swapNameKey).filter(Boolean));
    const assignments=Array.isArray(s.assignments)?s.assignments:[];
    if(facultyId&&assignments.some(a=>String(a?.ucid||a?.facultyId||'').trim()===facultyId))return true;
    if(assignments.some(a=>aliases.has(swapNameKey(a?.name))))return true;
    return splitInstructorNames(s.instructor||'').some(name=>aliases.has(swapNameKey(name)));
  }
  function renderWeekControls() {
    const r1 = $('week-btn-row-1');
    const r2 = $('week-btn-row-2');
    const mobile = $('week-mobile-select');
    r1.innerHTML = ''; r2.innerHTML = ''; mobile.innerHTML = '';
    for (let w = 1; w <= WEEK_COUNT; w++) {
      const b = document.createElement('button');
      b.className = 'pill-btn' + (w === selectedWeek ? ' active' : '');
      const start=weekStart(w,selectedSemester),end=addDays(start,4);
      b.textContent = window.PAWS_SCHEDULE_FILTER_VIEW.weekLabel(w,start,end); b.dataset.week = w;
      b.type='button';b.setAttribute('aria-pressed',String(w===selectedWeek));
      b.title=`Week ${w}: ${formatDate(start)}, ${start.getFullYear()} to ${formatDate(end)}, ${end.getFullYear()}`;
      b.addEventListener('click', () => { selectedWeek = w; syncWeekUI(); refreshSessionScope(); });
      (w <= 8 ? r1 : r2).appendChild(b);
      const opt = document.createElement('option'); opt.value = w; opt.textContent = `Week ${w} - ${formatDate(weekStart(w, selectedSemester))}`;
      if (w === selectedWeek) opt.selected = true;
      mobile.appendChild(opt);
    }
    syncWeekUI();
  }

  function syncWeekUI() {
    document.querySelectorAll('[data-week]').forEach(b => {const selected=Number(b.dataset.week)===selectedWeek;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
    $('week-mobile-select').value = String(selectedWeek);
    requestAnimationFrame(()=>{
      const host=$('academic-week-navigator'),active=host.querySelector('[aria-pressed="true"]');
      if(!active||!host.clientWidth)return;
      const bounds=host.getBoundingClientRect(),selected=active.getBoundingClientRect();
      if(selected.left<bounds.left||selected.right>bounds.right)host.scrollLeft+=(selected.left+selected.right-bounds.left-bounds.right)/2;
    });
  }

  function bindControls() {
    window.addEventListener('resize',syncWeekUI);
    if(window.ResizeObserver)new ResizeObserver(syncWeekUI).observe($('academic-week-navigator'));
    $('academic-week-navigator').addEventListener('keydown',event=>{
      const active=event.target.closest('[data-week]');
      if(!active||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const buttons=[...$('academic-week-navigator').querySelectorAll('[data-week]')],index=buttons.indexOf(active);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowRight'?1:-1)));
      if(next!==index)buttons[next].click();buttons[next].focus();
    });
    $('year-btn-row').addEventListener('click', e => {
      const b = e.target.closest('[data-year]'); if (!b) return;
      selectedYear = b.dataset.year;
      document.querySelectorAll('[data-year]').forEach(x => x.classList.toggle('active', x === b));
      render();
    });
    $('semester-btn-row').addEventListener('click', e => {
      const b = e.target.closest('[data-semester]'); if (!b) return;
      selectedSemester = b.dataset.semester;
      document.querySelectorAll('[data-semester]').forEach(x => x.classList.toggle('active', x === b));
      $('filter-month').value = 'all';
      renderWeekControls();
      refreshSessionScope();
    });
    $('week-mobile-select').addEventListener('change', e => { selectedWeek = Number(e.target.value); syncWeekUI(); refreshSessionScope(); });
    $('filter-month').addEventListener('change', e => {
      if (e.target.value !== 'all') {
        { const m=Number(e.target.value); selectedSemester = m>=7 ? 'fall' : (m<=3 ? 'winter' : 'spring'); }
        document.querySelectorAll('[data-semester]').forEach(x => x.classList.toggle('active', x.dataset.semester === selectedSemester));
        renderWeekControls();
      }
      refreshContentFilterScope();
    });
    $('reset-filters').addEventListener('click', resetFilters);
    $('cal-prev').addEventListener('click', () => moveCalendar(-1));
    $('cal-next').addEventListener('click', () => moveCalendar(1));
    $('cal-today').addEventListener('click', () => { setInitialAcademicPeriod(); $('filter-month').value='all'; renderWeekControls(); syncWeekUI(); refreshSessionScope(); toast('Moved to the current academic week.'); });
    $('cal-day-btn').addEventListener('click', () => switchCalendarView('day'));
    $('cal-week-btn').addEventListener('click', () => switchCalendarView('week'));
    $('cal-month-btn').addEventListener('click', () => switchCalendarView('month'));
    $('cal-list-btn').addEventListener('click', () => switchCalendarView('list'));
    $('list-academic-year').addEventListener('change',event=>{listAcademicYear=event.target.value;render()});
    $('list-session-mode').addEventListener('change',event=>{listSessionMode=event.target.value;renderList()});
    $('color-toggle').addEventListener('click', () => { colorsOn = !colorsOn; $('color-toggle').textContent = `Colors: ${colorsOn ? 'On' : 'Off'}`; render(); });
    $('dark-toggle').addEventListener('click', () => { document.documentElement.classList.toggle('dark'); $('dark-toggle').textContent = document.documentElement.classList.contains('dark') ? 'Light' : 'Moon'; });
    initializeScheduleFilters();
    $('account-toggle').addEventListener('click', () => currentUser ? openAccountModal() : openLoginModal());
    $('auth-setup-btn').addEventListener('click', openAuthSetupModal);
    $('gate-sign-in').addEventListener('click', openLoginModal);
    $('gate-auth-setup').addEventListener('click', openAuthSetupModal);
    $('bulk-add-session-btn').addEventListener('click', openBulkSessionForm);
    $('add-session-btn').addEventListener('click', () => openSessionForm());
    $('select-sessions-btn').addEventListener('click', startSessionSelection);
    $('selection-cancel-btn').addEventListener('click', cancelSessionSelection);
    $('review-selected-btn').addEventListener('click', reviewSelectedSessions);
    $('manage-users-btn').addEventListener('click', openUserManager);
    // BETA-R4D-12B2A1: visibility and click share one capability helper so they can
    // never disagree. Self-service roles reach the Dashboard's self-service view.
    $('ccc-schedule-btn').addEventListener('click', () => { if(currentUser) window.PAWS_CCC_SCHEDULE?.open(); });
    $('faculty-dashboard-btn').addEventListener('click', () => {
      if (UCVM.canOpenFacultyDashboard(currentUser)) window.location.href = 'faculty-admin.html';
    });
    $('teaching-assignments-btn').addEventListener('click', () => {
      if (currentUser && ['faculty','hicc','visc','developer','owner','administrator','adfa_general','adfa_regular','admin'].includes(String(currentUser.role || '').trim().toLowerCase())) window.location.href = 'teaching-assignments.html';
    });
    $('my-timetable-btn').addEventListener('click', () => { myTimetableOnly = !myTimetableOnly; $('my-timetable-btn').textContent = myTimetableOnly ? 'Show All Timetable' : 'My Timetable'; render(); });
    // HICC–CC / VISC directory for the academic year the Teaching Schedule is showing.
    $('hicc-cc-list-btn').addEventListener('click', () => { if(currentUser) window.PAWS_LEADERSHIP_DIRECTORY?.open('hicc-cc', window.UCVM_PAGE_DATA.academicYear() || sqlAcademicYearForDate(ymd(new Date()))); });
    $('visc-list-btn').addEventListener('click', () => { if(currentUser) window.PAWS_LEADERSHIP_DIRECTORY?.open('visc', window.UCVM_PAGE_DATA.academicYear() || sqlAcademicYearForDate(ymd(new Date()))); });
    $('export-csv').addEventListener('click', () => openExportDialog('csv'));
    $('export-calendar').addEventListener('click', () => openExportDialog('ics'));
    $('outlook-invite-btn').addEventListener('click', openOutlookInviteDialog);
    $('reset-test-data').addEventListener('click', resetTestData);
    $('publish-firestore-schedule').addEventListener('click', initializeLiveSchedule);
    addEventListener('ucvm:show-teaching',()=>{
      if(!currentUser)return;
      if(roleIsFaculty(currentUser)){viewMode=lastFacultyTeachingView;myTimetableOnly=true}
      setViewButtons();refreshSessionScope();
    });
    initializeWorkspaceNavigation();
  }

  function initializeWorkspaceNavigation() {
    const home=document.createElement('a');home.href='index.html';home.textContent='Teaching Schedule';home.setAttribute('aria-current','page');
    const entry=(id,icon)=>({node:$(id),icon});
    scheduleWorkspace=window.PAWS_WORKSPACE_NAVIGATION.mount({document,window,header:document.querySelector('.ucalgary-masthead-inner'),
      groups:[
        {label:'Teaching',entries:[{node:home,icon:'▦'},entry('teaching-assignments-btn','≡'),entry('ccc-schedule-btn','C'),entry('hicc-cc-list-btn','H'),entry('visc-list-btn','V')]},
        {label:'Faculty',entries:[entry('faculty-dashboard-btn','♙')]},
        {label:'Workflows',entries:[entry('swap-inbox-btn','⇄'),entry('afc-request-btn','↗'),entry('my-change-history-btn','◷')]},
        {label:'Administration',entries:[entry('manage-users-btn','⚙')]}
      ],globalNodes:[document.querySelector('.timetable-top-actions'),document.querySelector('.conn-status'),$('account-toggle'),$('dark-toggle')]});
  }

  function renderActiveContentFilters() {
    const month=$('filter-month');
    activeFilterView.render({search:$('search-input').value,month:month.value==='all'?null:{value:month.value,label:month.selectedOptions[0].textContent},
      courses:courseFilterActive?[...selectedCourses]:null,typeKeys:activityTypeFilter.selectedKeys(),types:activityTypeFilter.options()});
  }

  function changeContentFilter(kind,value) {
    let scopeChanged=false,coursesChanged=false;
    contentFilterBatch=true;
    try{
      if(kind==='clear'){
        $('search-input').value='';$('filter-month').value='all';selectedCourses.clear();courseFilterActive=false;
        activityTypeFilter.reset();scopeChanged=true;coursesChanged=true;
      }else if(kind==='search')$('search-input').value='';
      else if(kind==='month'){$('filter-month').value='all';scopeChanged=true;}
      else if(kind==='course'){selectedCourses.delete(value);coursesChanged=true;}
      else if(kind==='type')activityTypeFilter.setSelected(activityTypeFilter.selectedKeys().filter(key=>key!==value));
      else if(kind==='restore-courses'){courseFilterActive=false;selectedCourses.clear();coursesChanged=true;}
      else if(kind==='restore-types')activityTypeFilter.reset();
      else return;
    }finally{contentFilterBatch=false;}
    if(coursesChanged)populateCourseFilter();
    if(scopeChanged)refreshContentFilterScope();else render();
  }

  function refreshContentFilterScope() {
    const range=visibleSessionRange(),sameScope=currentUser&&sessionUnsubscribe&&sessionRangeKey===`${viewMode}:${range.start}:${range.end}`;
    // Month selection and chip removal share this path. Same-range subscriptions
    // return early; changed ranges render on load without a duplicate activity call.
    if(sameScope)render();else renderActiveContentFilters();
    return refreshSessionScope();
  }

  function resetFilters() {
    selectedYear = 'all'; selectedSemester = 'fall';
    document.querySelectorAll('[data-year]').forEach(x => x.classList.toggle('active', x.dataset.year === 'all'));
    document.querySelectorAll('[data-semester]').forEach(x => x.classList.toggle('active', x.dataset.semester === 'fall'));
    $('search-input').value = ''; $('filter-month').value = 'all'; activityTypeFilter.reset();
    selectedCourses.clear(); courseFilterActive=false; populateCourseFilter();
    myTimetableOnly = roleIsFaculty(currentUser); if (currentUser) $('my-timetable-btn').textContent = myTimetableOnly ? 'Show All Timetable' : 'My Timetable';
    selectedWeek = 1; renderWeekControls();
    refreshSessionScope();
  }

  function setViewButtons() {
    $('cal-day-btn').classList.toggle('active', viewMode === 'day');
    $('cal-week-btn').classList.toggle('active', viewMode === 'week');
    $('cal-month-btn').classList.toggle('active', viewMode === 'month');
    $('cal-list-btn').classList.toggle('active', viewMode === 'list');
    $('list-global-controls').classList.toggle('hidden', viewMode !== 'list');
    $('cal-prev').disabled=viewMode==='list'; $('cal-next').disabled=viewMode==='list';
  }

  function moveCalendar(delta){
    if(viewMode==='list')return;
    if(viewMode==='day'){
      let date=addDays(weekStart(selectedWeek,selectedSemester),selectedDayIndex);
      do{date=addDays(date,delta)}while(date.getDay()===0||date.getDay()===6);
      const position=academicPositionForDate(date); selectedSemester=position.semester; selectedWeek=Math.max(1,Math.min(WEEK_COUNT,position.week)); selectedDayIndex=date.getDay()-1;
      document.querySelectorAll('[data-semester]').forEach(x=>x.classList.toggle('active',x.dataset.semester===selectedSemester));
      renderWeekControls();syncWeekUI();refreshSessionScope();return;
    }
    selectedWeek=Math.max(1,Math.min(WEEK_COUNT,selectedWeek+delta));syncWeekUI();refreshSessionScope();
  }

  function filteredSessions(source=sessions, options={}) {
    activityTypeFilter.setSessionTypes(source.filter(row=>!row.isWorkingActivity).map(row=>row.type));
    const q = $('search-input').value.trim().toLowerCase();
    const searchWords=q.split(/[\s,]+/).filter(Boolean);
    const month = $('filter-month').value;
    return source.filter(s => {
      if(s.isWorkingActivity?!activityTypeFilter.matchesActivity(s.sourceActivity):!activityTypeFilter.matchesSession(s))return false;
      if ((!options.ignorePeriod||selectedYear==='rotation') && !(window.PAWS_ACTIVITY_PLACEMENT?.matchesYear(s,selectedYear)??(selectedYear==='all'||String(s.year)===selectedYear))) return false;
      if (!options.ignorePeriod && s.semester !== selectedSemester) return false;
      if (!options.ignorePeriod && month !== 'all' && String(parseYmd(s.date).getMonth()) !== month) return false;
      if (courseFilterActive && !selectedCourses.has(String(s.course))) return false;
      if (myTimetableOnly && currentUser && !sessionBelongsToCurrentFaculty(s)) return false;
      if (searchWords.length && !searchWords.every(word=>`${s.course} ${s.topic} ${displayFacultyList(s.instructor||'')} ${s.room} ${s.type}`.toLowerCase().includes(word))) return false;
      return true;
    });
  }

  // Search is a filter over data the view already holds, so one trailing render
  // per burst is enough. Enter applies immediately (a keyboard action cannot be
  // lost to the re-render the way a queued mouse click can), and every other
  // render supersedes a pending search render.
  function wireCalendarSearchInput(input,{schedule,flush}={}) {
    if (!input || typeof schedule !== 'function') return null;
    input.addEventListener('input', () => schedule());
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || typeof flush !== 'function') return;
      flush();
    });
    return input;
  }

  // Search is bound after the generic controls so the debounce owns the input
  // event outright. Without the module the field keeps its immediate listener.
  function bindCalendarSearchInput() {
    const input = $('search-input');
    if (!input) return null;
    if (searchDebouncer) {
      return wireCalendarSearchInput(input, { schedule: () => searchDebouncer.schedule(), flush: () => searchDebouncer.flush() });
    }
    input.addEventListener('input', render);
    return input;
  }

  function render() {
    if(searchDebouncer)searchDebouncer.cancel();
    renderCalendarView();
    renderWorkingActivities();
    renderActiveContentFilters();
  }

  function renderCalendarView() {
    if(viewMode==='day')renderDay();
    else if(viewMode==='week')renderWeek();
    else if(viewMode==='month')renderMonth();
    else renderList();
  }

  function workingActivityScope(range) {
    return {uid:String(currentUser?.uid||''),role:String(currentUser?.role||currentUser?.profile?.role||''),supportContextId:String(window.PAWS_SUPPORT?.contextId?.()||''),start:range?.start||'',end:range?.end||'',facultyId:myTimetableOnly?String(currentUser?.profile?.facultyId||''):'',selfOnly:Boolean(myTimetableOnly&&roleIsFaculty(currentUser?.profile))};
  }

  function resetWorkingCalendar() {
    workingCalendarRows=[];workingCalendarScope='';++workingActivityRenderToken;
    workingActivityCache?.invalidate();window.PAWS_CALENDAR_ACTIVITIES?.clear();
  }

  function calendarSourceSessions() {
    const scope=workingActivityScope(workingActivityRange());
    return currentUser&&workingCalendarScope===JSON.stringify(scope)?[...sessions,...workingCalendarRows]:sessions;
  }

  function setCalendarActivityRows(rows,{range,scope}) {
    if(JSON.stringify(scope)!==JSON.stringify(workingActivityScope(range)))return;
    const placement=window.PAWS_ACTIVITY_PLACEMENT;
    if(!placement)throw Error('Calendar activity display is unavailable. Reload to retry.');
    const projected=placement.projectSessions(rows,range).map(row=>{
      const year=Number(row.date.slice(0,4))-(Number(row.date.slice(5,7))<5?1:0);
      return {...row,...academicPositionForDate(parseYmd(row.date)),academicYear:`${year}-${String(year+1).slice(-2)}`,activityOwnerUid:scope.uid,activityFacultyId:scope.facultyId};
    });
    workingCalendarRows=projected;workingCalendarScope=JSON.stringify(scope);
    if($('working-activities-lane'))$('working-activities-lane').innerHTML='';
    renderCalendarView();
  }

  function workingActivityRange() {
    const week = weekStart(selectedWeek, selectedSemester);
    if (viewMode === 'day') { const date=addDays(week,selectedDayIndex);return {start:ymd(date),end:ymd(addDays(date,1))}; }
    if (viewMode === 'month') {
      const choice=$('filter-month').value,month=choice==='all'?week.getMonth():Number(choice),year=month>=4?2026:2027;
      return {start:ymd(new Date(year,month,1)),end:ymd(new Date(year,month+1,1))};
    }
    if (viewMode === 'list') {
      return window.PAWS_CALENDAR_ACTIVITIES?.academicRange(listAcademicYear)||null;
    }
    return {start:ymd(week),end:ymd(addDays(week,7))};
  }

  async function renderWorkingActivities(refresh = false, retryCancelled = true) {
    const host=$('working-activities-lane'),view=window.PAWS_CALENDAR_ACTIVITIES,token=++workingActivityRenderToken,uid=currentUser?.uid;
    if(!host)return;
    if(!currentUser||!view||reviewingSelection){view?.clear();host.innerHTML='';return;}
    const range=workingActivityRange();if(!range){host.textContent='Select an academic year to view working activities.';return;}
    const filters={typeKeys:activityTypeFilter.selectedKeys(),search:$('search-input').value.trim()};
    if(!filters.typeKeys.some(key=>key.startsWith('work:'))){view.clear();host.innerHTML='';return;}
    const facultyId=myTimetableOnly?String(currentUser.profile?.facultyId||''):'';
    // Calendar activity rows are scoped by identity, support context, requested
    // range and faculty scope. Search text and activity-type filters are applied
    // by renderRangeLane to rows already in memory, so they deliberately do not
    // take part in the cache key: typing or toggling a type must not refetch.
    const scope=workingActivityScope(range);
    const current=()=>token===workingActivityRenderToken&&uid===currentUser?.uid;
    const paint=rows=>{if(current())setCalendarActivityRows(rows,{range,scope,filters});};
    // A faculty-scoped view without a linked faculty id legitimately has no rows;
    // it is not an empty cache entry and must not be requested.
    if(myTimetableOnly&&!facultyId){paint([]);return;}
    if(workingActivityCache&&!refresh){
      const cached=workingActivityCache.peek(scope);
      if(cached){paint(cached);return;}
    }
    host.innerHTML='<p class="activity-notice" role="status">Loading working activities…</p>';
    const load=loadScope=>loadScope.facultyId
      ? view.loadFacultyRange(loadScope.facultyId,{start:loadScope.start,end:loadScope.end},{self:loadScope.selfOnly,onCancel:'throw'})
      : view.loadRange({start:loadScope.start,end:loadScope.end},{onCancel:'throw'});
    try{
      const rows=workingActivityCache
        ? await workingActivityCache.get(scope,{refresh:refresh===true,load})
        : await load(scope);
      paint(rows);
    }catch(error){
      if(!current())return;
      // A -> B -> A can rejoin an A promise already superseded by B. Only the
      // visible render retries, bypassing that promise once. A second cancellation
      // exposes Retry instead of leaving Loading forever or starting a loop.
      if(retryCancelled&&(error?.code==='CALENDAR_ACTIVITY_CANCELLED'||error?.name==='AbortError'))return renderWorkingActivities(true,false);
      host.innerHTML='<p class="activity-notice activity-error" role="alert">Working activities could not be loaded. Teaching sessions remain available. <button type="button" data-activity-retry>Retry</button></p>';
      const retry=host.querySelector('[data-activity-retry]');
      if(retry)retry.onclick=()=>renderWorkingActivities(true);
    }
  }


  // The LAB grouping is a visual projection only. renderedSessions, SQL IDs,
  // selection operations and the pre-existing LAB modal still use original rows.
  function calendarDisplaySessions(rows,options={}){
    return selectionMode?rows:(window.UCVM_LAB_DETAIL?.calendarBlocks?.(rows,options)||rows);
  }

  function layoutDaySessions(items) {
    const sorted = items.map(session=>({session,timing:calendarTimingDisposition(session)}))
      .filter(item=>item.timing.disposition==='grid')
      .map(({session,timing})=>({session,startM:timing.startMinutes,endM:timing.endMinutes,lane:0,laneCount:1}))
      .sort((a,b) => a.startM-b.startM || a.endM-b.endM);
    const groups=[]; let group=[]; let groupMaxEnd=-1;
    const flush = () => {
      if (!group.length) return;
      const laneEnds=[];
      group.forEach(item => {
        let lane=laneEnds.findIndex(end => end <= item.startM);
        if (lane < 0) { lane=laneEnds.length; laneEnds.push(item.endM); } else laneEnds[lane]=item.endM;
        item.lane=lane;
      });
      const count=Math.max(1,laneEnds.length); group.forEach(item => item.laneCount=count);
      groups.push(...group); group=[]; groupMaxEnd=-1;
    };
    sorted.forEach(item => {
      if (group.length && item.startM >= groupMaxEnd) flush();
      group.push(item); groupMaxEnd=Math.max(groupMaxEnd,item.endM);
    });
    flush(); return groups;
  }

  // Shared Day/Week calendar window. `validateInterval()` answers "is this a
  // well-formed interval?" (end after start); it deliberately knows nothing about
  // the visible grid. A session can be a valid interval and still be unpositionable
  // here (e.g. 01:30-02:30 sits entirely before the grid). The grid predicate and the
  // check-needed predicate below must stay a partition: every session is EITHER
  // grid-positionable OR check-needed. Never re-derive positionability from raw
  // minutes elsewhere, or the two sides can disagree and a session vanishes.
  const CALENDAR_DAY_START=450, CALENDAR_DAY_END=1020;

  // Canonical display decision for the Day/Week grid. Returns the timing check plus a
  // disposition of 'invalid' | 'grid' | 'before' | 'after'.
  // Self-contained by design: the beta-freeze test harness extracts this function and
  // evaluates it in isolation, so it must not depend on outer-scope bindings.
  function calendarTimingDisposition(session){
    const dayStart=450, dayEnd=1020;
    const core=(typeof scheduling!=='undefined'&&scheduling)?scheduling:window.UCVM_SCHEDULING;
    const date=String(session?.date||'');
    const parsedDate=new Date(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==date||!core.normalizeDate(date))return{timing:{status:'invalid-date'},disposition:'invalid-date',startMinutes:null,endMinutes:null};
    const timing=core.validateInterval(session.start,session.end,{timeUnknown:session.timeUnknown===true});
    if(timing.status!=='valid')return{timing,disposition:'invalid',startMinutes:null,endMinutes:null};
    if(timing.endMinutes<=dayStart)return{timing,disposition:'before',startMinutes:timing.startMinutes,endMinutes:timing.endMinutes};
    if(timing.startMinutes>=dayEnd)return{timing,disposition:'after',startMinutes:timing.startMinutes,endMinutes:timing.endMinutes};
    return{timing,disposition:'grid',startMinutes:timing.startMinutes,endMinutes:timing.endMinutes};
  }

  function isGridPositionable(session){ return calendarTimingDisposition(session).disposition==='grid'; }

  function unpositionedReason(session,disposition){
    if(disposition==='invalid-date')return 'Date unknown or invalid';
    if(session.timeUnknown===true)return 'Time unknown';
    if(disposition==='invalid')return 'Invalid time interval';
    if(disposition==='before')return 'Outside calendar hours - before grid';
    if(disposition==='after')return 'Outside calendar hours - after grid';
    return 'Unpositionable';
  }

  // Heading is deliberately truthful: an out-of-grid session is not necessarily a
  // wrong time. We surface it for review instead of discarding or "correcting" it.
  function unpositionedSessionsHtml(items){
    const rows=items.map(session=>({session,check:calendarTimingDisposition(session)}))
      .filter(row=>row.check.disposition!=='grid');
    if(!rows.length)return'';
    const heading='Sessions not shown in calendar grid - Check needed';
    const list=rows.map(({session,check})=>{
      const stored=session.start||session.end?`${session.start||''}-${session.end||''}`.replace(/^-|-$/g,''):'';
      const bits=[escapeHtml(session.date||''),escapeHtml(String(session.course||'')),escapeHtml(String(session.type||'')),escapeHtml(String(session.topic||''))].filter(Boolean).join(' · ');
      const reason=escapeHtml(unpositionedReason(session,check.disposition));
      return `<button class="btn btn-secondary untimed-session" data-session-id="${escapeHtml(session.id)}"><span class="untimed-session-line">${bits}</span>${stored?`<span class="untimed-session-time">${escapeHtml(stored)}</span>`:''}<span class="untimed-session-reason">${reason}</span></button>`;
    }).join('');
    return `<section class="untimed-sessions"><h3>${heading} <span class="untimed-count">${rows.length}</span></h3><div class="untimed-sessions-list">${list}</div></section>`;
  }

  function renderDay() {
    const date=addDays(weekStart(selectedWeek,selectedSemester),selectedDayIndex), dateText=ymd(date);
    $('cal-label').textContent=formatLongDate(date);
    const data=filteredSessions(calendarSourceSessions()).filter(s=>s.date===dateText);
    renderedSessions=data;
    const DAY_START=CALENDAR_DAY_START,DAY_END=CALENDAR_DAY_END,SPAN=DAY_END-DAY_START,marks=[450,480,540,600,660,720,780,840,900,960,1020];
    let html=`<div class="tg-wrap day-single"><div class="tg-corner"></div><div class="tg-day-head"><div class="week-dow">${DAYS[selectedDayIndex]}</div><div class="week-date">${date.getDate()}</div></div></div><div class="tg-body day-single"><div class="tg-time-axis"><div class="tg-track">`;
    marks.forEach(m=>{const top=((m-DAY_START)/SPAN)*100,h=Math.floor(m/60),min=m%60,h12=((h+11)%12)+1;html+=`<span class="tg-hour-label" style="top:${top}%">${h12}:${String(min).padStart(2,'0')}</span>`});
    html+='</div></div><div class="tg-day-col">';
    marks.forEach(m=>{html+=`<div class="tg-gridline" style="top:${((m-DAY_START)/SPAN)*100}%"></div>`});
    layoutDaySessions(calendarDisplaySessions(data,{gridOnly:true})).forEach(item=>{
      const s=item.session,startM=Math.max(DAY_START,item.startM),endM=Math.min(DAY_END,item.endM);if(endM<=startM)return;
      const top=((startM-DAY_START)/SPAN)*100,height=Math.max(3.5,((endM-startM)/SPAN)*100),laneWidth=100/item.laneCount,left=item.lane*laneWidth;
      html+=`<div class="tg-block ${colorsOn?sessionTypeClass(s.type):'colors-off'}" data-session-id="${escapeHtml(s.id)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);right:auto;width:calc(${laneWidth}% - 4px)"><div class="tg-block-l1">${escapeHtml(s.course)} - ${escapeHtml(s.type)}${(Array.isArray(s.labDisplayIds)?s.labDisplayIds:[s.id]).some(id=>window.PAWS_SWAP?.isPending(id))?'<span class="sql-swap-pending">SWAP PENDING</span>':''}</div><div class="tg-block-l2">${escapeHtml(s.topic)}</div><div class="tg-block-l3">${escapeHtml(s.start)}-${escapeHtml(s.end)}${s.labDisplayCount>1?' · '+s.labDisplayCount+' LAB sessions':(s.room?` | ${escapeHtml(s.room)}`:'')+'<br>'+escapeHtml(displayFacultyList(s.instructor||'TBD'))}</div></div>`;
    });
    html+='</div></div>'+(window.PAWS_TASKS?'':unpositionedSessionsHtml(data));$('calendar-body').innerHTML=html;bindSessionBlocks();
  }

  function renderWeek() {
    const start = weekStart(selectedWeek, selectedSemester); const end = addDays(start, 4);
    $('cal-label').textContent = `${selectedSemester === 'winter' ? 'Winter' : (selectedSemester === 'spring' ? 'Spring' : 'Fall')} Week ${selectedWeek} - ${formatDate(start)} to ${formatDate(end)}, ${end.getFullYear()}`;
    const data = filteredSessions(calendarSourceSessions()).filter(s => s.isWorkingActivity?s.date>=ymd(start)&&s.date<=ymd(end):s.week===selectedWeek);
    renderedSessions=data;
    const DAY_START=CALENDAR_DAY_START, DAY_END=CALENDAR_DAY_END, SPAN=DAY_END-DAY_START; // 7:30am-5:00pm
    let html = '<div class="tg-wrap"><div class="tg-corner"></div>';
    for (let i = 0; i < 5; i++) {
      const d = addDays(start, i);
      html += `<div class="tg-day-head"><div class="week-dow">${DAYS[i]}</div><div class="week-date">${d.getDate()}</div></div>`;
    }
    html += '</div><div class="tg-body"><div class="tg-time-axis"><div class="tg-track">';
    const marks=[450,480,540,600,660,720,780,840,900,960,1020];
    marks.forEach(m => {
      const top=((m-DAY_START)/SPAN)*100, h=Math.floor(m/60), min=m%60, h12=((h+11)%12)+1;
      html += `<span class="tg-hour-label" style="top:${top}%">${h12}:${String(min).padStart(2,'0')}</span>`;
    });
    html += '</div></div>';
    for (let day = 0; day < 5; day++) {
      const date = ymd(addDays(start, day));
      html += '<div class="tg-day-col">';
      marks.forEach(m => { const top=((m-DAY_START)/SPAN)*100; html += `<div class="tg-gridline" style="top:${top}%"></div>`; });
      const dayItems=layoutDaySessions(calendarDisplaySessions(data.filter(s => s.date === date),{gridOnly:true}));
      dayItems.forEach(item => {
        const s=item.session;
        const startM = Math.max(DAY_START, item.startM), endM = Math.min(DAY_END, item.endM);
        if (endM <= startM) return;
        const top = ((startM - DAY_START) / SPAN) * 100;
        const height = Math.max(3.5, ((endM - startM) / SPAN) * 100);
        const laneWidth=100/item.laneCount, left=item.lane*laneWidth;
        html += `<div class="tg-block ${colorsOn ? sessionTypeClass(s.type) : 'colors-off'} " data-session-id="${escapeHtml(s.id)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);right:auto;width:calc(${laneWidth}% - 4px)">
          <div class="tg-block-l1">${escapeHtml(s.course)} - ${escapeHtml(s.type)}${(Array.isArray(s.labDisplayIds)?s.labDisplayIds:[s.id]).some(id=>window.PAWS_SWAP?.isPending(id))?'<span class="sql-swap-pending">SWAP PENDING</span>':''}</div>
          <div class="tg-block-l2">${escapeHtml(s.topic)}</div>
          <div class="tg-block-l3">${escapeHtml(s.start)}-${escapeHtml(s.end)}${s.labDisplayCount>1?' · '+s.labDisplayCount+' LAB sessions':(s.room ? ` | ${escapeHtml(s.room)}` : '')+'<br>'+escapeHtml(displayFacultyList(s.instructor || 'TBD'))}</div>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    $('calendar-body').innerHTML = html+(window.PAWS_TASKS?'':unpositionedSessionsHtml(data));
    bindSessionBlocks();
  }

  function renderMonth() {
    const wstart = weekStart(selectedWeek, selectedSemester);
    const monthChoice = $('filter-month').value;
    const month = monthChoice === 'all' ? wstart.getMonth() : Number(monthChoice);
    const year = month >= 4 ? 2026 : 2027;
    const first = new Date(year, month, 1); const last = new Date(year, month + 1, 0);
    $('cal-label').textContent = first.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
    let monday = new Date(first);
    const jsDay = monday.getDay();
    const delta = jsDay === 0 ? -6 : 1 - jsDay;
    monday.setDate(monday.getDate() + delta);
    const data = filteredSessions(calendarSourceSessions());
    renderedSessions=data;
    let html = '<div class="cal-month"><div class="cal-dow-header">' + DAYS.map(d => `<div class="cal-dow">${d}</div>`).join('') + '</div><div class="cal-grid">';
    let cursor = new Date(monday);
    while (cursor <= last || cursor.getDay() !== 1) {
      for (let i = 0; i < 5; i++) {
        const cell = addDays(cursor, i); const dateStr = ymd(cell);
        const events = calendarDisplaySessions(data.filter(s => s.date === dateStr));
        html += `<div class="cal-cell"><div class="cal-date-num">${cell.getDate()}</div><div class="cal-events">`;
        const eventHtml=s=>`<div class="cal-event ${colorsOn ? sessionTypeClass(s.type) : 'colors-off'} " data-session-id="${escapeHtml(s.id)}"><div class="cal-event-l1">${escapeHtml(s.course)} ${escapeHtml(s.type)}</div><div class="cal-event-l2">${s.timeUnknown?'Time not specified':escapeHtml(s.start)+(s.labDisplayCount>1?'–'+escapeHtml(s.end):'')} ${escapeHtml(s.topic)}${s.labDisplayCount>1?' · '+s.labDisplayCount+' LAB sessions':''}</div></div>`;
        html+=events.slice(0,4).map(eventHtml).join('');
        if(events.length>4)html+=`<details class="cal-more"><summary>${events.length-4} more activities</summary>${events.slice(4).map(eventHtml).join('')}</details>`;
        html += '</div></div>';
      }
      cursor = addDays(cursor, 7);
      if (cursor.getMonth() > month && cursor > last && cursor.getDate() > 7) break;
    }
    html += '</div></div>';
    $('calendar-body').innerHTML = html;
    bindSessionBlocks();
  }

  function renderList(){
    if(reviewingSelection){renderSelectionEditor();return}
    const anchor=weekStart(selectedWeek,selectedSemester),baseYear=anchor.getFullYear()-(anchor.getMonth()<4?1:0),currentYear=`${baseYear}-${String(baseYear+1).slice(-2)}`;
    const years=[...new Set([...sessions.map(session=>String(session.academicYear||'').trim()).filter(Boolean),...[-1,0,1].map(offset=>`${baseYear+offset}-${String(baseYear+offset+1).slice(-2)}`)])].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    if(!years.includes(listAcademicYear))listAcademicYear=currentYear;
    const yearSelect=$('list-academic-year');
    if(yearSelect){const options=years.map(year=>`<option value="${escapeHtml(year)}" ${year===listAcademicYear?'selected':''}>${escapeHtml(year)}</option>`).join('');if(yearSelect.innerHTML!==options)yearSelect.innerHTML=options;yearSelect.value=listAcademicYear}
    $('list-session-mode').value=listSessionMode;
    const yearSessions=calendarSourceSessions().filter(session=>String(session.academicYear||'')===listAcademicYear&&(window.PAWS_ACTIVITY_PLACEMENT?.matchesYear(session,selectedYear)??true));
    const classified=filteredSessions(yearSessions,{ignorePeriod:true}).map(session=>({session,check:calendarTimingDisposition(session)}));
    const checkRows=classified.filter(row=>row.check.disposition!=='grid');
    const gridRows=classified.filter(row=>row.check.disposition==='grid');
    const selected=listSessionMode==='CHECK NEEDED'?checkRows:listSessionMode==='GRID-READY'?gridRows:classified;
    const data=selected.map(row=>row.session).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.start||'').localeCompare(String(b.start||''))||String(a.course||'').localeCompare(String(b.course||''))||String(a.id||'').localeCompare(String(b.id||'')));
    const reasonCounts=new Map();
    for(const {session,check} of checkRows){const reason=unpositionedReason(session,check.disposition);reasonCounts.set(reason,(reasonCounts.get(reason)||0)+1)}
    const reasonSummary=[...reasonCounts].sort((a,b)=>a[0].localeCompare(b[0])).map(([reason,count])=>`${reason}: ${count}`).join(' · ');
    $('cal-label').textContent=`${listAcademicYear||'No academic year'} · ${selected.length} sessions`;
    renderedSessions=data;
    const rows=data.map(s=>{const disposition=calendarTimingDisposition(s),reason=disposition.disposition==='grid'?'Grid ready':unpositionedReason(s,disposition.disposition);return `<tr data-session-id="${escapeHtml(s.id)}"><td>${escapeHtml(s.date||'Date unknown')}</td><td>${escapeHtml(s.timeUnknown?'Time TBD':`${s.start||''}-${s.end||''}`)}</td><td>${escapeHtml(reason)}</td><td><strong>${escapeHtml(s.course)}</strong></td><td>${escapeHtml(s.type)}</td><td>${escapeHtml(s.topic)}</td><td>${escapeHtml(displayFacultyList(s.instructor||'TBD'))}</td><td>${escapeHtml(s.room||'')}</td></tr>`}).join('');
    const partition=`<p class="list-partition-summary">${gridRows.length} grid ready · ${checkRows.length} check needed${reasonSummary?` · ${escapeHtml(reasonSummary)}`:''}</p>`;
    $('calendar-body').innerHTML=`${partition}<div class="schedule-list-wrap"><table class="schedule-list"><thead><tr><th>Date</th><th>Time</th><th>Grid status</th><th>Course</th><th>Type</th><th>Topic</th><th>Faculty</th><th>Room</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="empty-cell">No sessions match this academic year and filter.</td></tr>'}</tbody></table></div>`;
    bindSessionBlocks();
  }

  let sessionBlockController = null;
  // Fallback used only when calendar-search.js did not load. It keeps the same
  // delegated, O(N) contract (one container listener, one id index) instead of
  // restoring a listener and a linear scan per rendered row, so session detail
  // clicks, selection mode and CCC read-only behaviour survive a failed asset.
  function createInlineSessionBlockController(options) {
    const host=options&&options.host,query='[data-session-id]';
    if(!host||typeof host.addEventListener!=='function'||typeof host.querySelectorAll!=='function')return null;
    let index=new Map(),bound=false;
    function activate(id){
      const row=index.get(String(id));
      if(!options.getSelectionMode()){options.onOpen(String(id));return;}
      if(row&&(row.isCcc||row.readOnlyActivity)){options.onRejected((row.isCcc?'CCC':'Working activity')+' records are read-only and cannot be selected.');return;}
      try{options.onToggle(String(id),row);}
      catch(error){options.onRejected(error&&error.message?error.message:String(error));}
    }
    function handleClick(event){
      const target=event&&event.target;
      if(!target||typeof target.closest!=='function')return;
      const element=target.closest(query);
      if(!element||!element.dataset||element.dataset.sessionId===undefined||element.dataset.sessionId===null)return;
      activate(element.dataset.sessionId);
    }
    return {refresh(){
      index=new Map();
      for(const row of options.getRows()||[]){if(row&&row.id!==undefined&&row.id!==null)index.set(String(row.id),row);}
      const selectionMode=Boolean(options.getSelectionMode());
      for(const element of host.querySelectorAll(query)){
        const id=element&&element.dataset?element.dataset.sessionId:null;
        if(id===undefined||id===null||id==='')continue;
        const row=index.get(String(id));
        element.classList.toggle('selection-candidate',selectionMode&&!row?.isCcc&&!row?.readOnlyActivity);
        element.classList.toggle('selection-selected',Boolean(options.isSelected(String(id))));
      }
      if(!bound){bound=true;host.addEventListener('click',handleClick);}
    }};
  }

  // #calendar-body is stable across view changes (only its innerHTML is
  // replaced), so one delegated listener and one id index survive every render.
  // This replaces a per-row listener plus a linear session scan per row.
  function scheduledSessionBlockController() {
    if(sessionBlockController)return sessionBlockController;
    const host=$('calendar-body'),factory=window.UCVM_CALENDAR_SEARCH;
    if(!host)return null;
    const options={
      host,
      getRows:()=>renderedSessions,
      getSelectionMode:()=>selectionMode,
      isSelected:id=>sessionSelection.has(id),
      onOpen:id=>openSessionDetail(id),
      onToggle:(id,row)=>{
        const selected=sessionSelection.toggle(id);
        if(selected&&row)selectedSessionOriginals.set(String(row.id),JSON.parse(JSON.stringify(row)));
        if(!selected)selectedSessionOriginals.delete(String(id));
        updateSelectionControls();render();
      },
      onRejected:message=>toast(message,true)
    };
    sessionBlockController=factory?.createSessionBlockController?factory.createSessionBlockController(options):createInlineSessionBlockController(options);
    return sessionBlockController;
  }

  function bindSessionBlocks() {
    scheduledSessionBlockController()?.refresh();
  }

  function switchCalendarView(next){
    viewMode=next;
    if(selectionMode&&reviewingSelection)reviewingSelection=false;
    if(roleIsFaculty(currentUser)&&(next==='day'||next==='list'))lastFacultyTeachingView=next;
    setViewButtons();refreshSessionScope();
  }

  async function startSessionSelection(){
    if(!requireSessionWrites())return;
    if(!canEdit())return;
    await ensureFacultyDirectory();
    selectionViewFlow.begin(viewMode);
    selectionMode=true;reviewingSelection=false;document.body.classList.add('session-selection-mode');updateSelectionControls();render();
  }
  function cancelSessionSelection(){
    viewMode=selectionViewFlow.finish();selectionMode=false;reviewingSelection=false;sessionSelection.clear();selectedSessionOriginals.clear();document.body.classList.remove('session-selection-mode');updateSelectionControls();setViewButtons();refreshSessionScope();
  }
  function updateSelectionControls(){
    const active=$('selection-active-actions');
    $('select-sessions-btn').classList.toggle('hidden',selectionMode);
    active.classList.toggle('hidden',!selectionMode);
    $('selection-count').textContent=`${sessionSelection.size} selected`;
    $('review-selected-btn').disabled=sessionSelection.size===0;
  }
  async function reviewSelectedSessions(){
    if(!selectionMode||!sessionSelection.size)return;
    await ensureFacultyDirectory();
    reviewingSelection=true;viewMode=selectionViewFlow.review();setViewButtons();render();
  }

  function selectionFacultyOptions(session,doeState){
    const selected=new Set([...(session.facultyIds||[]),...(session.assignments||[]).map(a=>a.ucid||a.facultyId)].filter(Boolean).map(String));
    return facultyDirectory.map(f=>{const state=doeState.get(String(f.__id))||{},current=state.current===null||state.current===undefined?'Unavailable':swapPct(state.current),target=state.target||window.UCVM_FACULTY_DOE.effectiveTarget(f),targetLabel=window.UCVM_FACULTY_DOE.targetLabel(f);return `<label class="selection-faculty-option"><input type="checkbox" data-selection-faculty-option value="${escapeHtml(f.__id)}" ${selected.has(String(f.__id))?'checked':''}><span><strong>${escapeHtml(displayFaculty(swapFacultyName(f)))}</strong><small>Assigned DOE ${current} · ${escapeHtml(targetLabel)}${target.source==='override'?'<span class="doe-override-pill">Override</span>':''}</small></span></label>`}).join('');
  }
  function updateSelectionFacultyPicker(picker){
    const checked=[...picker.querySelectorAll('[data-selection-faculty-option]:checked')],summary=picker.querySelector('summary'),chips=picker.querySelector('.selection-faculty-chips');
    summary.textContent=checked.length?`${checked.length} faculty selected`:'Choose faculty';
    chips.innerHTML=checked.map(input=>{const f=facultyDirectory.find(row=>String(row.__id)===String(input.value)),state=selectionDoeState.get(String(input.value))||{},current=state.current===null||state.current===undefined?'DOE unavailable':`Assigned ${swapPct(state.current)}`;return `<span>${escapeHtml(displayFaculty(swapFacultyName(f)))}<small>${current}</small></span>`}).join('');
  }
  function renderSelectionEditor(){
    if($('calendar-body').querySelector('[data-selection-row]'))return;
    const data=window.UCVM_TIMETABLE_SELECTION.selectedRows([...selectedSessionOriginals.values()],sessionSelection.ids());
    renderedSessions=data;
    $('cal-label').textContent=`Review ${data.length} selected session${data.length===1?'':'s'}`;
    const doeState=buildSwapDoeState();selectionDoeState=doeState;
    const rows=data.map(s=>`<tr data-selection-row data-session-edit-id="${escapeHtml(s.id)}">
      <td><input type="date" data-selection-field="date" value="${escapeHtml(s.date)}"></td>
      <td><select data-selection-field="year">${[1,2,3,4].map(year=>`<option ${Number(s.year)===year?'selected':''}>${year}</option>`).join('')}</select></td>
      <td><input data-selection-field="course" value="${escapeHtml(s.course)}"></td>
      <td><input data-selection-field="type" value="${escapeHtml(s.type)}"></td>
      <td><input type="time" data-selection-field="start" value="${escapeHtml(s.start)}"></td>
      <td><input type="time" data-selection-field="end" value="${escapeHtml(s.end)}"></td>
      <td><input data-selection-field="topic" value="${escapeHtml(s.topic)}"></td>
      <td><input data-selection-field="room" value="${escapeHtml(s.room)}"></td>
      <td><details class="selection-faculty-picker" data-selection-field="faculty"><summary>Choose faculty</summary><div class="selection-faculty-menu"><div class="selection-faculty-options">${selectionFacultyOptions(s,doeState)}</div></div></details><div class="selection-faculty-chips"></div></td>
    </tr>`).join('');
    $('calendar-body').innerHTML=`<div class="selection-errors hidden" id="selection-errors" role="alert"></div><div class="selection-sheet-wrap"><table class="selection-sheet"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>Faculty</th></tr></thead><tbody>${rows}</tbody></table></div><div class="selection-save-bar"><span>Open Faculty to choose one or more people and review their DOE.</span><button class="btn btn-secondary" id="selection-back-btn">Back to selection</button><button class="btn btn-primary" id="selection-save-btn">Save selected changes</button></div>`;
    document.querySelectorAll('.selection-faculty-picker').forEach(picker=>{picker.querySelectorAll('[data-selection-faculty-option]').forEach(input=>input.onchange=()=>updateSelectionFacultyPicker(picker));updateSelectionFacultyPicker(picker)});
    $('selection-back-btn').onclick=()=>{reviewingSelection=false;viewMode=selectionViewFlow.finish();setViewButtons();render();refreshSessionScope()};
    $('selection-save-btn').onclick=saveSelectedChanges;
  }
  function readSelectionRows(){
    const originals=new Map([...selectedSessionOriginals].map(([id,row])=>[String(id),row]));
    return [...document.querySelectorAll('[data-selection-row]')].map(tr=>{
      const id=String(tr.dataset.sessionEditId),original=originals.get(id),value=field=>tr.querySelector(`[data-selection-field="${field}"]`).value;
      const ids=[...tr.querySelectorAll('[data-selection-faculty-option]:checked')].map(option=>String(option.value));
      const type=value('type'),start=value('start'),end=value('end'),topic=value('topic'),date=value('date'),position=academicPositionForDate(parseYmd(date)),originalIds=[...(original.facultyIds||[]),...(original.assignments||[]).map(a=>a.ucid||a.facultyId)].filter(Boolean).map(String),assignmentChanged=ids.join('|')!==[...new Set(originalIds)].join('|')||type!==String(original.type||'')||start!==String(original.start||'')||end!==String(original.end||'')||topic!==String(original.topic||'');
      const assignments=assignmentChanged?ids.map(facultyId=>{const faculty=facultyDirectory.find(f=>String(f.__id)===facultyId),previous=(original.assignments||[]).find(a=>String(a.ucid||a.facultyId||'')===facultyId)||{},role=previous.role||defaultTeachingRole(type),hours=swapNumeric(previous.creditedHours)??blockHours(start,end,{timeUnknown:original.timeUnknown===true&&start===String(original.start||'')&&end===String(original.end||'')}),rate=doeRateForRole(role);return{...previous,ucid:facultyId,facultyId,name:swapFacultyName(faculty),role,topic,creditedHours:hours,doeRate:rate,doeCredit:swapNumeric(previous.doeCredit)??(rate===null||hours===null?null:Number((hours*rate).toFixed(6))),source:'Multi-session timetable edit'}}):original.assignments;
      const course=value('course');
      return{...original,id,date,week:position.week,semester:position.semester,year:Number(value('year')),course,courseName:course===String(original.course||'')?original.courseName:(COURSES.find(c=>String(c.code)===course)?.name||''),type,start,end,topic,room:value('room'),timeUnknown:start===String(original.start||'')&&end===String(original.end||'')?Boolean(original.timeUnknown):false,assignments,facultyIds:ids,labDetails:assignmentChanged?labDetailsFromAssignments(type,assignments,topic):original.labDetails};
    });
  }
  async function saveSelectedChanges(){
    toast('Multi-session edits are unavailable until the PAWS University API supports this operation.',true);
    return false;
  }

  function openSessionDetail(id, currentSession = null) {
    const s = currentSession || renderedSessions.find(x => x.id === id) || sessions.find(x => x.id === id) || sessionCache.get(id); if (!s) return;
    if(s.readOnlyActivity){
      const source=s.sourceActivity||{};
      showModal(`<div class="modal-header"><div class="modal-title">${escapeHtml(s.course)} · ${escapeHtml(s.topic)}</div><div class="modal-subtitle">${escapeHtml(s.date)}</div></div><div class="modal-body"><div class="form-grid">${detailField('Time',`${s.start}–${s.end}${s.timeDefaulted?' · Default time':' · Source time'}`)}${detailFieldMultiline('Faculty',displayFacultyList(s.instructor||'Not provided'))}${detailField('Source range',`${source.startDate||'Not provided'} to ${source.endDate||'Not provided'}`)}</div><p class="form-hint">Read-only working activity. ${s.timeDefaulted?'08:30–16:30 is the display default; source time remains unconfirmed and Needs Review for SWAP.':'The recorded time evidence is preserved.'} DOE and teaching assignments are unchanged.</p></div><div class="modal-footer"><button class="btn btn-secondary" id="detail-close">Close</button></div>`);
      $('detail-close').onclick=closeModal;return;
    }
    if (!s.isCcc && String(s.type).toUpperCase() === 'LAB' && window.UCVM_LAB_DETAIL) return openLabSessionDetail(s);
    const edit = !s.isCcc&&canEditExistingSqlSession()&&window.UCVM_PAWS_DATA?.sessionEditEnabled?.() ? `<button class="btn btn-primary" id="detail-edit">Edit Session</button>` : '';
    const assignmentEdit = !s.isCcc&&s.assignmentManagementAvailable===true&&canEditExistingSqlSession()&&window.UCVM_PAWS_DATA?.sessionEditEnabled?.() ? `<button class="btn btn-secondary" id="detail-assignments">Manage Instructors</button>` : '';
    const swap = !s.isCcc&&currentUser&&window.PAWS_SWAP&&scheduleSource==='vetmed-ops' ? `<button class="btn btn-primary" id="detail-swap">SWAP request</button>` : '';
    const labDetails = Array.isArray(s.labDetails) && s.labDetails.length > 1
      ? `<div class="login-cheatsheet"><strong>Lab stations / activities</strong><br><br>${s.labDetails.map(d => `<div style="margin-bottom:8px"><strong>${escapeHtml(d.topic)}</strong>${d.instructor ? `<br>${escapeHtml(displayFacultyList(d.instructor))}` : ''}${d.room ? `<br><span style="color:var(--text-3)">${escapeHtml(d.room)}</span>` : ''}</div>`).join('')}</div>`
      : '';
    showModal(`
      <div class="modal-header"><div class="modal-title">${escapeHtml(s.course)} - ${escapeHtml(s.topic)}</div><div class="modal-subtitle">${escapeHtml(s.type)} | ${formatLongDate(parseYmd(s.date))}</div></div>
      <div class="modal-body">
        ${window.PAWS_SWAP?.isPending(s.id)?'<p class="sql-swap-pending">SWAP PENDING</p>':''}
        <div class="form-grid">
          ${detailField('Time', s.timeUnknown ? 'Time not specified in source workbook' : `${s.start} - ${s.end}`)}${detailField('Room', s.room)}${detailFieldMultiline('Instructor(s)', instructorDisplayText(s)||'TBD')}${s.year?detailField('Year', `Year ${s.year}`):''}
        </div>
        ${labDetails}
        ${s.isCcc?'<p class="form-hint">Away from Campus record.</p>':''}
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" id="detail-close">Close</button><div>${swap}${assignmentEdit}${edit}</div></div>`);
    $('detail-close').onclick = closeModal;
    if ($('detail-swap')) $('detail-swap').onclick = () => {closeModal();window.PAWS_SWAP.openSession(s.id);};
    if ($('detail-assignments')) $('detail-assignments').onclick = () => openSqlSessionAssignmentForm(s);
    if ($('detail-edit')) $('detail-edit').onclick = () => openSqlSessionEditForm(s);
  }

  function openLabSessionDetail(seed) {
    // Use only the session rows already returned under the current user's scope.
    const withDisplay = row => ({ ...row, instructor: instructorDisplayText(row) || '', pendingSwap: window.PAWS_SWAP?.isPending(row.id) === true });
    const available = [...renderedSessions, ...sessions, ...sessionCache.values()].map(withDisplay);
    const model = window.UCVM_LAB_DETAIL.buildModel(withDisplay(seed), available);
    const actions = row => {
      const id = escapeHtml(row.id);
      const edit = canEditExistingSqlSession() && window.UCVM_PAWS_DATA?.sessionEditEnabled?.();
      return `${currentUser && window.PAWS_SWAP && scheduleSource === 'vetmed-ops' ? `<button class="btn btn-secondary" data-lab-action="swap" data-lab-id="${id}">SWAP request</button>` : ''}${edit && row.assignmentManagementAvailable === true ? `<button class="btn btn-secondary" data-lab-action="instructors" data-lab-id="${id}">Manage Instructors</button>` : ''}${edit ? `<button class="btn btn-primary" data-lab-action="edit" data-lab-id="${id}">Edit Session</button>` : ''}`;
    };
    const title = seed.courseName ? `${seed.course} - ${seed.courseName}` : `${seed.course} · LAB`;
    const position = [seed.semester, seed.week ? `Week ${seed.week}` : ''].filter(Boolean).join(' ');
    showModal(`<div class="modal-header"><div class="modal-title">🧪 ${escapeHtml(title)}</div><div class="modal-subtitle">${formatLongDate(parseYmd(seed.date))}${position ? ` · ${escapeHtml(position)}` : ''}</div></div><div class="modal-body">${window.UCVM_LAB_DETAIL.render(model,{actions,formatFacultyName:value=>typeof window==='object'&&window.PAWS_FACULTY_NAME?.formatList?window.PAWS_FACULTY_NAME.formatList(value):String(value||'')})}</div><div class="modal-footer"><button class="btn btn-secondary" id="detail-close">Close</button></div>`);
    $('modal').querySelector('.modal-box')?.classList.add('lab-detail-modal');
    $('detail-close').onclick = closeModal;
    const rows = [...model.stations, ...model.srl];
    $('modal').querySelectorAll('[data-lab-action]').forEach(button => button.onclick = () => {
      const row = rows.find(item => item.id === button.dataset.labId); if (!row) return;
      if (button.dataset.labAction === 'edit') return openSqlSessionEditForm(row);
      if (button.dataset.labAction === 'instructors') return openSqlSessionAssignmentForm(row);
      closeModal(); window.PAWS_SWAP.openSession(row.id);
    });
  }

  async function openSqlSessionAssignmentForm(session){
    if(!canEditExistingSqlSession()||!window.UCVM_PAWS_DATA?.sessionEditEnabled?.()){toast('Administrator permission is required to manage instructors.',true);return}
    if(!session?.id||session.isCcc||session.readOnlyActivity||session.assignmentManagementAvailable!==true){toast('Canonical instructor assignments are unavailable for this session.',true);return}
    let directory;
    try{directory=await ensureCanonicalWriteFacultyDirectory()}catch(error){console.error('[canonical faculty directory]',error);toast('The canonical Faculty list could not be loaded.',true);return}
    const rows=(Array.isArray(session.assignments)?session.assignments:[]).filter(row=>row?.facultyId).map(row=>({facultyId:String(row.facultyId),teachingRole:String(row.role||'')}));
    const roles=['Lecture','SRL','Lab Lead','Lab Primary','Lab Support','Lab Secondary'];
    showModal(`<div class="modal-header"><div class="modal-title">Manage Session Instructors</div><div class="modal-subtitle">Only active canonical Faculty IDs can be assigned. DOE is recalculated by the University server after save; missing rules or mappings remain Needs Review. Removing a line that has recorded workload or DOE is blocked.</div></div><form id="sql-assignment-form"><div class="modal-body"><div id="sql-assignment-rows"></div><button type="button" class="btn btn-secondary" id="sql-assignment-add">+ Add instructor</button><div id="sql-assignment-error" class="hidden" role="alert"></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="sql-assignment-cancel">Cancel</button><button type="submit" class="btn btn-primary">Save instructors</button></div></form>`);
    const render=()=>{
      const host=$('sql-assignment-rows');if(!host)return;
      host.innerHTML=rows.map((row,index)=>`<div class="instructor-line"><div class="form-grid"><select class="form-select" data-assignment-faculty="${index}" required><option value="">Choose active Faculty</option>${directory.map(person=>`<option value="${escapeHtml(person.facultyId)}" ${person.facultyId===row.facultyId?'selected':''}>${escapeHtml(displayFaculty(person.displayName||person.facultyId))}${person.email?' · '+escapeHtml(person.email):''}</option>`).join('')}</select><select class="form-select" data-assignment-role="${index}"><option value="">Role unavailable</option>${roles.map(role=>`<option value="${escapeHtml(role)}" ${role===row.teachingRole?'selected':''}>${escapeHtml(role)}</option>`).join('')}</select></div><button type="button" class="instructor-remove" data-assignment-remove="${index}">Remove</button></div>`).join('')||'<div class="instructor-empty">No instructors assigned.</div>';
      host.querySelectorAll('[data-assignment-faculty]').forEach(control=>control.onchange=()=>{rows[Number(control.dataset.assignmentFaculty)].facultyId=control.value});
      host.querySelectorAll('[data-assignment-role]').forEach(control=>control.onchange=()=>{rows[Number(control.dataset.assignmentRole)].teachingRole=control.value});
      host.querySelectorAll('[data-assignment-remove]').forEach(control=>control.onclick=()=>{rows.splice(Number(control.dataset.assignmentRemove),1);render()});
    };
    $('sql-assignment-add').onclick=()=>{if(rows.length>=30){toast('A session can include at most 30 instructors.',true);return}rows.push({facultyId:'',teachingRole:'Lecture'});render()};
    $('sql-assignment-cancel').onclick=closeModal;
    $('sql-assignment-form').onsubmit=async event=>{
      event.preventDefault();const error=$('sql-assignment-error'),button=event.submitter;
      if(rows.some(row=>!row.facultyId)||new Set(rows.map(row=>row.facultyId.toLowerCase())).size!==rows.length){error.textContent='Choose a distinct active Faculty member for each line.';error.classList.remove('hidden');return}
      const original=(Array.isArray(session.assignments)?session.assignments:[]).filter(row=>row?.facultyId).map(row=>({facultyId:String(row.facultyId),teachingRole:String(row.role||'')}));
      if(JSON.stringify(original)===JSON.stringify(rows)){toast('No instructor changes to save.');return}
      button.disabled=true;button.textContent='Saving...';error.classList.add('hidden');
      try{
        const saved=await window.UCVM_PAWS_DATA.replaceSessionAssignments(session.id,rows);
        invalidateAllSessions();const refreshed=await refreshSessionScope();closeModal();toast(refreshed?`Session instructors updated and audited.${sessionDoeNotice(saved.doeRecalculation)}`:'Instructor changes were saved; reload the timetable to verify them.',!refreshed);
      }catch(failure){error.textContent=assignmentErrorMessage(failure);error.classList.remove('hidden');button.disabled=false;button.textContent='Save instructors'}
    };
    render();
  }

  function assignmentErrorMessage(error){
    const messages={WRITE_DISABLED:'Instructor editing is currently disabled.',ROLE_DENIED:'This account cannot edit timetable instructors.',SESSION_NOT_FOUND:'This session no longer exists. Reload the timetable.',SESSION_FACULTY_INVALID:'Choose active canonical Faculty entries.',ASSIGNMENT_HAS_RECORDED_DOE:'A removed instructor line has recorded workload or DOE and cannot be removed here.',UNAUTHENTICATED:'Your sign-in expired. Sign in again before editing.',SQL_UNAVAILABLE:'Instructor changes were not saved because the University API is unavailable.'};
    return messages[String(error?.code||'')]||'Instructor changes were not saved. Review the selections and try again.';
  }

  function openSqlSessionEditForm(session) {
    if(!canEditExistingSqlSession()||!window.UCVM_PAWS_DATA?.sessionEditEnabled?.()){toast('Administrator permission is required to edit this session.',true);return}
    if(!session?.id||session.isCcc||session.readOnlyActivity){toast('Only an existing VetMed-Ops session can be edited here.',true);return}
    showModal(`<div class="modal-header"><div class="modal-title">Edit VetMed-Ops Session</div><div class="modal-subtitle">Only session facts are editable. The University server recalculates affected DOE; missing rules or mappings are shown as Needs Review.</div></div>
      <form id="sql-session-edit-form"><div class="modal-body"><div class="form-grid">
        ${input('sql-edit-date','Date','date',session.date)}
        ${input('sql-edit-course','Course code','text',session.course)}
        ${select('sql-edit-type','Session type',['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam'],session.type)}
        ${input('sql-edit-start','Start','time',session.start,'',false)}
        ${input('sql-edit-end','End','time',session.end,'',false)}
        ${input('sql-edit-topic','Topic','text',session.topic,'full',false)}
        ${input('sql-edit-room','Room','text',session.room,'',false)}
        <div class="form-hint full">Clearing both times keeps the session unpositioned for review. One blank time is invalid. The server records an AuditEvent for every successful change.</div>
      </div><div id="sql-session-edit-error" class="hidden"></div></div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary" id="sql-session-edit-cancel">Cancel</button><button class="btn btn-primary" type="submit">Save session</button></div></form>`);
    $('sql-session-edit-cancel').onclick=closeModal;
    $('sql-session-edit-form').onsubmit=async event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget),start=String(form.get('sql-edit-start')||''),end=String(form.get('sql-edit-end')||'');
      const error=$('sql-session-edit-error'),button=event.submitter;
      error.classList.add('hidden');
      if(!scheduling.normalizeDate(String(form.get('sql-edit-date')||''))||Boolean(start)!==Boolean(end)||start&&scheduling.validateInterval(start,end).status!=='valid'){
        error.textContent='Enter a valid date and either a valid start/end pair or leave both times blank.';error.classList.remove('hidden');return;
      }
      const patch=buildSqlSessionEditPatch(session,{
        date:String(form.get('sql-edit-date')||''),course:String(form.get('sql-edit-course')||''),
        type:String(form.get('sql-edit-type')||''),start,end,
        topic:String(form.get('sql-edit-topic')||''),room:String(form.get('sql-edit-room')||'')
      });
      if(Object.keys(patch).length===0){error.textContent='No changes to save.';error.classList.remove('hidden');return}
      if(Object.prototype.hasOwnProperty.call(patch,'courseCode')&&!patch.courseCode){error.textContent='Course code is required.';error.classList.remove('hidden');return}
      button.disabled=true;button.textContent='Saving...';
      try{
        const saved=await window.UCVM_PAWS_DATA.patchSession(session.id,patch);
        invalidateAllSessions();
        const refreshed=await refreshSessionScope();
        closeModal();
        if(refreshed)toast(`VetMed-Ops session updated and audited.${sessionDoeNotice(saved.doeRecalculation)}`);
        else toast('The session was saved, but the timetable refresh failed. Reload the timetable to verify the saved values.',true);
      }catch(failure){
        error.textContent=sessionEditErrorMessage(failure);error.classList.remove('hidden');button.disabled=false;button.textContent='Save session';
      }
    };
  }

  function buildSqlSessionEditPatch(session, values) {
    const normalized = {
      date: String(values?.date ?? ''),
      courseCode: String(values?.course ?? '').trim(),
      sessionType: String(values?.type ?? ''),
      startTime: String(values?.start ?? '') || null,
      endTime: String(values?.end ?? '') || null,
      topic: String(values?.topic ?? '').trim() || null,
      room: String(values?.room ?? '').trim() || null
    };
    const current = {
      date: String(session?.date ?? ''),
      courseCode: String(session?.course ?? '').trim(),
      sessionType: String(session?.type ?? ''),
      startTime: String(session?.start ?? '') || null,
      endTime: String(session?.end ?? '') || null,
      topic: String(session?.topic ?? '').trim() || null,
      room: String(session?.room ?? '').trim() || null
    };
    return Object.fromEntries(Object.entries(normalized).filter(([key, value]) => value !== current[key]));
  }

  function sessionEditErrorMessage(error) {
    const messages = {
      INVALID_SESSION_ID: 'This session identifier is invalid. Reload the timetable and try again.',
      INVALID_SESSION_PATCH: 'No valid session fields were supplied.',
      UNSUPPORTED_SESSION_FIELDS: 'Only date, time, course code, type, topic, and room can be edited.',
      INVALID_SESSION_DATE: 'Enter a valid session date.',
      SESSION_DATE_OUTSIDE_ACADEMIC_YEAR: 'The date must remain inside this session’s stored academic year.',
      INVALID_SESSION_INTERVAL: 'Enter a valid interval with an end time after its start time, or clear both times.',
      INVALID_SESSION_VALUES: 'Review the session values and correct the invalid field.',
      INVALID_COURSE_CODE: 'Enter a valid course code.',
      COURSE_NOT_FOUND: 'Enter a valid course code that exists in VetMed-Ops.',
      INVALID_SESSION_TYPE: 'Choose a supported session type.',
      DUPLICATE_SESSION_CONFLICT: 'These values conflict with another session. Review the course, date, and time.',
      SESSION_ACADEMIC_YEAR_INVALID: 'This session has an invalid academic-year value in VetMed-Ops. No changes were saved; contact an administrator.',
      ROLE_DENIED: 'This account is not authorized to edit the timetable.',
      PROFILE_REQUIRED: 'An active VetMed-Ops user profile is required to edit the timetable.',
      UNAUTHENTICATED: 'Your sign-in has expired. Sign in again before editing.',
      SESSION_REAUTH_REQUIRED: 'Your sign-in could not be refreshed. Sign in again before editing.',
      TOKEN_REFRESH_FAILED: 'Your sign-in could not be refreshed. Sign in again before editing.',
      SESSION_NOT_FOUND: 'This session no longer exists. Reload the timetable before trying again.',
      SQL_UNAVAILABLE: 'The session was not saved because the VetMed-Ops service is unavailable. Try again later.'
    };
    return messages[String(error?.code || '')] || 'The session was not saved. Review the values or contact an administrator.';
  }

  function sessionDoeNotice(outcome) {
    if (!outcome || typeof outcome !== 'object') return '';
    if (outcome.status === 'calculated') return ' Server DOE recalculation and evidence recording passed.';
    const issues = Array.isArray(outcome.issueCodes) ? outcome.issueCodes.filter(Boolean).join(', ') : '';
    return ` DOE status: Needs Review${issues ? ` (${issues})` : ''}. No numeric result was applied.`;
  }

  function detailField(label, value) {
    return `<div class="form-field"><span class="form-label">${escapeHtml(label)}</span><div>${escapeHtml(value)}</div></div>`;
  }
  function detailFieldMultiline(label, value) {
    return `<div class="form-field"><span class="form-label">${escapeHtml(label)}</span><div class="detail-multiline">${escapeHtml(value)}</div></div>`;
  }

  function splitInstructorNames(v){return String(v||'').split(/[;\n]+/).map(x=>x.trim()).filter(Boolean)}
  function defaultTeachingRole(type){const t=String(type||'').toUpperCase();if(t==='LEC')return'Lecture';if(t==='SRL')return'SRL';if(t==='LAB')return'Lab Support';return type||'Other'}
  function doeRateForRole(role){return ({'Lecture':0.30,'SRL':0.30,'Lab Lead':0.21,'Lab Primary':0.21,'Lab Support':0.19,'Lab Secondary':0.19})[role]??null}
  function blockHours(start,end,options={}){return scheduling.durationHours(start,end,options)}
  function reconcileAssignments(existing,namesText,type,start,end,topic){const names=splitInstructorNames(namesText),old=Array.isArray(existing)?existing:[];return names.map((name,i)=>{let prev=old.find(x=>String(x.name||'').toLowerCase()===name.toLowerCase())||old[i]||{};const role=prev.role||defaultTeachingRole(type);const h=swapNumeric(prev.creditedHours)??blockHours(start,end);const rate=doeRateForRole(role);return {...prev,ucid:prev.ucid||null,name,topic:prev.topic||topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null||h===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'}})}
  function finalizeInstructorAssignments(rows,type,start,end,topic,options={}){return (Array.isArray(rows)?rows:[]).filter(a=>String(a?.name||'').trim()).map(a=>{const role=a.role||defaultTeachingRole(type);const h=swapNumeric(a.creditedHours)??blockHours(start,end,options);const rate=doeRateForRole(role);const out={...a,ucid:a.ucid||null,name:String(a.name||'').trim(),topic:a.topic||topic,role,creditedHours:h,doeRate:rate,doeCredit:swapNumeric(a.doeCredit)??(rate===null||h===null?null:Number((h*rate).toFixed(6))),source:'Live timetable edit'};delete out.__editorKey;return out})}
  function instructorDisplayText(s){const a=Array.isArray(s?.assignments)?s.assignments:[];const names=a.map(x=>String(x?.name||'').trim()).filter(Boolean);return (names.length?names:splitInstructorNames(s?.instructor||'')).join('\n')}
  function labDetailsFromAssignments(type,assignments,topic){if(String(type).toUpperCase()!=='LAB')return undefined;const map=new Map();for(const a of assignments){const t=a.topic||topic||'Lab';if(!map.has(t))map.set(t,[]);map.get(t).push(a)}return[...map].map(([t,arr])=>({topic:t,instructor:arr.map(a=>`${a.name}${a.role?' ('+a.role+')':''}`).join('; '),room:''}))}

  function blankBulkRow(seed={}){
    const date=seed.date||ymd(weekStart(selectedWeek,selectedSemester));
    return {__key:crypto.randomUUID(),date,year:String(seed.year||1),course:String(seed.course||'200'),type:String(seed.type||'LEC'),start:seed.start||'09:00',end:seed.end||'10:00',topic:seed.topic||'',room:seed.room||'',faculty:seed.faculty||''};
  }
  function parseBulkPaste(text){
    const rows=String(text||'').split(/\r?\n/).map(line=>line.split('\t')).filter(cells=>cells.some(cell=>String(cell).trim()));
    if(rows.length&&/date/i.test(String(rows[0][0]))&&/course/i.test(String(rows[0][2])))rows.shift();
    return rows.slice(0,MAX_BULK_SESSION_ROWS).map(cells=>blankBulkRow({date:String(cells[0]||'').trim(),year:String(cells[1]||'1').trim(),course:String(cells[2]||'').trim(),type:String(cells[3]||'LEC').trim(),start:String(cells[4]||'09:00').trim(),end:String(cells[5]||'10:00').trim(),topic:String(cells[6]||'').trim(),room:String(cells[7]||'').trim(),faculty:String(cells[8]||'').trim()}));
  }
  function bulkSelectOptions(values,current){return values.map(value=>`<option value="${escapeHtml(value)}" ${String(value)===String(current)?'selected':''}>${escapeHtml(value)}</option>`).join('')}
  function renderBulkRows(){
    const host=$('bulk-session-body');if(!host)return;
    const courseOptions=[...new Set([...courseCodes(),'CCC'])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    host.innerHTML=bulkRows.map((row,index)=>`<tr data-bulk-row="${index}">
      <td><input class="bulk-date" data-bulk-field="date" data-index="${index}" type="date" value="${escapeHtml(row.date)}"></td>
      <td><select data-bulk-field="year" data-index="${index}">${bulkSelectOptions(['1','2','3','4'],row.year)}</select></td>
      <td><select data-bulk-field="course" data-index="${index}">${bulkSelectOptions(courseOptions,row.course)}</select></td>
      <td><select data-bulk-field="type" data-index="${index}">${bulkSelectOptions(['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam'],row.type)}</select></td>
      <td><input data-bulk-field="start" data-index="${index}" type="time" value="${escapeHtml(row.start)}"></td>
      <td><input data-bulk-field="end" data-index="${index}" type="time" value="${escapeHtml(row.end)}"></td>
      <td><input class="bulk-topic" data-bulk-field="topic" data-index="${index}" value="${escapeHtml(row.topic)}" placeholder="Session topic"></td>
      <td><input data-bulk-field="room" data-index="${index}" value="${escapeHtml(row.room)}" placeholder="Room"></td>
      <td><input class="bulk-faculty" data-bulk-field="faculty" data-index="${index}" value="${escapeHtml(row.faculty)}" list="bulk-faculty-list" placeholder="Name, email or UCID; separate with ;"></td>
      <td><button type="button" class="bulk-remove" data-bulk-remove="${index}" aria-label="Remove row ${index+1}">×</button></td>
    </tr>`).join('');
    $('bulk-row-count').textContent=`${bulkRows.length} / ${MAX_BULK_SESSION_ROWS} rows`;
    host.querySelectorAll('[data-bulk-field]').forEach(input=>{const event=input.tagName==='SELECT'?'change':'input';input.addEventListener(event,()=>{const row=bulkRows[Number(input.dataset.index)];if(!row)return;row[input.dataset.bulkField]=input.value;if(input.dataset.bulkField==='course'&&input.value==='CCC'){row.type='CCC';if(!row.topic)row.topic='CCC Day';renderBulkRows()}})});
    host.querySelectorAll('[data-bulk-remove]').forEach(button=>button.onclick=()=>{if(bulkRows.length===1)bulkRows=[blankBulkRow()];else bulkRows.splice(Number(button.dataset.bulkRemove),1);renderBulkRows()});
  }
  function resolveBulkFaculty(value,rowNumber){
    const assignments=[],errors=[];
    for(const token of String(value||'').split(/[;\n]+/).map(v=>v.trim()).filter(Boolean)){
      const match=canonicalWriteFaculty.find(f=>String(f.facultyId)===token||String(f.ucid||'').toLowerCase()===token.toLowerCase()||String(f.email||'').toLowerCase()===token.toLowerCase()||String(f.displayName||'').trim().toLowerCase()===token.toLowerCase());
      if(!match){errors.push(`Row ${rowNumber}: faculty "${token}" was not found.`);continue}
      if(assignments.some(row=>row.ucid===String(match.facultyId))){errors.push(`Row ${rowNumber}: faculty "${token}" is listed more than once.`);continue}
      assignments.push({ucid:String(match.facultyId),facultyId:String(match.facultyId),name:String(match.displayName||'').trim()});
    }
    return {assignments,errors};
  }
  function validateBulkRows(rows){
    const errors=[],warnings=[],prepared=[],seen=new Set();
    if(!rows.length)errors.push('Add at least one row.');
    if(rows.length>MAX_BULK_SESSION_ROWS)errors.push(`A maximum of ${MAX_BULK_SESSION_ROWS} rows can be saved at once.`);
    rows.forEach((row,index)=>{
      const n=index+1,date=String(row.date||''),course=String(row.course||'').trim(),type=String(row.type||'').trim(),topic=String(row.topic||'').trim(),start=String(row.start||''),end=String(row.end||''),year=Number(row.year);
      if(!scheduling.normalizeDate(date))errors.push(`Row ${n}: enter a valid date.`);
      if(![1,2,3,4].includes(year))errors.push(`Row ${n}: year must be 1–4.`);
      if(!course||course==='CCC')errors.push(`Row ${n}: choose a canonical VetMed-Ops course.`);if(!type||type==='CCC')errors.push(`Row ${n}: choose a supported session type.`);if(!topic)errors.push(`Row ${n}: topic is required.`);
      if(scheduling.validateInterval(start,end).status!=='valid')errors.push(`Row ${n}: end time must be after start time.`);
      if(topic.length>4000||String(row.room||'').length>256)errors.push(`Row ${n}: topic or room is too long.`);
      const duplicateKey=[sqlAcademicYearForDate(date),course.toUpperCase(),date,start,end,type,topic.trim().toLowerCase()].join('\u001f');
      if(seen.has(duplicateKey))errors.push(`Row ${n}: duplicates another row in this batch.`);else seen.add(duplicateKey);
      const resolved=resolveBulkFaculty(row.faculty,n);errors.push(...resolved.errors);
      const assignments=resolved.assignments.map(assignment=>({facultyId:assignment.facultyId,teachingRole:defaultTeachingRole(type)}));
      for(const assignment of resolved.assignments){const faculty=facultyDirectory.find(f=>String(f.facultyId||f.__id)===String(assignment.facultyId));if(!faculty)continue;const availability=facultyAssignmentAvailability(faculty,date,start,end,'');if(availability.available!==true)warnings.push(`Row ${n} · ${displayFaculty(assignment.name)}: ${assignmentAvailabilityDetail(availability,date,start,end)}`)}
      if(!errors.some(message=>message.startsWith(`Row ${n}:`))){const pos=academicPositionForDate(parseYmd(date));prepared.push({date,week:pos.week,semester:pos.semester,year,course,courseName:COURSES.find(c=>String(c.code)===course)?.name||'',type,topic,instructor:resolved.assignments.map(a=>a.name).join('; '),room:String(row.room||'').trim(),start,end,assignments,labDetails:labDetailsFromAssignments(type,resolved.assignments,topic),sourceSystem:'Bulk live timetable entry'})}
    });
    return {errors,warnings,sessions:prepared};
  }
  let bulkRequestId='';
  async function saveBulkSessions(rows){
    const validation=validateBulkRows(rows),host=$('bulk-errors');
    if(validation.errors.length){host.textContent=validation.errors.join('\n');host.classList.remove('hidden');return false}
    const sessions=validation.sessions.map(row=>({academicYear:sqlAcademicYearForDate(row.date),curriculumYear:String(row.year),courseCode:row.course,sessionType:row.type,date:row.date,startTime:row.start,endTime:row.end,topic:row.topic,room:row.room||null,assignments:row.assignments}));
    const button=$('bulk-session-form')?.querySelector('[type="submit"]');if(button){button.disabled=true;button.textContent='Saving...'}
    try{
      const result=await window.UCVM_PAWS_DATA.createSessionBatch({requestId:bulkRequestId,sessions});
      const needsReview=(result.doe||[]).filter(item=>item?.status==='needs_review').length;
      invalidateAllSessions();const refreshed=await refreshSessionScope();closeModal();toast(refreshed?`${result.sessions.length} VetMed-Ops sessions created and audited.${needsReview?` ${needsReview} session(s) need DOE review; no numeric DOE was applied.`:''}`:'Sessions were created; reload the timetable to verify them.',!refreshed);return true;
    }catch(error){
      host.textContent=creationErrorMessage(error);host.classList.remove('hidden');if(button){button.disabled=false;button.textContent='Save all sessions'}return false;
    }
  }

  async function openBulkSessionForm(){
    if(!canEditExistingSqlSession()||!window.UCVM_PAWS_DATA?.sessionCreateEnabled?.()){toast('Administrator permission and the Session Create capability are required.',true);return}
    try{await ensureCanonicalWriteFacultyDirectory()}catch(error){console.error('[canonical faculty directory]',error);toast('The canonical Faculty list could not be loaded.',true);return}
    bulkRows=[blankBulkRow()];bulkRequestId=crypto.randomUUID();
    const facultyOptions=canonicalWriteFaculty.map(f=>`<option value="${escapeHtml(f.displayName||f.facultyId)}">${escapeHtml([f.email,f.ucid||f.facultyId].filter(Boolean).join(' · '))}</option>`).join('');
    showModal(`<div class="modal-header"><div class="modal-title">Add Multiple Live Sessions</div><div class="modal-subtitle">Edit rows like a spreadsheet or paste tab-separated rows copied from Excel. Every row is validated before one atomic save.</div></div><form id="bulk-session-form"><div class="modal-body">
      <div class="bulk-toolbar"><button type="button" class="btn btn-secondary" id="bulk-add-row">+ Add row</button><button type="button" class="btn btn-secondary" id="bulk-duplicate-row">Duplicate last row</button><button type="button" class="btn btn-secondary" id="bulk-paste-rows">Paste Excel rows</button><span class="bulk-count" id="bulk-row-count"></span></div>
      <div class="bulk-paste-panel hidden" id="bulk-paste-panel"><label class="form-label" for="bulk-paste-text">Paste columns: Date, Year, Course, Type, Start, End, Topic, Room, Faculty</label><textarea id="bulk-paste-text" placeholder="2026-09-14&#9;1&#9;VETM 315&#9;LEC&#9;07:30&#9;08:30&#9;Session topic&#9;Room&#9;Faculty Name"></textarea><div><button type="button" class="btn btn-primary" id="bulk-paste-apply">Add pasted rows</button></div></div>
      <datalist id="bulk-faculty-list">${facultyOptions}</datalist><div class="bulk-sheet-wrap"><table class="bulk-sheet"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>Faculty</th><th></th></tr></thead><tbody id="bulk-session-body"></tbody></table></div><div class="bulk-errors hidden" id="bulk-errors"></div>
    </div><div class="modal-footer"><span class="form-hint">Maximum 200 rows. Faculty may be separated with semicolons.</span><div><button type="button" class="btn btn-secondary" id="bulk-cancel">Cancel</button> <button class="btn btn-primary" type="submit">Save all sessions</button></div></div></form>`);
    document.querySelector('#modal .modal-box')?.classList.add('bulk-wide');renderBulkRows();
    $('bulk-add-row').onclick=()=>{if(bulkRows.length>=MAX_BULK_SESSION_ROWS){toast(`Maximum ${MAX_BULK_SESSION_ROWS} rows.`,true);return}bulkRows.push(blankBulkRow(bulkRows.at(-1)||{}));renderBulkRows()};
    $('bulk-duplicate-row').onclick=()=>{if(bulkRows.length>=MAX_BULK_SESSION_ROWS){toast(`Maximum ${MAX_BULK_SESSION_ROWS} rows.`,true);return}bulkRows.push(blankBulkRow({...bulkRows.at(-1),date:bulkRows.at(-1)?.date}));renderBulkRows()};
    $('bulk-paste-rows').onclick=()=>$('bulk-paste-panel').classList.toggle('hidden');
    $('bulk-paste-apply').onclick=()=>{const parsed=parseBulkPaste($('bulk-paste-text').value);if(!parsed.length){toast('No tab-separated rows found.',true);return}const first=bulkRows.length===1&&Object.values(bulkRows[0]).filter(Boolean).length<=8?[]:bulkRows;bulkRows=[...first,...parsed].slice(0,MAX_BULK_SESSION_ROWS);renderBulkRows();$('bulk-paste-panel').classList.add('hidden')};
    $('bulk-cancel').onclick=closeModal;$('bulk-session-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;button.textContent='Saving...';await saveBulkSessions(bulkRows)};
  }

  async function openSqlSessionCreateForm(){
    let directory;
    try { directory=await ensureCanonicalWriteFacultyDirectory(); }
    catch(error){console.error('[canonical faculty directory]',error);toast('The canonical Faculty list could not be loaded. No session was created.',true);return}
    const roles=['Lecture','SRL','Lab Lead','Lab Primary','Lab Support','Lab Secondary'];
    const assignmentRows=[];
    showModal(`<div class="modal-header"><div class="modal-title">Add VetMed-Ops Session</div><div class="modal-subtitle">Saved to the canonical timetable through the University API. Instructor assignments use active SQL Faculty IDs; DOE values are not calculated here.</div></div>
      <form id="sql-session-create-form"><div class="modal-body"><div class="form-grid">
        ${input('create-date','Date','date',ymd(new Date()))}
        ${select('create-year','Curriculum year',[1,2,3,4],1)}
        ${select('create-course','Course',courseCodes().filter(code=>code!=='CCC'),'200')}
        ${select('create-type','Session type',['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam'],'LEC')}
        ${input('create-start','Start','time','09:00')}${input('create-end','End','time','10:00')}
        ${input('create-topic','Topic','text','','full')}${input('create-room','Room','text','')}
        <div class="form-field full"><label class="form-label">Instructor assignments</label><div id="sql-create-assignment-rows"></div><button type="button" class="btn btn-secondary" id="sql-create-add-assignment">+ Add instructor</button><div class="form-hint">Assignments resolve only to active canonical Faculty. The server calculates DOE from active annual rules; missing rules or mappings stay Needs Review.</div></div>
      </div><div id="sql-session-create-error" class="hidden" role="alert"></div></div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary" id="sql-session-create-cancel">Cancel</button><button class="btn btn-primary" type="submit">Create session</button></div></form>`);
    const renderRows=()=>{
      const host=$('sql-create-assignment-rows');if(!host)return;
      host.innerHTML=assignmentRows.map((row,index)=>`<div class="instructor-line" data-create-assignment="${index}"><div class="form-grid"><select class="form-select" data-create-faculty="${index}" required><option value="">Choose active Faculty</option>${directory.map(person=>`<option value="${escapeHtml(person.facultyId)}" ${person.facultyId===row.facultyId?'selected':''}>${escapeHtml(displayFaculty(person.displayName||person.facultyId))}${person.email?' · '+escapeHtml(person.email):''}</option>`).join('')}</select><select class="form-select" data-create-role="${index}">${roles.map(role=>`<option value="${escapeHtml(role)}" ${role===row.teachingRole?'selected':''}>${escapeHtml(role)}</option>`).join('')}</select></div><button type="button" class="instructor-remove" data-create-remove="${index}">Remove</button></div>`).join('')||'<div class="instructor-empty">No instructors assigned.</div>';
      host.querySelectorAll('[data-create-faculty]').forEach(control=>control.onchange=()=>{assignmentRows[Number(control.dataset.createFaculty)].facultyId=control.value});
      host.querySelectorAll('[data-create-role]').forEach(control=>control.onchange=()=>{assignmentRows[Number(control.dataset.createRole)].teachingRole=control.value});
      host.querySelectorAll('[data-create-remove]').forEach(control=>control.onclick=()=>{assignmentRows.splice(Number(control.dataset.createRemove),1);renderRows()});
    };
    $('sql-create-add-assignment').onclick=()=>{if(assignmentRows.length>=30){toast('A session can include at most 30 instructors.',true);return}assignmentRows.push({facultyId:'',teachingRole:'Lecture'});renderRows()};
    $('sql-session-create-cancel').onclick=closeModal;
    $('sql-session-create-form').onsubmit=async event=>{
      event.preventDefault();const form=new FormData(event.currentTarget),date=String(form.get('create-date')||''),error=$('sql-session-create-error'),button=event.submitter;
      const assignments=assignmentRows.map(row=>({facultyId:row.facultyId,teachingRole:row.teachingRole}));
      if(!scheduling.normalizeDate(date)||!sqlAcademicYearForDate(date)||scheduling.validateInterval(String(form.get('create-start')||''),String(form.get('create-end')||'')).status!=='valid'){
        error.textContent='Enter a valid date and a start/end time with the end after the start.';error.classList.remove('hidden');return;
      }
      if(assignments.some(row=>!row.facultyId)||new Set(assignments.map(row=>row.facultyId.toLowerCase())).size!==assignments.length){
        error.textContent='Choose a distinct active Faculty member for each instructor line.';error.classList.remove('hidden');return;
      }
      button.disabled=true;button.textContent='Creating...';error.classList.add('hidden');
      try{
        const saved=await window.UCVM_PAWS_DATA.createSession({academicYear:sqlAcademicYearForDate(date),curriculumYear:String(form.get('create-year')||''),courseCode:String(form.get('create-course')||'').trim(),sessionType:String(form.get('create-type')||''),date,startTime:String(form.get('create-start')||''),endTime:String(form.get('create-end')||''),topic:String(form.get('create-topic')||'').trim(),room:String(form.get('create-room')||'').trim()||null,assignments});
        invalidateAllSessions();const refreshed=await refreshSessionScope();closeModal();toast(refreshed?`VetMed-Ops session created and audited.${sessionDoeNotice(saved.doeRecalculation)}`:'The session was created; reload the timetable to verify it.',!refreshed);
      }catch(failure){error.textContent=creationErrorMessage(failure);error.classList.remove('hidden');button.disabled=false;button.textContent='Create session'}
    };
    renderRows();
  }

  function creationErrorMessage(error){
    const messages={WRITE_DISABLED:'Session creation is currently disabled.',ROLE_DENIED:'This account cannot create timetable sessions.',COURSE_NOT_FOUND:'Choose a course that exists in VetMed-Ops.',DUPLICATE_SESSION_CONFLICT:'A matching session already exists. Review the date and time.',SESSION_FACULTY_INVALID:'Choose active Faculty entries from the list.',INVALID_SESSION_ACADEMIC_YEAR:'The selected date is outside the supported academic year.',SESSION_DATE_OUTSIDE_ACADEMIC_YEAR:'The date does not match the academic year.',INVALID_SESSION_ASSIGNMENTS:'Review the instructor assignments.',UNAUTHENTICATED:'Your sign-in expired. Sign in again before creating a session.',SQL_UNAVAILABLE:'No session was created because the University API is unavailable.'};
    return messages[String(error?.code||'')]||'The session was not created. Review the values and try again.';
  }

  async function openSessionForm(existing = null) {
    if(!existing){
      if(!canEditExistingSqlSession()){toast('Administrator permission is required to create sessions.',true);return}
      if(!window.UCVM_PAWS_DATA?.sessionCreateEnabled?.()){toast('Session creation is disabled by the University API.',true);return}
      return openSqlSessionCreateForm();
    }
    if(!requireSessionWrites())return;
    if (!canEdit()) { toast('Editor permission is required to change sessions.', true); return; }
    if (scheduleSource !== 'firestore') { toast('The live Firestore timetable is unavailable. Sync it from Faculty Dashboard first.', true); return; }
    if(UCVM.admin(currentUser))await ensureFacultyDirectory();
    const s = existing || {
      id: '', date: ymd(weekStart(selectedWeek, selectedSemester)), week: selectedWeek, semester:selectedSemester, year:1,
      course:'200', type:'LEC', topic:'New Session', instructor:'', room:'', start:'09:00', end:'10:00', assignments:[]
    };
    let editorAssignments=sessionAssignmentsForSwap(s).map((a,i)=>({...a,__editorKey:`existing-${i}-${Date.now()}`}));
    if(!editorAssignments.length&&UCVM.admin(currentUser)) editorAssignments=[];
    const renderInstructorEditor=()=>{
      const host=$('instructor-lines'); if(!host)return;
      const isAdmin=UCVM.admin(currentUser);
      const usedIds=new Set(editorAssignments.map(a=>String(a.ucid||facultyForAssignment(a)?.__id||'')).filter(Boolean));
      if(!editorAssignments.length){host.innerHTML='<div class="instructor-empty">No instructor is currently assigned to this session.</div>'}
      else host.innerHTML=editorAssignments.map((a,i)=>{
        const matched=facultyForAssignment(a); const currentId=String(a.ucid||matched?.__id||''); const currentName=String(a.name||'').trim();
        let options='';
        if(!currentId&&currentName&&swapNameKey(currentName)!==swapNameKey('Other / Unassigned')) options+=`<option value="__current__" selected>${escapeHtml(displayFaculty(currentName))} (source/current)</option>`;
        options+=`<option value="__unassigned__" ${!currentId&&(!currentName||swapNameKey(currentName)===swapNameKey('Other / Unassigned'))?'selected':''}>Other / Unassigned</option>`;
        const targetDate=$('date')?.value||s.date,targetStart=$('start')?.value||s.start,targetEnd=$('end')?.value||s.end,excludeId=s.id||'';
        for(const f of facultyDirectory){const id=String(f.__id),selected=id===currentId,disabled=!selected&&usedIds.has(id),av=facultyAssignmentAvailability(f,targetDate,targetStart,targetEnd,excludeId),suffix=av.available===false?` — UNAVAILABLE: ${assignmentAvailabilityShort(av)}`:av.available===null?' — CHECK NEEDED':'';options+=`<option value="${escapeHtml(id)}" ${selected?'selected':''} ${disabled?'disabled':''}>${escapeHtml(displayFaculty(swapFacultyName(f))+suffix)}</option>`}
        const credit=swapAssignmentCredit(a); const role=a.role||defaultTeachingRole($('type')?.value||s.type); const meta=[role,credit===null?'DOE unrated':`${Number(credit).toFixed(3)}% DOE`].filter(Boolean).join(' · ');
        const selectedFaculty=currentId?facultyDirectory.find(f=>String(f.__id)===currentId):null,av=selectedFaculty?facultyAssignmentAvailability(selectedFaculty,targetDate,targetStart,targetEnd,excludeId):{available:null,afc:{available:null,conflicts:[]},tt:{available:null,conflicts:[],possibleConflicts:[]}},avLine=selectedFaculty?(av.available===false?`<div class="instructor-availability no">Unavailable: ${escapeHtml(assignmentAvailabilityDetail(av,targetDate,targetStart,targetEnd))}</div>`:av.available===null?`<div class="instructor-availability">Check needed: ${escapeHtml(assignmentAvailabilityDetail(av,targetDate,targetStart,targetEnd))}</div>`:`<div class="instructor-availability ok">Available: ${escapeHtml(assignmentAvailabilityDetail(av,targetDate,targetStart,targetEnd))}</div>`):'';return `<div class="instructor-line" data-instructor-row="${i}"><div><select class="form-select instructor-select" data-instructor-select="${i}" ${isAdmin?'':'disabled'}>${options}</select><div class="instructor-role-note">${escapeHtml(meta)}</div>${avLine}</div>${isAdmin?`<button type="button" class="instructor-remove" data-instructor-remove="${i}">Remove</button>`:''}</div>`;
      }).join('');
      document.querySelectorAll('[data-instructor-select]').forEach(el=>el.onchange=e=>{
        const i=Number(e.target.dataset.instructorSelect); const row=editorAssignments[i]; if(!row)return; const v=e.target.value;
        if(v==='__current__')return;
        if(v==='__unassigned__'){row.ucid=null;row.name='Other / Unassigned'}
        else {const f=facultyDirectory.find(x=>String(x.__id)===String(v));if(!f)return;row.ucid=String(f.__id);row.name=swapFacultyName(f)}
        renderInstructorEditor();
      });
      document.querySelectorAll('[data-instructor-remove]').forEach(el=>el.onclick=()=>{const i=Number(el.dataset.instructorRemove);editorAssignments.splice(i,1);renderInstructorEditor()});
    };
    showModal(`
      <div class="modal-header"><div class="modal-title">${existing ? 'Edit' : 'Add'} Live Session</div><div class="modal-subtitle">Changes are written to Firestore and will update the timetable and Faculty DOE dashboard in real time.</div></div>
      <form id="session-form">
      <div class="modal-body"><div class="form-grid">
        ${input('date','Date','date',s.date)}
        ${select('year','Year',[1,2,3,4],s.year)}
        ${select('course','Course',courseCodes(),s.course)}
        ${select('type','Type',['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam'],s.type)}
        ${input('start','Start','time',s.start,'',!s.timeUnknown)}
        ${input('end','End','time',s.end,'',!s.timeUnknown)}
        ${input('topic','Topic','text',s.topic,'full')}
        <div class="form-field instructor-editor"><label class="form-label">Instructor(s)</label><div id="instructor-lines" class="instructor-lines"></div>${UCVM.admin(currentUser)?'<button type="button" class="btn btn-secondary instructor-add" id="add-instructor-line">+ Add instructor</button><div class="instructor-note">One instructor per line. Select from the active faculty directory. Availability checks both Away from Campus and overlapping live timetable courses at the selected date and time. AFC only reports Unavailable; timetable conflicts continue to show the conflicting course/time. Unavailable or uncertain selections show a warning; admins may override. Add/remove controls are administrator-only. Existing teaching role and DOE credit stay with the line when you change the selected faculty.</div>':'<div class="instructor-note">Instructor assignments are managed by administrators.</div>'}</div>
        ${input('room','Room','text',s.room)}
      </div></div>
      <div class="modal-footer"><div>${existing ? '<button type="button" class="btn-danger-text" id="delete-session">Delete Session</button>' : ''}</div><div><button type="button" class="btn btn-secondary" id="cancel-session">Cancel</button> <button class="btn btn-primary" type="submit">Save Live Session</button></div></div>
      </form>`);
    renderInstructorEditor();
    for(const id of ['date','start','end']){if($(id)){ $(id).addEventListener('change',renderInstructorEditor); $(id).addEventListener('input',renderInstructorEditor); }}
    if($('add-instructor-line')) $('add-instructor-line').onclick=()=>{
      const type=$('type')?.value||s.type,start=$('start')?.value||s.start,end=$('end')?.value||s.end,topic=$('topic')?.value||s.topic;
      const role=defaultTeachingRole(type),h=blockHours(start,end),rate=doeRateForRole(role);
      editorAssignments.push({__editorKey:`new-${Date.now()}-${Math.random()}`,ucid:null,name:'Other / Unassigned',topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null||h===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'});renderInstructorEditor();
    };
    $('cancel-session').onclick = closeModal;
    if ($('delete-session')) $('delete-session').onclick = () => deleteSession(existing.id);
    $('session-form').onsubmit = event => {
      event.preventDefault();
      toast('Session changes must use the PAWS University API.',true);
    };
  }

  function input(name,label,type,value,extra='',required=true) {
    return `<div class="form-field ${extra}"><label class="form-label" for="${name}">${label}</label><input class="form-input" id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required?'required':''}></div>`;
  }
  function select(name,label,options,value) {
    return `<div class="form-field"><label class="form-label" for="${name}">${label}</label><select class="form-select" id="${name}" name="${name}">${options.map(o => `<option value="${escapeHtml(o)}" ${String(o)===String(value)?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select></div>`;
  }

  async function deleteSession(){
    toast('Session deletion must be handled by the PAWS University API.',true);
    return false;
  }

  function initFirebaseAuth() {
    const dot = $('conn-dot');
    const text = $('conn-text');
    try {
      if (typeof firebase === 'undefined') throw new Error('Firebase libraries did not load. Check your internet connection.');
      const shared=UCVM.init();
      auth = shared.auth;
      db = shared.db;
      authInitialized = true;
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
      dot.classList.add('online');
      text.textContent = 'Firebase Auth + SQL Access Ready';
      showSessionRestoreGate();
      setAppLocked(true, 'Checking saved login...');

      // BETA-R4D-12B2A1 — the access bootstrap is a separate unit so the same routine
      // can be rerun by the "Retry access" recovery action without re-authenticating.
      async function bootstrapForUser(user, parts, recoveryAttempt = 0) {
        const email = String(parts?.email || user.email || '').trim().toLowerCase();
        const phone = String(parts?.phone || user.phoneNumber || '').trim();
        const provider = parts?.provider || 'firebase';
        const identity = parts?.identity || '';
        try {
          text.textContent = 'Checking SQL access profile...';
          setAppLocked(true, 'Checking your timetable access...');
          setLoginProgress('Verifying PAWS access...', true);
          markLoginStage('T3');
          const profile = await getRoleProfile(user);
          markLoginStage('T4');
          const sqlFacultyId=profile.facultyId||null;
          const accessReady=await UCVM.ready(user, profile);
          markLoginStage('T5');
          if (!accessReady) {
            const accessFailureKind=profile.mustChangePassword===true?'password-change-required':(window.__ucvmSessionGuard?.blocked?'session-guard':'access-routing');
            failLoginPerformance(accessFailureKind);
            settleInteractiveLogin(false);
            setLoginProgress('', false);
            return;
          }
          window.UCVMSessionGuard?.clearNotice?.(window.sessionStorage, window.document);
          profile.facultyId=sqlFacultyId;
          setLoginProgress('Loading your timetable...', true);
          const name = window.PAWS_FACULTY_NAME.format(profile.name || user.displayName || (email ? email.split('@')[0] : phone) || 'UCVM User');
          sessions = [];
          invalidateAllSessions();
          resetWorkingCalendar();
          sessionCache.clear();sessionRangeLoads.clear();sessionDateLoads.clear();
          activityTypeFilter.resetForUser();
          currentUser = {
            id: user.uid,
            uid: user.uid,
            name,
            email,
            phone,
            identity,
            role: profile.role,
            active: profile.active === true,
            instructorName: String(profile.instructor || authSettings.instructorAlias || 'Faculty 001'),
            provider,
            profile
          };
          canonicalWriteFaculty=[];
          try { await window.UCVM_PAWS_DATA.refreshWriteCapabilities(); }
          catch (capabilityError) { console.warn('[write capabilities]', capabilityError); }
          publishPageData();
          viewMode = roleIsFaculty(currentUser) ? 'day' : 'week';
          setViewButtons();
          myTimetableOnly = roleIsFaculty(currentUser);
          updateAuthUI();
          const initialSessionLoad=subscribeSessions();
          unsubscribeFacultyDirectory();
          markLoginStage('T6');
          render();
          setAppLocked(false);
          markLoginStage('T7');
          prefetchDashboardShell();
          setAccessRecovery(null);
          updateScheduleSourceUI();
          setLoginProgress('', false);
          settleInteractiveLogin(true);
          closeModal();
          toast(`Signed in as ${name} (${profile.role}).`);
          scheduleAllSessionsPrefetch(user,initialSessionLoad);
          scheduleOptionalFacultyEnrichment(user, profile);
        } catch (err) {
          console.error('[SQL access profile]', err);
          const preliminaryOutcome=window.UCVM_AUTH_CONTINUITY.classifyAuthError(err);
          const sameUser=Boolean(auth?.currentUser && auth.currentUser.uid===user.uid);
          if(shouldAutoRetryAccess(preliminaryOutcome,recoveryAttempt,sameUser)){
            text.textContent='Retrying SQL access profile...';
            setAppLocked(true,'Still connecting to PAWS...');
            setLoginProgress('Retrying PAWS access...',true);
            await waitForAccessRetry();
            const retrySameUser=Boolean(auth?.currentUser && auth.currentUser.uid===user.uid);
            if(!retrySameUser)return;
            return bootstrapForUser(user,{email,phone,provider,identity},recoveryAttempt+1);
          }
          // Terminal classified failure: preserve Firebase login and expose the existing
          // bounded Retry access action. This does not re-authenticate or reload the page.
          const outcome=await applyAccessFailure(err, {
            setLocked: setAppLocked,
            setRecovery: setAccessRecovery,
            toast,
            setStatus: value => { text.textContent = value; },
            retryAccess: () => {
              const perf=loginPerformance();
              if(perf){perf.begin({method:provider==='phone'?'phone':'email',flow:'restored-session'});markLoginStage('T2');}
              return bootstrapForUser(user, { email, phone, provider, identity });
            }
          });
          failLoginPerformance(outcome.kind);
          setLoginProgress(outcome.message, false);
          settleInteractiveLogin(false);
          closeModal();
        }
      }

      auth.onAuthStateChanged(async user => {
        if (!user) {
          text.textContent = 'Firebase Auth + SQL Access Ready';
          currentUser = null;
          window.PAWS_CCC_SCHEDULE?.close();
          window.PAWS_LEADERSHIP_DIRECTORY?.close();
          activityTypeFilter.resetForUser();
          resetWorkingCalendar();
          if($('working-activities-lane'))$('working-activities-lane').innerHTML='';
          viewMode = 'week'; setViewButtons();
          myTimetableOnly = false;
          if (sessionUnsubscribe) { try { sessionUnsubscribe(); } catch (_) {} sessionUnsubscribe = null; }
          sessionRangeKey='';
          sessionCache.clear();sessionRangeLoads.clear();sessionDateLoads.clear();
          invalidateAllSessions();
          clearCurrentFaculty();
          unsubscribeFacultyDirectory();
          scheduleSource = 'signed-out';
          sessions = [];
          updateAuthUI();
          showSignedOutGate();
          setAppLocked(true, 'Sign in required to view the timetable.');
          return;
        }

        ensureRestoredLoginPerformance();
        markLoginStage('T2');
        setLoginProgress('Verifying PAWS access...', true);

        const email = String(user.email || '').trim().toLowerCase();
        const phone = String(user.phoneNumber || '').trim();
        let provider = 'firebase';
        let identity = '';

        if (email) {
          if (!isAllowedEmail(email)) {
            const message='This email is outside the allowed local domain.';
            failLoginPerformance('identity-policy');
            settleInteractiveLogin(false);
            setLoginProgress(message, false);
            closeModal();
            await auth.signOut().catch(() => {});
            toast(message, true);
            return;
          }
          provider = 'email';
          identity = email;
        } else if (phone) {
          if (!isAllowedPhone(phone)) {
            const message='This phone number is outside the optional local phone list.';
            failLoginPerformance('identity-policy');
            settleInteractiveLogin(false);
            setLoginProgress(message, false);
            closeModal();
            await auth.signOut().catch(() => {});
            toast(message, true);
            return;
          }
          provider = 'phone';
          identity = phone;
        } else {
          const message='This Firebase account has neither an email nor a phone number.';
          failLoginPerformance('identity-policy');
          settleInteractiveLogin(false);
          setLoginProgress(message, false);
          closeModal();
          await auth.signOut().catch(() => {});
          toast(message, true);
          return;
        }

        await bootstrapForUser(user, { email, phone, provider, identity });
      });
    } catch (err) {
      authInitialized = false;
      dot.classList.remove('online');
      dot.style.background = 'var(--danger)';
      text.textContent = 'Firebase Auth unavailable';
      setAppLocked(true, 'Firebase Authentication is unavailable. Check your connection or setup.');
      console.error('[Firebase init]', err);
    }
  }

  function requireLocalhost() {
    if (location.protocol !== 'file:') return false;
    showModal(`
      <div class="modal-header"><div class="modal-title">Use localhost for Firebase Login</div><div class="modal-subtitle">Phone reCAPTCHA and Firebase Auth should be tested through the local server.</div></div>
      <div class="modal-body">
        <div class="login-cheatsheet"><strong>Start the page with START_LOCAL.bat</strong>, then open:<br><br><code>http://localhost:8765/</code></div>
      </div><div class="modal-footer"><span></span><button class="btn btn-secondary" id="local-close">Close</button></div>`);
    $('local-close').onclick = closeModal;
    return true;
  }

  function openLoginModal() {
    if (requireLocalhost()) return;
    if (!authInitialized || !auth) { toast('Firebase Authentication is not initialized.', true); return; }
    showModal(`
      <div class="modal-header"><div class="modal-title">Sign in to UCVM Timetable</div><div class="modal-subtitle">Sign in with your authorized account to view the live timetable.</div></div>
      <div class="modal-body">
        <div class="login-cheatsheet"><strong>Firebase project:</strong> Tester Teaching (<code>tester-teaching</code>)<br>Enable the matching provider in Firebase Authentication. Your Firebase UID must also have an active reviewed row in VetMed-Ops <code>paws.UserProfile</code>, authorized by the PAWS University API.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
          <button type="button" class="btn btn-primary" id="choose-email" style="padding:16px">Email + Password</button>
          <button type="button" class="btn btn-primary" id="choose-phone" style="padding:16px">Phone + SMS Code</button>
        </div>
      </div>
      <div class="modal-footer"><span></span><button class="btn btn-secondary" id="login-choice-close">Cancel</button></div>`);
    $('choose-email').onclick = openEmailLoginModal;
    $('choose-phone').onclick = openPhoneLoginModal;
    $('login-choice-close').onclick = closeModal;
  }

  function openEmailLoginModal() {
    clearRecaptcha();
    showModal(`
      <div class="modal-header"><div class="modal-title">Email Sign In</div><div class="modal-subtitle">Uses Firebase Email/Password authentication.</div></div>
      <form id="email-login-form"><div class="modal-body">
        <div class="login-cheatsheet">Use the email address registered by the ADFAD Owner. New faculty accounts must change their temporary password after signing in.</div>
        <div class="form-field"><label class="form-label">Email</label><input class="form-input" id="login-email" name="email" type="email" placeholder="name@ucalgary.ca" autocomplete="username" required></div>
        <div class="form-field"><label class="form-label">Password</label><input class="form-input" id="login-password" name="password" type="password" autocomplete="current-password" required></div>
        <p id="email-login-status" class="form-hint" role="status" aria-live="polite" style="min-height:20px;margin-top:10px"></p>
      </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="email-back">Back</button><button class="btn btn-primary" id="email-login-submit" type="submit">Sign in with Email</button></div></form>`);
    $('email-back').onclick = () => { if (!emailLoginInFlight) openLoginModal(); };
    $('email-login-form').onsubmit = async e => {
      e.preventDefault();
      if (emailLoginInFlight) return;
      const email = $('login-email').value.trim();
      const password = $('login-password').value;
      const submit = $('email-login-submit');
      const back = $('email-back');
      emailLoginInFlight = true;
      submit.disabled = true;
      back.disabled = true;
      setLoginProgress('Signing in...', true);
      beginInteractiveLogin('email');
      try {
        await auth.signInWithEmailAndPassword(email, password);
      } catch (err) {
        console.error('[Email sign-in]', err);
        const code = err && err.code ? err.code : '';
        let msg = err && err.message ? err.message : 'Email sign-in failed.';
        if (code === 'auth/operation-not-allowed') msg = 'Enable Email/Password in Tester Teaching > Authentication > Sign-in method.';
        else if (code === 'auth/invalid-email') msg = 'The email address is not valid.';
        else if (code === 'auth/user-disabled') msg = 'This Firebase user is disabled.';
        else if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') msg = 'Email or password is incorrect, or the Firebase user has not been created yet.';
        else if (code === 'auth/too-many-requests') msg = 'Too many failed attempts. Try again later.';
        failLoginPerformance('firebase-auth');
        emailLoginInFlight = false;
        submit.disabled = false;
        back.disabled = false;
        setLoginProgress(msg, false);
        toast(msg, true);
      }
    };
  }

  function clearRecaptcha() {
    if (recaptchaVerifier) {
      try { recaptchaVerifier.clear(); } catch (_) {}
      recaptchaVerifier = null;
    }
  }

  function openPhoneLoginModal() {
    clearRecaptcha();
    phoneConfirmation = null;
    showModal(`
      <div class="modal-header"><div class="modal-title">Phone Sign In</div><div class="modal-subtitle">Firebase sends an SMS verification code after reCAPTCHA.</div></div>
      <form id="phone-login-form"><div class="modal-body">
        <div class="login-cheatsheet"><strong>Firebase setup:</strong> Authentication > Sign-in method > enable <strong>Phone</strong>.<br>Canadian numbers can be entered as <code>4035551234</code> or <code>+14035551234</code>. For repeated testing, Firebase test phone numbers are recommended.</div>
        <div class="form-field"><label class="form-label">Phone number</label><input class="form-input" id="login-phone" type="tel" placeholder="+14035551234" autocomplete="tel" required></div>
        <div class="form-field"><label class="form-label">reCAPTCHA</label><div id="recaptcha-container" style="min-height:78px;padding-top:4px"></div></div>
        <p id="phone-login-status" class="form-hint" role="status" aria-live="polite" style="min-height:20px;margin-top:10px"></p>
      </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="phone-back">Back</button><button class="btn btn-primary" id="phone-send-submit" type="submit">Send SMS Code</button></div></form>`);
    $('phone-back').onclick = () => { if (!phoneSendInFlight) openLoginModal(); };
    try {
      recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', { size: 'normal' });
      recaptchaVerifier.render().catch(err => console.error('[reCAPTCHA render]', err));
    } catch (err) {
      console.error('[reCAPTCHA init]', err);
      toast('Could not initialize reCAPTCHA. Make sure you opened http://localhost:8765/.', true);
    }
    $('phone-login-form').onsubmit = async e => {
      e.preventDefault();
      if (phoneSendInFlight) return;
      const phone = normalizePhoneForFirebase($('login-phone').value);
      if (!/^\+\d{8,15}$/.test(phone)) { toast('Enter a valid phone number, preferably in +1... format.', true); return; }
      const submit = $('phone-send-submit');
      const back = $('phone-back');
      phoneSendInFlight = true;
      submit.disabled = true;
      back.disabled = true;
      setLoginProgress('Sending SMS code...', true);
      try {
        if (!recaptchaVerifier) throw new Error('reCAPTCHA is not initialized.');
        phoneConfirmation = await auth.signInWithPhoneNumber(phone, recaptchaVerifier);
        phoneSendInFlight = false;
        submit.disabled = false;
        back.disabled = false;
        setLoginProgress('', false);
        clearRecaptcha();
        openPhoneCodeModal(phone);
      } catch (err) {
        console.error('[Phone sign-in]', err);
        const code = err && err.code ? err.code : '';
        let msg = err && err.message ? err.message : 'Could not send SMS code.';
        if (code === 'auth/operation-not-allowed') msg = 'Enable Phone in Tester Teaching > Authentication > Sign-in method.';
        else if (code === 'auth/invalid-phone-number') msg = 'The phone number is invalid. Use +1 followed by the Canadian number.';
        else if (code === 'auth/unauthorized-domain') msg = 'Add localhost in Tester Teaching > Authentication > Settings > Authorized domains.';
        else if (code === 'auth/quota-exceeded') msg = 'Firebase SMS quota has been exceeded. Use a Firebase test phone number or try later.';
        else if (code === 'auth/captcha-check-failed') msg = 'reCAPTCHA verification failed. Reload and try again.';
        else if (code === 'auth/too-many-requests') msg = 'Too many SMS requests. Use a Firebase test phone number or wait before trying again.';
        phoneSendInFlight = false;
        submit.disabled = false;
        back.disabled = false;
        setLoginProgress(msg, false);
        toast(msg, true);
        clearRecaptcha();
        setTimeout(openPhoneLoginModal, 250);
      }
    };
  }

  function openPhoneCodeModal(phone) {
    showModal(`
      <div class="modal-header"><div class="modal-title">Enter SMS Code</div><div class="modal-subtitle">Verification code sent to ${escapeHtml(phone)}.</div></div>
      <form id="phone-code-form"><div class="modal-body">
        <div class="form-field"><label class="form-label">6-digit verification code</label><input class="form-input" id="phone-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required></div>
        <p id="phone-code-status" class="form-hint" role="status" aria-live="polite" style="min-height:20px;margin-top:10px"></p>
      </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="code-back">Use another number</button><button class="btn btn-primary" id="phone-verify-submit" type="submit">Verify & Sign In</button></div></form>`);
    $('code-back').onclick = () => { if (!phoneVerifyInFlight) openPhoneLoginModal(); };
    $('phone-code-form').onsubmit = async e => {
      e.preventDefault();
      if (phoneVerifyInFlight) return;
      const code = $('phone-code').value.trim();
      const submit = $('phone-verify-submit');
      const back = $('code-back');
      phoneVerifyInFlight = true;
      submit.disabled = true;
      back.disabled = true;
      setLoginProgress('Verifying code...', true);
      beginInteractiveLogin('phone');
      try {
        if (!phoneConfirmation) throw new Error('SMS verification session expired.');
        await phoneConfirmation.confirm(code);
        phoneConfirmation = null;
      } catch (err) {
        console.error('[Phone code confirm]', err);
        const codeName = err && err.code ? err.code : '';
        let msg = err && err.message ? err.message : 'Verification failed.';
        if (codeName === 'auth/invalid-verification-code') msg = 'The SMS code is incorrect.';
        else if (codeName === 'auth/code-expired') msg = 'The SMS code expired. Request a new one.';
        failLoginPerformance('firebase-auth');
        phoneVerifyInFlight = false;
        submit.disabled = false;
        back.disabled = false;
        setLoginProgress(msg, false);
        toast(msg, true);
      }
    };
  }

  function openAuthSetupModal() {
    showModal(`
      <div class="modal-header"><div class="modal-title">Local Authentication Preferences</div><div class="modal-subtitle">Firebase Authentication signs users in. The PAWS University API checks the VetMed-Ops paws.UserProfile to authorize Beta access.</div></div>
      <form id="auth-setup-form"><div class="modal-body">
        <div class="login-cheatsheet">
          <strong>Firebase test project:</strong> Tester Teaching (<code>tester-teaching</code>)<br><br>
          <strong>Current Beta access path:</strong><br>
          1. Firebase Authentication verifies Email/Password or Phone identity.<br>
          2. PAWS University API authorizes the Firebase identity against the VetMed-Ops <code>paws.UserProfile</code>.<br>
          3. The SQL profile must be active and supplies the current PAWS role and authoritative FacultyId when applicable.<br>
          4. Timetable session reads use the PAWS University API backed by VetMed-Ops. Optional legacy Firestore enrichment is not authorization authority.<br><br>
          Local settings below are only client-side convenience checks and display preferences.
        </div>
        <div class="form-field"><label class="form-label">Allowed email domain</label><input class="form-input" id="auth-domain" value="${escapeHtml(authSettings.allowedDomain)}" placeholder="ucalgary.ca"><div class="form-hint">Optional local pre-check only. Server authorization remains with the PAWS University API and VetMed-Ops UserProfile.</div></div>
        <div class="form-field"><label class="form-label">Allowed phone number(s) - optional</label><textarea class="form-input" id="auth-allowed-phones" rows="3" placeholder="+14035551234, +14035555678">${escapeHtml(authSettings.allowedPhones)}</textarea><div class="form-hint">Leave blank to skip this local phone pre-check. Server authorization remains with the PAWS University API and VetMed-Ops UserProfile.</div></div>
        <div class="form-field"><label class="form-label">Instructor mapping</label><input class="form-input" id="auth-instructor" value="${escapeHtml(authSettings.instructorAlias)}" placeholder="Faculty 001"><div class="form-hint">Fallback display mapping for My Timetable. When present, the SQL profile FacultyId remains authoritative.</div></div>
        <div class="login-cheatsheet"><strong>Local test URL:</strong><br><code>http://localhost:8765/</code></div>
      </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="auth-setup-cancel">Cancel</button><button class="btn btn-primary" type="submit">Save Local Settings</button></div></form>`);
    $('auth-setup-cancel').onclick = closeModal;
    $('auth-setup-form').onsubmit = e => {
      e.preventDefault();
      saveAuthSettings({
        allowedDomain: $('auth-domain').value.trim(),
        allowedPhones: $('auth-allowed-phones').value.trim(),
        instructorAlias: $('auth-instructor').value.trim() || 'Faculty 001'
      });
      closeModal();
      if (currentUser) {
        currentUser.instructorName = String(currentUser.profile?.instructor || authSettings.instructorAlias || 'Faculty 001');
        updateAuthUI();
        render();
      }
      toast('Local settings saved. PAWS role and FacultyId still come from the VetMed-Ops access profile through the University API.');
    };
  }

  function openAccountModal() {
    const identity = currentUser.email || currentUser.phone || currentUser.identity || '';
    const providerLabel = currentUser.provider === 'phone' ? 'Phone verified' : 'Email verified';
    showModal(`
      <div class="modal-header"><div class="modal-title">${escapeHtml(currentUser.name)}</div><div class="modal-subtitle">${escapeHtml(identity)} | role: ${escapeHtml(currentUser.role)} | ${providerLabel}</div></div>
      <div class="modal-body">
        <div class="login-cheatsheet">
          <strong>Authentication:</strong> Firebase ${escapeHtml(currentUser.provider)} sign-in.<br>
          <strong>Authorization:</strong> PAWS University API + VetMed-Ops <code>paws.UserProfile</code>.<br>
          <strong>Role:</strong> ${escapeHtml(currentUser.role)} &nbsp; <strong>Active:</strong> ${currentUser.active ? 'true' : 'false'}<br>
          <strong>Timetable sessions:</strong> VetMed-Ops via the PAWS University API.
        </div>
        <div class="form-hint">My Timetable mapping: <strong>${escapeHtml(displayFaculty(currentUser.instructorName))}</strong>.</div>
      </div>
      <div class="modal-footer"><a class="btn btn-secondary" href="password.html">Change password</a><button class="btn btn-secondary" id="account-close">Close</button><button class="btn btn-primary" id="logout-btn">Sign Out</button></div>`);
    $('account-close').onclick = closeModal;
    $('logout-btn').onclick = async () => {
      closeModal();
      if (auth) await auth.signOut().catch(err => console.error(err));
    };
  }

  function updateAuthUI() {
    const b = $('account-toggle');
    const showAdminTools=canEdit()||UCVM.general(currentUser)||currentUser?.role==='hicc';
    b.textContent = currentUser ? `${currentUser.name} - ${currentUser.role}` : 'Sign in';
    b.classList.toggle('is-admin', canEdit());
    const sessionCreateEnabled=Boolean(window.UCVM_PAWS_DATA?.sessionCreateEnabled?.());
    $('add-session-btn').classList.toggle('hidden', !canEditExistingSqlSession() || !sessionCreateEnabled);
    $('selection-controls').classList.add('hidden');
    $('bulk-add-session-btn').classList.toggle('hidden', !canEditExistingSqlSession() || !sessionCreateEnabled);
    $('outlook-invite-btn').classList.toggle('hidden', !UCVM.admin(currentUser));
    $('manage-users-btn').classList.toggle('hidden', !(UCVM.general(currentUser) || currentUser?.role === 'hicc'));
    $('faculty-dashboard-btn').classList.toggle('hidden', !UCVM.canOpenFacultyDashboard(currentUser));
    $('ccc-schedule-btn').classList.toggle('hidden', !currentUser);
    $('hicc-cc-list-btn').classList.toggle('hidden', !currentUser);
    $('visc-list-btn').classList.toggle('hidden', !currentUser);
    $('swap-inbox-btn').classList.toggle('hidden',!currentUser);
    $('swap-inbox-btn').onclick=()=>window.PAWS_SWAP?.openQueue();
    window.PAWS_SWAP?.syncUser();
    window.PAWS_TASKS?.refresh();
    $('teaching-assignments-btn').classList.toggle('hidden', !currentUser || !['faculty','hicc','visc','developer','owner','administrator','adfa_general','adfa_regular','admin'].includes(String(currentUser.role || '').trim().toLowerCase()));
    $('cal-admin-menu').classList.toggle('hidden',!showAdminTools);
    for(const id of ['my-teaching-btn','afc-request-btn','my-change-history-btn','cal-changes-btn'])$(id).classList.toggle('hidden',!currentUser);
    $('publish-firestore-schedule').classList.add('hidden');
    updateScheduleSourceUI();
    $('my-timetable-btn').classList.toggle('hidden', !currentUser || roleIsFaculty(currentUser));
    $('my-timetable-btn').textContent = currentUser && myTimetableOnly ? 'Show All Timetable' : 'My Timetable';
    scheduleWorkspace?.sync(Boolean(currentUser));
  }

  function openUserManager() {
    if (UCVM.general(currentUser) || currentUser?.role === 'hicc') location.href = 'user-management.html';
  }

  function openExportDialog(format){
    const today=ymd(new Date());
    showModal(`<div class="modal-header"><div class="modal-title">Export ${format==='ics'?'Calendar':'Schedule Data'}</div><div class="modal-subtitle">Exports teaching sessions using the current course, type, search and My Timetable filters. CCC and Rotation are working activities, so they are not included in this teaching-only export.</div></div><form id="export-form"><div class="modal-body">
      <div class="login-cheatsheet"><label><input type="radio" name="scope" value="date" checked> Date range</label> &nbsp; <label><input type="radio" name="scope" value="academic"> Academic period</label> &nbsp; <label><input type="radio" name="scope" value="all"> All dates</label></div>
      <div class="form-grid" id="export-date-fields">${input('export-start','Start date','date',today)}${input('export-end','End date','date','2027-08-31')}</div>
      <div class="form-grid hidden" id="export-academic-fields">${select('export-semester','Semester',['fall','winter','spring'],selectedSemester)}${select('export-week','Week',['all',...Array.from({length:WEEK_COUNT},(_,i)=>String(i+1))],'all')}${select('export-year','Year',['all','1','2','3','4'],selectedYear)}</div>
      <p class="form-hint">${format==='ics'?'Produces a standard .ics file for Outlook, Apple Calendar and Google Calendar.':'Produces one complete row per matching teaching session.'}</p>
      ${format==='csv'?'<button type="button" class="btn btn-secondary" id="export-choose-sessions">Choose courses / sessions</button>':''}
    </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="export-cancel">Cancel</button><button class="btn btn-primary" type="submit">Export</button></div></form>`);
    $('export-cancel').onclick=closeModal;
    if($('export-choose-sessions'))$('export-choose-sessions').onclick=openSelectedScheduleExport;
    document.querySelectorAll('input[name="scope"]').forEach(r=>r.onchange=()=>{$('export-date-fields').classList.toggle('hidden',r.value!=='date'||!r.checked);$('export-academic-fields').classList.toggle('hidden',r.value!=='academic'||!r.checked)});
    $('export-form').onsubmit=async e=>{
      e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='Preparing...';
      try{
        const scope=new FormData(e.currentTarget).get('scope');let all;
        if(scope==='all')all=await ensureAllSessions();
        else if(scope==='date')all=await ensureSessionsForRange($('export-start').value,$('export-end').value);
        else {const semester=$('export-semester').value,week=$('export-week').value,start=weekStart(week==='all'?1:Number(week),semester),end=addDays(weekStart(week==='all'?WEEK_COUNT:Number(week),semester),4);all=await ensureSessionsForRange(ymd(start),ymd(end))}

        const rows=exportFilteredRows(all,{scope,start:$('export-start').value,end:$('export-end').value,semester:$('export-semester').value,week:$('export-week').value,year:$('export-year').value});
        if(!rows.length){toast('No records match these export settings.',true);button.disabled=false;button.textContent='Export';return}
        format==='ics'?exportCalendar(rows):exportCsv(rows);closeModal();toast(`${rows.length} schedule records exported.`);
      }catch(err){console.error('[schedule export]',err);toast('Export failed while reading the complete schedule.',true);button.disabled=false;button.textContent='Export'}
    };
  }
  async function openSelectedScheduleExport(){
    if(!currentUser?.uid){toast('Sign in to export your authorized schedule.',true);return;}
    const scope=()=>JSON.stringify([currentUser?.uid,currentUser?.role,currentUser?.profile?.facultyId||'']);
    const ownerScope=scope();
    showModal('<div class="modal-header"><div class="modal-title">Selected Schedule CSV</div><div class="modal-subtitle">Choose from your complete authorized teaching timetable across dates. Preview the exact selected records before downloading.</div></div><div class="modal-body" id="export-selection-body"><p role="status">Loading authorized sessions…</p></div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="export-selection-cancel">Cancel</button><button type="button" class="btn btn-primary" id="export-selection-download" disabled>Download selected CSV</button></div>');
    $('modal').querySelector('.modal-box').classList.add('selected-export-modal');
    const host=$('export-selection-body'),download=$('export-selection-download');
    $('export-selection-cancel').onclick=closeModal;
    let inactive=false;
    const authorized=()=>!inactive&&host.isConnected&&scope()===ownerScope;
    const detach=()=>{pageDataSubscribers.delete(onScopeChange);observer.disconnect();};
    const invalidate=message=>{inactive=true;if(host.isConnected){host.innerHTML='<p role="alert">'+escapeHtml(message)+'</p>';download.disabled=true;download.textContent='Download selected CSV';}detach();};
    const onScopeChange=()=>{if(!host.isConnected)detach();else if(scope()!==ownerScope)invalidate('Your account changed. Reopen export to load the current authorized schedule.');};
    const observer=new MutationObserver(()=>{if(!host.isConnected)detach();});
    observer.observe($('modal'),{childList:true});pageDataSubscribers.add(onScopeChange);
    try{
      const source=await ensureAllSessions({refresh:true,notify:false});
      if(!authorized())return;
      const model=window.UCVM_TIMETABLE_SELECTION.createExport(source),items=model.items();
      if(selectedCourses.size)model.selectCourses([...selectedCourses]);
      const courses=[...new Set(items.map(row=>row.courseCode))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
      let shown=100,previewed=false,downloading=false;
      host.innerHTML=`<div class="export-selection-toolbar"><strong id="export-selection-count" aria-live="polite"></strong><button type="button" class="btn btn-secondary" id="export-selection-all">Select all sessions</button><button type="button" class="btn btn-secondary" id="export-selection-clear">Clear selection</button><button type="button" class="btn btn-secondary" id="export-selection-preview-button">Preview selected</button></div><p class="form-hint">Select up to 5,000 sessions. Course checkboxes select all sessions in that course. Missing information is shown as Not provided.</p><p role="alert" id="export-selection-error"></p><div class="export-selection-layout"><fieldset class="export-selection-courses"><legend>Courses</legend>${courses.map(code=>`<label><input type="checkbox" data-export-course="${escapeHtml(code)}" aria-label="Select course ${escapeHtml(code||'Not provided')}"> ${escapeHtml(code||'Not provided')} <small>(${items.filter(row=>row.courseCode===code).length})</small></label>`).join('')}</fieldset><div><p id="export-selection-visible" class="form-hint"></p><div class="user-table-wrap"><table class="user-table export-session-table"><thead><tr><th>Select</th><th>Date / Time</th><th>Course / Session</th><th>Faculty</th><th>Room</th></tr></thead><tbody id="export-selection-rows"></tbody></table></div><button type="button" class="btn btn-secondary" id="export-selection-more">Show more sessions</button></div></div><div id="export-selection-preview" hidden></div>`;
      const guard=()=>{if(authorized())return true;if(!inactive)invalidate('Your account changed. Reopen export to load the current authorized schedule.');return false;};
      const sync=()=>{
        $('export-selection-count').textContent=`${model.size} selected · ${items.length} available`;
        $('export-selection-preview-button').disabled=model.size===0;
        download.disabled=downloading||!previewed||model.size===0;
        host.querySelectorAll('[data-export-session]').forEach(box=>{box.checked=model.has(box.dataset.exportSession);});
        host.querySelectorAll('[data-export-course]').forEach(box=>{const rows=items.filter(row=>row.courseCode===box.dataset.exportCourse),count=rows.filter(row=>model.has(row.id)).length;box.checked=count===rows.length;box.indeterminate=count>0&&count<rows.length;});
      };
      const change=action=>{if(!guard())return;try{action();previewed=false;$('export-selection-preview').hidden=true;$('export-selection-preview').textContent='';$('export-selection-error').textContent='';}catch(_){$('export-selection-error').textContent='Selection exceeds the 5,000-session limit. Select fewer courses or individual sessions.';}sync();};
      const renderRows=()=>{
        $('export-selection-rows').innerHTML=items.slice(0,shown).map(row=>`<tr><td><input type="checkbox" data-export-session="${escapeHtml(row.id)}" aria-label="Select session ${escapeHtml([row.courseCode,row.date,row.topic||'Untitled'].join(' '))}"></td><td>${escapeHtml(row.date||'Date not provided')}<br><small>${escapeHtml(row.startTime&&row.endTime?row.startTime+'–'+row.endTime:'Time not provided')}</small></td><td><strong>${escapeHtml(row.courseCode||'Not provided')}</strong> ${escapeHtml(row.courseName)}<br>${escapeHtml(row.topic||'Not provided')}<br><small>${escapeHtml(row.type||'Not provided')}</small></td><td>${escapeHtml(row.faculty||'Not provided')}</td><td>${escapeHtml(row.room||'Not provided')}</td></tr>`).join('');
        $('export-selection-visible').textContent=`Showing ${Math.min(shown,items.length)} of ${items.length} authorized sessions`;
        $('export-selection-more').hidden=shown>=items.length;
        host.querySelectorAll('[data-export-session]').forEach(box=>{box.onchange=()=>change(()=>model.toggle(box.dataset.exportSession));});sync();
      };
      host.querySelectorAll('[data-export-course]').forEach(box=>{box.onchange=()=>change(()=>model.setCourse(box.dataset.exportCourse,box.checked));});
      $('export-selection-all').onclick=()=>change(()=>model.selectAll());$('export-selection-clear').onclick=()=>change(()=>model.clear());
      $('export-selection-more').onclick=()=>{if(guard()){shown+=100;renderRows();}};
      $('export-selection-preview-button').onclick=()=>{
        if(!guard()||!model.size)return;
        const rows=model.preview(),labels=['Course Code','Course Name','Session Date','Start Time','End Time','Topic','Session Type','Faculty','Room','VISC'],keys=['courseCode','courseName','date','startTime','endTime','topic','type','faculty','room','visc'];
        const preview=$('export-selection-preview');preview.hidden=false;preview.innerHTML=`<h3>Preview · ${rows.length} selected sessions</h3><div class="user-table-wrap"><table class="user-table export-preview-table"><thead><tr>${labels.map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${keys.map(key=>`<td>${escapeHtml(row[key]||'Not provided')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        previewed=true;sync();
      };
      download.onclick=async()=>{
        if(!guard()||!previewed||!model.size||downloading)return;
        const csv=model.csv(),ids=items.filter(row=>model.has(row.id)).map(row=>row.id);
        downloading=true;download.disabled=true;download.textContent='Revalidating…';
        try{
          const fresh=window.UCVM_TIMETABLE_SELECTION.createExport(await ensureAllSessions({refresh:true,notify:false}));
          if(!guard())return;
          if(!previewed||csv!==model.csv()){$('export-selection-error').textContent='Selection changed. Preview again before downloading.';previewed=false;return;}
          ids.forEach(id=>fresh.toggle(id));
          if(fresh.csv()!==csv){previewed=false;invalidate('The schedule changed. Reopen export and preview the current records.');return;}
          downloadFile(csv,'text/csv;charset=utf-8','ucvm-selected-timetable.csv');toast(`${model.size} selected schedule records exported.`);
        }catch(_){if(authorized()){previewed=false;invalidate('The authorized schedule could not be revalidated. Reopen export to retry.');}}
        finally{downloading=false;if(authorized()){download.textContent='Download selected CSV';download.disabled=!previewed||!model.size;}}
      };
      renderRows();
    }catch(_){if(authorized())invalidate('The authorized schedule could not be loaded. Close and reopen export to retry.');}
  }
  function exportFilteredRows(all,options){
    const source=all;
    return filteredSessions(source,{ignorePeriod:true}).filter(s=>{
      if(options.scope!=='academic'&&selectedYear!=='all'&&String(s.year)!==selectedYear)return false;
      if(options.scope==='date')return s.date>=options.start&&s.date<=options.end;
      if(options.scope==='academic')return s.semester===options.semester&&(options.week==='all'||String(s.week)===options.week)&&(options.year==='all'||String(s.year)===options.year);
      return true;
    }).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start||'').localeCompare(String(b.start||''))||String(a.course||'').localeCompare(String(b.course||'')));
  }
  function downloadFile(content,type,name){const blob=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href)}
  function exportCsv(data) {
    const header=['ID','Source','Date','Week','Semester','Year','Course','Course Name','Type','Topic','Instructor','Assignments JSON','Room','Start','End','Time Unknown','CCC'];
    const rows=[header,...data.map(s=>[s.id,s.sourceSystem||'',s.date,s.week,s.semester,s.year,s.course,s.courseName||'',s.type,s.topic,displayFacultyList(s.instructor),JSON.stringify(s.assignments||[]),s.room,s.start,s.end,!!s.timeUnknown,!!s.isCcc])];
    const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    downloadFile(csv,'text/csv;charset=utf-8','ucvm-filtered-timetable.csv');
  }
  function icsEscape(value){return String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
  function icsDate(date){return String(date).replace(/-/g,'')}
  // CN is a parameter, not a TEXT value: quote commas and encode quotes/newlines
  // using RFC 6868. Keep DESCRIPTION and other TEXT fields on icsEscape().
  function icsParameter(value){return '"'+String(value??'').replace(/\^/g,'^^').replace(/\r\n|\r|\n/g,'^n').replace(/"/g,"^'")+'"'}
  function exportCalendar(data){
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const events=data.map(s=>{
      const summary=icsEscape(`${s.course} ${s.type}${s.topic?` - ${s.topic}`:''}`),description=icsEscape(`Faculty: ${displayFacultyList(s.instructor||'TBD')}${s.room?`\nRoom: ${s.room}`:''}`);
      if(s.isCcc||s.timeUnknown||!s.start||!s.end){const next=ymd(addDays(parseYmd(s.date),1));return ['BEGIN:VEVENT',`UID:${icsEscape(s.id)}@ucvm-schedule`,`DTSTAMP:${stamp}Z`,`DTSTART;VALUE=DATE:${icsDate(s.date)}`,`DTEND;VALUE=DATE:${icsDate(next)}`,`SUMMARY:${summary}`,`DESCRIPTION:${description}`,'END:VEVENT'].join('\r\n')}
      return ['BEGIN:VEVENT',`UID:${icsEscape(s.id)}@ucvm-schedule`,`DTSTAMP:${stamp}Z`,`DTSTART;TZID=America/Edmonton:${icsDate(s.date)}T${s.start.replace(':','')}00`,`DTEND;TZID=America/Edmonton:${icsDate(s.date)}T${s.end.replace(':','')}00`,`SUMMARY:${summary}`,`DESCRIPTION:${description}`,s.room?`LOCATION:${icsEscape(s.room)}`:'','END:VEVENT'].filter(Boolean).join('\r\n');
    }).join('\r\n');
    downloadFile(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//UCVM//Teaching Schedule//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n${events}\r\nEND:VCALENDAR\r\n`,'text/calendar;charset=utf-8','ucvm-filtered-timetable.ics');
  }

  function outlookAttendeesForSession(session){
    const emails=new Map();
    for(const assignment of Array.isArray(session.assignments)?session.assignments:[]){
      const faculty=facultyDirectory.find(f=>String(f.__id)===String(assignment?.ucid||assignment?.facultyId||''))||facultyForAssignment(assignment);
      const email=String(faculty?.email||'').trim().toLowerCase();if(email)emails.set(email,swapFacultyName(faculty)||assignment.name||email);
    }
    return [...emails].map(([email,name])=>({email,name:displayFaculty(name)}));
  }
  function exportOutlookInvites(data,organizer){
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const organizerEmail=String(organizer?.email||'').trim(),organizerName=displayFaculty(organizer?.name||organizerEmail||'UCVM Scheduling');
    const events=data.map(session=>{
      const summary=icsEscape(`${session.course} ${session.type}${session.topic?` - ${session.topic}`:''}`),description=icsEscape(`Faculty: ${displayFacultyList(session.instructor||'TBD')}${session.room?`\nRoom: ${session.room}`:''}`),attendees=outlookAttendeesForSession(session).map(a=>`ATTENDEE;CN=${icsParameter(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${icsEscape(a.email)}`);
      const times=session.isCcc||session.timeUnknown||!session.start||!session.end?[`DTSTART;VALUE=DATE:${icsDate(session.date)}`,`DTEND;VALUE=DATE:${icsDate(ymd(addDays(parseYmd(session.date),1)))}`]:[`DTSTART;TZID=America/Edmonton:${icsDate(session.date)}T${session.start.replace(':','')}00`,`DTEND;TZID=America/Edmonton:${icsDate(session.date)}T${session.end.replace(':','')}00`];
      return ['BEGIN:VEVENT',`UID:${icsEscape(session.id)}@ucvm-outlook`,`DTSTAMP:${stamp}Z`,...times,`SUMMARY:${summary}`,`DESCRIPTION:${description}`,session.room?`LOCATION:${icsEscape(session.room)}`:'',organizerEmail?`ORGANIZER;CN=${icsParameter(organizerName)}:mailto:${icsEscape(organizerEmail)}`:'',...attendees,'STATUS:CONFIRMED','SEQUENCE:0','END:VEVENT'].filter(Boolean).join('\r\n');
    }).join('\r\n');
    downloadFile(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//UCVM//Outlook Teaching Invitations//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:REQUEST\r\n${events}\r\nEND:VCALENDAR\r\n`,'text/calendar;charset=utf-8','ucvm-outlook-invite-package.ics');
  }
  async function openOutlookInviteDialog(){
    if(!UCVM.admin(currentUser)){toast('ADFA permission is required.',true);return}
    try{
      const [all]=await Promise.all([ensureAllSessions(),ensureFacultyDirectory()]);
      const today=ymd(new Date());
      showModal(`<div class="modal-header"><div class="modal-title">Outlook Invitation Package</div><div class="modal-subtitle">Prepare all currently filtered teaching sessions as Outlook meeting invitations.</div></div><form id="outlook-form"><div class="modal-body">
        <div class="login-cheatsheet"><label><input type="radio" name="scope" value="date"> Date range</label> &nbsp; <label><input type="radio" name="scope" value="academic"> Academic period</label> &nbsp; <label><input type="radio" name="scope" value="all" checked> All filtered dates</label></div>
        <div class="form-grid hidden" id="outlook-date-fields">${input('outlook-start','Start date','date',today)}${input('outlook-end','End date','date','2027-08-31')}</div>
        <div class="form-grid hidden" id="outlook-academic-fields">${select('outlook-semester','Semester',['fall','winter','spring'],selectedSemester)}${select('outlook-week','Week',['all',...Array.from({length:WEEK_COUNT},(_,i)=>String(i+1))],'all')}${select('outlook-year','Year',['all','1','2','3','4'],selectedYear)}</div>
        <div class="outlook-summary"><div><strong id="outlook-event-count">0</strong>sessions</div><div><strong id="outlook-attendee-count">0</strong>faculty emails</div><div><strong id="outlook-missing-count">0</strong>sessions without email</div></div>
        <p class="form-hint"><strong>This download does not send invitations or silently modify faculty calendars.</strong> It creates a METHOD:REQUEST <code>.ics</code> package with organizer and attendee details. Open it in Outlook to review before sending. Direct one-click delivery requires a UCalgary Entra app with delegated User.Read and Calendars.ReadWrite approval.</p>
      </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="outlook-cancel">Cancel</button><button class="btn btn-primary" type="submit">Download Outlook package</button></div></form>`);
      const options=()=>{const form=new FormData($('outlook-form'));return{scope:form.get('scope'),start:$('outlook-start').value,end:$('outlook-end').value,semester:$('outlook-semester').value,week:$('outlook-week').value,year:$('outlook-year').value}};
      const rows=()=>exportFilteredRows(all,options());
      const refresh=()=>{const data=rows(),withEmail=data.filter(s=>outlookAttendeesForSession(s).length);$('outlook-event-count').textContent=String(data.length);$('outlook-attendee-count').textContent=String(new Set(data.flatMap(s=>outlookAttendeesForSession(s).map(a=>a.email))).size);$('outlook-missing-count').textContent=String(data.length-withEmail.length)};
      $('outlook-cancel').onclick=closeModal;document.querySelectorAll('#outlook-form input[name="scope"]').forEach(radio=>radio.onchange=()=>{$('outlook-date-fields').classList.toggle('hidden',radio.value!=='date'||!radio.checked);$('outlook-academic-fields').classList.toggle('hidden',radio.value!=='academic'||!radio.checked);refresh()});document.querySelectorAll('#outlook-form input,#outlook-form select').forEach(input=>{if(input.name!=='scope')input.addEventListener('change',refresh)});refresh();
      $('outlook-form').onsubmit=event=>{event.preventDefault();const data=rows();if(!data.length){toast('No sessions match the current filters and range.',true);return}exportOutlookInvites(data,currentUser);closeModal();toast(`${data.length} Outlook invitations prepared for review.`)};
    }catch(error){console.error('[Outlook invitation package]',error);toast('Could not prepare the complete schedule for Outlook.',true)}
  }

  function resetTestData() { toast('There is no bundled timetable in V9.7. Use Faculty Dashboard → Teaching Summary → Replace & Sync All Faculty Summaries.', true); }

  function showModal(content) {
    const m = $('modal');
    m.innerHTML = `<div class="modal-backdrop"></div><div class="modal-box"><div class="modal-strip"></div><button class="modal-close" id="modal-x">x</button>${content}</div>`;
    m.classList.add('open');
    m.querySelector('.modal-backdrop').onclick = closeModal;
    $('modal-x').onclick = closeModal;
  }
  function closeModal() { clearRecaptcha(); $('modal').classList.remove('open'); $('modal').innerHTML = ''; }
  function toast(message, error=false) {
    const t = $('toast'); t.textContent = message; t.classList.toggle('error', error); t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), error ? 6500 : 2800);
  }

  init();
})();
