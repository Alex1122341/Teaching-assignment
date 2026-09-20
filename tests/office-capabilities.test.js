'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const load=()=>{const ctx={window:{}};vm.runInNewContext(read('office-capabilities.js'),ctx);return ctx.window.UCVM_OFFICE_CAPABILITIES;};
const access=()=>{const source=read('faculty-access.js'),end=source.indexOf(' const esc=');const ctx={window:{}};vm.runInNewContext(source.slice(0,end)+' return {role,admin,general,historyAll,label};})();',ctx);return ctx.window.UCVM;};

test('ADC has scheduling tools but cannot edit instructors or LAB topic',()=>{
 const api=load(),c=api.forRole('adc');
 for(const key of ['canViewCalendar','canAddSessions','canAddOneSession','canSelectSessions','canEditCourseFields','canReviewAdcScope'])assert.equal(c[key],true,key);
 for(const key of ['canEditInstructor','canEditLabTopic','canReviewLabScope','canReviewAdfaScope','canViewFullApprovalOverview'])assert.equal(c[key],false,key);
 assert.equal(api.officeForRole('adc'),'adc');assert.equal(api.isOfficeAccount('adc'),true);assert.ok(Object.isFrozen(c));
});
test('LAB has selection and LAB topic only',()=>{
 const api=load(),c=api.forRole('lab');
 for(const key of ['canViewCalendar','canSelectSessions','canEditLabTopic','canReviewLabScope'])assert.equal(c[key],true,key);
 for(const key of ['canAddSessions','canAddOneSession','canEditCourseFields','canEditInstructor','canReviewAdcScope','canReviewAdfaScope','canViewFullApprovalOverview'])assert.equal(c[key],false,key);
 assert.equal(api.officeForRole('lab'),'lab');
});
test('ADFA raw and legacy roles retain their existing authority',()=>{
 const api=load();for(const role of ['owner','administrator','admin','adfa_general','adfa_regular']){
  const c=api.forRole(role);for(const key of ['canViewCalendar','canAddSessions','canAddOneSession','canSelectSessions','canEditCourseFields','canEditInstructor','canEditLabTopic','canReviewAdfaScope','canViewFullApprovalOverview'])assert.equal(c[key],true,key);assert.equal(c.canReviewAdcScope,false);assert.equal(c.canReviewLabScope,false);assert.equal(api.officeForRole(role),'adfa');
 }
});
test('Faculty roles have calendar access without office authority',()=>{
 const api=load();for(const role of ['faculty','hicc','visc','editor','viewer']){
  const c=api.forRole(role);assert.equal(c.canViewCalendar,true);assert.equal(Object.values(c).filter(Boolean).length,1);assert.equal(api.officeForRole(role),'');assert.equal(api.isOfficeAccount(role),false);
 }
});
test('unknown roles fail closed and cannot mutate the shared policy',()=>{
 const api=load();for(const role of ['',null,undefined,'constructor','toString','__proto__','not-a-role'])assert.ok(Object.values(api.forRole(role)).every(v=>v===false),String(role));
 assert.throws(()=>{api.forRole('lab').canEditInstructor=true;},TypeError);assert.equal(api.forRole('lab').canEditInstructor,false);
});
test('ADC/LAB are labelled correctly and are not broad admins or history readers',()=>{
 const a=access();for(const role of ['adc','lab']){assert.equal(a.label(role),role.toUpperCase());assert.equal(a.admin({role}),false);assert.equal(a.general({role}),false);assert.equal(a.historyAll({role}),false);}
 assert.equal(a.admin({role:'other_office'}),true);
});
test('office accounts never attempt Faculty Directory auto-linking',async()=>{
 const a=access(),sourceFunction=require('../test-support/source-function');let reads=0;
 const ctx={admin:a.admin,role:a.role,firebase:{firestore(){reads++;throw Error('Private read attempted');}}};
 vm.runInNewContext(sourceFunction('faculty-access.js','linkFacultyIdentity')+'\nthis.link=linkFacultyIdentity;',ctx);
 for(const role of ['adc','lab','other_office'])await ctx.link({email:'office@example.test'},{role,email:'office@example.test'});
 assert.equal(reads,0);
});
test('office capability module is deployed before timetable consumers',()=>{
 const html=read('index.html'),assets=JSON.parse(read('tools/static-assets.json'));
 assert.ok(assets.includes('office-capabilities.js'));assert.ok(html.includes('<script src="office-capabilities.js"></script>'));
 assert.ok(html.indexOf('office-capabilities.js')<html.indexOf('timetable.js'));
});


test('Developer has every office capability and highest access helpers',()=>{
 const api=load(),c=api.forRole('developer');for(const [key,value] of Object.entries(c))assert.equal(value,true,key);
 assert.equal(api.officeForRole('developer'),'adfa');assert.equal(api.isOfficeAccount('developer'),true);
 const a=access();assert.equal(a.admin({role:'developer'}),true);assert.equal(a.general({role:'developer'}),true);assert.equal(a.historyAll({role:'developer'}),true);assert.equal(a.label('developer'),'Developer');
});
