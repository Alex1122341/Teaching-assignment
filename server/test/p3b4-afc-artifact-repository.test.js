'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  createSqlAfcArtifactRepository,
  GET_SOURCE_PROCEDURE,
  CREATE_OR_GET_PROCEDURE,
  GET_ARTIFACT_PROCEDURE,
  AfcArtifactRepositoryError,
} = require('../src/data/sql-afc-artifact-repository');

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_UID = 'firebase-uid-requester';
const TEMPLATE_SHA = Buffer.from('481677829217736B15CB3CBB010F49CB553A8664FE53F8604782093E99896547', 'hex');

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest();
}

function makeArtifactRow(overrides = {}) {
  const pdfBytes = Buffer.from('%PDF-1.7 exact binary\u0000bytes');
  return {
    AfcArtifactId: '33333333-3333-4333-8333-333333333333',
    AfcRequestId: REQUEST_ID,
    ContentType: 'application/pdf',
    PdfBytes: pdfBytes,
    PdfSha256: digest(pdfBytes),
    ByteLength: pdfBytes.length,
    SourceSnapshotSha256: Buffer.alloc(32, 0x31),
    TemplateSha256: TEMPLATE_SHA,
    RendererVersion: '1.0.0',
    CreatedAtUtc: '2026-10-04T12:00:00.000Z',
    CreatedByFirebaseUid: ACTOR_UID,
    ...overrides,
  };
}

test('repository uses only the three approved stored procedures with exact parameter names and values', async () => {
  const calls = [];
  const sourceSnapshotJson = '{"facultyName":"Zoë Faculty","approvals":[]}';
  const sourceSnapshotSha256 = digest(Buffer.from(sourceSnapshotJson, 'utf16le'));
  const artifactRow = makeArtifactRow();
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes(GET_SOURCE_PROCEDURE)) return [{ SourceSnapshotJson: sourceSnapshotJson, SourceSnapshotSha256: sourceSnapshotSha256 }];
      if (sql.includes(CREATE_OR_GET_PROCEDURE) || sql.includes(GET_ARTIFACT_PROCEDURE)) return [artifactRow];
      throw new Error('unexpected SQL');
    },
  };
  const repository = createSqlAfcArtifactRepository(db);

  const source = await repository.getApprovedArtifactSource({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID });
  const artifact = await repository.createOrGetApprovedArtifact({
    afcRequestId: REQUEST_ID,
    actorFirebaseUid: ACTOR_UID,
    sourceSnapshotSha256,
    pdfBytes: artifactRow.PdfBytes,
    pdfSha256: artifactRow.PdfSha256,
    byteLength: artifactRow.ByteLength,
    templateSha256: TEMPLATE_SHA,
    rendererVersion: '1.0.0',
  });
  const stored = await repository.getApprovedArtifact({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID });

  assert.equal(GET_SOURCE_PROCEDURE, 'paws_api.GetApprovedAfcArtifactSource');
  assert.equal(CREATE_OR_GET_PROCEDURE, 'paws_api.CreateOrGetApprovedAfcArtifact');
  assert.equal(GET_ARTIFACT_PROCEDURE, 'paws_api.GetApprovedAfcArtifact');
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /EXEC\s+paws_api\.GetApprovedAfcArtifactSource/i);
  assert.match(calls[0].sql, /@AfcRequestId\s*=\s*@afcRequestId/i);
  assert.match(calls[0].sql, /@ActorFirebaseUid\s*=\s*@actorFirebaseUid/i);
  assert.deepEqual(calls[0].params, { afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID });
  assert.match(calls[1].sql, /EXEC\s+paws_api\.CreateOrGetApprovedAfcArtifact/i);
  assert.match(calls[1].sql, /@SourceSnapshotSha256\s*=\s*@sourceSnapshotSha256/i);
  assert.match(calls[1].sql, /@PdfBytes\s*=\s*@pdfBytes/i);
  assert.match(calls[1].sql, /@PdfSha256\s*=\s*@pdfSha256/i);
  assert.match(calls[1].sql, /@ByteLength\s*=\s*@byteLength/i);
  assert.match(calls[1].sql, /@TemplateSha256\s*=\s*@templateSha256/i);
  assert.deepEqual(calls[1].params, {
    afcRequestId: REQUEST_ID,
    actorFirebaseUid: ACTOR_UID,
    sourceSnapshotSha256,
    pdfBytes: artifactRow.PdfBytes,
    pdfSha256: artifactRow.PdfSha256,
    byteLength: artifactRow.ByteLength,
    templateSha256: TEMPLATE_SHA,
    rendererVersion: '1.0.0',
  });
  assert.match(calls[2].sql, /EXEC\s+paws_api\.GetApprovedAfcArtifact\b/i);
  for (const { sql } of calls) {
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
    assert.doesNotMatch(sql, /FROM\s+paws\.AfcArtifact/i);
  }
  assert.deepEqual(source, { sourceSnapshotJson, sourceSnapshotSha256 });
  assert.deepEqual(artifact.pdfBytes, artifactRow.PdfBytes);
  assert.deepEqual(stored.pdfBytes, artifactRow.PdfBytes);
});

