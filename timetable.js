(() => {
  'use strict';

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
  function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
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

  function availabilityTimeMinutes(value){
    const raw=String(value||'').trim(); if(!raw)return null;
    const m=raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i); if(!m)return null;
    let h=Number(m[1]),min=Number(m[2]); if(!Number.isFinite(h)||!Number.isFinite(min)||min<0||min>59)return null;
    const ap=(m[3]||'').toUpperCase(); if(ap){if(h<1||h>12)return null;if(ap==='AM'&&h===12)h=0;if(ap==='PM'&&h!==12)h+=12}else if(h<0||h>23)return null;
    return h*60+min;
  }
  function availabilityIntervalsOverlap(aStart,aEnd,bStart,bEnd){
    const as=availabilityTimeMinutes(aStart),ae=availabilityTimeMinutes(aEnd),bs=availabilityTimeMinutes(bStart),be=availabilityTimeMinutes(bEnd);
    if([as,ae,bs,be].some(v=>v===null)||ae<=as||be<=bs)return false;
    return as<be&&bs<ae;
  }
  function sessionHasFaculty(sess,f){
    const id=String(f?.__id||''); const aliases=swapFacultyAliases(f);
    const arr=Array.isArray(sess?.assignments)?sess.assignments:[];
    if(arr.some(a=>String(a?.ucid||'')===id || aliases.has(swapNameKey(a?.name))))return true;
    return splitInstructorNames(sess?.instructor||'').some(n=>aliases.has(swapNameKey(n)));
  }
  function timetableAvailability(f,dateYmd,start,end,excludeSessionId=''){
    const d=String(dateYmd||'').slice(0,10),targetStart=availabilityTimeMinutes(start),targetEnd=availabilityTimeMinutes(end);
    if(!d)return{available:null,conflicts:[],possibleConflicts:[],reason:'date'};
    const sameDay=pageSessions().filter(sess=>String(sess?.id||'')!==String(excludeSessionId||'')&&String(sess?.date||'').slice(0,10)===d&&sessionHasFaculty(sess,f));
    if(targetStart===null||targetEnd===null||targetEnd<=targetStart)return{available:null,conflicts:[],possibleConflicts:sameDay,reason:'target-time'};
    const conflicts=[],possibleConflicts=[];
    for(const sess of sameDay){
      const ss=availabilityTimeMinutes(sess.start),se=availabilityTimeMinutes(sess.end);
      if(sess.timeUnknown||ss===null||se===null||se<=ss){possibleConflicts.push(sess);continue}
      if(availabilityIntervalsOverlap(start,end,sess.start,sess.end))conflicts.push(sess);
    }
    return{available:conflicts.length?false:(possibleConflicts.length?null:true),conflicts,possibleConflicts,reason:conflicts.length?'overlap':(possibleConflicts.length?'other-time-unknown':'clear')};
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
          <label class="form-field"><span class="form-label">Swap out current faculty assignment</span><select class="form-select" id="swap-out-select">${assignments.map((a,i)=>`<option value="${i}" ${i===selected?'selected':''}>${escapeHtml(a.name||'Unassigned')} · ${escapeHtml(a.role||s.type||'')} · ${swapPct(swapAssignmentCredit(a))}</option>`).join('')}</select></label>
          <div class="swap-current-card"><div class="swap-current-title">Current assignment being removed</div><div class="swap-current-line"><span><strong>${escapeHtml(outgoing?.name||'Unknown')}</strong></span><span>Role: <strong>${escapeHtml(outgoing?.role||s.type||'')}</strong></span><span>DOE credit: <strong>${credit===null?'Unrated':swapPct(credit)}</strong></span><span>Current Assigned DOE: <strong>${swapPct(outCurrent)}</strong></span><span>After removal: <strong>${credit===null?'Unrated impact':swapPct(outAfter)}</strong></span></div></div>
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
          return `<tr class="${av.available===false?'swap-unavailable':''}"><td><strong>${escapeHtml(swapFacultyName(f))}</strong><br><span class="form-hint">${escapeHtml(f.teachingArea||f.teachingAreaEmphasis||f.currentTitle||'')} ${f.ucid?`· ${escapeHtml(f.ucid)}`:''}</span></td><td>${avHtml}</td><td class="swap-num">${targetText}</td><td class="swap-num">${swapPct(current)}</td><td class="swap-num swap-projected">${afterText}</td><td class="swap-num">${remText}</td><td><span class="swap-status ${status.cls}">${status.label}</span></td><td><button class="btn btn-primary btn-swap-confirm" data-swap-faculty="${escapeHtml(f.__id)}">SWAP</button></td></tr>`;
        }).join('')||'<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-3)">No faculty match this search.</td></tr>';
        document.querySelectorAll('[data-swap-faculty]').forEach(btn=>btn.onclick=()=>performFacultySwap(s,assignments,selected,btn.dataset.swapFaculty,doeState));
      };
      $('swap-search').oninput=renderCandidates; renderCandidates();
    };
    renderSwap();
  }

  async function performFacultySwap(session,assignments,outIndex,newFacultyId,doeState){
    if(!UCVM.admin(currentUser))return;
    const replacement=facultyDirectory.find(f=>String(f.__id)===String(newFacultyId)); if(!replacement)return;
    const outgoing=assignments[outIndex]; if(!outgoing)return;
    const oldFaculty=facultyForAssignment(outgoing); const oldName=outgoing.name||swapFacultyName(oldFaculty)||'Unknown'; const newName=swapFacultyName(replacement);
    const credit=swapAssignmentCredit(outgoing), currentNew=doeState.get(String(replacement.__id))?.current??null, projectedNew=(currentNew!==null&&credit!==null)?currentNew+credit:null, av=facultyAssignmentAvailability(replacement,session.date,session.start,session.end,session.id);
    const availabilityWarning=av.available===false?`\n\nWARNING: ${newName} is not available for ${session.date} ${session.start||''}-${session.end||''}:\n${assignmentAvailabilityDetail(av,session.date,session.start,session.end)}\n\nAdmin override?`:av.available===null?`\n\nCHECK NEEDED before assigning ${newName}:\n${assignmentAvailabilityDetail(av,session.date,session.start,session.end)}\n\nContinue as admin?`:'';
    if(!confirm(`Swap ${oldName} to ${newName} for ${session.course} - ${session.topic}?\n\n${credit===null?'DOE impact: this activity is unrated.':`DOE credit transferred: ${credit.toFixed(2)}%\n${newName}: ${currentNew===null?'current DOE unavailable':currentNew.toFixed(2)+'%'} → ${projectedNew===null?'projected unavailable':projectedNew.toFixed(2)+'%'}`}${availabilityWarning}`))return;
    const nextAssignments=assignments.map((a,i)=>i===outIndex?{...a,ucid:String(replacement.__id),name:newName,category:'Faculty',source:'Admin SWAP',swappedFrom:{ucid:String(outgoing.ucid||oldFaculty?.__id||''),name:oldName},swappedAt:new Date().toISOString()}:a);
    const next={...session,assignments:nextAssignments,instructor:nextAssignments.map(a=>a.name).filter(Boolean).join('; '),labDetails:labDetailsFromAssignments(session.type,nextAssignments,session.topic),sourceSystem:'Synchronized live timetable'};
    try{
      const batch=db.batch(),ref=db.collection(SESSION_COLLECTION).doc(session.id),logRef=db.collection(SESSION_LOG_COLLECTION).doc();
      batch.set(ref,{...firestoreSafeSession(next),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      batch.set(logRef,{action:'swap_faculty',sessionId:session.id,course:session.course,date:session.date,topic:session.topic,role:outgoing.role||session.type||'',doeCredit:credit,fromFaculty:{ucid:String(outgoing.ucid||oldFaculty?.__id||''),name:oldName},toFaculty:{ucid:String(replacement.__id),name:newName},toFacultyCurrentAssignedDOE:currentNew,toFacultyProjectedAssignedDOE:projectedNew,changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});
      await batch.commit(); invalidateAllSessions(); await updateDerivedIndexes([{before:session,after:next}]); closeModal(); toast(`SWAP complete: ${oldName} → ${newName}. Faculty DOE will update automatically.`);
    }catch(err){console.error('[faculty swap]',err);toast('SWAP failed. Check Firestore session write permissions.',true)}
  }

  async function initializeLiveSchedule() {
    if (!UCVM.admin(currentUser)) { toast('Admin permission is required.', true); return; }
    if (confirm('The timetable is now sourced only from 2026-09-03 - All Faculty Summaries.xlsx. Open the Faculty Dashboard to replace and synchronize the source data?')) location.href='faculty-admin.html';
  }

  function init() {
    setInitialAcademicPeriod();
    populateCourseFilter();
    renderWeekControls();
    bindControls();
    updateAuthUI();
    setAppLocked(true, 'Checking login status...');
    initFirebaseAuth();
  }

  function courseCodes() { return [...new Set([...COURSES.map(c=>String(c.code)), ...sessions.map(x=>String(x.course||'')).filter(Boolean), ...(showCcc&&cccLoaded?['CCC']:[])])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})); }
  function populateCourseFilter() {
    const host=$('filter-course-options'), codes=courseCodes();
    selectedCourses=new Set([...selectedCourses].filter(code=>codes.includes(code)));
    host.innerHTML=`<div class="course-multi-actions"><button type="button" data-course-all>Show all courses</button></div>${codes.map(code=>`<label class="course-multi-option"><input type="checkbox" data-course-choice value="${escapeHtml(code)}" ${selectedCourses.has(code)?'checked':''}> <span>${escapeHtml(code)}</span></label>`).join('')}`;
    const updateSummary=()=>{$('course-filter-summary').textContent=!courseFilterActive?'All Courses':selectedCourses.size===0?'No courses selected':selectedCourses.size===1?[...selectedCourses][0]:`${selectedCourses.size} courses selected`;};
    host.querySelectorAll('[data-course-choice]').forEach(box=>box.onchange=()=>{courseFilterActive=true;box.checked?selectedCourses.add(box.value):selectedCourses.delete(box.value);updateSummary();render()});
    host.querySelector('[data-course-all]').onclick=()=>{courseFilterActive=false;selectedCourses.clear();host.querySelectorAll('[data-course-choice]').forEach(x=>x.checked=false);updateSummary();render()};
    updateSummary();
  }

  function roleIsFaculty(profile){ return ['faculty','hicc','visc'].includes(UCVM.role(profile?.role)); }
  function sessionBelongsToCurrentFaculty(s){
    if(!currentUser)return false;
    const facultyId=String(currentUser.profile?.facultyId||'').trim();
    const aliases=new Set([currentUser.instructorName,currentUser.name,currentUser.email].map(swapNameKey).filter(Boolean));
    const assignments=Array.isArray(s.assignments)?s.assignments:[];
    if(facultyId&&assignments.some(a=>String(a?.ucid||a?.facultyId||'').trim()===facultyId))return true;
    if(assignments.some(a=>aliases.has(swapNameKey(a?.name))))return true;
    return splitInstructorNames(s.instructor||'').some(name=>aliases.has(swapNameKey(name)));
  }
  async function loadCccEvents(){
    if(cccLoaded)return cccEvents;
    if(cccLoading)return cccLoading;
    cccLoading=db.collection('public_schedule').doc('ccc_events').get().then(doc=>{
      const data=doc.exists?doc.data():{};
      cccEvents=Array.isArray(data.events)?data.events:[];
      cccLoaded=true;
      return cccEvents;
    }).catch(err=>{console.error('[CCC schedule]',err);toast('CCC records could not be loaded.',true);throw err}).finally(()=>{cccLoading=null});
    return cccLoading;
  }
  function expandCccEvents(start,end){
    if(!showCcc||!cccLoaded)return[];
    const rows=[];
    cccEvents.forEach((event,eventIndex)=>{
      const first=event.startDate>start?event.startDate:start, last=event.endDate<end?event.endDate:end;
      if(!first||!last||first>last)return;
      for(let d=parseYmd(first);ymd(d)<=last;d=addDays(d,1)){
        if(d.getDay()===0||d.getDay()===6)continue;
        const date=ymd(d), position=academicPositionForDate(d);
        rows.push({id:`ccc-${event.id||eventIndex}-${date}`,date,week:position.week,semester:position.semester,year:'',course:'CCC',courseName:'Away from Campus',type:'CCC',topic:'CCC Day',instructor:event.facultyName||'Faculty',assignments:[{ucid:event.facultyId||'',name:event.facultyName||'Faculty'}],room:'',start:'07:30',end:'17:00',timeUnknown:false,isCcc:true,sourceSystem:'AFC CCC record'});
      }
    });
    return rows;
  }
  function sessionsWithCcc(source,start,end){return [...source,...expandCccEvents(start,end)]}

  function renderWeekControls() {
    const r1 = $('week-btn-row-1');
    const r2 = $('week-btn-row-2');
    const mobile = $('week-mobile-select');
    r1.innerHTML = ''; r2.innerHTML = ''; mobile.innerHTML = '';
    for (let w = 1; w <= WEEK_COUNT; w++) {
      const b = document.createElement('button');
      b.className = 'pill-btn' + (w === selectedWeek ? ' active' : '');
      b.textContent = `W${w}`; b.dataset.week = w;
      b.addEventListener('click', () => { selectedWeek = w; syncWeekUI(); refreshSessionScope(); });
      (w <= 8 ? r1 : r2).appendChild(b);
      const opt = document.createElement('option'); opt.value = w; opt.textContent = `Week ${w} - ${formatDate(weekStart(w, selectedSemester))}`;
      if (w === selectedWeek) opt.selected = true;
      mobile.appendChild(opt);
    }
  }

  function syncWeekUI() {
    document.querySelectorAll('[data-week]').forEach(b => b.classList.toggle('active', Number(b.dataset.week) === selectedWeek));
    $('week-mobile-select').value = String(selectedWeek);
  }

  function bindControls() {
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
    $('calendar-body').innerHTML=`<div class="selection-errors hidden" id="selection-errors" role="alert"></div><div class="selection-sheet-wrap"><table class="selection-sheet"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>Faculty</th></tr></thead><tbody>${rows}</tbody></table></div><div class="selection-save-bar"><span>Open Faculty to choose one or more people and review their DOE.</span><button class="btn btn-secondary" id="selection-back-btn">Back to selection</button><button class="btn btn-primary" id="selection-save-btn">Save selected changes</button></div>`;
    document.querySelectorAll('.selection-faculty-picker').forEach(picker=>{picker.querySelectorAll('[data-selection-faculty-option]').forEach(input=>input.onchange=()=>updateSelectionFacultyPicker(picker));updateSelectionFacultyPicker(picker)});
    $('selection-back-btn').onclick=()=>{reviewingSelection=false;viewMode=selectionViewFlow.finish();setViewButtons();refreshSessionScope()};
    $('selection-save-btn').onclick=saveSelectedChanges;
  }
  function readSelectionRows(){
    const originals=new Map([...selectedSessionOriginals].map(([id,row])=>[String(id),row]));
    return [...document.querySelectorAll('[data-selection-row]')].map(tr=>{
      const id=String(tr.dataset.sessionEditId),original=originals.get(id),value=field=>tr.querySelector(`[data-selection-field="${field}"]`).value;
      const ids=[...tr.querySelectorAll('[data-selection-faculty-option]:checked')].map(option=>String(option.value));
      const type=value('type'),start=value('start'),end=value('end'),topic=value('topic'),date=value('date'),position=academicPositionForDate(parseYmd(date)),originalIds=[...(original.facultyIds||[]),...(original.assignments||[]).map(a=>a.ucid||a.facultyId)].filter(Boolean).map(String),assignmentChanged=ids.join('|')!==[...new Set(originalIds)].join('|')||type!==String(original.type||'')||start!==String(original.start||'')||end!==String(original.end||'')||topic!==String(original.topic||'');
      const assignments=assignmentChanged?ids.map(facultyId=>{const faculty=facultyDirectory.find(f=>String(f.__id)===facultyId),previous=(original.assignments||[]).find(a=>String(a.ucid||a.facultyId||'')===facultyId)||{},role=previous.role||defaultTeachingRole(type),hours=blockHours(start,end),rate=doeRateForRole(role);return{...previous,ucid:facultyId,facultyId,name:swapFacultyName(faculty),role,topic,creditedHours:hours,doeRate:rate,doeCredit:rate===null?null:Number((hours*rate).toFixed(6)),source:'Multi-session timetable edit'}}):original.assignments;
      const course=value('course');
      return{...original,id,date,week:position.week,semester:position.semester,year:Number(value('year')),course,courseName:course===String(original.course||'')?original.courseName:(COURSES.find(c=>String(c.code)===course)?.name||''),type,start,end,topic,room:value('room'),timeUnknown:start===String(original.start||'')&&end===String(original.end||'')?Boolean(original.timeUnknown):false,assignments,facultyIds:ids,labDetails:assignmentChanged?labDetailsFromAssignments(type,assignments,topic):original.labDetails};
    });
  }
  async function saveSelectedChanges(){
    if(!canEdit()){toast('Admin permission is required.',true);return}
    const button=$('selection-save-btn'),errorBox=$('selection-errors'),originals=window.UCVM_TIMETABLE_SELECTION.selectedRows([...selectedSessionOriginals.values()],sessionSelection.ids()),rows=readSelectionRows(),facultyById=new Map(facultyDirectory.map(f=>[String(f.__id),f])),timestamp=firebase.firestore.FieldValue.serverTimestamp();
    await ensureSessionsForDates(rows.map(row=>row.date));
    const plan=window.UCVM_TIMETABLE_SELECTION.planChanges(originals,rows,currentUser,timestamp,facultyById);
    if(plan.errors.length){errorBox.innerHTML=plan.errors.map(error=>`<div>${escapeHtml(error)}</div>`).join('');errorBox.classList.remove('hidden');return}
    if(!plan.updates.length){toast('No selected session values changed.');return}
    plan.updates=plan.updates.map(update=>({...update,data:{...firestoreSafeSession(update.data),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:timestamp}}));
    button.disabled=true;button.textContent='Saving...';
    try{
      const changes=plan.logs.map(log=>({before:log.before,after:log.after})),result=await window.UCVM_TIMETABLE_SELECTION.commitPlan(plan,{batch:()=>db.batch(),sessionRef:id=>db.collection(SESSION_COLLECTION).doc(id),logRef:()=>db.collection(SESSION_LOG_COLLECTION).doc(),afterCommit:async()=>{invalidateAllSessions();await updateDerivedIndexes(changes,{rethrow:true})}});
      const count=result.operations/2;cancelSessionSelection();toast(`${count} session${count===1?'':'s'} updated with audit history.`);
    }catch(error){console.error('[multi-session save]',error);errorBox.textContent=error.committed?'Sessions were saved, but the derived lookup index could not be refreshed. Keep this review open and ask an administrator to refresh the indexes.':'Nothing was saved. Check your connection and permissions, then try again.';errorBox.classList.remove('hidden');button.disabled=false;button.textContent='Save selected changes'}
  }

  function openSessionDetail(id) {
    const s = renderedSessions.find(x => x.id === id) || sessions.find(x => x.id === id); if (!s) return;
    const edit = !s.isCcc&&canEdit() ? `<button class="btn btn-primary" id="detail-edit">Edit Session</button>` : '';
    const swap = !s.isCcc&&isAdmin() ? `<button class="btn btn-primary" id="detail-swap">SWAP Faculty</button>` : '';
    const labDetails = Array.isArray(s.labDetails) && s.labDetails.length > 1
      ? `<div class="login-cheatsheet"><strong>Lab stations / activities</strong><br><br>${s.labDetails.map(d => `<div style="margin-bottom:8px"><strong>${escapeHtml(d.topic)}</strong>${d.instructor ? `<br>${escapeHtml(d.instructor)}` : ''}${d.room ? `<br><span style="color:var(--text-3)">${escapeHtml(d.room)}</span>` : ''}</div>`).join('')}</div>`
      : '';
    showModal(`
      <div class="modal-header"><div class="modal-title">${escapeHtml(s.course)} - ${escapeHtml(s.topic)}</div><div class="modal-subtitle">${escapeHtml(s.type)} | ${formatLongDate(parseYmd(s.date))}</div></div>
      <div class="modal-body">
        <div class="form-grid">
          ${detailField('Time', s.timeUnknown ? 'Time not specified in source workbook' : `${s.start} - ${s.end}`)}${detailField('Room', s.room)}${detailFieldMultiline('Instructor(s)', instructorDisplayText(s)||'TBD')}${s.year?detailField('Year', `Year ${s.year}`):''}
        </div>
        ${labDetails}
        <div class="login-cheatsheet"><strong>Schedule source:</strong> ${s.isCcc?'Away from Campus CCC record. This schedule copy includes only the faculty name and CCC dates.':scheduleSource === 'firestore' ? 'Synchronized Firestore sessions from All Faculty Summaries — the Faculty Dashboard reads these same sessions.' : 'No synchronized source is loaded. Use Faculty Dashboard → Teaching Summary → Replace & Sync All Faculty Summaries.'}</div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" id="detail-close">Close</button><div>${swap}${edit}</div></div>`);
    $('detail-close').onclick = closeModal;
    if ($('detail-swap')) $('detail-swap').onclick = () => openSwapModal(s.id);
    if ($('detail-edit')) $('detail-edit').onclick = () => openSessionForm(s);
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
  function blockHours(start,end){const a=timeToMinutes(start),b=timeToMinutes(end);return b>=a?(b-a)/60:0}
  function reconcileAssignments(existing,namesText,type,start,end,topic){const names=splitInstructorNames(namesText),old=Array.isArray(existing)?existing:[];return names.map((name,i)=>{let prev=old.find(x=>String(x.name||'').toLowerCase()===name.toLowerCase())||old[i]||{};const role=prev.role||defaultTeachingRole(type);const h=Number.isFinite(Number(prev.creditedHours))?Number(prev.creditedHours):blockHours(start,end);const rate=doeRateForRole(role);return {...prev,ucid:prev.ucid||null,name,topic:prev.topic||topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'}})}
  function finalizeInstructorAssignments(rows,type,start,end,topic){return (Array.isArray(rows)?rows:[]).filter(a=>String(a?.name||'').trim()).map(a=>{const role=a.role||defaultTeachingRole(type);const h=Number.isFinite(Number(a.creditedHours))?Number(a.creditedHours):blockHours(start,end);const rate=doeRateForRole(role);const out={...a,ucid:a.ucid||null,name:String(a.name||'').trim(),topic:a.topic||topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'};delete out.__editorKey;return out})}
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
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parseYmd(date).getTime()))errors.push(`Row ${n}: enter a valid date.`);
      if(![1,2,3,4].includes(year))errors.push(`Row ${n}: year must be 1–4.`);
      if(!course)errors.push(`Row ${n}: course is required.`);if(!type)errors.push(`Row ${n}: type is required.`);if(!topic)errors.push(`Row ${n}: topic is required.`);
      if(!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||timeToMinutes(end)<=timeToMinutes(start))errors.push(`Row ${n}: end time must be after start time.`);
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
    await batch.commit();invalidateAllSessions();await updateDerivedIndexes(created.map(after=>({before:null,after})));closeModal();toast(`${result.sessions.length} live sessions added.`);return true;
  }
  async function openBulkSessionForm(){
    if(!UCVM.admin(currentUser)){toast('ADFA permission is required.',true);return}
    if(scheduleSource!=='firestore'){toast('The live Firestore timetable is unavailable.',true);return}
    await ensureFacultyDirectory();bulkRows=[blankBulkRow()];
    const facultyOptions=facultyDirectory.map(f=>`<option value="${escapeHtml(swapFacultyName(f))}">${escapeHtml([f.email,f.ucid||f.__id].filter(Boolean).join(' · '))}</option>`).join('');
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

  async function openSessionForm(existing = null) {
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
        if(!currentId&&currentName&&swapNameKey(currentName)!==swapNameKey('Other / Unassigned')) options+=`<option value="__current__" selected>${escapeHtml(currentName)} (source/current)</option>`;
        options+=`<option value="__unassigned__" ${!currentId&&(!currentName||swapNameKey(currentName)===swapNameKey('Other / Unassigned'))?'selected':''}>Other / Unassigned</option>`;
        const targetDate=$('date')?.value||s.date,targetStart=$('start')?.value||s.start,targetEnd=$('end')?.value||s.end,excludeId=s.id||'';
        for(const f of facultyDirectory){const id=String(f.__id),selected=id===currentId,disabled=!selected&&usedIds.has(id),av=facultyAssignmentAvailability(f,targetDate,targetStart,targetEnd,excludeId),suffix=av.available===false?` — UNAVAILABLE: ${assignmentAvailabilityShort(av)}`:av.available===null?' — CHECK NEEDED':'';options+=`<option value="${escapeHtml(id)}" ${selected?'selected':''} ${disabled?'disabled':''}>${escapeHtml(swapFacultyName(f)+suffix)}</option>`}
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
        ${input('start','Start','time',s.start)}
        ${input('end','End','time',s.end)}
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
      editorAssignments.push({__editorKey:`new-${Date.now()}-${Math.random()}`,ucid:null,name:'Other / Unassigned',topic,role,creditedHours:h,doeRate:rate,doeCredit:rate===null?null:Number((h*rate).toFixed(6)),source:'Live timetable edit'});renderInstructorEditor();
    };
    $('cancel-session').onclick = closeModal;
    if ($('delete-session')) $('delete-session').onclick = () => deleteSession(existing.id);
    $('session-form').onsubmit = async e => {
      e.preventDefault();
      const form = new FormData(e.target); const date = parseYmd(form.get('date'));
      await ensureSessionsForDates([form.get('date')]);
      const pos = academicPositionForDate(date);
      const topic=form.get('topic'), type=form.get('type'), start=form.get('start'), end=form.get('end');
      const assignments=finalizeInstructorAssignments(editorAssignments,type,start,end,topic);
      if(UCVM.admin(currentUser)){
        const checks=assignments.map(a=>({a,f:facultyDirectory.find(x=>String(x.__id)===String(a.ucid||''))})).filter(x=>x.f).map(x=>({...x,av:facultyAssignmentAvailability(x.f,String(form.get('date')),start,end,existing?.id||'')})).filter(x=>x.av.available!==true);
        if(checks.length){const msg=checks.map(x=>`- ${x.a.name}: ${assignmentAvailabilityDetail(x.av,String(form.get('date')),start,end)}`).join('\n');if(!confirm(`Faculty availability warning for ${form.get('date')} ${start}-${end}:\n\n${msg}\n\nThis checks both AFC and overlapping live timetable courses. AFC reasons are intentionally hidden here. Save this assignment anyway?`))return;}
      }
      const next = {
        id: existing?.id || `S${Date.now()}`,
        ...(existing?.auditEventId ? {auditEventId: existing.auditEventId} : {}),
        date: form.get('date'), week:pos.week, semester:pos.semester, year:Number(form.get('year')),
        course:form.get('course'), courseName:(COURSES.find(c=>String(c.code)===String(form.get('course')))||{}).name||existing?.courseName||'', type, topic, instructor:assignments.map(a=>a.name).join('; '), room:form.get('room'),
        start, end, assignments, labDetails:labDetailsFromAssignments(type,assignments,topic), sourceSystem:'Synchronized live timetable'
      };
      try {
        const ref=db.collection(SESSION_COLLECTION).doc(next.id);
        const batch=db.batch();
        batch.set(ref,{...firestoreSafeSession(next),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
        const logRef=db.collection(SESSION_LOG_COLLECTION).doc();
        batch.set(logRef,{action:existing?'update':'create',sessionId:next.id,course:next.course,date:next.date,topic:next.topic,instructors:assignments.map(a=>({ucid:a.ucid||null,name:a.name,role:a.role,doeCredit:a.doeCredit??null})),changes:UCVM_AUDIT_DETAILS.diff(existing,next,'session'),changedBy:currentUser.uid,changedByName:currentUser.name,changedByEmail:currentUser.email||'',changedAt:firebase.firestore.FieldValue.serverTimestamp()});
        await batch.commit();
        invalidateAllSessions();
        await updateDerivedIndexes([{before:existing||null,after:next}]);
        closeModal();
        toast(existing?'Live session updated.':'Live session added.');
      } catch(err) {
        console.error(err); toast('Session save failed. Check Firestore session write rules.',true);
      }
    };
  }

  function input(name,label,type,value,extra='') {
    return `<div class="form-field ${extra}"><label class="form-label" for="${name}">${label}</label><input class="form-input" id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" required></div>`;
  }
  function select(name,label,options,value) {
    return `<div class="form-field"><label class="form-label" for="${name}">${label}</label><select class="form-select" id="${name}" name="${name}">${options.map(o => `<option value="${escapeHtml(o)}" ${String(o)===String(value)?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select></div>`;
  }

  async function deleteSession(id) {
    if (!UCVM.admin(currentUser)) { toast('ADFA permission is required.', true); return; }
    const s = sessions.find(x => x.id === id); if (!s) return;
    if (scheduleSource !== 'firestore') { toast('Live Schedule is not initialized.', true); return; }
    if (!confirm(`Delete ${s.course} - ${s.topic} from the live schedule?`)) return;
    try {
      const batch=db.batch();
      batch.delete(db.collection(SESSION_COLLECTION).doc(id));
      const logRef=db.collection(SESSION_LOG_COLLECTION).doc();
      batch.set(logRef,{action:'delete',sessionId:id,course:s.course,date:s.date,topic:s.topic,changes:UCVM_AUDIT_DETAILS.diff(s,null,'session'),changedBy:currentUser.uid,changedByName:currentUser.name,changedByEmail:currentUser.email||'',changedAt:firebase.firestore.FieldValue.serverTimestamp()});
      await batch.commit(); invalidateAllSessions(); await updateDerivedIndexes([{before:s,after:null}]); closeModal(); toast('Live session deleted.');
    } catch(err) { console.error(err); toast('Delete failed. Check Firestore session write rules.', true); }
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
      text.textContent = 'Firebase Auth + Roles Ready';
      setAppLocked(true, 'Checking saved login...');

      auth.onAuthStateChanged(async user => {
        if (!user) {
          text.textContent = 'Firebase Auth + Roles Ready';
          currentUser = null;
          viewMode = 'week'; setViewButtons();
          myTimetableOnly = false;
          if (sessionUnsubscribe) { try { sessionUnsubscribe(); } catch (_) {} sessionUnsubscribe = null; }
          sessionRangeKey='';
          sessionCache.clear();sessionCacheRanges.length=0;sessionRangeLoads.clear();sessionCacheDates.clear();sessionDateLoads.clear();
          allSessionsCache=null;
          clearCurrentFaculty();
          unsubscribeFacultyDirectory();
          scheduleSource = 'signed-out';
          sessions = [];
          updateAuthUI();
          setAppLocked(true, 'Sign in required to view the timetable.');
          return;
        }

        const email = String(user.email || '').trim().toLowerCase();
        const phone = String(user.phoneNumber || '').trim();
        let provider = 'firebase';
        let identity = '';

        if (email) {
          if (!isAllowedEmail(email)) {
            await auth.signOut().catch(() => {});
            toast(`Email ${email} is outside the allowed local domain.`, true);
            return;
          }
          provider = 'email';
          identity = email;
        } else if (phone) {
          if (!isAllowedPhone(phone)) {
            await auth.signOut().catch(() => {});
            toast(`Phone ${phone} is not on the optional local phone list.`, true);
            return;
          }
          provider = 'phone';
          identity = phone;
        } else {
          await auth.signOut().catch(() => {});
          toast('This Firebase account has neither an email nor a phone number.', true);
          return;
        }

        try {
          text.textContent = 'Checking Firestore role...';
          setAppLocked(true, 'Checking your timetable access...');
          const profile = await getRoleProfile(user);
          if (!await UCVM.ready(user, profile)) return;
          UCVM.watch(user, profile);
          const name = String(profile.name || user.displayName || (email ? email.split('@')[0] : phone) || 'UCVM User');
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
          sessionCache.clear();sessionCacheRanges.length=0;sessionRangeLoads.clear();sessionCacheDates.clear();sessionDateLoads.clear();
          await ensureCurrentFaculty();
          publishPageData();
          viewMode = roleIsFaculty(currentUser) ? 'day' : 'week';
          setViewButtons();
          myTimetableOnly = roleIsFaculty(currentUser);
          closeModal();
          updateAuthUI();
          subscribeSessions();
          unsubscribeFacultyDirectory();
          render();
          setAppLocked(false);
          updateScheduleSourceUI();
          toast(`Signed in as ${name} (${profile.role}).`);
        } catch (err) {
          console.error('[Firestore role lookup]', err);
          let msg = err && err.message ? err.message : 'Could not load this user\'s Firestore role.';
          const code = err && err.code ? err.code : '';
          if (code === 'permission-denied') {
            msg = 'Firestore denied access to users/{uid}. Publish the V7 Firestore Rules from README_FIRST.txt.';
          } else if (code === 'ucvm/profile-not-found') {
            msg = 'Authentication succeeded, but this UID has no document under Firestore > users. Add users/{UID} with active=true and role=viewer or editor.';
          } else if (code === 'ucvm/profile-inactive') {
            msg = 'This account exists but active is not true in Firestore.';
          } else if (code === 'ucvm/invalid-role') {
            msg = 'Firestore role must be exactly viewer, editor, or admin (lowercase recommended).';
          }
          setAppLocked(true, 'Access denied. Sign in with an authorized account.');
          await auth.signOut().catch(() => {});
          text.textContent = 'Firebase Auth + Roles Ready';
          toast(msg, true);
        }
      });
    } catch (err) {
      authInitialized = false;
      dot.classList.remove('online');
      dot.style.background = 'var(--danger)';
      text.textContent = 'Firebase Auth / Firestore unavailable';
      setAppLocked(true, 'Firebase is unavailable. Check your connection or setup.');
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
        <div class="login-cheatsheet"><strong>Firebase project:</strong> Tester Teaching (<code>tester-teaching</code>)<br>Enable the matching provider in Firebase Authentication. Your UID must also exist under Firestore <code>users/{uid}</code>.</div>
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
        <div class="login-cheatsheet">Use the email address registered by ADFA General. New faculty accounts must change their temporary password after signing in.</div>
        <div class="form-field"><label class="form-label">Email</label><input class="form-input" id="login-email" name="email" type="email" placeholder="name@ucalgary.ca" autocomplete="username" required></div>
        <div class="form-field"><label class="form-label">Password</label><input class="form-input" id="login-password" name="password" type="password" autocomplete="current-password" required></div>
      </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="email-back">Back</button><button class="btn btn-primary" type="submit">Sign in with Email</button></div></form>`);
    $('email-back').onclick = openLoginModal;
    $('email-login-form').onsubmit = async e => {
      e.preventDefault();
      const email = $('login-email').value.trim();
      const password = $('login-password').value;
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
      </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="phone-back">Back</button><button class="btn btn-primary" type="submit">Send SMS Code</button></div></form>`);
    $('phone-back').onclick = openLoginModal;
    try {
      recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', { size: 'normal' });
      recaptchaVerifier.render().catch(err => console.error('[reCAPTCHA render]', err));
    } catch (err) {
      console.error('[reCAPTCHA init]', err);
      toast('Could not initialize reCAPTCHA. Make sure you opened http://localhost:8765/.', true);
    }
    $('phone-login-form').onsubmit = async e => {
      e.preventDefault();
      const phone = normalizePhoneForFirebase($('login-phone').value);
      if (!/^\+\d{8,15}$/.test(phone)) { toast('Enter a valid phone number, preferably in +1... format.', true); return; }
      try {
        if (!recaptchaVerifier) throw new Error('reCAPTCHA is not initialized.');
        phoneConfirmation = await auth.signInWithPhoneNumber(phone, recaptchaVerifier);
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
      </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="code-back">Use another number</button><button class="btn btn-primary" type="submit">Verify & Sign In</button></div></form>`);
    $('code-back').onclick = openPhoneLoginModal;
    $('phone-code-form').onsubmit = async e => {
      e.preventDefault();
      const code = $('phone-code').value.trim();
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
        toast(msg, true);
      }
    };
  }

  function openAuthSetupModal() {
    showModal(`
      <div class="modal-header"><div class="modal-title">Local Auth + Firestore Role Setup</div><div class="modal-subtitle">Login is Firebase Auth. Authorization comes from Firestore users/{uid}.</div></div>
      <form id="auth-setup-form"><div class="modal-body">
        <div class="login-cheatsheet">
          <strong>Firebase test project:</strong> Tester Teaching (<code>tester-teaching</code>)<br><br>
          <strong>V9.7 UCalgary UI + synchronized workload DOE + Firestore-only authorization + admin SWAP + AFC + timetable availability:</strong><br>
          1. User signs in with Email/Password or Phone.<br>
          2. V9.7 reads <code>users/{Firebase UID}</code> from Firestore; after authorization, the timetable loads exclusively from <code>sessions</code>. Admin users also load the faculty directory, Away from Campus records, live timetable conflicts, SWAP tools and instructor selection.<br>
          3. <code>active: true</code> is required.<br>
          4. <code>role: "viewer"</code> = view only; <code>role: "editor"</code> = view + add/edit/delete.<br><br>
          Timetable reads and admin edits are Firestore-only. No Year 1/2/3 bundled schedule files are loaded by this page.
        </div>
        <div class="form-field"><label class="form-label">Allowed email domain</label><input class="form-input" id="auth-domain" value="${escapeHtml(authSettings.allowedDomain)}" placeholder="ucalgary.ca"><div class="form-hint">Optional local pre-check. Firestore users/{uid} is the real authorization list.</div></div>
        <div class="form-field"><label class="form-label">Allowed phone number(s) - optional</label><textarea class="form-input" id="auth-allowed-phones" rows="3" placeholder="+14035551234, +14035555678">${escapeHtml(authSettings.allowedPhones)}</textarea><div class="form-hint">Leave blank to let Firestore users/{uid} decide whether an authenticated phone user is authorized.</div></div>
        <div class="form-field"><label class="form-label">Instructor mapping</label><input class="form-input" id="auth-instructor" value="${escapeHtml(authSettings.instructorAlias)}" placeholder="Faculty 001"><div class="form-hint">Used for the My Timetable filter on this test site. You may instead add an optional Firestore field named <code>instructor</code>.</div></div>
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
      toast('Local settings saved. User role still comes from Firestore.');
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
          <strong>Authorization:</strong> Firestore <code>users/${escapeHtml(currentUser.uid)}</code>.<br>
          <strong>Role:</strong> ${escapeHtml(currentUser.role)} &nbsp; <strong>Active:</strong> ${currentUser.active ? 'true' : 'false'}<br>
          <strong>Timetable sessions:</strong> ${scheduleSource === 'firestore' ? 'Live Firestore schedule — shared across authorized users.' : 'No synchronized source loaded — import from Faculty Dashboard.'}
        </div>
        <div class="form-hint">My Timetable mapping: <strong>${escapeHtml(currentUser.instructorName)}</strong>.</div>
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
    $('add-session-btn').classList.toggle('hidden', !canEdit());
    $('selection-controls').classList.toggle('hidden', !canEdit());
    $('bulk-add-session-btn').classList.toggle('hidden', !UCVM.admin(currentUser));
    $('outlook-invite-btn').classList.toggle('hidden', !UCVM.admin(currentUser));
    $('manage-users-btn').classList.toggle('hidden', !(UCVM.general(currentUser) || currentUser?.role === 'hicc'));
    $('faculty-dashboard-btn').classList.toggle('hidden', !UCVM.admin(currentUser));
    $('cal-admin-menu').classList.toggle('hidden',!showAdminTools);
    for(const id of ['my-teaching-btn','afc-request-btn','my-change-history-btn'])$(id).classList.toggle('hidden',!currentUser);
    $('publish-firestore-schedule').classList.toggle('hidden', !UCVM.admin(currentUser));
    updateScheduleSourceUI();
    $('my-timetable-btn').classList.toggle('hidden', !currentUser || roleIsFaculty(currentUser));
    $('my-timetable-btn').textContent = currentUser && myTimetableOnly ? 'Show All Timetable' : 'My Timetable';
  }

  function openUserManager() {
    if (UCVM.general(currentUser) || currentUser?.role === 'hicc') location.href = 'user-management.html';
  }

  function openCourseList() {
    const rows=courseCodes().map(code=>{const base=COURSES.find(c=>String(c.code)===code);const live=sessions.find(x=>String(x.course)===code);return{code,year:base?.year||live?.year||'',name:base?.name||live?.courseName||''}});
    showModal(`
      <div class="modal-header"><div class="modal-title">Course List</div><div class="modal-subtitle">Courses present in the synchronized 2026-2027 All Faculty Summaries timetable</div></div>
      <div class="modal-body"><div class="user-table-wrap"><table class="user-table"><thead><tr><th>Course</th><th>Year</th><th>Name</th></tr></thead><tbody>${rows.map(c => `<tr><td><strong>${escapeHtml(c.code)}</strong></td><td>${c.year?'Year '+escapeHtml(c.year):'—'}</td><td>${escapeHtml(c.name||'')}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="modal-footer"><span></span><button class="btn btn-secondary" id="course-close">Close</button></div>`);
    $('course-close').onclick = closeModal;
  }

  function openExportDialog(format){
    const today=ymd(new Date());
    showModal(`<div class="modal-header"><div class="modal-title">Export ${format==='ics'?'Calendar':'Schedule Data'}</div><div class="modal-subtitle">The export uses the current course, type, search, My Timetable and CCC filters.</div></div><form id="export-form"><div class="modal-body">
      <div class="login-cheatsheet"><label><input type="radio" name="scope" value="date" checked> Date range</label> &nbsp; <label><input type="radio" name="scope" value="academic"> Academic period</label> &nbsp; <label><input type="radio" name="scope" value="all"> All dates</label></div>
      <div class="form-grid" id="export-date-fields">${input('export-start','Start date','date',today)}${input('export-end','End date','date','2027-08-31')}</div>
      <div class="form-grid hidden" id="export-academic-fields">${select('export-semester','Semester',['fall','winter','spring'],selectedSemester)}${select('export-week','Week',['all',...Array.from({length:WEEK_COUNT},(_,i)=>String(i+1))],'all')}${select('export-year','Year',['all','1','2','3','4'],selectedYear)}</div>
      <p class="form-hint">${format==='ics'?'Produces a standard .ics file for Outlook, Apple Calendar and Google Calendar.':'Produces one complete row per matching timetable or CCC entry.'}</p>
    </div><div class="modal-footer"><button type="button" class="btn btn-secondary" id="export-cancel">Cancel</button><button class="btn btn-primary" type="submit">Export</button></div></form>`);
    $('export-cancel').onclick=closeModal;
    document.querySelectorAll('input[name="scope"]').forEach(r=>r.onchange=()=>{$('export-date-fields').classList.toggle('hidden',r.value!=='date'||!r.checked);$('export-academic-fields').classList.toggle('hidden',r.value!=='academic'||!r.checked)});
    $('export-form').onsubmit=async e=>{
      e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='Preparing...';
      try{
        const scope=new FormData(e.currentTarget).get('scope');let all;
        if(scope==='all')all=await ensureAllSessions();
        else if(scope==='date')all=await ensureSessionsForRange($('export-start').value,$('export-end').value);
        else {const semester=$('export-semester').value,week=$('export-week').value,start=weekStart(week==='all'?1:Number(week),semester),end=addDays(weekStart(week==='all'?WEEK_COUNT:Number(week),semester),4);all=await ensureSessionsForRange(ymd(start),ymd(end))}
        if(showCcc)await loadCccEvents();
        const rows=exportFilteredRows(all,{scope,start:$('export-start').value,end:$('export-end').value,semester:$('export-semester').value,week:$('export-week').value,year:$('export-year').value});
        if(!rows.length){toast('No records match these export settings.',true);button.disabled=false;button.textContent='Export';return}
        format==='ics'?exportCalendar(rows):exportCsv(rows);closeModal();toast(`${rows.length} schedule records exported.`);
      }catch(err){console.error('[schedule export]',err);toast('Export failed while reading the complete schedule.',true);button.disabled=false;button.textContent='Export'}
    };
  }
  function exportFilteredRows(all,options){
    const allDates=[...all.map(s=>s.date),...cccEvents.flatMap(e=>[e.startDate,e.endDate])].filter(Boolean).sort();
    const source=sessionsWithCcc(all,allDates[0]||'2026-01-01',allDates[allDates.length-1]||'2027-12-31');
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
