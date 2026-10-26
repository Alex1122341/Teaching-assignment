'use strict';
// Locks in the Faculty access boundary at the security-rules layer.
//
// The rules allow an administrator to read and write Faculty records, allow a
// Faculty account to read its own record (self-service needs it), refuse every
// other Faculty account, and refuse deletion outright — employment ends by
// deactivation so that teaching assignments, roles, AFC records and audit history
// keep resolving.
//
// Runs against the Firestore Emulator. Without FIRESTORE_EMULATOR_HOST these
// cases are skipped rather than silently passing.
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
let env;
const check = (name, fn) => test('faculty access: ' + name, { skip: !enabled }, fn);

before(async () => {
  if (!enabled) return;
  const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
  env = await initializeTestEnvironment({
    projectId: 'demo-paws-faculty-access',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../firebase/firestore.rules'), 'utf8') }
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.doc('settings/app').set({ writeGates: { facultyAdmin: true }, teachingWritesOpen: true });
    await db.doc('users/admin').set({ role: 'adfa_regular', active: true, mustChangePassword: false, email: 'admin@example.test' });
    await db.doc('users/self').set({ role: 'faculty', active: true, mustChangePassword: false, email: 'self@example.test', facultyId: 'f1' });
    await db.doc('users/other').set({ role: 'faculty', active: true, mustChangePassword: false, email: 'other@example.test', facultyId: 'f2' });
    await db.doc('faculty/f1').set({ firstName: 'Morgan', lastName: 'Chen', email: 'self@example.test', active: true, doe: 40, updatedBy: 'admin' });
    await db.doc('faculty/f2').set({ firstName: 'Ada', lastName: 'Okafor', email: 'other@example.test', active: true, doe: 20, updatedBy: 'admin' });
  });
});

after(async () => { if (env) await env.cleanup(); });

check('an administrator may read any Faculty record', async () => {
  const db = env.authenticatedContext('admin').firestore();
  const snap = await db.doc('faculty/f1').get();
  if (!snap.exists) throw Error('the administrator should have read the record');
});

check('a Faculty account may read its own record', async () => {
  // Self-service genuinely needs this read; denying it would break the feature
  // rather than protect it.
  const db = env.authenticatedContext('self').firestore();
  const snap = await db.doc('faculty/f1').get();
  if (!snap.exists) throw Error('a Faculty account should read its own record');
});

check('a Faculty account cannot read another Faculty record', async () => {
  const db = env.authenticatedContext('self').firestore();
  await db.doc('faculty/f2').get().then(
    () => { throw Error('reading another Faculty record must be denied'); },
    () => {}
  );
});

check('a Faculty account cannot list the Faculty collection', async () => {
  const db = env.authenticatedContext('self').firestore();
  await db.collection('faculty').get().then(
    () => { throw Error('listing Faculty must be denied'); },
    () => {}
  );
});

check('an anonymous caller cannot read any Faculty record', async () => {
  const db = env.unauthenticatedContext().firestore();
  await db.doc('faculty/f1').get().then(
    () => { throw Error('anonymous reads must be denied'); },
    () => {}
  );
});

check('nobody may delete a Faculty record, not even an administrator', async () => {
  // Deactivation keeps historical references resolvable; deletion would orphan
  // teaching assignments, roles, AFC records and audit history.
  const db = env.authenticatedContext('admin').firestore();
  await db.doc('faculty/f2').delete().then(
    () => { throw Error('deleting a Faculty record must be denied'); },
    () => {}
  );
  const still = await env.withSecurityRulesDisabled(async ctx => (await ctx.firestore().doc('faculty/f2').get()).exists);
  if (!still) throw Error('the record must survive the refused delete');
});
