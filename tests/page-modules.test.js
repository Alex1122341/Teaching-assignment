const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
test('large pages keep structure while loading cacheable modules',()=>{const main=read('index.html'),admin=read('faculty-admin.html');assert.match(main,/timetable\.css/);assert.match(main,/timetable\.js/);assert.match(admin,/faculty-admin\.css/);assert.match(admin,/faculty-admin\.js/);assert.ok(main.length<50000,`index ${main.length}`);assert.ok(admin.length<40000,`admin ${admin.length}`)});
test('AFC PDF dependencies load only when an approval needs them',()=>{const html=read('index.html');assert.match(html,/asset-loader\.js/);assert.doesNotMatch(html,/pdf-lib\.min\.js|afc-pdf-browser\.js/);const loader=read('asset-loader.js'),actions=read('afc-actions.js');assert.match(loader,/function loadScriptOnce/);assert.match(loader,/ensureAfcPdf/);assert.match(actions,/await UCVM_ASSETS\.ensureAfcPdf\(\)/)});

test('Faculty Dashboard keeps administrative tabs while supporting linked faculty self-service',()=>{
 const html=read('faculty-admin.html'),source=read('faculty-admin.js'),enhancements=read('faculty-admin-enhancements.js');
 for(const pattern of [/<title>Faculty Dashboard<\/title>/,/class="gate-title">Faculty Dashboard</,/class="brand-title">Faculty Dashboard</,/<h1>Faculty Dashboard<\/h1>/])assert.match(html,pattern);
 for(const label of ['Lookup','Teaching Summary','Roles & Appointments','Sessional / Other','Faculty Database','Change History','AFC Requests','User Management','Change password'])assert.ok(html.includes('>'+label+'<'),label);
 assert.match(html,/href="index\.html">Timetable<\/a>/);
 assert.doesNotMatch(html,/Faculty Admin Dashboard|Faculty Directory|Faculty Administration/);
 assert.match(source,/function isSelfServiceProfile\(p\)/);
 assert.match(source,/if\(isSelfServiceProfile\(p\)\)\{await enterSelfMode\(user,p\);return\}/);
 assert.match(source,/if\(UCVM\.admin\(p\)\)\{enterAdminMode\(user,p\);return\}/);
 assert.match(source,/\$\('user-management-link'\)\.classList\.toggle\('hidden',!UCVM\.general\(p\)\)/);
 const rename=enhancements.match(/ function renameDashboard\(\)\{[\s\S]*?\n \}/)?.[0];
 assert.ok(rename,'renameDashboard should remain independently executable');
 const nodes=new Map(),document={title:'Old title',documentElement:{dataset:{}},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector)}};
 require('node:vm').runInNewContext(`${rename}\nrenameDashboard();`,{document});
 assert.equal(document.title,'Faculty Dashboard');
 assert.equal(nodes.get('.brand-title').textContent,'Faculty Dashboard');
 assert.equal(nodes.get('.gate-title').textContent,'Faculty Dashboard');
 assert.match(nodes.get('.gate-copy').innerHTML,/href="index\.html">Timetable<\/a>/);
});

