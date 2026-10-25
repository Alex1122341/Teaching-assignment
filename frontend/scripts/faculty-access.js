/* Shared Firebase identity and faculty portal helpers for Spark Basic Mode. */
window.UCVM=(()=>{
 const config=(globalThis.PAWS_RUNTIME_CONFIG||{}).firebase||null;
 const rawRole=r=>String((r&&typeof r==='object'?r.role:r)||'').toLowerCase();
 const role=r=>({owner:'adfa_general',administrator:'adfa_regular',other_office:'other_office',adfa_general:'adfa_general',adfa_regular:'adfa_regular',admin:'adfa_regular',editor:'faculty',viewer:'faculty'}[rawRole(r)]||rawRole(r));
 const admin=p=>['developer','adfa_general','adfa_regular'].includes(role(p?.role));
 const general=p=>['developer','adfa_general'].includes(role(p?.role));
 // BETA-R4D-12B2A1: Dashboard navigation capability. Administrators reach the
 // administrative Dashboard; faculty/hicc/visc reach the same page in its
 // server-authorized self-service form ("My Faculty Profile"). Server authorization
 // stays authoritative - this is navigation convenience only.
 // `other_office` is retired in the current PAWS architecture and must fail closed
 // at this explicit capability boundary even though legacy UCVM.admin() still knows it.
 const DASHBOARD_ROLES=['developer','adfa_general','adfa_regular','faculty','hicc','visc'];
 function canOpenFacultyDashboard(p){return DASHBOARD_ROLES.includes(role(p?.role));}
 const historyAll=p=>['developer','adfa_general','adfa_regular'].includes(role(p?.role));
 const label=r=>({developer:'Developer',owner:'ADFAD Owner',adfa_general:'ADFAD Owner',administrator:'ADFAD Admin',adfa_regular:'ADFAD Admin',admin:'ADFAD Admin',other_office:'Other Office',hicc:'HICC',visc:'VISC',faculty:'Faculty',editor:'Faculty',viewer:'Faculty'}[rawRole(r)]||rawRole(r));
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
 // BETA-R4D-9H: the landing-reset hook existed only to clear the retired automatic-landing
 // marker on sign-out. It is neutered rather than deleted so no auth-state listener can
 // re-arm or re-trigger a redirect. Legacy sessionStorage is cleared directly by
 // clearLegacyAdminLanding() on every ready() call instead.
 function installLandingReset(){}
 async function enrichFacultyIdentity(user,p){
  if(admin(p))return null;
  const facultyId=String(p?.facultyId||'').trim();
  if(!facultyId)return null;
  try{
   const d=await firebase.firestore().collection('faculty').doc(facultyId).get();
   if(!d.exists)return null;
   const f=d.data()||{},raw=String(f.preferredFullName||f.hrFullName||f.name||'').trim(),comma=raw.match(/^([^,]+),\s*(.+)$/),firstLast=String(f.hrFirstLast||f.teachingAssignmentName||((f.firstName&&f.lastName)?`${f.firstName} ${f.lastName}`:'')||(comma?`${comma[2]} ${comma[1]}`:'')||raw||p.instructor||p.name||'').trim(),name=firstLast;
   if(name)p.instructor=name;
   p.facultyDirectoryMatch={id:facultyId,email:String(f.email||'').trim(),name};
   return p.facultyDirectoryMatch;
  }catch(_){return null}
 }
 function clearLegacyAdminLanding(){
  try{
   if(typeof sessionStorage!=='undefined'&&typeof sessionStorage.removeItem==='function')sessionStorage.removeItem('ucvm-admin-default-landing');
  }catch(_){}
  if(typeof window!=='undefined')window.__ucvmAdminLandingScheduled=false;
 }
 // BETA-R4D-9H: administrators keep the Timetable as their landing page. Dashboard is an
 // explicit, user-initiated destination (faculty-dashboard-btn / UCVM.admin()), never an
 // automatic redirect. Automatic admin landing was retired because it aborted timetable
 // initialization (ready() returned false) and left the gate stuck on "Checking your
 // timetable access..." before bouncing the user to faculty-admin.html.
 // Retained as a no-op so any stale/session-restored caller cannot schedule a redirect,
 // and to clear legacy sessionStorage left behind by older releases.
 function scheduleAdminLanding(){clearLegacyAdminLanding();return false}
 async function ready(user,p){if(window.__ucvmSessionGuard?.blocked)return false;if(!p?.active){const error=new Error('This account is inactive.');error.code='ACCOUNT_INACTIVE';throw error}if(p.mustChangePassword){location.replace('password.html');return false}installLandingReset();clearLegacyAdminLanding();return true}
 function watch(user,p){let initial=true;return firebase.firestore().doc(`users/${user.uid}`).onSnapshot(s=>{const n=s.data();if(initial){initial=false;return}if(!n||['role','active','mustChangePassword'].some(k=>n[k]!==p[k]))location.reload()})}
 const value=v=>v===null||v===undefined?'—':Array.isArray(v)?v.map(x=>typeof x==='object'?`${x.name||x.ucid||''}${x.role?' ('+x.role+')':''}`:String(x)).filter(Boolean).join('; '):typeof v==='object'?JSON.stringify(v):String(v);
 const time=e=>e.changedAt?.toDate?e.changedAt.toDate().toLocaleString('en-CA',{timeZone:'America/Edmonton'}):'Pending';
 function normalizeEntry(raw,source){const e={...raw,source};e.changes=window.UCVM_AUDIT_DETAILS?.changes(e)||e.changes||[];if(e.changes.length)return e;if(source==='session'&&e.action==='swap_faculty')e.changes=[{field:'assignments',label:'Faculty',before:e.fromFaculty?.name||e.fromFaculty?.ucid||'',after:e.toFaculty?.name||e.toFaculty?.ucid||''}];else if(source==='session'&&e.action==='create')e.changes=[{field:'session',label:'Session',before:null,after:[e.course,e.date,e.topic].filter(Boolean).join(' · ')}];else if(source==='session'&&e.action==='delete')e.changes=[{field:'session',label:'Session',before:[e.course,e.date,e.topic].filter(Boolean).join(' · '),after:null}];else if(source==='faculty'&&e.action==='create')e.changes=[{field:'faculty',label:'Faculty record',before:null,after:e.facultyName||e.facultyId}];else if(source==='faculty'&&e.action==='delete')e.changes=[{field:'faculty',label:'Faculty record',before:e.facultyName||e.facultyId,after:null}];else if(source==='account')e.changes=[{field:'access',label:'Account access',before:e.beforeRole?`${e.targetName||e.targetUid} · ${label(e.beforeRole)}`:null,after:[e.targetName||e.targetUid,e.role?label(e.role):'',typeof e.active==='boolean'?(e.active?'Active':'Disabled'):''].filter(Boolean).join(' · ')}];return e}
 async function logs(container,{includeFaculty=false,profile=null}={}){
  includeFaculty=includeFaculty||container?.id==='faculty-audit';
  const {auth,db}=init(),user=auth.currentUser,canReadAll=historyAll(profile);const PAGE_SIZE=20;let entries=[],loading=false;const cursors={session:null,faculty:null,account:null};const exhausted={session:false,faculty:!includeFaculty,account:false};
  container.innerHTML='<div class="audit-toolbar"><label><span>Search loaded history</span><input id="audit-search" placeholder="Course, name, person or change"></label><label><span>Change type</span><select id="audit-kind" aria-label="Change type"><option value="">All changes</option><option value="create">Added</option><option value="delete">Deleted</option><option value="time">Time/date</option><option value="name">Name</option><option value="faculty">Faculty</option></select></label><p id="audit-status" role="status"></p></div><div class="table-scroll"><table class="audit-table"><thead><tr><th>When (Calgary)</th><th>By whom</th><th>Session / record</th><th>Action</th><th>Before → after</th></tr></thead><tbody id="audit-body"></tbody></table></div><div class="audit-footer"><button id="audit-more">Load older changes</button></div>';
  const $=id=>container.querySelector('#'+id),actionLabel=a=>({create:'Added',delete:'Deleted',update:'Changed',batch_update:'Batch update',account_created:'Account created',account_linked:'Account linked',account_updated:'Account access changed',account_provisioned:'Account provisioned',password_reset:'Password reset required',password_changed:'Password changed',group_saved:'Group changed',group_created:'Group created',group_updated:'Group changed',group_deleted:'Group deleted',group_members_updated:'Group membership changed',update_doe_roles:'DOE roles / override changed',swap_faculty:'Faculty changed',replace_from_all_faculty_summaries:'Timetable synchronized',replace_and_sync_all_faculty_summaries:'Faculty/timetable synchronized',replace_away_from_campus_afc:'AFC imported',replace_workload_doe_breakdown_2026_27:'Workload DOE imported',faculty_routing_migration:'Assigned AD removed / Reports To routing built'})[a]||a||'Changed';
  function kindMatch(e,kind){if(!kind)return true;if(kind==='create'||kind==='delete')return e.action===kind;return(e.changes||[]).some(c=>kind==='time'?['date','start','end'].includes(c.field):kind==='name'?/name|topic/i.test(`${c.field} ${c.label}`):kind==='faculty'?/faculty|assignment/i.test(`${c.field} ${c.label}`):false)}
  const changeLine=c=>`<div class="audit-change"><strong>${esc(c.label||c.field||'Change')}:</strong> ${esc(value(c.before))} → ${esc(value(c.after))}</div>`;
  function changeCell(e){const changes=e.changes||[],group=window.UCVM_AUDIT_DETAILS?.group(changes,false)||{visible:changes.slice(0,3),remaining:Math.max(0,changes.length-3)};if(!changes.length)return'<span>Legacy entry; detailed before/after values were not recorded.</span>';const visible=group.visible.map(changeLine).join('');if(!group.remaining)return visible;return `${visible}<details class="audit-change-more"><summary>Show ${group.remaining} more change${group.remaining===1?'':'s'} <span aria-hidden="true">⌄</span></summary>${changes.slice(3).map(changeLine).join('')}</details>`}
  function render(){const q=$('audit-search').value.toLowerCase(),kind=$('audit-kind').value;const rows=entries.filter(e=>(!q||JSON.stringify(e).toLowerCase().includes(q))&&kindMatch(e,kind));$('audit-body').innerHTML=rows.map(e=>`<tr><td>${esc(time(e))}</td><td>${esc(window.PAWS_FACULTY_NAME.format(e.changedByName||e.changedBy||'Unknown'))}<small>${esc(e.changedByEmail||'')}</small></td><td>${esc([e.course,e.date,e.topic].filter(Boolean).join(' · ')||(e.facultyName?window.PAWS_FACULTY_NAME.format(e.facultyName):'')||e.facultyId||(e.targetName?window.PAWS_FACULTY_NAME.format(e.targetName):'')||e.targetUid||e.sessionId||e.recordId||'Record')}</td><td>${esc(actionLabel(e.action))}</td><td>${changeCell(e)}</td></tr>`).join('')||'<tr><td colspan="5">No matching changes.</td></tr>'}
  async function page(collection,key){if(exhausted[key])return;let q=db.collection(collection);if(!canReadAll)q=q.where('changedBy','==',user.uid);q=q.orderBy('changedAt','desc').limit(PAGE_SIZE);if(cursors[key])q=q.startAfter(cursors[key]);const s=await q.get();entries.push(...s.docs.map(d=>normalizeEntry({id:d.id,...d.data()},key)));cursors[key]=s.docs.at(-1)||cursors[key];if(s.size<PAGE_SIZE)exhausted[key]=true}
  async function more(){if(loading)return;loading=true;$('audit-more').disabled=true;$('audit-status').textContent='Loading changes…';try{await page('session_change_log','session');if(includeFaculty)await page('faculty_change_log','faculty');await page('account_audit','account');entries.sort((a,b)=>{const at=a.changedAt?.toMillis?a.changedAt.toMillis():0,bt=b.changedAt?.toMillis?b.changedAt.toMillis():0;return bt-at});render();$('audit-more').hidden=exhausted.session&&exhausted.faculty&&exhausted.account;$('audit-status').textContent=`${entries.length} changes loaded · ${canReadAll?'all authorized users':'your changes only'}.` }catch(e){$('audit-status').textContent='Could not load history: '+e.message}finally{loading=false;$('audit-more').disabled=false}}
  $('audit-search').oninput=render;$('audit-kind').onchange=render;$('audit-more').onclick=more;await more()
 }
 return {config,role,admin,general,historyAll,canOpenFacultyDashboard,label,esc,number,init,ready,enrichFacultyIdentity,watch,logs};
})();

// W1D authority containment: legacy Firestore approval and Faculty/DOE writers
// are not dynamically loaded on any Beta entry point. Keep these modules only as
// dormant compatibility artifacts until the trusted API replacement ships.
