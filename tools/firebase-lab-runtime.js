'use strict';
// Firebase Lab browser runtime.
//
// Firebase Lab mode is the second PAWS browser test mode. It uses the real
// Firebase Web SDK against the isolated lab project `vista-teaching-lab`, with
// real Authentication, real Cloud Firestore and real Firestore security rules.
//
// It deliberately does NOT install the GitHub Pages synthetic Firebase
// compatibility runtime, and it never replaces `window.firebase`.
(function(root){
  if(!root)return;

  const LAB_PROJECT_ID='vista-teaching-lab';
  const BAR_ID='ucvm-firebase-lab-status';

  // Fail closed: the two browser test modes must never both be active.
  if(root.UCVM_FRONTEND_DEMO_MODE===true||root.UCVM_PAGES_DEMO){
    root.console&&root.console.error('Firebase Lab runtime refused to start: Frontend Demo mode is active.');
    return;
  }

  root.UCVM_FIREBASE_LAB_MODE=true;
  root.UCVM_FIREBASE_MODE='lab';
  root.UCVM_FIREBASE_PROJECT_ID=LAB_PROJECT_ID;
  root.UCVM_FIREBASE_EMULATOR=false;

  const labDoe=root.UCVM_DOE_FIREBASE_LAB||null;
  if(labDoe&&typeof labDoe.browserService==='function'){
    try{
      root.UCVM_DOE_LAB_SERVICE=labDoe.browserService();
    }catch(error){
      root.UCVM_DOE_LAB_SERVICE=null;
      root.UCVM_LAB_DOE_ERROR=error&&error.code?error.code:String(error&&error.message||error);
    }
  }

  function sdk(){
    return root.firebase||null;
  }

  // Firebase Lab mode uses the real Firebase Authentication SDK. There is no
  // synthetic auth: firebase.auth() is the only identity source, and the
  // signed-in uid is what resolves the caller's users/ profile document.
  function authInstance(){
    const firebase=root.firebase||null;
    if(!firebase||typeof firebase.auth!=='function')return null;
    try{
      return firebase.auth();
    }catch(error){
      return null;
    }
  }

  function firestoreState(){
    const lib=sdk();
    if(!lib||typeof lib.firestore!=='function')return{connected:false,label:'unavailable'};
    try{
      const instance=lib.firestore();
      const projectId=String(instance&&instance.app&&instance.app.options&&instance.app.options.projectId||'');
      return{connected:true,projectId,label:projectId===LAB_PROJECT_ID?'connected':'project mismatch'};
    }catch(error){
      return{connected:false,label:'error'};
    }
  }

  function status(){
    const auth=authInstance();
    const user=auth&&auth.currentUser?auth.currentUser:null;
    const store=firestoreState();
    return{
      mode:'firebase-lab',
      projectId:LAB_PROJECT_ID,
      auth:user?'connected':'signed-out',
      authUid:user?String(user.uid||''):'',
      firestore:store.label,
      firestoreProjectId:store.projectId||'',
      doePolicyData:root.UCVM_DOE_LAB_SERVICE?'LIVE':'unavailable',
      doeAuthoritativeWriter:'OFF',
      syntheticRuntime:false
    };
  }
  root.UCVM_LAB_STATUS=status;

  function render(){
    if(!root.document)return;
    if(root.document.getElementById(BAR_ID)){
      update(root.document.getElementById(BAR_ID));
      return;
    }
    const style=root.document.createElement('style');
    style.id=BAR_ID+'-style';
    style.textContent='#'+BAR_ID+'{position:fixed;left:12px;bottom:12px;z-index:2147483646;width:min(430px,calc(100vw - 24px));background:#e7f1ff;color:#0b2d5c;padding:10px 12px;border:2px solid #1a4f96;border-radius:10px;font:600 12px/1.4 Arial,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.28)}#'+BAR_ID+' .lab-title{font-size:13px;font-weight:900;letter-spacing:.04em}#'+BAR_ID+' dl{margin:6px 0 0;display:grid;grid-template-columns:auto 1fr;gap:2px 8px}#'+BAR_ID+' dt{font-weight:800}#'+BAR_ID+' dd{margin:0}#'+BAR_ID+' small{display:block;margin-top:6px;color:#20456f;font-weight:600}';
    root.document.head.appendChild(style);
    const bar=root.document.createElement('div');
    bar.id=BAR_ID;
    bar.setAttribute('role','status');
    const title=root.document.createElement('div');
    title.className='lab-title';
    title.textContent='FIREBASE LAB — TEST MODE';
    const list=root.document.createElement('dl');
    const note=root.document.createElement('small');
    note.textContent='Real Authentication, Firestore and security rules · lab data only · no production project · no credentials shown';
    bar.append(title,list,note);
    root.document.body.appendChild(bar);
    update(bar);
  }

  function update(bar){
    if(!bar)return;
    const state=status();
    const rows=[
      ['Project',state.projectId],
      ['Auth',state.auth],
      ['Firestore',state.firestore],
      ['DOE policy data',state.doePolicyData],
      ['DOE authoritative writer',state.doeAuthoritativeWriter]
    ];
    const list=bar.querySelector('dl');
    if(!list)return;
    list.textContent='';
    for(const [label,value] of rows){
      const dt=root.document.createElement('dt');
      dt.textContent=label+':';
      const dd=root.document.createElement('dd');
      dd.textContent=value;
      list.append(dt,dd);
    }
  }

  function watch(){
    const auth=authInstance();
    if(auth&&typeof auth.onAuthStateChanged==='function'){
      try{
        auth.onAuthStateChanged(()=>render());
      }catch(error){/* auth not initialised yet */}
    }
  }

  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>{render();watch()},{once:true});
    else{render();watch()}
  }
})(typeof window!=='undefined'?window:null);
