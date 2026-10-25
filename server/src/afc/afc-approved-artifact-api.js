'use strict';

const crypto = require('node:crypto');
const { backendFailure } = require('../http/backend-error');
const { writeDisabled } = require('../data/write-gates');
const { authorizeProfile } = require('./afc-request-api');
const {
  renderApprovedAfcArtifact,
  RENDERER_VERSION,
  TEMPLATE_SHA256_HEX,
} = require('./afc-approved-artifact-renderer');
const { MAX_PDF_BYTES } = require('../data/sql-afc-artifact-repository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const result = (status, body) => ({ status, body });
const error = (status, code, message) => result(status, { error: { code, message } });

const SAFE_ARTIFACT_ERRORS = new Map([
  ['ARTIFACT_NOT_FOUND', [404, 'ARTIFACT_NOT_FOUND', 'The approved AFC artifact is not available.']],
  ['REQUEST_NOT_FOUND', [404, 'REQUEST_NOT_FOUND', 'The approved AFC artifact is not available.']],
  ['ARTIFACT_PROFILE_REQUIRED', [403, 'PROFILE_REQUIRED', 'An active user profile is required.']],
  ['ARTIFACT_SOURCE_CHANGED', [409, 'ARTIFACT_SOURCE_CHANGED', 'The approved AFC request changed; retrieve a fresh request before creating its artifact.']],
  ['ARTIFACT_INPUT_INVALID', [400, 'ARTIFACT_INPUT_INVALID', 'The approved AFC artifact request is invalid.']],
  ['ARTIFACT_TOO_LARGE', [413, 'ARTIFACT_TOO_LARGE', 'The approved AFC PDF exceeds the allowed size.']],
  ['ARTIFACT_INTEGRITY_FAILURE', [500, 'ARTIFACT_INTEGRITY_FAILURE', 'The approved AFC artifact failed an integrity check.']],
  ['ARTIFACT_LOCK_UNAVAILABLE', [503, 'ARTIFACT_BUSY', 'The approved AFC artifact service is temporarily busy.']],
  ['ARTIFACT_SQL_UNAVAILABLE', [503, 'SERVICE_UNAVAILABLE', 'The approved AFC artifact service is temporarily unavailable.']],
  ['ARTIFACT_SOURCE_INVALID', [422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is incomplete or invalid.']],
  ['ARTIFACT_TEMPLATE_MISMATCH', [500, 'ARTIFACT_TEMPLATE_MISMATCH', 'The reviewed AFC PDF template failed integrity verification.']],
  ['ARTIFACT_RENDER_FAILED', [500, 'ARTIFACT_RENDER_FAILED', 'The approved AFC PDF could not be rendered.']],
]);

function mapArtifactFailure(caught) {
  const typedFailure = backendFailure(caught);
  if (typedFailure) return typedFailure;
  const mapped = SAFE_ARTIFACT_ERRORS.get(caught && caught.code);
  return mapped
    ? error(mapped[0], mapped[1], mapped[2])
    : error(503, 'SERVICE_UNAVAILABLE', 'The approved AFC artifact service is temporarily unavailable.');
}

function validRequestId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return UUID.test(id) ? id : null;
}

function isEmptyBody(body) {
  if (body === undefined || body === null || body === '') return true;
  return body instanceof Uint8Array && body.byteLength === 0;
}

function toDigest(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest();
}

function sameDigest(left, right) {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validateRenderedArtifact(rendered, sourceSnapshotSha256) {
  const pdfBytes = rendered && rendered.pdfBytes;
  if (!Buffer.isBuffer(pdfBytes) && !(pdfBytes instanceof Uint8Array)) {
    return { failure: error(500, 'ARTIFACT_RENDER_FAILED', 'The approved AFC PDF could not be rendered.') };
  }

  const byteLength = Number(rendered.byteLength);
  if (pdfBytes.byteLength > MAX_PDF_BYTES || byteLength > MAX_PDF_BYTES) {
    return { failure: error(413, 'ARTIFACT_TOO_LARGE', 'The approved AFC PDF exceeds the allowed size.') };
  }

  const pdfSha256 = toDigest(rendered.pdfSha256);
  const templateSha256 = toDigest(rendered.templateSha256);
  const sourceSha256 = toDigest(sourceSnapshotSha256);
  const rendererVersion = typeof rendered.rendererVersion === 'string' ? rendered.rendererVersion : '';
  if (!Number.isInteger(byteLength)
      || byteLength < 1
      || byteLength !== pdfBytes.byteLength
      || !pdfSha256 || pdfSha256.length !== 32
      || !templateSha256 || templateSha256.length !== 32
      || !sourceSha256 || sourceSha256.length !== 32
      || !sameDigest(digest(pdfBytes), pdfSha256)
      || !sameDigest(templateSha256, Buffer.from(TEMPLATE_SHA256_HEX, 'hex'))
      || rendererVersion !== RENDERER_VERSION) {
    return { failure: error(500, 'ARTIFACT_RENDER_FAILED', 'The approved AFC PDF could not be rendered.') };
  }

  return {
    value: {
      pdfBytes: Buffer.from(pdfBytes),
      pdfSha256,
      byteLength,
      templateSha256,
      sourceSnapshotSha256: sourceSha256,
      rendererVersion,
    },
  };
}

function createAfcApprovedArtifactApi({ verifyToken, findUser, repository, renderer = renderApprovedAfcArtifact, writeGates = {} }) {
  if (typeof verifyToken !== 'function' || typeof findUser !== 'function' || !repository
      || typeof repository.getApprovedArtifact !== 'function'
      || typeof repository.getApprovedArtifactSource !== 'function'
      || typeof repository.createOrGetApprovedArtifact !== 'function'
      || typeof renderer !== 'function') {
    throw new TypeError('The AFC artifact API dependencies are incomplete');
  }

  async function authorize(token) {
    let decoded;
    try {
      decoded = await verifyToken(token);
    } catch {
      return error(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const uid = decoded && typeof decoded.uid === 'string' ? decoded.uid.trim() : '';
    if (!uid || uid.length > 256) return error(401, 'UNAUTHENTICATED', 'Authentication required.');

    let profile;
    try {
      profile = await findUser(uid);
    } catch (caught) {
      return backendFailure(caught) || error(503, 'SERVICE_UNAVAILABLE', 'The profile service is temporarily unavailable.');
    }

    const scope = authorizeProfile(profile);
    if (scope.status) return scope;
    return { uid, profile, scope };
  }

  async function getArtifact(auth, afcRequestId) {
    try {
      const artifact = await repository.getApprovedArtifact({ afcRequestId, actorFirebaseUid: auth.uid });
      return { status: 200, artifact };
    } catch (caught) {
      return mapArtifactFailure(caught);
    }
  }

  return {
    async get(token, requestId) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      const afcRequestId = validRequestId(requestId);
      if (!afcRequestId) return error(400, 'INVALID_REQUEST_ID', 'AFC request id is not a valid identifier.');
      return getArtifact(auth, afcRequestId);
    },

    async create(token, requestId, body) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      const afcRequestId = validRequestId(requestId);
      if (!afcRequestId) return error(400, 'INVALID_REQUEST_ID', 'AFC request id is not a valid identifier.');
      if (writeGates.afcArtifact !== true) return writeDisabled();
      if (!isEmptyBody(body)) return error(400, 'ARTIFACT_BODY_NOT_ALLOWED', 'AFC artifact creation does not accept a request body.');

      const repositoryInput = { afcRequestId, actorFirebaseUid: auth.uid };
      try {
        const existing = await repository.getApprovedArtifact(repositoryInput);
        return { status: 200, artifact: existing };
      } catch (caught) {
        if (!caught || caught.code !== 'ARTIFACT_NOT_FOUND') return mapArtifactFailure(caught);
      }

      let source;
      try {
        source = await repository.getApprovedArtifactSource(repositoryInput);
      } catch (caught) {
        return mapArtifactFailure(caught);
      }

      if (!source || typeof source.sourceSnapshotJson !== 'string' || !source.sourceSnapshotJson) {
        return error(500, 'ARTIFACT_INTEGRITY_FAILURE', 'The approved AFC source failed an integrity check.');
      }

      let rendered;
      try {
        rendered = await renderer(source.sourceSnapshotJson);
      } catch (caught) {
        return mapArtifactFailure(caught);
      }

      const validated = validateRenderedArtifact(rendered, source.sourceSnapshotSha256);
      if (validated.failure) return validated.failure;

      try {
        const artifact = await repository.createOrGetApprovedArtifact({
          afcRequestId,
          actorFirebaseUid: auth.uid,
          ...validated.value,
        });
        return { status: 201, artifact };
      } catch (caught) {
        return mapArtifactFailure(caught);
      }
    },
  };
}

module.exports = {
  createAfcApprovedArtifactApi,
  mapArtifactFailure,
  isEmptyBody,
  validateRenderedArtifact,
  MAX_PDF_BYTES,
};
