(() => {
  'use strict';

  const scheduling=window.UCVM_SCHEDULING;
  if(!scheduling)throw new Error('UCVM scheduling core is required.');

  const SESSION_COLLECTION = 'sessions';
  const SESSION_LOG_COLLECTION = 'session_change_log';
  const SPRING_BASE_MONDAY = new Date(2026, 3, 27);
  const FALL_BASE_MONDAY = new Date(2026, 7, 24);
  const WINTER_BASE_MONDAY = new Date(2027, 0, 4);
  const WEEK_COUNT = 17;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];


  // Firebase Web configuration is public by design. This local harness uses the
  // separate Tester Teaching project for REAL Authentication and REAL role lookup.
  // Authentication/roles and the timetable are live. All schedule reads/writes use Firestore; no bundled timetable data is shipped with this page.
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

  function canEdit() {
    return UCVM.admin(currentUser);
  }

  async function getRoleProfile(firebaseUser) {
    if (!db) throw new Error('Firestore is not initialized.');
    const snap = await window.UCVM_PAGE_DATA.profileSnapshot(firebaseUser.uid);
    if (!snap.exists) {
      const err = new Error(`No Firestore user profile exists for UID ${firebaseUser.uid}.`);
      err.code = 'ucvm/profile-not-found';
      throw err;
    }
    const data = snap.data() || {};
    if (data.active !== true) {
      const err = new Error('This timetable account is not active.');
      err.code = 'ucvm/profile-inactive';
      throw err;
    }
    const role = String(data.role || '').trim().toLowerCase();
    if (!['viewer', 'editor', 'admin', 'adfa_general', 'adfa_regular', 'hicc', 'visc', 'faculty'].includes(role)) {
      const err = new Error(`Invalid Firestore role: ${role || '(blank)'}. Use faculty, hicc, visc, adfa_regular, or adfa_general.`);
      err.code = 'ucvm/invalid-role';
      throw err;
    }
    return { ...data, role };
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
  let facultyLoading = null;
  let sessionRangeKey = '';
  const sessionCache = new Map();
  const sessionCacheRanges = [];
  const sessionRangeLoads = new Map();
  const sessionCacheDates = new Set();
  const sessionDateLoads = new Map();
  const pageDataSubscribers = new Set();
  let allSessionsCache = null;
  let allSessionsLoading = null;
  const profileSnapshots=new Map();
  function pageProfile(){return currentUser?{...currentUser.profile,name:currentUser.name,email:currentUser.email,role:currentUser.role,facultyId:currentUser.profile?.facultyId||''}:null}
  function pageSessions(){return[...sessionCache.values()]}
  function publishPageData(){for(const callback of pageDataSubscribers){try{callback()}catch(error){console.error('[page data subscriber]',error)}}}
  function cacheSessionRange(range,rows){
    for(const [id,row] of sessionCache)if(row.date>=range.start&&row.date<=range.end)sessionCache.delete(id);
    for(const row of rows)sessionCache.set(row.id,row);
    if(!sessionCacheRanges.some(item=>item.start===range.start&&item.end===range.end))sessionCacheRanges.push({...range});
  }
  function sessionQueryForRange(range){
    let query=db.collection(SESSION_COLLECTION).where('date','>=',range.start).where('date','<=',range.end);
    const facultyId=roleIsFaculty(currentUser)?String(currentUser.profile?.facultyId||'').trim():'';
    if(facultyId)query=query.where('facultyIds','array-contains',facultyId);
    return query;
  }
  async function ensureSessionsForRange(start,end){
    const range={start:String(start||'').slice(0,10),end:String(end||'').slice(0,10)};
    if(!db||!currentUser||!range.start||!range.end||range.start>range.end)return[];
    const covered=sessionCacheRanges.some(item=>item.start<=range.start&&item.end>=range.end);
    if(covered)return pageSessions().filter(row=>row.date>=range.start&&row.date<=range.end);
    const key=`${range.start}:${range.end}`;
    if(!sessionRangeLoads.has(key))sessionRangeLoads.set(key,sessionQueryForRange(range).get().then(snapshot=>{
      const rows=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
      cacheSessionRange(range,rows);publishPageData();return rows.slice();
    }).finally(()=>sessionRangeLoads.delete(key)));
    return sessionRangeLoads.get(key);
  }
  async function ensureSessionsForDates(values){
    const dates=UCVM_DATA_INDEX.dateChunks(values).flat(),missing=dates.filter(date=>!sessionCacheDates.has(date)&&!sessionCacheRanges.some(range=>range.start<=date&&date<=range.end));
    await Promise.all(UCVM_DATA_INDEX.dateChunks(missing).map(dateChunk=>{
      const key=dateChunk.join('|');
      if(!sessionDateLoads.has(key))sessionDateLoads.set(key,db.collection(SESSION_COLLECTION).where('date','in',dateChunk).get().then(snapshot=>{
        for(const [id,row] of sessionCache)if(dateChunk.includes(String(row.date||'').slice(0,10)))sessionCache.delete(id);
        for(const doc of snapshot.docs)sessionCache.set(doc.id,{id:doc.id,...doc.data()});
        dateChunk.forEach(date=>sessionCacheDates.add(date));publishPageData();
      }).finally(()=>sessionDateLoads.delete(key)));
      return sessionDateLoads.get(key);
    }));
    return pageSessions().filter(row=>dates.includes(String(row.date||'').slice(0,10)));
  }
  window.UCVM_PAGE_DATA={
    profile:()=>pageProfile(),
    faculty:()=>currentFacultyRecord,
    sessions:()=>pageSessions(),
    ensureSessionsForRange,
    subscribe:callback=>{pageDataSubscribers.add(callback);return()=>pageDataSubscribers.delete(callback)},
    facultyDirectory:()=>facultyDirectory.slice(),
    allSessions:()=>ensureAllSessions(),
    updateDerivedIndexes:changes=>updateDerivedIndexes(changes),
    profileSnapshot:uid=>{
      if(!profileSnapshots.has(uid))profileSnapshots.set(uid,db.collection('users').doc(uid).get());
      return profileSnapshots.get(uid);
    }
  };
  let scheduleSource = 'firestore-pending';
  let currentUser = null;
  let selectedWeek = 1;
  let selectedYear = 'all';
  let selectedSemester = 'fall';
  let viewMode = 'week';
  let lastFacultyTeachingView = 'day';
  let selectedDayIndex = 0;
  let selectedCourses = new Set();
  let courseFilterActive = false;
  let showCcc = false;
  let cccEvents = [];
  let cccLoaded = false;
  let cccLoading = null;
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
    return !media.matches;
  }
  function setScheduleFiltersExpanded(expanded, persist=true) {
    const panel=$('schedule-filter-panel'),button=$('schedule-filter-toggle');
    panel.hidden=!expanded;
    button.setAttribute('aria-expanded',String(expanded));
    const chevron=button.querySelector('.schedule-filter-chevron');
    if(chevron)chevron.textContent=expanded?'⌃':'⌄';
    if(persist)try{window.sessionStorage.setItem(SCHEDULE_FILTERS_KEY,String(expanded))}catch(_){ }
  }
  function initializeScheduleFilters(matchMedia=window.matchMedia.bind(window)) {
    let stored=null;
    try{stored=window.sessionStorage.getItem(SCHEDULE_FILTERS_KEY)}catch(_){ }
    setScheduleFiltersExpanded(initialScheduleFiltersExpanded(matchMedia('(max-width: 900px)'),stored),false);
    $('schedule-filter-toggle').addEventListener('click',()=>setScheduleFiltersExpanded($('schedule-filter-toggle').getAttribute('aria-expanded')!=='true'));
  }

  // ------------------ DATE/TIME ------------------
  function weekStart(week, semester) {
    const base = semester === 'winter' ? WINTER_BASE_MONDAY : (semester === 'spring' ? SPRING_BASE_MONDAY : FALL_BASE_MONDAY);
    const d = new Date(base); d.setDate(d.getDate() + (week - 1) * 7); return d;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function ymd(d) { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
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
    if (normalized === 'ccc') return 'tg-type-ccc';
    if (normalized === 'lec') return 'tg-type-lec';
    if (normalized === 'lab') return 'tg-type-lab';
    if (normalized === 'srl') return 'tg-type-srl';
    if (normalized === 'quiz/midterm') return 'tg-type-quiz-midterm';
    if (normalized === 'osce') return 'tg-type-osce';
    if (normalized === 'exam') return 'tg-type-exam';
    return 'tg-type-other';
  }

  function firestoreSafeSession(s) {
    const clean = JSON.parse(JSON.stringify(UCVM_INDEX_MAINTENANCE.sessionForWrite(s)));
    delete clean.__id;
    return clean;
  }

  function updateScheduleSourceUI() {
    const live = scheduleSource === 'firestore';
    const text = $('conn-text');
    if (text && currentUser) {
      if (live) text.textContent = `Authorized: ${currentUser.role} · Live Firestore schedule`;
      else if (scheduleSource === 'firestore-empty') text.textContent = `Authorized: ${currentUser.role} · No timetable sessions`;
      else if (scheduleSource === 'firestore-error') text.textContent = `Authorized: ${currentUser.role} · Timetable unavailable`;
      else text.textContent = `Authorized: ${currentUser.role} · Connecting to live timetable`;
    }
    const publish = $('publish-firestore-schedule');
    if (publish) {
      publish.classList.toggle('hidden', !UCVM.admin(currentUser));
      publish.textContent = live ? 'Synced Schedule Ready' : 'Sync from Faculty Dashboard';
      publish.disabled = false;
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

  function subscribeSessions() {
    if (!db || !currentUser) return;
    const range=visibleSessionRange(), key=`${viewMode}:${range.start}:${range.end}`;
    if(sessionUnsubscribe&&sessionRangeKey===key)return;
    if (sessionUnsubscribe) { try { sessionUnsubscribe(); } catch (_) {} }
    sessionRangeKey=key;
    sessionUnsubscribe = sessionQueryForRange(range).onSnapshot(snapshot => {
      sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      cacheSessionRange(range,sessions);
      publishPageData();
      window.dispatchEvent(new Event('ucvm:sessions-updated'));
      scheduleSource = sessions.length ? 'firestore' : 'firestore-empty';
      populateCourseFilter();
      updateScheduleSourceUI();
      render();
    }, err => {
      console.error('[sessions subscription]', err);
      sessions = []; scheduleSource = 'firestore-error';
      populateCourseFilter(); updateScheduleSourceUI();
      toast('The synchronized Firestore timetable could not be read.', true); render();
    });
  }

  function refreshSessionScope(){if(currentUser)subscribeSessions();else render()}
  async function ensureAllSessions(){
    if(allSessionsCache)return allSessionsCache.slice();
    if(allSessionsLoading)return allSessionsLoading;
    allSessionsLoading=db.collection(SESSION_COLLECTION).get().then(snapshot=>{
      allSessionsCache=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
      return allSessionsCache.slice();
    }).finally(()=>{allSessionsLoading=null});
    return allSessionsLoading;
  }
  function invalidateAllSessions(){allSessionsCache=null;sessionCacheRanges.length=0;sessionCacheDates.clear()}
  function swapNumeric(v){ if(v===undefined||v===null||v==='') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
  function swapNameKey(v){ return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' '); }
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

  function availabilityTimeMinutes(value){ return scheduling.parseTime(value); }
  function availabilityIntervalsOverlap(aStart,aEnd,bStart,bEnd){ return scheduling.intervalsOverlap(aStart,aEnd,bStart,bEnd)===true; }
  function sessionHasFaculty(sess,f){
    const id=String(f?.__id||''); const aliases=swapFacultyAliases(f);
    const arr=Array.isArray(sess?.assignments)?sess.assignments:[];
    if(arr.some(a=>String(a?.ucid||'')===id || aliases.has(swapNameKey(a?.name))))return true;
    return splitInstructorNames(sess?.instructor||'').some(n=>aliases.has(swapNameKey(n)));
  }
  function timetableAvailability(f,dateYmd,start,end,excludeSessionId=''){
    const d=String(dateYmd||'').slice(0,10);
    if(!d)return{available:null,conflicts:[],possibleConflicts:[],reason:'date'};
    const check=scheduling.findFacultyConflicts({date:d,start,end,sessions:pageSessions(),excludeSessionId,isAssigned:sess=>sessionHasFaculty(sess,f)});
    return{available:check.status==='clear'?true:(check.status==='conflict'?false:null),conflicts:check.conflicts,possibleConflicts:check.possibleConflicts,reason:check.reason==='target_time'?'target-time':(check.reason==='other_time_unknown'?'other-time-unknown':check.reason)};
  }
  function facultyAssignmentAvailability(f,dateYmd,start,end,excludeSessionId=''){
    const afc=facultyAvailability(f,dateYmd),tt=timetableAvailability(f,dateYmd,start,end,excludeSessionId);
    const unavailable=afc.available===false||tt.available===false;
    return{available:unavailable?false:(tt.available===null?null:true),afc,tt};
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
  function clearCurrentFaculty(){currentFacultyRecord=null;currentFacultyLoading=null;publishPageData()}
  function ensureCurrentFaculty(){
    const id=String(currentUser?.profile?.facultyId||'').trim();
    if(!db||!currentUser||!id){clearCurrentFaculty();return Promise.resolve(null)}
    if(currentFacultyRecord&&String(currentFacultyRecord.id)===id)return Promise.resolve(currentFacultyRecord);
    if(currentFacultyLoading)return currentFacultyLoading;
    currentFacultyLoading=db.collection('faculty').doc(id).get().then(doc=>{
      currentFacultyRecord=doc.exists?{id:doc.id,...doc.data()}:null;
      publishPageData();return currentFacultyRecord;
    }).catch(error=>{console.error('[current faculty load]',error);currentFacultyRecord=null;publishPageData();return null}).finally(()=>{currentFacultyLoading=null});
    return currentFacultyLoading;
  }
  async function updateDerivedIndexes(changes,options={}){
    try{return await UCVM_INDEX_MAINTENANCE.updateDerivedIndexes(db,changes,currentUser||{})}
    catch(error){console.error('[derived index update]',error);toast('The schedule was saved, but its lookup index could not be refreshed.',true);if(options.rethrow){error.committed=true;throw error}return null}
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
    if(!UCVM.admin(currentUser)){toast('Admin permission is required to swap faculty.',true);return;}
    if(scheduleSource!=='firestore'){toast('The synchronized live timetable must be loaded first.',true);return;}
    const s=sessions.find(x=>x.id===sessionId); if(!s)return;
    await Promise.all([ensureFacultyDirectory(),ensureSessionsForDates([s.date])]);
    const assignments=sessionAssignmentsForSwap(s); if(!assignments.length){toast('This course block has no faculty assignment to swap.',true);return;}
    if(!facultyDirectory.length){toast('Faculty directory could not be loaded.',true);return;}
    let selected=Math.min(Math.max(0,Number(initialAssignmentIndex)||0),assignments.length-1),candidateId='',specialMode='none',specialName='',specialReason='',lastDate=String(s.date||''),lastStart=String(s.start||''),lastEnd=String(s.end||'');
    const original=assignments.map(a=>({...a}));
    showModal(`<div class="modal-header"><div class="modal-title">Swap Faculty Assignment</div><div class="modal-subtitle">${escapeHtml(s.course)} · ${escapeHtml(s.type)} · ${escapeHtml(s.date)} · ${escapeHtml(s.topic)}</div></div><div class="modal-body"><div class="swap-layout"><section class="swap-current" id="swap-current"></section><section><div class="swap-section-title">Choose replacement</div><div class="swap-search-row"><input class="form-control" id="swap-search" placeholder="Search faculty by name"><button type="button" class="btn btn-secondary" id="swap-search-clear">Clear</button></div><div class="swap-candidate-list" id="swap-candidate-list"></div><div class="swap-special"><label class="form-label">Other replacement</label><select class="form-control" id="swap-special-mode"><option value="none">Use a faculty record above</option><option value="sessional">Sessional instructor</option><option value="other">Other / unassigned</option></select><input class="form-control hidden" id="swap-special-name" placeholder="Sessional instructor name"><textarea class="form-control hidden" id="swap-special-reason" placeholder="Required reason for a sessional or other replacement"></textarea></div></section></div><div class="swap-impact" id="swap-impact"></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="swap-cancel">Cancel</button><button type="button" class="btn btn-primary" id="swap-save">Save faculty change</button></div>`);
    document.querySelector('#modal .modal-box')?.classList.add('swap-wide');
    const currentBox=$('swap-current'),candidateBox=$('swap-candidate-list'),impactBox=$('swap-impact'),search=$('swap-search');
    function currentAssignment(){return assignments[selected]||assignments[0]}
    function fromFaculty(){return facultyForAssignment(currentAssignment())}
    function targetChoice(){
      if(specialMode==='sessional')return{kind:'sessional',faculty:null,id:'',name:specialName.trim()};
      if(specialMode==='other')return{kind:'other',faculty:null,id:'',name:'Other / Unassigned'};
      const faculty=facultyDirectory.find(f=>String(f.__id)===String(candidateId));return{kind:'faculty',faculty,id:faculty?.__id||'',name:faculty?swapFacultyName(faculty):''};
    }
    function currentDoe(f){const state=buildSwapDoeState().get(String(f?.__id));return state?.current??null}
    function projectedDoe(from,to,credit){
      const state=buildSwapDoeState(),fromState=state.get(String(from?.__id)),toState=state.get(String(to?.__id));
      return{from:fromState?((fromState.current??0)-credit):null,to:toState?((toState.current??0)+credit):null};
    }
    function renderCurrent(){
      const assignment=currentAssignment(),faculty=fromFaculty();
      currentBox.innerHTML=`<div class="swap-section-title">Current assignment</div>${assignments.map((a,i)=>`<button type="button" class="swap-current-chip ${i===selected?'active':''}" data-swap-current="${i}">${escapeHtml(a.name||a.ucid||`Faculty ${i+1}`)}<small>${escapeHtml(a.role||s.type||'')}</small></button>`).join('')}<div class="swap-current-detail"><strong>${escapeHtml(assignment.name||'Unknown faculty')}</strong><div>${escapeHtml(assignment.role||s.type||'')}</div><div>DOE credit ${swapPct(swapAssignmentCredit(assignment))}</div><div>Assigned DOE ${swapPct(currentDoe(faculty))}</div></div>`;
      currentBox.querySelectorAll('[data-swap-current]').forEach(button=>button.onclick=()=>{selected=Number(button.dataset.swapCurrent);candidateId='';renderAll()});
    }
    function renderCandidates(){
      const q=swapNameKey(search.value),from=fromFaculty(),fromId=String(from?.__id||'');
      const state=buildSwapDoeState();
      const rows=facultyDirectory.filter(f=>String(f.__id)!==fromId&&(!q||[swapFacultyName(f),f.email,f.rank,f.campus,f.teachingArea].some(v=>swapNameKey(v).includes(q)))).slice(0,120);
      candidateBox.innerHTML=rows.map(f=>{const st=state.get(String(f.__id))||{},target=st.target||swapEffectiveTarget(f),status=swapStatus(target.value,st.current);return `<button type="button" class="swap-candidate ${String(f.__id)===String(candidateId)?'active':''}" data-swap-candidate="${escapeHtml(f.__id)}"><span><strong>${escapeHtml(swapFacultyName(f))}</strong><small>${escapeHtml([f.rank,f.campus,f.teachingArea].filter(Boolean).join(' · ')||f.email||'Faculty')}</small></span><span class="swap-candidate-metrics"><b>${swapPct(st.current)}</b><small>Contract ${swapPct(target.value)} · ${escapeHtml(status.label)}</small></span></button>`}).join('')||'<div class="swap-empty">No matching faculty found.</div>';
      candidateBox.querySelectorAll('[data-swap-candidate]').forEach(button=>button.onclick=()=>{candidateId=button.dataset.swapCandidate;specialMode='none';$('swap-special-mode').value='none';renderAll()});
    }
    function renderImpact(){
      const assignment=currentAssignment(),from=fromFaculty(),target=targetChoice(),credit=swapAssignmentCredit(assignment),projected=projectedDoe(from,target.faculty,credit??0),date=$('swap-date')?.value||s.date,start=$('swap-start')?.value||s.start,end=$('swap-end')?.value||s.end;
      const fromTarget=from?swapEffectiveTarget(from):{value:null},toTarget=target.faculty?swapEffectiveTarget(target.faculty):{value:null};
      const toAvail=target.faculty?facultyAssignmentAvailability(target.faculty,date,start,end,s.id):{available:null,afc:{available:null},tt:{available:null,conflicts:[],possibleConflicts:[],reason:'faculty'}};
      impactBox.innerHTML=`<div class="swap-impact-title">Projected impact</div><div class="swap-impact-grid"><div class="swap-person"><div class="swap-person-name">${escapeHtml(from?swapFacultyName(from):(assignment.name||'Current faculty'))}</div><div class="swap-metric">Assigned DOE ${swapPct(currentDoe(from))} → <strong>${swapPct(projected.from)}</strong></div><div class="swap-metric">Contract ${swapPct(fromTarget.value)}</div></div><div class="swap-person"><div class="swap-person-name">${escapeHtml(target.name||'Choose a replacement')}</div><div class="swap-metric">Assigned DOE ${swapPct(currentDoe(target.faculty))} → <strong>${swapPct(projected.to)}</strong></div><div class="swap-metric">Contract ${swapPct(toTarget.value)}</div>${target.faculty?`<div class="swap-check ${toAvail.available===true?'ok':toAvail.available===false?'warn':'unknown'}">${escapeHtml(assignmentAvailabilityShort(toAvail))}<small>${escapeHtml(assignmentAvailabilityDetail(toAvail,date,start,end))}</small></div>`:''}</div></div>`;
    }
    function renderAll(){
      renderCurrent();renderCandidates();renderImpact();
      const mode=$('swap-special-mode');if(mode)mode.value=specialMode;
      $('swap-special-name')?.classList.toggle('hidden',specialMode!=='sessional');$('swap-special-reason')?.classList.toggle('hidden',specialMode==='none');
    }
    search.oninput=renderCandidates;$('swap-search-clear').onclick=()=>{search.value='';renderCandidates()};
    $('swap-special-mode').onchange=e=>{specialMode=e.target.value;candidateId='';renderAll()};$('swap-special-name').oninput=e=>{specialName=e.target.value;renderImpact()};$('swap-special-reason').oninput=e=>{specialReason=e.target.value};
    $('swap-cancel').onclick=closeModal;
    $('swap-save').onclick=async()=>{
      const assignment=currentAssignment(),target=targetChoice();if(!target.name){toast('Choose a replacement.',true);return}if(specialMode!=='none'&&!specialReason.trim()){toast('Enter a reason for a sessional or other replacement.',true);return}if(target.faculty&&String(target.faculty.__id)===String(facultyForAssignment(assignment)?.__id)){toast('Choose a different faculty member.',true);return}
      const next=assignments.map((a,i)=>i===selected?{...a,ucid:target.faculty?String(target.faculty.__id):null,name:target.name,source:target.kind==='faculty'?'Live timetable edit':target.kind}:a),prepared=finalizeInstructorAssignments(next,s.type,s.start,s.end,s.topic),availability=target.faculty?facultyAssignmentAvailability(target.faculty,s.date,s.start,s.end,s.id):null;
      if(availability?.available!==true&&!confirm(`${target.name} has an availability warning:\n\n${assignmentAvailabilityDetail(availability,s.date,s.start,s.end)}\n\nSave this faculty change anyway?`))return;
      const button=$('swap-save');button.disabled=true;button.textContent='Saving...';try{await saveSessionAssignmentChange(s,prepared,{action:'swap_faculty',reason:specialReason.trim(),fromFaculty:{ucid:assignment.ucid||null,name:assignment.name||''},toFaculty:{ucid:target.faculty?String(target.faculty.__id):null,name:target.name,kind:target.kind}});closeModal();toast('Faculty assignment updated.')}catch(error){console.error('[faculty swap]',error);toast(error.message||'Could not update the faculty assignment.',true);button.disabled=false;button.textContent='Save faculty change'}
    };
    renderAll();
  }

  async function saveSessionAssignmentChange(session,assignments,details={}){
    if(!UCVM.admin(currentUser))throw Error('Admin permission is required.');
    const before=JSON.parse(JSON.stringify(session)),after={...session,assignments,instructor:assignments.map(a=>a.name).filter(Boolean).join('; '),facultyIds:[...new Set(assignments.map(a=>a.ucid).filter(Boolean).map(String))],labDetails:labDetailsFromAssignments(session.type,assignments,session.topic)};
    const batch=db.batch(),ref=db.doc(`${SESSION_COLLECTION}/${session.id}`),logRef=db.collection(SESSION_LOG_COLLECTION).doc();
    batch.update(ref,{...firestoreSafeSession(after),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    batch.set(logRef,{...details,sessionId:session.id,course:session.course,date:session.date,topic:session.topic,changes:[{field:'assignments',label:'Faculty',before:before.assignments||[],after:assignments}],changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});
    await batch.commit();Object.assign(session,after);cacheSessionRange({start:session.date,end:session.date},[session]);invalidateAllSessions();await updateDerivedIndexes({sessions:[after]}, {rethrow:true});render();
  }

  // ------------------ RENDER ------------------
  function renderWeekControls() {
    const row1 = $('week-btn-row-1'), row2 = $('week-btn-row-2'); row1.innerHTML=''; row2.innerHTML='';
    const mobile = $('week-mobile-select'); mobile.innerHTML='';
    for (let w=1; w<=WEEK_COUNT; w++) {
      const btn = document.createElement('button'); btn.className='week-pill' + (w===selectedWeek?' active':''); btn.dataset.week=String(w); btn.textContent=String(w); (w<=9?row1:row2).appendChild(btn);
      const opt = document.createElement('option'); opt.value=String(w); opt.textContent=`Week ${w}`; if (w===selectedWeek) opt.selected=true; mobile.appendChild(opt);
    }
  }
  function syncWeekUI() { document.querySelectorAll('[data-week]').forEach(b=>b.classList.toggle('active', Number(b.dataset.week)===selectedWeek)); $('week-mobile-select').value=String(selectedWeek); }
  function initializeScheduleFilters(){
    setScheduleFiltersExpanded(initialScheduleFiltersExpanded(window.matchMedia('(max-width: 900px)'),storageGet(SCHEDULE_FILTERS_KEY)),false);
  }

  function refreshAdminTools(){
    const show=canEdit(),general=UCVM.general(currentUser);
    $('cal-admin-menu').classList.toggle('hidden',!show);
    $('bulk-add-session-btn').classList.toggle('hidden',!show);
    $('add-session-btn').classList.toggle('hidden',!show);
    $('selection-controls').classList.toggle('hidden',!show);
    $('manage-users-btn').classList.toggle('hidden',!general);
    $('faculty-dashboard-btn').classList.toggle('hidden',!show);
    $('publish-firestore-schedule').classList.toggle('hidden',!show);
    $('outlook-invite-btn').classList.toggle('hidden',!show);
  }

  function resetFilters() {
    selectedYear='all'; selectedCourses.clear(); courseFilterActive=false; showCcc=false;
    $('filter-month').value='all';$('filter-type').value='all';$('search-input').value='';$('show-ccc').checked=false;
    document.querySelectorAll('[data-year]').forEach(x=>x.classList.toggle('active',x.dataset.year==='all'));
    render();
  }

  function setViewButtons() {
    ['day','week','month','list'].forEach(mode=>$(`cal-${mode}-btn`).classList.toggle('active',viewMode===mode));
  }

  function filteredSessions(source=sessions,options={}) {
    const q = $('search-input').value.trim().toLowerCase();
    const month = $('filter-month').value;
    const type = $('filter-type').value;
    return source.filter(s => {
      if(String(s.type||'').toUpperCase()==='CCC'&&!showCcc)return false;
      if (!options.ignorePeriod && selectedYear !== 'all' && String(s.year) !== selectedYear) return false;
      if (!options.ignorePeriod && s.semester !== selectedSemester) return false;
      if (!options.ignorePeriod && month !== 'all' && String(parseYmd(s.date).getMonth()) !== month) return false;
      if (courseFilterActive && !selectedCourses.has(String(s.course))) return false;
      if (type !== 'all' && s.type !== type) return false;
      if (myTimetableOnly && currentUser && !sessionBelongsToCurrentFaculty(s)) return false;
      if (q && !`${s.course} ${s.topic} ${s.instructor} ${s.room} ${s.type}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function render() {
    if(viewMode==='day')renderDay();
    else if(viewMode==='week')renderWeek();
    else if(viewMode==='month')renderMonth();
    else renderList();
  }

  function layoutDaySessions(items) {
    const sorted = items.map(s => ({ session:s, startM:timeToMinutes(s.start), endM:timeToMinutes(s.end), lane:0, laneCount:1 }))
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

  function renderDay() {
    const date=addDays(weekStart(selectedWeek,selectedSemester),selectedDayIndex), dateText=ymd(date);
    $('cal-label').textContent=formatLongDate(date);
    const data=filteredSessions(sessionsWithCcc(sessions,dateText,dateText)).filter(s=>s.date===dateText);
    renderedSessions=data;
    const DAY_START=450,DAY_END=1020,SPAN=DAY_END-DAY_START,marks=[450,480,540,600,660,720,780,840,900,960,1020];
    let html=`<div class="tg-wrap day-single"><div class="tg-corner"></div><div class="tg-day-head"><div class="week-dow">${DAYS[selectedDayIndex]}</div><div class="week-date">${date.getDate()}</div></div></div><div class="tg-body day-single"><div class="tg-time-axis"><div class="tg-track">`;
    marks.forEach(m=>{const top=((m-DAY_START)/SPAN)*100,h=Math.floor(m/60),min=m%60,h12=((h+11)%12)+1;html+=`<span class="tg-hour-label" style="top:${top}%">${h12}:${String(min).padStart(2,'0')}</span>`});
    html+='</div></div><div class="tg-day-col">';
    marks.forEach(m=>{html+=`<div class="tg-gridline" style="top:${((m-DAY_START)/SPAN)*100}%"></div>`});
    layoutDaySessions(data).forEach(item=>{
      const s=item.session,startM=Math.max(DAY_START,item.startM),endM=Math.min(DAY_END,item.endM);if(endM<=DAY_START||startM>=DAY_END)return;
      const top=((startM-DAY_START)/SPAN)*100,height=Math.max(3.5,((endM-startM)/SPAN)*100),laneWidth=100/item.laneCount,left=item.lane*laneWidth;
      html+=`<div class="tg-block ${colorsOn?sessionTypeClass(s.type):'colors-off'}" data-session-id="${escapeHtml(s.id)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);right:auto;width:calc(${laneWidth}% - 4px)"><div class="tg-block-l1">${escapeHtml(s.course)} - ${escapeHtml(s.type)}</div><div class="tg-block-l2">${escapeHtml(s.topic)}</div><div class="tg-block-l3">${escapeHtml(s.start)}-${escapeHtml(s.end)}${s.room?` | ${escapeHtml(s.room)}`:''}<br>${escapeHtml(s.instructor||'TBD')}</div></div>`;
    });
    html+='</div></div>';$('calendar-body').innerHTML=html;bindSessionBlocks();
  }

  function renderWeek() {
    const start = weekStart(selectedWeek, selectedSemester); const end = addDays(start, 4);
    $('cal-label').textContent = `${selectedSemester === 'winter' ? 'Winter' : (selectedSemester === 'spring' ? 'Spring' : 'Fall')} Week ${selectedWeek} - ${formatDate(start)} to ${formatDate(end)}, ${end.getFullYear()}`;
    const data = filteredSessions(sessionsWithCcc(sessions,ymd(start),ymd(end))).filter(s => s.week === selectedWeek);
    renderedSessions=data;
    const DAY_START=450, DAY_END=1020, SPAN=DAY_END-DAY_START; // 7:30am-5:00pm
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
      const dayItems=layoutDaySessions(data.filter(s => s.date === date));
      dayItems.forEach(item => {
        const s=item.session;
        const startM = Math.max(DAY_START, item.startM), endM = Math.min(DAY_END, item.endM);
        if (endM <= DAY_START || startM >= DAY_END) return;
        const top = ((startM - DAY_START) / SPAN) * 100;
        const height = Math.max(3.5, ((endM - startM) / SPAN) * 100);
        const laneWidth=100/item.laneCount, left=item.lane*laneWidth;
        html += `<div class="tg-block ${colorsOn ? sessionTypeClass(s.type) : 'colors-off'} " data-session-id="${escapeHtml(s.id)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);right:auto;width:calc(${laneWidth}% - 4px)">
          <div class="tg-block-l1">${escapeHtml(s.course)} - ${escapeHtml(s.type)}</div>
          <div class="tg-block-l2">${escapeHtml(s.topic)}</div>
          <div class="tg-block-l3">${escapeHtml(s.start)}-${escapeHtml(s.end)}${s.room ? ` | ${escapeHtml(s.room)}` : ''}<br>${escapeHtml(s.instructor || 'TBD')}</div>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    $('calendar-body').innerHTML = html;
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
    const data = filteredSessions(sessionsWithCcc(sessions,ymd(first),ymd(last)));
    renderedSessions=data;
    let html = '<div class="cal-month"><div class="cal-dow-header">' + DAYS.map(d => `<div class="cal-dow">${d}</div>`).join('') + '</div><div class="cal-grid">';
    let cursor = new Date(monday);
    while (cursor <= last || cursor.getDay() !== 1) {
      for (let i = 0; i < 5; i++) {
        const cell = addDays(cursor, i); const dateStr = ymd(cell);
        const events = data.filter(s => s.date === dateStr).slice(0, 4);
        html += `<div class="cal-cell"><div class="cal-date-num">${cell.getDate()}</div><div class="cal-events">`;
        events.forEach(s => html += `<div class="cal-event ${colorsOn ? sessionTypeClass(s.type) : 'colors-off'} " data-session-id="${escapeHtml(s.id)}"><div class="cal-event-l1">${escapeHtml(s.course)} ${escapeHtml(s.type)}</div><div class="cal-event-l2">${s.timeUnknown?'Time not specified':escapeHtml(s.start)} ${escapeHtml(s.topic)}</div></div>`);
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
    const start=ymd(new Date()),end='9999-12-31';
    $('cal-label').textContent=`${formatLongDate(parseYmd(start))} onward`;
    const data=filteredSessions(sessionsWithCcc(sessions,start,end),{ignorePeriod:true}).filter(s=>s.date>=start).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start||'').localeCompare(String(b.start||''))||String(a.course||'').localeCompare(String(b.course||'')));
    renderedSessions=data;
    const rows=data.map(s=>`<tr data-session-id="${escapeHtml(s.id)}"><td>${escapeHtml(s.date)}</td><td>${escapeHtml(s.timeUnknown?'Time TBD':`${s.start||''}-${s.end||''}`)}</td><td><strong>${escapeHtml(s.course)}</strong></td><td>${escapeHtml(s.type)}</td><td>${escapeHtml(s.topic)}</td><td>${escapeHtml(s.instructor||'TBD')}</td><td>${escapeHtml(s.room||'')}</td></tr>`).join('');
    $('calendar-body').innerHTML=`<div class="schedule-list-wrap"><table class="schedule-list"><thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Type</th><th>Topic</th><th>Faculty</th><th>Room</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty-cell">No future sessions match the selected filters.</td></tr>'}</tbody></table></div>`;
    bindSessionBlocks();
  }

  function bindSessionBlocks() {
    document.querySelectorAll('[data-session-id]').forEach(el => {
      const s=renderedSessions.find(row=>String(row.id)===String(el.dataset.sessionId));
      el.classList.toggle('selection-candidate',selectionMode&&!s?.isCcc);
      el.classList.toggle('selection-selected',sessionSelection.has(el.dataset.sessionId));
      el.addEventListener('click',()=>{
        if(!selectionMode){openSessionDetail(el.dataset.sessionId);return}
        if(s?.isCcc){toast('CCC records are read-only and cannot be selected.',true);return}
        try{
          const selected=sessionSelection.toggle(el.dataset.sessionId);
          if(selected&&s)selectedSessionOriginals.set(String(s.id),JSON.parse(JSON.stringify(s)));
          if(!selected)selectedSessionOriginals.delete(String(el.dataset.sessionId));
          updateSelectionControls();render();
        }catch(error){toast(error.message,true)}
      });
    });
  }

  function switchCalendarView(next){
    viewMode=next;
    if(selectionMode&&reviewingSelection)reviewingSelection=false;
    if(roleIsFaculty(currentUser)&&(next==='day'||next==='list'))lastFacultyTeachingView=next;
    setViewButtons();refreshSessionScope();
  }

  async function startSessionSelection(){
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
    return facultyDirectory.map(f=>{const state=doeState.get(String(f.__id))||{},current=state.current===null||state.current===undefined?'Unavailable':swapPct(state.current),target=state.target||window.UCVM_FACULTY_DOE.effectiveTarget(f),targetLabel=window.UCVM_FACULTY_DOE.targetLabel(f);return `<label class="selection-faculty-option"><input type="checkbox" data-selection-faculty-option value="${escapeHtml(f.__id)}" ${selected.has(String(f.__id))?'checked':''}><span><strong>${escapeHtml(swapFacultyName(f))}</strong><small>Assigned DOE ${current} · ${escapeHtml(targetLabel)}${target.source==='override'?'<span class="doe-override-pill">Override</span>':''}</small></span></label>`}).join('');
  }
  function updateSelectionFacultyPicker(picker){
    const checked=[...picker.querySelectorAll('[data-selection-faculty-option]:checked')],summary=picker.querySelector('summary'),chips=picker.querySelector('.selection-faculty-chips');
    summary.textContent=checked.length?`${checked.length} faculty selected`:'Choose faculty';
    chips.innerHTML=checked.map(input=>{const f=facultyDirectory.find(row=>String(row.__id)===String(input.value)),state=selectionDoeState.get(String(input.value))||{},current=state.current===null||state.current===undefined?'DOE unavailable':`Assigned ${swapPct(state.current)}`;return `<span>${escapeHtml(swapFacultyName(f))}<small>${current}</small></span>`}).join('');
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
    $('calendar-body').innerHTML=`<div class="selection-errors hidden" id="selection-errors" role="alert"></div><div class="selection-review-wrap"><table class="selection-review"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>Faculty</th></tr></thead><tbody>${rows}</tbody></table></div><div class="selection-review-actions"><button class="btn btn-secondary" id="selection-back-btn">Back to selection</button><button class="btn btn-primary" id="selection-save-btn">Save ${data.length} selected session${data.length===1?'':'s'}</button></div>`;
    document.querySelectorAll('.selection-faculty-picker').forEach(updateSelectionFacultyPicker);document.querySelectorAll('[data-selection-faculty-option]').forEach(input=>input.onchange=()=>updateSelectionFacultyPicker(input.closest('.selection-faculty-picker')));
    $('selection-back-btn').onclick=()=>{reviewingSelection=false;viewMode=selectionViewFlow.finish();setViewButtons();refreshSessionScope()};
    $('selection-save-btn').onclick=saveSelectionReview;
  }

  function selectionRowFromDom(tr,original){
    const value=field=>tr.querySelector(`[data-selection-field="${field}"]`)?.value||'',course=value('course').trim(),type=value('type').trim(),start=value('start'),end=value('end'),topic=value('topic').trim(),date=value('date'),position=parseYmd(date).getTime()?academicPositionForDate(parseYmd(date)):{week:original.week,semester:original.semester};
    const chosen=[...tr.querySelectorAll('[data-selection-faculty-option]:checked')].map(input=>facultyDirectory.find(f=>String(f.__id)===String(input.value))).filter(Boolean),assignments=chosen.map(f=>({ucid:String(f.__id),name:swapFacultyName(f),role:defaultTeachingRole(type)})),ids=assignments.map(a=>a.ucid),assignmentChanged=JSON.stringify(ids.sort())!==JSON.stringify([...(original.facultyIds||[])].map(String).sort());
    return{...original,id:tr.dataset.sessionEditId,date,week:position.week,semester:position.semester,year:Number(value('year')),course,courseName:course===String(original.course||'')?original.courseName:(COURSES.find(c=>String(c.code)===course)?.name||''),type,start,end,topic,room:value('room'),timeUnknown:start===String(original.start||'')&&end===String(original.end||'')?Boolean(original.timeUnknown):false,assignments,facultyIds:ids,labDetails:assignmentChanged?labDetailsFromAssignments(type,assignments,topic):original.labDetails};
  }
  async function saveSelectionReview(){
    const originals=window.UCVM_TIMETABLE_SELECTION.selectedRows([...selectedSessionOriginals.values()],sessionSelection.ids()),originalById=new Map(originals.map(s=>[String(s.id),s])),rows=[...document.querySelectorAll('[data-selection-row]')].map(tr=>selectionRowFromDom(tr,originalById.get(String(tr.dataset.sessionEditId))));
    const facultyById=new Map(facultyDirectory.map(f=>[String(f.__id),f])),plan=window.UCVM_TIMETABLE_SELECTION.planChanges(originals,rows,{uid:currentUser.uid,email:currentUser.email,name:currentUser.name},firebase.firestore.FieldValue.serverTimestamp(),facultyById),errorBox=$('selection-errors');
    const warnings=[];for(const row of rows){for(const assignment of row.assignments||[]){const faculty=facultyById.get(String(assignment.ucid||''));if(!faculty)continue;const av=facultyAssignmentAvailability(faculty,row.date,row.start,row.end,row.id);if(av.available!==true)warnings.push(`${row.course} · ${assignment.name}: ${assignmentAvailabilityDetail(av,row.date,row.start,row.end)}`)}}
    if(plan.errors.length){errorBox.textContent=plan.errors.join('\n');errorBox.classList.remove('hidden');return}
    if(!plan.updates.length){toast('No changes to save.');return}
    if(warnings.length&&!confirm(`Faculty availability warnings:\n\n${warnings.slice(0,20).join('\n')}${warnings.length>20?`\n…and ${warnings.length-20} more`:''}\n\nSave the selected session changes anyway?`))return;
    const button=$('selection-save-btn');button.disabled=true;button.textContent='Saving...';
    try{
      const store={batch:()=>db.batch(),sessionRef:id=>db.doc(`${SESSION_COLLECTION}/${id}`),logRef:()=>db.collection(SESSION_LOG_COLLECTION).doc(),afterCommit:async()=>{const updates=plan.updates.map(update=>({id:update.id,...update.data}));updates.forEach(update=>{sessions=sessions.map(s=>String(s.id)===String(update.id)?{...s,...update}:s);const existing=sessionCache.get(String(update.id));if(existing)sessionCache.set(String(update.id),{...existing,...update})});invalidateAllSessions();await updateDerivedIndexes({sessions:updates},{rethrow:true})}};
      const result=await window.UCVM_TIMETABLE_SELECTION.commitPlan(plan,store);if(!result.committed){toast(result.errors?.join(' ')||'Nothing was saved.',true);return}cancelSessionSelection();toast(`${plan.updates.length} session${plan.updates.length===1?'':'s'} updated.`)
    }catch(error){console.error('[selection save]',error);toast(error.message||'Could not save selected sessions.',true);button.disabled=false;button.textContent='Save selected sessions'}
  }

  function sessionBelongsToCurrentFaculty(s){
    const id=String(currentUser?.profile?.facultyId||'');if(!id)return false;
    if((s.facultyIds||[]).map(String).includes(id))return true;
    const aliases=new Set([currentUser?.name,currentUser?.profile?.instructor,currentUser?.profile?.facultyDirectoryMatch?.name].map(swapNameKey).filter(Boolean));
    return (s.assignments||[]).some(a=>String(a?.ucid||'')===id||aliases.has(swapNameKey(a?.name)));
  }
  function roleIsFaculty(user){return['faculty','hicc','visc'].includes(UCVM.role(user?.role||user?.profile?.role))}

  function openSessionDetail(id){
    const s=renderedSessions.find(x=>String(x.id)===String(id))||sessions.find(x=>String(x.id)===String(id));if(!s)return;
    const assignmentRows=(s.assignments||[]).map((a,i)=>`<div class="session-assignment"><span>${escapeHtml(a.name||a.ucid||`Faculty ${i+1}`)}</span><small>${escapeHtml(a.role||s.type||'')}</small>${canEdit()?`<button class="session-swap-link" data-swap-index="${i}">Swap</button>`:''}</div>`).join('');
    showModal(`<div class="modal-header"><div class="modal-title">${escapeHtml(s.course)} · ${escapeHtml(s.type)}</div><div class="modal-subtitle">${escapeHtml(s.courseName||'')} · ${escapeHtml(s.date)}</div></div><div class="modal-body"><div class="detail-grid">
      ${detailField('Topic', s.topic)}
      ${detailField('Time', s.timeUnknown ? 'Time not specified in source workbook' : `${s.start} - ${s.end}`)}${detailField('Room', s.room)}${detailFieldMultiline('Instructor(s)', instructorDisplayText(s)||'TBD')}${s.year?detailField('Year', `Year ${s.year}`):''}
    </div>${assignmentRows?`<div class="session-assignments"><div class="form-label">Faculty assignments</div>${assignmentRows}</div>`:''}</div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="detail-close">Close</button>${canEdit()?'<button type="button" class="btn btn-primary" id="detail-edit">Edit session</button>':''}</div>`);
    $('detail-close').onclick=closeModal;if(canEdit())$('detail-edit').onclick=()=>openSessionForm(s);
    document.querySelectorAll('[data-swap-index]').forEach(button=>button.onclick=()=>openSwapModal(s.id,Number(button.dataset.swapIndex)));
  }

  function detailField(label,value){return `<div><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value||'—')}</span></div>`}
  function detailFieldMultiline(label,value){return `<div><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value" style="white-space:pre-line">${escapeHtml(value||'—')}</span></div>`}

  function splitInstructorNames(v){return String(v||'').split(/[;\n]+/).map(x=>x.trim()).filter(Boolean)}
  function defaultTeachingRole(type){const t=String(type||'').toUpperCase();if(t==='LEC')return'Lecture';if(t==='SRL')return'SRL';if(t==='LAB')return'Lab Support';return type||'Other'}
  function doeRateForRole(role){return ({'Lecture':0.30,'SRL':0.30,'Lab Lead':0.21,'Lab Primary':0.21,'Lab Support':0.19,'Lab Secondary':0.19})[role]??null}
  function blockHours(start,end){const hours=scheduling.durationHours(start,end);return hours===null?0:hours}
  function reconcileAssignments(existing,namesText,type,start,end,topic){const names=splitInstructorNames(namesText),old=Array.isArray(existing)?existing:[];return names.map((name,i)=>{let prev=old.find(x=>String(x.name||'').toLowerCase()===name.toLowerCase())||old[i]||{};const role=prev.role||defaultTeachingRole(type);const h=Number.isFinite(Number(prev.creditedHours))?Number(prev.creditedHours):blockHours(start,end);const rate=doeRateForRole(role);return {...prev,ucid:prev.ucid||null,name,topic:prev.topic||topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'}})}
  function finalizeInstructorAssignments(rows,type,start,end,topic){return (Array.isArray(rows)?rows:[]).filter(a=>String(a?.name||'').trim()).map(a=>{const role=a.role||defaultTeachingRole(type);const h=Number.isFinite(Number(a.creditedHours))?Number(a.creditedHours):blockHours(start,end);const rate=doeRateForRole(role);const out={...a,ucid:a.ucid||null,name:String(a.name||'').trim(),topic:a.topic||topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'};delete out.__editorKey;return out})}
  function instructorDisplayText(s){const a=Array.isArray(s?.assignments)?s.assignments:[];const names=a.map(x=>String(x?.name||'').trim()).filter(Boolean);return (names.length?names:splitInstructorNames(s?.instructor||'')).join('\n')}
  function labDetailsFromAssignments(type,assignments,topic){if(String(type||'').toUpperCase()!=='LAB')return[];return assignments.map(a=>({name:a.name||'',role:a.role||'Lab Support',ucid:a.ucid||null,topic:topic||''}))}

  function blankBulkRow(seed={}){return{date:seed.date||'',year:seed.year||1,course:seed.course||'200',type:seed.type||'LEC',start:seed.start||'08:00',end:seed.end||'09:00',topic:seed.topic||'',room:seed.room||'',faculty:seed.faculty||''}}
  function bulkSelectOptions(values,current){return values.map(value=>`<option value="${escapeHtml(value)}" ${String(value)===String(current)?'selected':''}>${escapeHtml(value)}</option>`).join('')}
  function renderBulkRows(){
    const host=$('bulk-session-body');if(!host)return;
    const courseOptions=[...COURSES.map(c=>String(c.code)),'CCC'];
    host.innerHTML=bulkRows.map((row,index)=>`<tr data-bulk-row="${index}">
      <td><input class="bulk-date" data-bulk-field="date" data-index="${index}" type="date" value="${escapeHtml(row.date)}"></td>
      <td><select data-bulk-field="year" data-index="${index}">${bulkSelectOptions(['1','2','3','4'],row.year)}</select></td>
      <td><select data-bulk-field="course" data-index="${index}">${bulkSelectOptions(courseOptions,row.course)}</select></td>
      <td><select data-bulk-field="type" data-index="${index}">${bulkSelectOptions(['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam','CCC'],row.type)}</select></td>
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
      if(swapNameKey(token)===swapNameKey('Other / Unassigned')){assignments.push({ucid:null,name:'Other / Unassigned'});continue}
      const key=swapNameKey(token),match=facultyDirectory.find(f=>String(f.__id)===token||String(f.ucid||'')===token||String(f.email||'').toLowerCase()===token.toLowerCase()||swapFacultyAliases(f).has(key));
      if(!match){errors.push(`Row ${rowNumber}: faculty "${token}" was not found.`);continue}
      assignments.push({ucid:String(match.__id),name:swapFacultyName(match)});
    }
    return {assignments,errors};
  }
  function validateBulkRows(rows){
    const errors=[],warnings=[],prepared=[];
    if(!rows.length)errors.push('Add at least one row.');
    if(rows.length>MAX_BULK_SESSION_ROWS)errors.push(`A maximum of ${MAX_BULK_SESSION_ROWS} rows can be saved at once.`);
    rows.forEach((row,index)=>{
      const n=index+1,date=String(row.date||''),course=String(row.course||'').trim(),type=String(row.type||'').trim(),topic=String(row.topic||'').trim(),start=String(row.start||''),end=String(row.end||''),year=Number(row.year);
      if(!scheduling.normalizeDate(date))errors.push(`Row ${n}: enter a valid date.`);
      if(![1,2,3,4].includes(year))errors.push(`Row ${n}: year must be 1–4.`);
      if(!course)errors.push(`Row ${n}: course is required.`);if(!type)errors.push(`Row ${n}: type is required.`);if(!topic)errors.push(`Row ${n}: topic is required.`);
      if(scheduling.validateInterval(start,end).status!=='valid')errors.push(`Row ${n}: end time must be after start time.`);
      const resolved=resolveBulkFaculty(row.faculty,n);errors.push(...resolved.errors);
      const assignments=finalizeInstructorAssignments(resolved.assignments,type,start,end,topic);
      for(const assignment of assignments){const faculty=facultyDirectory.find(f=>String(f.__id)===String(assignment.ucid||''));if(!faculty)continue;const availability=facultyAssignmentAvailability(faculty,date,start,end,'');if(availability.available!==true)warnings.push(`Row ${n} · ${assignment.name}: ${assignmentAvailabilityDetail(availability,date,start,end)}`)}
      if(!errors.some(message=>message.startsWith(`Row ${n}:`))){const pos=academicPositionForDate(parseYmd(date));prepared.push({date,week:pos.week,semester:pos.semester,year,course,courseName:course==='CCC'?'Away from Campus':(COURSES.find(c=>String(c.code)===course)?.name||''),type:course==='CCC'?'CCC':type,topic,instructor:assignments.map(a=>a.name).join('; '),room:String(row.room||'').trim(),start,end,assignments,labDetails:labDetailsFromAssignments(type,assignments,topic),sourceSystem:'Bulk live timetable entry'})}
    });
    return {errors,warnings,sessions:prepared};
  }
  async function saveBulkSessions(rows){
    await ensureSessionsForDates(rows.map(row=>row.date));
    const result=validateBulkRows(rows),errorBox=$('bulk-errors');
    if(result.errors.length){errorBox.textContent=result.errors.join('\n');errorBox.classList.remove('hidden');document.querySelectorAll('[data-bulk-row]').forEach((tr,index)=>tr.classList.toggle('bulk-row-error',result.errors.some(message=>message.startsWith(`Row ${index+1}:`))));return false}
    if(result.warnings.length&&!confirm(`Faculty availability warnings:\n\n${result.warnings.slice(0,20).join('\n')}${result.warnings.length>20?`\n…and ${result.warnings.length-20} more`:''}\n\nSave all ${result.sessions.length} sessions anyway?`))return false;
    const batch=db.batch(),created=[];
    for(const session of result.sessions){
      const ref=db.collection(SESSION_COLLECTION).doc(),next={id:ref.id,...session};
      created.push(next);
      batch.set(ref,{...firestoreSafeSession(next),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      const logRef=db.collection(SESSION_LOG_COLLECTION).doc();
      batch.set(logRef,{action:'create',sessionId:next.id,course:next.course,date:next.date,topic:next.topic,instructors:next.assignments.map(a=>({ucid:a.ucid||null,name:a.name,role:a.role,doeCredit:a.doeCredit??null})),changes:[{field:'session',label:'Session',before:null,after:[next.course,next.date,next.start+'-'+next.end,next.topic].filter(Boolean).join(' · ')}],changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});
    }
    await batch.commit();
    invalidateAllSessions();created.forEach(s=>sessionCache.set(s.id,s));await updateDerivedIndexes({sessions:created},{rethrow:true});return true;
  }
  async function openBulkSessionForm(){
    if(!canEdit()){toast('Admin permission is required.',true);return}
    await ensureFacultyDirectory();bulkRows=[blankBulkRow()];
    const facultyOptions=[...facultyDirectory.map(f=>`<option value="${escapeHtml(swapFacultyName(f))}">${escapeHtml(f.email||f.__id)}</option>`),'<option value="Other / Unassigned"></option>'].join('');
    showModal(`<div class="modal-header"><div class="modal-title">Add Multiple Live Sessions</div><div class="modal-subtitle">Edit rows like a spreadsheet or paste tab-separated rows copied from Excel. Every row is validated before one atomic save.</div></div><form id="bulk-session-form"><div class="modal-body">
      <div class="bulk-toolbar"><button type="button" class="btn btn-secondary" id="bulk-add-row">+ Add row</button><button type="button" class="btn btn-secondary" id="bulk-duplicate-row">Duplicate last row</button><button type="button" class="btn btn-secondary" id="bulk-paste-rows">Paste Excel rows</button><span class="bulk-count" id="bulk-row-count"></span></div>
      <div class="bulk-paste-panel hidden" id="bulk-paste-panel"><label class="form-label" for="bulk-paste-text">Paste columns: Date, Year, Course, Type, Start, End, Topic, Room, Faculty</label><textarea id="bulk-paste-text" placeholder="2026-09-14&#9;1&#9;CCC&#9;CCC&#9;07:30&#9;17:00&#9;CCC Day&#9;&#9;Faculty Name"></textarea><div><button type="button" class="btn btn-primary" id="bulk-paste-apply">Add pasted rows</button></div></div>
      <datalist id="bulk-faculty-list">${facultyOptions}</datalist><div class="bulk-sheet-wrap"><table class="bulk-sheet"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>Faculty</th><th></th></tr></thead><tbody id="bulk-session-body"></tbody></table></div><div class="bulk-errors hidden" id="bulk-errors"></div>
    </div><div class="modal-footer"><span class="form-hint">Maximum 200 rows. Faculty may be separated with semicolons.</span><div><button type="button" class="btn btn-secondary" id="bulk-cancel">Cancel</button> <button class="btn btn-primary" type="submit">Save all sessions</button></div></div></form>`);
    document.querySelector('#modal .modal-box')?.classList.add('bulk-wide');renderBulkRows();
    $('bulk-add-row').onclick=()=>{if(bulkRows.length>=MAX_BULK_SESSION_ROWS){toast(`Maximum ${MAX_BULK_SESSION_ROWS} rows.`,true);return}bulkRows.push(blankBulkRow(bulkRows.at(-1)||{}));renderBulkRows()};
    $('bulk-duplicate-row').onclick=()=>{if(bulkRows.length>=MAX_BULK_SESSION_ROWS){toast(`Maximum ${MAX_BULK_SESSION_ROWS} rows.`,true);return}bulkRows.push(blankBulkRow({...bulkRows.at(-1),date:bulkRows.at(-1)?.date}));renderBulkRows()};
    $('bulk-paste-rows').onclick=()=>$('bulk-paste-panel').classList.toggle('hidden');
    $('bulk-paste-apply').onclick=()=>{const parsed=parseBulkPaste($('bulk-paste-text').value);if(!parsed.length){toast('No tab-separated rows found.',true);return}const first=bulkRows.length===1&&Object.values(bulkRows[0]).filter(Boolean).length<=8?[]:bulkRows;bulkRows=[...first,...parsed].slice(0,MAX_BULK_SESSION_ROWS);renderBulkRows();$('bulk-paste-panel').classList.add('hidden')};
    $('bulk-cancel').onclick=closeModal;$('bulk-session-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;button.textContent='Saving...';try{if(!await saveBulkSessions(bulkRows)){button.disabled=false;button.textContent='Save all sessions'}}catch(error){console.error('[bulk session save]',error);$('bulk-errors').textContent='Save failed. No rows were added. Check Firestore permissions and try again.';$('bulk-errors').classList.remove('hidden');button.disabled=false;button.textContent='Save all sessions'}};
  }
  function parseBulkPaste(value){
    return String(value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const cells=line.split('\t');return blankBulkRow({date:cells[0]||'',year:cells[1]||1,course:cells[2]||'200',type:cells[3]||'LEC',start:cells[4]||'08:00',end:cells[5]||'09:00',topic:cells[6]||'',room:cells[7]||'',faculty:cells[8]||''})})
  }

  async function openSessionForm(session=null){
    if(!canEdit()){toast('Admin permission is required.',true);return}
    await ensureFacultyDirectory();const s=session||{date:ymd(weekStart(selectedWeek,selectedSemester)),year:selectedYear==='all'?1:Number(selectedYear),course:COURSES[0].code,type:'LEC',start:'08:00',end:'09:00',topic:'',room:'',assignments:[]},existing=JSON.parse(JSON.stringify(s));
    const courseOptions=COURSES.map(c=>c.code),typeOptions=['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam','CCC'],assignmentRows=(s.assignments&&s.assignments.length?s.assignments:[{name:'',ucid:null,role:defaultTeachingRole(s.type)}]).map((a,i)=>({...a,__editorKey:`a${i}-${Date.now()}`}));
    showModal(`<div class="modal-header"><div class="modal-title">${session?'Edit':'Add'} Live Session</div><div class="modal-subtitle">Changes save directly to Firestore and the audit log.</div></div><form id="session-form"><div class="modal-body"><div class="form-grid">
      ${input('sf-date','Date','date',s.date)}${select('sf-year','Year',['1','2','3','4'],String(s.year||1))}${select('sf-course','Course',courseOptions,String(s.course))}${select('sf-type','Type',typeOptions,String(s.type))}${input('sf-start','Start','time',s.start)}${input('sf-end','End','time',s.end)}${input('sf-topic','Topic','text',s.topic)}${input('sf-room','Room','text',s.room)}
    </div><div class="form-label">Faculty assignments</div><div id="sf-assignment-rows"></div><button type="button" class="btn btn-secondary" id="sf-add-faculty">+ Add faculty</button></div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="sf-cancel">Cancel</button><button class="btn btn-primary" type="submit">${session?'Save changes':'Add session'}</button></div></form>`);
    const host=$('sf-assignment-rows');
    function renderAssignmentRows(){
      const currentType=$('sf-type').value,currentStart=$('sf-start').value,currentEnd=$('sf-end').value,currentTopic=$('sf-topic').value;
      host.innerHTML=assignmentRows.map((a,index)=>`<div class="assignment-editor-row" data-a-key="${escapeHtml(a.__editorKey)}"><select class="form-control" data-a-faculty="${index}"><option value="">Choose faculty</option>${facultyDirectory.map(f=>`<option value="${escapeHtml(f.__id)}" ${String(a.ucid||'')===String(f.__id)?'selected':''}>${escapeHtml(swapFacultyName(f))}</option>`).join('')}<option value="__other" ${!a.ucid&&a.name==='Other / Unassigned'?'selected':''}>Other / Unassigned</option></select><input class="form-control" data-a-name="${index}" value="${escapeHtml(a.name||'')}" placeholder="Name"><select class="form-control" data-a-role="${index}">${['Lecture','SRL','Lab Lead','Lab Primary','Lab Support','Lab Secondary','Other'].map(role=>`<option ${String(a.role||defaultTeachingRole(currentType))===role?'selected':''}>${role}</option>`).join('')}</select><button type="button" class="btn btn-secondary" data-a-remove="${index}">Remove</button></div>`).join('');
      host.querySelectorAll('[data-a-faculty]').forEach(select=>select.onchange=()=>{const i=Number(select.dataset.aFaculty),f=facultyDirectory.find(x=>String(x.__id)===String(select.value));assignmentRows[i].ucid=f?String(f.__id):null;assignmentRows[i].name=f?swapFacultyName(f):(select.value==='__other'?'Other / Unassigned':assignmentRows[i].name);renderAssignmentRows()});
      host.querySelectorAll('[data-a-name]').forEach(input=>input.oninput=()=>assignmentRows[Number(input.dataset.aName)].name=input.value);
      host.querySelectorAll('[data-a-role]').forEach(select=>select.onchange=()=>assignmentRows[Number(select.dataset.aRole)].role=select.value);
      host.querySelectorAll('[data-a-remove]').forEach(button=>button.onclick=()=>{assignmentRows.splice(Number(button.dataset.aRemove),1);renderAssignmentRows()});
    }
    renderAssignmentRows();$('sf-add-faculty').onclick=()=>{assignmentRows.push({name:'',ucid:null,role:defaultTeachingRole($('sf-type').value),__editorKey:`a${Date.now()}`});renderAssignmentRows()};$('sf-type').onchange=renderAssignmentRows;$('sf-cancel').onclick=closeModal;
    $('session-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter,course=$('sf-course').value,type=$('sf-type').value,start=$('sf-start').value,end=$('sf-end').value,topic=$('sf-topic').value.trim(),date=$('sf-date').value,year=Number($('sf-year').value),room=$('sf-room').value.trim();if(!date||!course||!type||!topic||!start||!end||timeToMinutes(end)<=timeToMinutes(start)){toast('Enter a valid date, course, type, topic and time range.',true);return}const assignments=finalizeInstructorAssignments(assignmentRows,type,start,end,topic).filter(a=>a.name),pos=academicPositionForDate(parseYmd(date)),next={...existing,date,week:pos.week,semester:pos.semester,year,course,courseName:course==='CCC'?'Away from Campus':(COURSES.find(c=>String(c.code)===course)?.name||''),type:course==='CCC'?'CCC':type,topic,instructor:assignments.map(a=>a.name).join('; '),room,start,end,timeUnknown:false,assignments,facultyIds:[...new Set(assignments.map(a=>a.ucid).filter(Boolean).map(String))],labDetails:labDetailsFromAssignments(type,assignments,topic),sourceSystem:'Live timetable edit'};const warnings=[];for(const a of assignments){const f=facultyDirectory.find(x=>String(x.__id)===String(a.ucid||''));if(!f)continue;const av=facultyAssignmentAvailability(f,date,start,end,s?.id||'');if(av.available!==true)warnings.push(`${a.name}: ${assignmentAvailabilityDetail(av,date,start,end)}`)}if(warnings.length&&!confirm(`Faculty availability warnings:\n\n${warnings.join('\n')}\n\nSave anyway?`))return;button.disabled=true;button.textContent='Saving...';try{await saveSession(next,session?existing:null);closeModal();toast(session?'Session updated.':'Session added.')}catch(error){console.error('[session save]',error);toast(error.message||'Could not save the session.',true);button.disabled=false;button.textContent=session?'Save changes':'Add session'}};
  }

  function input(id,label,type,value){return `<label class="form-field"><span>${escapeHtml(label)}</span><input class="form-control" id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value??'')}"></label>`}
  function select(id,label,values,current){return `<label class="form-field"><span>${escapeHtml(label)}</span><select class="form-control" id="${escapeHtml(id)}">${values.map(v=>`<option value="${escapeHtml(v)}" ${String(v)===String(current)?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select></label>`}
  function sessionChangeList(before,after){
    const fields=[['date','Date'],['course','Course'],['type','Type'],['start','Start'],['end','End'],['topic','Topic'],['room','Room'],['assignments','Faculty']];return fields.flatMap(([field,label])=>JSON.stringify(before?.[field]??null)===JSON.stringify(after?.[field]??null)?[]:[{field,label,before:before?.[field]??null,after:after?.[field]??null}]);
  }
  async function saveSession(next,before){
    const isNew=!before?.id,id=before?.id||db.collection(SESSION_COLLECTION).doc().id,ref=db.doc(`${SESSION_COLLECTION}/${id}`),record={...next,id};
    const batch=db.batch();batch.set(ref,{...firestoreSafeSession(record),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});const log=db.collection(SESSION_LOG_COLLECTION).doc();batch.set(log,{action:isNew?'create':'update',sessionId:id,course:record.course,date:record.date,topic:record.topic,changes:isNew?[{field:'session',label:'Session',before:null,after:[record.course,record.date,record.start+'-'+record.end,record.topic].join(' · ')}]:sessionChangeList(before,record),changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});await batch.commit();sessions=isNew?[...sessions,record]:sessions.map(s=>String(s.id)===String(id)?record:s);sessionCache.set(id,record);invalidateAllSessions();await updateDerivedIndexes({sessions:[record]},{rethrow:true});render();
  }

  async function deleteSession(session){
    if(!canEdit()||!session?.id)return;if(!confirm(`Delete ${session.course} · ${session.date} · ${session.topic}?`))return;const batch=db.batch(),ref=db.doc(`${SESSION_COLLECTION}/${session.id}`),log=db.collection(SESSION_LOG_COLLECTION).doc();batch.delete(ref);batch.set(log,{action:'delete',sessionId:session.id,course:session.course,date:session.date,topic:session.topic,changes:[{field:'session',label:'Session',before:[session.course,session.date,session.topic].join(' · '),after:null}],changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});await batch.commit();sessions=sessions.filter(s=>String(s.id)!==String(session.id));sessionCache.delete(String(session.id));invalidateAllSessions();await updateDerivedIndexes({deleteSessionIds:[session.id]},{rethrow:true});render();toast('Session deleted.')
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

  function populateCourseFilter(){
    const values=[...new Set(sessions.map(s=>String(s.course||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),host=$('filter-course-options');
    host.innerHTML=values.map(course=>`<label><input type="checkbox" value="${escapeHtml(course)}" ${selectedCourses.has(course)?'checked':''}> ${escapeHtml(course)}</label>`).join('')||'<span>No courses loaded.</span>';host.querySelectorAll('input').forEach(input=>input.onchange=()=>{if(input.checked)selectedCourses.add(input.value);else selectedCourses.delete(input.value);courseFilterActive=selectedCourses.size>0;updateCourseSummary();render()});updateCourseSummary();
  }
  function updateCourseSummary(){$('course-filter-summary').textContent=courseFilterActive?[...selectedCourses].sort().join(', '):'All Courses'}

  async function loadCccEvents(){
    if(cccLoaded)return cccEvents;if(cccLoading)return cccLoading;
    cccLoading=db.collection('afc_requests').where('status','==','approved').get().then(snapshot=>{cccEvents=snapshot.docs.flatMap(doc=>{const row=doc.data(),start=parseYmd(row.startDate),end=parseYmd(row.endDate),out=[];for(let d=new Date(start);d<=end;d=addDays(d,1)){if(d.getDay()===0||d.getDay()===6)continue;const date=ymd(d),pos=academicPositionForDate(d);out.push({id:`ccc-${doc.id}-${date}`,date,week:pos.week,semester:pos.semester,year:'',course:'CCC',courseName:'Away from Campus',type:'CCC',topic:'CCC Day',instructor:row.facultyName||row.requesterName||'Faculty',assignments:[{ucid:row.facultyId||'',name:row.facultyName||row.requesterName||'Faculty'}],room:'',start:'07:30',end:'17:00',timeUnknown:false,isCcc:true,sourceSystem:'AFC CCC record'})}return out});cccLoaded=true;return cccEvents}).finally(()=>{cccLoading=null});return cccLoading;
  }
  function sessionsWithCcc(source,start,end){return showCcc?[...source,...cccEvents.filter(row=>row.date>=start&&row.date<=end)]:source}

  function exportFilteredRows(all,options){
    let data=[...all];if(showCcc)data=[...data,...cccEvents];
    const q=$('search-input').value.trim().toLowerCase(),type=$('filter-type').value;
    data=data.filter(s=>{if(!showCcc&&String(s.type||'').toUpperCase()==='CCC')return false;if(selectedYear!=='all'&&String(s.year)!==String(selectedYear))return false;if(courseFilterActive&&!selectedCourses.has(String(s.course)))return false;if(type!=='all'&&s.type!==type)return false;if(q&&!`${s.course} ${s.topic} ${s.instructor} ${s.room} ${s.type}`.toLowerCase().includes(q))return false;return true});
    if(options.scope==='date')data=data.filter(s=>s.date>=options.start&&s.date<=options.end);if(options.scope==='academic')data=data.filter(s=>s.semester===options.semester&&(options.week==='all'||String(s.week)===String(options.week))&&(options.year==='all'||String(s.year)===String(options.year)));return data.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start).localeCompare(String(b.start)));
  }

  function downloadFile(content,type,filename){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500)}
  async function openExportDialog(kind){
    try{
      const all=await ensureAllSessions();if(showCcc)await loadCccEvents();const today=ymd(new Date());showModal(`<div class="modal-header"><div class="modal-title">Export ${kind==='csv'?'CSV':'Calendar'}</div><div class="modal-subtitle">Choose the date scope. Current Year/Course/Type/Search filters stay active.</div></div><form id="export-form"><div class="modal-body"><div class="login-cheatsheet"><label><input type="radio" name="scope" value="date" checked> Date range</label> &nbsp; <label><input type="radio" name="scope" value="academic"> Academic period</label> &nbsp; <label><input type="radio" name="scope" value="all"> All filtered dates</label></div><div class="form-grid" id="export-date-fields">${input('export-start','Start date','date',today)}${input('export-end','End date','date','2027-08-31')}</div><div class="form-grid hidden" id="export-academic-fields">${select('export-semester','Semester',['fall','winter','spring'],selectedSemester)}${select('export-week','Week',['all',...Array.from({length:WEEK_COUNT},(_,i)=>String(i+1))],'all')}${select('export-year','Year',['all','1','2','3','4'],selectedYear)}</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="export-cancel">Cancel</button><button class="btn btn-primary" type="submit">Download</button></div></form>`);$('export-cancel').onclick=closeModal;document.querySelectorAll('[name="scope"]').forEach(radio=>radio.onchange=()=>{$('export-date-fields').classList.toggle('hidden',radio.value!=='date'||!radio.checked);$('export-academic-fields').classList.toggle('hidden',radio.value!=='academic'||!radio.checked)});$('export-form').onsubmit=event=>{event.preventDefault();const form=new FormData(event.currentTarget),options={scope:form.get('scope'),start:$('export-start').value,end:$('export-end').value,semester:$('export-semester').value,week:$('export-week').value,year:$('export-year').value},data=exportFilteredRows(all,options);if(kind==='csv')exportCsv(data);else exportCalendar(data);closeModal();toast(`${data.length} sessions exported.`)}}catch(error){console.error('[export]',error);toast('Could not load the complete schedule for export.',true)}
  }
  function exportCsv(data){
    const header=['ID','Source','Date','Week','Semester','Year','Course','Course Name','Type','Topic','Instructor','Assignments JSON','Room','Start','End','Time Unknown','CCC'];
    const rows=[header,...data.map(s=>[s.id,s.sourceSystem||'',s.date,s.week,s.semester,s.year,s.course,s.courseName||'',s.type,s.topic,s.instructor,JSON.stringify(s.assignments||[]),s.room,s.start,s.end,!!s.timeUnknown,!!s.isCcc])];
    const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    downloadFile(csv,'text/csv;charset=utf-8','ucvm-filtered-timetable.csv');
  }
  function icsEscape(value){return String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
  function icsDate(date){return String(date).replace(/-/g,'')}
  function exportCalendar(data){
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const events=data.map(s=>{
      const summary=icsEscape(`${s.course} ${s.type}${s.topic?` - ${s.topic}`:''}`),description=icsEscape(`Faculty: ${s.instructor||'TBD'}${s.room?`\nRoom: ${s.room}`:''}`);
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
    return [...emails].map(([email,name])=>({email,name}));
  }
  function exportOutlookInvites(data,organizer){
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const organizerEmail=String(organizer?.email||'').trim(),organizerName=String(organizer?.name||organizerEmail||'UCVM Scheduling');
    const events=data.map(session=>{
      const summary=icsEscape(`${session.course} ${session.type}${session.topic?` - ${session.topic}`:''}`),description=icsEscape(`Faculty: ${session.instructor||'TBD'}${session.room?`\nRoom: ${session.room}`:''}`),attendees=outlookAttendeesForSession(session).map(a=>`ATTENDEE;CN=${icsEscape(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${icsEscape(a.email)}`);
      const times=session.isCcc||session.timeUnknown||!session.start||!session.end?[`DTSTART;VALUE=DATE:${icsDate(session.date)}`,`DTEND;VALUE=DATE:${icsDate(ymd(addDays(parseYmd(session.date),1)))}`]:[`DTSTART;TZID=America/Edmonton:${icsDate(session.date)}T${session.start.replace(':','')}00`,`DTEND;TZID=America/Edmonton:${icsDate(session.date)}T${session.end.replace(':','')}00`];
      return ['BEGIN:VEVENT',`UID:${icsEscape(session.id)}@ucvm-outlook`,`DTSTAMP:${stamp}Z`,...times,`SUMMARY:${summary}`,`DESCRIPTION:${description}`,session.room?`LOCATION:${icsEscape(session.room)}`:'',organizerEmail?`ORGANIZER;CN=${icsEscape(organizerName)}:mailto:${icsEscape(organizerEmail)}`:'',...attendees,'STATUS:CONFIRMED','SEQUENCE:0','END:VEVENT'].filter(Boolean).join('\r\n');
    }).join('\r\n');
    downloadFile(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//UCVM//Outlook Teaching Invitations//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:REQUEST\r\n${events}\r\nEND:VCALENDAR\r\n`,'text/calendar;charset=utf-8','ucvm-outlook-invite-package.ics');
  }
  async function openOutlookInviteDialog(){
    if(!UCVM.admin(currentUser)){toast('ADFA permission is required.',true);return}
    try{
      const [all]=await Promise.all([ensureAllSessions(),ensureFacultyDirectory()]);if(showCcc)await loadCccEvents();
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

  function initializeLiveSchedule(){toast('The live timetable is already initialized. Use Faculty Dashboard synchronization to replace it.',true)}

  // ------------------ AUTH ------------------
  async function initFirebase(){
    if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);auth=firebase.auth();db=firebase.firestore();try{await db.enablePersistence({synchronizeTabs:true})}catch(_){}
    authInitialized=true;auth.onAuthStateChanged(async user=>{
      if(!user){currentUser=null;sessionCache.clear();sessionCacheRanges.length=0;sessionCacheDates.clear();profileSnapshots.clear();unsubscribeFacultyDirectory();if(sessionUnsubscribe){sessionUnsubscribe();sessionUnsubscribe=null}setAppLocked(true,'Sign in to continue.');$('account-toggle').textContent='Sign in';refreshAdminTools();render();return}
      try{
        profileSnapshots.clear();const profile=await getRoleProfile(user);if(!await UCVM.ready(user,profile))return;currentUser={uid:user.uid,email:user.email,name:profile.name||user.displayName||user.email,role:UCVM.role(profile.role),profile};UCVM.watch(user,profile);$('account-toggle').textContent=currentUser.name;setAppLocked(false);await ensureCurrentFaculty();refreshAdminTools();if(roleIsFaculty(currentUser)){myTimetableOnly=true;$('my-timetable-btn').classList.remove('hidden');$('my-teaching-btn').classList.remove('hidden');$('afc-request-btn').classList.remove('hidden');$('my-change-history-btn').classList.remove('hidden')}else{$('my-timetable-btn').classList.add('hidden');$('my-teaching-btn').classList.add('hidden');$('afc-request-btn').classList.add('hidden');$('my-change-history-btn').classList.add('hidden')}setInitialAcademicPeriod();renderWeekControls();syncWeekUI();subscribeSessions();
      }catch(error){console.error('[auth profile]',error);setAppLocked(true,error.message||'Account is not authorized.');currentUser=null;refreshAdminTools()}
    });
  }

  function clearRecaptcha(){if(recaptchaVerifier){try{recaptchaVerifier.clear()}catch(_){}recaptchaVerifier=null}phoneConfirmation=null}
  function openLoginModal(){
    showModal(`<div class="modal-header"><div class="modal-title">Sign in</div><div class="modal-subtitle">Use your authorized UCalgary email and password.</div></div><form id="login-form"><div class="modal-body"><label class="form-field"><span>Email</span><input class="form-control" id="login-email" type="email" autocomplete="username" required></label><label class="form-field"><span>Password</span><input class="form-control" id="login-password" type="password" autocomplete="current-password" required></label><p class="form-hint" id="login-error"></p></div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="login-cancel">Cancel</button><button class="btn btn-primary" type="submit">Sign in</button></div></form>`);$('login-cancel').onclick=closeModal;$('login-form').onsubmit=async event=>{event.preventDefault();const email=$('login-email').value.trim(),password=$('login-password').value,button=event.submitter;button.disabled=true;try{await auth.signInWithEmailAndPassword(email,password);closeModal()}catch(error){$('login-error').textContent=error.message;button.disabled=false}}
  }
  function openAccountModal(){showModal(`<div class="modal-header"><div class="modal-title">${escapeHtml(currentUser?.name||'Account')}</div><div class="modal-subtitle">${escapeHtml(currentUser?.email||'')} · ${escapeHtml(UCVM.label(currentUser?.role||''))}</div></div><div class="modal-body"><p>Use Change password if you need to update your login credential.</p></div><div class="modal-footer"><button class="btn btn-secondary" id="account-close">Close</button><button class="btn btn-secondary" id="account-password">Change password</button><button class="btn btn-primary" id="account-signout">Sign out</button></div>`);$('account-close').onclick=closeModal;$('account-password').onclick=()=>location.href='password.html';$('account-signout').onclick=async()=>{await auth.signOut();closeModal()}}
  function openAuthSetupModal(){toast('Authentication setup is managed in Firebase and User Management.',true)}
  function openUserManager(){if(!UCVM.general(currentUser)){toast('Owner permission is required.',true);return}location.href='user-management.html'}

  function init(){
    setInitialAcademicPeriod();renderWeekControls();syncWeekUI();initializeScheduleFilters();setViewButtons();
    $('week-btn-row-1').addEventListener('click',e=>{const button=e.target.closest('[data-week]');if(button){selectedWeek=Number(button.dataset.week);syncWeekUI();refreshSessionScope()}});$('week-btn-row-2').addEventListener('click',e=>{const button=e.target.closest('[data-week]');if(button){selectedWeek=Number(button.dataset.week);syncWeekUI();refreshSessionScope()}});
    $('semester-btn-row').addEventListener('click', e => {
      const b = e.target.closest('[data-semester]'); if (!b) return;
      selectedSemester = b.dataset.semester;
      document.querySelectorAll('[data-semester]').forEach(x => x.classList.toggle('active', x === b));
      $('filter-month').value = 'all';
      renderWeekControls();
      refreshSessionScope();
    });
    $('week-mobile-select').addEventListener('change', e => { selectedWeek = Number(e.target.value); syncWeekUI(); refreshSessionScope(); });
    ['search-input','filter-type'].forEach(id => $(id).addEventListener(id === 'search-input' ? 'input' : 'change', render));
    $('filter-month').addEventListener('change', e => {
      if (e.target.value !== 'all') {
        { const m=Number(e.target.value); selectedSemester = m>=7 ? 'fall' : (m<=3 ? 'winter' : 'spring'); }
        document.querySelectorAll('[data-semester]').forEach(x => x.classList.toggle('active', x.dataset.semester === selectedSemester));
        renderWeekControls();
      }
      refreshSessionScope();
    });
    $('reset-filters').addEventListener('click', resetFilters);
    $('cal-prev').addEventListener('click', () => moveCalendar(-1));
    $('cal-next').addEventListener('click', () => moveCalendar(1));
    $('cal-today').addEventListener('click', () => { setInitialAcademicPeriod(); $('filter-month').value='all'; renderWeekControls(); syncWeekUI(); refreshSessionScope(); toast('Moved to the current academic week.'); });
    $('cal-day-btn').addEventListener('click', () => switchCalendarView('day'));
    $('cal-week-btn').addEventListener('click', () => switchCalendarView('week'));
    $('cal-month-btn').addEventListener('click', () => switchCalendarView('month'));
    $('cal-list-btn').addEventListener('click', () => switchCalendarView('list'));
    $('show-ccc').addEventListener('change', async e=>{showCcc=e.target.checked;if(showCcc){try{await loadCccEvents()}catch{e.target.checked=false;showCcc=false}}populateCourseFilter();render()});
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
    $('faculty-dashboard-btn').addEventListener('click', () => { if (UCVM.admin(currentUser)) window.location.href = 'faculty-admin.html'; });
    $('my-timetable-btn').addEventListener('click', () => { myTimetableOnly = !myTimetableOnly; $('my-timetable-btn').textContent = myTimetableOnly ? 'Show All Timetable' : 'My Timetable'; render(); });
    $('course-list-btn').addEventListener('click', openCourseList);
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
  }

  function resetFilters() {
    selectedYear = 'all'; selectedSemester = 'fall';
    document.querySelectorAll('[data-year]').forEach(x => x.classList.toggle('active', x.dataset.year === 'all'));
    document.querySelectorAll('[data-semester]').forEach(x => x.classList.toggle('active', x.dataset.semester === 'fall'));
    $('search-input').value = ''; $('filter-month').value = 'all'; $('filter-type').value = 'all';
    selectedCourses.clear(); courseFilterActive=false; showCcc=false; $('show-ccc').checked=false; populateCourseFilter();
    myTimetableOnly = roleIsFaculty(currentUser); if (currentUser) $('my-timetable-btn').textContent = myTimetableOnly ? 'Show All Timetable' : 'My Timetable';
    selectedWeek = 1; renderWeekControls();
    refreshSessionScope();
  }

  function setViewButtons() {
    $('cal-day-btn').classList.toggle('active', viewMode === 'day');
    $('cal-week-btn').classList.toggle('active', viewMode === 'week');
    $('cal-month-btn').classList.toggle('active', viewMode === 'month');
    $('cal-list-btn').classList.toggle('active', viewMode === 'list');
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
    const q = $('search-input').value.trim().toLowerCase();
    const month = $('filter-month').value;
    const type = $('filter-type').value;
    return source.filter(s => {
      if(String(s.type||'').toUpperCase()==='CCC'&&!showCcc)return false;
      if (!options.ignorePeriod && selectedYear !== 'all' && String(s.year) !== selectedYear) return false;
      if (!options.ignorePeriod && s.semester !== selectedSemester) return false;
      if (!options.ignorePeriod && month !== 'all' && String(parseYmd(s.date).getMonth()) !== month) return false;
      if (courseFilterActive && !selectedCourses.has(String(s.course))) return false;
      if (type !== 'all' && s.type !== type) return false;
      if (myTimetableOnly && currentUser && !sessionBelongsToCurrentFaculty(s)) return false;
      if (q && !`${s.course} ${s.topic} ${s.instructor} ${s.room} ${s.type}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function render() {
    if(viewMode==='day')renderDay();
    else if(viewMode==='week')renderWeek();
    else if(viewMode==='month')renderMonth();
    else renderList();
  }

  function layoutDaySessions(items) {
    const sorted = items.map(s => ({ session:s, startM:timeToMinutes(s.start), endM:timeToMinutes(s.end), lane:0, laneCount:1 }))
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

  function renderDay() {
    const date=addDays(weekStart(selectedWeek,selectedSemester),selectedDayIndex), dateText=ymd(date);
    $('cal-label').textContent=formatLongDate(date);
    const data=filteredSessions(sessionsWithCcc(sessions,dateText,dateText)).filter(s=>s.date===dateText);
    renderedSessions=data;
    const DAY_START=450,DAY_END=1020,SPAN=DAY_END-DAY_START,marks=[450,480,540,600,660,720,780,840,900,960,1020];
    let html=`<div class="tg-wrap day-single"><div class="tg-corner"></div><div class="tg-day-head"><div class="week-dow">${DAYS[selectedDayIndex]}</div><div class="week-date">${date.getDate()}</div></div></div><div class="tg-body day-single"><div class="tg-time-axis"><div class="tg-track">`;
    marks.forEach(m=>{const top=((m-DAY_START)/SPAN)*100,h=Math.floor(m/60),min=m%60,h12=((h+11)%12)+1;html+=`<span class="tg-hour-label" style="top:${top}%">${h12}:${String(min).padStart(2,'0')}</span>`});
    html+='</div></div><div class="tg-day-col">';
    marks.forEach(m=>{html+=`<div class="tg-gridline" style="top:${((m-DAY_START)/SPAN)*100}%"></div>`});
    layoutDaySessions(data).forEach(item=>{
      const s=item.session,startM=Math.max(DAY_START,item.startM),endM=Math.min(DAY_END,item.endM);if(endM<=DAY_START||startM>=DAY_END)return;
      const top=((startM-DAY_START)/SPAN)*100,height=Math.max(3.5,((endM-startM)/SPAN)*100),laneWidth=100/item.laneCount,left=item.lane*laneWidth;
      html+=`<div class="tg-block ${colorsOn?sessionTypeClass(s.type):'colors-off'}" data-session-id="${escapeHtml(s.id)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);right:auto;width:calc(${laneWidth}% - 4px)"><div class="tg-block-l1">${escapeHtml(s.course)} - ${escapeHtml(s.type)}</div><div class="tg-block-l2">${escapeHtml(s.topic)}</div><div class="tg-block-l3">${escapeHtml(s.start)}-${escapeHtml(s.end)}${s.room?` | ${escapeHtml(s.room)}`:''}<br>${escapeHtml(s.instructor||'TBD')}</div></div>`;
    });
    html+='</div></div>';$('calendar-body').innerHTML=html;bindSessionBlocks();
  }

  function renderWeek() {
    const start = weekStart(selectedWeek, selectedSemester); const end = addDays(start, 4);
    $('cal-label').textContent = `${selectedSemester === 'winter' ? 'Winter' : (selectedSemester === 'spring' ? 'Spring' : 'Fall')} Week ${selectedWeek} - ${formatDate(start)} to ${formatDate(end)}, ${end.getFullYear()}`;
    const data = filteredSessions(sessionsWithCcc(sessions,ymd(start),ymd(end))).filter(s => s.week === selectedWeek);
    renderedSessions=data;
    const DAY_START=450, DAY_END=1020, SPAN=DAY_END-DAY_START; // 7:30am-5:00pm
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
      const dayItems=layoutDaySessions(data.filter(s => s.date === date));
      dayItems.forEach(item => {
        const s=item.session;
        const startM = Math.max(DAY_START, item.startM), endM = Math.min(DAY_END, item.endM);
        if (endM <= DAY_START || startM >= DAY_END) return;
        const top = ((startM - DAY_START) / SPAN) * 100;
        const height = Math.max(3.5, ((endM - startM) / SPAN) * 100);
        const laneWidth=100/item.laneCount, left=item.lane*laneWidth;
        html += `<div class="tg-block ${colorsOn ? sessionTypeClass(s.type) : 'colors-off'} " data-session-id="${escapeHtml(s.id)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);right:auto;width:calc(${laneWidth}% - 4px)">
          <div class="tg-block-l1">${escapeHtml(s.course)} - ${escapeHtml(s.type)}</div>
          <div class="tg-block-l2">${escapeHtml(s.topic)}</div>
          <div class="tg-block-l3">${escapeHtml(s.start)}-${escapeHtml(s.end)}${s.room ? ` | ${escapeHtml(s.room)}` : ''}<br>${escapeHtml(s.instructor || 'TBD')}</div>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    $('calendar-body').innerHTML = html;
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
    const data = filteredSessions(sessionsWithCcc(sessions,ymd(first),ymd(last)));
    renderedSessions=data;
    let html = '<div class="cal-month"><div class="cal-dow-header">' + DAYS.map(d => `<div class="cal-dow">${d}</div>`).join('') + '</div><div class="cal-grid">';
    let cursor = new Date(monday);
    while (cursor <= last || cursor.getDay() !== 1) {
      for (let i = 0; i < 5; i++) {
        const cell = addDays(cursor, i); const dateStr = ymd(cell);
        const events = data.filter(s => s.date === dateStr).slice(0, 4);
        html += `<div class="cal-cell"><div class="cal-date-num">${cell.getDate()}</div><div class="cal-events">`;
        events.forEach(s => html += `<div class="cal-event ${colorsOn ? sessionTypeClass(s.type) : 'colors-off'} " data-session-id="${escapeHtml(s.id)}"><div class="cal-event-l1">${escapeHtml(s.course)} ${escapeHtml(s.type)}</div><div class="cal-event-l2">${s.timeUnknown?'Time not specified':escapeHtml(s.start)} ${escapeHtml(s.topic)}</div></div>`);
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
    const start=ymd(new Date()),end='9999-12-31';
    $('cal-label').textContent=`${formatLongDate(parseYmd(start))} onward`;
    const data=filteredSessions(sessionsWithCcc(sessions,start,end),{ignorePeriod:true}).filter(s=>s.date>=start).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start||'').localeCompare(String(b.start||''))||String(a.course||'').localeCompare(String(b.course||'')));
    renderedSessions=data;
    const rows=data.map(s=>`<tr data-session-id="${escapeHtml(s.id)}"><td>${escapeHtml(s.date)}</td><td>${escapeHtml(s.timeUnknown?'Time TBD':`${s.start||''}-${s.end||''}`)}</td><td><strong>${escapeHtml(s.course)}</strong></td><td>${escapeHtml(s.type)}</td><td>${escapeHtml(s.topic)}</td><td>${escapeHtml(s.instructor||'TBD')}</td><td>${escapeHtml(s.room||'')}</td></tr>`).join('');
    $('calendar-body').innerHTML=`<div class="schedule-list-wrap"><table class="schedule-list"><thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Type</th><th>Topic</th><th>Faculty</th><th>Room</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty-cell">No future sessions match the selected filters.</td></tr>'}</tbody></table></div>`;
    bindSessionBlocks();
  }

  function bindSessionBlocks() {
    document.querySelectorAll('[data-session-id]').forEach(el => {
      const s=renderedSessions.find(row=>String(row.id)===String(el.dataset.sessionId));
      el.classList.toggle('selection-candidate',selectionMode&&!s?.isCcc);
      el.classList.toggle('selection-selected',sessionSelection.has(el.dataset.sessionId));
      el.addEventListener('click',()=>{
        if(!selectionMode){openSessionDetail(el.dataset.sessionId);return}
        if(s?.isCcc){toast('CCC records are read-only and cannot be selected.',true);return}
        try{
          const selected=sessionSelection.toggle(el.dataset.sessionId);
          if(selected&&s)selectedSessionOriginals.set(String(s.id),JSON.parse(JSON.stringify(s)));
          if(!selected)selectedSessionOriginals.delete(String(el.dataset.sessionId));
          updateSelectionControls();render();
        }catch(error){toast(error.message,true)}
      });
    });
  }

  function switchCalendarView(next){
    viewMode=next;
    if(selectionMode&&reviewingSelection)reviewingSelection=false;
    if(roleIsFaculty(currentUser)&&(next==='day'||next==='list'))lastFacultyTeachingView=next;
    setViewButtons();refreshSessionScope();
  }

  async function startSessionSelection(){
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
    return facultyDirectory.map(f=>{const state=doeState.get(String(f.__id))||{},current=state.current===null||state.current===undefined?'Unavailable':swapPct(state.current),target=state.target||window.UCVM_FACULTY_DOE.effectiveTarget(f),targetLabel=window.UCVM_FACULTY_DOE.targetLabel(f);return `<label class="selection-faculty-option"><input type="checkbox" data-selection-faculty-option value="${escapeHtml(f.__id)}" ${selected.has(String(f.__id))?'checked':''}><span><strong>${escapeHtml(swapFacultyName(f))}</strong><small>Assigned DOE ${current} · ${escapeHtml(targetLabel)}${target.source==='override'?'<span class="doe-override-pill">Override</span>':''}</small></span></label>`}).join('');
  }
  function updateSelectionFacultyPicker(picker){
    const checked=[...picker.querySelectorAll('[data-selection-faculty-option]:checked')],summary=picker.querySelector('summary'),chips=picker.querySelector('.selection-faculty-chips');
    summary.textContent=checked.length?`${checked.length} faculty selected`:'Choose faculty';
    chips.innerHTML=checked.map(input=>{const f=facultyDirectory.find(row=>String(row.__id)===String(input.value)),state=selectionDoeState.get(String(input.value))||{},current=state.current===null||state.current===undefined?'DOE unavailable':`Assigned ${swapPct(state.current)}`;return `<span>${escapeHtml(swapFacultyName(f))}<small>${current}</small></span>`}).join('');
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
    $('calendar-body').innerHTML=`<div class="selection-errors hidden" id="selection-errors" role="alert"></div><div class="selection-review-wrap"><table class="selection-review"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>Faculty</th></tr></thead><tbody>${rows}</tbody></table></div><div class="selection-review-actions"><button class="btn btn-secondary" id="selection-back-btn">Back to selection</button><button class="btn btn-primary" id="selection-save-btn">Save ${data.length} selected session${data.length===1?'':'s'}</button></div>`;
    document.querySelectorAll('.selection-faculty-picker').forEach(updateSelectionFacultyPicker);document.querySelectorAll('[data-selection-faculty-option]').forEach(input=>input.onchange=()=>updateSelectionFacultyPicker(input.closest('.selection-faculty-picker')));
    $('selection-back-btn').onclick=()=>{reviewingSelection=false;viewMode=selectionViewFlow.finish();setViewButtons();refreshSessionScope()};
    $('selection-save-btn').onclick=saveSelectionReview;
  }

  function selectionRowFromDom(tr,original){
    const value=field=>tr.querySelector(`[data-selection-field="${field}"]`)?.value||'',course=value('course').trim(),type=value('type').trim(),start=value('start'),end=value('end'),topic=value('topic').trim(),date=value('date'),position=parseYmd(date).getTime()?academicPositionForDate(parseYmd(date)):{week:original.week,semester:original.semester};
    const chosen=[...tr.querySelectorAll('[data-selection-faculty-option]:checked')].map(input=>facultyDirectory.find(f=>String(f.__id)===String(input.value))).filter(Boolean),assignments=chosen.map(f=>({ucid:String(f.__id),name:swapFacultyName(f),role:defaultTeachingRole(type)})),ids=assignments.map(a=>a.ucid),assignmentChanged=JSON.stringify(ids.sort())!==JSON.stringify([...(original.facultyIds||[])].map(String).sort());
    return{...original,id:tr.dataset.sessionEditId,date,week:position.week,semester:position.semester,year:Number(value('year')),course,courseName:course===String(original.course||'')?original.courseName:(COURSES.find(c=>String(c.code)===course)?.name||''),type,start,end,topic,room:value('room'),timeUnknown:start===String(original.start||'')&&end===String(original.end||'')?Boolean(original.timeUnknown):false,assignments,facultyIds:ids,labDetails:assignmentChanged?labDetailsFromAssignments(type,assignments,topic):original.labDetails};
  }
  async function saveSelectionReview(){
    const originals=window.UCVM_TIMETABLE_SELECTION.selectedRows([...selectedSessionOriginals.values()],sessionSelection.ids()),originalById=new Map(originals.map(s=>[String(s.id),s])),rows=[...document.querySelectorAll('[data-selection-row]')].map(tr=>selectionRowFromDom(tr,originalById.get(String(tr.dataset.sessionEditId))));
    const facultyById=new Map(facultyDirectory.map(f=>[String(f.__id),f])),plan=window.UCVM_TIMETABLE_SELECTION.planChanges(originals,rows,{uid:currentUser.uid,email:currentUser.email,name:currentUser.name},firebase.firestore.FieldValue.serverTimestamp(),facultyById),errorBox=$('selection-errors');
    const warnings=[];for(const row of rows){for(const assignment of row.assignments||[]){const faculty=facultyById.get(String(assignment.ucid||''));if(!faculty)continue;const av=facultyAssignmentAvailability(faculty,row.date,row.start,row.end,row.id);if(av.available!==true)warnings.push(`${row.course} · ${assignment.name}: ${assignmentAvailabilityDetail(av,row.date,row.start,row.end)}`)}}
    if(plan.errors.length){errorBox.textContent=plan.errors.join('\n');errorBox.classList.remove('hidden');return}
    if(!plan.updates.length){toast('No changes to save.');return}
    if(warnings.length&&!confirm(`Faculty availability warnings:\n\n${warnings.slice(0,20).join('\n')}${warnings.length>20?`\n…and ${warnings.length-20} more`:''}\n\nSave the selected session changes anyway?`))return;
    const button=$('selection-save-btn');button.disabled=true;button.textContent='Saving...';
    try{
      const store={batch:()=>db.batch(),sessionRef:id=>db.doc(`${SESSION_COLLECTION}/${id}`),logRef:()=>db.collection(SESSION_LOG_COLLECTION).doc(),afterCommit:async()=>{const updates=plan.updates.map(update=>({id:update.id,...update.data}));updates.forEach(update=>{sessions=sessions.map(s=>String(s.id)===String(update.id)?{...s,...update}:s);const existing=sessionCache.get(String(update.id));if(existing)sessionCache.set(String(update.id),{...existing,...update})});invalidateAllSessions();await updateDerivedIndexes({sessions:updates},{rethrow:true})}};
      const result=await window.UCVM_TIMETABLE_SELECTION.commitPlan(plan,store);if(!result.committed){toast(result.errors?.join(' ')||'Nothing was saved.',true);return}cancelSessionSelection();toast(`${plan.updates.length} session${plan.updates.length===1?'':'s'} updated.`)
    }catch(error){console.error('[selection save]',error);toast(error.message||'Could not save selected sessions.',true);button.disabled=false;button.textContent='Save selected sessions'}
  }

  function sessionBelongsToCurrentFaculty(s){
    const id=String(currentUser?.profile?.facultyId||'');if(!id)return false;
    if((s.facultyIds||[]).map(String).includes(id))return true;
    const aliases=new Set([currentUser?.name,currentUser?.profile?.instructor,currentUser?.profile?.facultyDirectoryMatch?.name].map(swapNameKey).filter(Boolean));
    return (s.assignments||[]).some(a=>String(a?.ucid||'')===id||aliases.has(swapNameKey(a?.name)));
  }
  function roleIsFaculty(user){return['faculty','hicc','visc'].includes(UCVM.role(user?.role||user?.profile?.role))}

  function openSessionDetail(id){
    const s=renderedSessions.find(x=>String(x.id)===String(id))||sessions.find(x=>String(x.id)===String(id));if(!s)return;
    const assignmentRows=(s.assignments||[]).map((a,i)=>`<div class="session-assignment"><span>${escapeHtml(a.name||a.ucid||`Faculty ${i+1}`)}</span><small>${escapeHtml(a.role||s.type||'')}</small>${canEdit()?`<button class="session-swap-link" data-swap-index="${i}">Swap</button>`:''}</div>`).join('');
    showModal(`<div class="modal-header"><div class="modal-title">${escapeHtml(s.course)} · ${escapeHtml(s.type)}</div><div class="modal-subtitle">${escapeHtml(s.courseName||'')} · ${escapeHtml(s.date)}</div></div><div class="modal-body"><div class="detail-grid">
      ${detailField('Topic', s.topic)}
      ${detailField('Time', s.timeUnknown ? 'Time not specified in source workbook' : `${s.start} - ${s.end}`)}${detailField('Room', s.room)}${detailFieldMultiline('Instructor(s)', instructorDisplayText(s)||'TBD')}${s.year?detailField('Year', `Year ${s.year}`):''}
    </div>${assignmentRows?`<div class="session-assignments"><div class="form-label">Faculty assignments</div>${assignmentRows}</div>`:''}</div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="detail-close">Close</button>${canEdit()?'<button type="button" class="btn btn-primary" id="detail-edit">Edit session</button>':''}</div>`);
    $('detail-close').onclick=closeModal;if(canEdit())$('detail-edit').onclick=()=>openSessionForm(s);
    document.querySelectorAll('[data-swap-index]').forEach(button=>button.onclick=()=>openSwapModal(s.id,Number(button.dataset.swapIndex)));
  }

  function detailField(label,value){return `<div><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value||'—')}</span></div>`}
  function detailFieldMultiline(label,value){return `<div><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value" style="white-space:pre-line">${escapeHtml(value||'—')}</span></div>`}

  function splitInstructorNames(v){return String(v||'').split(/[;\n]+/).map(x=>x.trim()).filter(Boolean)}
  function defaultTeachingRole(type){const t=String(type||'').toUpperCase();if(t==='LEC')return'Lecture';if(t==='SRL')return'SRL';if(t==='LAB')return'Lab Support';return type||'Other'}
  function doeRateForRole(role){return ({'Lecture':0.30,'SRL':0.30,'Lab Lead':0.21,'Lab Primary':0.21,'Lab Support':0.19,'Lab Secondary':0.19})[role]??null}
  function blockHours(start,end){const hours=scheduling.durationHours(start,end);return hours===null?0:hours}
  function reconcileAssignments(existing,namesText,type,start,end,topic){const names=splitInstructorNames(namesText),old=Array.isArray(existing)?existing:[];return names.map((name,i)=>{let prev=old.find(x=>String(x.name||'').toLowerCase()===name.toLowerCase())||old[i]||{};const role=prev.role||defaultTeachingRole(type);const h=Number.isFinite(Number(prev.creditedHours))?Number(prev.creditedHours):blockHours(start,end);const rate=doeRateForRole(role);return {...prev,ucid:prev.ucid||null,name,topic:prev.topic||topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'}})}
  function finalizeInstructorAssignments(rows,type,start,end,topic){return (Array.isArray(rows)?rows:[]).filter(a=>String(a?.name||'').trim()).map(a=>{const role=a.role||defaultTeachingRole(type);const h=Number.isFinite(Number(a.creditedHours))?Number(a.creditedHours):blockHours(start,end);const rate=doeRateForRole(role);const out={...a,ucid:a.ucid||null,name:String(a.name||'').trim(),topic:a.topic||topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'};delete out.__editorKey;return out})}
  function instructorDisplayText(s){const a=Array.isArray(s?.assignments)?s.assignments:[];const names=a.map(x=>String(x?.name||'').trim()).filter(Boolean);return (names.length?names:splitInstructorNames(s?.instructor||'')).join('\n')}
  function labDetailsFromAssignments(type,assignments,topic){if(String(type||'').toUpperCase()!=='LAB')return[];return assignments.map(a=>({name:a.name||'',role:a.role||'Lab Support',ucid:a.ucid||null,topic:topic||''}))}

  function blankBulkRow(seed={}){return{date:seed.date||'',year:seed.year||1,course:seed.course||'200',type:seed.type||'LEC',start:seed.start||'08:00',end:seed.end||'09:00',topic:seed.topic||'',room:seed.room||'',faculty:seed.faculty||''}}
  function bulkSelectOptions(values,current){return values.map(value=>`<option value="${escapeHtml(value)}" ${String(value)===String(current)?'selected':''}>${escapeHtml(value)}</option>`).join('')}
  function renderBulkRows(){
    const host=$('bulk-session-body');if(!host)return;
    const courseOptions=[...COURSES.map(c=>String(c.code)),'CCC'];
    host.innerHTML=bulkRows.map((row,index)=>`<tr data-bulk-row="${index}">
      <td><input class="bulk-date" data-bulk-field="date" data-index="${index}" type="date" value="${escapeHtml(row.date)}"></td>
      <td><select data-bulk-field="year" data-index="${index}">${bulkSelectOptions(['1','2','3','4'],row.year)}</select></td>
      <td><select data-bulk-field="course" data-index="${index}">${bulkSelectOptions(courseOptions,row.course)}</select></td>
      <td><select data-bulk-field="type" data-index="${index}">${bulkSelectOptions(['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam','CCC'],row.type)}</select></td>
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
      if(swapNameKey(token)===swapNameKey('Other / Unassigned')){assignments.push({ucid:null,name:'Other / Unassigned'});continue}
      const key=swapNameKey(token),match=facultyDirectory.find(f=>String(f.__id)===token||String(f.ucid||'')===token||String(f.email||'').toLowerCase()===token.toLowerCase()||swapFacultyAliases(f).has(key));
      if(!match){errors.push(`Row ${rowNumber}: faculty "${token}" was not found.`);continue}
      assignments.push({ucid:String(match.__id),name:swapFacultyName(match)});
    }
    return {assignments,errors};
  }
  function validateBulkRows(rows){
    const errors=[],warnings=[],prepared=[];
    if(!rows.length)errors.push('Add at least one row.');
    if(rows.length>MAX_BULK_SESSION_ROWS)errors.push(`A maximum of ${MAX_BULK_SESSION_ROWS} rows can be saved at once.`);
    rows.forEach((row,index)=>{
      const n=index+1,date=String(row.date||''),course=String(row.course||'').trim(),type=String(row.type||'').trim(),topic=String(row.topic||'').trim(),start=String(row.start||''),end=String(row.end||''),year=Number(row.year);
      if(!scheduling.normalizeDate(date))errors.push(`Row ${n}: enter a valid date.`);
      if(![1,2,3,4].includes(year))errors.push(`Row ${n}: year must be 1–4.`);
      if(!course)errors.push(`Row ${n}: course is required.`);if(!type)errors.push(`Row ${n}: type is required.`);if(!topic)errors.push(`Row ${n}: topic is required.`);
      if(scheduling.validateInterval(start,end).status!=='valid')errors.push(`Row ${n}: end time must be after start time.`);
      const resolved=resolveBulkFaculty(row.faculty,n);errors.push(...resolved.errors);
      const assignments=finalizeInstructorAssignments(resolved.assignments,type,start,end,topic);
      for(const assignment of assignments){const faculty=facultyDirectory.find(f=>String(f.__id)===String(assignment.ucid||''));if(!faculty)continue;const availability=facultyAssignmentAvailability(faculty,date,start,end,'');if(availability.available!==true)warnings.push(`Row ${n} · ${assignment.name}: ${assignmentAvailabilityDetail(availability,date,start,end)}`)}
      if(!errors.some(message=>message.startsWith(`Row ${n}:`))){const pos=academicPositionForDate(parseYmd(date));prepared.push({date,week:pos.week,semester:pos.semester,year,course,courseName:course==='CCC'?'Away from Campus':(COURSES.find(c=>String(c.code)===course)?.name||''),type:course==='CCC'?'CCC':type,topic,instructor:assignments.map(a=>a.name).join('; '),room:String(row.room||'').trim(),start,end,assignments,labDetails:labDetailsFromAssignments(type,assignments,topic),sourceSystem:'Bulk live timetable entry'})}
    });
    return {errors,warnings,sessions:prepared};
  }
  async function saveBulkSessions(rows){
    await ensureSessionsForDates(rows.map(row=>row.date));
    const result=validateBulkRows(rows),errorBox=$('bulk-errors');
    if(result.errors.length){errorBox.textContent=result.errors.join('\n');errorBox.classList.remove('hidden');document.querySelectorAll('[data-bulk-row]').forEach((tr,index)=>tr.classList.toggle('bulk-row-error',result.errors.some(message=>message.startsWith(`Row ${index+1}:`))));return false}
    if(result.warnings.length&&!confirm(`Faculty availability warnings:\n\n${result.warnings.slice(0,20).join('\n')}${result.warnings.length>20?`\n…and ${result.warnings.length-20} more`:''}\n\nSave all ${result.sessions.length} sessions anyway?`))return false;
    const batch=db.batch(),created=[];
    for(const session of result.sessions){
      const ref=db.collection(SESSION_COLLECTION).doc(),next={id:ref.id,...session};
      created.push(next);
      batch.set(ref,{...firestoreSafeSession(next),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      const logRef=db.collection(SESSION_LOG_COLLECTION).doc();
      batch.set(logRef,{action:'create',sessionId:next.id,course:next.course,date:next.date,topic:next.topic,instructors:next.assignments.map(a=>({ucid:a.ucid||null,name:a.name,role:a.role,doeCredit:a.doeCredit??null})),changes:[{field:'session',label:'Session',before:null,after:[next.course,next.date,next.start+'-'+next.end,next.topic].filter(Boolean).join(' · ')}],changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});
    }
    await batch.commit();
    invalidateAllSessions();created.forEach(s=>sessionCache.set(s.id,s));await updateDerivedIndexes({sessions:created},{rethrow:true});return true;
  }
  async function openBulkSessionForm(){
    if(!canEdit()){toast('Admin permission is required.',true);return}
    await ensureFacultyDirectory();bulkRows=[blankBulkRow()];
    const facultyOptions=[...facultyDirectory.map(f=>`<option value="${escapeHtml(swapFacultyName(f))}">${escapeHtml(f.email||f.__id)}</option>`),'<option value="Other / Unassigned"></option>'].join('');
    showModal(`<div class="modal-header"><div class="modal-title">Add Multiple Live Sessions</div><div class="modal-subtitle">Edit rows like a spreadsheet or paste tab-separated rows copied from Excel. Every row is validated before one atomic save.</div></div><form id="bulk-session-form"><div class="modal-body">
      <div class="bulk-toolbar"><button type="button" class="btn btn-secondary" id="bulk-add-row">+ Add row</button><button type="button" class="btn btn-secondary" id="bulk-duplicate-row">Duplicate last row</button><button type="button" class="btn btn-secondary" id="bulk-paste-rows">Paste Excel rows</button><span class="bulk-count" id="bulk-row-count"></span></div>
      <div class="bulk-paste-panel hidden" id="bulk-paste-panel"><label class="form-label" for="bulk-paste-text">Paste columns: Date, Year, Course, Type, Start, End, Topic, Room, Faculty</label><textarea id="bulk-paste-text" placeholder="2026-09-14&#9;1&#9;CCC&#9;CCC&#9;07:30&#9;17:00&#9;CCC Day&#9;&#9;Faculty Name"></textarea><div><button type="button" class="btn btn-primary" id="bulk-paste-apply">Add pasted rows</button></div></div>
      <datalist id="bulk-faculty-list">${facultyOptions}</datalist><div class="bulk-sheet-wrap"><table class="bulk-sheet"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>Faculty</th><th></th></tr></thead><tbody id="bulk-session-body"></tbody></table></div><div class="bulk-errors hidden" id="bulk-errors"></div>
    </div><div class="modal-footer"><span class="form-hint">Maximum 200 rows. Faculty may be separated with semicolons.</span><div><button type="button" class="btn btn-secondary" id="bulk-cancel">Cancel</button> <button class="btn btn-primary" type="submit">Save all sessions</button></div></div></form>`);
    document.querySelector('#modal .modal-box')?.classList.add('bulk-wide');renderBulkRows();
    $('bulk-add-row').onclick=()=>{if(bulkRows.length>=MAX_BULK_SESSION_ROWS){toast(`Maximum ${MAX_BULK_SESSION_ROWS} rows.`,true);return}bulkRows.push(blankBulkRow(bulkRows.at(-1)||{}));renderBulkRows()};
    $('bulk-duplicate-row').onclick=()=>{if(bulkRows.length>=MAX_BULK_SESSION_ROWS){toast(`Maximum ${MAX_BULK_SESSION_ROWS} rows.`,true);return}bulkRows.push(blankBulkRow({...bulkRows.at(-1),date:bulkRows.at(-1)?.date}));renderBulkRows()};
    $('bulk-paste-rows').onclick=()=>$('bulk-paste-panel').classList.toggle('hidden');
    $('bulk-paste-apply').onclick=()=>{const parsed=parseBulkPaste($('bulk-paste-text').value);if(!parsed.length){toast('No tab-separated rows found.',true);return}const first=bulkRows.length===1&&Object.values(bulkRows[0]).filter(Boolean).length<=8?[]:bulkRows;bulkRows=[...first,...parsed].slice(0,MAX_BULK_SESSION_ROWS);renderBulkRows();$('bulk-paste-panel').classList.add('hidden')};
    $('bulk-cancel').onclick=closeModal;$('bulk-session-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;button.textContent='Saving...';try{if(!await saveBulkSessions(bulkRows)){button.disabled=false;button.textContent='Save all sessions'}}catch(error){console.error('[bulk session save]',error);$('bulk-errors').textContent='Save failed. No rows were added. Check Firestore permissions and try again.';$('bulk-errors').classList.remove('hidden');button.disabled=false;button.textContent='Save all sessions'}};
  }
  function parseBulkPaste(value){
    return String(value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const cells=line.split('\t');return blankBulkRow({date:cells[0]||'',year:cells[1]||1,course:cells[2]||'200',type:cells[3]||'LEC',start:cells[4]||'08:00',end:cells[5]||'09:00',topic:cells[6]||'',room:cells[7]||'',faculty:cells[8]||''})})
  }

  async function openSessionForm(session=null){
    if(!canEdit()){toast('Admin permission is required.',true);return}
    await ensureFacultyDirectory();const s=session||{date:ymd(weekStart(selectedWeek,selectedSemester)),year:selectedYear==='all'?1:Number(selectedYear),course:COURSES[0].code,type:'LEC',start:'08:00',end:'09:00',topic:'',room:'',assignments:[]},existing=JSON.parse(JSON.stringify(s));
    const courseOptions=COURSES.map(c=>c.code),typeOptions=['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam','CCC'],assignmentRows=(s.assignments&&s.assignments.length?s.assignments:[{name:'',ucid:null,role:defaultTeachingRole(s.type)}]).map((a,i)=>({...a,__editorKey:`a${i}-${Date.now()}`}));
    showModal(`<div class="modal-header"><div class="modal-title">${session?'Edit':'Add'} Live Session</div><div class="modal-subtitle">Changes save directly to Firestore and the audit log.</div></div><form id="session-form"><div class="modal-body"><div class="form-grid">
      ${input('sf-date','Date','date',s.date)}${select('sf-year','Year',['1','2','3','4'],String(s.year||1))}${select('sf-course','Course',courseOptions,String(s.course))}${select('sf-type','Type',typeOptions,String(s.type))}${input('sf-start','Start','time',s.start)}${input('sf-end','End','time',s.end)}${input('sf-topic','Topic','text',s.topic)}${input('sf-room','Room','text',s.room)}
    </div><div class="form-label">Faculty assignments</div><div id="sf-assignment-rows"></div><button type="button" class="btn btn-secondary" id="sf-add-faculty">+ Add faculty</button></div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="sf-cancel">Cancel</button><button class="btn btn-primary" type="submit">${session?'Save changes':'Add session'}</button></div></form>`);
    const host=$('sf-assignment-rows');
    function renderAssignmentRows(){
      const currentType=$('sf-type').value,currentStart=$('sf-start').value,currentEnd=$('sf-end').value,currentTopic=$('sf-topic').value;
      host.innerHTML=assignmentRows.map((a,index)=>`<div class="assignment-editor-row" data-a-key="${escapeHtml(a.__editorKey)}"><select class="form-control" data-a-faculty="${index}"><option value="">Choose faculty</option>${facultyDirectory.map(f=>`<option value="${escapeHtml(f.__id)}" ${String(a.ucid||'')===String(f.__id)?'selected':''}>${escapeHtml(swapFacultyName(f))}</option>`).join('')}<option value="__other" ${!a.ucid&&a.name==='Other / Unassigned'?'selected':''}>Other / Unassigned</option></select><input class="form-control" data-a-name="${index}" value="${escapeHtml(a.name||'')}" placeholder="Name"><select class="form-control" data-a-role="${index}">${['Lecture','SRL','Lab Lead','Lab Primary','Lab Support','Lab Secondary','Other'].map(role=>`<option ${String(a.role||defaultTeachingRole(currentType))===role?'selected':''}>${role}</option>`).join('')}</select><button type="button" class="btn btn-secondary" data-a-remove="${index}">Remove</button></div>`).join('');
      host.querySelectorAll('[data-a-faculty]').forEach(select=>select.onchange=()=>{const i=Number(select.dataset.aFaculty),f=facultyDirectory.find(x=>String(x.__id)===String(select.value));assignmentRows[i].ucid=f?String(f.__id):null;assignmentRows[i].name=f?swapFacultyName(f):(select.value==='__other'?'Other / Unassigned':assignmentRows[i].name);renderAssignmentRows()});
      host.querySelectorAll('[data-a-name]').forEach(input=>input.oninput=()=>assignmentRows[Number(input.dataset.aName)].name=input.value);
      host.querySelectorAll('[data-a-role]').forEach(select=>select.onchange=()=>assignmentRows[Number(select.dataset.aRole)].role=select.value);
      host.querySelectorAll('[data-a-remove]').forEach(button=>button.onclick=()=>{assignmentRows.splice(Number(button.dataset.aRemove),1);renderAssignmentRows()});
    }
    renderAssignmentRows();$('sf-add-faculty').onclick=()=>{assignmentRows.push({name:'',ucid:null,role:defaultTeachingRole($('sf-type').value),__editorKey:`a${Date.now()}`});renderAssignmentRows()};$('sf-type').onchange=renderAssignmentRows;$('sf-cancel').onclick=closeModal;
    $('session-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter,course=$('sf-course').value,type=$('sf-type').value,start=$('sf-start').value,end=$('sf-end').value,topic=$('sf-topic').value.trim(),date=$('sf-date').value,year=Number($('sf-year').value),room=$('sf-room').value.trim();if(!date||!course||!type||!topic||!start||!end||timeToMinutes(end)<=timeToMinutes(start)){toast('Enter a valid date, course, type, topic and time range.',true);return}const assignments=finalizeInstructorAssignments(assignmentRows,type,start,end,topic).filter(a=>a.name),pos=academicPositionForDate(parseYmd(date)),next={...existing,date,week:pos.week,semester:pos.semester,year,course,courseName:course==='CCC'?'Away from Campus':(COURSES.find(c=>String(c.code)===course)?.name||''),type:course==='CCC'?'CCC':type,topic,instructor:assignments.map(a=>a.name).join('; '),room,start,end,timeUnknown:false,assignments,facultyIds:[...new Set(assignments.map(a=>a.ucid).filter(Boolean).map(String))],labDetails:labDetailsFromAssignments(type,assignments,topic),sourceSystem:'Live timetable edit'};const warnings=[];for(const a of assignments){const f=facultyDirectory.find(x=>String(x.__id)===String(a.ucid||''));if(!f)continue;const av=facultyAssignmentAvailability(f,date,start,end,s?.id||'');if(av.available!==true)warnings.push(`${a.name}: ${assignmentAvailabilityDetail(av,date,start,end)}`)}if(warnings.length&&!confirm(`Faculty availability warnings:\n\n${warnings.join('\n')}\n\nSave anyway?`))return;button.disabled=true;button.textContent='Saving...';try{await saveSession(next,session?existing:null);closeModal();toast(session?'Session updated.':'Session added.')}catch(error){console.error('[session save]',error);toast(error.message||'Could not save the session.',true);button.disabled=false;button.textContent=session?'Save changes':'Add session'}};
  }

  function input(id,label,type,value){return `<label class="form-field"><span>${escapeHtml(label)}</span><input class="form-control" id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value??'')}"></label>`}
  function select(id,label,values,current){return `<label class="form-field"><span>${escapeHtml(label)}</span><select class="form-control" id="${escapeHtml(id)}">${values.map(v=>`<option value="${escapeHtml(v)}" ${String(v)===String(current)?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select></label>`}
  function sessionChangeList(before,after){
    const fields=[['date','Date'],['course','Course'],['type','Type'],['start','Start'],['end','End'],['topic','Topic'],['room','Room'],['assignments','Faculty']];return fields.flatMap(([field,label])=>JSON.stringify(before?.[field]??null)===JSON.stringify(after?.[field]??null)?[]:[{field,label,before:before?.[field]??null,after:after?.[field]??null}]);
  }
  async function saveSession(next,before){
    const isNew=!before?.id,id=before?.id||db.collection(SESSION_COLLECTION).doc().id,ref=db.doc(`${SESSION_COLLECTION}/${id}`),record={...next,id};
    const batch=db.batch();batch.set(ref,{...firestoreSafeSession(record),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});const log=db.collection(SESSION_LOG_COLLECTION).doc();batch.set(log,{action:isNew?'create':'update',sessionId:id,course:record.course,date:record.date,topic:record.topic,changes:isNew?[{field:'session',label:'Session',before:null,after:[record.course,record.date,record.start+'-'+record.end,record.topic].join(' · ')}]:sessionChangeList(before,record),changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});await batch.commit();sessions=isNew?[...sessions,record]:sessions.map(s=>String(s.id)===String(id)?record:s);sessionCache.set(id,record);invalidateAllSessions();await updateDerivedIndexes({sessions:[record]},{rethrow:true});render();
  }

  async function deleteSession(session){
    if(!canEdit()||!session?.id)return;if(!confirm(`Delete ${session.course} · ${session.date} · ${session.topic}?`))return;const batch=db.batch(),ref=db.doc(`${SESSION_COLLECTION}/${session.id}`),log=db.collection(SESSION_LOG_COLLECTION).doc();batch.delete(ref);batch.set(log,{action:'delete',sessionId:session.id,course:session.course,date:session.date,topic:session.topic,changes:[{field:'session',label:'Session',before:[session.course,session.date,session.topic].join(' · '),after:null}],changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});await batch.commit();sessions=sessions.filter(s=>String(s.id)!==String(session.id));sessionCache.delete(String(session.id));invalidateAllSessions();await updateDerivedIndexes({deleteSessionIds:[session.id]},{rethrow:true});render();toast('Session deleted.')
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

  function populateCourseFilter(){
    const values=[...new Set(sessions.map(s=>String(s.course||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),host=$('filter-course-options');
    host.innerHTML=values.map(course=>`<label><input type="checkbox" value="${escapeHtml(course)}" ${selectedCourses.has(course)?'checked':''}> ${escapeHtml(course)}</label>`).join('')||'<span>No courses loaded.</span>';host.querySelectorAll('input').forEach(input=>input.onchange=()=>{if(input.checked)selectedCourses.add(input.value);else selectedCourses.delete(input.value);courseFilterActive=selectedCourses.size>0;updateCourseSummary();render()});updateCourseSummary();
  }
  function updateCourseSummary(){$('course-filter-summary').textContent=courseFilterActive?[...selectedCourses].sort().join(', '):'All Courses'}

  async function loadCccEvents(){
    if(cccLoaded)return cccEvents;if(cccLoading)return cccLoading;
    cccLoading=db.collection('afc_requests').where('status','==','approved').get().then(snapshot=>{cccEvents=snapshot.docs.flatMap(doc=>{const row=doc.data(),start=parseYmd(row.startDate),end=parseYmd(row.endDate),out=[];for(let d=new Date(start);d<=end;d=addDays(d,1)){if(d.getDay()===0||d.getDay()===6)continue;const date=ymd(d),pos=academicPositionForDate(d);out.push({id:`ccc-${doc.id}-${date}`,date,week:pos.week,semester:pos.semester,year:'',course:'CCC',courseName:'Away from Campus',type:'CCC',topic:'CCC Day',instructor:row.facultyName||row.requesterName||'Faculty',assignments:[{ucid:row.facultyId||'',name:row.facultyName||row.requesterName||'Faculty'}],room:'',start:'07:30',end:'17:00',timeUnknown:false,isCcc:true,sourceSystem:'AFC CCC record'})}return out});cccLoaded=true;return cccEvents}).finally(()=>{cccLoading=null});return cccLoading;
  }
  function sessionsWithCcc(source,start,end){return showCcc?[...source,...cccEvents.filter(row=>row.date>=start&&row.date<=end)]:source}

  function exportFilteredRows(all,options){
    let data=[...all];if(showCcc)data=[...data,...cccEvents];
    const q=$('search-input').value.trim().toLowerCase(),type=$('filter-type').value;
    data=data.filter(s=>{if(!showCcc&&String(s.type||'').toUpperCase()==='CCC')return false;if(selectedYear!=='all'&&String(s.year)!==String(selectedYear))return false;if(courseFilterActive&&!selectedCourses.has(String(s.course)))return false;if(type!=='all'&&s.type!==type)return false;if(q&&!`${s.course} ${s.topic} ${s.instructor} ${s.room} ${s.type}`.toLowerCase().includes(q))return false;return true});
    if(options.scope==='date')data=data.filter(s=>s.date>=options.start&&s.date<=options.end);if(options.scope==='academic')data=data.filter(s=>s.semester===options.semester&&(options.week==='all'||String(s.week)===String(options.week))&&(options.year==='all'||String(s.year)===String(options.year)));return data.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start).localeCompare(String(b.start)));
  }

  function downloadFile(content,type,filename){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500)}
  async function openExportDialog(kind){
    try{
      const all=await ensureAllSessions();if(showCcc)await loadCccEvents();const today=ymd(new Date());showModal(`<div class="modal-header"><div class="modal-title">Export ${kind==='csv'?'CSV':'Calendar'}</div><div class="modal-subtitle">Choose the date scope. Current Year/Course/Type/Search filters stay active.</div></div><form id="export-form"><div class="modal-body"><div class="login-cheatsheet"><label><input type="radio" name="scope" value="date" checked> Date range</label> &nbsp; <label><input type="radio" name="scope" value="academic"> Academic period</label> &nbsp; <label><input type="radio" name="scope" value="all"> All filtered dates</label></div><div class="form-grid" id="export-date-fields">${input('export-start','Start date','date',today)}${input('export-end','End date','date','2027-08-31')}</div><div class="form-grid hidden" id="export-academic-fields">${select('export-semester','Semester',['fall','winter','spring'],selectedSemester)}${select('export-week','Week',['all',...Array.from({length:WEEK_COUNT},(_,i)=>String(i+1))],'all')}${select('export-year','Year',['all','1','2','3','4'],selectedYear)}</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="export-cancel">Cancel</button><button class="btn btn-primary" type="submit">Download</button></div></form>`);$('export-cancel').onclick=closeModal;document.querySelectorAll('[name="scope"]').forEach(radio=>radio.onchange=()=>{$('export-date-fields').classList.toggle('hidden',radio.value!=='date'||!radio.checked);$('export-academic-fields').classList.toggle('hidden',radio.value!=='academic'||!radio.checked)});$('export-form').onsubmit=event=>{event.preventDefault();const form=new FormData(event.currentTarget),options={scope:form.get('scope'),start:$('export-start').value,end:$('export-end').value,semester:$('export-semester').value,week:$('export-week').value,year:$('export-year').value},data=exportFilteredRows(all,options);if(kind==='csv')exportCsv(data);else exportCalendar(data);closeModal();toast(`${data.length} sessions exported.`)}}catch(error){console.error('[export]',error);toast('Could not load the complete schedule for export.',true)}
  }
  function exportCsv(data){
    const header=['ID','Source','Date','Week','Semester','Year','Course','Course Name','Type','Topic','Instructor','Assignments JSON','Room','Start','End','Time Unknown','CCC'];
    const rows=[header,...data.map(s=>[s.id,s.sourceSystem||'',s.date,s.week,s.semester,s.year,s.course,s.courseName||'',s.type,s.topic,s.instructor,JSON.stringify(s.assignments||[]),s.room,s.start,s.end,!!s.timeUnknown,!!s.isCcc])];
    const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    downloadFile(csv,'text/csv;charset=utf-8','ucvm-filtered-timetable.csv');
  }
  function icsEscape(value){return String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
  function icsDate(date){return String(date).replace(/-/g,'')}
  function exportCalendar(data){
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const events=data.map(s=>{
      const summary=icsEscape(`${s.course} ${s.type}${s.topic?` - ${s.topic}`:''}`),description=icsEscape(`Faculty: ${s.instructor||'TBD'}${s.room?`\nRoom: ${s.room}`:''}`);
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
    return [...emails].map(([email,name])=>({email,name}));
  }
  function exportOutlookInvites(data,organizer){
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const organizerEmail=String(organizer?.email||'').trim(),organizerName=String(organizer?.name||organizerEmail||'UCVM Scheduling');
    const events=data.map(session=>{
      const summary=icsEscape(`${session.course} ${session.type}${session.topic?` - ${session.topic}`:''}`),description=icsEscape(`Faculty: ${session.instructor||'TBD'}${session.room?`\nRoom: ${session.room}`:''}`),attendees=outlookAttendeesForSession(session).map(a=>`ATTENDEE;CN=${icsEscape(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${icsEscape(a.email)}`);
      const times=session.isCcc||session.timeUnknown||!session.start||!session.end?[`DTSTART;VALUE=DATE:${icsDate(session.date)}`,`DTEND;VALUE=DATE:${icsDate(ymd(addDays(parseYmd(session.date),1)))}`]:[`DTSTART;TZID=America/Edmonton:${icsDate(session.date)}T${session.start.replace(':','')}00`,`DTEND;TZID=America/Edmonton:${icsDate(session.date)}T${session.end.replace(':','')}00`];
      return ['BEGIN:VEVENT',`UID:${icsEscape(session.id)}@ucvm-outlook`,`DTSTAMP:${stamp}Z`,...times,`SUMMARY:${summary}`,`DESCRIPTION:${description}`,session.room?`LOCATION:${icsEscape(session.room)}`:'',organizerEmail?`ORGANIZER;CN=${icsEscape(organizerName)}:mailto:${icsEscape(organizerEmail)}`:'',...attendees,'STATUS:CONFIRMED','SEQUENCE:0','END:VEVENT'].filter(Boolean).join('\r\n');
    }).join('\r\n');
    downloadFile(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//UCVM//Outlook Teaching Invitations//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:REQUEST\r\n${events}\r\nEND:VCALENDAR\r\n`,'text/calendar;charset=utf-8','ucvm-outlook-invite-package.ics');
  }
  async function openOutlookInviteDialog(){
    if(!UCVM.admin(currentUser)){toast('ADFA permission is required.',true);return}
    try{
      const [all]=await Promise.all([ensureAllSessions(),ensureFacultyDirectory()]);if(showCcc)await loadCccEvents();
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
