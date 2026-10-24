(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const periods=r=>Array.isArray(r.validityPeriods)?r.validityPeriods:[{startDate:r.effectiveDate||'',endDate:r.expirationDate||''}];
 // Preserve the eight-byte SQL concurrency token across old/new API transports.
 // A malformed token must never become null: that would discard stale protection.
 function versionForSave(value){
  if(value==null)return null;
  if(typeof value==='string'){
   const match=/^(?:0x)?([0-9a-f]{16})$/i.exec(value.trim());
   if(match)return '0x'+match[1].toUpperCase();
  }else if(value.type==='Buffer'&&Array.isArray(value.data)&&value.data.length===8&&
   value.data.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255)){
   return '0x'+value.data.map(byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
  }
  throw Error('Appointment version is unavailable. Close and reload this appointment before editing.');
 }
 function status(r,asOf=today()){
  if(r.facultyResolutionStatus==='manual_adjustment')return {key:'not-applicable',label:'Not applicable'};
  const p=periods(r);
  if(p.some(w=>w.startDate&&w.startDate<=asOf&&(!w.endDate||asOf<=w.endDate)))return {key:'active',label:'Active'};
  if(p.some(w=>!w.startDate&&(!w.endDate||asOf<=w.endDate)))return {key:'dates-needed',label:'Dates needed'};
  return {key:'inactive',label:!p.length?'Inactive · no effective periods':p.every(w=>w.startDate>asOf)?'Inactive · not started':p.every(w=>w.endDate&&w.endDate<asOf)?'Inactive · ended':'Inactive · paused'};
 }
 const summary=r=>periods(r).map(w=>`${w.startDate||'Start needed'} → ${w.endDate||'No end date'}`).join('; ')||'No effective periods';
 function create({canWrite,getRoles,onChanged,notify}){
  let current=null,windows=[],saving=false;
  let dialog;
  function render(){
   dialog.innerHTML=`<form><h2>Edit Role / Appointment</h2><p>${esc(current.roleType)} · ${esc(current.courseOrSubjectOrRotation)}</p><p>Start and end dates are inclusive. Gaps are inactive. DOE is unchanged. Removing a period here does not delete the appointment.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Start date</th><th>End date (optional)</th><th>Actions</th></tr></thead><tbody>${windows.map((w,i)=>`<tr><td><input class="input" type="date" required data-start="${i}" aria-label="Start date period ${i+1}" value="${esc(w.startDate)}"></td><td><input class="input" type="date" data-end="${i}" aria-label="End date period ${i+1}" value="${esc(w.endDate)}"></td><td><button type="button" class="btn" data-end-today="${i}">End today</button> <button type="button" class="btn" data-remove="${i}">Remove period</button></td></tr>`).join('')}</tbody></table></div><button type="button" class="btn" data-add>Add effective period</button><div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save periods</button><span role="status" data-status></span></div></form>`;
  }
  function read(){windows=windows.map((w,i)=>({startDate:dialog.querySelector(`[data-start="${i}"]`).value,endDate:dialog.querySelector(`[data-end="${i}"]`).value||null}));}
  function ensureDialog(){
   if(dialog)return;dialog=document.createElement('dialog');dialog.className='faculty-edit-dialog';dialog.setAttribute('aria-label','Edit role effective periods');document.body.appendChild(dialog);
  dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
  dialog.addEventListener('click',e=>{
   if(saving)return;
   const b=e.target.closest('button');if(!b)return;
   if(b.hasAttribute('data-close'))return dialog.close();
   if(b.hasAttribute('data-add')){read();if(windows.length>=12)return notify('At most 12 effective periods.',true);windows.push({startDate:'',endDate:null});render();}
   if(b.hasAttribute('data-remove')){read();windows.splice(Number(b.dataset.remove),1);render();}
   if(b.hasAttribute('data-end-today')){read();windows[Number(b.dataset.endToday)].endDate=today();render();}
  });
  dialog.addEventListener('submit',async e=>{
   e.preventDefault();if(saving)return;read();saving=true;
   dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
   const message=dialog.querySelector('[data-status]');
   try{message.textContent='Saving…';const expectedVersion=versionForSave(current.scheduleVersion);await UCVM_PAWS_DATA.updateRolePeriods(current.roleAssignmentId,{expectedVersion,periods:windows});dialog.close();notify('Role effective periods saved. DOE unchanged.');await onChanged(current.facultyId);}
   catch(error){message.textContent=error?.message||'Could not save effective periods.';}
   finally{saving=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
  }
  document.addEventListener?.('click',e=>{
   const b=e.target.closest?.('[data-role-period-edit]');if(!b||!canWrite()||saving)return;
   const r=getRoles().find(r=>r.roleAssignmentId===b.dataset.rolePeriodEdit);if(!r||r.facultyResolutionStatus==='manual_adjustment')return;
   ensureDialog();current=r;windows=periods(r).map(w=>({...w}));render();dialog.showModal();
  });
  return {action:r=>canWrite()&&r.facultyResolutionStatus!=='manual_adjustment'?`<button class="btn btn-small" type="button" data-role-period-edit="${esc(r.roleAssignmentId)}">Edit periods</button>`:''};
 }
 window.PAWS_ROLE_PERIODS=Object.freeze({today,periods,status,summary,create});
})();