test('source snapshot hash is checked against the exact UTF-16LE SQL NVARCHAR bytes', async () => {
  const sourceSnapshotJson = '{"facultyName":"Zoë Faculty 🐾","approvals":[]}';
  const sourceHash = digest(Buffer.from(sourceSnapshotJson, 'utf16le'));
  assert.equal(sourceHash.toString('hex'), 'ef8758574c4644671cb99d2d107ad53cb618bfccf9ddf436595d329d6cd51f76');
  let called = false;
  const repository = createSqlAfcArtifactRepository({
    async query() {
      called = true;
      return [{ SourceSnapshotJson: sourceSnapshotJson, SourceSnapshotSha256: sourceHash }];
    },
  });
  const result = await repository.getApprovedArtifactSource({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID });
  assert.equal(called, true);
  assert.equal(result.sourceSnapshotJson, sourceSnapshotJson);
  assert.deepEqual(result.sourceSnapshotSha256, sourceHash);
});

test('artifact byte/hash/length mapping is verified before bytes are returned', async () => {
  const row = makeArtifactRow();
  const repository = createSqlAfcArtifactRepository({ async query() { return [row]; } });
  const artifact = await repository.getApprovedArtifact({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID });

  assert.deepEqual(artifact.pdfBytes, row.PdfBytes);
  assert.deepEqual(artifact.pdfSha256, digest(row.PdfBytes));
  assert.equal(artifact.byteLength, row.PdfBytes.length);
  assert.equal(artifact.contentType, 'application/pdf');
  assert.equal(artifact.afcRequestId, REQUEST_ID);
});

test('SQL authorization, not-found, and source-conflict errors map to bounded errors without SQL details', async () => {
  for (const [number, code, status] of [
    [51701, 'ARTIFACT_PROFILE_REQUIRED', 403],
    [51702, 'REQUEST_NOT_FOUND', 404],
    [51703, 'ARTIFACT_SOURCE_CHANGED', 409],
    [51708, 'ARTIFACT_NOT_FOUND', 404],
  ]) {
    const repository = createSqlAfcArtifactRepository({
      async query() {
        const error = new Error('SENSITIVE SQL detail: signature image and source snapshot');
        error.number = number;
        throw error;
      },
    });
    await assert.rejects(
      repository.getApprovedArtifact({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID }),
      error => {
        assert.ok(error instanceof AfcArtifactRepositoryError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        assert.doesNotMatch(error.message, /SENSITIVE|signature|snapshot/i);
        assert.equal('cause' in error, false);
        return true;
      },
    );
  }
});

test('only SQL 51708 identifies an authorized approved request whose artifact is absent', async () => {
  const emptyRepository = createSqlAfcArtifactRepository({ async query() { return []; } });
  await assert.rejects(
    emptyRepository.getApprovedArtifact({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID }),
    error => error.code === 'REQUEST_NOT_FOUND' && error.status === 404,
  );
  await assert.rejects(
    emptyRepository.getApprovedArtifactSource({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID }),
    error => error.code === 'REQUEST_NOT_FOUND' && error.status === 404,
  );
});

test('corrupt source hashes and stored PDF bytes fail closed without exposing the sensitive payload', async () => {
  const sourceSnapshotJson = '{"signature":"private"}';
  const wrongHash = Buffer.alloc(32, 0x66);
  let mode = 'source';
  const row = makeArtifactRow({ PdfSha256: Buffer.alloc(32, 0x55) });
  const repository = createSqlAfcArtifactRepository({
    async query() {
      return mode === 'source'
        ? [{ SourceSnapshotJson: sourceSnapshotJson, SourceSnapshotSha256: wrongHash }]
        : [row];
    },
  });

  for (const operation of [
    () => repository.getApprovedArtifactSource({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID }),
    () => { mode = 'artifact'; return repository.getApprovedArtifact({ afcRequestId: REQUEST_ID, actorFirebaseUid: ACTOR_UID }); },
  ]) {
    await assert.rejects(operation(), error => {
      assert.equal(error.code, 'ARTIFACT_INTEGRITY_FAILURE');
      assert.doesNotMatch(error.message, /private|signature|PDF|bytes/i);
      assert.equal('sourceSnapshotJson' in error, false);
      assert.equal('pdfBytes' in error, false);
      return true;
    });
  }
});
