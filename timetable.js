(() => {
  'use strict';

  const scheduling=window.UCVM_SCHEDULING,approvalScheduling=window.UCVM_APPROVAL_SCHEDULING,closureCalendar=window.UCVM_UNIVERSITY_CLOSURES;
  if(!scheduling||!approvalScheduling||!closureCalendar)throw new Error('UCVM scheduling core, approval policy, and University closure calendar are required.');

  const SESSION_COLLECTION = 'sessions';
  const CALENDAR_SESSION_COLLECTION = 'calendar_sessions';
  const SESSION_SAVE_BATCH_ROWS = 8;
  const SESSION_LOG_COLLECTION = 'session_change_log';
  const SPRING_BASE_MONDAY = new Date(2026, 3, 27);
  const FALL_BASE_MONDAY = new Date(2026, 7, 24);
  const WINTER_BASE_MONDAY = new Date(2027, 0, 4);
  const WEEK_COUNT = 17;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];


  // Firebase runtime configuration is loaded only from firebase-config.js.\r\n  // GitHub Pages injects an in-memory synthetic demo backend at staging time.\r\n  const AUTH_SETTINGS_KEY = 'ucvm_email_phone_role_settings_v6';
  const DEFAULT_AUTH_SETTINGS = {
    allowedDomain: 'ucalgary.ca',
    allowedPhones: '',
    instructorAlias: 'Faculty 001'
  };
  let authSettings = loadAuthSettings();
  let auth = null;
  let db = null;
  let subjectOptions = [];
  let timetableDoeRuntime = null;
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

  function capabilities(stage=''){const profile=currentUser?.profile||{role:currentUser?.role||''};return window.UCVM_OFFICE_CAPABILITIES.forProfile(profile,stage?{stage}:{});}
  function canAddSessions(){return capabilities().canAddSessions;}
  function canAddOneSession(){return capabilities().canAddOneSession;}
  function canSelectSessions(){return capabilities().canSelectSessions||UCVM.general(currentUser);}
  function canEdit(){const c=capabilities();return c.canEditCourseFields||c.canEditInstructor;}
  function hasOfficeAccess(stage){return window.UCVM_OFFICE_CAPABILITIES.hasOfficeAccess(currentUser?.profile||{role:currentUser?.role||''},stage);}
  async function loadSubjectOptions(){
    const catalog=window.UCVM_SUBJECT_CATALOG;
    if(!db||!catalog){subjectOptions=[];return subjectOptions}
    try{const snapshot=await db.collection('teaching_subjects').get();subjectOptions=catalog.activeOptions(snapshot.docs.map(doc=>({id:doc.id,...doc.data()})));return subjectOptions}
    catch(error){console.error('[Teaching Subjects]',error);subjectOptions=[];toast('Teaching Subjects could not be loaded; classification is unavailable.',true);return subjectOptions}
  }
  function subjectChoices(current=''){
    const key=String(current||''),known=subjectOptions.some(option=>option.key===key);
    return `<option value="">No Subject</option>${key&&!known?`<option value="${escapeHtml(key)}" selected>${escapeHtml(key)} (existing; unavailable)</option>`:''}`+
      subjectOptions.map(option=>`<option value="${escapeHtml(option.key)}" ${option.key===key?'selected':''}>${escapeHtml(option.label)}</option>`).join('');
  }
  function sessionCollection(){const role=UCVM.role(currentUser?.role);return role==='other_office'||(['adc','lab'].includes(role)&&!hasOfficeAccess('adfa'))?CALENDAR_SESSION_COLLECTION:SESSION_COLLECTION;}
  function getTimetableDoeRuntime(){
    if(timetableDoeRuntime&&timetableDoeRuntime.db===db)return timetableDoeRuntime;
    const api=window.UCVM_DOE_API,selectionApi=window.UCVM_TIMETABLE_SELECTION;
    if(!db||!api||!selectionApi)throw new Error('DOE workflow modules are required for timetable assignment writes.');
    const httpConfigured=typeof api.isConfigured!=='function'||api.isConfigured();
    let adapter,mode='api';
    if(httpConfigured)adapter=selectionApi.createDoeApiAdapter({api});
    else if(api.canQueueSessionChanges?.()&&typeof api.prepareQueuedSessionChange==='function'){
      mode='queue';
      adapter={prepareSession:(before,after,options={})=>Promise.resolve(api.prepareQueuedSessionChange({beforeSession:before,afterSession:after,trigger:options.trigger||'session_updated'}))};
    }else throw new Error('Neither the DOE API nor the Firebase recalculation queue is available for timetable writes.');
    timetableDoeRuntime={db,api,adapter,mode};
    return timetableDoeRuntime;
  }
  function queuedDoeRequestData(session,requestId,trigger,timestamp,beforeSession=null){
    const academicYear=window.UCVM_DOE_API?.academicYearForSession?.(session);
    if(!academicYear)throw new Error('Academic Year could not be resolved for DOE recalculation queue.');
    return{requestId:String(requestId),academicYear,sessionId:String(session?.id||session?.sessionId||''),sourceEntityType:'session_assignment',sourceEntityIds:[],facultyIds:[],trigger:String(trigger||'office_session_updated'),status:'pending',requestedBy:currentUser.uid,requestedByName:currentUser.name,requestedAt:timestamp,previousStart:String(beforeSession?.start||''),previousEnd:String(beforeSession?.end||''),previousTimeUnknown:beforeSession?.timeUnknown===true};
  }

  function doeAuditChanges(changes){
    return (Array.isArray(changes)?changes:[]).map(change=>({
      field:'doeCredit',label:'DOE',assignmentId:change.assignmentId,facultyId:change.facultyId,
      before:change.oldDoeCredit,after:change.newDoeCredit,
      beforePolicyVersionId:change.oldPolicyVersionId,afterPolicyVersionId:change.newPolicyVersionId,
      beforeCalculationId:change.oldCalculationId,afterCalculationId:change.newCalculationId,
      ruleId:change.ruleId,ruleKey:change.ruleKey
    }));
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
    if (!['developer', 'owner', 'administrator', 'other_office', 'viewer', 'editor', 'admin', 'adfa_general', 'adfa_regular', 'hicc', 'visc', 'faculty', 'adc', 'lab'].includes(role)) {
      const err = new Error(`Invalid Firestore role: ${role || '(blank)'}. Use developer, owner, administrator, other_office, faculty, hicc, visc, adc, lab, adfa_regular, or adfa_general.`);
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
  const labGroupDirectory=new Map(),labRosterDirectory=new Map();
  const teachingAssignmentGroupDirectory=new Map(),teachingResponsibilityDirectory=new Map();
  let labWorkflowLoaded=false,labWorkflowLoading=null;
  let teachingAssignmentDirectoryLoaded=false,teachingAssignmentDirectoryReady=false,teachingAssignmentDirectoryLoading=null;
  function pageProfile(){return currentUser?{...currentUser.profile,name:currentUser.name,email:currentUser.email,role:currentUser.role,facultyId:currentUser.profile?.facultyId||''}:null}
  function pageSessions(){return[...sessionCache.values()]}
  function workflowContext(){return{rosters:Object.fromEntries([...labRosterDirectory.entries()].map(([id,row])=>[id,row])),labGroups:[...labGroupDirectory.values()]}}
  async function ensureLabWorkflowContext(force=false){
    if(!currentUser||!hasOfficeAccess('lab')){labGroupDirectory.clear();labRosterDirectory.clear();labWorkflowLoaded=false;return workflowContext()}
    if(labWorkflowLoaded&&!force)return workflowContext();
    if(labWorkflowLoading)return labWorkflowLoading;
    labWorkflowLoading=Promise.all([db.collection('lab_groups').where('active','==',true).get(),db.collection('lab_group_rosters').get()]).then(([groups,rosters])=>{
      labGroupDirectory.clear();labRosterDirectory.clear();
      for(const doc of groups.docs)labGroupDirectory.set(String(doc.id),{groupId:doc.id,...doc.data()});
      for(const doc of rosters.docs)if(labGroupDirectory.has(String(doc.id)))labRosterDirectory.set(String(doc.id),{groupId:doc.id,...doc.data()});
      labWorkflowLoaded=true;publishPageData();return workflowContext();
    }).finally(()=>{labWorkflowLoading=null});
    return labWorkflowLoading;
  }
  function mayConfigureTeachingAssignmentOwnership(){
    return Boolean(currentUser)&&(UCVM.general(currentUser)||hasOfficeAccess('adc'));
  }
  function teachingAssignmentDirectory(){
    return{groups:[...teachingAssignmentGroupDirectory.values()],responsibilities:[...teachingResponsibilityDirectory.values()],ready:teachingAssignmentDirectoryReady};
  }
  async function ensureTeachingAssignmentDirectory(force=false){
    if(!db||!mayConfigureTeachingAssignmentOwnership()){
      teachingAssignmentGroupDirectory.clear();teachingResponsibilityDirectory.clear();
      teachingAssignmentDirectoryLoaded=false;teachingAssignmentDirectoryReady=false;
      return teachingAssignmentDirectory();
    }
    if(teachingAssignmentDirectoryLoaded&&!force)return teachingAssignmentDirectory();
    if(teachingAssignmentDirectoryLoading)return teachingAssignmentDirectoryLoading;
    teachingAssignmentDirectoryLoading=Promise.all([
      db.collection('teaching_assignment_groups').get(),
      db.collection('teaching_responsibilities').get()
    ]).then(([groups,responsibilities])=>{
      teachingAssignmentGroupDirectory.clear();teachingResponsibilityDirectory.clear();
      for(const doc of groups.docs)teachingAssignmentGroupDirectory.set(String(doc.id),{id:doc.id,...doc.data()});
      for(const doc of responsibilities.docs)teachingResponsibilityDirectory.set(String(doc.id),{id:doc.id,...doc.data()});
      teachingAssignmentDirectoryLoaded=true;teachingAssignmentDirectoryReady=true;publishPageData();
      return teachingAssignmentDirectory();
    }).catch(error=>{
      teachingAssignmentGroupDirectory.clear();teachingResponsibilityDirectory.clear();
      teachingAssignmentDirectoryLoaded=true;teachingAssignmentDirectoryReady=false;
      if(!['permission-denied','failed-precondition'].includes(error?.code))console.error('[Teaching Assignment directory]',error);
      return teachingAssignmentDirectory();
    }).finally(()=>{teachingAssignmentDirectoryLoading=null});
    return teachingAssignmentDirectoryLoading;
  }
  function canConfigureTeachingAssignmentOwnership(){
    return teachingAssignmentDirectoryReady&&mayConfigureTeachingAssignmentOwnership();
  }
  function publishPageData(){for(const callback of pageDataSubscribers){try{callback()}catch(error){console.error('[page data subscriber]',error)}}}
  function cacheSessionRange(range,rows){
    for(const [id,row] of sessionCache)if(row.date>=range.start&&row.date<=range.end)sessionCache.delete(id);
    for(const row of rows)sessionCache.set(row.id,row);
    if(!sessionCacheRanges.some(item=>item.start===range.start&&item.end===range.end))sessionCacheRanges.push({...range});
  }
  function sessionQueryForRange(range){
    let query=db.collection(sessionCollection()).where('date','>=',range.start).where('date','<=',range.end);
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
  async function ensureSessionsForDates(values,force=false){
    const dates=UCVM_DATA_INDEX.dateChunks(values).flat(),missing=force?dates:dates.filter(date=>!sessionCacheDates.has(date)&&!sessionCacheRanges.some(range=>range.start<=date&&date<=range.end));
    await Promise.all(UCVM_DATA_INDEX.dateChunks(missing).map(dateChunk=>{
      const key=(force?'fresh:':'')+dateChunk.join('|');
      if(!sessionDateLoads.has(key))sessionDateLoads.set(key,db.collection(sessionCollection()).where('date','in',dateChunk).get(force?{source:'server'}:undefined).then(snapshot=>{
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
    workflowContext,
    ensureWorkflowContext:()=>ensureLabWorkflowContext(),
    ensureSessionsForRange,
    invalidateSessions:()=>invalidateAllSessions(),
    openScopedEditor:(sessionId,options)=>openScopedEditor(sessionId,options),
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
  let semesterScope = 'all';
  let viewMode = 'week';
  let lastFacultyTeachingView = 'day';
  let selectedDayIndex = 0;
  let selectedCourses = new Set();
  let courseFilterActive = false;
  let showCcc = false;
  let showUniversityClosures = false;
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
  const selectionLabRosterDrafts = new Map();
  let selectionMode = false;
  let reviewingSelection = false;
  let scopedWork = null;

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
    const calendarDay=value=>Date.UTC(value.getFullYear(),value.getMonth(),value.getDate())/86400000;
    const academicWeek=start=>Math.floor((calendarDay(d)-calendarDay(start))/7)+1;
    if (d >= springStart && d <= springEnd) return { semester:'spring', week:academicWeek(springStart) };
    if (d >= fallStart && d <= fallEnd) return { semester:'fall', week:academicWeek(fallStart) };
    if (d >= winterStart && d <= winterEnd) return { semester:'winter', week:academicWeek(winterStart) };
    return d < fallStart ? {semester:'spring',week:1} : {semester:'winter',week:1};
  }
  function moveAcademicWeekPosition(semester,week,delta,continuous) {
    const order=['spring','fall','winter'];
    let currentSemester=order.includes(semester)?semester:'fall';
    let currentWeek=Math.max(1,Math.min(WEEK_COUNT,Number(week)||1));
    const amount=Math.trunc(Number(delta)||0);
    if(amount===0)return{semester:currentSemester,week:currentWeek};
    const step=amount<0?-1:1;
    for(let remaining=Math.abs(amount);remaining>0;remaining--){
      if(step>0){
        if(currentWeek<WEEK_COUNT)currentWeek++;
        else if(continuous){
          const index=order.indexOf(currentSemester);
          if(index<order.length-1){currentSemester=order[index+1];currentWeek=1}
        }
      }else{
        if(currentWeek>1)currentWeek--;
        else if(continuous){
          const index=order.indexOf(currentSemester);
          if(index>0){currentSemester=order[index-1];currentWeek=WEEK_COUNT}
        }
      }
    }
    return{semester:currentSemester,week:currentWeek};
  }
  function monthRangeForAcademicPosition(semester,week) {
    const anchor=weekStart(week,semester);
    const first=new Date(anchor.getFullYear(),anchor.getMonth(),1);
    const last=new Date(anchor.getFullYear(),anchor.getMonth()+1,0);
    return{first,last,start:ymd(first),end:ymd(last)};
  }
  function setInitialAcademicPeriod() {
    const p = academicPositionForDate(new Date());
    selectedSemester = p.semester; selectedWeek = Math.max(1, Math.min(WEEK_COUNT, p.week));
    selectedDayIndex = Math.max(0, Math.min(4, (new Date().getDay() || 1) - 1));
    semesterScope='all';
    syncSemesterUI();
  }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function formatDate(d) { return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); }
  function formatLongDate(d) { return d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
  function timeToMinutes(t) { return scheduling.parseTime(t); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c])); }

  function sessionTypeClass(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'ccc') return 'tg-type-ccc';
    if (normalized === 'closure') return 'tg-type-closure';
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

  function firestoreSafeSessionPatch(s) {
    const clean = JSON.parse(JSON.stringify(UCVM_INDEX_MAINTENANCE.sessionPatchForWrite(s)));
    delete clean.__id;
    return clean;
  }

  function liveScheduleAvailable(){return scheduleSource === 'firestore' || scheduleSource === 'firestore-empty';}

  function updateScheduleSourceUI() {
    const connected = liveScheduleAvailable();
    const text = $('conn-text');
    if (text && currentUser) {
      if (scheduleSource === 'firestore') text.textContent = `Authorized: ${currentUser.role} · Live Firestore schedule`;
      else if (scheduleSource === 'firestore-empty') text.textContent = `Authorized: ${currentUser.role} · Live Firestore schedule · No sessions in this view`;
      else if (scheduleSource === 'firestore-error') text.textContent = `Authorized: ${currentUser.role} · Timetable unavailable`;
      else text.textContent = `Authorized: ${currentUser.role} · Connecting to live timetable`;
    }
    const publish = $('publish-firestore-schedule');
    if (publish) {
      publish.classList.toggle('hidden', !UCVM.admin(currentUser));
      publish.textContent = connected ? 'Synced Schedule Ready' : 'Sync from Faculty Dashboard';
      publish.disabled = false;
    }
  }

  function visibleSessionRange() {
    if (viewMode === 'month') {
      const range=monthRangeForAcademicPosition(selectedSemester,selectedWeek);
      return {start:range.start,end:range.end};
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
    allSessionsLoading=db.collection(sessionCollection()).get().then(snapshot=>{
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
  function swapAssignmentCredit(a){return swapNumeric(a?.doeCredit)}
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
    for(const row of reviews)for(const check of row.checks)warnings.push(`${row.session.course||'Course'} ${row.session.date}: ${check.assignment.name||'Faculty'} - ${assignmentAvailabilityDetail(check.av,row.session.date,row.session.start,row.session.end)}`);
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
    const renderSwap=()=>{
      const outgoing=assignments[selected], outgoingFaculty=facultyForAssignment(outgoing); const outgoingId=String(outgoing?.ucid||outgoingFaculty?.__id||'');
      const credit=swapAssignmentCredit(outgoing);
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
          <div class="swap-current-card"><div class="swap-current-title">Current assignment being removed</div><div class="swap-current-line"><span><strong>${escapeHtml(outgoing?.name||'Unknown')}</strong></span><span>Role: <strong>${escapeHtml(outgoing?.role||s.type||'')}</strong></span><span>Persisted DOE credit: <strong>${credit===null?'Unrated':swapPct(credit)}</strong></span><span>Faculty totals: <strong>Server preview on SWAP</strong></span></div></div>
          <div class="swap-search-row"><label class="form-field"><span class="form-label">Find replacement faculty</span><input class="form-input" id="swap-search" placeholder="Search name, specialty, teaching area, UCID..."></label></div>
          <div class="swap-help">Each candidate checks <strong>both AFC and the live timetable for overlapping courses at this exact date/time</strong>. For privacy, AFC only reports <strong>Unavailable</strong>; AFC reasons and dates are not shown here. DOE current/projected totals are not calculated in the browser: the authoritative server preview runs when you select <strong>SWAP</strong>, before confirmation. A timetable conflict or AFC absence is flagged as unavailable; uncertain records with an unspecified time are marked Check needed.</div>
          <div class="swap-table-wrap"><table class="swap-table"><thead><tr><th>Faculty</th><th>Availability</th><th>DOE</th><th></th></tr></thead><tbody id="swap-candidate-body"></tbody></table></div>
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
          const av=facultyAssignmentAvailability(f,s.date,s.start,s.end,s.id);
          const avHtml=av.available===false?`<span class="availability-pill availability-no">Unavailable</span><div class="availability-detail no">${escapeHtml(assignmentAvailabilityDetail(av,s.date,s.start,s.end))}</div>`:av.available===null?`<span class="availability-pill availability-none">Check needed</span><div class="availability-detail">${escapeHtml(assignmentAvailabilityDetail(av,s.date,s.start,s.end))}</div>`:`<span class="availability-pill availability-ok">Available</span><div class="availability-detail ok">${escapeHtml(assignmentAvailabilityDetail(av,s.date,s.start,s.end))}</div>`;
          return `<tr class="${av.available===false?'swap-unavailable':''}"><td><strong>${escapeHtml(swapFacultyName(f))}</strong><br><span class="form-hint">${escapeHtml(f.teachingArea||f.teachingAreaEmphasis||f.currentTitle||'')} ${f.ucid?`· ${escapeHtml(f.ucid)}`:''}</span></td><td>${avHtml}</td><td><span class="swap-status swap-unknown">Server preview on SWAP</span><div class="form-hint">Current, projected, target and remaining DOE are verified by the DOE API before confirmation.</div></td><td><button class="btn btn-primary btn-swap-confirm" data-swap-faculty="${escapeHtml(f.__id)}">SWAP</button></td></tr>`;
        }).join('')||'<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-3)">No faculty match this search.</td></tr>';
        document.querySelectorAll('[data-swap-faculty]').forEach(btn=>btn.onclick=()=>performFacultySwap(s,assignments,selected,btn.dataset.swapFaculty));
      };
      $('swap-search').oninput=renderCandidates; renderCandidates();
    };
    renderSwap();
  }

  async function performFacultySwap(session,assignments,outIndex,newFacultyId){
    if(!UCVM.admin(currentUser))return;
    const replacement=facultyDirectory.find(f=>String(f.__id)===String(newFacultyId)); if(!replacement)return;
    const outgoing=assignments[outIndex]; if(!outgoing)return;
    const oldFaculty=facultyForAssignment(outgoing),oldName=outgoing.name||swapFacultyName(oldFaculty)||'Unknown',newName=swapFacultyName(replacement),oldCredit=swapAssignmentCredit(outgoing);
    const av=facultyAssignmentAvailability(replacement,session.date,session.start,session.end,session.id);
    const nextAssignments=assignments.map((a,i)=>i===outIndex?{...a,ucid:String(replacement.__id),facultyId:String(replacement.__id),name:newName,category:'Faculty',source:'Admin SWAP',swappedFrom:{ucid:String(outgoing.ucid||oldFaculty?.__id||''),name:oldName},swappedAt:new Date().toISOString()}:a);
    let next={...session,assignments:nextAssignments,facultyIds:nextAssignments.map(a=>String(a.facultyId||a.ucid||'')).filter(Boolean),instructor:nextAssignments.map(a=>a.name).filter(Boolean).join('; '),labDetails:labDetailsFromAssignments(session.type,nextAssignments,session.topic),sourceSystem:'Synchronized live timetable'};
    await ensureSessionsForDates([next.date],true);
    let doeResult,doeRuntime;
    try{doeRuntime=getTimetableDoeRuntime();doeResult=await doeRuntime.adapter.prepareSession(session,next,{trigger:'faculty_swap'});next=doeResult.session}
    catch(error){console.error('[DOE faculty swap calculation]',error);toast(`SWAP blocked: ${error.message||'DOE calculation is unavailable.'}`,true);return}
    const newCredit=swapAssignmentCredit(next.assignments[outIndex]),incomingImpact=(doeResult.facultyImpacts||[]).find(row=>String(row?.facultyId||'')===String(replacement.__id)),currentNew=incomingImpact?.currentAssignedDoe??null,projectedNew=incomingImpact?.projectedAssignedDoe??null;
    const availabilityWarning=av.available===false?`\n\nWARNING: ${newName} is not available for ${session.date} ${session.start||''}-${session.end||''}:\n${assignmentAvailabilityDetail(av,session.date,session.start,session.end)}\n\nAdmin override?`:av.available===null?`\n\nCHECK NEEDED before assigning ${newName}:\n${assignmentAvailabilityDetail(av,session.date,session.start,session.end)}\n\nContinue as admin?`:'';
    if(!confirm(`Swap ${oldName} to ${newName} for ${session.course} - ${session.topic}?\n\n${doeResult.queued?'DOE impact: authoritative recalculation will be queued after save.':newCredit===null?'DOE impact: this activity is unrated.':`DOE credit: ${oldCredit===null?'unrated':oldCredit.toFixed(2)+'%'} → ${newCredit.toFixed(2)}%\n${newName}: ${currentNew===null?'current DOE unavailable':currentNew.toFixed(2)+'%'} → ${projectedNew===null?'projected unavailable':projectedNew.toFixed(2)+'%'}`}${availabilityWarning}`))return;
    const overrides=confirmSchedulingChanges([next]);if(overrides===null)return;
    try{
      const saved=await doeRuntime.api.saveSessionChange({academicYear:doeResult.academicYear||next.academicYear||'',sessionId:session.id,afterSession:next,trigger:'faculty_swap'}),savedNext=saved.session||next,auditChanges=doeAuditChanges(saved.doeChanges||doeResult.doeChanges);
      await db.collection(SESSION_LOG_COLLECTION).doc().set({action:'swap_faculty',override:overrides.get(String(session.id))||null,requestId:'',sessionId:session.id,course:savedNext.course||session.course,date:savedNext.date||session.date,topic:savedNext.topic||session.topic,role:outgoing.role||session.type||'',doeCredit:swapAssignmentCredit(savedNext.assignments?.[outIndex]),oldDoeCredit:oldCredit,doeChanges:saved.doeChanges||doeResult.doeChanges,changes:auditChanges,fromFaculty:{ucid:String(outgoing.ucid||oldFaculty?.__id||''),name:oldName},toFaculty:{ucid:String(replacement.__id),name:newName},toFacultyCurrentAssignedDOE:currentNew,toFacultyProjectedAssignedDOE:projectedNew,changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});
      invalidateAllSessions(); await updateDerivedIndexes([{before:session,after:savedNext}]); closeModal(); toast(saved.queued?`SWAP complete: ${oldName} → ${newName}. DOE recalculation queued.`:`SWAP complete: ${oldName} → ${newName}. Faculty DOE updated.`);
    }catch(err){console.error('[faculty swap]',err);toast(`SWAP failed. ${err.message||'DOE API save is unavailable.'}`,true)}
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
  function isReadOnlySynthetic(session){return Boolean(session?.isCcc||session?.isUniversityClosure)}
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
  function universityClosureRows(start,end){
    if(!showUniversityClosures)return[];
    return closureCalendar.between(start,end).map(entry=>{
      const position=academicPositionForDate(parseYmd(entry.date));
      return{id:`closure-${entry.date}`,date:entry.date,week:position.week,semester:position.semester,year:'',course:'UC',courseName:'University Closed',type:'CLOSURE',topic:entry.name,instructor:'',assignments:[],room:'',start:'07:30',end:'17:00',timeUnknown:false,isUniversityClosure:true,sourceSystem:'UCalgary University Closure Calendar'};
    });
  }
  function sessionsWithOverlays(source,start,end){return [...source,...expandCccEvents(start,end),...universityClosureRows(start,end)]}

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

  function syncSemesterUI() {
    document.querySelectorAll('[data-semester]').forEach(x=>x.classList.toggle('active',x.dataset.semester===semesterScope));
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
      semesterScope=b.dataset.semester;
      if(semesterScope!=='all')selectedSemester=semesterScope;
      syncSemesterUI();
      renderWeekControls();
      refreshSessionScope();
    });
    $('week-mobile-select').addEventListener('change', e => { selectedWeek = Number(e.target.value); syncWeekUI(); refreshSessionScope(); });
    ['search-input','filter-type'].forEach(id => $(id).addEventListener(id === 'search-input' ? 'input' : 'change', render));
    $('reset-filters').addEventListener('click', resetFilters);
    $('cal-prev').addEventListener('click', () => moveCalendar(-1));
    $('cal-next').addEventListener('click', () => moveCalendar(1));
    $('cal-today').addEventListener('click', () => { setInitialAcademicPeriod(); renderWeekControls(); syncWeekUI(); refreshSessionScope(); toast('Moved to the current academic week.'); });
    $('cal-day-btn').addEventListener('click', () => switchCalendarView('day'));
    $('cal-week-btn').addEventListener('click', () => switchCalendarView('week'));
    $('cal-month-btn').addEventListener('click', () => switchCalendarView('month'));
    $('cal-list-btn').addEventListener('click', () => switchCalendarView('list'));
    $('show-ccc').addEventListener('change', async e=>{showCcc=e.target.checked;if(showCcc){try{await loadCccEvents()}catch{e.target.checked=false;showCcc=false}}populateCourseFilter();render()});
    $('show-university-closures').addEventListener('change',e=>{showUniversityClosures=e.target.checked;render()});
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
    $('faculty-dashboard-btn').addEventListener('click', () => { if (UCVM.admin(currentUser)||roleIsFaculty(currentUser)) window.location.href = 'faculty-admin.html'; });
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
    selectedYear = 'all'; selectedSemester = 'fall'; semesterScope='all';
    document.querySelectorAll('[data-year]').forEach(x => x.classList.toggle('active', x.dataset.year === 'all'));
    syncSemesterUI();
    $('search-input').value = ''; $('filter-type').value = 'all';
    selectedCourses.clear(); courseFilterActive=false; showCcc=false; showUniversityClosures=false; $('show-ccc').checked=false; $('show-university-closures').checked=false; populateCourseFilter();
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
    const step=delta<0?-1:1,continuous=semesterScope==='all';
    if(viewMode==='day'){
      if(step>0&&selectedDayIndex<4){selectedDayIndex++;refreshSessionScope();return}
      if(step<0&&selectedDayIndex>0){selectedDayIndex--;refreshSessionScope();return}
      const next=moveAcademicWeekPosition(selectedSemester,selectedWeek,step,continuous);
      if(next.semester===selectedSemester&&next.week===selectedWeek)return;
      selectedSemester=next.semester;selectedWeek=next.week;selectedDayIndex=step>0?0:4;
      syncSemesterUI();renderWeekControls();syncWeekUI();refreshSessionScope();return;
    }
    const next=moveAcademicWeekPosition(selectedSemester,selectedWeek,step,continuous);
    selectedSemester=next.semester;selectedWeek=next.week;
    syncSemesterUI();renderWeekControls();syncWeekUI();refreshSessionScope();
  }

  function filteredSessions(source=sessions, options={}) {
    const q = $('search-input').value.trim().toLowerCase();
    const type = $('filter-type').value;
    return source.filter(s => {
      if(s.isUniversityClosure)return showUniversityClosures;
      if(String(s.type||'').toUpperCase()==='CCC'&&!showCcc)return false;
      if (!options.ignorePeriod && selectedYear !== 'all' && String(s.year) !== selectedYear) return false;
      if (!options.ignorePeriod && semesterScope !== 'all' && s.semester !== semesterScope) return false;
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
    const sorted = items.map(session=>({session,timing:scheduling.validateInterval(session.start,session.end,{timeUnknown:session.timeUnknown===true})}))
      .filter(item=>item.timing.status==='valid')
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

  function unpositionedSessionsHtml(items){
    const rows=items.filter(session=>scheduling.validateInterval(session.start,session.end,{timeUnknown:session.timeUnknown===true}).status!=='valid');
    if(!rows.length)return'';
    return `<section class="untimed-sessions"><h3>Time not confirmed - Check needed</h3>${rows.map(session=>`<button class="btn btn-secondary" data-session-id="${escapeHtml(session.id)}">${escapeHtml(session.date)} - ${escapeHtml(session.course)} - ${escapeHtml(session.topic)}</button>`).join('')}</section>`;
  }

  function timetableBlockCopy(s){
    if(s?.isUniversityClosure)return{line1:'University Closed',line2:s.topic||'University closure',meta:'07:30-17:00 · Institutional closure',sub:''};
    return{line1:`${s.course} - ${s.type}`,line2:s.topic||'',meta:`${s.start}-${s.end}${s.room?` | ${s.room}`:''}`,sub:s.instructor||'TBD'};
  }
  function monthEventCopy(s){
    if(s?.isUniversityClosure)return{line1:'University Closed',line2:s.topic||'University closure'};
    return{line1:`${s.course} ${s.type}`,line2:`${s.timeUnknown?'Time not specified':s.start} ${s.topic||''}`};
  }

  function renderDay() {
    const date=addDays(weekStart(selectedWeek,selectedSemester),selectedDayIndex), dateText=ymd(date);
    $('cal-label').textContent=formatLongDate(date);
    const data=filteredSessions(sessionsWithOverlays(sessions,dateText,dateText)).filter(s=>s.date===dateText);
    renderedSessions=data;
    const DAY_START=450,DAY_END=1020,SPAN=DAY_END-DAY_START,marks=[450,480,540,600,660,720,780,840,900,960,1020];
    let html=`<div class="tg-wrap day-single"><div class="tg-corner"></div><div class="tg-day-head"><div class="week-dow">${DAYS[selectedDayIndex]}</div><div class="week-date">${date.getDate()}</div></div></div><div class="tg-body day-single"><div class="tg-time-axis"><div class="tg-track">`;
    marks.forEach(m=>{const top=((m-DAY_START)/SPAN)*100,h=Math.floor(m/60),min=m%60,h12=((h+11)%12)+1;html+=`<span class="tg-hour-label" style="top:${top}%">${h12}:${String(min).padStart(2,'0')}</span>`});
    html+='</div></div><div class="tg-day-col">';
    marks.forEach(m=>{html+=`<div class="tg-gridline" style="top:${((m-DAY_START)/SPAN)*100}%"></div>`});
    layoutDaySessions(data).forEach(item=>{
      const s=item.session,startM=Math.max(DAY_START,item.startM),endM=Math.min(DAY_END,item.endM);if(endM<=DAY_START||startM>=DAY_END)return;
      const top=((startM-DAY_START)/SPAN)*100,height=Math.max(3.5,((endM-startM)/SPAN)*100),laneWidth=100/item.laneCount,left=item.lane*laneWidth;
      const copy=timetableBlockCopy(s);
      html+=`<div class="tg-block ${colorsOn?sessionTypeClass(s.type):'colors-off'}" data-session-id="${escapeHtml(s.id)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);right:auto;width:calc(${laneWidth}% - 4px)"><div class="tg-block-l1">${escapeHtml(copy.line1)}</div><div class="tg-block-l2">${escapeHtml(copy.line2)}</div><div class="tg-block-l3">${escapeHtml(copy.meta)}${copy.sub?`<br>${escapeHtml(copy.sub)}`:''}</div></div>`;
    });
    html+='</div></div>'+unpositionedSessionsHtml(data);$('calendar-body').innerHTML=html;bindSessionBlocks();
  }

  function renderWeek() {
    const start = weekStart(selectedWeek, selectedSemester); const end = addDays(start, 4);
    $('cal-label').textContent = `${selectedSemester === 'winter' ? 'Winter' : (selectedSemester === 'spring' ? 'Spring' : 'Fall')} Week ${selectedWeek} - ${formatDate(start)} to ${formatDate(end)}, ${end.getFullYear()}`;
    const data = filteredSessions(sessionsWithOverlays(sessions,ymd(start),ymd(end))).filter(s => s.week === selectedWeek);
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
        const copy=timetableBlockCopy(s);
        html += `<div class="tg-block ${colorsOn ? sessionTypeClass(s.type) : 'colors-off'} " data-session-id="${escapeHtml(s.id)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);right:auto;width:calc(${laneWidth}% - 4px)">
          <div class="tg-block-l1">${escapeHtml(copy.line1)}</div>
          <div class="tg-block-l2">${escapeHtml(copy.line2)}</div>
          <div class="tg-block-l3">${escapeHtml(copy.meta)}${copy.sub?`<br>${escapeHtml(copy.sub)}`:''}</div>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    $('calendar-body').innerHTML = html+unpositionedSessionsHtml(data);
    bindSessionBlocks();
  }

  function renderMonth() {
    const range=monthRangeForAcademicPosition(selectedSemester,selectedWeek);
    const first=range.first,last=range.last,month=first.getMonth();
    $('cal-label').textContent = first.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
    let monday = new Date(first);
    const jsDay = monday.getDay();
    const delta = jsDay === 0 ? -6 : 1 - jsDay;
    monday.setDate(monday.getDate() + delta);
    const data = filteredSessions(sessionsWithOverlays(sessions,ymd(first),ymd(last)));
    renderedSessions=data;
    let html = '<div class="cal-month"><div class="cal-dow-header">' + DAYS.map(d => `<div class="cal-dow">${d}</div>`).join('') + '</div><div class="cal-grid">';
    let cursor = new Date(monday);
    while (cursor <= last || cursor.getDay() !== 1) {
      for (let i = 0; i < 5; i++) {
        const cell = addDays(cursor, i); const dateStr = ymd(cell);
        const events = data.filter(s => s.date === dateStr).sort((a,b)=>Number(Boolean(b.isUniversityClosure))-Number(Boolean(a.isUniversityClosure))).slice(0, 4);
        html += `<div class="cal-cell"><div class="cal-date-num">${cell.getDate()}</div><div class="cal-events">`;
        events.forEach(s => {const copy=monthEventCopy(s);html += `<div class="cal-event ${colorsOn ? sessionTypeClass(s.type) : 'colors-off'} " data-session-id="${escapeHtml(s.id)}"><div class="cal-event-l1">${escapeHtml(copy.line1)}</div><div class="cal-event-l2">${escapeHtml(copy.line2)}</div></div>`});
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
    const data=filteredSessions(sessionsWithOverlays(sessions,start,end),{ignorePeriod:true}).filter(s=>s.date>=start).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start||'').localeCompare(String(b.start||''))||String(a.course||'').localeCompare(String(b.course||'')));
    renderedSessions=data;
    const rows=data.map(s=>{const closure=s.isUniversityClosure;return `<tr data-session-id="${escapeHtml(s.id)}"><td>${escapeHtml(s.date)}</td><td>${escapeHtml(s.timeUnknown?'Time TBD':`${s.start||''}-${s.end||''}`)}</td><td><strong>${escapeHtml(closure?'University Closed':s.course)}</strong></td><td>${escapeHtml(closure?'Closure':s.type)}</td><td>${escapeHtml(s.topic)}</td><td>${escapeHtml(closure?'':(s.instructor||'TBD'))}</td><td>${escapeHtml(closure?'':(s.room||''))}</td></tr>`}).join('');
    $('calendar-body').innerHTML=`<div class="schedule-list-wrap"><table class="schedule-list"><thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Type</th><th>Topic</th><th>Faculty</th><th>Room</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty-cell">No future sessions match the selected filters.</td></tr>'}</tbody></table></div>`;
    bindSessionBlocks();
  }

  function bindSessionBlocks() {
    document.querySelectorAll('[data-session-id]').forEach(el => {
      const s=renderedSessions.find(row=>String(row.id)===String(el.dataset.sessionId));
      el.classList.toggle('selection-candidate',selectionMode&&!isReadOnlySynthetic(s));
      el.classList.toggle('selection-selected',sessionSelection.has(el.dataset.sessionId));
      el.addEventListener('click',()=>{
        if(!selectionMode){openSessionDetail(el.dataset.sessionId);return}
        if(isReadOnlySynthetic(s)){toast(s?.isUniversityClosure?'University closure records are read-only institutional calendar entries.':'CCC records are read-only and cannot be selected.',true);return}
        if(!selectionPolicy(s).canSelect){toast('This session is not selectable for the current work context.',true);return}
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
    if(!canSelectSessions())return;
    scopedWork=null;selectionLabRosterDrafts.clear();
    const ordinarySelection=capabilities().canSelectSessions===true;
    if(mayConfigureTeachingAssignmentOwnership())await ensureTeachingAssignmentDirectory();
    if(!ordinarySelection&&UCVM.general(currentUser)&&!canConfigureTeachingAssignmentOwnership()){
      toast('Teaching Assignment ownership configuration is unavailable until its security rules are enabled.',true);return;
    }
    if(capabilities().canEditInstructor)await ensureFacultyDirectory();
    selectionViewFlow.begin(viewMode);
    selectionMode=true;reviewingSelection=false;document.body.classList.add('session-selection-mode');updateSelectionControls();render();
  }
  function cancelSessionSelection(){
    viewMode=selectionViewFlow.finish();selectionMode=false;reviewingSelection=false;scopedWork=null;selectionLabRosterDrafts.clear();sessionSelection.clear();selectedSessionOriginals.clear();document.body.classList.remove('session-selection-mode');updateSelectionControls();setViewButtons();refreshSessionScope();
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
    if(selectionCapabilities().canEditInstructor)await ensureFacultyDirectory();
    if(selectionCapabilities().canEditLabGroups)await ensureLabWorkflowContext();
    if(selectionCapabilities().canEditCourseFields)await loadSubjectOptions();
    reviewingSelection=true;viewMode=selectionViewFlow.review();setViewButtons();render();
  }

  /* Open one session directly in the scoped operational editor.
   *
   * The Work Queue uses this. LAB cannot use unrestricted general selection, so
   * the Select button is hidden for it, but LAB still has to be able to work on
   * the LAB session the queue handed it. This reuses the existing Select Sessions
   * editor: it navigates to the session's week, selects only that session and
   * opens the review view, where editPolicy() locks every field the role does not
   * own. No second session editor is introduced. */
  async function openScopedEditor(sessionId,options={}){
    const id=String(sessionId||'').trim(),stage=String(options.stage||'').trim().toLowerCase();
    if(!id||!['adc','lab','adfa'].includes(stage)||!hasOfficeAccess(stage))return false;
    const find=()=>[...sessionCache.values()].find(row=>String(row.id)===id)||null;
    let target=find();
    const targetDate=String(options.date||target?.date||'').slice(0,10);
    if(targetDate&&!target){
      await ensureSessionsForDates([targetDate]);
      target=find();
    }
    if(!target)return false;
    if(stage==='lab')await ensureLabWorkflowContext();
    const workflow=window.UCVM_SESSION_WORKFLOW,status=workflow?.stageStatus?.(target,stage,workflowContext());
    if(!status||status.status!=='ready')return false;
    if(targetDate){
      const position=academicPositionForDate(parseYmd(targetDate));
      if(position){selectedSemester=position.semester;selectedWeek=position.week}
    }
    if(capabilities(stage).canEditInstructor)await ensureFacultyDirectory();
    scopedWork={sessionId:id,stage};selectionLabRosterDrafts.clear();
    selectionViewFlow.begin(viewMode);
    selectionMode=true;reviewingSelection=false;
    document.body.classList.add('session-selection-mode');
    sessionSelection.clear();selectedSessionOriginals.clear();
    selectedSessionOriginals.set(id,target);
    sessionSelection.toggle(id);
    updateSelectionControls();
    await reviewSelectedSessions();
    return true;
  }

  function selectionFacultyOptions(session){
    const selected=new Set([...(session.facultyIds||[]),...(session.assignments||[]).map(a=>a.ucid||a.facultyId)].filter(Boolean).map(String));
    return facultyDirectory.map(f=>`<label class="selection-faculty-option"><input type="checkbox" data-selection-faculty-option value="${escapeHtml(f.__id)}" ${selected.has(String(f.__id))?'checked':''}><span><strong>${escapeHtml(swapFacultyName(f))}</strong><small>${window.UCVM_DOE_API?.isConfigured?.()?'DOE server preview on save':'DOE recalculation queued after save'}</small></span></label>`).join('');
  }
  function updateSelectionFacultyPicker(picker){
    const checked=[...picker.querySelectorAll('[data-selection-faculty-option]:checked')],summary=picker.querySelector('summary'),chips=picker.nextElementSibling?.classList?.contains('selection-faculty-chips')?picker.nextElementSibling:null;
    if(summary)summary.textContent=checked.length?`${checked.length} faculty selected`:'Choose faculty';
    if(chips)chips.innerHTML=checked.map(input=>{const f=facultyDirectory.find(row=>String(row.__id)===String(input.value));return `<span>${escapeHtml(swapFacultyName(f))}<small>${window.UCVM_DOE_API?.isConfigured?.()?'DOE server preview on save':'DOE recalculation queued after save'}</small></span>`}).join('');
  }
  function selectionLabGroupOptions(session){
    const selected=new Set((session?.labGroupIds||[]).map(String)),course=String(session?.course||'');
    const groups=[...labGroupDirectory.values()].filter(group=>group.active!==false&&(!group.course||String(group.course)===course));
    return groups.map(group=>{const id=String(group.groupId||''),code=String(group.groupCode||id),count=(labRosterDirectory.get(id)?.studentIds||[]).length;return `<label class="selection-faculty-option"><input type="checkbox" data-selection-lab-group-option value="${escapeHtml(id)}" ${selected.has(id)?'checked':''}><span><strong>Group ${escapeHtml(code)}</strong><small>${count} student${count===1?'':'s'} in roster</small></span></label>`}).join('');
  }
  function updateSelectionLabGroupPicker(picker){
    const checked=[...picker.querySelectorAll('[data-selection-lab-group-option]:checked')],summary=picker.querySelector('summary'),chips=picker.nextElementSibling?.classList?.contains('selection-faculty-chips')?picker.nextElementSibling:null;
    if(summary)summary.textContent=checked.length?`${checked.length} LAB group${checked.length===1?'':'s'} selected`:'Choose LAB group';
    if(chips)chips.innerHTML=checked.map(input=>{const group=labGroupDirectory.get(String(input.value));return `<span>Group ${escapeHtml(group?.groupCode||input.value)}</span>`}).join('');
  }
  function captureSelectionLabRosterDrafts(){
    document.querySelectorAll('[data-selection-lab-roster]').forEach(input=>{
      const id=String(input.dataset.selectionLabRoster||'').trim();
      if(id)selectionLabRosterDrafts.set(id,String(input.value||''));
    });
  }
  function selectedLabGroupIdsFromEditor(){
    return[...new Set([...document.querySelectorAll('[data-selection-lab-group-option]:checked')].map(input=>String(input.value||'').trim()).filter(Boolean))];
  }
  function renderSelectionLabRosters(){
    const host=$('selection-lab-rosters');
    if(!host)return;
    captureSelectionLabRosterDrafts();
    const ids=selectedLabGroupIdsFromEditor();
    if(!ids.length){host.innerHTML='<div class="selection-faculty-readonly">Choose at least one LAB group to edit its roster.</div>';return}
    host.innerHTML=`<div class="login-cheatsheet"><strong>LAB group rosters</strong><br>Student IDs stay in the private roster collection and are never copied to the public calendar or session audit.</div>`
      +ids.map(id=>{
        const group=labGroupDirectory.get(id)||{},code=String(group.groupCode||id),existing=labRosterDirectory.get(id)?.studentIds||[];
        const value=selectionLabRosterDrafts.has(id)?selectionLabRosterDrafts.get(id):existing.join('\n');
        return `<label class="form-field"><span class="form-label">Group ${escapeHtml(code)} roster</span><textarea class="form-input" rows="6" spellcheck="false" data-selection-lab-roster="${escapeHtml(id)}" placeholder="One student ID per line">${escapeHtml(value)}</textarea><small>One student ID per line. Invalid or duplicate rows block the save.</small></label>`;
      }).join('');
  }
  function buildSelectionLabRosterPlans(rows,timestamp){
    if(scopedWork?.stage!=='lab'||selectionCapabilities().canEditLabRoster!==true)return{plans:[],errors:[]};
    const api=window.UCVM_LAB_GROUPS;
    if(!api?.parseRoster||!api?.rosterFor)return{plans:[],errors:['LAB roster tools are unavailable. Reload the page before saving.']};
    captureSelectionLabRosterDrafts();
    const row=rows?.[0]||{},ids=[...new Set((row.labGroupIds||[]).map(value=>String(value||'').trim()).filter(Boolean))],errors=[],drafts=new Map();
    for(const id of ids){
      const group=labGroupDirectory.get(id);
      if(!group){errors.push(`LAB group ${id} is unavailable. Reopen the Work Queue item.`);continue}
      const code=String(group.groupCode||id).toUpperCase(),raw=selectionLabRosterDrafts.has(id)?selectionLabRosterDrafts.get(id):(labRosterDirectory.get(id)?.studentIds||[]).join('\n');
      const parsed=api.parseRoster(raw,{defaultGroupCode:code});
      for(const invalid of parsed.invalid||[])errors.push(`Group ${code}, line ${invalid.line}: enter a 6–12 digit student ID.`);
      for(const duplicate of parsed.duplicates||[])errors.push(`Group ${code}, line ${duplicate.line}: duplicate student ID.`);
      for(const entry of parsed.entries||[])if(String(entry.groupCode||'').toUpperCase()!==code)errors.push(`Group ${code}, line ${entry.line}: roster rows in this box must belong to Group ${code}.`);
      const studentIds=(parsed.entries||[]).map(entry=>String(entry.studentId||'').trim()).filter(Boolean);
      if(!studentIds.length)errors.push(`Group ${code}: add at least one student ID before saving.`);
      drafts.set(id,studentIds);
    }
    const course=String(row.course||''),relevant=[...labGroupDirectory.values()].filter(group=>String(group.course||'')===course||ids.includes(String(group.groupId||'')));
    const owners=new Map();
    for(const group of relevant){
      const id=String(group.groupId||''),code=String(group.groupCode||id).toUpperCase(),studentIds=drafts.has(id)?drafts.get(id):(labRosterDirectory.get(id)?.studentIds||[]);
      for(const raw of studentIds){
        const studentId=String(raw||'').trim();if(!studentId)continue;
        const previous=owners.get(studentId);
        if(previous&&previous.id!==id)errors.push(`Student ${studentId} cannot be assigned to both Group ${previous.code} and Group ${code}.`);
        else owners.set(studentId,{id,code});
      }
    }
    const plans=[];
    for(const [id,studentIds] of drafts){
      const before=(labRosterDirectory.get(id)?.studentIds||[]).map(String);
      if(JSON.stringify(before)===JSON.stringify(studentIds))continue;
      plans.push({groupId:id,data:api.rosterFor(id,{studentIds,updatedAt:timestamp,updatedBy:currentUser.uid,updatedByName:currentUser.name||currentUser.email||''})});
    }
    return{plans,errors:[...new Set(errors)]};
  }
  function labRosterAuditChanges(plans=[]){
    return plans.map(plan=>{
      const id=String(plan.groupId||''),group=labGroupDirectory.get(id)||{},code=String(group.groupCode||id),before=(labRosterDirectory.get(id)?.studentIds||[]).length,after=(plan.data?.studentIds||[]).length;
      return{field:'labRoster',label:`LAB roster · Group ${code}`,before:`${before} student${before===1?'':'s'}`,after:`${after} student${after===1?'':'s'}`};
    });
  }
  function selectionRole(){
    if(scopedWork?.stage)return scopedWork.stage;
    const role=UCVM.role(currentUser?.role);
    if(role==='developer')return'developer';
    if(hasOfficeAccess('adc'))return'adc';
    if(UCVM.general(currentUser)&&canConfigureTeachingAssignmentOwnership())return'ta_config';
    return role;
  }
  function selectionCapabilities(){const role=selectionRole();return role==='developer'?capabilities():capabilities(role);}
  function selectionOwnershipAllowed(){
    if(!canConfigureTeachingAssignmentOwnership())return false;
    if(scopedWork)return scopedWork.stage==='adc';
    return['developer','adc','ta_config'].includes(selectionRole());
  }
  function selectionPolicy(session){return window.UCVM_TIMETABLE_SELECTION.editPolicy(selectionRole(),session,{allowTeachingAssignmentOwnership:selectionOwnershipAllowed()});}
  function lockedAttr(enabled){return enabled?'':'disabled class="role-locked-field"';}
  function renderSelectionEditor(){
    if($('calendar-body').querySelector('[data-selection-row]'))return;
    const data=window.UCVM_TIMETABLE_SELECTION.selectedRows([...selectedSessionOriginals.values()],sessionSelection.ids());
    renderedSessions=data;
    $('cal-label').textContent=`Review ${data.length} selected session${data.length===1?'':'s'}`;
    const canEditFaculty=selectionCapabilities().canEditInstructor,canEditLabRoster=scopedWork?.stage==='lab'&&selectionCapabilities().canEditLabRoster===true;
    const rows=data.map(s=>{const policy=selectionPolicy(s),field=name=>lockedAttr(policy.fields[name]);return `<tr data-selection-row data-session-edit-id="${escapeHtml(s.id)}">
      <td><input type="date" data-selection-field="date" value="${escapeHtml(s.date)}" ${field('date')}></td>
      <td><select data-selection-field="year" ${field('year')}>${[1,2,3,4].map(year=>`<option ${Number(s.year)===year?'selected':''}>${year}</option>`).join('')}</select></td>
      <td><input data-selection-field="course" value="${escapeHtml(s.course)}" ${field('course')}></td>
      <td><select data-selection-field="subjectKey" ${field('subjectKey')}>${subjectChoices(s.subjectKey)}</select></td>
      <td><input data-selection-field="type" value="${escapeHtml(s.type)}" ${field('type')}></td>
      <td><input type="time" data-selection-field="start" value="${escapeHtml(s.start)}" ${field('start')}></td>
      <td><input type="time" data-selection-field="end" value="${escapeHtml(s.end)}" ${field('end')}></td>
      <td><input data-selection-field="topic" value="${escapeHtml(s.topic)}" ${field('topic')}></td>
      <td><input data-selection-field="room" value="${escapeHtml(s.room)}" ${field('room')}></td>
      <td>${policy.fields.labGroups?`<details class="selection-faculty-picker selection-lab-group-picker" data-selection-field="labGroups"><summary>Choose LAB group</summary><div class="selection-faculty-menu"><div class="selection-faculty-options">${selectionLabGroupOptions(s)||'<div class="selection-faculty-readonly">No active LAB groups for this course.</div>'}</div></div></details><div class="selection-faculty-chips"></div>`:`<div class="role-locked-field selection-lab-group-readonly">${escapeHtml((s.labGroupIds||[]).join(', ')||'—')}</div>`}</td>
      <td>${policy.fields.faculty?`<details class="selection-faculty-picker" data-selection-field="faculty"><summary>Choose faculty</summary><div class="selection-faculty-menu"><div class="selection-faculty-options">${selectionFacultyOptions(s)}</div></div></details><div class="selection-faculty-chips"></div>`:`<div class="role-locked-field selection-faculty-readonly">${escapeHtml(s.instructor||'TBD')}</div>`}</td>
    </tr>`}).join('');
    const note=canEditFaculty?'Open Faculty to choose one or more people; authoritative DOE is recalculated by the trusted backend after save when the HTTP DOE API is unavailable.':'Grey fields are context only; your office can edit only its assigned fields.';
    $('calendar-body').innerHTML=`<div class="selection-errors hidden" id="selection-errors" role="alert"></div><div class="selection-sheet-wrap"><table class="selection-sheet"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Subject</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>LAB Groups</th><th>Faculty</th></tr></thead><tbody>${rows}</tbody></table></div>${canEditLabRoster?'<div id="selection-lab-rosters" class="selection-lab-rosters"></div>':''}<div class="selection-save-bar"><span>${note}</span><button class="btn btn-secondary" id="selection-back-btn">Back to selection</button><button class="btn btn-primary" id="selection-save-btn">Save selected changes</button></div>`;
    document.querySelectorAll('.selection-faculty-picker:not(.selection-lab-group-picker)').forEach(picker=>{picker.querySelectorAll('[data-selection-faculty-option]').forEach(input=>input.onchange=()=>updateSelectionFacultyPicker(picker));updateSelectionFacultyPicker(picker)});
    document.querySelectorAll('.selection-lab-group-picker').forEach(picker=>{picker.querySelectorAll('[data-selection-lab-group-option]').forEach(input=>input.onchange=()=>{updateSelectionLabGroupPicker(picker);renderSelectionLabRosters()});updateSelectionLabGroupPicker(picker)});
    if(canEditLabRoster)renderSelectionLabRosters();
    $('selection-back-btn').onclick=()=>{const wasScoped=Boolean(scopedWork);reviewingSelection=false;viewMode=selectionViewFlow.finish();setViewButtons();render();refreshSessionScope();if(wasScoped)cancelSessionSelection()};
    $('selection-save-btn').onclick=saveSelectedChanges;
  }
  function readSelectionRows(){
    const originals=new Map([...selectedSessionOriginals].map(([id,row])=>[String(id),row]));
    return [...document.querySelectorAll('[data-selection-row]')].map(tr=>{
      const id=String(tr.dataset.sessionEditId),original=originals.get(id),value=field=>tr.querySelector(`[data-selection-field="${field}"]`).value,policy=selectionPolicy(original);
      const facultyInputs=[...tr.querySelectorAll('[data-selection-faculty-option]:checked')],ids=policy.fields.faculty?facultyInputs.map(option=>String(option.value)):[...(original.facultyIds||[])].map(String);
      const groupInputs=[...tr.querySelectorAll('[data-selection-lab-group-option]:checked')],labGroupIds=policy.fields.labGroups?groupInputs.map(option=>String(option.value)):[...(original.labGroupIds||[])].map(String);
      let type=value('type'),start=value('start'),end=value('end'),topic=value('topic'),date=value('date');
      if(selectionRole()==='adc'&&String(type).toUpperCase()==='LAB'&&String(original.type||'').toUpperCase()!=='LAB')topic='TBD';
      const position=academicPositionForDate(parseYmd(date)),originalIds=[...(original.facultyIds||[]),...(original.assignments||[]).map(a=>a.ucid||a.facultyId)].filter(Boolean).map(String),assignmentChanged=policy.fields.faculty&&(ids.join('|')!==[...new Set(originalIds)].join('|')||type!==String(original.type||'')||start!==String(original.start||'')||end!==String(original.end||'')||topic!==String(original.topic||''));
      const assignments=assignmentChanged?ids.map(facultyId=>{const faculty=facultyDirectory.find(f=>String(f.__id)===facultyId),previous=(original.assignments||[]).find(a=>String(a.ucid||a.facultyId||'')===facultyId)||{},role=previous.role||defaultTeachingRole(type),hours=swapNumeric(previous.creditedHours)??blockHours(start,end,{timeUnknown:original.timeUnknown===true&&start===String(original.start||'')&&end===String(original.end||'')});return{...previous,ucid:facultyId,facultyId,name:swapFacultyName(faculty),role,topic,creditedHours:hours,source:'Multi-session timetable edit'}}):(original.assignments||[]);
      const course=value('course');
      return{...original,id,date,week:position.week,semester:position.semester,year:Number(value('year')),course,courseName:course===String(original.course||'')?original.courseName:(COURSES.find(c=>String(c.code)===course)?.name||''),subjectKey:value('subjectKey'),type,start,end,topic,room:value('room'),timeUnknown:start===String(original.start||'')&&end===String(original.end||'')?Boolean(original.timeUnknown):false,assignments,facultyIds:ids,instructor:assignments.length?assignments.map(a=>a.name).filter(Boolean).join('; '):String(original.instructor||''),labDetails:assignmentChanged?labDetailsFromAssignments(type,assignments,topic):original.labDetails,labGroupIds};
    });
  }
  async function saveSelectedChanges(){
    const activeScoped=typeof scopedWork==='undefined'?null:scopedWork;
    const scoped=activeScoped&&sessionSelection.size===1&&sessionSelection.ids()[0]===activeScoped.sessionId&&hasOfficeAccess(activeScoped.stage);
    if(!canSelectSessions()&&!scoped){toast('Selection permission is required.',true);return}
    const button=$('selection-save-btn'),errorBox=$('selection-errors'),originals=window.UCVM_TIMETABLE_SELECTION.selectedRows([...selectedSessionOriginals.values()],sessionSelection.ids()),canEditFaculty=(typeof selectionCapabilities==='function'?selectionCapabilities():capabilities()).canEditInstructor,facultyById=canEditFaculty?new Map(facultyDirectory.map(f=>[String(f.__id),f])):new Map(),timestamp=firebase.firestore.FieldValue.serverTimestamp();
    const renderedIds=typeof document==='undefined'?sessionSelection.ids().map(String):[...document.querySelectorAll('[data-selection-row]')].map(row=>String(row.dataset.sessionEditId||''));
    if(scoped&&(renderedIds.length!==1||renderedIds[0]!==activeScoped.sessionId)){toast('Scoped Work Queue save is limited to the assigned session.',true);return}
    let rows=readSelectionRows();
    if(scoped&&(rows.length!==1||String(rows[0].id)!==activeScoped.sessionId)){toast('Scoped Work Queue save is limited to the assigned session.',true);return}
    await ensureSessionsForDates(rows.map(row=>row.date),true);
    if(scoped){if(activeScoped.stage==='lab')await ensureLabWorkflowContext(true);const live=[...sessionCache.values()].find(row=>String(row.id)===activeScoped.sessionId),status=window.UCVM_SESSION_WORKFLOW?.stageStatus?.(live,activeScoped.stage,workflowContext());const before=originals[0],keys=['date','year','course','subjectKey','type','start','end','topic','room','assignments','facultyIds','instructor','labGroupIds'];if(!live||!status||status.status!=='ready'){toast('This work item is no longer READY. Reopen it from Work Queue.',true);return}if(keys.some(key=>JSON.stringify(live?.[key]??null)!==JSON.stringify(before?.[key]??null))){toast('This session changed after the Work Queue item was opened. Reopen it before saving.',true);return}}
    const rosterResult=buildSelectionLabRosterPlans(rows,timestamp),rosterPlans=rosterResult.plans,rosterAuditChanges=labRosterAuditChanges(rosterPlans);
    if(rosterResult.errors.length){errorBox.innerHTML=rosterResult.errors.map(error=>`<div>${escapeHtml(error)}</div>`).join('');errorBox.classList.remove('hidden');return}
    const originalById=new Map(originals.map(row=>[String(row.id),row]));
    const selectionOptions={role:selectionRole(),activeSubjectKeys:subjectOptions.map(option=>option.key)};
    const preflight=window.UCVM_TIMETABLE_SELECTION.planChanges(originals,rows,currentUser,timestamp,facultyById,selectionOptions);
    if(preflight.errors.length){errorBox.innerHTML=preflight.errors.map(error=>`<div>${escapeHtml(error)}</div>`).join('');errorBox.classList.remove('hidden');return}
    const subjectOnlyCount=preflight.logs.filter(log=>window.UCVM_TIMETABLE_SELECTION.onlySubjectChanged(log.before,log.after)).length;
    if(canEditFaculty&&subjectOnlyCount&&subjectOnlyCount!==preflight.updates.length){errorBox.textContent='Save Subject-only rows separately from other scheduling or faculty changes.';errorBox.classList.remove('hidden');return}
    const needsDoe=canEditFaculty&&preflight.updates.length>0&&subjectOnlyCount===0;
    const doePrepared=new Map(),doeRuntime=needsDoe?getTimetableDoeRuntime():null;
    if(needsDoe)rows=await Promise.all(rows.map(async row=>{const prepared=await doeRuntime.adapter.prepareSession(originalById.get(String(row.id))||null,row,{trigger:'multi_session_edit'});doePrepared.set(String(row.id),prepared);return prepared.session}));
    const plan=needsDoe?window.UCVM_TIMETABLE_SELECTION.planChanges(originals,rows,currentUser,timestamp,facultyById,selectionOptions):preflight;
    if(rosterAuditChanges.length&&plan.logs.length===1)plan.logs[0].changes=[...(plan.logs[0].changes||[]),...rosterAuditChanges];
    if(needsDoe){
      for(const log of plan.logs){const prepared=doePrepared.get(String(log.sessionId));const changes=doeAuditChanges(prepared?.doeChanges);if(changes.length){log.changes.push(...changes);log.doeChanges=prepared.doeChanges}}
    }
    if(plan.errors.length){errorBox.innerHTML=plan.errors.map(error=>`<div>${escapeHtml(error)}</div>`).join('');errorBox.classList.remove('hidden');return}
    if(!plan.updates.length&&!rosterPlans.length){toast('No selected session or LAB roster values changed.');return}
    if(!plan.updates.length&&rosterPlans.length){
      button.disabled=true;button.textContent='Saving LAB roster...';
      try{
        const batch=db.batch(),row=rows[0]||originals[0]||{};
        for(const roster of rosterPlans)batch.set(db.collection('lab_group_rosters').doc(roster.groupId),roster.data);
        batch.set(db.collection(SESSION_LOG_COLLECTION).doc(),{
          action:'lab_roster_update',override:null,requestId:'',sessionId:String(row.id||activeScoped?.sessionId||''),course:String(row.course||''),date:String(row.date||'').slice(0,10),topic:String(row.topic||''),instructors:[],
          changes:rosterAuditChanges,changedBy:currentUser.uid,changedByName:currentUser.name||currentUser.email||'',changedByEmail:'',changedAt:timestamp
        });
        await batch.commit();
        await ensureLabWorkflowContext(true);
        cancelSessionSelection();
        toast(`${rosterPlans.length} LAB roster${rosterPlans.length===1?'':'s'} saved.`);
      }catch(error){
        console.error('[LAB roster save]',error);
        errorBox.textContent='Nothing was saved. Check the roster values, connection, or permissions, then try again.';
        errorBox.classList.remove('hidden');button.disabled=false;button.textContent='Save selected changes';
      }
      return;
    }
    const overrides=needsDoe?confirmSchedulingChanges(plan.logs.map(log=>({id:log.sessionId,...log.after}))):new Map();if(overrides===null)return;
    for(const log of plan.logs)log.override=overrides.get(String(log.sessionId))||null;
    plan.updates=plan.updates.map(update=>({...update,data:{...firestoreSafeSessionPatch(update.data),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:timestamp}}));
    const resumeComparable=data=>{const copy=JSON.parse(JSON.stringify(data||{}));if(Array.isArray(copy.assignments))for(const assignment of copy.assignments)delete assignment.doeCalculationId;return copy};
    const planKey=JSON.stringify(plan.updates.map(update=>[update.id,resumeComparable(update.data)])),resumeFrom=button.dataset.planKey===planKey?Number(button.dataset.resumeFrom||0):0;
    button.dataset.planKey=planKey;button.disabled=true;button.textContent=resumeFrom?`Resuming ${resumeFrom}/${plan.updates.length}...`:'Saving...';
    try{
      let result;
      if(needsDoe){
        let completedRows=resumeFrom;
        for(let index=resumeFrom;index<plan.updates.length;index++){
          const update=plan.updates[index],log=plan.logs[index];
          try{
            const saved=await doeRuntime.api.saveSessionChange({academicYear:update.after?.academicYear||'',sessionId:update.id,afterSession:update.after,trigger:'multi_session_edit'}),savedAfter=saved.session||update.after;
            await db.collection(SESSION_LOG_COLLECTION).doc().set({...log,after:savedAfter,changes:[...(log.changes||[]).filter(change=>change.field!=='doeCredit'),...doeAuditChanges(saved.doeChanges||[])],doeChanges:saved.doeChanges||[],changedAt:firebase.firestore.FieldValue.serverTimestamp()});
            invalidateAllSessions();await updateDerivedIndexes([{before:log.before,after:savedAfter}],{rethrow:true});
            completedRows=index+1;button.textContent=`Saving ${completedRows}/${plan.updates.length}...`;button.dataset.resumeFrom=String(completedRows);
          }catch(error){error.committed=Boolean(error.committed)||completedRows>index;error.partialCommit=completedRows>0;error.completedRows=completedRows;error.resumeFrom=completedRows;throw error}
        }
        result={committed:true,completedRows,errors:[]};
      }else{
        let rosterWritesStaged=false;
        result=await window.UCVM_TIMETABLE_SELECTION.commitPlan(plan,{batch:()=>db.batch(),sessionRef:id=>db.collection(SESSION_COLLECTION).doc(id),calendarRef:id=>db.collection('calendar_sessions').doc(id),calendarFromSource:(row,id)=>window.UCVM_CALENDAR_SESSION.fromSource(row,id),logRef:()=>db.collection(SESSION_LOG_COLLECTION).doc(),queueRef:()=>db.collection('doe_recalculation_requests').doc(),queueData:(update,log,ref)=>queuedDoeRequestData(update.after||log.after,ref.id,'office_multi_session_edit',update.data.updatedAt||log.changedAt,log.before),stageExtraWrites:rosterPlans.length?({batch})=>{if(rosterWritesStaged)return 0;for(const roster of rosterPlans)batch.set(db.collection('lab_group_rosters').doc(roster.groupId),roster.data);rosterWritesStaged=true;return rosterPlans.length}:null,onProgress:progress=>{button.textContent=`Saving ${progress.completedRows}/${progress.totalRows}...`;button.dataset.resumeFrom=String(progress.completedRows)},afterBatch:async({logs})=>{invalidateAllSessions();if(activeScoped?.stage==='lab'&&rosterPlans.length)await ensureLabWorkflowContext(true);if(selectionRole()==='adc'){for(const log of logs){const before=log.before||{},after=log.after||{};if(String(before.instructor||'').trim()&&['date','start','end'].some(field=>String(before[field]||'')!==String(after[field]||''))){window.dispatchEvent(new CustomEvent('ucvm:assignment-recheck-required',{detail:{sessionId:log.sessionId,course:after.course,date:after.date,start:after.start,end:after.end,type:after.type,topic:after.topic,facultyDisplayName:after.instructor||before.instructor||''}}))}}}}},{chunkSize:SESSION_SAVE_BATCH_ROWS,resumeFrom});
      }
      const count=result.completedRows;delete button.dataset.resumeFrom;delete button.dataset.planKey;cancelSessionSelection();toast(`${count} session${count===1?'':'s'} updated with audit history${rosterPlans.length?` and ${rosterPlans.length} LAB roster${rosterPlans.length===1?'':'s'} saved`:''}.`);
    }catch(error){console.error('[multi-session save]',error);const completed=Number(error.completedRows||0);button.dataset.resumeFrom=String(completed);errorBox.textContent=completed?`${completed} of ${plan.updates.length} sessions were saved. The remaining rows were not saved. Check the connection or permissions, then click Resume save.`:error.committed?'The first batch was saved, but follow-up maintenance failed. Keep this review open and ask an administrator to verify indexes.':'Nothing was saved. Check your connection and permissions, then try again.';errorBox.classList.remove('hidden');button.disabled=false;button.textContent=completed?'Resume save':'Save selected changes'}
  }

  function openSessionDetail(id) {
    const s = renderedSessions.find(x => x.id === id) || sessions.find(x => x.id === id); if (!s) return;
    if(s.isUniversityClosure){
      showModal(`
        <div class="modal-header"><div class="modal-title">University Closed - ${escapeHtml(s.topic)}</div><div class="modal-subtitle">${formatLongDate(parseYmd(s.date))}</div></div>
        <div class="modal-body"><div class="login-cheatsheet"><strong>University Closure — read-only institutional calendar record</strong><br><br>${escapeHtml(s.topic)}<br>07:30-17:00 timetable display block<br><strong>Source:</strong> UCalgary University Closure Calendar</div></div>
        <div class="modal-footer"><span></span><button class="btn btn-secondary" id="detail-close">Close</button></div>`);
      $('detail-close').onclick=closeModal;
      return;
    }
    const edit = !isReadOnlySynthetic(s)&&canEdit() ? `<button class="btn btn-primary" id="detail-edit">Edit Session</button>` : '';
    const swap = !isReadOnlySynthetic(s)&&isAdmin() ? `<button class="btn btn-primary" id="detail-swap">SWAP Faculty</button>` : '';
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
  function blockHours(start,end,options={}){return scheduling.durationHours(start,end,options)}
  function reconcileAssignments(existing,namesText,type,start,end,topic){const names=splitInstructorNames(namesText),old=Array.isArray(existing)?existing:[];return names.map((name,i)=>{let prev=old.find(x=>String(x.name||'').toLowerCase()===name.toLowerCase())||old[i]||{};const role=prev.role||defaultTeachingRole(type);const h=swapNumeric(prev.creditedHours)??blockHours(start,end);return {...prev,ucid:prev.ucid||null,name,topic:prev.topic||topic,role,creditedHours:h,source:'Live timetable edit'}})}
  function finalizeInstructorAssignments(rows,type,start,end,topic,options={}){return (Array.isArray(rows)?rows:[]).filter(a=>String(a?.name||'').trim()).map(a=>{const role=a.role||defaultTeachingRole(type);const h=swapNumeric(a.creditedHours)??blockHours(start,end,options);const out={...a,ucid:a.ucid||null,name:String(a.name||'').trim(),topic:a.topic||topic,role,creditedHours:h,source:'Live timetable edit'};delete out.__editorKey;return out})}
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
    const canEditFaculty=capabilities().canEditInstructor,actorRole=UCVM.role(currentUser?.role);
    const courseOptions=[...new Set([...courseCodes(),'CCC'])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    host.innerHTML=bulkRows.map((row,index)=>{const labLocked=actorRole==='adc'&&String(row.type||'').toUpperCase()==='LAB';return `<tr data-bulk-row="${index}">
      <td><input class="bulk-date" data-bulk-field="date" data-index="${index}" type="date" value="${escapeHtml(row.date)}"></td>
      <td><select data-bulk-field="year" data-index="${index}">${bulkSelectOptions(['1','2','3','4'],row.year)}</select></td>
      <td><select data-bulk-field="course" data-index="${index}">${bulkSelectOptions(courseOptions,row.course)}</select></td>
      <td><select data-bulk-field="type" data-index="${index}">${bulkSelectOptions(['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam','CCC'],row.type)}</select></td>
      <td><input data-bulk-field="start" data-index="${index}" type="time" value="${escapeHtml(row.start)}"></td>
      <td><input data-bulk-field="end" data-index="${index}" type="time" value="${escapeHtml(row.end)}"></td>
      <td><input class="bulk-topic ${labLocked?'role-locked-field':''}" data-bulk-field="topic" data-index="${index}" value="${escapeHtml(labLocked?'TBD':row.topic)}" placeholder="Session topic" ${labLocked?'disabled':''}></td>
      <td><input data-bulk-field="room" data-index="${index}" value="${escapeHtml(row.room)}" placeholder="Room"></td>
      <td><input class="bulk-faculty ${canEditFaculty?'':'role-locked-field'}" data-bulk-field="faculty" data-index="${index}" value="${escapeHtml(canEditFaculty?row.faculty:'')}" list="bulk-faculty-list" placeholder="${canEditFaculty?'Name, email or UCID; separate with ;':'Instructor assignment is managed by ADFA'}" ${canEditFaculty?'':'disabled'}></td>
      <td><button type="button" class="bulk-remove" data-bulk-remove="${index}" aria-label="Remove row ${index+1}">×</button></td>
    </tr>`}).join('');
    $('bulk-row-count').textContent=`${bulkRows.length} / ${MAX_BULK_SESSION_ROWS} rows`;
    host.querySelectorAll('[data-bulk-field]').forEach(input=>{const event=input.tagName==='SELECT'?'change':'input';input.addEventListener(event,()=>{const row=bulkRows[Number(input.dataset.index)];if(!row)return;row[input.dataset.bulkField]=input.value;if(input.dataset.bulkField==='course'&&input.value==='CCC'){row.type='CCC';if(!row.topic)row.topic='CCC Day';renderBulkRows();return}if(input.dataset.bulkField==='type'&&actorRole==='adc'&&String(row.type||'').toUpperCase()==='LAB'){row.topic='TBD';row.faculty='';renderBulkRows()}})});
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
    const errors=[],warnings=[],prepared=[],canEditFaculty=capabilities().canEditInstructor,actorRole=UCVM.role(currentUser?.role);
    if(!rows.length)errors.push('Add at least one row.');
    if(rows.length>MAX_BULK_SESSION_ROWS)errors.push(`A maximum of ${MAX_BULK_SESSION_ROWS} rows can be prepared at once.`);
    rows.forEach((row,index)=>{
      const n=index+1,date=String(row.date||''),course=String(row.course||'').trim(),type=String(row.type||'').trim(),start=String(row.start||''),end=String(row.end||''),year=Number(row.year);
      const topic=actorRole==='adc'&&type.toUpperCase()==='LAB'?'TBD':String(row.topic||'').trim();
      if(!scheduling.normalizeDate(date))errors.push(`Row ${n}: enter a valid date.`);
      if(![1,2,3,4].includes(year))errors.push(`Row ${n}: year must be 1–4.`);
      if(!course)errors.push(`Row ${n}: course is required.`);if(!type)errors.push(`Row ${n}: type is required.`);if(!topic)errors.push(`Row ${n}: topic is required.`);
      if(scheduling.validateInterval(start,end).status!=='valid')errors.push(`Row ${n}: end time must be after start time.`);
      const resolved=canEditFaculty?resolveBulkFaculty(row.faculty,n):{assignments:[],errors:[]};errors.push(...resolved.errors);
      const assignments=canEditFaculty?finalizeInstructorAssignments(resolved.assignments,type,start,end,topic):[];
      if(canEditFaculty)for(const assignment of assignments){const faculty=facultyDirectory.find(f=>String(f.__id)===String(assignment.ucid||''));if(!faculty)continue;const availability=facultyAssignmentAvailability(faculty,date,start,end,'');if(availability.available!==true)warnings.push(`Row ${n} · ${assignment.name}: ${assignmentAvailabilityDetail(availability,date,start,end)}`)}
      if(!errors.some(message=>message.startsWith(`Row ${n}:`))){const pos=academicPositionForDate(parseYmd(date));prepared.push({date,week:pos.week,semester:pos.semester,year,course,courseName:course==='CCC'?'Away from Campus':(COURSES.find(c=>String(c.code)===course)?.name||''),type:course==='CCC'?'CCC':type,topic,instructor:assignments.map(a=>a.name).join('; '),room:String(row.room||'').trim(),start,end,assignments,labDetails:labDetailsFromAssignments(type,assignments,topic),sourceSystem:'Bulk live timetable entry'})}
    });
    return {errors,warnings,sessions:prepared};
  }
  async function saveBulkSessions(rows,options={}){
    await ensureSessionsForDates(rows.map(row=>row.date),true);
    const result=validateBulkRows(rows),errorBox=$('bulk-errors'),canEditFaculty=capabilities().canEditInstructor;
    if(result.errors.length){errorBox.textContent=result.errors.join('\n');errorBox.classList.remove('hidden');document.querySelectorAll('[data-bulk-row]').forEach((tr,index)=>tr.classList.toggle('bulk-row-error',result.errors.some(message=>message.startsWith(`Row ${index+1}:`))));return{saved:false,completedRows:0,totalRows:rows.length}}
    let prepared=result.sessions.map((session,index)=>({id:rows[index].__sessionId||(rows[index].__sessionId=db.collection(SESSION_COLLECTION).doc().id),...session}));
    const doePrepared=new Map(),doeRuntime=canEditFaculty?getTimetableDoeRuntime():null;
    if(canEditFaculty)prepared=await Promise.all(prepared.map(async session=>{const result=await doeRuntime.adapter.prepareSession(null,session,{trigger:'session_created'});doePrepared.set(String(session.id),result);return result.session}));
    const resumeFrom=Math.max(0,Math.min(Number(options.resumeFrom)||0,prepared.length));
    const pendingMaintenanceIds=[...new Set((Array.isArray(options.pendingMaintenanceIds)?options.pendingMaintenanceIds:[]).map(id=>String(id||'').trim()).filter(Boolean))];
    let completedRows=resumeFrom;
    if(canEditFaculty&&pendingMaintenanceIds.length){
      try{await Promise.all(pendingMaintenanceIds.map(async id=>{const snap=await db.collection(SESSION_COLLECTION).doc(id).get();if(!snap.exists)throw Error(`Committed session ${id} could not be reloaded for index maintenance.`);return snap.id}));await UCVM_INDEX_MAINTENANCE.refreshCoreDerivedIndexes(db,currentUser||{})}
      catch(error){error.committed=true;error.partialCommit=true;error.completedRows=completedRows;error.resumeFrom=completedRows;error.totalRows=prepared.length;error.pendingMaintenanceIds=pendingMaintenanceIds;throw error}
      if(typeof options.onMaintenanceComplete==='function')options.onMaintenanceComplete({ids:pendingMaintenanceIds,completedRows,totalRows:prepared.length});
    }
    const remaining=prepared.slice(resumeFrom),overrides=canEditFaculty&&remaining.length?confirmSchedulingChanges(remaining):new Map();if(overrides===null)return{saved:false,completedRows,totalRows:prepared.length,cancelled:true};
    if(canEditFaculty){
      const savedSessions=prepared.slice(0,resumeFrom);
      for(let index=resumeFrom;index<prepared.length;index++){
        const next=prepared[index],preview=doePrepared.get(String(next.id));
        let saved;
        try{saved=await doeRuntime.api.saveSessionChange({academicYear:preview?.academicYear||next.academicYear||'',sessionId:next.id,afterSession:next,trigger:'session_created'})}
        catch(error){error.completedRows=completedRows;error.resumeFrom=completedRows;error.totalRows=prepared.length;throw error}
        const savedNext=saved.session||next,doeChanges=doeAuditChanges(saved.doeChanges||[]);
        try{await db.collection(SESSION_LOG_COLLECTION).doc().set({action:'create',override:overrides.get(String(next.id))||null,sessionId:next.id,course:savedNext.course,date:savedNext.date,topic:savedNext.topic,instructors:(savedNext.assignments||[]).map(a=>({ucid:a.ucid||null,name:a.name,role:a.role,doeCredit:a.doeCredit??null,doePolicyVersionId:a.doePolicyVersionId||'',doeCalculationId:a.doeCalculationId||''})),changes:[{field:'session',label:'Session',before:null,after:[savedNext.course,savedNext.date,savedNext.start+'-'+savedNext.end,savedNext.topic].filter(Boolean).join(' · ')},...doeChanges],doeChanges:saved.doeChanges||[],changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()})}
        catch(error){error.committed=true;error.partialCommit=true;error.completedRows=index+1;error.resumeFrom=index+1;error.totalRows=prepared.length;error.pendingMaintenanceIds=[String(savedNext.id||next.id)];throw error}
        completedRows=index+1;invalidateAllSessions();
        try{await updateDerivedIndexes([{before:null,after:savedNext}],{rethrow:true})}
        catch(error){error.committed=true;error.partialCommit=true;error.completedRows=completedRows;error.resumeFrom=completedRows;error.totalRows=prepared.length;error.pendingMaintenanceIds=[String(savedNext.id||next.id)];throw error}
        savedSessions[index]=savedNext;if(typeof options.onProgress==='function')options.onProgress({completedRows,totalRows:prepared.length});
      }
      prepared=savedSessions;
    }else{
      for(let start=resumeFrom;start<prepared.length;start+=SESSION_SAVE_BATCH_ROWS){
        const end=Math.min(start+SESSION_SAVE_BATCH_ROWS,prepared.length),batch=db.batch();
        for(let index=start;index<end;index++){
          const next=prepared[index],sourceRef=db.collection(SESSION_COLLECTION).doc(next.id),calendarRef=db.collection(CALENDAR_SESSION_COLLECTION).doc(next.id),logRef=db.collection(SESSION_LOG_COLLECTION).doc();
          batch.set(sourceRef,{...firestoreSafeSession({...next,assignments:[],instructor:''}),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
          batch.set(calendarRef,window.UCVM_CALENDAR_SESSION.fromSource(next,next.id));
          batch.set(logRef,{action:'create',override:null,sessionId:next.id,course:next.course,date:next.date,topic:next.topic,instructors:[],changes:[{field:'session',label:'Session',before:null,after:[next.course,next.date,next.start+'-'+next.end,next.topic].filter(Boolean).join(' · ')}],doeChanges:[],changedBy:currentUser.uid,changedByName:currentUser.name,changedAt:firebase.firestore.FieldValue.serverTimestamp()});
        }
        try{await batch.commit()}catch(error){error.completedRows=completedRows;error.resumeFrom=completedRows;error.totalRows=prepared.length;throw error}
        completedRows=end;invalidateAllSessions();if(typeof options.onProgress==='function')options.onProgress({completedRows,totalRows:prepared.length});
      }
    }
    return{saved:true,completedRows,totalRows:prepared.length,sessions:prepared};
  }
  async function openBulkSessionForm(){
    if(!canAddSessions()){toast('This account cannot add timetable sessions.',true);return}
    if(!liveScheduleAvailable()){toast('The live Firestore timetable is unavailable.',true);return}
    const canEditFaculty=capabilities().canEditInstructor;if(canEditFaculty)await ensureFacultyDirectory();bulkRows=[blankBulkRow()];
    const facultyOptions=canEditFaculty?facultyDirectory.map(f=>`<option value="${escapeHtml(swapFacultyName(f))}">${escapeHtml([f.email,f.ucid||f.__id].filter(Boolean).join(' · '))}</option>`).join(''):'';
    showModal(`<div class="modal-header"><div class="modal-title">Add Multiple Live Sessions</div><div class="modal-subtitle">Prepare up to 200 rows. Saving runs in small verified batches; each row keeps the source session, sanitized calendar copy and audit record together. If a later batch fails, completed batches remain saved and you can resume.</div></div><form id="bulk-session-form"><div class="modal-body">
      <div class="bulk-toolbar"><button type="button" class="btn btn-secondary" id="bulk-add-row">+ Add row</button><button type="button" class="btn btn-secondary" id="bulk-duplicate-row">Duplicate last row</button><button type="button" class="btn btn-secondary" id="bulk-paste-rows">Paste Excel rows</button><span class="bulk-count" id="bulk-row-count"></span></div>
      <div class="bulk-paste-panel hidden" id="bulk-paste-panel"><label class="form-label" for="bulk-paste-text">Paste columns: Date, Year, Course, Type, Start, End, Topic, Room, Faculty</label><textarea id="bulk-paste-text" placeholder="2026-09-14&#9;1&#9;CCC&#9;CCC&#9;07:30&#9;17:00&#9;CCC Day&#9;&#9;Faculty Name"></textarea><div><button type="button" class="btn btn-primary" id="bulk-paste-apply">Add pasted rows</button></div></div>
      <datalist id="bulk-faculty-list">${facultyOptions}</datalist><div class="bulk-sheet-wrap"><table class="bulk-sheet"><thead><tr><th>Date</th><th>Year</th><th>Course</th><th>Type</th><th>Start</th><th>End</th><th>Topic</th><th>Room</th><th>Faculty</th><th></th></tr></thead><tbody id="bulk-session-body"></tbody></table></div><div class="bulk-errors hidden" id="bulk-errors"></div>
    </div><div class="modal-footer"><span class="form-hint">Maximum 200 rows. ${canEditFaculty?'Faculty may be separated with semicolons.':'Faculty assignment is handled by ADFA.'}</span><div><button type="button" class="btn btn-secondary" id="bulk-cancel">Cancel</button> <button class="btn btn-primary" type="submit">Save all sessions</button></div></div></form>`);
    document.querySelector('#modal .modal-box')?.classList.add('bulk-wide');renderBulkRows();
    $('bulk-add-row').onclick=()=>{if(bulkRows.length>=MAX_BULK_SESSION_ROWS){toast(`Maximum ${MAX_BULK_SESSION_ROWS} rows.`,true);return}bulkRows.push(blankBulkRow(bulkRows.at(-1)||{}));renderBulkRows()};
    $('bulk-duplicate-row').onclick=()=>{if(bulkRows.length>=MAX_BULK_SESSION_ROWS){toast(`Maximum ${MAX_BULK_SESSION_ROWS} rows.`,true);return}bulkRows.push(blankBulkRow({...bulkRows.at(-1),date:bulkRows.at(-1)?.date}));renderBulkRows()};
    $('bulk-paste-rows').onclick=()=>$('bulk-paste-panel').classList.toggle('hidden');
    $('bulk-paste-apply').onclick=()=>{const parsed=parseBulkPaste($('bulk-paste-text').value);if(!parsed.length){toast('No tab-separated rows found.',true);return}const first=bulkRows.length===1&&Object.values(bulkRows[0]).filter(Boolean).length<=8?[]:bulkRows;bulkRows=[...first,...parsed].slice(0,MAX_BULK_SESSION_ROWS);renderBulkRows();$('bulk-paste-panel').classList.add('hidden')};
    $('bulk-cancel').onclick=closeModal;$('bulk-session-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter,resumeFrom=Number(button.dataset.resumeFrom)||0;let pendingMaintenanceIds=[];try{pendingMaintenanceIds=JSON.parse(button.dataset.pendingMaintenanceIds||'[]')}catch{pendingMaintenanceIds=[]}button.disabled=true;button.textContent=`Saving ${resumeFrom}/${bulkRows.length}...`;try{const result=await saveBulkSessions(bulkRows,{resumeFrom,pendingMaintenanceIds,onMaintenanceComplete:()=>{delete button.dataset.pendingMaintenanceIds},onProgress:progress=>{button.dataset.resumeFrom=String(progress.completedRows);button.textContent=`Saving ${progress.completedRows}/${progress.totalRows}...`}});if(result.saved){delete button.dataset.pendingMaintenanceIds;closeModal();toast(`${result.totalRows} live sessions added.`);return}button.disabled=false;button.textContent='Save all sessions'}catch(error){console.error('[bulk session save]',error);const completed=Number(error.completedRows||0),pending=Array.isArray(error.pendingMaintenanceIds)?error.pendingMaintenanceIds.filter(Boolean):[];button.dataset.resumeFrom=String(completed);if(pending.length)button.dataset.pendingMaintenanceIds=JSON.stringify(pending);else delete button.dataset.pendingMaintenanceIds;$('bulk-errors').textContent=pending.length?`${completed} of ${bulkRows.length} sessions were saved, but follow-up index maintenance failed. Click Resume save to repair the index first; saved rows will not be written again.`:completed?`${completed} of ${bulkRows.length} sessions were saved. The remaining rows were not saved. Check the connection or permissions, then click Resume save.`:'Nothing was saved. Check Firestore permissions and try again.';$('bulk-errors').classList.remove('hidden');button.disabled=false;button.textContent=completed?'Resume save':'Save all sessions'}};
  }

  async function openSessionForm(existing = null) {
    const access=capabilities(),canEditInstructor=access.canEditInstructor,canEditCourseFields=access.canEditCourseFields,actorRole=UCVM.role(currentUser?.role);
    if (existing ? !(canEditCourseFields||canEditInstructor) : !canAddOneSession()) { toast('This account cannot use the single-session editor.', true); return; }
    if (!liveScheduleAvailable()) { toast('The live Firestore timetable is unavailable. Sync it from Faculty Dashboard first.', true); return; }
    if(canEditInstructor)await ensureFacultyDirectory();
    if(canEditCourseFields)await loadSubjectOptions();
    const s = existing || {
      id: '', date: ymd(weekStart(selectedWeek, selectedSemester)), week: selectedWeek, semester:selectedSemester, year:1,
      course:'200', type:'LEC', topic:'New Session', instructor:'', room:'', start:'09:00', end:'10:00', assignments:[]
    };
    let editorAssignments=sessionAssignmentsForSwap(s).map((a,i)=>({...a,__editorKey:`existing-${i}-${Date.now()}`}));
    if(!editorAssignments.length&&canEditInstructor) editorAssignments=[];
    const initialEditorAssignments=JSON.stringify(editorAssignments);
    const renderInstructorEditor=()=>{
      const host=$('instructor-lines'); if(!host)return;
      const isAdmin=canEditInstructor;
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
        <div class="form-field"><label class="form-label" for="subjectKey">Subject</label><select class="form-select" id="subjectKey" name="subjectKey" ${canEditCourseFields?'':'disabled'}>${subjectChoices(s.subjectKey)}</select></div>
        ${select('type','Type',['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam'],s.type)}
        ${input('start','Start','time',s.start,'',!s.timeUnknown)}
        ${input('end','End','time',s.end,'',!s.timeUnknown)}
        ${input('topic','Topic','text',s.topic,'full')}
        <div class="form-field instructor-editor"><label class="form-label">Instructor(s)</label><div id="instructor-lines" class="instructor-lines"></div>${canEditInstructor?'<button type="button" class="btn btn-secondary instructor-add" id="add-instructor-line">+ Add instructor</button><div class="instructor-note">One instructor per line. Select from the active faculty directory. Availability checks both Away from Campus and overlapping live timetable courses at the selected date and time. AFC only reports Unavailable; timetable conflicts continue to show the conflicting course/time. Unavailable or uncertain selections show a warning; admins may override. Add/remove controls are administrator-only. Existing teaching role and DOE credit stay with the line when you change the selected faculty.</div>':'<div class="instructor-note">Instructor assignments are managed by ADFA.</div>'}</div>
        ${input('room','Room','text',s.room)}
      </div></div>
      <div class="modal-footer"><div>${existing ? '<button type="button" class="btn-danger-text" id="delete-session">Delete Session</button>' : ''}</div><div><button type="button" class="btn btn-secondary" id="cancel-session">Cancel</button> <button class="btn btn-primary" type="submit">Save Live Session</button></div></div>
      </form>`);
    renderInstructorEditor();
    const syncTopicOwnership=()=>{if(actorRole!=='adc')return;const topicInput=$('topic'),typeInput=$('type');if(!topicInput||!typeInput)return;const isLab=String(typeInput.value||'').toUpperCase()==='LAB';if(isLab)topicInput.value='TBD';topicInput.readOnly=isLab;topicInput.classList.toggle('role-locked-field',isLab)};
    // The same canonical capabilities that drive the selection editor drive this
    // modal. ADFA is faculty-only, so every scheduling field is locked here too
    // rather than left editable.
    const lockSchedulingFields=()=>{
      if(canEditCourseFields)return;
      for(const id of ['date','year','course','subjectKey','type','start','end','topic','room']){const el=$(id);if(!el)continue;el.disabled=true;el.classList.add('role-locked-field')}
    };
    lockSchedulingFields();
    syncTopicOwnership();if($('type'))$('type').addEventListener('change',syncTopicOwnership);
    for(const id of ['date','start','end']){if($(id)){ $(id).addEventListener('change',renderInstructorEditor); $(id).addEventListener('input',renderInstructorEditor); }}
    if($('add-instructor-line')) $('add-instructor-line').onclick=()=>{
      const type=$('type')?.value||s.type,start=$('start')?.value||s.start,end=$('end')?.value||s.end,topic=$('topic')?.value||s.topic;
      const role=defaultTeachingRole(type),h=blockHours(start,end);
      editorAssignments.push({__editorKey:`new-${Date.now()}-${Math.random()}`,ucid:null,name:'Other / Unassigned',topic,role,creditedHours:h,source:'Live timetable edit'});renderInstructorEditor();
    };
    $('cancel-session').onclick = closeModal;
    if ($('delete-session')) $('delete-session').onclick = () => deleteSession(existing.id);
    $('session-form').onsubmit = async e => {
      e.preventDefault();
      const form = new FormData(e.target), date=String(form.get('date')||'');
      const topic=String(form.get('topic')||'').trim(), type=String(form.get('type')||'').trim(), start=String(form.get('start')||''), end=String(form.get('end')||'');
      const timeUnknown=existing?.timeUnknown===true&&start===String(existing.start||'')&&end===String(existing.end||'');
      const subjectKey=canEditCourseFields?String(form.get('subjectKey')||''):String(existing?.subjectKey||'');
      if(subjectKey!==String(existing?.subjectKey||'')&&subjectKey&&(!window.UCVM_SUBJECT_CATALOG||window.UCVM_SUBJECT_CATALOG.normalizeKey(subjectKey)!==subjectKey||!subjectOptions.some(option=>option.key===subjectKey))){toast('Choose an active Subject from the catalog.',true);return}
      if(!scheduling.normalizeDate(date)||!String(form.get('course')||'').trim()||!type||!topic||scheduling.validateInterval(start,end,{timeUnknown}).status==='invalid'){toast('Enter a valid date, course, type, topic and time range.',true);return;}
      await ensureSessionsForDates([date],true);
      const pos = academicPositionForDate(parseYmd(date));
      const assignments=canEditInstructor?finalizeInstructorAssignments(editorAssignments,type,start,end,topic,{timeUnknown}):[];
      const preservedInstructor=canEditInstructor?assignments.map(a=>a.name).join('; '):String(existing?.instructor||'');
      let next = {
        id: existing?.id || `S${Date.now()}`,
        ...(existing?.auditEventId ? {auditEventId: existing.auditEventId} : {}),
        date, week:pos.week, semester:pos.semester, year:Number(form.get('year')),
        course:form.get('course'), courseName:(COURSES.find(c=>String(c.code)===String(form.get('course')))||{}).name||existing?.courseName||'', ...((subjectKey||existing?.subjectKey!==undefined)?{subjectKey}:{}), type, topic, instructor:preservedInstructor, room:form.get('room'),
        start, end, timeUnknown, assignments:canEditInstructor?assignments:(existing?.assignments||[]), ...(Array.isArray(existing?.labGroupIds)?{labGroupIds:existing.labGroupIds}:{}), ...(canEditInstructor?{labDetails:labDetailsFromAssignments(type,assignments,topic)}:{}), sourceSystem:'Synchronized live timetable'
      };
      const subjectOnly=Boolean(existing)&&JSON.stringify(editorAssignments)===initialEditorAssignments&&
        window.UCVM_TIMETABLE_SELECTION.onlySubjectChanged(existing,{...next,assignments:existing.assignments,
          facultyIds:existing.facultyIds,instructor:existing.instructor,labDetails:existing.labDetails,labGroupIds:existing.labGroupIds});
      if(subjectOnly)next={...existing,subjectKey};
      const needsDoe=canEditInstructor&&!subjectOnly;
      let doeResult={calculationRecords:[],doeChanges:[]},doeRuntime=null;
      if(needsDoe){
        try{doeRuntime=getTimetableDoeRuntime();doeResult=await doeRuntime.adapter.prepareSession(existing||null,next,{trigger:existing?'session_updated':'session_created'});next=doeResult.session}
        catch(error){console.error('[DOE timetable calculation]',error);toast(`Session save blocked: ${error.message||'DOE calculation is unavailable.'}`,true);return}
      }
      const overrides=needsDoe?confirmSchedulingChanges([next]):new Map();if(overrides===null)return;
      try {
        const timestamp=firebase.firestore.FieldValue.serverTimestamp();
        let savedNext=next;
        if(needsDoe){
          const saved=await doeRuntime.api.saveSessionChange({academicYear:doeResult.academicYear||next.academicYear||'',sessionId:next.id,afterSession:next,trigger:existing?'session_updated':'session_created'});
          savedNext=saved.session||next;
          const auditChanges=[...UCVM_AUDIT_DETAILS.diff(existing,savedNext,'session'),...doeAuditChanges(saved.doeChanges||[])];
          await db.collection(SESSION_LOG_COLLECTION).doc().set({action:existing?'update':'create',override:overrides.get(String(next.id))||null,sessionId:next.id,course:savedNext.course,date:savedNext.date,topic:savedNext.topic,instructors:(savedNext.assignments||[]).map(a=>({ucid:a.ucid||null,name:a.name,role:a.role,doeCredit:a.doeCredit??null,doePolicyVersionId:a.doePolicyVersionId||'',doeCalculationId:a.doeCalculationId||''})),changes:auditChanges,doeChanges:saved.doeChanges||[],changedBy:currentUser.uid,changedByName:currentUser.name,changedByEmail:currentUser.email||'',changedAt:timestamp});
        }else{
          const ref=db.collection(SESSION_COLLECTION).doc(next.id),calendarRef=db.collection(CALENDAR_SESSION_COLLECTION).doc(next.id),batch=db.batch();
          if(existing)batch.update(ref,{date:next.date,week:next.week,semester:next.semester,year:next.year,course:next.course,courseName:next.courseName,...(subjectKey!==String(existing.subjectKey||'')?{subjectKey}:{}),type:next.type,topic:next.topic,room:next.room,start:next.start,end:next.end,timeUnknown:next.timeUnknown,updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:timestamp});
          else batch.set(ref,{...firestoreSafeSession({...next,assignments:[],instructor:''}),updatedBy:currentUser.uid,updatedByName:currentUser.name,updatedAt:timestamp});
          batch.set(calendarRef,window.UCVM_CALENDAR_SESSION.fromSource(next,next.id));
          batch.set(db.collection(SESSION_LOG_COLLECTION).doc(),{action:existing?'update':'create',override:null,sessionId:next.id,course:next.course,date:next.date,topic:next.topic,instructors:[],changes:UCVM_AUDIT_DETAILS.diff(existing,next,'session'),doeChanges:[],changedBy:currentUser.uid,changedByName:currentUser.name,changedByEmail:'',changedAt:timestamp});
          if(existing&&!subjectOnly){const queueRef=db.collection('doe_recalculation_requests').doc();batch.set(queueRef,queuedDoeRequestData(next,queueRef.id,'office_session_updated',timestamp,existing));}
          await batch.commit();
        }
        invalidateAllSessions();
        if(needsDoe)await updateDerivedIndexes([{before:existing||null,after:savedNext}]);
        if(actorRole==='adc'&&existing&&String(existing.instructor||'').trim()&&['date','start','end'].some(field=>String(existing[field]||'')!==String(savedNext[field]||''))){window.dispatchEvent(new CustomEvent('ucvm:assignment-recheck-required',{detail:{sessionId:savedNext.id,course:savedNext.course,date:savedNext.date,start:savedNext.start,end:savedNext.end,type:savedNext.type,topic:savedNext.topic,facultyDisplayName:savedNext.instructor}}))}
        closeModal();
        toast(existing?'Live session updated.':'Live session added.');
      } catch(err) {
        console.error(err); toast(`Session save failed. ${err.message||'Check DOE API / Firestore permissions.'}`,true);
      }
    };
  }

  function input(name,label,type,value,extra='',required=true) {
    return `<div class="form-field ${extra}"><label class="form-label" for="${name}">${label}</label><input class="form-input" id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required?'required':''}></div>`;
  }
  function select(name,label,options,value) {
    return `<div class="form-field"><label class="form-label" for="${name}">${label}</label><select class="form-select" id="${name}" name="${name}">${options.map(o => `<option value="${escapeHtml(o)}" ${String(o)===String(value)?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select></div>`;
  }

  async function deleteSession(id) {
    if (!UCVM.admin(currentUser)) { toast('ADFA permission is required.', true); return; }
    const s = sessions.find(x => x.id === id); if (!s) return;
    if (!liveScheduleAvailable()) { toast('Live Schedule is not initialized.', true); return; }
    if (!confirm(`Delete ${s.course} - ${s.topic} from the live schedule?`)) return;
    try {
      const batch=db.batch();
      batch.delete(db.collection(SESSION_COLLECTION).doc(id));
      batch.delete(db.collection(CALENDAR_SESSION_COLLECTION).doc(id));
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
          allSessionsCache=null;labGroupDirectory.clear();labRosterDirectory.clear();labWorkflowLoaded=false;labWorkflowLoading=null;
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
            msg = 'Authentication succeeded, but this UID has no document under Firestore > users. Add users/{UID} with active=true and a supported UCVM role.';
          } else if (code === 'ucvm/profile-inactive') {
            msg = 'This account exists but active is not true in Firestore.';
          } else if (code === 'ucvm/invalid-role') {
            msg = 'Firestore role must be a supported UCVM role, including developer, owner, administrator, faculty, HICC, VISC, ADC or LAB.';
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
        <div class="login-cheatsheet"><strong>Firebase project:</strong> <code>${escapeHtml(window.UCVM_FIREBASE_PROJECT_ID||'vista-teaching-lab')}</code><br>Enable the matching provider in Firebase Authentication. Your UID must also exist under Firestore <code>users/{uid}</code>.</div>
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
        if (code === 'auth/operation-not-allowed') msg = 'Enable Email/Password in the configured Firebase project > Authentication > Sign-in method.';
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
        if (code === 'auth/operation-not-allowed') msg = 'Enable Phone in the configured Firebase project > Authentication > Sign-in method.';
        else if (code === 'auth/invalid-phone-number') msg = 'The phone number is invalid. Use +1 followed by the Canadian number.';
        else if (code === 'auth/unauthorized-domain') msg = 'Add localhost in the configured Firebase project > Authentication > Settings > Authorized domains.';
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
          <strong>Firebase test project:</strong> the configured Firebase project<br><br>
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
          <strong>Timetable sessions:</strong> ${liveScheduleAvailable() ? 'Live Firestore schedule — shared across authorized users.' : 'No synchronized source loaded — import from Faculty Dashboard.'}
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
    const accessRole=UCVM.role(currentUser?.role),isAdmin=UCVM.admin(currentUser),facultySelfService=roleIsFaculty(currentUser),selfHistory=facultySelfService||accessRole==='other_office';
    // System/admin authority and faculty self-service are separate surfaces. Every
    // administrative account keeps the Admin tools menu even when it has no
    // delegated scheduling office, while Faculty/HICC/VISC alone receive the
    // teaching/AFC self-service controls. ADC and HICC get role-labelled tool
    // menus for their own operational/group actions rather than being presented
    // as generic administrators.
    const showTools=isAdmin||accessRole==='adc'||accessRole==='hicc';
    b.textContent = currentUser ? `${currentUser.name} - ${currentUser.role}` : 'Sign in';
    b.classList.toggle('is-admin', isAdmin);
    $('bulk-add-session-btn').classList.toggle('hidden', !canAddSessions());
    $('add-session-btn').classList.toggle('hidden', !canAddOneSession());
    $('selection-controls').classList.toggle('hidden', !canSelectSessions());
    $('outlook-invite-btn').classList.toggle('hidden', !isAdmin);
    $('manage-users-btn').classList.toggle('hidden', !(UCVM.general(currentUser) || accessRole === 'hicc'));
    $('faculty-dashboard-btn').classList.toggle('hidden', !(isAdmin||facultySelfService));
    const toolMenu=$('cal-admin-menu'),toolSummary=toolMenu?.querySelector('summary');
    if(toolSummary)toolSummary.textContent=isAdmin?'Admin tools':accessRole==='adc'?'ADC tools':accessRole==='hicc'?'HICC tools':'Tools';
    toolMenu?.classList.toggle('hidden',!showTools);
    $('my-teaching-btn').classList.toggle('hidden',!facultySelfService);
    $('afc-request-btn').classList.toggle('hidden',!facultySelfService);
    $('my-change-history-btn').classList.toggle('hidden',!selfHistory);
    $('publish-firestore-schedule').classList.toggle('hidden', !isAdmin);
    updateScheduleSourceUI();
    // My Teaching is the supported faculty self-service reset. The older
    // My Timetable button is redundant with that flow and is not part of the
    // approved role matrix, so it stays hidden for every role.
    $('my-timetable-btn').classList.add('hidden');
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
    const closureDates=showUniversityClosures?closureCalendar.entries.map(row=>row.date):[];
    const allDates=[...all.map(s=>s.date),...cccEvents.flatMap(e=>[e.startDate,e.endDate]),...closureDates].filter(Boolean).sort();
    const source=sessionsWithOverlays(all,allDates[0]||'2026-01-01',allDates[allDates.length-1]||'2027-12-31');
    return filteredSessions(source,{ignorePeriod:true}).filter(s=>{
      if(!s.isUniversityClosure&&options.scope!=='academic'&&selectedYear!=='all'&&String(s.year)!==selectedYear)return false;
      if(options.scope==='date')return s.date>=options.start&&s.date<=options.end;
      if(options.scope==='academic')return s.semester===options.semester&&(options.week==='all'||String(s.week)===options.week)&&(s.isUniversityClosure||options.year==='all'||String(s.year)===options.year);
      return true;
    }).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start||'').localeCompare(String(b.start||''))||String(a.course||'').localeCompare(String(b.course||'')));
  }
  function downloadFile(content,type,name){const blob=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href)}
  function exportCsv(data) {
    const header=['ID','Source','Date','Week','Semester','Year','Course','Course Name','Type','Topic','Instructor','Assignments JSON','Room','Start','End','Time Unknown','CCC','University Closure'];
    const rows=[header,...data.map(s=>[s.id,s.sourceSystem||'',s.date,s.week,s.semester,s.year,s.course,s.courseName||'',s.type,s.topic,s.instructor,JSON.stringify(s.assignments||[]),s.room,s.start,s.end,!!s.timeUnknown,!!s.isCcc,!!s.isUniversityClosure])];
    const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    downloadFile(csv,'text/csv;charset=utf-8','ucvm-filtered-timetable.csv');
  }
  function icsEscape(value){return String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
  function icsDate(date){return String(date).replace(/-/g,'')}
  function exportCalendar(data){
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const events=data.map(s=>{
      const summary=icsEscape(s.isUniversityClosure?`University Closed - ${s.topic}`:`${s.course} ${s.type}${s.topic?` - ${s.topic}`:''}`),description=icsEscape(s.isUniversityClosure?'University Closure — read-only institutional calendar record':`Faculty: ${s.instructor||'TBD'}${s.room?`\nRoom: ${s.room}`:''}`);
      if(s.isUniversityClosure||s.isCcc||s.timeUnknown||!s.start||!s.end){const next=ymd(addDays(parseYmd(s.date),1));return ['BEGIN:VEVENT',`UID:${icsEscape(s.id)}@ucvm-schedule`,`DTSTAMP:${stamp}Z`,`DTSTART;VALUE=DATE:${icsDate(s.date)}`,`DTEND;VALUE=DATE:${icsDate(next)}`,`SUMMARY:${summary}`,`DESCRIPTION:${description}`,'END:VEVENT'].join('\r\n')}
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
    const teachingData=(data||[]).filter(session=>!session?.isUniversityClosure);
    const events=teachingData.map(session=>{
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
      const rows=()=>exportFilteredRows(all,options()).filter(row=>!row.isUniversityClosure);
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
