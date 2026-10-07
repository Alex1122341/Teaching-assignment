'use strict';
const {test,before,after,beforeEach}=require('node:test');
const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {serverTimestamp,Timestamp,increment}=require('firebase/firestore');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const calendar=require('../calendar-session');
const {PACKAGE,packageRow,session,projection,meta,setup,seed,edit}=require('./helpers/teaching-assignment-security');
const PROJECT_ID='demo-ucvm-t7-submission';
const enabled=Boolean(process.env.FIRESTORE_EMULATOR_HOST);let env;
const check=(name,fn)=>test('T7 submission: '+name,{skip:!enabled},fn);
const db=uid=>env.authenticatedContext(uid).firestore();
const pkg=uid=>db(uid).doc('teaching_assignment_submissions/'+PACKAGE);
before(async()=>{if(enabled)env=await setup(PROJECT_ID);});
beforeEach(async()=>{if(env)await seed(env,async fire=>{
 await fire.doc('teaching_assignment_submissions/'+PACKAGE).set(packageRow());
 await fire.doc('teaching_assignment_groups/surgery').set({id:'surgery',name:'Surgery',active:true,leaderViscResponsibilityId:'visc-surgery',hiccResponsibilityIds:['hicc-surgery']});
 await fire.doc('teaching_responsibilities/hicc-surgery').set({id:'hicc-surgery',kind:'hicc',groupId:'surgery',active:true,academicScopeTokens:['hicc|VTMD 505|surgery']});
 await fire.doc('sessions/s1').set(session());await fire.doc('calendar_sessions/s1').set(projection(session()));
});});
after(async()=>{if(env)await env.cleanup();});
const review=()=>packageRow({status:'visc_review',revision:1,submittedWorkingRevision:0,reviewFingerprint:'ta-review-v1:current'});
const approved=()=>({...review(),status:'visc_approved',viscApprovedWorkingRevision:0,viscApprovedFingerprint:'ta-review-v1:current'});
check('scoped HICC and VISC read only the sanitized owned calendar, never private legacy assignments',async()=>{
 const source=session({instructor:'Faculty A',assignments:[{ucid:'private-ucid',facultyId:'private-faculty',name:'Faculty A',doeCredit:99}],facultyIds:['private-faculty']});
 await seed(env,async fire=>{await fire.doc('sessions/s1').set(source);await fire.doc('calendar_sessions/s1').set(calendar.fromSource(source,'s1'));});
 for(const uid of ['hicc','successor','visc']){
  await assertFails(db(uid).doc('sessions/s1').get());
  const publicRow=(await assertSucceeds(db(uid).doc('calendar_sessions/s1').get())).data();
  for(const key of ['assignments','facultyIds','teachingAssignmentSubmissionId'])assert.equal(key in publicRow,false,key);
 }
});
check('real ownership adapter initializes and attaches for Owner and ADC without leaking private assignment data',async()=>{
 const window={UCVM:{general:profile=>['developer','owner','adfa_general'].includes(profile?.role)}};
 // Use the SDK's realm: cross-VM object prototypes are not Firestore plain maps.
 for(const file of ['scheduling-core','office-capabilities','session-workflow','subject-catalog','temporal-role-assignment','academic-responsibility','teaching-responsibility','teaching-assignment-groups','timetable-selection'])vm.runInThisContext('(function(window,module){'+fs.readFileSync(path.join(__dirname,'..',file+'.js'),'utf8')+'\n})')(window);
 const api=window.UCVM_TIMETABLE_SELECTION;
 const group={id:'surgery',name:'Surgery',active:true,leaderViscResponsibilityId:'visc-surgery',hiccResponsibilityIds:['hicc-surgery']};
 const definitions=[{id:'visc-surgery',kind:'visc',active:true},{id:'hicc-surgery',kind:'hicc',active:true,groupId:'surgery',academicScopeTokens:['hicc|VTMD 505|surgery']}];
 for(const uid of ['owner','adc']){
  const source=session({instructor:'Faculty A',assignments:[{ucid:'private-ucid',facultyId:'private-faculty',name:'Faculty A',doeCredit:99}],facultyIds:['private-faculty']});
  for(const key of ['teachingAssignmentGroupId','responsibleHiccResponsibilityId','teachingAssignmentSubmissionId'])delete source[key];
  await seed(env,async fire=>{await fire.doc('sessions/s1').set(source);await fire.doc('calendar_sessions/s1').set(calendar.fromSource(source,'s1'));await fire.doc('teaching_assignment_submissions/'+PACKAGE).delete();});
  const original={id:'s1',...(uid==='adc'?calendar.fromSource(source,'s1'):source)},actor={uid,role:uid},row={...original,teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery'};
  const plan=api.planChanges([original],[row],actor,serverTimestamp(),undefined,{role:uid==='owner'?'ta_config':'adc',allowTeachingAssignmentOwnership:true,teachingAssignmentGroups:[group],teachingResponsibilities:definitions});
  assert.equal(plan.errors.length,0,plan.errors.join(' '));
  const adapter=api.createOwnershipAdapter({db:db(uid),actor,configurationReady:()=>true,calendarFromSource:calendar.fromSource});
  await assertSucceeds(api.commitPlan(plan,{commitOwnership:adapter.save}));
  assert.equal((await pkg(uid).get()).data().workingRevision,1);
  assert.equal((await db('owner').doc('sessions/s1').get()).data().assignments[0].ucid,'private-ucid');
  const safe=(await db(uid).doc('calendar_sessions/s1').get()).data();
  assert.equal('teachingAssignmentSubmissionId' in safe,false);
  if(uid==='adc')await assertFails(db(uid).doc('sessions/s1').get());
 }
 // Exercise the actual ordinary editor after attachment, including LAB which
 // cannot read the package. The atomic increment needs no client package read.
 for(const uid of ['adc','lab']){
  const source=session({type:uid==='lab'?'LAB':'LEC'});
  await seed(env,async fire=>{await fire.doc('sessions/s1').set(source);await fire.doc('calendar_sessions/s1').set(calendar.fromSource(source,'s1'));await fire.doc('teaching_assignment_submissions/'+PACKAGE).set(packageRow());});
  const original={id:'s1',...calendar.fromSource(source,'s1')},plan=api.planChanges([original],[{...original,topic:'Office revision',...(uid==='lab'?{labGroupIds:['adapter-lab']}: {})}],{uid,role:uid},serverTimestamp(),undefined,{role:uid});
  if(uid==='lab')await seed(env,fire=>fire.doc('lab_groups/adapter-lab').set({groupId:'adapter-lab'}));
  assert.equal(plan.errors.length,0,plan.errors.join(' '));
  for(const update of plan.updates)Object.assign(update.data,meta(uid));
  const fire=db(uid),store={batch:()=>fire.batch(),sessionRef:id=>fire.doc('sessions/'+id),calendarRef:id=>fire.doc('calendar_sessions/'+id),calendarFromSource:calendar.fromSource,logRef:()=>fire.collection('session_change_log').doc(),packageRef:id=>fire.doc('teaching_assignment_submissions/'+id),increment};
  await assertSucceeds(api.commitPlan(plan,store));
  assert.equal((await pkg('owner').get()).data().workingRevision,1);
  await seed(env,fire=>fire.doc('teaching_assignment_submissions/'+PACKAGE).update({status:'visc_review'}));
  const frozen=api.planChanges([{...original,topic:'Office revision',...(uid==='lab'?{labGroupIds:['adapter-lab']}: {})}],[{...original,topic:'Frozen revision',...(uid==='lab'?{labGroupIds:['adapter-lab']}: {})}],{uid,role:uid},serverTimestamp(),undefined,{role:uid});
  for(const update of frozen.updates)Object.assign(update.data,meta(uid));
  await assertFails(api.commitPlan(frozen,store));
 }
});
check('current stable HICC duty and group VISC can read, role alone and ordinary Faculty cannot',async()=>{
 for(const uid of ['hicc','successor','visc','owner','admin']){
  await assertSucceeds(db(uid).doc('calendar_sessions/s1').get());await assertSucceeds(pkg(uid).get());
  await (['owner','admin'].includes(uid)?assertSucceeds:assertFails)(db(uid).doc('sessions/s1').get());
 }
 for(const uid of ['other','faculty','expired','future','disabled']){
  await assertFails(db(uid).doc('sessions/s1').get());await assertFails(pkg(uid).get());
 }
});
check('HICC edits topic with an atomic generation and paired sanitized calendar',async()=>{
 await assertFails(edit(env,'hicc',{topic:'New topic'},{bump:false}));
 await assertSucceeds(edit(env,'hicc',{topic:'New topic'}));
 await assertFails(edit(env,'hicc',{topic:'Stale edit'}));
 await assertSucceeds(edit(env,'successor',{topic:'Successor edit'},{revision:2,row:session({topic:'New topic'})}));
});
check('counter-only and note-only witnesses cannot invalidate approval; multiple changed rows share one generation',async()=>{
 await assertFails(pkg('hicc').update({workingRevision:1,workingChange:{kind:'session',id:'s1'},...meta('hicc')}));
 await seed(env,async fire=>{await fire.doc('sessions/s2').set(session());await fire.doc('calendar_sessions/s2').set(projection(session(),'s2'));});
 const fire=db('hicc'),batch=fire.batch();
 for(const id of ['s1','s2']){batch.update(fire.doc('sessions/'+id),{topic:'Two rows',...meta('hicc')});batch.set(fire.doc('calendar_sessions/'+id),projection(session({topic:'Two rows'}),id));}
 batch.update(fire.doc('teaching_assignment_submissions/'+PACKAGE),{workingRevision:1,workingChange:{kind:'session',id:'s1'},...meta('hicc')});
 await assertSucceeds(batch.commit());
});
check('VISC, wrong HICC, expired and future duties cannot edit content',async()=>{
 for(const uid of ['visc','other','expired','future','disabled'])await assertFails(edit(env,uid,{topic:'Denied'}));
});
check('exact Subject cannot be substituted by Topic; mismatched and missing ownership locators fail closed',async()=>{
 for(const patch of [{subjectKey:'medicine',topic:'surgery'},{course:'VTMD 506'},{teachingAssignmentGroupId:'other'},{teachingAssignmentSubmissionId:'missing'},{academicYear:'2027-28'}]){
  await seed(env,fire=>fire.doc('sessions/s1').set(session(patch)));
  await assertFails(db('hicc').doc('sessions/s1').get());
  await assertFails(edit(env,'hicc',{topic:'Denied'},{row:session(patch)}));
 }
});
check('owned session admin and ADC legacy paths cannot bypass atomic revision or frozen state',async()=>{
 for(const uid of ['owner','admin','adc'])await assertFails(edit(env,uid,{topic:'No bump'},{bump:false}));
 await assertSucceeds(edit(env,'adc',{topic:'ADC content'}));
 for(const status of ['visc_review','submitted_to_adfad','adfad_finalized']){
  await seed(env,fire=>fire.doc('teaching_assignment_submissions/'+PACKAGE).set(packageRow({status})));
  for(const uid of ['owner','admin','adc','hicc'])await assertFails(edit(env,uid,{topic:'Frozen'}));
 }
});
check('trusted ownership cannot be self reassigned and owned deletes require a generation',async()=>{
 for(const uid of ['hicc','visc','admin','adc'])await assertFails(db(uid).doc('sessions/s1').update({responsibleHiccResponsibilityId:'other',...meta(uid)}));
 const fire=db('owner'),batch=fire.batch();batch.delete(fire.doc('sessions/s1'));batch.delete(fire.doc('calendar_sessions/s1'));
 await assertFails(batch.commit());
});
check('HICC submit, VISC approve and HICC final submit enforce exact generation and fingerprint',async()=>{
 await assertSucceeds(pkg('hicc').update({status:'visc_review',revision:1,submittedWorkingRevision:0,viscApprovedWorkingRevision:null,reviewFingerprint:'ta-review-v1:current',viscApprovedFingerprint:'',viscReviewComment:'',submittedForReviewAt:serverTimestamp(),viscReviewedAt:null,finalSubmittedAt:null,...meta('hicc')}));
 await assertFails(pkg('hicc').update({status:'visc_approved',viscApprovedWorkingRevision:0,viscApprovedFingerprint:'ta-review-v1:current',viscReviewedAt:serverTimestamp(),...meta('hicc')}));
 await assertSucceeds(pkg('visc').update({status:'visc_approved',viscApprovedWorkingRevision:0,viscApprovedFingerprint:'ta-review-v1:current',viscReviewedAt:serverTimestamp(),...meta('visc')}));
 await assertFails(pkg('visc').update({status:'submitted_to_adfad',finalSubmittedAt:serverTimestamp(),...meta('visc')}));
 await assertSucceeds(pkg('successor').update({status:'submitted_to_adfad',finalSubmittedAt:serverTimestamp(),...meta('successor')}));
});
check('old fingerprint replay cannot final submit after approved content changes',async()=>{
 await seed(env,fire=>fire.doc('teaching_assignment_submissions/'+PACKAGE).set(approved()));
 await assertSucceeds(edit(env,'hicc',{topic:'Changed after approval'}));
 await assertFails(pkg('hicc').update({status:'submitted_to_adfad',reviewFingerprint:'ta-review-v1:current',viscApprovedFingerprint:'ta-review-v1:current',finalSubmittedAt:serverTimestamp(),...meta('hicc')}));
 await assertSucceeds(pkg('hicc').update({status:'visc_review',revision:2,submittedWorkingRevision:1,viscApprovedWorkingRevision:null,reviewFingerprint:'ta-review-v1:new',viscApprovedFingerprint:'',viscReviewComment:'',submittedForReviewAt:serverTimestamp(),viscReviewedAt:null,finalSubmittedAt:null,...meta('hicc')}));
});
check('VISC push back requires a comment, keeps identity immutable and returns to HICC',async()=>{
 await seed(env,fire=>fire.doc('teaching_assignment_submissions/'+PACKAGE).set(review()));
 const patch={status:'changes_requested',viscApprovedWorkingRevision:null,viscApprovedFingerprint:'',viscReviewComment:'   ',viscReviewedAt:serverTimestamp(),finalSubmittedAt:null,...meta('visc')};
 await assertFails(pkg('visc').update(patch));
 await assertFails(pkg('visc').update({...patch,viscReviewComment:'Revise',groupId:'other'}));
 await assertSucceeds(pkg('visc').update({...patch,viscReviewComment:'Revise'}));
 await assertSucceeds(edit(env,'hicc',{topic:'Revision'}));
});
check('package creation and ownership attachment are high trust; packages start at generation zero',async()=>{
 const id='ta-sub-v2__2026-27__surgery__hicc-second',row=packageRow({id,hiccResponsibilityId:'hicc-second',...meta('owner')});
 await seed(env,async fire=>{
  await fire.doc('teaching_responsibilities/hicc-second').set({id:'hicc-second',kind:'hicc',groupId:'surgery',active:true,academicScopeTokens:['hicc|VTMD 505|surgery']});
  await fire.doc('teaching_assignment_groups/surgery').update({hiccResponsibilityIds:['hicc-surgery','hicc-second']});
 });
 await assertFails(db('hicc').doc('teaching_assignment_submissions/'+id).set({...row,...meta('hicc')}));
 await assertFails(db('owner').doc('teaching_assignment_submissions/'+id).set({...row,workingRevision:5}));
 await assertSucceeds(db('owner').doc('teaching_assignment_submissions/'+id).set(row));
});
check('Owner and ADC can create an unassigned owned session with its first atomic generation',async()=>{
 for(const uid of ['owner','adc']){
  await seed(env,fire=>fire.doc('teaching_assignment_submissions/'+PACKAGE).set(packageRow()));
  const fire=db(uid),id='owned-create-'+uid,batch=fire.batch(),source=session({...meta(uid)});
  batch.set(fire.doc('sessions/'+id),source);batch.set(fire.doc('calendar_sessions/'+id),projection(source,id));
  batch.update(fire.doc('teaching_assignment_submissions/'+PACKAGE),{workingRevision:1,workingChange:{kind:'session',id},...meta(uid)});
  await assertSucceeds(batch.commit());
 }
});
check('trusted ownership attachment succeeds while HICC VISC and ordinary Administrator cannot attach',async()=>{
 const unowned=session();for(const key of ['teachingAssignmentGroupId','responsibleHiccResponsibilityId','teachingAssignmentSubmissionId'])delete unowned[key];
 const attach=(uid,calendar=true)=>{
  const fire=db(uid),batch=fire.batch();batch.update(fire.doc('sessions/attach'),{
   teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery',teachingAssignmentSubmissionId:PACKAGE,...meta(uid)});
  if(calendar)batch.set(fire.doc('calendar_sessions/attach'),projection(session(),'attach'));
  batch.update(fire.doc('teaching_assignment_submissions/'+PACKAGE),{workingRevision:1,workingChange:{kind:'session',id:'attach'},...meta(uid)});return batch.commit();
 };
 await seed(env,async fire=>{await fire.doc('sessions/attach').set(unowned);await fire.doc('calendar_sessions/attach').set(projection(unowned,'attach'));});
 for(const uid of ['hicc','visc','admin'])await assertFails(attach(uid));
 await assertFails(attach('owner',false));
 await assertSucceeds(attach('owner'));
 await seed(env,async fire=>{await fire.doc('sessions/attach').set(unowned);await fire.doc('teaching_assignment_submissions/'+PACKAGE).set(packageRow());});
 await assertSucceeds(attach('adc'));
});
check('trusted rehoming advances both packages and refuses a missing old-package generation',async()=>{
 const nextId='ta-sub-v2__2026-27__surgery__hicc-next';
 await seed(env,async fire=>{
  await fire.doc('teaching_responsibilities/hicc-next').set({id:'hicc-next',kind:'hicc',groupId:'surgery',active:true,academicScopeTokens:['hicc|VTMD 505|surgery']});
  await fire.doc('teaching_assignment_groups/surgery').update({hiccResponsibilityIds:['hicc-surgery','hicc-next']});
  await fire.doc('teaching_assignment_submissions/'+nextId).set(packageRow({id:nextId,hiccResponsibilityId:'hicc-next'}));
 });
 const move=(includeOld,calendar=true)=>{
  const fire=db('owner'),batch=fire.batch();
  batch.update(fire.doc('sessions/s1'),{responsibleHiccResponsibilityId:'hicc-next',teachingAssignmentSubmissionId:nextId,...meta('owner')});
  if(calendar)batch.set(fire.doc('calendar_sessions/s1'),projection(session({responsibleHiccResponsibilityId:'hicc-next',teachingAssignmentSubmissionId:nextId})));
  for(const id of includeOld?[PACKAGE,nextId]:[nextId])batch.update(fire.doc('teaching_assignment_submissions/'+id),{workingRevision:1,workingChange:{kind:'session',id:'s1'},...meta('owner')});
  return batch.commit();
 };
 await assertFails(move(false));await assertFails(move(true,false));await assertSucceeds(move(true));
 await assertFails(db('hicc').doc('sessions/s1').get());
});
check('trusted owned deletion succeeds only with calendar deletion and an atomic package generation',async()=>{
 const remove=calendar=>{
  const fire=db('owner'),batch=fire.batch();batch.delete(fire.doc('sessions/s1'));
  if(calendar)batch.delete(fire.doc('calendar_sessions/s1'));
  batch.update(fire.doc('teaching_assignment_submissions/'+PACKAGE),{workingRevision:1,workingChange:{kind:'session',id:'s1'},...meta('owner')});return batch.commit();
 };
 await assertFails(remove(false));await assertSucceeds(remove(true));
});
check('LAB may update owned LAB Topic with a generation while scoped HICC cannot',async()=>{
 const source=session({type:'LAB'});
 await seed(env,async fire=>{await fire.doc('sessions/s1').set(source);await fire.doc('calendar_sessions/s1').set(projection(source));});
 await assertFails(edit(env,'hicc',{topic:'HICC cannot edit LAB'},{row:source}));
 await assertFails(edit(env,'lab',{topic:'LAB revised'},{row:source,bump:false}));
 await assertSucceeds(edit(env,'lab',{topic:'LAB revised'},{row:source}));
});
check('course-wide scope allows another Subject in the exact course but never another course',async()=>{
 const source=session({subjectKey:'medicine'});
 await seed(env,async fire=>{
  await fire.doc('teaching_responsibilities/hicc-surgery').update({academicScopeTokens:['hicc|VTMD 505|*']});
  await fire.doc('sessions/s1').set(source);await fire.doc('calendar_sessions/s1').set(projection(source));
 });
 await assertSucceeds(db('hicc').doc('calendar_sessions/s1').get());
 await assertSucceeds(edit(env,'hicc',{topic:'Course-wide edit'},{row:source}));
 await seed(env,fire=>fire.doc('sessions/s1').set(session({course:'VTMD 506',subjectKey:'medicine'})));
 await assertFails(db('hicc').doc('sessions/s1').get());
});
check('the server-timestamp handoff removes the old assignee and activates the replacement',async()=>{
 // Firestore cannot transform a timestamp inside an array or override request.time.
 // Use its committed server time as the shared exclusive/inclusive boundary;
 // date-equality itself is also covered by the pure Bill/Lisa/Bill test.
 await seed(env,async fire=>{
  const marker=fire.doc('test_clock/handoff');await marker.set({at:serverTimestamp()});
  const boundary=(await marker.get()).data().at;
  for(const [uid,activeAt,expiresAt] of [
   ['boundary-old',Timestamp.fromMillis(boundary.toMillis()-3600000),boundary],
   ['boundary-new',boundary,Timestamp.fromMillis(boundary.toMillis()+3600000)]]){
   await fire.doc('users/'+uid).set({role:'faculty',active:true,mustChangePassword:false,facultyId:'f-'+uid});
   await fire.doc(`teaching_responsibilities/hicc-surgery/years/2026-27/assignees/${uid}`).set({responsibilityId:'hicc-surgery',academicYearKey:'2026-27',assigneeUid:uid,facultyId:'f-'+uid,enabled:true,windows:[{activeDate:'2026-09-01',expirationDate:'2027-01-01',activeAt,expiresAt}]});
  }
 });
 await assertFails(pkg('boundary-old').get());await assertFails(edit(env,'boundary-old',{topic:'Expired'}));
 await assertSucceeds(pkg('boundary-new').get());await assertSucceeds(edit(env,'boundary-new',{topic:'Current replacement'}));
});
check('one current VISC leads multiple explicit groups but cannot read or approve a differently led group',async()=>{
 const groups=[['second-group','visc-surgery'],['outside-group','visc-outside']];
 await seed(env,async fire=>{
  await fire.doc('teaching_assignment_submissions/'+PACKAGE).set(review());
  await fire.doc('teaching_responsibilities/visc-outside').set({id:'visc-outside',kind:'visc',groupId:'',active:true,academicScopeTokens:[]});
  for(const [groupId,viscResponsibilityId] of groups){
   const hiccResponsibilityId='hicc-'+groupId,id=`ta-sub-v2__2026-27__${groupId}__${hiccResponsibilityId}`;
   await fire.doc('teaching_assignment_groups/'+groupId).set({id:groupId,name:groupId,active:true,leaderViscResponsibilityId:viscResponsibilityId,hiccResponsibilityIds:[hiccResponsibilityId]});
   await fire.doc('teaching_responsibilities/'+hiccResponsibilityId).set({id:hiccResponsibilityId,kind:'hicc',groupId,active:true,academicScopeTokens:['hicc|VTMD 505|surgery']});
   await fire.doc('teaching_assignment_submissions/'+id).set({...review(),id,groupId,hiccResponsibilityId,viscResponsibilityId});
   await fire.doc('sessions/'+groupId).set(session({teachingAssignmentGroupId:groupId,responsibleHiccResponsibilityId:hiccResponsibilityId,teachingAssignmentSubmissionId:id}));
   await fire.doc('calendar_sessions/'+groupId).set(projection(session({teachingAssignmentGroupId:groupId,responsibleHiccResponsibilityId:hiccResponsibilityId,teachingAssignmentSubmissionId:id}),groupId));
  }
 });
 const approve=id=>db('visc').doc('teaching_assignment_submissions/'+id).update({status:'visc_approved',viscApprovedWorkingRevision:0,viscApprovedFingerprint:'ta-review-v1:current',viscReviewedAt:serverTimestamp(),...meta('visc')});
 await assertSucceeds(approve(PACKAGE));
 for(const [groupId] of groups){
  const id=`ta-sub-v2__2026-27__${groupId}__hicc-${groupId}`,assertAccess=groupId==='second-group'?assertSucceeds:assertFails;
  await assertAccess(db('visc').doc('calendar_sessions/'+groupId).get());await assertAccess(db('visc').doc('teaching_assignment_submissions/'+id).get());await assertAccess(approve(id));
 }
});
check('Other Office has no owned Working package or review authority even with a current duty',async()=>{
 await seed(env,async fire=>{
  await fire.doc('users/retired').set({role:'other_office',active:true,mustChangePassword:false,officeAccess:['adc','lab','adfa']});
  const current=(await fire.doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/hicc').get()).data();
  await fire.doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/retired').set({...current,assigneeUid:'retired'});
 });
 for(const path of ['sessions/s1','calendar_sessions/s1','teaching_assignment_submissions/'+PACKAGE])await assertFails(db('retired').doc(path).get());
 await assertFails(edit(env,'retired',{topic:'Retired role edit'}));
 await assertFails(pkg('retired').update({status:'visc_review',revision:1,submittedWorkingRevision:0,reviewFingerprint:'ta-review-v1:current',submittedForReviewAt:serverTimestamp(),...meta('retired')}));
});
check('a metadata-only HICC write cannot forge calendar instructor names',async()=>{
 const attempt=names=>{
  const fire=db('hicc'),batch=fire.batch();batch.update(fire.doc('sessions/s1'),meta('hicc'));
  batch.set(fire.doc('calendar_sessions/s1'),{...projection(session()),instructorNames:names});return batch.commit();
 };
 await assertFails(attempt(['Arbitrary Faculty']));await assertSucceeds(attempt([]));
});
check('owned public Topic remains scalar even with a matching calendar and correct generation',async()=>{
 await assertFails(edit(env,'hicc',{topic:{studentIds:['30012345']}}));
 await assertSucceeds(edit(env,'hicc',{topic:'Safe topic'}));
});
check('owned LAB content with all eight group references fits the real document-access budget',async()=>{
 const labGroupIds=Array.from({length:8},(_,i)=>'owned-group-'+i),source=session({type:'LAB',labGroupIds});
 await seed(env,async fire=>{
  for(const id of labGroupIds)await fire.doc('lab_groups/'+id).set({groupId:id,active:true});
  await fire.doc('settings/system_state').set({teachingDataWriteLocked:false});
  await fire.doc('sessions/s1').set(source);await fire.doc('calendar_sessions/s1').set(projection(source));
 });
 await assertSucceeds(edit(env,'lab',{topic:'Eight-group LAB'},{row:source}));
});
