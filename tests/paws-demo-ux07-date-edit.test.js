'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../tools/pages-demo-api/store.js');
const { createAfcRequestRepository, createAfcApprovalRepository, requests } = require('../tools/pages-demo-api/repos/afc.js');
const { createAfcWriteRepository } = require('../tools/pages-demo-api/repos/admin-write.js');
const { versionOf, requireCoverage } = require('../tools/pages-demo-api/repos/afc-date-change.js');
const { createAfcRequestApi } = require('../server/src/afc/afc-request-api.js');
const { isAdministratorRole } = require('../server/src/auth/role-policy.js');
const { uuidFor } = require('../tools/pages-demo-api/ids.js');

const range = { startDate: '2026-11-23', endDate: '2026-11-24', workDays: 2, reason: 'vacation', coverage: 'Teaching coverage confirmed' };
function fixture() {
  const store = createStore({ now: () => new Date('2026-10-29T18:00:00.000Z') });
  const req = createAfcRequestRepository(store);
  const approval = createAfcApprovalRepository(store);
  const manual = createAfcWriteRepository(store);
  const original = requests(store).find(x => x.status === 'approved');
  assert.ok(original);
  const admin = store.tables.users.find(x => x.active === true && isAdministratorRole(x.baseRole));
  assert.ok(admin);
  return { store, req, approval, manual, original, admin };
}
function changeInput(f, extras={}) {
  return { ...range, afcRequestId: uuidFor('demo-ux07-change'),
    replacesAfcRequestId: f.original.afcRequestId, expectedVersion: versionOf(f.original),
    actorFirebaseUid: f.original.requesterFirebaseUid, ...extras };
}

test('Demo AFC request dates: linked change preserves original until approval, then supersedes atomically', async () => {
  const f = fixture();
  const oldDates = [f.original.startDate, f.original.endDate];
  const pending = await f.req.submitDateChange(changeInput(f));
  assert.equal(f.original.status, 'approved');
  assert.deepEqual([f.original.startDate, f.original.endDate], oldDates);
  assert.equal(pending.replacesAfcRequestId, f.original.afcRequestId);
  assert.equal(pending.status.startsWith('pending_'), true);
  assert.match(pending.versionToken, /^[0-9A-F]{16}$/);
  const persisted = requests(f.store).find(x => x.afcRequestId === pending.afcRequestId);
  if (persisted.status === 'pending_report_to') {
    assert.ok(persisted.reportToFirebaseUid);
    await f.approval.recommendRequest({ afcRequestId: persisted.afcRequestId, actorFirebaseUid: persisted.reportToFirebaseUid });
  }
  await f.approval.approveRequest({ afcRequestId: persisted.afcRequestId, actorFirebaseUid: f.admin.firebaseUid });
  assert.equal(f.original.status, 'superseded');
  assert.equal(f.original.supersededByAfcRequestId, persisted.afcRequestId);
  assert.equal(persisted.status, 'approved');
  assert.deepEqual([persisted.startDate, persisted.endDate], [range.startDate, range.endDate]);
  const originals = f.store.tables.afcRecords.filter(r => r.afcRequestId === f.original.afcRequestId);
  const replacements = f.store.tables.afcRecords.filter(r => r.afcRequestId === persisted.afcRequestId);
  assert.equal(originals.length, 1);
  assert.equal(replacements.length, 1);
  assert.equal(originals[0].active, false);
  assert.equal(replacements[0].active, true);
  assert.ok(f.store.tables.history.some(x => x.changeType === 'afc_dates_changed'));
});

test('Demo AFC Faculty date change: unauthorized, stale and duplicate submissions are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.req.submitDateChange(changeInput(f, { actorFirebaseUid: 'uid-another' })), e => e.number === 51510);
  await assert.rejects(f.req.submitDateChange(changeInput(f, { expectedVersion: '000000000000FFFF' })), e => e.number === 56404);
  await assert.rejects(f.req.submitDateChange(changeInput(f, { startDate: f.original.startDate, endDate: f.original.endDate })), e => e.number === 51512);
  const first = await f.req.submitDateChange(changeInput(f));
  assert.ok(first.afcRequestId);
  await assert.rejects(f.req.submitDateChange(changeInput(f, { afcRequestId: uuidFor('different-change') })), e => e.number === 51511);
  assert.equal(f.original.status, 'approved');
});

