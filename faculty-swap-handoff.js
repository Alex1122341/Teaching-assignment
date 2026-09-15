/* Deterministic handoff from the legacy faculty workflow to the privacy-safe replacement picker. */
(()=>{
 'use strict';
 if(!window.UCVM||typeof firebase==='undefined')return;
 const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
 if(page!=='index.html')return;
 let lastSessionId='';
 const sessionById=id=>window.UCVM_PAGE_DATA?.sessions?.().find(s=>String(s.id)===String(id))||null;
 document.addEventListener('click',event=>{
  const sessionBlock=event.target.closest?.('[data-session-id]');
  if(sessionBlock?.dataset?.sessionId){lastSessionId=String(sessionBlock.dataset.sessionId);return}
  const button=event.target.closest?.('#workflow-self-swap');
  if(!button)return;
  if(!String(button.textContent||'').toLowerCase().includes('replacement for me'))return;
  const session=sessionById(lastSessionId);
  if(!session||!window.UCVM_SAFE_SWAP?.openSelfReplacement)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
  window.UCVM_SAFE_SWAP.openSelfReplacement(session);
 },true);
})();
