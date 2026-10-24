'use strict';

const { repositoryPath } = require('../../tools/build/frontend-paths');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const root = repositoryPath(__dirname, '..', '..');
const migration = fs.readFileSync(repositoryPath(root, 'database', 'azure-sql', '009_afc_request_foundation.sql'), 'utf8');
const rollback = fs.readFileSync(repositoryPath(root, 'database', 'azure-sql', 'rollback_009_afc_request_foundation.sql'), 'utf8');
const { createAfcRequestApi } = require('../src/afc/afc-request-api');
const { createSqlAfcRequestRepository, SUBMIT_PROCEDURE, WITHDRAW_PROCEDURE } = require('../src/data/sql-afc-request-repository');

const FACULTY_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

function harness({ role = 'faculty', facultyId = FACULTY_ID, uid = 'uid-faculty' } = {}) {
  const calls = [];
  const repository = {
    listRequests: async input => { calls.push(['list', input]); return []; },
    submitRequest: async input => {
      calls.push(['submit', input]);
      return {
        afcRequestId: input.afcRequestId,
        facultyId: FACULTY_ID,
        facultyName: 'Faculty Example',
        requesterFirebaseUid: uid,
        reportToFirebaseUid: 'uid-report',
        status: 'pending_report_to',
        startDate: input.startDate,
        endDate: input.endDate,
        workDays: input.workDays,
        reason: input.reason
      };
    },
    withdrawRequest: async input => {
      calls.push(['withdraw', input]);
      return { afcRequestId: input.afcRequestId, status: 'withdrawn' };
    }
  };
  const api = createAfcRequestApi({
    verifyToken: async () => ({ uid }),
    findUser: async () => ({
      active: true,
      mustChangePassword: false,
      baseRole: role,
      facultyId,
      displayName: 'Faculty Example'
    }),
    repository,
    writeGates: { afcRequest: true },
    idFactory: () => REQUEST_ID
  });
  return { api, calls };
}

const validPayload = () => ({
  startDate: '2026-10-05',
  endDate: '2026-10-06',
  reason: 'vacation',
  purposeDestination: '',
  coverage: 'Covered by colleague',
  contactAddress: '2500 University Drive NW',
  contactPhone: '403-555-1212',
  termsAccepted: true,
  termsVersion: 'ucvm-afc-terms-page2-v1',
  termsSource: 'absence-from-campus-app.pdf#page=2',
  applicantSignature: {
    mode: 'typed',
    name: 'Faculty Example',
    uid: 'uid-faculty',
    signedAt: '2026-10-04T07:00:00.000Z',
    attested: true,
    fingerprint: 'a'.repeat(64),
    imageDataUrl: ''
  }
});

for (const role of ['faculty', 'hicc', 'visc']) {
  test(role + ' can submit one AFC request using server-linked identity', async () => {
    const { api, calls } = harness({ role });
    const response = await api.submit('token', validPayload());
    assert.equal(response.status, 201);
    const input = calls.find(row => row[0] === 'submit')[1];
    assert.equal(input.afcRequestId, REQUEST_ID);
    assert.equal(input.actorFirebaseUid, 'uid-faculty');
    assert.equal(input.facultyId, undefined);
    assert.equal(input.reportToFirebaseUid, undefined);
    assert.equal(input.workDays, 2);
  });
}

test('administrator can list all requests but cannot submit as a synthetic faculty requester', async () => {
  const { api, calls } = harness({ role: 'adfa_general', facultyId: null, uid: 'uid-admin' });
  assert.equal((await api.list('token')).status, 200);
  assert.equal(calls[0][1].administrator, true);
  const submit = await api.submit('token', validPayload());
  assert.equal(submit.status, 403);
  assert.equal(calls.filter(row => row[0] === 'submit').length, 0);
});

test('self-service list is actor-scoped and requires a linked FacultyId', async () => {
  const linked = harness();
  assert.equal((await linked.api.list('token')).status, 200);
  assert.deepEqual(linked.calls[0][1], { actorFirebaseUid: 'uid-faculty', administrator: false });

  const missing = harness({ facultyId: null });
  const response = await missing.api.list('token');
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FACULTY_LINK_REQUIRED');
});

test('submit rejects client identity and invalid workflow evidence before repository access', async () => {
  const { api, calls } = harness();
  const spoofed = await api.submit('token', { ...validPayload(), facultyId: 'spoof', requesterUid: 'spoof', reportToUid: 'spoof' });
  assert.equal(spoofed.status, 400);
  assert.equal(spoofed.body.error.code, 'CLIENT_IDENTITY_FORBIDDEN');

  const unsigned = await api.submit('token', { ...validPayload(), applicantSignature: { attested: false } });
  assert.equal(unsigned.status, 422);
  assert.equal(calls.filter(row => row[0] === 'submit').length, 0);
});

