const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
test('large pages keep structure while loading cacheable modules',()=>{const main=read('index.html'),admin=read('faculty-admin.html');assert.match(main,/timetable\.css/);assert.match(main,/timetable\.js/);assert.match(admin,/faculty-admin\.css/);assert.match(admin,/faculty-admin\.js/);assert.ok(main.length<50000,`index ${main.length}`);assert.ok(admin.length<40000,`admin ${admin.length}`)});
test('AFC PDF dependencies load only when an approval needs them',()=>{const html=read('index.html');assert.match(html,/asset-loader\.js/);assert.doesNotMatch(html,/pdf-lib\.min\.js|afc-pdf-browser\.js/);const loader=read('asset-loader.js'),actions=read('afc-actions.js');assert.match(loader,/function loadScriptOnce/);assert.match(loader,/ensureAfcPdf/);assert.match(actions,/await UCVM_ASSETS\.ensureAfcPdf\(\)/)});

test('Faculty Dashboard retains administrative tabs and redirects faculty to timetable self-service',()=>{
 const html=read('faculty-admin.html'),source=read('faculty-admin.js');
 for(const pattern of [/<title>Faculty Dashboard<\/title>/,/class="gate-title">Faculty Dashboard</,/class="brand-title">Faculty Dashboard</,/<h1>Faculty Dashboard<\/h1>/])assert.match(html,pattern);
 for(const label of ['Lookup','Teaching Summary','Roles & Appointments','Sessional / Other','Faculty Database','Change History','AFC Requests','User Management','Change password'])assert.ok(html.includes('>'+label+'<'),label);
 assert.match(html,/href="index\.html">Timetable<\/a>/);
 assert.doesNotMatch(html,/Faculty Admin Dashboard|Faculty Directory|Faculty Administration/);
 assert.match(source,/p\.active!==true\|\|!UCVM\.admin\(p\)/);
 assert.match(source,/\$\('user-management-link'\)\.classList\.toggle\('hidden',!UCVM\.general\(p\)\)/);
 assert.match(source,/Open Timetable for your sessions and change history/);
});

test('only administrators see and can navigate the timetable Faculty Dashboard button',()=>{
 const vm=require('node:vm'),source=read('timetable.js');
 const ui=source.match(/  function updateAuthUI\(\) \{[\s\S]*?\n  \}/)[0];
 const binding=source.split('\n').find(line=>line.includes("$('faculty-dashboard-btn').addEventListener"));
 for(const role of [null,'faculty','hicc','visc','adfa_general','adfa_regular','other_office']){
  const currentUser=role?{role,name:'Test'}:null,elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{classList:{toggle(name,value){this[name]=value;},contains(){return true;}},addEventListener(_name,fn){this.click=fn;}});return elements.get(id);};
  const admin=p=>['adfa_general','adfa_regular','other_office'].includes(p?.role);
  const context={$ ,currentUser,UCVM:{admin,general:p=>p?.role==='adfa_general'},canEdit:()=>admin(currentUser),updateScheduleSourceUI(){},roleIsFaculty:p=>p?.role==='faculty',uiSettings:{showMyTimetable:true},myTimetableOnly:false,window:{location:{href:''}}};
  vm.runInNewContext(ui+'\nupdateAuthUI();\n'+binding,context);
  const button=$('faculty-dashboard-btn');
  assert.equal(button.classList.hidden,!admin(currentUser),String(role));
  button.click();
  assert.equal(context.window.location.href,admin(currentUser)?'faculty-admin.html':'',String(role));
 }
});
