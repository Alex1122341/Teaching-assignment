'use strict';
(()=>{
 function backend(){
  try{
   const value=window.UCVM_PAWS_DATA?.sessionBackend?.();
   return typeof value==='string'?value.trim():'';
  }catch(_){return ''}
 }
 if(backend()==='vetmed-ops'&&window.UCVM_AFC_SQL){
  window.UCVM_AFC=window.UCVM_AFC_SQL;
  if(typeof addEventListener==='function')addEventListener('ucvm:afc-open',event=>window.UCVM_AFC_SQL.load(event.ucvmForce===true).catch(()=>{}));
  return;
 }
 const message='AFC requests and decisions require the PAWS University API and VetMed-Ops workflow. Firestore AFC access is disabled.';
 function mount(options={}){
  const panelId=String(options.panelId||'afc-panel'),target=window.document?.getElementById?.(panelId);
  if(target)target.innerHTML=`<p class="error">${message}</p>`;
  return false;
 }
 async function submit(){throw Error('AFC requests require the PAWS University API; browser Firestore submission is disabled.')}
 window.UCVM_AFC=Object.freeze({mount,submit,unavailable:true,message});
 if(typeof addEventListener==='function')addEventListener('ucvm:afc-open',event=>mount({panelId:event.panelId||'afc-panel'}));
})();
