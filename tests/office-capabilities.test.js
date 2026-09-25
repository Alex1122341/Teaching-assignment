'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const load=()=>{const ctx={window:{}};vm.runInNewContext(read('office-capabilities.js'),ctx);return ctx.window.UCVM_OFFICE_CAPABILITIES;};
const access=()=>{const source=read('faculty-access.js'),end=source.indexOf(' const esc=');const ctx={window:{}};vm.runInNewContext(source.slice(0,end)+' return {role,admin,general,historyAll,label};})();',ctx);return ctx.window.UCVM;};

test('ADC is the scheduling owner but cannot assign faculty or edit LAB work',()=>{
 const api=load(),c=api.forRole('adc');
 for(const key of ['canViewCalendar','canAddSessions','canAddOneSession','canSelectSessions','canEditCourseFields','canSuggestFaculty','canReviewAdcScope'])assert.equal(c[key],true,key);
 for(const key of ['canEditInstructor','canEditLabTopic','canEditLabGroups','canEditLabRoster','canReviewLabScope','canReviewAdfaScope','canViewFullApprovalOverview','canOverride'])assert.equal(c[key],false,key);
 assert.equal(api.officeForRole('adc'),'adc');assert.equal(api.isOfficeAccount('adc'),true);assert.ok(Object.isFrozen(c));
});
test('LAB owns LAB work only and does not get unrestricted session selection',()=>{
 const api=load(),c=api.forRole('lab');
 for(const key of ['canViewCalendar','canEditLabTopic','canEditLabGroups','canEditLabRoster','canSuggestFaculty','canReviewLabScope'])assert.equal(c[key],true,key);
 for(const key of ['canAddSessions','canAddOneSession','canSelectSessions','canEditCourseFields','canEditInstructor','canReviewAdcScope','canReviewAdfaScope','canViewFullApprovalOverview','canOverride'])assert.equal(c[key],false,key);
 assert.equal(api.officeForRole('lab'),'lab');
});
test('ADFA operational roles are faculty-assignment-only and never general timetable editors',()=>{
 const api=load();
 for(const role of ['owner','administrator','admin','adfa_general','adfa_regular']){
  const c=api.forRole(role);
  assert.equal(c.canEditInstructor,true,role);
  for(const key of ['canViewCalendar','canReviewAdfaScope','canViewFullApprovalOverview'])assert.equal(c[key],true,role+'/'+key);
  // Add One, Add Sessions, general selection, course fields and LAB editing are
  // all denied even for an ADFA account holding DOE Administration authority.
  for(const key of ['canAddSessions','canAddOneSession','canSelectSessions','canEditCourseFields','canEditLabTopic','canEditLabGroups','canEditLabRoster','canSuggestFaculty','canReviewAdcScope','canReviewLabScope'])assert.equal(c[key],false,role+'/'+key);
  assert.equal(api.officeForRole(role),'adfa');
 }
});
test('Owner keeps an explicit administrative override while ADFA Administrator does not',()=>{
 const api=load();
 assert.equal(api.forRole('owner').canOverride,true);
 assert.equal(api.forRole('adfa_general').canOverride,true);
 for(const role of ['administrator','admin','adfa_regular','adc','lab','faculty'])assert.equal(api.forRole(role).canOverride,false,role);
 assert.equal(api.forRole('developer').canOverride,true);
});
test('Developer keeps full authority over every operational capability',()=>{
 const api=load(),c=api.forRole('developer');
 assert.equal(Object.values(c).every(value=>value===true),true);
 assert.equal(api.officeForRole('developer'),'adfa');
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
 const a=access();assert.equal(a.label('adc'),'ADC/DVM');assert.equal(a.label('lab'),'LAB');for(const role of ['adc','lab']){assert.equal(a.admin({role}),false);assert.equal(a.general({role}),false);assert.equal(a.historyAll({role}),false);}
 assert.equal(a.admin({role:'other_office'}),false);assert.equal(a.general({role:'other_office'}),false);assert.equal(a.historyAll({role:'other_office'}),false);
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


test('retired Other Office fails closed without calendar or operational authority',()=>{
 const api=load(),c=api.forRole('other_office');
 for(const [key,value] of Object.entries(c))assert.equal(value,false,key);
 assert.equal(api.officeForRole('other_office'),'');assert.equal(api.isOfficeAccount('other_office'),false);
});

test('retired and unknown roles cannot gain authority from a positive Teaching Assignment context',()=>{
 const api=load(),teachingAssignment={hiccAssigned:true,ownsPackage:true,hasAcademicScope:true,viscAssigned:true,leadsGroup:true,viscApprovalCurrent:true};
 for(const role of ['other_office','unknown','','constructor'])for(const state of ['draft','visc_review','changes_requested','visc_approved']){
  const caps=api.forProfile({role,officeAccess:['adc','lab','adfa']},{teachingAssignment:{...teachingAssignment,state}});
  assert.equal(Object.values(caps).some(Boolean),false,`${role}/${state}`);
 }
});

test('officeAccess can delegate operational offices without changing system-level role authority',()=>{const api=load(),owner=api.forProfile({role:'owner',officeAccess:['adc','lab']});for(const key of ['canAddSessions','canSelectSessions','canEditCourseFields','canEditLabTopic','canEditLabGroups','canEditLabRoster'])assert.equal(owner[key],true,key);assert.equal(owner.canEditInstructor,false);assert.equal(owner.canOverride,true);assert.equal(owner.canViewFullApprovalOverview,true);assert.deepEqual(Array.from(api.officesForProfile({role:'administrator',officeAccess:['lab','adfa']})),['lab','adfa']);assert.equal(api.hasOfficeAccess({role:'administrator',officeAccess:['lab']},'lab'),true);assert.equal(api.hasOfficeAccess({role:'administrator',officeAccess:['lab']},'adfa'),false);});
test('officeAccess cannot turn faculty-facing or Other Office accounts into operational offices',()=>{const api=load();for(const role of ['faculty','hicc','visc','other_office']){assert.deepEqual(Array.from(api.officesForProfile({role,officeAccess:['adc','lab','adfa']})),[]);const c=api.forProfile({role,officeAccess:['adc','lab','adfa']});assert.equal(c.canAddSessions,false,role);assert.equal(c.canEditInstructor,false,role);}});
test('stage-scoped capabilities prevent a multi-office account from mixing office fields in one editor',()=>{const api=load(),profile={role:'owner',officeAccess:['adc','adfa']};const adc=api.forProfile(profile,{stage:'adc'}),adfa=api.forProfile(profile,{stage:'adfa'});assert.equal(adc.canEditCourseFields,true);assert.equal(adc.canEditInstructor,false);assert.equal(adfa.canEditCourseFields,false);assert.equal(adfa.canEditInstructor,true);});

test('non-admin ADC LAB profiles cannot acquire ADFA through forged officeAccess',()=>{const api=load();assert.deepEqual(Array.from(api.officesForProfile({role:'adc',officeAccess:['lab','adfa']})),['lab']);assert.equal(api.forProfile({role:'lab',officeAccess:['adfa']}).canEditInstructor,false);assert.deepEqual(Array.from(api.allowedOfficesForRole('owner')),['adc','lab','adfa']);});

test('time-bounded HICC responsibility grants scoped package capabilities without changing primary Faculty role',()=>{
 const api=load(),base={role:'faculty'},draft=api.forProfile(base,{teachingAssignment:{hiccAssigned:true,ownsPackage:true,hasAcademicScope:true,state:'draft'}});
 for(const key of ['canViewTeachingAssignmentWorking','canViewHiccPackage','canEditHiccTopic','canSuggestHiccFaculty','canSubmitHiccPackage'])assert.equal(draft[key],true,key);
 assert.equal(draft.canApproveViscPackage,false);
 assert.equal(draft.canFinalSubmitHiccPackage,false);
 const approved=api.forProfile(base,{teachingAssignment:{hiccAssigned:true,ownsPackage:true,hasAcademicScope:true,state:'visc_approved',viscApprovalCurrent:true}});
 assert.equal(approved.canFinalSubmitHiccPackage,true);
});

test('HICC role name alone does not grant current-duty capabilities and incomplete context fails closed',()=>{
 const api=load();
 for(const profile of [{role:'hicc'},{role:'faculty'}]){
  const c=api.forProfile(profile);
  for(const key of ['canViewHiccPackage','canEditHiccTopic','canSuggestHiccFaculty','canSubmitHiccPackage','canFinalSubmitHiccPackage'])assert.equal(c[key],false,key);
 }
 assert.equal(api.forProfile({role:'faculty'},{teachingAssignment:{hiccAssigned:true,ownsPackage:true,hasAcademicScope:false,state:'draft'}}).canSubmitHiccPackage,false);
});

test('current VISC leader assignment is review-only and cannot edit or Final Submit HICC package',()=>{
 const api=load(),c=api.forProfile({role:'faculty'},{teachingAssignment:{viscAssigned:true,leadsGroup:true,state:'visc_review'}});
 for(const key of ['canViewTeachingAssignmentWorking','canViewViscPackages','canApproveViscPackage','canPushBackViscPackage'])assert.equal(c[key],true,key);
 for(const key of ['canEditHiccTopic','canSuggestHiccFaculty','canSubmitHiccPackage','canFinalSubmitHiccPackage','canEditInstructor'])assert.equal(c[key],false,key);
});

test('VISC role name alone grants no group review authority',()=>{
 const api=load(),c=api.forProfile({role:'visc'});
 for(const key of ['canViewViscPackages','canApproveViscPackage','canPushBackViscPackage'])assert.equal(c[key],false,key);
});

test('timetable publication is limited to Developer and Owner ADFAD General-equivalent authority',()=>{
 const api=load();
 assert.equal(api.forRole('developer').canPublishTimetable,true);
 assert.equal(api.forRole('owner').canPublishTimetable,true);
 assert.equal(api.forRole('adfa_general').canPublishTimetable,true);
 for(const role of ['administrator','adfa_regular','adc','lab','hicc','visc','faculty'])assert.equal(api.forRole(role).canPublishTimetable,false,role);
});
