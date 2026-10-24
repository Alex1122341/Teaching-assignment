'use strict';

const crypto = require('node:crypto');

const GET_SOURCE_PROCEDURE = 'paws_api.GetApprovedAfcArtifactSource';
const CREATE_OR_GET_PROCEDURE = 'paws_api.CreateOrGetApprovedAfcArtifact';
const GET_ARTIFACT_PROCEDURE = 'paws_api.GetApprovedAfcArtifact';
const MAX_PDF_BYTES = 8_388_608;
const HEX_256 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SQL_ERROR_MAP = new Map([
  [51701, [403, 'ARTIFACT_PROFILE_REQUIRED', 'An active authenticated artifact caller is required.']],
  [51702, [404, 'REQUEST_NOT_FOUND', 'The approved AFC artifact is not available.']],
  [51703, [409, 'ARTIFACT_SOURCE_CHANGED', 'The approved AFC source changed; retrieve a fresh source before creating the artifact.']],
  [51704, [422, 'ARTIFACT_INPUT_INVALID', 'The approved AFC artifact input is invalid.']],
  [51705, [413, 'ARTIFACT_TOO_LARGE', 'The approved AFC PDF exceeds the allowed size.']],
  [51706, [500, 'ARTIFACT_INTEGRITY_FAILURE', 'The approved AFC artifact failed an integrity check.']],
  [51707, [503, 'ARTIFACT_LOCK_UNAVAILABLE', 'The approved AFC artifact is temporarily busy.']],
  [51708, [404, 'ARTIFACT_NOT_FOUND', 'The approved AFC artifact is not available.']],
]);

class AfcArtifactRepositoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AfcArtifactRepositoryError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new AfcArtifactRepositoryError(status, code, message);
}

function requiredText(value, field, maxLength = Infinity) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    fail(400, 'ARTIFACT_INPUT_INVALID', `A valid ${field} is required.`);
  }
  return value.trim();
}

function requiredRequestId(value) {
  const requestId = requiredText(value, 'AFC request identifier', 36);
  if (!UUID.test(requestId)) fail(400, 'ARTIFACT_INPUT_INVALID', 'A valid AFC request identifier is required.');
  return requestId;
}

function binary32(value, field) {
  let bytes;
  if (Buffer.isBuffer(value)) bytes = Buffer.from(value);
  else if (value instanceof Uint8Array) bytes = Buffer.from(value);
  else if (typeof value === 'string' && HEX_256.test(value)) bytes = Buffer.from(value, 'hex');
  else fail(500, 'ARTIFACT_INTEGRITY_FAILURE', `The approved AFC ${field} failed an integrity check.`);
  if (bytes.length !== 32) fail(500, 'ARTIFACT_INTEGRITY_FAILURE', `The approved AFC ${field} failed an integrity check.`);
  return bytes;
}

function binaryValue(value, field) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  fail(500, 'ARTIFACT_INTEGRITY_FAILURE', `The approved AFC ${field} failed an integrity check.`);
}

function equalDigest(actual, expected) {
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest();
}

function sqlErrorNumber(caught) {
  const number = caught && (caught.number ?? caught.originalError?.info?.number ?? caught.originalError?.number);
  const parsed = Number(number);
  return Number.isInteger(parsed) ? parsed : null;
}

function mapSqlError(caught) {
  if (caught instanceof AfcArtifactRepositoryError) return caught;
  const known = SQL_ERROR_MAP.get(sqlErrorNumber(caught));
  if (known) return new AfcArtifactRepositoryError(known[0], known[1], known[2]);
  return new AfcArtifactRepositoryError(503, 'ARTIFACT_SQL_UNAVAILABLE', 'The approved AFC artifact service is temporarily unavailable.');
}

function rowValue(row, pascalName, camelName = pascalName[0].toLowerCase() + pascalName.slice(1)) {
  return row?.[pascalName] ?? row?.[camelName];
}

function mapArtifact(row, requestedId) {
  if (!row) fail(404, 'REQUEST_NOT_FOUND', 'The approved AFC artifact is not available.');

  const afcArtifactId = String(rowValue(row, 'AfcArtifactId') ?? '');
  const afcRequestId = String(rowValue(row, 'AfcRequestId') ?? '');
  const contentType = String(rowValue(row, 'ContentType') ?? '');
  const pdfBytes = binaryValue(rowValue(row, 'PdfBytes'), 'PDF bytes');
  const pdfSha256 = binary32(rowValue(row, 'PdfSha256'), 'PDF hash');
  const sourceSnapshotSha256 = binary32(rowValue(row, 'SourceSnapshotSha256'), 'source hash');
  const templateSha256 = binary32(rowValue(row, 'TemplateSha256'), 'template hash');
  const byteLength = Number(rowValue(row, 'ByteLength'));

  if (!UUID.test(afcArtifactId) || !UUID.test(afcRequestId) || afcRequestId.toLowerCase() !== requestedId.toLowerCase()) {
    fail(500, 'ARTIFACT_INTEGRITY_FAILURE', 'The approved AFC artifact failed an integrity check.');
  }
  if (contentType !== 'application/pdf'
      || !Number.isInteger(byteLength)
      || byteLength < 1
      || byteLength > MAX_PDF_BYTES
      || pdfBytes.length !== byteLength
      || !equalDigest(hash(pdfBytes), pdfSha256)) {
    fail(500, 'ARTIFACT_INTEGRITY_FAILURE', 'The approved AFC artifact failed an integrity check.');
  }

  const rendererVersion = String(rowValue(row, 'RendererVersion') ?? '');
  const createdAtUtc = rowValue(row, 'CreatedAtUtc');
  if (!rendererVersion || rendererVersion.length > 64 || !createdAtUtc) {
    fail(500, 'ARTIFACT_INTEGRITY_FAILURE', 'The approved AFC artifact failed an integrity check.');
  }

  return {
    afcArtifactId,
    afcRequestId,
    contentType,
    pdfBytes,
    pdfSha256,
    byteLength,
    sourceSnapshotSha256,
    templateSha256,
    rendererVersion,
    createdAtUtc,
  };
}

