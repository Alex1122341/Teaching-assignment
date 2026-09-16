(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_MAINTENANCE=api;
})(typeof window!=='undefined'?window:null,function(root){
 'use strict';
 const LOCKED_MESSAGE='Teaching Data Maintenance in Progress. Teaching and faculty-data editing is temporarily unavailable. Viewing remains available.';
 const BLOCKED_CLICK_SELECTORS=Object.freeze([
  '#add-session-btn','#bulk-add-session-btn','#select-sessions-btn','#review-selected-btn','#selection-save-btn',
  '#detail-edit','#detail-swap','#delete-session','.btn-swap-confirm',
  '#workflow-hicc-edit','#workflow-hicc-swap','#workflow-self-swap','[data-approve-request]','[data-reject-request]',
  '#add-btn','#save-edit','#import-btn','#import-afc-btn','#import-workload-btn','#import-summary-btn','[data-derived-index-rebuild]'
 ]);
 const BLOCKED_SUBMIT_SELECTORS=Object.freeze([
  '#session-form','#bulk-session-form','#workflow-edit-form','#workflow-hicc-swap-form','#workflow-self-swap-form','#workflow-self-take-form','#edit-form'
 ]);
 const emptyState=()=>({teachingDataWriteLocked:false,maintenanceMode:'none',activeImportId:'',maintenanceOwnerUid:'',maintenanceOwnerName:''});
 function normalizeState(data){const state=emptyState();if(!data||typeof data!=='object')return state;state.teachingDataWriteLocked=data.teachingDataWriteLocked===true;state.maintenanceMode=String(data.maintenanceMode||'none');state.activeImportId=String(data.activeImportId||'');state.maintenanceOwnerUid=String(data.maintenanceOwnerUid||'');state.maintenanceOwnerName=String(data.maintenanceOwnerName||'');return state}
 const isLocked=state=>normalizeState(state).teachingDataWriteLocked===true;
 function assertNormalWriteAllowed(state){if(isLocked(state))throw Error(LOCKED_MESSAGE);return true}
 function selectorMatch(target,selectors){if(!target||typeof target.closest!=='function')return null;for(const selector of selectors){const match=target.closest(selector);if(match)return match}return null}
 function create({db,auth,document:doc=root?.document,onBlocked}={}){
  let state=emptyState(),stateUnsub=null,authUnsub=null,started=false;
  const subscribers=new Set();
  const notify=()=>{for(const callback of subscribers){try{callback({...state})}catch(error){console.error?.('[maintenance subscriber]',error)}}};
  function ensureBanner(){if(!doc?.body)return null;let banner=doc.getElementById('teaching-maintenance-banner');if(banner)return banner;banner=doc.createElement('div');banner.id='teaching-maintenance-banner';banner.setAttribute('role','status');banner.style.cssText='display:none;position:sticky;top:0;z-index:100000;padding:9px 14px;background:#fff3cd;color:#5f4500;border-bottom:1px solid #e4c65a;font:600 12px/1.35 Arial,sans-serif;text-align:center';doc.body.prepend(banner);return banner}
  function applyDisabledState(){if(!doc?.querySelectorAll)return;const locked=isLocked(state),selectors=BLOCKED_CLICK_SELECTORS.join(',');for(const node of doc.querySelectorAll(selectors)){if('disabled' in node)node.disabled=locked;node.setAttribute?.('aria-disabled',locked?'true':'false');if(locked)node.setAttribute?.('title',LOCKED_MESSAGE);else if(node.getAttribute?.('title')===LOCKED_MESSAGE)node.removeAttribute?.('title')}}
  function render(){if(!doc)return;const banner=ensureBanner();doc.body?.classList?.toggle('teaching-maintenance-locked',isLocked(state));if(banner){banner.style.display=isLocked(state)?'block':'none';banner.textContent=isLocked(state)?`${LOCKED_MESSAGE}${state.maintenanceOwnerName?` Maintenance owner: ${state.maintenanceOwnerName}.`:''}`:''}applyDisabledState()}
  function setState(next){state=normalizeState(next);render();notify();return state}
  function current(){return{...state}}
  function blocked(event,selectors){if(!isLocked(state))return false;const match=selectorMatch(event.target,selectors);if(!match)return false;event.preventDefault?.();event.stopPropagation?.();event.stopImmediatePropagation?.();if(typeof onBlocked==='function')onBlocked(LOCKED_MESSAGE,match);else if(root?.dispatchEvent&&typeof root.CustomEvent==='function')root.dispatchEvent(new root.CustomEvent('ucvm:maintenance-write-blocked',{detail:{message:LOCKED_MESSAGE}}));return true}
  const clickGuard=event=>blocked(event,BLOCKED_CLICK_SELECTORS),submitGuard=event=>blocked(event,BLOCKED_SUBMIT_SELECTORS);
  function startStateListener(){if(stateUnsub){stateUnsub();stateUnsub=null}if(!db?.collection)return;stateUnsub=db.collection('settings').doc('system_state').onSnapshot(snapshot=>setState(snapshot.exists?snapshot.data():null),error=>{if(error?.code!=='permission-denied')console.warn?.('[maintenance state]',error);setState(null)})}
  function stopStateListener(){if(stateUnsub){stateUnsub();stateUnsub=null}}
  function start(){if(started)return api;started=true;doc?.addEventListener?.('click',clickGuard,true);doc?.addEventListener?.('submit',submitGuard,true);if(auth?.onAuthStateChanged)authUnsub=auth.onAuthStateChanged(user=>user?startStateListener():(stopStateListener(),setState(null)));else startStateListener();render();return api}
  function stop(){if(!started)return;started=false;stopStateListener();if(authUnsub){authUnsub();authUnsub=null}doc?.removeEventListener?.('click',clickGuard,true);doc?.removeEventListener?.('submit',submitGuard,true)}
  function subscribe(callback){subscribers.add(callback);callback({...state});return()=>subscribers.delete(callback)}
  const api={start,stop,current,subscribe,isLocked:()=>isLocked(state),assertNormalWriteAllowed:()=>assertNormalWriteAllowed(state),setState};
  return api;
 }
 let active=null;
 function autoStart(){if(!root||active||!root.UCVM||typeof root.firebase==='undefined')return active;try{const shared=root.UCVM.init();active=create({db:shared.db,auth:shared.auth,document:root.document,onBlocked:message=>{const toast=root.document?.getElementById('toast');if(toast){toast.textContent=message;toast.classList.add('show','error');setTimeout(()=>toast.classList.remove('show'),6000)}}});active.start()}catch(error){console.warn?.('[maintenance init]',error)}return active}
 if(root?.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',autoStart,{once:true});else autoStart()}
 return{LOCKED_MESSAGE,BLOCKED_CLICK_SELECTORS,BLOCKED_SUBMIT_SELECTORS,normalizeState,isLocked,assertNormalWriteAllowed,create,autoStart,current:()=>active?.current()||emptyState(),subscribe:callback=>{autoStart();return active?active.subscribe(callback):()=>{}},normalWritesAllowed:()=>!isLocked(active?.current()||emptyState())};
});
