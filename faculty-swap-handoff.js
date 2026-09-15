/* Deterministic handoff from the legacy faculty workflow to the privacy-safe replacement picker. */
(()=>{
 'use strict';
 if(!window.UCVM||typeof firebase==='undefined')return;
 const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
 if(page!=='index.html')return;
 const {db}=UCVM.init(),SESSIONS='sessions';
 let lastSessionId='';
 const sessionById=id=>window.UCVM_PAGE_DATA?.sessions?.().find(s=>String(s.id)===String(id))||null;
 function handoffError(message,error){
  if(error)console.error('[faculty swap handoff]',error);
  const toast=document.getElementById('toast');
  if(!toast){alert(message);return}
  toast.textContent=message;toast.classList.add('error','show');setTimeout(()=>toast.classList.remove('show'),6500);
 }
 document.addEventListener('click',async event=>{
  const sessionBlock=event.target.closest?.('[data-session-id]');
  if(sessionBlock?.dataset?.sessionId){lastSessionId=String(sessionBlock.dataset.sessionId);return}
  const button=event.target.closest?.('#workflow-self-swap');
  if(!button)return;
  if(!String(button.textContent||'').toLowerCase().includes('replacement for me'))return;
  const openSafe=window.UCVM_SAFE_SWAP?.openSelfReplacement;
  if(typeof openSafe!=='function')return;
  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
  try{
   let session=sessionById(lastSessionId);
   if(!session&&lastSessionId){
    const snap=await db.collection(SESSIONS).doc(lastSessionId).get();
    if(snap.exists)session={id:snap.id,...snap.data()};
   }
   if(!session)return handoffError('Could not resolve this session for the replacement request. Close the window and open the session again.');
   openSafe(session);
  }catch(error){handoffError('Could not open the faculty replacement picker. Please try again.',error)}
 },true);
})();