test('timetable role navigation separates admin tools from faculty self-service',()=>{
 const vm=require('node:vm'),source=read('timetable.js'),loader=read('asset-loader.js');
 const ui=source.match(/  function updateAuthUI\(\) \{[\s\S]*?\n  \}/)[0];
 const binding=source.split('\n').find(line=>line.includes("$('faculty-dashboard-btn').addEventListener"));
 const normalize=role=>({owner:'adfa_general',administrator:'adfa_regular',admin:'adfa_regular'}[role]||role||'');
 const admin=p=>['developer','adfa_general','adfa_regular'].includes(normalize(p?.role));
 const general=p=>['developer','adfa_general'].includes(normalize(p?.role));
 const facultyFacing=p=>['faculty','hicc','visc'].includes(normalize(p?.role));
 for(const role of [null,'developer','owner','administrator','adc','lab','other_office','hicc','visc','faculty']){
  const currentUser=role?{role,name:'Test'}:null,elements=new Map();
  const $=id=>{if(!elements.has(id)){const summary={textContent:''};elements.set(id,{classList:{toggle(name,value){this[name]=value;},add(name){this[name]=true},contains(name){return Boolean(this[name]);}},addEventListener(_name,fn){this.click=fn;},querySelector(selector){return id==='cal-admin-menu'&&selector==='summary'?summary:null},_summary:summary});}return elements.get(id);};
  const normalized=normalize(role),context={$ ,currentUser,UCVM:{role:value=>normalize(value),admin,general},canEdit:()=>role==='developer',canAddSessions:()=>['developer','adc'].includes(role),canAddOneSession:()=>['developer','adc'].includes(role),canSelectSessions:()=>['developer','adc'].includes(role),updateScheduleSourceUI(){},roleIsFaculty:facultyFacing,myTimetableOnly:false,window:{location:{href:''}}};
  vm.runInNewContext(ui+'\nupdateAuthUI();\n'+binding,context);
  const dashboard=$('faculty-dashboard-btn'),facultySelf=facultyFacing(currentUser),isAdmin=admin(currentUser),selfHistory=Boolean(currentUser),toolRole=isAdmin||normalized==='adc'||normalized==='hicc';
  assert.equal(dashboard.classList.hidden,!(isAdmin||facultySelf),String(role));
  dashboard.click();assert.equal(context.window.location.href,isAdmin||facultySelf?'faculty-admin.html':'',String(role));
  assert.equal($('my-teaching-btn').classList.hidden,!facultySelf,role+' My Teaching');
  assert.equal($('afc-request-btn').classList.hidden,!facultySelf,role+' AFC');
  assert.equal($('my-change-history-btn').classList.hidden,!selfHistory,role+' history');
  assert.equal($('my-timetable-btn').classList.hidden,true,role+' legacy My Timetable');
  assert.equal($('cal-admin-menu').classList.hidden,!toolRole,role+' tools menu');
  if(isAdmin)assert.equal($('cal-admin-menu')._summary.textContent,'Admin tools',role);
  if(normalized==='adc')assert.equal($('cal-admin-menu')._summary.textContent,'ADC tools');
  if(normalized==='hicc')assert.equal($('cal-admin-menu')._summary.textContent,'HICC tools');
 }
 assert.match(loader,/\['faculty','hicc','visc'\]\.includes\(UCVM\.role\(profile\?\.role\)\)/);
 assert.match(loader,/button\.classList\.remove\('hidden'\)/);
 assert.match(loader,/window\.location\.href='faculty-admin\.html'/);
});

test('change history uses the full-width Faculty Dashboard panel theme',()=>{
 const html=read('faculty-admin.html'),css=read('faculty-admin.css'),access=read('faculty-access.js');
 assert.match(html,/id="history-view" class="panel history-panel hidden"/);
 assert.match(html,/class="history-heading"/);
 assert.match(css,/\.history-panel\s*\{[^}]*width:\s*100%/s);
 assert.match(css,/#faculty-audit table\{[^}]*table-layout:fixed/s);
 assert.match(css,/#faculty-audit th:nth-child\(5\)/);
 assert.match(access,/class="audit-table"/);
});

test('timetable accepts current Developer Owner and Administrator roles',()=>{
 const source=read('timetable.js');
 const whitelist=source.match(/if \(!\[(.*?)\]\.includes\(role\)\)/s)?.[1]||'';
 for(const role of ['developer','owner','administrator','other_office'])assert.match(whitelist,new RegExp(`['"]${role}['"]`),role);
});


test('empty timetable ranges remain connected and allow creating the first session',()=>{
 const source=read('timetable.js');
 assert.match(source,/function liveScheduleAvailable\(\)\{return scheduleSource === 'firestore' \|\| scheduleSource === 'firestore-empty';\}/);
 assert.match(source,/if \(!liveScheduleAvailable\(\)\) \{ toast\('The live Firestore timetable is unavailable\./);
 assert.match(source,/Live Firestore schedule · No sessions in this view/);
 assert.match(source,/publish\.textContent = connected \? 'Synced Schedule Ready'/);
 assert.match(source,/async function openBulkSessionForm\(\)[\s\S]*?if\(!liveScheduleAvailable\(\)\)\{toast\('The live Firestore timetable is unavailable\.'/);
});


test('Other Office uses the sanitized calendar collection and history-only timetable controls',()=>{
 const source=read('timetable.js');
 assert.match(source,/function sessionCollection\(\)\{const role=UCVM\.role\(currentUser\?\.role\);return role==='other_office'\|\|\(\['adc','lab'\]\.includes\(role\)&&!hasOfficeAccess\('adfa'\)\)\?CALENDAR_SESSION_COLLECTION:SESSION_COLLECTION;\}/);
 assert.match(source,/facultySelfService=roleIsFaculty\(currentUser\)/);
 assert.match(source,/selfHistory=Boolean\(currentUser\)/);
 assert.match(source,/my-teaching-btn'[\s\S]*!facultySelfService/);
 assert.match(source,/afc-request-btn'[\s\S]*!facultySelfService/);
 assert.match(source,/my-change-history-btn'[\s\S]*!selfHistory/);
});
