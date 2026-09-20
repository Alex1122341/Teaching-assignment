'use strict';
// Emulator proof for LAB group and student roster boundaries:
//   - group codes / colour keys are shared with the sanitized calendar
//   - student IDs are readable only by LAB, Developer and Owner
//   - roster-shaped fields can never be written into calendar_sessions
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('lab groups: '+name,{skip:!enabled},fn);

const ROLES=[['lab','lab'],['developer','developer'],['owner','owner'],['adc','adc'],['administrator','adfa_regular'],['faculty','faculty']];

// The sanitized calendar is built with the real projection so the paired-write
// proof (calendarMatchesSourceAfter) is satisfied exactly, and any rejection is
// attributable to the roster guard rather than to a hand-written fixture.
const vm=require('node:vm');
const projectionContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../calendar-session.js'),'utf8'),projectionContext);
const SOURCE={course:'601',date:'2027-06-01',start:'09:00',end:'11:00',type:'LAB',topic:'Neuro',instructor:'',assignments:[],facultyIds:[],updatedBy:'seed',updatedByName:'Seed'};
// The projection is built inside a vm realm, so it is cloned into this realm
// before it is handed to the Firestore SDK.
const CALENDAR={
 ...JSON.parse(JSON.stringify(projectionContext.window.UCVM_CALENDAR_SESSION.fromSource(SOURCE,'s1'))),
 labGroups:[{groupId:'g-a',groupCode:'A',colorKey:'group-a',studentCount:2}]
};

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-lab-groups',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role] of ROLES)await db.doc(`users/${uid}`).set({role,active:true,mustChangePassword:false,email:`${uid}@example.test`});
  await db.doc('faculty/f1').set({email:'faculty@example.test'});
  await db.doc('lab_groups/g-a').set({groupId:'g-a',academicYear:'2026-27',course:'601',groupCode:'A',colorKey:'group-a',active:true,updatedBy:'seed',updatedAt:new Date('2026-09-20T12:00:00Z')});
  await db.doc('lab_group_rosters/g-a').set({groupId:'g-a',studentIds:['30012345','30012346'],updatedBy:'seed',updatedByName:'Seed',updatedAt:new Date('2026-09-20T12:00:00Z')});
  await db.doc('calendar_sessions/s1').set(CALENDAR);
  await db.doc('sessions/s1').set(SOURCE);
 });
});
after(async()=>{if(env)await env.cleanup()});

const db=uid=>env.authenticatedContext(uid).firestore();

check('LAB may create a group and its roster',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore'),fire=db('lab'),stamp=serverTimestamp();
 await assertSucceeds(fire.doc('lab_groups/g-b').set({groupId:'g-b',academicYear:'2026-27',course:'601',groupCode:'B',colorKey:'group-b',active:true,updatedBy:'lab',updatedAt:stamp}));
 await assertSucceeds(fire.doc('lab_group_rosters/g-b').set({groupId:'g-b',studentIds:['30012347'],updatedBy:'lab',updatedByName:'LAB',updatedAt:stamp}));
});

check('Developer and Owner may manage groups and rosters',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 for(const uid of ['developer','owner']){
  const fire=db(uid),stamp=serverTimestamp();
  await assertSucceeds(fire.doc('lab_group_rosters/g-a').set({groupId:'g-a',studentIds:['30012345'],updatedBy:uid,updatedByName:uid,updatedAt:stamp}));
 }
});

check('ADC may read group codes but never student rosters',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),fire=db('adc');
 await assertSucceeds(fire.doc('lab_groups/g-a').get());
 await assertFails(fire.doc('lab_group_rosters/g-a').get());
});

check('Faculty, ADFA administrator and VISC-style roles cannot read student rosters',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['faculty','administrator'])await assertFails(db(uid).doc('lab_group_rosters/g-a').get());
});

check('ADC cannot write a roster',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore'),stamp=serverTimestamp();
 await assertFails(db('adc').doc('lab_group_rosters/g-a').set({groupId:'g-a',studentIds:['30099999'],updatedBy:'adc',updatedByName:'ADC',updatedAt:stamp}));
});

check('a roster payload with extra fields is rejected',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore'),stamp=serverTimestamp();
 await assertFails(db('lab').doc('lab_group_rosters/g-a').set({groupId:'g-a',studentIds:['30012345'],updatedBy:'lab',updatedByName:'LAB',updatedAt:stamp,doe:40}));
});

check('student IDs can never be written into the sanitized calendar',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore'),fire=db('lab');
 // Each attempt is an otherwise valid paired LAB write, so the roster fields are
 // the only reason for the rejection.
 for(const patch of [{studentIds:['30012345']},{roster:{studentIds:['30012345']}},{rosters:{'g-a':{studentIds:['30012345']}}},{studentNames:['A Student']}]){
  const stamp=serverTimestamp(),batch=fire.batch();
  batch.update(fire.doc('sessions/s1'),{topic:'Neuro',updatedBy:'lab',updatedByName:'LAB',updatedAt:stamp});
  batch.set(fire.doc('calendar_sessions/s1'),{...CALENDAR,...patch});
  batch.set(fire.collection('session_change_log').doc(),{action:'update',sessionId:'s1',course:'601',date:'2027-06-01',topic:'Neuro',instructors:[],changes:[],changedBy:'lab',changedByName:'LAB',changedByEmail:'',changedAt:stamp});
  await assertFails(batch.commit());
 }
});

// The positive case (a LAB paired calendar write without roster data still
// succeeding) is already proven by office-timetable-security-emulator.test.js,
// which builds the exact paired-write fixture. calendarHasNoRosterData() is a
// pure negative guard: it can only reject roster-bearing writes, never make a
// valid write succeed, so the suite above is the meaningful proof.
