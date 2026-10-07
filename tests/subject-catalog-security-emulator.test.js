'use strict';
const {test, before, after} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {assertSucceeds, assertFails, initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {serverTimestamp} = require('firebase/firestore');

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const check = (name, fn) => test('Teaching Subject security: ' + name, {skip: !enabled}, fn);
let env;
const session = {course: 'VTMD 506', courseName: '', year: 2, semester: 'fall', week: 2,
  date: '2027-09-08', start: '09:00', end: '10:00', timeUnknown: false, type: 'LEC',
  topic: 'Pre-operative Management', room: 'A100', instructor: '', assignments: [], facultyIds: []};
const calendar = {sessionId: 's1', course: session.course, courseName: '', year: 2,
  semester: 'fall', week: 2, date: session.date, start: session.start, end: session.end,
  timeUnknown: false, type: session.type, topic: session.topic, room: session.room,
  instructor: '', instructorNames: []};
const db = uid => env.authenticatedContext(uid).firestore();

before(async () => {
  if (!enabled) return;
  env = await initializeTestEnvironment({projectId: 'demo-ucvm-teaching-subjects',
    firestore: {rules: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8')}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const fire = context.firestore();
    for (const [uid, role] of [['developer','developer'], ['owner','owner'],
      ['administrator','administrator'], ['adc','adc'], ['lab','lab'], ['hicc','hicc'],
      ['visc','visc'], ['faculty','faculty'], ['inactive','faculty'], ['password','adc']]) {
      await fire.doc(`users/${uid}`).set({role, active: uid !== 'inactive',
        mustChangePassword: uid === 'password', email: uid + '@example.test'});
    }
    await fire.doc('teaching_subjects/surgery').set({key: 'surgery', label: 'Surgery', active: true,
      updatedBy: 'owner', updatedAt: new Date('2026-09-22T00:00:00Z')});
    await fire.doc('teaching_subjects/inactive').set({key: 'inactive', label: 'Inactive', active: false,
      updatedBy: 'owner', updatedAt: new Date('2026-09-22T00:00:00Z')});
    await fire.doc('sessions/s1').set(session);
    await fire.doc('calendar_sessions/s1').set(calendar);
    await fire.doc('settings/system_state').set({teachingDataWriteLocked: false});
  });
});
after(async () => { if (env) await env.cleanup(); });

check('ready users may read but inactive, password-required, and anonymous users may not', async () => {
  for (const uid of ['developer','owner','administrator','adc','lab','hicc','visc','faculty']) {
    await assertSucceeds(db(uid).doc('teaching_subjects/surgery').get());
  }
  for (const uid of ['inactive','password']) await assertFails(db(uid).doc('teaching_subjects/surgery').get());
  await assertFails(env.unauthenticatedContext().firestore().doc('teaching_subjects/surgery').get());
});

check('only existing administrators may create, update, and delete catalog records', async () => {
  for (const uid of ['developer','owner','administrator']) {
    const ref = db(uid).doc(`teaching_subjects/${uid}`);
    await assertSucceeds(ref.set({key: uid, label: uid, active: true, updatedBy: uid, updatedAt: serverTimestamp()}));
    await assertSucceeds(ref.update({label: 'Updated', active: false, updatedBy: uid, updatedAt: serverTimestamp()}));
    await assertSucceeds(ref.delete());
  }
  for (const uid of ['adc','lab','hicc','visc','faculty']) {
    await assertFails(db(uid).doc(`teaching_subjects/${uid}`).set({key: uid, label: uid,
      active: true, updatedBy: uid, updatedAt: serverTimestamp()}));
    await assertFails(db(uid).doc('teaching_subjects/surgery').update({label: 'Changed'}));
  }
});

check('catalog writes fail closed on mismatched IDs and malformed metadata', async () => {
  const fire = db('owner');
  for (const record of [
    {key: 'anesthesia', label: 'Surgery', active: true},
    {key: 'surgery', label: '', active: true},
    {key: 'surgery', label: 'Surgery', active: 'true'},
    {key: 'surgery', label: 'Surgery', active: true, doeRate: 25}
  ]) await assertFails(fire.doc('teaching_subjects/surgery').set({
    ...record, updatedBy: 'owner', updatedAt: serverTimestamp()}));
  await assertFails(fire.doc('teaching_subjects/surgery').update({label: 'Wrong actor', updatedBy: 'adc', updatedAt: serverTimestamp()}));
});

check('ADC may classify with an active Subject only when source and calendar agree', async () => {
  const fire = db('adc');
  const batch = fire.batch();
  batch.update(fire.doc('sessions/s1'), {subjectKey: 'surgery', updatedBy: 'adc',
    updatedByName: 'ADC', updatedAt: serverTimestamp()});
  batch.set(fire.doc('calendar_sessions/s1'), {...calendar, subjectKey: 'surgery'});
  await assertSucceeds(batch.commit());
  const stored = await fire.doc('calendar_sessions/s1').get();
  if (stored.data().subjectKey !== 'surgery') throw Error('Subject was not projected.');
  for (const key of ['inactive', 'invented']) {
    const denied = fire.batch();
    denied.update(fire.doc('sessions/s1'), {subjectKey: key, updatedBy: 'adc',
      updatedByName: 'ADC', updatedAt: serverTimestamp()});
    denied.set(fire.doc('calendar_sessions/s1'), {...calendar, subjectKey: key});
    await assertFails(denied.commit());
  }
});

check('LAB and HICC cannot change Subject through Topic authority', async () => {
  for (const uid of ['lab','hicc','visc']) {
    const fire = db(uid), batch = fire.batch();
    batch.update(fire.doc('sessions/s1'), {subjectKey: 'inactive', topic: 'Changed',
      updatedBy: uid, updatedByName: uid, updatedAt: serverTimestamp()});
    batch.set(fire.doc('calendar_sessions/s1'), {...calendar, subjectKey: 'inactive', topic: 'Changed'});
    await assertFails(batch.commit());
  }
});
