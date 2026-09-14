'use strict';
(()=>{
 const {auth,db}=UCVM.init(),$=id=>document.getElementById(id),e=UCVM.esc;
 let me,groups=[],sessions=[],facultyRecord=null,currentView=location.hash==='#afc'?'afc':'list',sessionUnsubscribes=[];
 const norm=v=>String(v||'').trim().toLowerCase();
 const normName=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(dr|doctor|prof|professor)\.?\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
 function facultyNames(f){const names=new Set(),add=v=>{const n=normName(v);if(n)names.add(n)};add(f?.preferredFullName);add(f?.hrFullName);add(f?.name);if(f?.firstName&&f?.lastName){add(`${f.firstName} ${f.lastName}`);add(`${f.lastName} ${f.firstName}`)}return names}
 function facultyIds(f){return new Set([me?.facultyId,f?.id,f?.ucid].map(v=>norm(v)).filter(Boolean))}
 function assignmentMatches(a){if(!facultyRecord)return false;const ids=facultyIds(facultyRecord),names=facultyNames(facultyRecord),aid=norm(a?.ucid||a?.facultyId||a?.id),an=normName(a?.name||a?.facultyName);return(!!aid&&ids.has(aid))||(!!an&&names.has(an))}
 function instructorMatches(raw){if(!facultyRecord||!raw)return false;const names=facultyNames(facultyRecord),whole=` ${normName(raw)} `;return[...names].some(n=>whole.includes(` ${n} `))}
 function isMine(s){if(UCVM.admin(me))return true;if((s.assignments||[]).some(assignmentMatches))return true;if(instructorMatches(s.instructor))return true;return groups.some(g=>(g.courseIds||[]).map(String).includes(String(s.course)))}
 function mine(){return sessions.filter(isMine).sort((a,b)=>`${a.date||''}${a.start||''}`.localeCompare(`${b.date||''}${b.start||''}`))}
 function matchingAssignment(s){return(s.assignments||[]).find(assignmentMatches)||null}
 async function resolveFaculty(user){
  if(UCVM.admin(me))return null;
  const candidates=[user.email,me.email].map(v=>String(v||'').trim()).filter((v,i,a)=>v&&a.indexOf(v)===i);
  for(const email of candidates){
   try{const q=await db.collection('faculty').where('email','==',email).limit(2).get();if(!q.empty){const d=q.docs[0];return{id:d.id,...d.data(),matchedEmail:email}}}catch(_){/* Try the next safe identity source. */}
  }
  return null;
 }
 function setIdentityNote(user){
  if(UCVM.admin(me)){$('match-note').textContent='ADFA view: all teaching sessions are shown.';return}
  if(facultyRecord){const name=facultyRecord.preferredFullName||facultyRecord.hrFullName||facultyRecord.name||facultyRecord.id;$('match-note').innerHTML=`Matched <strong>${e(user.email||me.email||'')}</strong> to Faculty Directory record <strong>${e(name)}</strong>. Sessions are matched by assigned UCID or name.`;return}
  $('match-note').innerHTML=`No Faculty Directory record matches <strong>${e(user.email||me.email||'')}</strong>. Add the same email to this person's Faculty Directory record; My Teaching will remain empty until the identity can be verified.`;
 }
 function renderList(items){$('sessions-body').innerHTML=items.map(s=>{const a=matchingAssignment(s),faculty=(s.assignments||[]).map(x=>x.name).filter(Boolean).join('; ')||s.instructor||'TBD';return`<tr><td>${e(s.date)}<small>${e(s.start)}–${e(s.end)}</small></td><td><strong>${e(s.course)}</strong><small>${e(s.topic||s.type||'')}</small></td><td>${e(faculty)}</td><td>${a?.role?e(a.role):['hicc','visc'].includes(me.role)?'Group course':'Assigned faculty'}</td></tr>`}).join('')||'<tr><td colspan="4">No sessions matched to this signed-in faculty account.</td></tr>'}
 function render(){const items=mine();renderList(items);$('session-count').textContent=`${items.length} session${items.length===1?'':'s'} matched`;}
 function show(view){currentView=view;const list=view==='list',history=view==='history',afc=view==='afc';$('history-panel').hidden=!history;$('afc-panel').hidden=!afc;$('sessions-panel').hidden=!list;for(const [id,v] of [['list-tab','list'],['history-tab','history'],['afc-tab','afc']])$(id).classList.toggle('primary',view===v);if(history)UCVM.logs($('history-panel'),{includeFaculty:true,profile:me});if(afc)window.dispatchEvent(new Event('ucvm:afc-open'));}
 async function loadGroups(){if(UCVM.admin(me)||!['hicc','visc'].includes(me.role)){groups=[];return}const s=await db.collection('faculty_groups').where('memberUids','array-contains',auth.currentUser.uid).get();groups=s.docs.map(d=>({id:d.id,...d.data()}));}
 function subscribeSessions(){
  sessionUnsubscribes.splice(0).forEach(stop=>stop());
  const queryRows=new Map(),publish=()=>{const merged=new Map();for(const rows of queryRows.values())for(const row of rows)merged.set(row.id,row);sessions=[...merged.values()];render();window.dispatchEvent(new Event('ucvm:faculty-sessions-updated'))};
  const listen=(key,query)=>sessionUnsubscribes.push(query.onSnapshot(s=>{queryRows.set(key,s.docs.map(d=>({id:d.id,...d.data()})));publish()},err=>$('status').textContent=err.message));
  if(UCVM.admin(me)){listen('admin',db.collection('sessions'));return}
  const facultyId=String(facultyRecord?.id||facultyRecord?.ucid||me?.facultyId||'').trim();
  if(facultyId)listen('faculty',db.collection('sessions').where('facultyIds','array-contains',facultyId));
  const courseIds=[...new Set(groups.flatMap(g=>Array.isArray(g.courseIds)?g.courseIds:[]).map(String).filter(Boolean))];
  for(let i=0;i<courseIds.length;i+=10){const courseChunk=courseIds.slice(i,i+10);listen(`courses-${i}`,db.collection('sessions').where('course','in',courseChunk))}
  if(!facultyId&&!courseIds.length){sessions=[];render();window.dispatchEvent(new Event('ucvm:faculty-sessions-updated'))}
 }
 $('signout').onclick=()=>auth.signOut();$('list-tab').onclick=()=>show('list');$('history-tab').onclick=()=>show('history');$('afc-tab').onclick=()=>show('afc');
 auth.onAuthStateChanged(async u=>{if(!u){sessionUnsubscribes.splice(0).forEach(stop=>stop());location.replace('index.html');return}try{const profile=(await db.doc(`users/${u.uid}`).get()).data()||{};me=profile;if(!await UCVM.ready(u,me))return;me={...me,role:UCVM.role(me.role)};UCVM.watch(u,profile);$('identity').textContent=`${me.name||u.email} · ${UCVM.label(me.role)}`;$('management-link').hidden=!(UCVM.general(me)||me.role==='hicc');$('directory-link').hidden=!UCVM.admin(me);await loadGroups();facultyRecord=await resolveFaculty(u);window.UCVM_FACULTY_DATA={profile:()=>me,faculty:()=>facultyRecord,sessions:()=>sessions.slice(),user:()=>auth.currentUser};window.dispatchEvent(new Event('ucvm:faculty-data-ready'));setIdentityNote(u);$('session-note').textContent=['hicc','visc'].includes(me.role)?'Shows your assigned sessions plus courses attached to your HICC group. Open My Teaching Day for the day calendar.':'Shows only sessions assigned to the Faculty Directory person verified by your signed-in email. Open My Teaching Day for the day calendar.';$('content').hidden=false;show(currentView);subscribeSessions()}catch(err){$('status').textContent=err.message}});
})();
