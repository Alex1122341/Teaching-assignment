(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DERIVED_INDEX_HEALTH=api;
})(typeof window!=='undefined'?window:null,function(root){
 'use strict';
 const IDS=Object.freeze(['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map']);
 const text=value=>String(value??'');
 const esc=value=>text(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const canManualRebuild=(profile,access)=>Boolean(access?.general?.(profile));
 const statusRows=report=>IDS.map(id=>({id,status:report?.documents?.[id]||'unchecked'}));
 const reportSummary=report=>{const severity=text(report?.severity||'unchecked').toLowerCase();return{severity,label:severity.toUpperCase(),count:Number(report?.mismatchCount)||0}};
 function displayValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='string')return value;try{return JSON.stringify(value)}catch(_){return String(value)}}
 function checkedTime(value){if(!value)return'Not checked yet.';try{return new Date(value).toLocaleString('en-CA',{timeZone:'America/Edmonton'})}catch(_){return text(value)}}
 function installStyle(doc){
  if(!doc?.head||doc.getElementById('derived-index-health-style'))return;
  const style=doc.createElement('style');style.id='derived-index-health-style';style.textContent=`
.derived-index-health-card{margin:14px 12px;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface2)}
.derived-index-health-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}.derived-index-health-head h2{margin:2px 0 4px;font-size:17px}.derived-index-health-head p{margin:0;color:var(--muted);font-size:11px}.derived-index-health-actions{display:flex;gap:8px;flex-wrap:wrap}
.derived-index-health-overall{margin-top:12px;font-weight:850}.derived-index-health-status{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px;margin-top:10px}.derived-index-health-doc{padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--surface)}.derived-index-health-doc strong{display:block;font-size:11px}.derived-index-health-doc span{font-size:10px;font-weight:850;text-transform:uppercase}.derived-index-health-doc[data-status="healthy"] span{color:var(--green)}.derived-index-health-doc[data-status="mismatch"] span{color:var(--amber)}.derived-index-health-doc[data-status="critical"] span{color:var(--red)}
.derived-index-health-diffs{margin-top:10px}.derived-index-health-diff{padding:8px 0;border-top:1px solid var(--border);font-size:11px;line-height:1.45}.derived-index-health-diff code{font-size:10.5px;overflow-wrap:anywhere}.derived-index-health-error{margin-top:10px;padding:9px;border:1px solid #efb2b2;background:#fff7f7;color:var(--red);border-radius:7px;font-size:11px}.derived-index-health-note{margin-top:9px;color:var(--muted);font-size:11px}.derived-index-health-critical{color:var(--red);font-weight:700}
@media(max-width:760px){.derived-index-health-status{grid-template-columns:repeat(2,minmax(0,1fr))}.derived-index-health-card{margin:12px}}
`;doc.head.appendChild(style);
 }
 function createRuntime({document:doc,window:win,db,profile,actor,access,indexMaintenance,maintenance}={}){
  if(!doc||!db||!profile||!access||!indexMaintenance)throw Error('Derived index health runtime dependencies are incomplete.');
  let report=null,busy=false,operationalError='',maintenanceUnsub=null;
  const $=id=>doc.getElementById(id);
  installStyle(doc);
  function render(){
   const general=canManualRebuild(profile,access),rebuildButton=$('derived-index-rebuild'),verifyButton=$('derived-index-verify'),meta=$('derived-index-health-meta'),status=$('derived-index-health-status'),diffs=$('derived-index-health-diffs');
   rebuildButton?.classList?.toggle('hidden',!general);
   const writesAllowed=maintenance?.normalWritesAllowed?.()!==false;
   if(rebuildButton)rebuildButton.disabled=busy||!report||report.severity!=='mismatch'||!writesAllowed;
   if(verifyButton)verifyButton.disabled=busy;
   if(operationalError){
    if(meta)meta.textContent='Verification could not be completed.';
    if(status)status.innerHTML='';
    if(diffs)diffs.innerHTML=`<div class="derived-index-health-error"><strong>Operational error:</strong> ${esc(operationalError)}</div>`;
    return;
   }
   if(!report){
    if(meta)meta.textContent='Not checked yet. Verify is read-only and does not repair data.';
    if(status)status.innerHTML='';
    if(diffs)diffs.innerHTML='';
    return;
   }
   const summary=reportSummary(report),counts=report.counts||{};
   if(meta)meta.textContent=`Last checked: ${checkedTime(report.checkedAt)} · Faculty checked: ${Number(counts.faculty)||0} · Sessions checked: ${Number(counts.sessions)||0}`;
   if(status)status.innerHTML=statusRows(report).map(row=>`<div class="derived-index-health-doc" data-status="${esc(row.status)}"><strong>${esc(row.id)}</strong><span>${esc(row.status)}</span></div>`).join('');
   const details=(report.mismatches||[]).map(row=>`<div class="derived-index-health-diff"><strong>${esc(row.document||'derived index')}</strong> · <code>${esc(row.path||row.issue||'document')}</code><br>${esc(row.issue||'value-mismatch')} · Expected: <code>${esc(displayValue(row.expected))}</code> · Actual: <code>${esc(displayValue(row.actual))}</code></div>`).join('');
   const remaining=Math.max(0,(Number(report.mismatchCount)||0)-(report.mismatches||[]).length),critical=summary.severity==='critical'?'<div class="derived-index-health-note derived-index-health-critical">Automatic rebuild is unavailable because swap identity ownership is ambiguous.</div>':'';
   if(diffs)diffs.innerHTML=`<div class="derived-index-health-overall">Overall: ${esc(summary.label)}${summary.count?` · ${summary.count} mismatch${summary.count===1?'':'es'}`:''}</div>${critical}${details}${remaining?`<div class="derived-index-health-note">${remaining} additional mismatch${remaining===1?'':'es'} not shown.</div>`:''}`;
  }
  async function verify(){
   busy=true;operationalError='';render();
   try{report=await indexMaintenance.verifyDerivedIndexes(db)}catch(error){operationalError=error?.message||String(error)}finally{busy=false;render()}
   return report;
  }
  async function rebuild(){
   if(!canManualRebuild(profile,access)||report?.severity!=='mismatch')return report;
   if(maintenance?.normalWritesAllowed?.()===false)return report;
   if(win?.confirm&&!win.confirm('Rebuild the four derived indexes from current Faculty and Session data? Source Faculty and Session records will not be changed.'))return report;
   busy=true;operationalError='';render();
   try{report=await indexMaintenance.rebuildDerivedIndexes(db,actor)}catch(error){if(error?.report)report=error.report;operationalError=error?.message||String(error)}finally{busy=false;render()}
   return report;
  }
  $('derived-index-verify')?.addEventListener('click',verify);
  $('derived-index-rebuild')?.addEventListener('click',rebuild);
  if(typeof maintenance?.subscribe==='function')maintenanceUnsub=maintenance.subscribe(()=>render());
  render();
  return{verify,rebuild,render,currentReport:()=>report,destroy:()=>maintenanceUnsub?.()};
 }
 async function autoStart(){
  if(!root?.document||!root.UCVM||typeof root.firebase==='undefined')return null;
  const page=(root.location?.pathname?.split('/').pop()||'').toLowerCase();if(page&&page!=='faculty-admin.html')return null;
  try{
   const{auth,db}=root.UCVM.init();
   return await new Promise(resolve=>{
    const unsub=auth.onAuthStateChanged(async user=>{
     if(!user)return;
     try{
      const snap=await db.collection('users').doc(user.uid).get(),profile=snap.exists?snap.data():null;
      if(!profile||profile.active!==true||!root.UCVM.admin(profile))return;
      unsub?.();
      const actor={uid:user.uid,email:user.email||'',name:profile.name||user.displayName||user.email||'Administrator'};
      resolve(createRuntime({document:root.document,window:root,db,profile,actor,access:root.UCVM,indexMaintenance:root.UCVM_INDEX_MAINTENANCE,maintenance:root.UCVM_MAINTENANCE}));
     }catch(error){console.error?.('[derived index health]',error);resolve(null)}
    });
   });
  }catch(error){console.error?.('[derived index health init]',error);return null}
 }
 if(root?.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>autoStart(),{once:true});else autoStart()}
 return{canManualRebuild,statusRows,reportSummary,createRuntime,autoStart};
});
