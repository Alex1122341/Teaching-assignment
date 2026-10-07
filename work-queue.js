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
 const STAGE_LABEL={adc:'ADC/DVM',lab:'LAB',adfa:'ADFAD'};
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
 function buildViewModel({sessions=[],role='',offices=null,context={},workflow=null}={}){
  const api=workflow||(typeof window!=='undefined'?window.UCVM_SESSION_WORKFLOW:null);
  const empty={visible:false,total:0,offices:{},items:[],label:'',stage:'',ready:0,waiting:0};
  if(!api||!api.workflowItemsForRole)return empty;
  const explicit=Array.isArray(offices)?[...new Set(offices.filter(name=>api.STAGES.includes(name)))]:null;
  const legacy=api.stageForRole(role),stages=explicit||(legacy==='all'?api.STAGES.slice():(legacy?[legacy]:[]));
  if(!stages.length)return empty;
  const stage=stages.length===1?stages[0]:'all';
  const items=stages.flatMap(name=>api.workflowItemsForRole(sessions,name,context)||[]);
  const officeStats={};
  for(const name of api.STAGES)officeStats[name]={stage:name,label:STAGE_LABEL[name],ready:0,waiting:0,total:0};
  let ready=0,waiting=0;
  for(const item of items){
   const bucket=officeStats[item.stage];
   if(bucket){if(item.status==='ready'){bucket.ready+=1;ready+=1}else{bucket.waiting+=1;waiting+=1}bucket.total+=1}
  }
  const total=items.length;
  return{
   visible:total>0,total,ready,waiting,offices:officeStats,items,stage,
   label:stage==='all'?`${String(role).toLowerCase()==='developer'?'All':'Office'} Work (${total})`:`${STAGE_LABEL[stage]} Work (${total})`
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
   +`<button type="button" class="btn btn-primary" data-work-open="${esc(item.sessionId)}" data-work-open-stage="${esc(item.stage)}" data-work-open-date="${esc(text(session.date).slice(0,10))}"${item.status==='ready'?'':' disabled'}>Open Work</button>`
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
    const sessionId=text(open.dataset?.workOpen),stage=text(open.dataset?.workOpenStage),date=text(open.dataset?.workOpenDate).slice(0,10);
    if(!sessionId)return;
    // Opening real work closes the panel but never removes the button.
    closePanel();
    if(typeof onOpen==='function')onOpen({sessionId,stage,date,role:currentRole});
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

 /* Mount the Work Queue against the timetable page data contract.
  * `page` is window.UCVM_PAGE_DATA, which exposes profile(), sessions(),
  * ensureSessionsForRange() and subscribe(). Every render re-reads live session
  * data, and the academic-year range is loaded (with retries) because outstanding
  * work is not limited to the week on screen. */
 function mountForPage({document,page,host,onOpen=null}={}){
  if(!document||!page||typeof page.sessions!=='function')return null;
  const target=host||document.body;
  if(!target)return null;
  let controller=null,refreshing=false,yearLoaded=false,yearLoading=false;
  const waitFor=async(find,attempts=40)=>{
   for(let index=0;index<attempts;index+=1){
    const found=find();
    if(found)return found;
    await new Promise(resolve=>setTimeout(resolve,50));
   }
   return null;
  };
  // Opening Work goes to the real Select Sessions context for the target session
  // instead of opening another read-only information modal.
  const defaultOpen=async({sessionId,stage,date=''})=>{
   try{
    // Resolve the date before entering the scoped editor. The queue already knows
    // the session date, so pass it through; this lets the page reload a session
    // that was evicted from its cache between render and click.
    const session=(page.sessions()||[]).find(row=>String(row.id)===String(sessionId));
    const targetDate=String(date||session?.date||'').slice(0,10);
    // The timetable page owns the scoped editor. Using its entry point means the
    // Work Queue reuses the real Select Sessions editor, and a role without
    // unrestricted selection (LAB) still reaches the session it owns.
    if(typeof page.openScopedEditor==='function'){
     await page.openScopedEditor(sessionId,{stage,date:targetDate});
     return;
    }
    const dateValue=targetDate;
    if(dateValue&&typeof page.ensureSessionsForRange==='function')await page.ensureSessionsForRange(dateValue,dateValue);
    document.getElementById('cal-list-btn')?.click();
    const row=await waitFor(()=>document.querySelector(`[data-session-id="${String(sessionId).replace(/["\\]/g,'')}"]`));
    if(!row)return;
    row.click();
    const edit=await waitFor(()=>document.getElementById('detail-edit'));
    edit?.click();
   }catch(error){console.error('[work queue open]',error)}
  };
  const refresh=()=>{
   if(refreshing)return;
   refreshing=true;
   try{
    const profile=page.profile?.()||{},role=String(profile.role||'').toLowerCase(),caps=window.UCVM_OFFICE_CAPABILITIES;
    const offices=caps?.officesForProfile?.(profile)||null,context=page.workflowContext?.()||window.UCVM_WORK_QUEUE_CONTEXT||{};
    const view=buildViewModel({sessions:page.sessions()||[],role,offices,workflow:window.UCVM_SESSION_WORKFLOW,context});
    view.role=role;
    if(!controller)controller=createController({document,host:target,onOpen:onOpen||defaultOpen});
    controller.render(view);
   }catch(error){console.error('[work queue]',error)}
   finally{refreshing=false}
  };
  const ensureYear=async()=>{
   if(yearLoaded||yearLoading)return;
   const range=academicYearRange(academicYearForDate());
   if(!range||typeof page.ensureSessionsForRange!=='function'){yearLoaded=true;return}
   yearLoading=true;
   try{
    const rows=await page.ensureSessionsForRange(range.start,range.end);
    if(typeof page.ensureWorkflowContext==='function')await page.ensureWorkflowContext();
    if(Array.isArray(rows))yearLoaded=true;
   }catch(error){console.error('[work queue range]',error)}
   finally{yearLoading=false}
   if(yearLoaded)refresh();
  };
  const refreshAll=()=>{refresh();ensureYear()};
  refreshAll();
  if(typeof page.subscribe==='function')page.subscribe(refreshAll);
  for(const event of ['ucvm:assignment-recheck-required','ucvm:sessions-changed','ucvm:sessions-updated','ucvm:approval-applied'])window.addEventListener(event,refreshAll);
  setInterval(refreshAll,5000);
  return controller;
 }

 /* Wait for the timetable page data contract, then mount. Other pages never
  * publish it, so the Work Queue stays absent there. */
 function autoMount({document:doc,attempts=60,intervalMs=250}={}){
  const win=typeof window!=='undefined'?window:null;
  const target=doc||win?.document;
  if(!target)return Promise.resolve(null);
  return new Promise(resolve=>{
   let tries=0;
   const attempt=()=>{
    if(win?.UCVM_PAGE_DATA){resolve(mountForPage({document:target,page:win.UCVM_PAGE_DATA}));return}
    tries+=1;
    if(tries>=attempts){resolve(null);return}
    setTimeout(attempt,intervalMs);
   };
   attempt();
  });
 }

 /* Boot in the browser. The timetable page publishes UCVM_PAGE_DATA after its
  * own scripts run, so autoMount waits for it. */
 if(typeof window!=='undefined'&&window.document&&window.document.body){
  const boot=()=>{autoMount().catch(error=>console.error('[work queue mount]',error))};
  if(window.document.readyState==='loading')window.document.addEventListener('DOMContentLoaded',boot,{once:true});
  else setTimeout(boot,0);
 }

 return Object.freeze({PANEL_ID,BUTTON_ID,STAGE_LABEL,buildViewModel,officeSummaries,panelHtml,itemHtml,createController,mountForPage,autoMount,academicYearForDate,academicYearRange});
});
