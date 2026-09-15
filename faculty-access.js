/* Shared Firebase identity and faculty portal helpers for Spark Basic Mode. */
window.UCVM=(()=>{
 const config={apiKey:'AIzaSyDS9VE2zTXv0656_Mh0uDXB67-mZ5Y_LkY',authDomain:'tester-teaching.firebaseapp.com',projectId:'tester-teaching',storageBucket:'tester-teaching.firebasestorage.app',messagingSenderId:'566638053186',appId:'1:566638053186:web:90e04b52251c4b859baadb'};
 const rawRole=r=>String((r&&typeof r==='object'?r.role:r)||'').toLowerCase();
 const role=r=>({owner:'adfa_general',administrator:'adfa_regular',other_office:'other_office',adfa_general:'adfa_general',adfa_regular:'adfa_regular',admin:'adfa_regular',editor:'faculty',viewer:'faculty'}[rawRole(r)]||rawRole(r));
 const admin=p=>['adfa_general','adfa_regular','other_office'].includes(role(p?.role));
 const general=p=>role(p?.role)==='adfa_general';
 const historyAll=p=>['adfa_general','adfa_regular'].includes(role(p?.role));
 const label=r=>({owner:'Owner',adfa_general:'Owner',administrator:'Administrator',adfa_regular:'Administrator',admin:'Administrator',other_office:'Other Office',hicc:'HICC',visc:'VISC',faculty:'Faculty',editor:'Faculty',viewer:'Faculty'}[rawRole(r)]||rawRole(r));
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=v=>{if(v===undefined||v===null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
 function installWeekTimeAlignmentFix(){if(document.getElementById('ucvm-week-time-alignment-fix'))return;const style=document.createElement('style');style.id='ucvm-week-time-alignment-fix';style.textContent='.tg-track{top:0!important;bottom:0!important}.tg-block{position:absolute!important}';document.head.appendChild(style)}
 installWeekTimeAlignmentFix();
 function installStableWeekLanes(){
  const keyFor=b=>(b.querySelector('.tg-block-l1')?.textContent||b.dataset.sessionId||'').trim().toLowerCase();
  const alignColumn=col=>{
   const items=[...col.querySelectorAll('.tg-block')].map(block=>{const start=parseFloat(block.style.top),height=parseFloat(block.style.height);return{block,key:keyFor(block),start,end:start+height,lane:0}}).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)).sort((a,b)=>a.start-b.start||a.end-b.end);
   if(!items.length)return;
   const preferred=new Map();let group=[],groupMaxEnd=-Infinity;
   const flush=()=>{
    if(!group.length)return;
    if(group.length===1){const x=group[0];x.block.style.left='2px';x.block.style.right='auto';x.block.style.width='calc(100% - 4px)';group=[];groupMaxEnd=-Infinity;return}
    const laneEnds=[];
    group.forEach(x=>{let lane=-1,p=preferred.get(x.key);if(Number.isInteger(p)&&(laneEnds[p]??-Infinity)<=x.start+0.0001)lane=p;if(lane<0)lane=laneEnds.findIndex(end=>end<=x.start+0.0001);if(lane<0)lane=laneEnds.length;laneEnds[lane]=x.end;x.lane=lane;if(!preferred.has(x.key))preferred.set(x.key,lane)});
    const laneCount=Math.max(1,laneEnds.length),laneWidth=100/laneCount;
    group.forEach(x=>{x.block.style.left=`calc(${x.lane*laneWidth}% + 2px)`;x.block.style.right='auto';x.block.style.width=`calc(${laneWidth}% - 4px)`});
    group=[];groupMaxEnd=-Infinity;
   };
   items.forEach(x=>{if(group.length&&x.start>=groupMaxEnd-0.0001)flush();group.push(x);groupMaxEnd=Math.max(groupMaxEnd,x.end)});flush();
  };
  let queued=false;const align=()=>document.querySelectorAll('.tg-day-col').forEach(alignColumn);const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;align()})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',queue,{once:true});else queue();
  new MutationObserver(m=>{if(m.some(x=>[...x.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.tg-day-col,.tg-block')||n.querySelector?.('.tg-day-col,.tg-block')))))queue()}).observe(document.documentElement,{childList:true,subtree:true});
 }
 installStableWeekLanes();
 let persistenceStarted=false;
 function init(){
  if(!firebase.apps.length)firebase.initializeApp(config);
  const db=firebase.firestore();
  if(!persistenceStarted){
   persistenceStarted=true;
   db.enablePersistence({synchronizeTabs:true}).catch(e=>{
    if(!['failed-precondition','unimplemented'].includes(e?.code))console.warn('[firestore persistence]',e);
   });
  }
  const auth=firebase.auth();
  if(window.UCVMSessionGuard)window.UCVMSessionGuard.start(auth);
  return {auth,db};
 }
 function installLandingReset(){if(window.__ucvmLandingResetInstalled||typeof firebase==='undefined')return;window.__ucvmLandingResetInstalled=true;try{firebase.auth().onAuthStateChanged(u=>{if(!u){sessionStorage.removeItem('ucvm-admin-default-landing');window.__ucvmAdminLandingScheduled=false}})}catch(_){}}
 async function linkFacultyIdentity(user,p){
  if(admin(p))return;
  const emails=[user?.email,p?.email].map(v=>String(v||'').trim()).filter((v,i,a)=>v&&a.indexOf(v)===i);
  for(const email of emails){
   try{
    const q=await firebase.firestore().collection('faculty').where('email','==',email).limit(2).get();
    if(q.empty)continue;
    const d=q.docs[0],f=d.data()||{},raw=String(f.preferredFullName||f.hrFullName||f.name||'').trim(),comma=raw.match(/^([^,]+),\s*(.+)$/),firstLast=String(f.hrFirstLast||f.teachingAssignmentName||((f.firstName&&f.lastName)?`${f.firstName} ${f.lastName}`:'')||(comma?`${comma[2]} ${comma[1]}`:'')||raw||p.instructor||p.name||'').trim(),name=firstLast;
    if(!p.facultyId)p.facultyId=d.id||f.ucid||'';
    if(name)p.instructor=name;
    p.facultyDirectoryMatch={id:d.id,email,name};
    return;
   }catch(_){/* Keep the account usable even if the optional directory match is unavailable. */}
  }
 }
 function scheduleAdminLanding(user,p){
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase(),raw=rawRole(p);
  if(page!=='index.html'||!['owner','administrator','adfa_general','adfa_regular','admin'].includes(raw))return false;
  if(window.__ucvmAdminLandingScheduled)return true;
  try{
   if(sessionStorage.getItem('ucvm-admin-default-landing')===user.uid)return false;
   sessionStorage.setItem('ucvm-admin-default-landing',user.uid);
   window.__ucvmAdminLandingScheduled=true;
   setTimeout(()=>{
    try{
     const current=firebase.auth().currentUser;
     if(current&&current.uid===user.uid&&((location.pathname.split('/').pop()||'index.html').toLowerCase()==='index.html'))location.replace('faculty-admin.html');
    }catch(_){}
   },900);
   return true;
  }catch(_){return false}
 }
 async function ready(user,p){if(window.__ucvmSessionGuard?.blocked)return false;if(!p?.active)throw Error('This account is inactive.');if(p.mustChangePassword){location.replace('password.html');return false}installLandingReset();await linkFacultyIdentity(user,p);if(scheduleAdminLanding(user,p))return false;return true}
 function watch(user,p){let initial=true;return firebase.firestore().doc(`users/${user.uid}`).onSnapshot(s=>{const n=s.data();if(initial){initial=false;return}if(!n||['role','active','mustChangePassword'].some(k=>n[k]!==p[k]))location.reload()})}
 const value=v=>v===null||v===undefined?'—':Array.isArray(v)?v.map(x=>typeof x==='object'?`${x.name||x.ucid||''}${x.role?' ('+x.role+')':''}`:String(x)).filter(Boolean).join('; '):typeof v==='object'?JSON.stringify(v):String(v);
 const time=e=>e.changedAt?.toDate?e.changedAt.toDate().toLocaleString('en-CA',{timeZone:'America/Edmonton'}):'Pending';
 function normalizeEntry(raw,source){const e={...raw,source};e.changes=window.UCVM_AUDIT_DETAILS?.changes(e)||e.changes||[];if(e.changes.length)return e;if(source==='session'&&e.action==='swap_faculty')e.changes=[{field:'assignments',label:'Faculty',before:e.fromFaculty?.name||e.fromFaculty?.ucid||'',after:e.toFaculty?.name||e.toFaculty?.ucid||''}];else if(source==='session'&&e.action==='create')e.changes=[{field:'session',label:'Session',before:null,after:[e.course,e.date,e.topic].filter(Boolean).join(' · ')}];else if(source==='session'&&e.action==='delete')e.changes=[{field:'session',label:'Session',before:[e.course,e.date,e.topic].filter(Boolean).join(' · '),after:null}];else if(source==='faculty'&&e.action==='create')e.changes=[{field:'faculty',label:'Faculty record',before:null,after:e.facultyName||e.facultyId}];else if(source==='faculty'&&e.action==='delete')e.changes=[{field:'faculty',label:'Faculty record',before:e.facultyName||e.facultyId,after:null}];else if(source==='account')e.changes=[{field:'access',label:'Account access',before:e.beforeRole?`${e.targetName||e.targetUid} · ${label(e.beforeRole)}`:null,after:[e.targetName||e.targetUid,e.role?label(e.role):'',typeof e.active==='boolean'?(e.active?'Active':'Disabled'):''].filter(Boolean).join(' · ')}];return e}
 async function logs(container,{includeFaculty=false,profile=null}={}){
  includeFaculty=includeFaculty||container?.id==='faculty-audit';
  const {auth,db}=init(),user=auth.currentUser,canReadAll=historyAll(profile);let entries=[],loading=false;const cursors={session:null,faculty:null,account:null};const exhausted={session:false,faculty:!includeFaculty,account:false};
  container.innerHTML='<div class="audit-toolbar"><label><span>Search loaded history</span><input id="audit-search" placeholder="Course, name, person or change"></label><label><span>Change type</span><select id="audit-kind" aria-label="Change type"><option value="">All changes</option><option value="create">Added</option><option value="delete">Deleted</option><option value="time">Time/date</option><option value="name">Name</option><option value="faculty">Faculty</option></select></label><p id="audit-status" role="status"></p></div><div class="table-scroll"><table class="audit-table"><thead><tr><th>When (Calgary)</th><th>By whom</th><th>Session / record</th><th>Action</th><th>Before → after</th></tr></thead><tbody id="audit-body"></tbody></table></div><div class="audit-footer"><button id="audit-more">Load older changes</button></div>';
  const $=id=>container.querySelector('#'+id),actionLabel=a=>({create:'Added',delete:'Deleted',update:'Changed',batch_update:'Batch update',account_created:'Account created',account_linked:'Account linked',account_updated:'Account access changed',account_provisioned:'Account provisioned',password_reset:'Password reset required',password_changed:'Password changed',group_saved:'Group changed',group_created:'Group created',group_updated:'Group changed',group_deleted:'Group deleted',group_members_updated:'Group membership changed',update_doe_roles:'DOE roles / override changed',swap_faculty:'Faculty changed',replace_from_all_faculty_summaries:'Timetable synchronized',replace_and_sync_all_faculty_summaries:'Faculty/timetable synchronized',replace_away_from_campus_afc:'AFC imported',replace_workload_doe_breakdown_2026_27:'Workload DOE imported',faculty_routing_migration:'Assigned AD removed / Reports To routing built'})[a]||a||'Changed';
  function kindMatch(e,kind){if(!kind)return true;if(kind==='create'||kind==='delete')return e.action===kind;return(e.changes||[]).some(c=>kind==='time'?['date','start','end'].includes(c.field):kind==='name'?/name|topic/i.test(`${c.field} ${c.label}`):kind==='faculty'?/faculty|assignment/i.test(`${c.field} ${c.label}`):false)}
  const changeLine=c=>`<div class="audit-change"><strong>${esc(c.label||c.field||'Change')}:</strong> ${esc(value(c.before))} → ${esc(value(c.after))}</div>`;
  function changeCell(e){const changes=e.changes||[],group=window.UCVM_AUDIT_DETAILS?.group(changes,false)||{visible:changes.slice(0,3),remaining:Math.max(0,changes.length-3)};if(!changes.length)return'<span>Legacy entry; detailed before/after values were not recorded.</span>';const visible=group.visible.map(changeLine).join('');if(!group.remaining)return visible;return `${visible}<details class="audit-change-more"><summary>Show ${group.remaining} more change${group.remaining===1?'':'s'} <span aria-hidden="true">⌄</span></summary>${changes.slice(3).map(changeLine).join('')}</details>`}
  function render(){const q=$('audit-search').value.toLowerCase(),kind=$('audit-kind').value;const rows=entries.filter(e=>(!q||JSON.stringify(e).toLowerCase().includes(q))&&kindMatch(e,kind));$('audit-body').innerHTML=rows.map(e=>`<tr><td>${esc(time(e))}</td><td>${esc(e.changedByName||e.changedBy||'Unknown')}<small>${esc(e.changedByEmail||'')}</small></td><td>${esc([e.course,e.date,e.topic].filter(Boolean).join(' · ')||e.facultyName||e.facultyId||e.targetName||e.targetUid||e.sessionId||e.recordId||'Record')}</td><td>${esc(actionLabel(e.action))}</td><td>${changeCell(e)}</td></tr>`).join('')||'<tr><td colspan="5">No matching changes.</td></tr>'}
  async function page(collection,key){if(exhausted[key])return;let q=db.collection(collection);if(!canReadAll)q=q.where('changedBy','==',user.uid);q=q.orderBy('changedAt','desc').limit(50);if(cursors[key])q=q.startAfter(cursors[key]);const s=await q.get();entries.push(...s.docs.map(d=>normalizeEntry({id:d.id,...d.data()},key)));cursors[key]=s.docs.at(-1)||cursors[key];if(s.size<50)exhausted[key]=true}
  async function more(){if(loading)return;loading=true;$('audit-more').disabled=true;$('audit-status').textContent='Loading changes…';try{await page('session_change_log','session');if(includeFaculty)await page('faculty_change_log','faculty');await page('account_audit','account');entries.sort((a,b)=>{const at=a.changedAt?.toMillis?a.changedAt.toMillis():0,bt=b.changedAt?.toMillis?b.changedAt.toMillis():0;return bt-at});render();$('audit-more').hidden=exhausted.session&&exhausted.faculty&&exhausted.account;$('audit-status').textContent=`${entries.length} changes loaded · ${canReadAll?'all authorized users':'your changes only'}.` }catch(e){$('audit-status').textContent='Could not load history: '+e.message}finally{loading=false;$('audit-more').disabled=false}}
  $('audit-search').oninput=render;$('audit-kind').onchange=render;$('audit-more').onclick=more;await more()
 }
 return {config,role,admin,general,historyAll,label,esc,number,init,ready,watch,logs};
})();

(()=>{
 const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
 const load=(src,key)=>{if(document.querySelector(`script[data-${key}]`))return;const s=document.createElement('script');s.src=src;s.dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]='1';s.async=false;document.head.appendChild(s)};
 const run=()=>{if(page==='index.html')load('approval-workflow.js','ucvm-approval-workflow');if(page==='faculty-admin.html')load('faculty-admin-enhancements.js','ucvm-faculty-admin-enhancements')};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(run,0),{once:true});else setTimeout(run,0);
})();
