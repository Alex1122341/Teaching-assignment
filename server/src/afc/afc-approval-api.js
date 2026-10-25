'use strict';

const { randomUUID } = require('node:crypto');
const {
  authorizeProfile,
  validateSignature,
  ADMIN_ROLES
} = require('./afc-request-api');
const { writeDisabled } = require('../data/write-gates');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const result = (status, body) => ({ status, body });
const error = (status, code, message) => result(status, { error: { code, message } });
const text = value => value === null || value === undefined ? '' : String(value).trim();

function validateDecisionPayload(payload, actorUid, { rejection = false } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return error(400, 'INVALID_JSON', 'AFC decision JSON must be an object.');
  }

  const allowed = rejection
    ? new Set(['signature', 'rejectionReason'])
    : new Set(['signature']);

  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      return error(400, 'DECISION_FIELDS_FORBIDDEN', 'AFC decision contains unsupported fields.');
    }
  }

  const signature = validateSignature(payload.signature, actorUid);
  if (signature.status) return signature;

  let rejectionReason = null;
  if (rejection) {
    rejectionReason = text(payload.rejectionReason);
    if (!rejectionReason || rejectionReason.length > 1000) {
      return error(422, 'REJECTION_REASON_REQUIRED', 'A rejection reason of 1000 characters or fewer is required.');
    }
  }

  return { signature, rejectionReason };
}

function mapApprovalError(caught) {
  const number = Number(caught && caught.number);
  const known = {
    51601: [403, 'DECISION_ACTOR_REQUIRED', 'An active decision actor is required.'],
    51602: [404, 'REQUEST_NOT_FOUND', 'AFC request was not found.'],
    51603: [409, 'INVALID_STATE', 'This AFC request cannot make that transition.'],
    51604: [403, 'ROLE_DENIED', 'This actor cannot make this AFC decision.'],
    51605: [422, 'INVALID_SIGNATURE', 'Decision signature evidence is invalid.'],
    51606: [409, 'DECISION_CONFLICT', 'A decision already exists for this AFC request stage.'],
    51607: [422, 'REJECTION_REASON_REQUIRED', 'A rejection reason of 1000 characters or fewer is required.'],
    51608: [409, 'REPORT_TO_RECOMMENDATION_REQUIRED', 'Reports-To recommendation evidence is required before Admin approval.']
  }[number];
  return known
    ? error(known[0], known[1], known[2])
    : error(503, 'SQL_UNAVAILABLE', 'The AFC approval service is temporarily unavailable.');
}

function normalizeDecision(row = {}) {
  return {
    afcRequestId: row.afcRequestId,
    status: text(row.status),
    rejectionReason: row.rejectionReason == null ? null : text(row.rejectionReason),
    approvedAtUtc: row.approvedAtUtc || null,
    updatedAtUtc: row.updatedAtUtc || null
  };
}

function createAfcApprovalApi({
  verifyToken,
  findUser,
  repository,
  writeGates = {},
  idFactory = randomUUID
}) {
  async function authorize(token) {
    let decoded;
    try {
      decoded = await verifyToken(token);
    } catch (_) {
      return error(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const uid = decoded && typeof decoded.uid === 'string' ? decoded.uid.trim() : '';
    if (!uid || uid.length > 256) {
      return error(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    let profile;
    try {
      profile = await findUser(uid);
    } catch (_) {
      return error(503, 'SERVICE_UNAVAILABLE', 'The profile service is temporarily unavailable.');
    }

    const scope = authorizeProfile(profile);
    if (scope.status) return scope;
    return { decoded: { ...decoded, uid }, profile, scope };
  }

  function validRequestId(value) {
    const id = text(value);
    return UUID.test(id) ? id : null;
  }

  function decisionInput(auth, id, validated) {
    return {
      afcRequestId: id,
      approvalId: idFactory(),
      signatureMode: validated.signature.mode,
      signatureName: validated.signature.name,
      signatureSignedAt: validated.signature.signedAt,
      signatureFingerprint: validated.signature.fingerprint,
      signatureImageDataUrl: validated.signature.imageDataUrl,
      actorFirebaseUid: auth.decoded.uid
    };
  }

  return {
    async recommend(token, afcRequestId, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (writeGates.afcDecision !== true) return writeDisabled();
      const id = validRequestId(afcRequestId);
      if (!id) return error(400, 'INVALID_REQUEST_ID', 'AFC request id is not a valid identifier.');
      const validated = validateDecisionPayload(payload, auth.decoded.uid);
      if (validated.status) return validated;

      try {
        const row = await repository.recommendRequest(decisionInput(auth, id, validated));
        return result(200, { afcRequest: normalizeDecision(row) });
      } catch (caught) {
        return mapApprovalError(caught);
      }
    },

    async reject(token, afcRequestId, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (writeGates.afcDecision !== true) return writeDisabled();
      const id = validRequestId(afcRequestId);
      if (!id) return error(400, 'INVALID_REQUEST_ID', 'AFC request id is not a valid identifier.');
      const validated = validateDecisionPayload(payload, auth.decoded.uid, { rejection: true });
      if (validated.status) return validated;

      try {
        const row = await repository.rejectRequest({
          ...decisionInput(auth, id, validated),
          rejectionReason: validated.rejectionReason
        });
        return result(200, { afcRequest: normalizeDecision(row) });
      } catch (caught) {
        return mapApprovalError(caught);
      }
    },

    async approve(token, afcRequestId, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!ADMIN_ROLES.has(auth.scope.role)) {
        return error(403, 'ROLE_DENIED', 'Only an administrator can approve an AFC request.');
      }
      if (writeGates.afcDecision !== true) return writeDisabled();

      const id = validRequestId(afcRequestId);
      if (!id) return error(400, 'INVALID_REQUEST_ID', 'AFC request id is not a valid identifier.');
      const validated = validateDecisionPayload(payload, auth.decoded.uid);
      if (validated.status) return validated;

      try {
        const row = await repository.approveRequest(decisionInput(auth, id, validated));
        return result(200, { afcRequest: normalizeDecision(row) });
      } catch (caught) {
        return mapApprovalError(caught);
      }
    }
  };
}

module.exports = {
  createAfcApprovalApi,
  validateDecisionPayload,
  mapApprovalError,
  normalizeDecision
};