function createSqlAfcArtifactRepository(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('A database query adapter is required');

  async function queryProcedure(sql, params) {
    try {
      const rows = await db.query(sql, params);
      return Array.isArray(rows) ? rows : [];
    } catch (caught) {
      throw mapSqlError(caught);
    }
  }

  return {
    async getApprovedArtifactSource({ afcRequestId, actorFirebaseUid } = {}) {
      const requestId = requiredRequestId(afcRequestId);
      const actorUid = requiredText(actorFirebaseUid, 'authenticated actor UID', 128);
      const rows = await queryProcedure(
        `EXEC ${GET_SOURCE_PROCEDURE}
          @AfcRequestId = @afcRequestId,
          @ActorFirebaseUid = @actorFirebaseUid`,
        { afcRequestId: requestId, actorFirebaseUid: actorUid },
      );
      const row = rows[0];
      if (!row) fail(404, 'REQUEST_NOT_FOUND', 'The approved AFC artifact is not available.');

      const sourceSnapshotJson = rowValue(row, 'SourceSnapshotJson');
      if (typeof sourceSnapshotJson !== 'string' || !sourceSnapshotJson) {
        fail(500, 'ARTIFACT_INTEGRITY_FAILURE', 'The approved AFC source failed an integrity check.');
      }
      const sourceSnapshotSha256 = binary32(rowValue(row, 'SourceSnapshotSha256'), 'source hash');
      const actualHash = hash(Buffer.from(sourceSnapshotJson, 'utf16le'));
      if (!equalDigest(actualHash, sourceSnapshotSha256)) {
        fail(500, 'ARTIFACT_INTEGRITY_FAILURE', 'The approved AFC source failed an integrity check.');
      }
      return { sourceSnapshotJson, sourceSnapshotSha256 };
    },

    async createOrGetApprovedArtifact({
      afcRequestId,
      actorFirebaseUid,
      sourceSnapshotSha256,
      pdfBytes,
      pdfSha256,
      byteLength,
      templateSha256,
      rendererVersion,
    } = {}) {
      const requestId = requiredRequestId(afcRequestId);
      const actorUid = requiredText(actorFirebaseUid, 'authenticated actor UID', 128);
      const sourceHash = binary32(sourceSnapshotSha256, 'source hash');
      const templateHash = binary32(templateSha256, 'template hash');
      const bytes = binaryValue(pdfBytes, 'PDF bytes');
      const pdfHash = binary32(pdfSha256, 'PDF hash');
      const length = Number(byteLength);
      const version = requiredText(rendererVersion, 'renderer version', 64);

      if (!Number.isInteger(length) || length < 1 || length > MAX_PDF_BYTES || bytes.length !== length) {
        fail(413, 'ARTIFACT_TOO_LARGE', 'The approved AFC PDF exceeds the allowed size.');
      }
      if (!equalDigest(hash(bytes), pdfHash)) {
        fail(500, 'ARTIFACT_INTEGRITY_FAILURE', 'The rendered AFC PDF failed an integrity check.');
      }

      const rows = await queryProcedure(
        `EXEC ${CREATE_OR_GET_PROCEDURE}
          @AfcRequestId = @afcRequestId,
          @ActorFirebaseUid = @actorFirebaseUid,
          @SourceSnapshotSha256 = @sourceSnapshotSha256,
          @PdfBytes = @pdfBytes,
          @PdfSha256 = @pdfSha256,
          @ByteLength = @byteLength,
          @TemplateSha256 = @templateSha256,
          @RendererVersion = @rendererVersion`,
        {
          afcRequestId: requestId,
          actorFirebaseUid: actorUid,
          sourceSnapshotSha256: sourceHash,
          pdfBytes: bytes,
          pdfSha256: pdfHash,
          byteLength: length,
          templateSha256: templateHash,
          rendererVersion: version,
        },
      );
      return mapArtifact(rows[0], requestId);
    },

    async getApprovedArtifact({ afcRequestId, actorFirebaseUid } = {}) {
      const requestId = requiredRequestId(afcRequestId);
      const actorUid = requiredText(actorFirebaseUid, 'authenticated actor UID', 128);
      const rows = await queryProcedure(
        `EXEC ${GET_ARTIFACT_PROCEDURE}
          @AfcRequestId = @afcRequestId,
          @ActorFirebaseUid = @actorFirebaseUid`,
        { afcRequestId: requestId, actorFirebaseUid: actorUid },
      );
      return mapArtifact(rows[0], requestId);
    },
  };
}

module.exports = {
  createSqlAfcArtifactRepository,
  AfcArtifactRepositoryError,
  GET_SOURCE_PROCEDURE,
  CREATE_OR_GET_PROCEDURE,
  GET_ARTIFACT_PROCEDURE,
  MAX_PDF_BYTES,
};
