/* Operational Work Queue.
 *
 * The Work Queue answers "which required work is still outstanding on a session,
 * and which office owns it". It is deliberately independent of notifications:
 * closing the panel, or closing notifications, must never remove the button,
 * unsubscribe from data, or mark work complete.
 *
 * Items are identified by sessionId + stage only. The caller re-resolves live
 * session data on every render, so a session whose date/time/topic changed shows
 * the new value instead of a stale snapshot.
 *
 * All scope knowledge comes from UCVM_SESSION_WORKFLOW; this module never
 * re-derives field ownership.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_WORK_QUEUE=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const STAGE_LABEL={adc:'ADC',lab:'LAB',adfa:'ADFA'};
 const PANEL_ID='ucvm-work-queue-panel';
 const BUTTON_ID='ucvm-work-queue-btn';
 const text=value=>String(value??'').trim();
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

 /* The Work Queue answers "what is outstanding", which is not limited to the week
  * currently on screen, so it needs the academic-year date range. */
 function academicYearForDate(date=new Date()){
  const value=date instanceof Date?date:new Date(date);
  if(Number.isNaN(value.getTime()))return'';
  const year=value.getFullYear(),month=value.getMonth()+1,start=month>=8?year:year-1;
  return`${start}-${String((start+1)%100).padStart(2,'0')}`;
 }
 function academicYearRange(academicYear){
  const match=String(academicYear||'').match(/^(\d{4})-(\d{2})$/);
  if(!match)return null;
  const start=Number(match[1]);
  return{start:`${start}-08-01`,end:`${start+1}-07-31`};
 }

 /* Pure view model. Never mutates the sessions it is given. */
 function buildViewModel({sessions=[],role='',context={},workflow=null}={}){
  const api=workflow||(typeof window!=='undefined'?window.UCVM_SESSION_WORKFLOW:null);
  const empty={visible:false,total:0,offices:{},items:[],label:'',stage:'',ready:0,waiting:0};
  if(!api||!api.workflowItemsForRole)return empty;
  const stage=api.stageForRole(role);
  if(!stage)return empty;
  const items=api.workflowItemsForRole(sessions,role,context)||[];
  const offices={};
  for(const name of api.STAGES)offices[name]={stage:name,label:STAGE_LABEL[name],ready:0,waiting:0,total:0};
  let ready=0,waiting=0;
  for(const item of items){
   const bucket=offices[item.stage];
   if(bucket){if(item.status==='ready'){bucket.ready+=1;ready+=1}else{bucket.waiting+=1;waiting+=1}bucket.total+=1}
  }
  const total=items.length;
  return{
   visible:total>0,total,ready,waiting,offices,items,stage,
   label:stage==='all'?`All Work (${total})`:`${STAGE_LABEL[stage]} Work (${total})`
  };
 }

 /* Grouped counters for the panel header, e.g.
  *   LAB Work      READY — 4   WAITING FOR ADC — 7
  *   ADFA Work     READY — 12  WAITING FOR LAB — 5   WAITING FOR ADC — 3
  */
 function officeSummaries(view){
  if(!view)return[];
  return Object.values(view.offices||{}).filter(office=>office.total>0).map(office=>{
   const items=(view.items||[]).filter(item=>item.stage===office.stage);
   const waitingFor={};
   for(const item of items){
    if(item.status!=='waiting')continue;
    const key=text(item.waitingFor)||'ANOTHER OFFICE';
    waitingFor[key]=(waitingFor[key]||0)+1;
   }
   return{stage:office.stage,label:office.label,ready:office.ready,waiting:office.waiting,total:office.total,waitingFor};
  });
 }

 function itemHtml(item){
  const status=item.status==='ready'?'READY':`WAITING FOR ${esc(text(item.waitingFor)||'ANOTHER OFFICE')}`;
  const session=item.session||{};
  const when=[text(session.date),text(session.start)&&text(session.end)?`${text(session.start)}–${text(session.end)}`:''].filter(Boolean).join(' · ');
  const heading=[text(session.course),text(session.topic)].filter(Boolean).join(' · ')||item.sessionId;
  return`<li class="work-queue-item ${esc(item.status)}" data-work-session="${esc(item.sessionId)}" data-work-stage="${esc(item.stage)}">`
   +`<div class="work-queue-item-head"><strong>${esc(heading)}</strong><span class="work-queue-pill ${esc(item.status)}">${status}</span></div>`
   +`<div class="work-queue-item-meta">${esc(when||'Schedule not set')}</div>`
   +`<div class="work-queue-item-missing">Missing: ${esc((item.missingLabels||[]).join(', ')||'—')}</div>`
   +`<button type="button" class="btn btn-primary" data-work-open="${esc(item.sessionId)}" data-work-open-stage="${esc(item.stage)}"${item.status==='ready'?'':' disabled'}>Open Work</button>`
   +`</li>`;
 }

 function panelHtml(view){
  const summaries=officeSummaries(view);
  const header=summaries.map(office=>`<div class="work-queue-summary"><strong>${esc(office.label)} Work</strong><span>READY — ${office.ready}</span><span>WAITING — ${office.waiting}</span>${Object.entries(office.waitingFor).map(([name,count])=>`<span class="work-queue-waiting">WAITING FOR ${esc(name)} — ${count}</span>`).join('')}</div>`).join('');
  const groups=summaries.map(office=>`<section class="work-queue-group"><h3>${esc(office.label)} Work</h3><ul class="work-queue-list">${(view.items||[]).filter(item=>item.stage===office.stage).map(itemHtml).join('')}</ul></section>`).join('');
  return`<div class="work-queue-head"><strong>Work Queue</strong><button type="button" class="btn" data-work-close aria-label="Close Work Queue">Close</button></div>`
   +`<div class="work-queue-summaries">${header}</div>`
   +`${groups||'<div class="work-queue-empty">No outstanding required work.</div>'}`;
 }

 /* DOM controller. `document` is injectable so the state machine is testable.
  * Closing the panel only hides it: the button stays mounted, the session
  * provider stays subscribed and no item is mutated. */
 function createController({document,host,onOpen,id=PANEL_ID,buttonId=BUTTON_ID}={}){
  if(!document||!host)throw Error('A document and host element are required.');
  let panel=null,button=null,lastView=null,currentRole='';
  const ensurePanel=()=>{
   if(panel&&panel.isConnected!==false)return panel;
   panel=document.createElement('section');
   panel.id=id;
   panel.className='work-queue-panel hidden';
   panel.setAttribute('aria-label','Work Queue');
   panel.addEventListener('click',event=>{
    const target=event.target;
    const close=target?.closest?.('[data-work-close]');
    if(close){closePanel();return}
    const open=target?.closest?.('[data-work-open]');
    if(!open||open.disabled)return;
    const sessionId=text(open.dataset?.workOpen),stage=text(open.dataset?.workOpenStage);
    if(!sessionId)return;
    // Opening real work closes the panel but never removes the button.
    closePanel();
    if(typeof onOpen==='function')onOpen({sessionId,stage,role:currentRole});
   });
   host.appendChild(panel);
   return panel;
  };
  const ensureButton=()=>{
   if(button&&button.isConnected!==false)return button;
   button=document.createElement('button');
   button.type='button';
   button.id=buttonId;
   button.className='btn work-queue-button hidden';
   button.addEventListener('click',()=>{panel?.classList?.contains('hidden')?openPanel():closePanel()});
   host.appendChild(button);
   return button;
  };
  const render=view=>{
   lastView=view;currentRole=text(view?.role);
   const btn=ensureButton();
   btn.textContent=view?.label||'Work Queue';
   // The button exists for as long as there is outstanding work.
   btn.classList.toggle('hidden',!view?.visible);
   const body=ensurePanel();
   body.innerHTML=panelHtml(view);
   return view;
  };
  const openPanel=()=>{const body=ensurePanel();body.classList.remove('hidden');return true};
  const closePanel=()=>{panel?.classList?.add('hidden');return false};
  const isOpen=()=>Boolean(panel)&&panel.classList.contains('hidden')===false;
  const isButtonMounted=()=>Boolean(button)&&button.isConnected!==false;
  return{
   render,open:openPanel,close:closePanel,isOpen,isButtonMounted,
   get view(){return lastView},
   get panel(){return panel},
   get button(){return button},
   // Detach only when the whole feature is torn down, never from a close action.
   destroy(){panel?.remove?.();button?.remove?.();panel=null;button=null}
  };
 }

 return Object.freeze({PANEL_ID,BUTTON_ID,STAGE_LABEL,buildViewModel,officeSummaries,panelHtml,itemHtml,createController,academicYearForDate,academicYearRange});
});