test('business/other requires purpose and bounded contact fields', async () => {
  const { api } = harness();
  const missingPurpose = await api.submit('token', { ...validPayload(), reason: 'business_other', purposeDestination: '' });
  assert.equal(missingPurpose.status, 422);
  const longPhone = await api.submit('token', { ...validPayload(), contactPhone: '1'.repeat(51) });
  assert.equal(longPhone.status, 422);
});

test('requester may withdraw through the server; administrator does not gain requester withdrawal authority', async () => {
  const self = harness();
  const ok = await self.api.withdraw('token', REQUEST_ID);
  assert.equal(ok.status, 200);
  assert.equal(self.calls[0][1].actorFirebaseUid, 'uid-faculty');

  const admin = harness({ role: 'adfa_general', facultyId: null, uid: 'uid-admin' });
  const denied = await admin.api.withdraw('token', REQUEST_ID);
  assert.equal(denied.status, 403);
  assert.equal(admin.calls.length, 0);
});

test('viewer and retired/unknown roles fail closed on the AFC request surface', async () => {
  for (const role of ['viewer', 'other_office', 'unsupported']) {
    const { api, calls } = harness({ role });
    assert.equal((await api.list('token')).status, 403, role + ' list');
    assert.equal((await api.submit('token', validPayload())).status, 403, role + ' submit');
    assert.equal(calls.length, 0, role);
  }
});

test('migration creates request/approval tables and trusted submit/withdraw procedures only', () => {
  for (const token of [
    'CREATE TABLE paws.AfcRequest',
    'CREATE TABLE paws.AfcApproval',
    'CREATE OR ALTER PROCEDURE paws_api.SubmitAfcRequest',
    'CREATE OR ALTER PROCEDURE paws_api.WithdrawAfcRequest',
    'INSERT INTO paws.AuditEvent',
    'afc_request_submitted',
    'afc_request_withdrawn',
    'pending_report_to',
    'pending_admin',
    'approved',
    'rejected',
    'withdrawn'
  ]) assert.ok(migration.includes(token), token);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+paws\.AfcRecord\b/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+paws\.AfcManualRecord\b/i);
  assert.doesNotMatch(migration, /GRANT\s+/i);
  assert.match(rollback, /refus/i);
  assert.match(rollback, /DROP TABLE paws\.AfcApproval/);
  assert.match(rollback, /DROP TABLE paws\.AfcRequest/);
});


test('SQL AFC request repository exposes only scoped list and exact stored-procedure writes', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [];
    }
  };
  const repository = createSqlAfcRequestRepository(db);

  await repository.listRequests({ actorFirebaseUid: 'uid-faculty', administrator: false });
  await repository.submitRequest({
    afcRequestId: REQUEST_ID,
    startDate: '2026-10-05',
    endDate: '2026-10-06',
    workDays: 2,
    reason: 'vacation',
    purposeDestination: null,
    coverage: null,
    contactAddress: '2500 University Drive NW',
    contactPhone: '403-555-1212',
    termsVersion: 'ucvm-afc-terms-page2-v1',
    termsSource: 'absence-from-campus-app.pdf#page=2',
    signatureMode: 'typed',
    signatureName: 'Faculty Example',
    signatureSignedAt: '2026-10-04T07:00:00.000Z',
    signatureFingerprint: 'a'.repeat(64),
    signatureImageDataUrl: null,
    actorFirebaseUid: 'uid-faculty'
  });
  await repository.withdrawRequest({
    afcRequestId: REQUEST_ID,
    actorFirebaseUid: 'uid-faculty',
    auditRequestId: '33333333-3333-4333-8333-333333333333'
  });

  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /FROM paws\.AfcRequest/);
  assert.match(calls[0].sql, /RequesterFirebaseUid = @actorFirebaseUid/);
  assert.match(calls[0].sql, /ReportToFirebaseUid = @actorFirebaseUid/);
  assert.equal(calls[0].params.administrator, 0);

  assert.equal(SUBMIT_PROCEDURE, 'paws_api.SubmitAfcRequest');
  assert.equal(WITHDRAW_PROCEDURE, 'paws_api.WithdrawAfcRequest');
  assert.match(calls[1].sql, /EXEC paws_api\.SubmitAfcRequest/);
  assert.match(calls[2].sql, /EXEC paws_api\.WithdrawAfcRequest/);

  for (const call of calls.slice(1)) {
    assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
  }
});


test('malformed Firebase verifier result fails closed before profile lookup', async () => {
  let profileLookups = 0;
  const api = createAfcRequestApi({
    verifyToken: async () => ({}),
    findUser: async () => { profileLookups++; return { active: true, baseRole: 'administrator' }; },
    repository: { listRequests: async () => [] }
  });
  const response = await api.list('token');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  assert.equal(profileLookups, 0);
});

test('non-null Reports-To Faculty with no active eligible account is not routed around to Admin', () => {
  assert.match(migration, /IF\s+@ReportsToFacultyId\s+IS\s+NOT\s+NULL[\s\S]*?@ReportToMatches\s*=\s*0[\s\S]*?THROW\s+51509/i);
  assert.match(migration, /ReportToFirebaseUid|ReportToAccount/i);
});
