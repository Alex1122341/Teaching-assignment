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

test('timetable Faculty Dashboard button supports administrators and faculty self-service',()=>{
 const vm=require('node:vm'),source=read('timetable.js'),loader=read('asset-loader.js');
 const ui=source.match(/  function updateAuthUI\(\) \{[\s\S]*?\n  \}/)[0];
 const binding=source.split('\n').find(line=>line.includes("$('faculty-dashboard-btn').addEventListener"));
 for(const role of [null,'faculty','hicc','visc','adfa_general','adfa_regular','other_office']){
  const currentUser=role?{role,name:'Test'}:null,elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{classList:{toggle(name,value){this[name]=value;},contains(){return true;}},addEventListener(_name,fn){this.click=fn;}});return elements.get(id);};
  const admin=p=>['adfa_general','adfa_regular','other_office'].includes(p?.role);
  const context={$ ,currentUser,UCVM:{admin,general:p=>p?.role==='adfa_general'},canEdit:()=>admin(currentUser),canAddSessions:()=>admin(currentUser),canAddOneSession:()=>admin(currentUser),canSelectSessions:()=>admin(currentUser),updateScheduleSourceUI(){},roleIsFaculty:p=>p?.role==='faculty',uiSettings:{showMyTimetable:true},myTimetableOnly:false,window:{location:{href:''}}};
  vm.runInNewContext(ui+'\nupdateAuthUI();\n'+binding,context);
  const button=$('faculty-dashboard-btn');
  assert.equal(button.classList.hidden,!admin(currentUser),String(role));
  button.click();
  assert.equal(context.window.location.href,admin(currentUser)?'faculty-admin.html':'',String(role));
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
 for(const role of ['developer','owner','administrator'])assert.match(whitelist,new RegExp(`['"]${role}['"]`),role);
});
