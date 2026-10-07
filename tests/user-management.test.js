'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('faculty-first account form derives name and email from the selected profile',()=>{
 const html=read('user-management.html'),source=read('user-management.js');
 assert.match(html,/id="account-faculty"[^>]*required/);
 assert.match(html,/id="account-identity"/);
 assert.doesNotMatch(html,/id="account-name"[^>]*required/);
 assert.doesNotMatch(html,/id="account-email"[^>]*required/);
 assert.doesNotMatch(html,/id="account-uid"[^>]*required/);
 assert.match(source,/function identityFromFaculty/);
 assert.match(source,/renderAccountIdentity/);
});

test('new accounts are created with secondary Firebase Auth without replacing the Owner session',()=>{
 const html=read('user-management.html'),source=read('user-management.js');
 assert.ok(html.indexOf('faculty-account-planner.js')<html.indexOf('user-management.js'));
 assert.match(source,/secondaryAuth/);
 assert.match(source,/createUserWithEmailAndPassword/);
 assert.match(source,/mustChangePassword:true/);
 assert.match(source,/secondaryAuth\.signOut/);
});

test('bulk provisioning requires a fresh preview and writes auditable results',()=>{
 const html=read('user-management.html'),source=read('user-management.js');
 assert.match(html,/id="account-bulk-preview"/);
 assert.match(html,/id="account-bulk-run"[^>]*disabled/);
 assert.match(html,/id="account-bulk-password"[^>]*type="password"/);
 assert.match(source,/function renderProvisionPlan/);
 assert.match(source,/account_provisioned/);
 assert.match(source,/previewRevision/);
 assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*password/i);
});

test('account table shows all faculty-facing roles while preserving one primary access role',()=>{
 const source=read('user-management.js');
 assert.match(source,/facultyRoles/);
 assert.match(source,/UCVM_ACCOUNT_PLANNER\.primaryRole/);
});

test('provisioned accounts receive a readable Change History action label',()=>{
 assert.match(read('faculty-access.js'),/account_provisioned:'Account provisioned'/);
});

test('setup guide documents reviewed profile-first provisioning without storing a shared password',()=>{
 const setup=read('SETUP.md');
 assert.match(setup,/Preview changes/);
 assert.match(setup,/faculty profile/);
 assert.match(setup,/Require password change on next dashboard sign-in/);
 assert.doesNotMatch(setup,/ucvm2026/i);
});

test('office setup exposes ADC/LAB identity and existing UID inputs',()=>{
 const html=read('user-management.html');
 for(const [role,label] of [['adc','ADC/DVM'],['lab','LAB']])assert.ok(html.includes(`<option value="${role}">${label}</option>`));
 for(const id of ['account-office-identity','account-office-name','account-office-email','account-existing-uid'])assert.ok(html.includes(`id="${id}"`),id);
 assert.ok(html.indexOf('account-profile.js')<html.indexOf('user-management.js'));
});
test('office profile save clears legacy faculty routing and checks existing UIDs on server',()=>{
 const source=read('user-management.js');
 assert.match(source,/UCVM_ACCOUNT_PROFILE/);assert.match(source,/resolveNewUid/);
 assert.match(source,/readProfile:[^\n]*source:'server'/);
 assert.match(source,/patch\.facultyId=firebase\.firestore\.FieldValue\.delete\(\)/);
});


test('Developer account hierarchy is enforced in User Management UI',()=>{
 const source=read('user-management.js');
 assert.match(source,/developerActor/);
 assert.match(source,/developerAccount/);
 assert.match(source,/Only Developer can create or modify Developer accounts/);
 assert.match(source,/Developer protected/);
 assert.match(source,/option\[value="developer"\]/);
});

