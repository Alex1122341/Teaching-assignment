'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)api.install(root);
})(typeof window!=='undefined'?window:null,function(){
  const STORAGE_KEY='ucvm-pages-demo-firestore-v2';
  const USER_KEY='ucvm-pages-demo-user-v2';
  const SIGNED_OUT='__signed_out__';
  const DEFAULT_UID='uid-developer';
  const DELETE_SENTINEL='delete';
  let generatedId=0;

  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const text=value=>String(value??'').trim();
  const isTimestampString=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value);

  class DemoTimestamp{
    constructor(value){this.value=value instanceof Date?value.toISOString():String(value||new Date().toISOString())}
    toDate(){return new Date(this.value)}
    toMillis(){return this.toDate().getTime()}
    toJSON(){return this.value}
    valueOf(){return this.toMillis()}
    static now(){return new DemoTimestamp(new Date())}
    static fromDate(value){return new DemoTimestamp(value)}
  }

  function hydrate(value){
    if(Array.isArray(value))return value.map(hydrate);
    if(value&&typeof value==='object'){
      const out={};
      for(const [key,item] of Object.entries(value))out[key]=hydrate(item);
      return out;
    }
    return isTimestampString(value)?new DemoTimestamp(value):value;
  }

  function dehydrate(value){
    if(value instanceof DemoTimestamp)return value.value;
    if(value instanceof Date)return value.toISOString();
    if(Array.isArray(value))return value.map(dehydrate);
    if(value&&typeof value==='object'){
      const out={};
      for(const [key,item] of Object.entries(value)){
        if(item!==undefined)out[key]=dehydrate(item);
      }
      return out;
    }
    return value;
  }

  function fieldValue(kind,payload){return Object.freeze({__ucvmDemoFieldValue:kind,payload})}
  const FieldValue={
    serverTimestamp:()=>fieldValue('serverTimestamp'),
    delete:()=>fieldValue(DELETE_SENTINEL),
    arrayUnion:(...values)=>fieldValue('arrayUnion',values),
    arrayRemove:(...values)=>fieldValue('arrayRemove',values),
    increment:value=>fieldValue('increment',Number(value)||0)
  };

  function isFieldValue(value){return Boolean(value&&typeof value==='object'&&value.__ucvmDemoFieldValue)}
  function getNested(object,path){
    return String(path||'').split('.').reduce((value,key)=>value==null?undefined:value[key],object);
  }
  function setNested(object,path,value){
    const parts=String(path||'').split('.'),last=parts.pop();
    let target=object;
    for(const part of parts){
      if(!target[part]||typeof target[part]!=='object'||Array.isArray(target[part]))target[part]={};
      target=target[part];
    }
    target[last]=value;
  }
  function deleteNested(object,path){
    const parts=String(path||'').split('.'),last=parts.pop();
    let target=object;
    for(const part of parts){
      if(!target?.[part]||typeof target[part]!=='object')return;
      target=target[part];
    }
    delete target[last];
  }
  function comparable(value){
    if(value instanceof DemoTimestamp)return value.toMillis();
    if(value instanceof Date)return value.getTime();
    if(isTimestampString(value))return new Date(value).getTime();
    return value;
  }
  function sameValue(a,b){return JSON.stringify(dehydrate(a))===JSON.stringify(dehydrate(b))}

  function applyFieldValue(current,value){
    if(!isFieldValue(value))return dehydrate(value);
    if(value.__ucvmDemoFieldValue==='serverTimestamp')return new Date().toISOString();
    if(value.__ucvmDemoFieldValue===DELETE_SENTINEL)return fieldValue(DELETE_SENTINEL);
    if(value.__ucvmDemoFieldValue==='arrayUnion'){
      const next=Array.isArray(current)?clone(current):[];
      for(const item of value.payload||[])if(!next.some(existing=>sameValue(existing,item)))next.push(dehydrate(item));
      return next;
    }
    if(value.__ucvmDemoFieldValue==='arrayRemove'){
      const remove=value.payload||[];
      return (Array.isArray(current)?current:[]).filter(item=>!remove.some(candidate=>sameValue(item,candidate)));
    }
    if(value.__ucvmDemoFieldValue==='increment')return Number(current||0)+Number(value.payload||0);
    return dehydrate(value);
  }

  function mergeObject(base,patch){
    const out=clone(base)||{};
    for(const [key,value] of Object.entries(patch||{})){
      if(key.includes('.')){
        const next=applyFieldValue(getNested(out,key),value);
        if(isFieldValue(next)&&next.__ucvmDemoFieldValue===DELETE_SENTINEL)deleteNested(out,key);
        else setNested(out,key,next);
        continue;
      }
      const current=out[key],next=applyFieldValue(current,value);
      if(isFieldValue(next)&&next.__ucvmDemoFieldValue===DELETE_SENTINEL){delete out[key];continue}
      if(next&&typeof next==='object'&&!Array.isArray(next)&&!(value instanceof DemoTimestamp)&&!isFieldValue(value)&&current&&typeof current==='object'&&!Array.isArray(current)){
        out[key]=mergeObject(current,value);
      }else out[key]=next;
    }
    return out;
  }

  function replaceObject(input){
    const out={};
    for(const [key,value] of Object.entries(input||{})){
      const next=applyFieldValue(undefined,value);
      if(isFieldValue(next)&&next.__ucvmDemoFieldValue===DELETE_SENTINEL)continue;
      if(key.includes('.'))setNested(out,key,next);
      else out[key]=next;
    }
    return out;
  }

  function createStore(seed,storage){
    const subscribers=new Set();
    const seedRows=Array.isArray(seed?.documents)?seed.documents:[];
    const seedMap=Object.fromEntries(seedRows.map(row=>[String(row.path),dehydrate(row.data)]));
    let records;
    try{
      const saved=storage?.getItem(STORAGE_KEY);
      records=saved?JSON.parse(saved):clone(seedMap);
    }catch(_){records=clone(seedMap)}
    const persist=()=>{try{storage?.setItem(STORAGE_KEY,JSON.stringify(records))}catch(_){}};
    const notify=()=>{for(const callback of subscribers){try{callback()}catch(error){console.error('[Pages demo subscriber]',error)}}};
    const read=path=>Object.prototype.hasOwnProperty.call(records,path)?clone(records[path]):undefined;
    const write=(path,data,options={})=>{
      const current=read(path);
      records[path]=options.merge&&current!==undefined?mergeObject(current,data):replaceObject(data);
      persist();notify();
    };
    const update=(path,patch)=>{
      const current=read(path);
      if(current===undefined)throw Object.assign(new Error(`Demo document does not exist: ${path}`),{code:'not-found'});
      records[path]=mergeObject(current,patch);persist();notify();
    };
    const remove=path=>{delete records[path];persist();notify()};
    const list=collectionPath=>{
      const prefix=String(collectionPath).replace(/\/$/,'')+'/';
      return Object.entries(records).filter(([path])=>path.startsWith(prefix)&&!path.slice(prefix.length).includes('/')).map(([path,data])=>({path,data:clone(data)}));
    };
    return{
      read,write,update,remove,list,
      subscribe(callback){subscribers.add(callback);return()=>subscribers.delete(callback)},
      reset(){records=clone(seedMap);persist();notify()},
      export(){return clone(records)}
    };
  }

  class DocumentSnapshot{
    constructor(ref,data){this.ref=ref;this.id=ref.id;this.exists=data!==undefined;this._data=data;this.metadata={fromCache:true,hasPendingWrites:false}}
    data(){return this.exists?hydrate(clone(this._data)):undefined}
    get(path){return getNested(this.data(),path)}
  }
  class QuerySnapshot{
    constructor(docs){this.docs=docs;this.size=docs.length;this.empty=!docs.length;this.metadata={fromCache:true,hasPendingWrites:false}}
    forEach(callback){this.docs.forEach(callback)}
    docChanges(){return this.docs.map(doc=>({type:'added',doc}))}
  }

  function filterMatches(data,field,operator,expected){
    const actual=getNested(data,field),left=comparable(actual),right=comparable(expected);
    if(operator==='==')return sameValue(actual,expected);
    if(operator==='!=')return !sameValue(actual,expected);
    if(operator==='<')return left<right;
    if(operator==='<=')return left<=right;
    if(operator==='>')return left>right;
    if(operator==='>=')return left>=right;
    if(operator==='array-contains')return Array.isArray(actual)&&actual.some(item=>sameValue(item,expected));
    if(operator==='in')return Array.isArray(expected)&&expected.some(item=>sameValue(actual,item));
    if(operator==='not-in')return Array.isArray(expected)&&!expected.some(item=>sameValue(actual,item));
    if(operator==='array-contains-any')return Array.isArray(actual)&&Array.isArray(expected)&&expected.some(item=>actual.some(value=>sameValue(value,item)));
    return false;
  }

  class Query{
    constructor(db,path,filters=[],orders=[],limitCount=null,startAfterValue=null){
      this._db=db;this.path=path;this._filters=filters;this._orders=orders;this._limit=limitCount;this._startAfter=startAfterValue;
    }
    where(field,operator,value){return new Query(this._db,this.path,[...this._filters,{field,operator,value}],this._orders,this._limit,this._startAfter)}
    orderBy(field,direction='asc'){return new Query(this._db,this.path,this._filters,[...this._orders,{field,direction}],this._limit,this._startAfter)}
    limit(count){return new Query(this._db,this.path,this._filters,this._orders,Math.max(0,Number(count)||0),this._startAfter)}
    startAfter(value){return new Query(this._db,this.path,this._filters,this._orders,this._limit,value)}
    _rows(){
      let rows=this._db._store.list(this.path).filter(row=>this._filters.every(filter=>filterMatches(row.data,filter.field,filter.operator,filter.value)));
      if(this._orders.length){
        rows.sort((a,b)=>{
          for(const order of this._orders){
            const av=comparable(getNested(a.data,order.field)),bv=comparable(getNested(b.data,order.field));
            if(av===bv)continue;
            const result=av==null?1:bv==null?-1:av<bv?-1:1;
            return order.direction==='desc'?-result:result;
          }
          return a.path.localeCompare(b.path);
        });
      }
      if(this._startAfter){
        const id=this._startAfter?.id||String(this._startAfter||'');
        const index=rows.findIndex(row=>row.path.split('/').pop()===id);
        if(index>=0)rows=rows.slice(index+1);
      }
      if(this._limit!==null)rows=rows.slice(0,this._limit);
      return rows;
    }
    async get(){return new QuerySnapshot(this._rows().map(row=>new DocumentSnapshot(new DocumentReference(this._db,row.path),row.data)))}
    onSnapshot(callback,error){
      let active=true;
      const publish=()=>{if(!active)return;try{callback(new QuerySnapshot(this._rows().map(row=>new DocumentSnapshot(new DocumentReference(this._db,row.path),row.data))))}catch(err){if(error)error(err)}};
      queueMicrotask(publish);
      const unsubscribe=this._db._store.subscribe(publish);
      return()=>{active=false;unsubscribe()};
    }
  }

  class CollectionReference extends Query{
    constructor(db,path){super(db,String(path).replace(/^\/+|\/+$/g,''));this.id=this.path.split('/').pop()}
    doc(id){
      const value=text(id)||`demo-${Date.now().toString(36)}-${(++generatedId).toString(36)}`;
      return new DocumentReference(this._db,`${this.path}/${value}`);
    }
    async add(data){const ref=this.doc();await ref.set(data);return ref}
  }

  class DocumentReference{
    constructor(db,path){this._db=db;this.path=String(path).replace(/^\/+|\/+$/g,'');this.id=this.path.split('/').pop()}
    get parent(){const parts=this.path.split('/');parts.pop();return new CollectionReference(this._db,parts.join('/'))}
    collection(name){return new CollectionReference(this._db,`${this.path}/${name}`)}
    async get(){return new DocumentSnapshot(this,this._db._store.read(this.path))}
    async set(data,options={}){this._db._store.write(this.path,data,options||{});return undefined}
    async update(...args){
      let patch=args[0];
      if(typeof args[0]==='string'){
        patch={};
        for(let index=0;index<args.length;index+=2)patch[args[index]]=args[index+1];
      }
      this._db._store.update(this.path,patch||{});return undefined;
    }
    async delete(){this._db._store.remove(this.path)}
    onSnapshot(callback,error){
      let active=true;
      const publish=()=>{if(!active)return;try{callback(new DocumentSnapshot(this,this._db._store.read(this.path)))}catch(err){if(error)error(err)}};
      queueMicrotask(publish);
      const unsubscribe=this._db._store.subscribe(publish);
      return()=>{active=false;unsubscribe()};
    }
  }

  class WriteBatch{
    constructor(db){this._db=db;this._ops=[]}
    set(ref,data,options){this._ops.push(()=>this._db._store.write(ref.path,data,options||{}));return this}
    update(ref,...args){this._ops.push(()=>{let patch=args[0];if(typeof args[0]==='string'){patch={};for(let i=0;i<args.length;i+=2)patch[args[i]]=args[i+1]}this._db._store.update(ref.path,patch||{})});return this}
    delete(ref){this._ops.push(()=>this._db._store.remove(ref.path));return this}
    async commit(){for(const operation of this._ops)operation();return[]}
  }

  class Transaction{
    constructor(db){this._db=db;this._ops=[]}
    get(ref){return ref.get()}
    set(ref,data,options){this._ops.push(()=>this._db._store.write(ref.path,data,options||{}));return this}
    update(ref,...args){this._ops.push(()=>{let patch=args[0];if(typeof args[0]==='string'){patch={};for(let i=0;i<args.length;i+=2)patch[args[i]]=args[i+1]}this._db._store.update(ref.path,patch||{})});return this}
    delete(ref){this._ops.push(()=>this._db._store.remove(ref.path));return this}
    commit(){for(const operation of this._ops)operation()}
  }

  class DemoFirestore{
    constructor(store){this._store=store}
    collection(path){return new CollectionReference(this,path)}
    doc(path){return new DocumentReference(this,path)}
    batch(){return new WriteBatch(this)}
    async runTransaction(callback){const transaction=new Transaction(this);const result=await callback(transaction);transaction.commit();return result}
    enablePersistence(){return Promise.resolve()}
    useEmulator(){}
    disableNetwork(){return Promise.resolve()}
    enableNetwork(){return Promise.resolve()}
    terminate(){return Promise.resolve()}
  }

  function createdUidForEmail(email){
    const value=String(email||'').trim().toLowerCase();let hash=2166136261;
    for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619)}
    return`demo-auth-${(hash>>>0).toString(16).padStart(8,'0')}`;
  }

  function uidForEmail(email,registry){
    const normalized=String(email||'').trim().toLowerCase();
    if(registry?.has(normalized))return registry.get(normalized);
    const local=normalized.split('@')[0];
    if(local.includes('developer'))return'uid-developer';
    if(local.includes('owner'))return'uid-owner';
    if(local.includes('hicc'))return'uid-hicc-1';
    if(local.includes('visc'))return'uid-visc-1';
    if(local.includes('adc'))return'uid-adc-1';
    if(local.includes('lab'))return'uid-lab-1';
    if(local.includes('faculty'))return'uid-fac-001';
    if(local.includes('admin'))return'uid-adfa-regular';
    return DEFAULT_UID;
  }

  function createAuth(store,storage,sessionStorage,options={}){
    const listeners=new Set(),registry=options.registry||new Map(),defaultUid=Object.prototype.hasOwnProperty.call(options,'defaultUid')?options.defaultUid:DEFAULT_UID;
    let selected=defaultUid;
    try{const saved=storage?.getItem(USER_KEY);if(saved!==null&&saved!==undefined&&saved!=='')selected=saved}catch(_){selected=defaultUid}
    let current=!selected||selected===SIGNED_OUT?null:selected;
    const profileFor=uid=>store.read(`users/${uid}`)||{};
    const userFor=(uid,emailOverride='')=>{
      if(!uid)return null;
      const profile=profileFor(uid),name=profile.name||uid;
      return{
        uid,
        email:emailOverride||`${uid.replace(/^uid-/,'').replace(/[^a-z0-9._-]/gi,'.')}@ucalgary.ca`,
        displayName:name,
        phoneNumber:null,
        emailVerified:true,
        disabled:false,
        getIdToken:async()=>`demo-token-${uid}`,
        getIdTokenResult:async()=>({token:`demo-token-${uid}`,claims:{demo:true}}),
        updatePassword:async()=>undefined,
        updateProfile:async patch=>Object.assign(profile,patch||{})
      };
    };
    let currentUser=userFor(current);
    const emit=()=>{for(const callback of listeners)queueMicrotask(()=>callback(currentUser))};
    const select=(uid,email='')=>{
      current=uid||null;currentUser=userFor(current,email);
      try{storage?.setItem(USER_KEY,current||SIGNED_OUT)}catch(_){}
      if(current)try{sessionStorage?.setItem('ucvm-admin-default-landing',current)}catch(_){}
      emit();return currentUser;
    };
    if(current)try{sessionStorage?.setItem('ucvm-admin-default-landing',current)}catch(_){}
    return{
      get currentUser(){return currentUser},
      setPersistence:async()=>undefined,
      onAuthStateChanged(callback){listeners.add(callback);queueMicrotask(()=>callback(currentUser));return()=>listeners.delete(callback)},
      signInWithEmailAndPassword:async email=>({user:select(uidForEmail(email,registry),email)}),
      createUserWithEmailAndPassword:async(email,password)=>{const normalized=String(email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)){const error=Error('The email address is invalid.');error.code='auth/invalid-email';throw error}if(String(password||'').length<6){const error=Error('The password must be at least 6 characters.');error.code='auth/weak-password';throw error}if(registry.has(normalized)){const error=Error('The email address is already in use.');error.code='auth/email-already-in-use';throw error}const uid=createdUidForEmail(normalized);registry.set(normalized,uid);return{user:select(uid,normalized)}} ,
      signInWithPhoneNumber:async()=>({confirm:async()=>({user:select(DEFAULT_UID)})}),
      signOut:async()=>{select(null)},
      sendPasswordResetEmail:async()=>undefined,
      useEmulator(){},
      _select:select
    };
  }

  /* ------------------------------------------------------------------ *
   * Frontend Demo DOE calculation.
   *
   * One calculation source feeds both the DOE List (doeRows) and the
   * per-Faculty worksheet (doeWorksheet) so the two can never disagree.
   * Values are deterministic, browser-local and explicitly NON-authoritative.
   *
   * Teaching DOE is aggregated from the demo sessions' assignments[].doeCredit.
   * An assignment without stored DOE evidence becomes a needs_review line with
   * resultDoe = null. It is never silently treated as 0, and a total is only
   * published when every required line is rateable.
   * ------------------------------------------------------------------ */
  const DEMO_POLICY_VERSION='demo-synthetic-2026-27-v1';
  const DEMO_LAST_CALCULATED='2026-09-20T12:00:00Z';
  const DEMO_REFERENCE={title:'UCVM Workload Guideline 2026-27',section:'3.2',table:'Teaching DOE rates'};
  const round4=value=>Math.round(Number(value)*10000)/10000;
  const finite=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null};

  function demoDoeCalculation(store,academicYear='2026-27'){
    const facultyRecords=store.list('faculty').sort((a,b)=>a.path.localeCompare(b.path));
    const byFaculty=new Map();
    for(const session of store.list('sessions')){
      const data=session.data||{},sessionId=String(session.path).split('/').pop();
      const assignments=Array.isArray(data.assignments)?data.assignments:[];
      assignments.forEach((assignment,index)=>{
        const facultyId=text(assignment?.facultyId||assignment?.ucid);
        if(!facultyId)return;
        const bucket=byFaculty.get(facultyId)||[];
        bucket.push({sessionId,index,assignment,data});
        byFaculty.set(facultyId,bucket);
      });
    }
    const rows=[],worksheets=new Map();
    for(const record of facultyRecords){
      const data=record.data||{},facultyId=String(record.path).split('/').pop();
      const summary=data.facultySummary2026_27&&typeof data.facultySummary2026_27==='object'?data.facultySummary2026_27:{};
      const displayName=text(data.preferredFullName||data.hrFirstLast||data.hrFullName||[data.firstName,data.lastName].filter(Boolean).join(' ')||facultyId);
      // Effective target: an explicit demo override wins, otherwise the existing
      // contract Teaching DOE. No target is invented.
      const override=finite(data.doeOverride2026_27?.value);
      const contractTarget=[data.doe,data.teachingDOE,data.contractTeachingDOE,summary.assignedTeachingDOE].map(finite).find(value=>value!==null);
      const effectiveTargetDoe=override!==null?override:(contractTarget!==undefined?contractTarget:null);
      const entries=byFaculty.get(facultyId)||[];
      const lines=entries.map(entry=>{
        const assignment=entry.assignment,credit=finite(assignment.doeCredit),hours=finite(assignment.creditedHours),rate=finite(assignment.doeRate);
        const lineId=`${entry.sessionId}--${entry.index}`;
        const rateable=credit!==null;
        const course=text(entry.data.course),topic=text(entry.data.topic||assignment.topic);
        return{
          lineId,
          label:[course,topic].filter(Boolean).join(' · ')||'Teaching assignment',
          category:'Teaching',
          status:rateable?'calculated':'needs_review',
          resultDoe:rateable?credit:null,
          errorCode:rateable?'':'DOE_SOURCE_PROVENANCE_INCOMPLETE',
          calculationText:rateable?`${hours===null?'—':hours} h × ${rate===null?'—':rate}% = ${credit}%`:'This assignment has no stored DOE credit evidence; recalculation is required before a DOE total can be published.',
          ruleKey:text(assignment.doeRuleKey||'teaching.assignment.rate'),
          ruleId:text(assignment.doeRuleId||'teaching-assignment-v1'),
          policyVersionId:text(assignment.doePolicyVersionId||data.teachingDoeModel2026_27||DEMO_POLICY_VERSION),
          reference:{...DEMO_REFERENCE},
          calculationId:text(assignment.doeCalculationId||lineId),
          calculatedAt:DEMO_LAST_CALCULATED,
          sourceEntityType:'session_assignment',
          sourceEntityId:entry.sessionId,
          assignmentFactId:lineId,
          roleType:text(assignment.role),
          courseCode:course,
          subjectKey:topic,
          teachingRole:text(assignment.role),
          explanation:{
            trigger:'frontend_demo',
            source:'Frontend Demo sessions (browser-local)',
            rule:{name:'Teaching assignment rate',calculationMode:'hours × rate',category:'Teaching'},
            facts:{sessionId:entry.sessionId,course,topic,role:text(assignment.role)},
            inputs:{creditedHours:hours,doeRate:rate},
            parameters:{doeCredit:rateable?credit:null,evidencePresent:rateable}
          }
        };
      });
      const unrated=lines.filter(line=>line.status!=='calculated');
      const scheduledTeachingDoe=round4(lines.filter(line=>line.status==='calculated').reduce((total,line)=>total+line.resultDoe,0));
      const roleDoe=0,rawSupervisionDoe=0,appliedSupervisionDoe=0,adjustmentDoe=0;
      // A total is only published when every required line is rateable.
      const calculable=unrated.length===0;
      const assignedTeachingDoe=calculable?round4(scheduledTeachingDoe+roleDoe+appliedSupervisionDoe+adjustmentDoe):null;
      const remainingDoe=assignedTeachingDoe===null||effectiveTargetDoe===null?null:round4(effectiveTargetDoe-assignedTeachingDoe);
      const errors=unrated.length?[{code:'DOE_NEEDS_REVIEW',message:`${unrated.length} assignment line(s) have no stored DOE credit evidence.`}]:[];
      const status=!calculable?'needs_review':(effectiveTargetDoe===null?'needs_review':'calculated');
      const row={
        facultyId,displayName,academicYear,
        scheduledTeachingDoe,roleDoe,rawSupervisionDoe,appliedSupervisionDoe,adjustmentDoe,
        assignedTeachingDoe,effectiveTargetDoe,remainingDoe,
        policyVersionId:DEMO_POLICY_VERSION,status,lastCalculatedAt:DEMO_LAST_CALCULATED,
        teachingLineCount:lines.length,roleAssignmentCount:0,supervisionLineCount:0,adjustmentLineCount:0,
        serverFactCount:lines.length,unratedLineCount:unrated.length,missingMappingCount:0,
        issueCount:errors.length,issueCodes:errors.map(error=>error.code),
        demoOnly:true,authoritative:false
      };
      rows.push(row);
      worksheets.set(facultyId,{
        facultyId,displayName,academicYear,
        policyVersionId:DEMO_POLICY_VERSION,status,lastCalculatedAt:DEMO_LAST_CALCULATED,
        totals:{
          scheduledTeachingDoe,roleDoe,rawSupervisionDoe,appliedSupervisionDoe,adjustmentDoe,
          assignedTeachingDoe,effectiveTargetDoe,remainingDoe
        },
        reserve:{initialTraineeReserve:null,unappliedSupervision:0},
        errors,lines,
        demoOnly:true,authoritative:false,
        label:'Frontend Demo DOE — non-authoritative'
      });
    }
    return{rows,worksheets};
  }

  function demoDoeRows(store,academicYear='2026-27'){
    const rows=demoDoeCalculation(store,academicYear).rows;
    // Explicit server-only synthetic record so the reconciliation "Server Only"
    // state stays reachable without corrupting any real Faculty calculation.
    rows.push({
      facultyId:'demo-server-only',
      displayName:'Demo Server-only DOE Record',
      academicYear,
      scheduledTeachingDoe:22,roleDoe:0,rawSupervisionDoe:0,appliedSupervisionDoe:0,adjustmentDoe:0,
      assignedTeachingDoe:22,effectiveTargetDoe:40,remainingDoe:18,
      policyVersionId:`demo-synthetic-${academicYear}-v1`,status:'calculated',lastCalculatedAt:DEMO_LAST_CALCULATED,
      teachingLineCount:1,roleAssignmentCount:0,supervisionLineCount:0,adjustmentLineCount:0,
      serverFactCount:1,unratedLineCount:0,missingMappingCount:0,issueCount:0,issueCodes:[],
      demoOnly:true,serverOnlyDemo:true,authoritative:false
    });
    return rows;
  }

  function demoDoeWorksheet(store,facultyId,academicYear='2026-27'){
    const calculation=demoDoeCalculation(store,academicYear);
    return calculation.worksheets.get(text(facultyId))||null;
  }

  /* Reconciliation-only anomaly fixtures. These are deliberately separated from
   * the normal DOE calculation display: a Faculty row in the DOE List always
   * shows internally consistent values, and only this explicitly labelled set
   * exercises the six reconciliation states. */
  function demoReconciliationRows(store,academicYear='2026-27'){
    const calculation=demoDoeCalculation(store,academicYear);
    const base=(facultyId,displayName,status,overrides={})=>{
      const statusLabel={matched:'Matched',different_doe:'DOE Difference',missing_mapping:'Missing Mapping',needs_review:'Needs Review',legacy_only:'Legacy Only',server_only:'Server Only'}[status];
      return{
        facultyId,displayName,status,statusLabel,
        flags:[status],legacyAssignedDoe:40,worksheetAssignedDoe:40,differenceDoe:0,
        sourceRoleCount:0,legacyManagedRoleCount:0,serverRoleCount:0,serverFactCount:1,
        teachingLineCount:1,supervisionLineCount:0,adjustmentLineCount:0,unratedLineCount:0,
        issueCount:0,issueCodes:[],missingMappingCount:0,
        policyVersionId:DEMO_POLICY_VERSION,calculationStatus:status==='matched'?'calculated':'needs_review',
        lastCalculatedAt:DEMO_LAST_CALCULATED,legacyEvidence:true,serverExists:true,
        reconciliationFixture:true,demoOnly:true,authoritative:false,
        ...overrides
      };
    };
    // One healthy row proves a normal, internally consistent comparison.
    const healthy=calculation.rows.filter(row=>!row.serverOnlyDemo).slice(0,1).map(row=>base(row.facultyId,row.displayName,'matched',{
      legacyAssignedDoe:row.assignedTeachingDoe,worksheetAssignedDoe:row.assignedTeachingDoe,differenceDoe:0,
      serverFactCount:row.serverFactCount,teachingLineCount:row.teachingLineCount,
      calculationStatus:row.status
    }));
    return[
      ...healthy,
      base('demo-recon-difference','Demo Reconciliation · DOE Difference','different_doe',{legacyAssignedDoe:40,worksheetAssignedDoe:43,differenceDoe:3,flags:['different_doe']}),
      base('demo-recon-mapping','Demo Reconciliation · Missing Mapping','missing_mapping',{missingMappingCount:1,issueCodes:['COURSE_MAPPING_REQUIRED'],issueCount:1,flags:['missing_mapping','needs_review']}),
      base('demo-recon-review','Demo Reconciliation · Needs Review','needs_review',{unratedLineCount:1,issueCodes:['DOE_SOURCE_PROVENANCE_INCOMPLETE'],issueCount:1,worksheetAssignedDoe:null,differenceDoe:null,flags:['needs_review']}),
      base('demo-recon-legacy','Demo Reconciliation · Legacy Only','legacy_only',{serverExists:false,worksheetAssignedDoe:null,differenceDoe:null,serverFactCount:0,teachingLineCount:0,calculationStatus:'not_found',flags:['legacy_only']}),
      base('demo-server-only','Demo Server-only DOE Record','server_only',{legacyEvidence:false,legacyAssignedDoe:null,differenceDoe:null,worksheetAssignedDoe:22,flags:['server_only']})
    ];
  }


  function demoRulebookService(academicYear='2026-27'){
    const year=text(academicYear)||'2026-27',policyId=`demo-rulebook-${year}`,policyVersionId=`${policyId}-v1`;
    const reference={referenceId:'demo-wg-6-4',policyVersionId,academicYear:year,title:'UCVM Workload Guidelines',versionDate:'2026-07-01',section:'6.4',table:'Table 3',page:5,effectiveDate:'2026-07-01',reviewStatus:'confirmed_unchanged',adminNote:'Frontend Demo reference fixture'};
    const policy={policyId,academicYear:year,name:`Frontend Demo Rule Book ${year}`,currentActiveVersionId:policyVersionId};
    const version={policyVersionId,policyId,academicYear:year,versionNumber:1,status:'active',revision:1,name:`${year} Frontend Demo active policy`,lastValidationPassed:true,lastValidatedRevision:1,rulesChecksum:'demo-rulebook-read-only',lastImpactRunId:'',lastImpactRevision:null,lastImpactChecksum:'',lastImpactDatasetChecksum:'',reservePolicy:{strategy:'flexible_teaching_reserve',splitThreshold:20,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:20,rollingAverageYears:3,referenceId:reference.referenceId,reviewStatus:'confirmed_unchanged'}};
    const rules=[
      {ruleId:'demo-rule-lecture',policyVersionId,ruleKey:'teaching.lecture',name:'Demo Lecture rate',category:'teaching',calculationMode:'rate',resultKind:'credit',priority:10,enabled:true,reviewStatus:'confirmed_unchanged',referenceId:reference.referenceId,guidelineReference:'§6.4 · Table 3',sourceType:'workload_guideline',mappingRequirement:'course',selectors:[{selectorId:'demo-selector-lecture',field:'activityType',operator:'equals',valueText:'Lecture'}],inputs:[{ruleInputId:'demo-input-hours',inputName:'hours',inputType:'number',source:'assignment.creditedHours',required:true}],parameters:[{parameterId:'demo-param-rate',name:'rate',valueNumber:14,unit:'% DOE/h',required:true}],tiers:[]},
      {ruleId:'demo-rule-hicc',policyVersionId,ruleKey:'role.hicc',name:'Demo HICC role',category:'role',calculationMode:'fixed',resultKind:'credit',priority:20,enabled:true,reviewStatus:'confirmed_unchanged',referenceId:reference.referenceId,guidelineReference:'§6.4 · Table 3',sourceType:'workload_guideline',mappingRequirement:'course',selectors:[{selectorId:'demo-selector-hicc',field:'roleType',operator:'equals',valueText:'HICC'}],inputs:[],parameters:[{parameterId:'demo-param-hicc',name:'fixedDoe',valueNumber:12,unit:'% DOE',required:true}],tiers:[]}
    ];
    const bundle={policy,version,references:[reference],rules,exceptions:[],courseMappings:[{mappingId:'demo-course-vtmd204',policyVersionId,academicYear:year,courseCode:'VTMD 204',unitCount:2,referenceId:reference.referenceId,reviewStatus:'confirmed_unchanged',adminNote:'Frontend Demo mapping',enabled:true}],subjectMappings:[{mappingId:'demo-visc-anatomy',policyVersionId,academicYear:year,subjectKey:'anatomy',displayName:'Anatomy',curriculumStage:'year_1',referenceId:reference.referenceId,reviewStatus:'confirmed_unchanged',adminNote:'Frontend Demo mapping',enabled:true}]};
    const audit=[{policyVersionId,academicYear:year,action:'demo_policy_loaded',entityType:'policy_version',changedAt:'2026-09-20T12:00:00Z',changedByName:'Frontend Demo'}];
    const readonly=async()=>{const error=new Error('Frontend Demo Rule Book is non-authoritative and read-only. Connect the DOE backend to save or publish policy changes.');error.code='FRONTEND_DEMO_READ_ONLY';throw error};
    const api={readOnly:true,demoOnly:true,authoritative:false,listPolicies:async()=>clone([policy]),listVersions:async id=>text(id)===policyId?clone([version]):[],loadPolicyBundle:async id=>text(id)===policyVersionId?clone(bundle):null,listAudit:async id=>text(id)===policyVersionId?clone(audit):[],getImpactPreview:async()=>null};
    for(const name of ['saveRule','testRule','saveException','createPolicyYear','cloneAsDraft','validateDraft','runImpactPreview','publish','archive','previewRecalculate','runRecalculate','copyPolicyYear','saveCourseMapping','saveSubjectMapping','saveReference','saveReservePolicy'])api[name]=readonly;
    return Object.freeze(api);
  }

  function installToolbar(root,seed,store,auth){
    const render=()=>{
      if(root.document.getElementById('ucvm-pages-demo-toolbar'))return;
      const priority={developer:0,owner:1,administrator:2,adfa_general:3,adfa_regular:4,adc:5,lab:6,hicc:7,visc:8,faculty:9};
      const users=(seed?.documents||[]).filter(row=>String(row.path||'').startsWith('users/')).map(row=>({uid:String(row.path).split('/')[1],...(row.data||{})})).filter(row=>row.active!==false&&row.mustChangePassword!==true).sort((a,b)=>(priority[a.role]??99)-(priority[b.role]??99)||String(a.name||a.uid).localeCompare(String(b.name||b.uid)));
      const style=root.document.createElement('style');
      style.id='ucvm-pages-demo-toolbar-style';
      style.textContent='#ucvm-pages-demo-toolbar{position:fixed;left:12px;bottom:12px;z-index:2147483646;width:min(410px,calc(100vw - 24px));background:#fff3cd;color:#3d3300;padding:10px 12px;border:2px solid #8a6d00;border-radius:10px;font:600 12px/1.35 Arial,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.28)}#ucvm-pages-demo-toolbar .demo-title{font-size:13px;font-weight:900;letter-spacing:.04em}#ucvm-pages-demo-toolbar .demo-controls{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:7px}#ucvm-pages-demo-toolbar label{font-weight:800}#ucvm-pages-demo-toolbar select,#ucvm-pages-demo-toolbar button{font:700 12px Arial,sans-serif;padding:5px 7px;border-radius:6px;border:1px solid #8a6d00;background:#fff;color:#3d3300}#ucvm-pages-demo-toolbar select{min-width:210px;flex:1}#ucvm-pages-demo-toolbar small{display:block;color:#665a21;margin-top:6px;font-weight:600}';
      root.document.head.appendChild(style);
      const bar=root.document.createElement('div');bar.id='ucvm-pages-demo-toolbar';
      const title=root.document.createElement('div');title.className='demo-title';title.textContent='DEMO ROLE TESTER';
      const controls=root.document.createElement('div');controls.className='demo-controls';
      const label=root.document.createElement('label');label.textContent='Test as role';
      const select=root.document.createElement('select');select.setAttribute('aria-label','Test as role');
      for(const user of users){
        const option=root.document.createElement('option');option.value=user.uid;option.textContent=`${user.role==='developer'?'★ ':''}${user.name||user.uid} · ${user.role||'unknown'}`;if(auth.currentUser?.uid===user.uid)option.selected=true;select.appendChild(option);
      }
      select.addEventListener('change',()=>{auth._select(select.value);root.location.reload()});
      const reset=root.document.createElement('button');reset.type='button';reset.textContent='Reset demo data';reset.addEventListener('click',()=>{root.UCVM_PAGES_DEMO?.reset?.();root.location.reload()});
      controls.append(label,select,reset);bar.append(title,controls);
      const note=root.document.createElement('small');note.textContent='Developer is highest permission · role switching reloads the current page · synthetic browser-local data only';bar.appendChild(note);
      root.document.body.appendChild(bar);
    };
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',render,{once:true});else render();
  }

  function createDemoFirebase(root,seed){
    const store=createStore(seed,root.localStorage);
    const db=new DemoFirestore(store),authRegistry=new Map();
    const rebuildAuthRegistry=()=>{authRegistry.clear();for(const row of store.list('users')){const email=text(row.data?.email).toLowerCase(),uid=String(row.path).split('/').pop();if(email)authRegistry.set(email,uid)}};
    rebuildAuthRegistry();
    const auth=createAuth(store,root.localStorage,root.sessionStorage,{registry:authRegistry});
    const reset=()=>{store.reset();rebuildAuthRegistry()};
    const authFn=()=>auth;
    authFn.Auth={Persistence:{LOCAL:'local',SESSION:'session',NONE:'none'}};
    authFn.RecaptchaVerifier=class{render(){return Promise.resolve(1)}clear(){}};
    authFn.EmailAuthProvider={credential:(email,password)=>({email,password})};
    const firestoreFn=()=>db;
    firestoreFn.FieldValue=FieldValue;
    firestoreFn.Timestamp=DemoTimestamp;
    const apps=[];
    const makeApp=(name,appAuth,options={})=>({name,options:{projectId:'vista-teaching-lab-demo',...(options||{})},auth:()=>appAuth,firestore:()=>db});
    const defaultApp=makeApp('[DEFAULT]',auth);apps.push(defaultApp);
    const firebase={
      apps,
      initializeApp:(options={},name='[DEFAULT]')=>{const appName=name||'[DEFAULT]',existing=apps.find(item=>item.name===appName);if(existing)return existing;const secondary=createAuth(store,null,null,{registry:authRegistry,defaultUid:''}),app=makeApp(appName,secondary,options);apps.push(app);return app},
      app:(name='[DEFAULT]')=>{const found=apps.find(item=>item.name===(name||'[DEFAULT]'));if(!found)throw Error(`Demo Firebase app not found: ${name}`);return found},
      auth:authFn,
      firestore:firestoreFn,
      SDK_VERSION:'pages-demo'
    };
    return{firebase,store,db,auth,reset};
  }

  function install(root){
    const seed=root.UCVM_PAGES_DEMO_SEED||{documents:[]};
    const runtime=createDemoFirebase(root,seed);
    root.firebase=runtime.firebase;
    root.UCVM_FRONTEND_DEMO_MODE=true;
    const doeRulebook=demoRulebookService('2026-27');
    root.UCVM_PAGES_DEMO=Object.freeze({
      reset:()=>runtime.reset(),
      export:()=>runtime.store.export(),
      selectUser:uid=>runtime.auth._select(uid),
      doeRulebook,
      doeRows:academicYear=>demoDoeRows(runtime.store,academicYear),
      doeWorksheet:(facultyId,academicYear)=>demoDoeWorksheet(runtime.store,facultyId,academicYear),
      doeReconciliationRows:academicYear=>demoReconciliationRows(runtime.store,academicYear),
      doeLabel:'Frontend Demo DOE — non-authoritative',
      backend:'browser-memory',
      doeAuthoritative:false
    });
    installToolbar(root,seed,runtime.store,runtime.auth);
    return runtime;
  }

  return{DemoTimestamp,FieldValue,createStore,createDemoFirebase,demoDoeRows,demoDoeCalculation,demoDoeWorksheet,demoReconciliationRows,demoRulebookService,install,filterMatches,mergeObject};
});