test('Demo AFC approved request: office date edit increments version and produces before/after history', async () => {
  const f = fixture();
  const before = f.original.startDate;
  const priorVersion = versionOf(f.original);
  const result = await f.req.updateApprovedRequestDates({
    afcRequestId: f.original.afcRequestId, expectedVersion: priorVersion,
    startDate: '2026-07-16', endDate: '2026-07-17', actorFirebaseUid: f.admin.firebaseUid
  });
  assert.equal(result.startDate, '2026-07-16');
  assert.notEqual(result.versionToken, priorVersion);
  assert.equal(f.original.startDate, '2026-07-16');
  assert.equal(f.original.status, 'approved');
  const audit = f.store.tables.history.find(x => x.changeType === 'afc_dates_changed');
  assert.equal(audit.before.startDate, before);
  assert.equal(audit.after.startDate, '2026-07-16');
  await assert.rejects(f.req.updateApprovedRequestDates({
    afcRequestId: f.original.afcRequestId, expectedVersion: priorVersion,
    startDate: '2026-07-20', endDate: '2026-07-21', actorFirebaseUid: f.admin.firebaseUid
  }), e => e.number === 56404);
});

test('Demo AFC manual record date edit: old row remains audit-visible and unauthorized edits fail', async () => {
  const f = fixture();
  const row = f.store.tables.afcRecords.find(x => x.active === true);
  const snapshot = JSON.parse(JSON.stringify(row));
  await assert.rejects(f.manual.updateAfcDates({
    afcRecordId: row.afcRecordId, sourceKind: row.sourceKind, expectedVersion: row.versionToken,
    startDate: '2026-11-23', endDate: '2026-11-24', actorFirebaseUid: f.original.requesterFirebaseUid
  }), e => e.number === 56402);
  const changed = await f.manual.updateAfcDates({
    afcRecordId: row.afcRecordId, sourceKind: row.sourceKind, expectedVersion: row.versionToken,
    startDate: '2026-11-23', endDate: '2026-11-24', actorFirebaseUid: f.admin.firebaseUid
  });
  assert.equal(changed.startDate, '2026-11-23');
  assert.notEqual(row.versionToken, snapshot.versionToken);
  assert.equal(f.store.tables.history.find(x => x.changeType === 'afc_dates_changed').before.startDate, snapshot.startDate);
  await assert.rejects(f.manual.updateAfcDates({
    afcRecordId: row.afcRecordId, sourceKind: row.sourceKind, expectedVersion: snapshot.versionToken,
    startDate: '2026-11-25', endDate: '2026-11-26', actorFirebaseUid: f.admin.firebaseUid
  }), e => e.number === 56404);
});

test('Demo AFC date changes reject absent coverage when new dates collide with assigned teaching', () => {
  const f = fixture();
  const session = f.store.tables.sessions.find(x => x.assignments?.some(a => a.facultyId));
  assert.ok(session);
  const facultyId = session.assignments.find(a => a.facultyId).facultyId;
  assert.throws(() => requireCoverage(f.store, facultyId, session.date, session.date, ''),
    e => e.number === 51505);
  assert.ok(requireCoverage(f.store, facultyId, session.date, session.date, 'Session reassigned').length > 0);
});

test('AFC requester API requires a version for date changes, never accepting unversioned writes', async () => {
  const f = fixture();
  const api = createAfcRequestApi({
    verifyToken: async token => ({ uid: token }),
    findUser: async uid => f.store.tables.users.find(x => x.firebaseUid === uid) || null,
    repository: f.req,
    idFactory: () => uuidFor('api-date-change'),
    writeGates: { afcRequest: true, afcEdit: true }
  });
  const payload = {
    startDate: range.startDate, endDate: range.endDate, reason: range.reason, coverage: range.coverage,
    termsAccepted: true, termsVersion: 'ucvm-afc-terms-page2-v1',
    termsSource: 'absence-from-campus-app.pdf#page=2',
    contactAddress: '123 Example Road', contactPhone: '403-555-0155',
    applicantSignature: { mode: 'typed', name: 'Synthetic Faculty', uid: f.original.requesterFirebaseUid,
      signedAt: '2026-10-29T17:30:00.000Z', fingerprint: 'a'.repeat(64), attested: true }
  };
  const noVersion = await api.changeDates(f.original.requesterFirebaseUid, f.original.afcRequestId, payload);
  assert.equal(noVersion.status, 400);
  assert.equal(noVersion.body.error.code, 'INVALID_REQUEST_VERSION');
  const staleVersion = await api.changeDates(f.original.requesterFirebaseUid, f.original.afcRequestId, { ...payload, expectedVersion: '000000000000FFFF' });
  assert.equal(staleVersion.status, 409);
  assert.equal(staleVersion.body.error.code, 'REQUEST_CHANGED');
});
