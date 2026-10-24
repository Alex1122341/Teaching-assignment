'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(root, 'database', 'azure-sql', '010_afc_approval_foundation.sql');
const rollbackPath = path.join(root, 'database', 'azure-sql', 'rollback_010_afc_approval_foundation.sql');

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';

function signature(uid = 'uid-report') {
  return {
    mode: 'typed',
    name: 'Approver Example',
    uid,
    signedAt: '2026-10-04T13:00:00.000Z',
    attested: true,
    fingerprint: 'b'.repeat(64),
    imageDataUrl: ''
  };
}

function loadApi() {
  delete require.cache[require.resolve('../src/afc/afc-approval-api')];
  return require('../src/afc/afc-approval-api');
}

function build({
  role = 'faculty',
  uid = 'uid-report',
  facultyId = '11111111-1111-4111-8111-111111111111'
} = {}) {
  const calls = [];
  const repository = {
    listRequests: async () => [],
    submitRequest: async () => ({}),
    withdrawRequest: async () => ({}),
    recommendRequest: async input => {
      calls.push(['recommend', input]);
      return { afcRequestId: input.afcRequestId, status: 'pending_admin' };
    },
    rejectRequest: async input => {
      calls.push(['reject', input]);
      return { afcRequestId: input.afcRequestId, status: 'rejected', rejectionReason: input.rejectionReason };
    },
    approveRequest: async input => {
      calls.push(['approve', input]);
      return { afcRequestId: input.afcRequestId, status: 'approved', approvedAtUtc: '2026-10-04T13:01:00.000Z' };
    }
  };
  const { createAfcApprovalApi } = loadApi();
  return {
    calls,
    api: createAfcApprovalApi({
      verifyToken: async () => ({ uid }),
      findUser: async () => ({
        active: true,
        mustChangePassword: false,
        baseRole: role,
        facultyId,
        displayName: 'Approver Example'
      }),
    repository,
    writeGates: { afcDecision: true },
      idFactory: () => DECISION_ID
    })
  };
}

test('Reports-To-capable self-service actor may submit recommend/reject decisions for SQL scope enforcement', async () => {
  const { api, calls } = build();
  const recommended = await api.recommend('token', REQUEST_ID, { signature: signature() });
  assert.equal(recommended.status, 200);
  assert.equal(calls[0][0], 'recommend');
  assert.equal(calls[0][1].actorFirebaseUid, 'uid-report');
  assert.equal(calls[0][1].approvalId, DECISION_ID);

  const rejected = await api.reject('token', REQUEST_ID, {
    signature: signature(),
    rejectionReason: 'Coverage cannot be supported.'
  });
  assert.equal(rejected.status, 200);
  assert.equal(calls[1][0], 'reject');
  assert.equal(calls[1][1].rejectionReason, 'Coverage cannot be supported.');
});

test('administrator may recommend on behalf and may approve/reject, while faculty cannot approve', async () => {
  const admin = build({ role: 'adfa_general', uid: 'uid-admin', facultyId: null });
  assert.equal((await admin.api.recommend('token', REQUEST_ID, { signature: signature('uid-admin') })).status, 200);
  assert.equal((await admin.api.approve('token', REQUEST_ID, { signature: signature('uid-admin') })).status, 200);
  assert.equal((await admin.api.reject('token', REQUEST_ID, {
    signature: signature('uid-admin'),
    rejectionReason: 'Administrative rejection.'
  })).status, 200);

  const faculty = build({ role: 'faculty', uid: 'uid-faculty' });
  const denied = await faculty.api.approve('token', REQUEST_ID, { signature: signature('uid-faculty') });
  assert.equal(denied.status, 403);
  assert.equal(faculty.calls.length, 0);
});

test('decision payload is strict, signed by the authenticated uid, and rejection requires a reason', async () => {
  const { api, calls } = build();

  assert.equal((await api.recommend('token', REQUEST_ID, {
    signature: signature(),
    status: 'approved'
  })).status, 400);

  assert.equal((await api.recommend('token', REQUEST_ID, {
    signature: signature('somebody-else')
  })).status, 422);

  assert.equal((await api.reject('token', REQUEST_ID, {
    signature: signature(),
    rejectionReason: ''
  })).status, 422);

  assert.equal((await api.reject('token', REQUEST_ID, {
    signature: signature(),
    rejectionReason: 'x'.repeat(1001)
  })).status, 422);

  assert.equal(calls.length, 0);
});

test('malformed request ids and denied roles fail before decision repository access', async () => {
  const normal = build();
  assert.equal((await normal.api.recommend('token', 'not-a-uuid', { signature: signature() })).status, 400);
  assert.equal(normal.calls.length, 0);

  const viewer = build({ role: 'viewer' });
  assert.equal((await viewer.api.reject('token', REQUEST_ID, {
    signature: signature(),
    rejectionReason: 'No.'
  })).status, 403);
  assert.equal(viewer.calls.length, 0);
});

test('P3B2 migration encodes exact approval transitions and request-backed availability', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');

  for (const token of [
    'CREATE OR ALTER PROCEDURE paws_api.RecommendAfcRequest',
    'CREATE OR ALTER PROCEDURE paws_api.RejectAfcRequest',
    'CREATE OR ALTER PROCEDURE paws_api.ApproveAfcRequest',
    "N'pending_report_to'",
    "N'pending_admin'",
    "N'approved'",
    "N'rejected'",
    "N'afc_request_recommended'",
    "N'afc_request_rejected'",
    "N'afc_request_approved'",
    "IF @ActorRole IS NULL OR @ActorRole NOT IN (",
    "CAST(N'request' AS nvarchar(16)) AS SourceKind",
    "WHERE ar.Status = N'approved'"
  ]) assert.ok(migration.includes(token), token);

  assert.doesNotMatch(migration, /INSERT\s+INTO\s+paws\.AfcManualRecord\b/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+paws\.AfcRecord\b/i);
  assert.doesNotMatch(migration, /\bGRANT\s+/i);
});

test('P3B2 rollback refuses decision data and restores the pre-P3B2 AFC unified view', () => {
  const rollback = fs.readFileSync(rollbackPath, 'utf8');
  assert.match(rollback, /refus/i);
  assert.match(rollback, /paws\.AfcApproval/);
  assert.match(rollback, /Status IN \(N'approved', N'rejected'\)/);
  assert.match(rollback, /DROP PROCEDURE paws_api\.RecommendAfcRequest/);
  assert.match(rollback, /DROP PROCEDURE paws_api\.RejectAfcRequest/);
  assert.match(rollback, /DROP PROCEDURE paws_api\.ApproveAfcRequest/);
  assert.doesNotMatch(rollback, /CAST\(N'request' AS nvarchar\(16\)\) AS SourceKind/);
});
