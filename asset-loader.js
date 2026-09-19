'use strict';
window.UCVM_ASSETS=(()=>{
 const pending=new Map();
 function loadScriptOnce(url,globalName){
  if(globalName&&window[globalName])return Promise.resolve(window[globalName]);
  if(pending.has(url))return pending.get(url);
  const promise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.async=true;script.onload=()=>resolve(globalName?window[globalName]:true);script.onerror=()=>{pending.delete(url);reject(Error(`Could not load ${url}`))};document.head.appendChild(script)});
  pending.set(url,promise);return promise;
 }
 async function ensureAfcPdf(){await loadScriptOnce('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib');await loadScriptOnce('bundles/afc-pdf.lazy.bundle.js','UCVM_AFC_PDF');return window.UCVM_AFC_PDF}
 async function ensureApprovalWorkflow(){await loadScriptOnce('approval-request.js','UCVM_APPROVAL_REQUEST');await loadScriptOnce('faculty-swap-safe.js','UCVM_SAFE_SWAP');await loadScriptOnce('bundles/approval-workflow.lazy.bundle.js');return true}
 function enableFacultyDashboardLink(){
  const button=document.getElementById('faculty-dashboard-btn'),profile=window.UCVM_PAGE_DATA?.profile?.();
  if(!button||!profile||!['faculty','hicc','visc'].includes(UCVM.role(profile?.role)))return;
  button.classList.remove('hidden');
  if(button.dataset.facultySelfDashboard==='1')return;
  button.dataset.facultySelfDashboard='1';
  button.addEventListener('click',()=>{window.location.href='faculty-admin.html'});
 }
 function scheduleFacultyDashboardLink(){setTimeout(enableFacultyDashboardLink,0)}
 function loadApprovalWorkflowAfterPage(){ensureApprovalWorkflow().catch(error=>console.error('[approval workflow loader]',error));scheduleFacultyDashboardLink()}
 window.addEventListener('ucvm:sessions-updated',scheduleFacultyDashboardLink);
 if(document.readyState==='complete')setTimeout(loadApprovalWorkflowAfterPage,0);else window.addEventListener('load',loadApprovalWorkflowAfterPage,{once:true});
 return{loadScriptOnce,ensureAfcPdf,ensureApprovalWorkflow};
})();
