'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)api.install(root);
})(typeof window!=='undefined'?window:null,function(){
  const STORAGE_KEY='ucvm-pages-demo-firestore-v1';
  const USER_KEY='ucvm-pages-demo-user-v1';
  const SIGNED_OUT='__signed_out__';
  const DEFAULT_UID='uid-adfa-general';
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

  function uidForEmail(email){
    const local=String(email||'').toLowerCase().split('@')[0];
    if(local.includes('owner'))return'uid-owner';
    if(local.includes('hicc'))return'uid-hicc-1';
    if(local.includes('visc'))return'uid-visc-1';
    if(local.includes('adc'))return'uid-adc-1';
    if(local.includes('lab'))return'uid-lab-1';
    if(local.includes('faculty'))return'uid-fac-001';
    if(local.includes('admin'))return'uid-adfa-regular';
    return DEFAULT_UID;
  }

  function createAuth(store,storage,sessionStorage){
    const listeners=new Set();
    let selected;
    try{selected=storage?.getItem(USER_KEY)||DEFAULT_UID}catch(_){selected=DEFAULT_UID}
    let current=selected===SIGNED_OUT?null:selected;
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
      signInWithEmailAndPassword:async email=>({user:select(uidForEmail(email),email)}),
      signInWithPhoneNumber:async()=>({confirm:async()=>({user:select(DEFAULT_UID)})}),
      signOut:async()=>{select(null)},
      sendPasswordResetEmail:async()=>undefined,
      useEmulator(){},
      _select:select
    };
  }

  function installToolbar(root,seed,store,auth){
    const render=()=>{
      if(root.document.getElementById('ucvm-pages-demo-toolbar'))return;
      const users=(seed?.documents||[]).filter(row=>String(row.path||'').startsWith('users/')).map(row=>({uid:String(row.path).split('/')[1],...(row.data||{})})).filter(row=>row.active!==false&&row.mustChangePassword!==true);
      const style=root.document.createElement('style');
      style.id='ucvm-pages-demo-toolbar-style';
      style.textContent='#ucvm-pages-demo-toolbar{position:fixed;left:10px;top:10px;z-index:2147483646;background:#202124;color:#fff;padding:8px 10px;border-radius:8px;font:600 11px/1.35 Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)}#ucvm-pages-demo-toolbar select,#ucvm-pages-demo-toolbar button{margin-left:6px;font:600 11px Arial,sans-serif}#ucvm-pages-demo-toolbar small{display:block;color:#d7d7d7;margin-top:4px;font-weight:500}';
      root.document.head.appendChild(style);
      const bar=root.document.createElement('div');
      bar.id='ucvm-pages-demo-toolbar';
      const select=root.document.createElement('select');
      for(const user of users){
        const option=root.document.createElement('option');
        option.value=user.uid;option.textContent=`${user.name||user.uid} · ${user.role||'unknown'}`;
        if(auth.currentUser?.uid===user.uid)option.selected=true;
        select.appendChild(option);
      }
      select.addEventListener('change',()=>{auth._select(select.value);root.location.reload()});
      const reset=root.document.createElement('button');
      reset.type='button';reset.textContent='Reset demo data';
      reset.addEventListener('click',()=>{store.reset();root.location.reload()});
      bar.append(root.document.createTextNode('FRONTEND DEMO '),select,reset);
      const note=root.document.createElement('small');
      note.textContent='Synthetic browser-local data · no cloud writes · authoritative DOE backend off';
      bar.appendChild(note);
      root.document.body.appendChild(bar);
    };
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',render,{once:true});else render();
  }

  function createDemoFirebase(root,seed){
    const store=createStore(seed,root.localStorage);
    const db=new DemoFirestore(store);
    const auth=createAuth(store,root.localStorage,root.sessionStorage);
    const authFn=()=>auth;
    authFn.Auth={Persistence:{LOCAL:'local',SESSION:'session',NONE:'none'}};
    authFn.RecaptchaVerifier=class{render(){return Promise.resolve(1)}clear(){}};
    authFn.EmailAuthProvider={credential:(email,password)=>({email,password})};
    const firestoreFn=()=>db;
    firestoreFn.FieldValue=FieldValue;
    firestoreFn.Timestamp=DemoTimestamp;
    const firebase={
      apps:[{name:'[DEFAULT]',options:{projectId:'vista-teaching-lab-demo'}}],
      initializeApp:()=>firebase.apps[0],
      app:()=>firebase.apps[0],
      auth:authFn,
      firestore:firestoreFn,
      SDK_VERSION:'pages-demo'
    };
    return{firebase,store,db,auth};
  }

  function install(root){
    const seed=root.UCVM_PAGES_DEMO_SEED||{documents:[]};
    const runtime=createDemoFirebase(root,seed);
    root.firebase=runtime.firebase;
    root.UCVM_FRONTEND_DEMO_MODE=true;
    root.UCVM_PAGES_DEMO=Object.freeze({
      reset:()=>runtime.store.reset(),
      export:()=>runtime.store.export(),
      selectUser:uid=>runtime.auth._select(uid),
      backend:'browser-memory',
      doeAuthoritative:false
    });
    installToolbar(root,seed,runtime.store,runtime.auth);
    return runtime;
  }

  return{DemoTimestamp,FieldValue,createStore,createDemoFirebase,install,filterMatches,mergeObject};
});