test('HICC people-index fallback normalizes missing office arrays before account rendering',()=>{
 const source=read('user-management.js');
 assert.match(source,/data\.people\.map\(person=>\(\{[^\n]*facultyRoles:\[\],officeAccess:\[\]/);
 assert.match(source,/officeAccess:Array\.isArray\(user\?\.officeAccess\)\?user\.officeAccess:\[\]/);
 assert.match(source,/facultyRoles:Array\.isArray\(user\?\.facultyRoles\)\?user\.facultyRoles:\[\]/);
});

test('Owner User Management exposes audited ADC LAB and ADFA office access checkboxes',()=>{const html=read('user-management.html'),source=read('user-management.js');for(const office of ['adc','lab','adfa'])assert.match(html,new RegExp(`name=\"office-access\" value=\"${office}\"`));assert.match(html,/Operational office access/);assert.match(source,/selectedOfficeAccess/);assert.match(source,/beforeOfficeAccess/);assert.match(source,/officeAccess:fields\.officeAccess/);});

test('Teaching Assignment responsibilities are managed separately from legacy Faculty groups',()=>{
 const html=read('user-management.html'),source=read('user-management.js');
 assert.match(html,/Teaching Assignment Groups/);
 assert.match(html,/ta-responsibility-form/);
 assert.match(html,/ta-assignment-year/);
 assert.match(source,/teaching_assignment_groups/);
 assert.match(source,/teaching_responsibilities/);
 assert.match(source,/validateGroupResponsibilities/);
 assert.match(source,/validateResponsibilitySchedule/);
 assert.match(source,/safeAssigneeProjection/);
 assert.match(source,/activeAt:firebase\.firestore\.Timestamp/);
 assert.match(source,/expiresAt:firebase\.firestore\.Timestamp/);
 assert.match(source,/db\.collection\('faculty_groups'\)/);
});

test('dated Teaching responsibility projection does not write DOE or private leave notes',()=>{
 const source=read('user-management.js');
 const start=source.indexOf('async function saveTaSchedule');
 const end=source.indexOf(" $('ta-group-picker')",start);
 const fn=source.slice(start,end);
 assert.match(fn,/safeAssigneeProjection/);
 assert.doesNotMatch(fn,/doeOverride|doeCredit|RSL|afcReason|special notes/i);
});

test('Teaching Assignment admin degrades safely before T7 rules without breaking existing User Management',()=>{
 const source=read('user-management.js');
 assert.match(source,/optionalCollection/);
 assert.match(source,/permission-denied/);
 assert.match(source,/taAdminReady/);
});

const vm=require('node:vm'),sourceFunction=require('../test-support/source-function');
function scopeEditor(value,subjects=[]){
 const context={academic:require('../academic-responsibility'),subjectCatalog:require('../subject-catalog'),data:{subjects},$:id=>({value:id==='ta-responsibility-kind'?'hicc':value})};
 vm.runInNewContext(sourceFunction('user-management.js','taScopeTokens')+'\nthis.parse=taScopeTokens;',context);
 return()=>Array.from(context.parse());
}
test('responsibility editor authorizes only active canonical Subjects and explicit course-wide scopes',()=>{
 const subjects=[{id:'surgery',key:'surgery',label:'Surgery',active:true},{id:'retired',key:'retired',label:'Retired',active:false}];
 assert.deepEqual(scopeEditor('VTMD 204 | *\nVTMD 506 | surgery',subjects)(),['hicc|VTMD 204|*','hicc|VTMD 506|surgery']);
 for(const scope of ['VTMD 506 | missing','VTMD 506 | retired','hicc|VTMD 506|missing','VTMD 506 | surgery | ignored'])assert.throws(scopeEditor(scope,subjects),/scope|subject/i,scope);
 assert.throws(scopeEditor('VTMD 506 | surgery'),/subject/i);
 assert.deepEqual(scopeEditor('VTMD 506 | *')(),['hicc|VTMD 506|*']);
});

test('account rendering displays ADC/DVM and ADFAD while preserving technical office keys',()=>{
 const elements={'account-search':{value:''},'accounts-body':{innerHTML:''}},user={uid:'office',name:'Office',accountRole:'owner',officeAccess:['adc','adfa'],facultyRoles:[],active:true};
 const context={data:{users:[user]},$:id=>elements[id],e:value=>String(value),UCVM:{label:value=>value},developerAccount:()=>false,developerActor:()=>true,document:{querySelectorAll:()=>[]}};
 vm.runInNewContext(sourceFunction('user-management.js','renderAccounts')+'\nrenderAccounts();',context);
 assert.match(elements['accounts-body'].innerHTML,/>ADC\/DVM<\/span>/);
 assert.match(elements['accounts-body'].innerHTML,/>ADFAD<\/span>/);
 assert.deepEqual(user.officeAccess,['adc','adfa']);
});

function scheduleStore(){
 const documents=new Map(),ref=path=>({path,collection:name=>({doc:id=>ref(`${path}/${name}/${id}`)})});
 const snapshot=reference=>({exists:documents.has(reference.path),data:()=>documents.get(reference.path)});
 const apply=writes=>{for(const [reference,value] of writes)documents.set(reference.path,value)};
 const db={doc:ref,collection:name=>({doc:id=>ref(`${name}/${id||`audit-${documents.size}`}`)}),
  batch:()=>{const writes=[];return{set:(reference,value)=>writes.push([reference,value]),commit:async()=>apply(writes)}},
  runTransaction:async work=>{
   for(let retry=0;retry<3;retry++){
    const writes=[],reads=new Map();
    await work({get:async reference=>{reads.set(reference.path,documents.get(reference.path));return snapshot(reference)},set:(reference,value)=>writes.push([reference,value])});
    if([...reads].some(([path,value])=>documents.get(path)!==value))continue;
    apply(writes);return;
   }
   throw Error('Transaction retry exhausted');
  }};
 return{db,documents};
}
function scheduleEditor(store,uid,revision=0){
 const responsibility={id:'hicc-vtmd204',kind:'hicc',groupId:'year-2',academicScopeTokens:['hicc|VTMD 204|*']};
 const fields={'ta-assignment-year':{value:'2026-27'},'ta-assignment-user':{value:uid},'ta-assignment-enabled':{checked:true}};
 const window={querySelector:selector=>({value:({'.ta-window-active':'2026-09-01','.ta-window-expiration':'2027-05-01','.ta-window-source':''})[selector]})};
 const context={UCVM:{general:()=>true},me:{name:'Manager'},auth:{currentUser:{uid:'owner',email:'manager@example.test'}},taAdminReady:true,data:{users:[{uid,facultyId:`f-${uid}`,active:true}]},
  $:id=>fields[id],selectedTaResponsibility:()=>responsibility,taSchedules:[],taScheduleState:{responsibilityId:responsibility.id,academicYearKey:'2026-27',scheduleRevision:revision},
  responsibilityApi:require('../teaching-responsibility'),document:{querySelectorAll:()=>[window]},firebase:{firestore:{Timestamp:{fromDate:date=>date.toISOString()}}},db:store.db,stamp:()=>123};
 vm.runInNewContext(sourceFunction('user-management.js','saveTaSchedule')+'\nthis.save=saveTaSchedule;',context);
 return context;
}
test('two managers cannot save overlapping assignments from the same loaded schedule revision',async()=>{
 const store=scheduleStore(),bill=scheduleEditor(store,'bill'),lisa=scheduleEditor(store,'lisa');
 const results=await Promise.allSettled([bill.save(),lisa.save()]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.match(results.find(result=>result.status==='rejected').reason.message,/changed|reload/i);
 assert.equal([...store.documents.keys()].filter(path=>path.includes('/assignees/')).length,1);
 assert.equal([...store.documents.keys()].filter(path=>path.startsWith('account_audit/')).length,1);
 const year=store.documents.get('teaching_responsibilities/hicc-vtmd204/years/2026-27');
 assert.equal(year.scheduleRevision,1);
 assert.ok(['bill','lisa'].includes(year.changedAssigneeUid));
});

test('dated assignment cannot save while a different responsibility/year schedule is loaded',async()=>{
 const store=scheduleStore(),editor=scheduleEditor(store,'bill');
 editor.taScheduleState={responsibilityId:'hicc-other',academicYearKey:'2026-27',scheduleRevision:0};
 await assert.rejects(editor.save(),/load|schedule/i);
 assert.equal(store.documents.size,0);
});

test('schedule load reads the coordination revision from server before reading all assignees',async()=>{
 const reads=[],year={get:async options=>{reads.push(['revision',options]);return{exists:true,data:()=>({scheduleRevision:4})}},collection:name=>({get:async options=>{reads.push([name,options]);return{docs:[]}}})};
 const context={taAdminReady:true,taSchedules:[],taScheduleState:null,taScheduleLoad:0,temporal:require('../temporal-role-assignment'),
  $:id=>({value:id==='ta-assignment-responsibility'?'hicc-vtmd204':'2026-27'}),renderTaSchedules:()=>{},storedSchedule:row=>row,
  db:{collection:()=>({doc:()=>({collection:()=>({doc:()=>year})})})}};
 vm.runInNewContext(sourceFunction('user-management.js','loadTaSchedules')+'\nthis.load=loadTaSchedules;',context);
 await context.load();
 assert.deepEqual(reads.map(([name])=>name),['revision','assignees']);
 assert.equal(reads.every(([,options])=>options?.source==='server'),true);
 assert.equal(context.taScheduleState.scheduleRevision,4);
});
