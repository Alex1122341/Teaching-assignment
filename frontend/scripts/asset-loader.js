'use strict';
window.UCVM_ASSETS=(()=>{
 const pending=new Map();
 function loadScriptOnce(url,globalName){
  if(globalName&&window[globalName])return Promise.resolve(window[globalName]);
  if(pending.has(url))return pending.get(url);
  const promise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.async=true;script.onload=()=>resolve(globalName?window[globalName]:true);script.onerror=()=>{pending.delete(url);reject(Error(`Could not load ${url}`))};document.head.appendChild(script)});
  pending.set(url,promise);return promise;
 }
 async function ensureAfcPdf(){await loadScriptOnce('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib');await loadScriptOnce('afc-form-values.js','UCVM_AFC_FORM_VALUES');await loadScriptOnce('afc-pdf-browser.js','UCVM_AFC_PDF');return window.UCVM_AFC_PDF}
 async function ensureTrainees(){
  const css='faculty-admin-trainees.css';
  if(!document.querySelector('link[data-paws-trainees]')){const link=document.createElement('link');link.rel='stylesheet';link.href=css;link.dataset.pawsTrainees='1';document.head.appendChild(link);}
  return loadScriptOnce('faculty-admin-trainees.js','PAWS_TRAINEES');
 }
 function createTraineeEntry(options){
  let generation=0,view=null,selectedYear=null,identity=null;
  return {async open(){const id=++generation,next=JSON.stringify(options.getUser());if(identity!==next){selectedYear=null;identity=next;view?.destroy();view=null;}if(view)return view.refresh();try{const module=await ensureTrainees();if(id===generation&&options.getUser()?.uid)view=module.mount(options.host,{...options,getAcademicYear:()=>selectedYear||options.getAcademicYear(),onAcademicYearChange:year=>{selectedYear=year;}});}catch(_){if(id===generation&&options.host)options.host.textContent='Trainees could not be loaded. Reopen this tab to retry.';}},clear(){++generation;view?.destroy();view=null;if(options.host)options.host.innerHTML='';}};
 }
 function businessBackend(){
  try{
   const value=window.UCVM_PAWS_DATA?.sessionBackend?.();
   return typeof value==='string'?value.trim():'';
  }catch(_){return ''}
 }
 async function ensureReports(){
  if(!document.querySelector('link[data-paws-reports]')){const link=document.createElement('link');link.rel='stylesheet';link.href='faculty-reports.css';link.dataset.pawsReports='1';document.head.appendChild(link);}
  return loadScriptOnce('faculty-reports.js','PAWS_REPORTS');
 }
 function createReportEntry(options){
  let generation=0,view=null,identity=null;
  const key=()=>JSON.stringify([options.getUser()?.uid,options.getUser()?.role,options.getAcademicYear?.(),window.PAWS_SUPPORT?.contextId?.()||'']);
  const allowed=()=>options.getUser()?.uid&&(options.isAdministrator||window.UCVM?.admin)?.(options.getUser())&&!window.PAWS_SUPPORT?.contextId?.();
  return {async open(){const id=++generation,next=key();if(!allowed()){this.clear();return;}if(identity!==next){view?.destroy();view=null;identity=next;}if(view)return view.refresh();try{const module=await ensureReports();if(id===generation&&key()===next&&allowed())view=module.mount(options.host,options);}catch(_){if(id===generation&&key()===next&&options.host)options.host.textContent='Reports could not be loaded. Reopen this tab to retry.';}},clear(){++generation;view?.destroy();view=null;identity=null;if(options.host)options.host.innerHTML='';}};
 }
 async function ensureApprovalWorkflow(){
  return false;
 }
 function enableFacultyDashboardLink(){
  const button=document.getElementById('faculty-dashboard-btn'),profile=window.UCVM_PAGE_DATA?.profile?.();
  if(!button||!profile||!['faculty','hicc','visc'].includes(UCVM.role(profile?.role)))return;
  button.classList.remove('hidden');
  if(button.dataset.facultySelfDashboard==='1')return;
  button.dataset.facultySelfDashboard='1';
  button.addEventListener('click',()=>{window.location.href='faculty-admin.html'});
 }
 function enableTeachingAssignmentLink(){
  const button=document.getElementById('teaching-assignments-btn'),profile=window.UCVM_PAGE_DATA?.profile?.();
  if(!button||!profile||!['faculty','hicc','visc','owner','administrator','adfa_general','adfa_regular','admin'].includes(UCVM.role(profile?.role)))return;
  button.classList.remove('hidden');
  if(button.dataset.teachingAssignments==='1')return;
  button.dataset.teachingAssignments='1';
  button.addEventListener('click',()=>{window.location.href='teaching-assignments.html'});
 }
 function scheduleFacultyDashboardLink(){setTimeout(enableFacultyDashboardLink,0)}
 function loadApprovalWorkflowAfterPage(){ensureApprovalWorkflow().catch(error=>console.error('[approval workflow loader]',error));scheduleFacultyDashboardLink();setTimeout(enableTeachingAssignmentLink,0)}
 window.addEventListener('ucvm:sessions-updated',()=>{scheduleFacultyDashboardLink();enableTeachingAssignmentLink()});
 if(document.readyState==='complete')setTimeout(loadApprovalWorkflowAfterPage,0);else window.addEventListener('load',loadApprovalWorkflowAfterPage,{once:true});
 return{loadScriptOnce,ensureAfcPdf,ensureApprovalWorkflow,ensureTrainees,createTraineeEntry,ensureReports,createReportEntry};
})();
