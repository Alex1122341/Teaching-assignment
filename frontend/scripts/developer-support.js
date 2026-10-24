(function(root){
 'use strict';
 const showName=value=>root.PAWS_FACULTY_NAME.format(value);
 const KEY='paws-support-context-v1';let profile=null,support=null,dialog=null;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function saved(){try{return JSON.parse(root.sessionStorage.getItem(KEY)||'null');}catch{return null;}}
 function contextId(){const value=saved(),uid=root.firebase?.auth?.().currentUser?.uid;return value&&value.actorUid===uid?value.id:null;}
 async function call(action,body){const token=await root.firebase.auth().currentUser.getIdToken();const options={headers:{Authorization:'Bearer '+token},credentials:'omit'};if(body){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}const result=await fetch(root.PAWS_API_ORIGIN_CONFIG.apiOrigin+'/api/v1/support'+action,options);const data=await result.json();if(!result.ok)throw Error(data.error?.message||'Support action unavailable.');return data;}
 async function leave(){const value=saved();try{if(value)await call('/end',{contextId:value.id});}catch{}root.sessionStorage.removeItem(KEY);location.reload();}
 function close(){dialog?.remove();dialog=null;document.body.classList.remove('support-dialog-open');document.getElementById('developer-support-toggle')?.focus();}
 function renderIdentity(){
  let bar=document.getElementById('paws-support-strip');if(!bar){bar=document.createElement('div');bar.id='paws-support-strip';bar.className='paws-support-strip';document.body.prepend(bar);}
  const active=Boolean(support||saved());bar.hidden=!active;
  if(active){bar.innerHTML=`<span><strong>Developer support</strong> · ${esc(showName(support?.targetName||'Selected account'))} ${support?.targetRole?'· '+esc(support.targetRole):''} · Actions audited</span><button type="button" data-return>Return to myself</button>`;bar.querySelector('[data-return]').onclick=leave;}
  let button=document.getElementById('developer-support-toggle');
  if(!button){button=document.createElement('button');button.id='developer-support-toggle';button.className='workspace-tool';button.textContent='Developer support';button.type='button';const parent=document.querySelector('.timetable-top-actions,.masthead-actions,.header-actions,header');(parent||document.body).append(button);button.onclick=open;}
  button.hidden=!(profile?.role==='developer'||support||active);document.body.classList.toggle('paws-support-active',active);
 }
 async function open(){
  close();dialog=document.createElement('dialog');dialog.className='developer-support-dialog';dialog.innerHTML='<div class="workspace-dialog-heading"><h2>Developer support</h2><button type="button" data-close aria-label="Close developer support">×</button></div><p class="support-status" role="status">Loading accounts and operations…</p>';document.body.append(dialog);dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();
  try{
   const data=await call('');if(!dialog)return;
   const roles=[...new Set(data.accounts.map(a=>a.role))].sort();
   dialog.innerHTML=`<div class="workspace-dialog-heading"><div><h2>Developer support</h2><p>Use an existing account for a 30-minute support session.</p></div><button type="button" data-close aria-label="Close developer support">×</button></div><div class="support-columns"><form class="support-start"><label>Role<select name="role"><option value="">All roles</option>${roles.map(role=>`<option>${esc(role)}</option>`).join('')}</select></label><label>Account<select name="account" required></select></label><label>Support / test reason<textarea name="reason" required maxlength="1000" rows="4" placeholder="What are you investigating?"></textarea></label><p>Changes are real and audited. Undo restores captured data only when no later change conflicts.</p><button class="workspace-primary" type="submit">Start support</button>${saved()?'<button type="button" data-return>Return to myself</button>':''}</form><section><h3>Recent operations</h3><div class="support-operations">${data.operations.length?data.operations.map(op=>`<article><strong>${esc(showName(op.targetName||'Selected account'))}</strong><span>${esc(op.route)}</span><small>${esc(new Date(op.createdAtUtc).toLocaleString())} · ${esc(op.changeCount)} record changes</small><button type="button" data-undo="${esc(op.id)}" ${op.undoneAtUtc||!Number(op.changeCount)?'disabled':''}>${op.undoneAtUtc?'Restored':!Number(op.changeCount)?'No data change':'Undo'}</button></article>`).join(''):'<p>No support operations yet.</p>'}</div></section></div><p class="support-status" role="status"></p>`;
   dialog.querySelector('[data-close]').onclick=close;dialog.querySelector('[data-return]')?.addEventListener('click',leave);
   const form=dialog.querySelector('form'),account=form.elements.account,role=form.elements.role;
   const update=()=>{const rows=data.accounts.filter(a=>!role.value||a.role===role.value);account.innerHTML=rows.length?rows.map(a=>`<option value="${esc(a.uid)}">${esc(showName(a.name))} · ${esc(a.role)}</option>`).join(''):'<option value="">None available</option>';};role.onchange=update;update();
   form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{const result=await call('/start',{targetUid:account.value,reason:form.elements.reason.value});root.sessionStorage.setItem(KEY,JSON.stringify({id:result.contextId,actorUid:root.firebase.auth().currentUser.uid}));location.reload();}catch(error){dialog.querySelector('.support-status').textContent=error.message;button.disabled=false;}};
   dialog.querySelectorAll('[data-undo]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await call('/undo',{operationId:button.dataset.undo});await open();root.dispatchEvent(new Event('paws-support-restored'));}catch(error){dialog.querySelector('.support-status').textContent=error.message;button.disabled=false;}});
  }catch(error){if(dialog)dialog.querySelector('.support-status').textContent=error.message;}
 }
 root.PAWS_SUPPORT=Object.freeze({contextId,open,leave});
 root.addEventListener('paws-profile',event=>{profile=event.detail.profile;support=event.detail.support;renderIdentity();});
 root.addEventListener('paws-support-restored',()=>location.reload());
 root.addEventListener('DOMContentLoaded',()=>{
  if(!saved())return;renderIdentity();
  if(/\/(user-management|password)\.html$/.test(location.pathname)){
   document.querySelector('main')?.setAttribute('inert','');
   const label=document.querySelector('#paws-support-strip span');
   label.textContent='Support paused · Return to yourself to manage accounts or credentials.';
  }
 });
})(window);
