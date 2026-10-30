'use strict';

const { randomUUID } = require('node:crypto');
const { workDays } = require('./afc-policy');
const { writeDisabled } = require('../data/write-gates');
const { ADMINISTRATOR_ROLES, normalizeBaseRole } = require('../auth/role-policy');

const ADMIN_ROLES = ADMINISTRATOR_ROLES;
const SELF_ROLES = new Set(['faculty', 'hicc', 'visc']);
const ALLOWED_ROLES = new Set([...ADMIN_ROLES, ...SELF_ROLES]);
const FORBIDDEN_IDENTITY_FIELDS = new Set([
  'facultyId','facultyName','requesterUid','requesterFirebaseUid','requesterEmail',
  'reportToUid','reportToFirebaseUid','reportsToFacultyId','status','workDays',
  'teachingSessions','submittedAt','updatedAt','approvedAt','withdrawnBy','withdrawnAt'
]);
const TERMS_VERSION = 'ucvm-afc-terms-page2-v1';
const TERMS_SOURCE = 'absence-from-campus-app.pdf#page=2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;

const result = (status, body) => ({ status, body });
const error = (status, code, message) => result(status, { error: { code, message } });
const text = value => value === null || value === undefined ? '' : String(value).trim();

function roleOf(profile) {
  return normalizeBaseRole(profile && profile.baseRole) || '';
}

function authorizeProfile(profile) {
  if (!profile || profile.active !== true) return error(403, 'PROFILE_REQUIRED', 'An active SQL user profile is required.');
  if (profile.mustChangePassword === true) return error(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change is required before AFC access.');
  const role = roleOf(profile);
  if (!ALLOWED_ROLES.has(role)) return error(403, 'ROLE_DENIED', 'This role cannot access AFC requests.');
  const administrator = ADMIN_ROLES.has(role);
  if (!administrator && !text(profile.facultyId)) return error(403, 'FACULTY_LINK_REQUIRED', 'A linked faculty profile is required.');
  return { role, administrator, selfService: SELF_ROLES.has(role) };
}

function validateSignature(signature, actorUid) {
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
    return error(422, 'SIGNATURE_REQUIRED', 'A valid applicant signature is required.');
  }
  const mode = text(signature.mode).toLowerCase();
  const name = text(signature.name);
  const uid = text(signature.uid);
  const signedAt = text(signature.signedAt);
  const fingerprint = text(signature.fingerprint);
  const imageDataUrl = text(signature.imageDataUrl);

  if (!['typed', 'drawn', 'uploaded'].includes(mode)) return error(422, 'INVALID_SIGNATURE', 'Signature mode is not recognised.');
  if (signature.attested !== true) return error(422, 'SIGNATURE_ATTESTATION_REQUIRED', 'Signature attestation is required.');
  if (!name || name.length > 260) return error(422, 'INVALID_SIGNATURE', 'Signer name is required and must be 260 characters or fewer.');
  if (!uid || uid !== actorUid) return error(422, 'SIGNATURE_IDENTITY_MISMATCH', 'Signature account does not match the authenticated user.');
  const instant = new Date(signedAt);
  if (!signedAt || Number.isNaN(instant.getTime())) return error(422, 'INVALID_SIGNATURE', 'Signature time is invalid.');
  if (!HEX64.test(fingerprint)) return error(422, 'INVALID_SIGNATURE', 'Signature fingerprint is invalid.');
  if (imageDataUrl.length > 1_000_000) return error(422, 'SIGNATURE_TOO_LARGE', 'Signature image is too large.');
  if (mode === 'typed' && imageDataUrl) return error(422, 'INVALID_SIGNATURE', 'Typed signatures cannot include image data.');
  if (mode !== 'typed' && !/^data:image\/(?:png|jpeg);base64,/i.test(imageDataUrl)) {
    return error(422, 'INVALID_SIGNATURE', 'Drawn or uploaded signatures require PNG or JPEG image data.');
  }

  return { mode, name, signedAt: instant.toISOString(), fingerprint: fingerprint.toLowerCase(), imageDataUrl: imageDataUrl || null };
}

function validateSubmitPayload(payload, actorUid) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return error(400, 'INVALID_JSON', 'AFC request JSON must be an object.');
  }
  for (const key of FORBIDDEN_IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return error(400, 'CLIENT_IDENTITY_FORBIDDEN', 'Applicant identity and workflow routing are resolved by the server.');
    }
  }

  const startDate = text(payload.startDate);
  const endDate = text(payload.endDate);
  const days = workDays(startDate, endDate);
  if (days === null) return error(422, 'INVALID_DATE_RANGE', 'AFC dates are outside the supported calendar or invalid.');
  if (days < 1) return error(422, 'NO_WORK_DAYS', 'The selected range contains no working days.');

  const reason = text(payload.reason).toLowerCase();
  if (!['vacation', 'business_other'].includes(reason)) return error(422, 'INVALID_REASON', 'Select Vacation or Business / Other.');
  const purposeDestination = text(payload.purposeDestination);
  if (reason === 'business_other' && !purposeDestination) {
    return error(422, 'PURPOSE_REQUIRED', 'Purpose and destination are required for Business / Other.');
  }
  if (purposeDestination.length > 1000) return error(422, 'PURPOSE_TOO_LONG', 'Purpose and destination must be 1000 characters or fewer.');

  const coverage = text(payload.coverage);
  if (coverage.length > 2000) return error(422, 'COVERAGE_TOO_LONG', 'Coverage must be 2000 characters or fewer.');
  const contactAddress = text(payload.contactAddress);
  const contactPhone = text(payload.contactPhone);
  if (!contactAddress || contactAddress.length > 500) return error(422, 'INVALID_CONTACT_ADDRESS', 'A contact address of 500 characters or fewer is required.');
  if (!contactPhone || contactPhone.length > 50) return error(422, 'INVALID_CONTACT_PHONE', 'A phone number of 50 characters or fewer is required.');

  if (payload.termsAccepted !== true || text(payload.termsVersion) !== TERMS_VERSION || text(payload.termsSource) !== TERMS_SOURCE) {
    return error(422, 'TERMS_REQUIRED', 'The current AFC Terms & Conditions must be accepted.');
  }

  const signature = validateSignature(payload.applicantSignature, actorUid);
  if (signature.status) return signature;

  return {
    startDate,
    endDate,
    workDays: days,
    reason,
    purposeDestination: purposeDestination || null,
    coverage: coverage || null,
    contactAddress,
    contactPhone,
    termsVersion: TERMS_VERSION,
    termsSource: TERMS_SOURCE,
    signature
  };
}

function mapRepositoryError(caught) {
  const number = Number(caught && caught.number);
  const known = {
    51501: [403, 'PROFILE_REQUIRED', 'An active faculty-linked SQL user profile is required.'],
    51502: [404, 'FACULTY_NOT_FOUND', 'Active Faculty record was not found.'],
    51503: [409, 'REPORT_TO_AMBIGUOUS', 'Reports-To account mapping is ambiguous and must be corrected.'],
    51504: [422, 'INVALID_DATE_RANGE', 'AFC dates are invalid.'],
    51505: [422, 'COVERAGE_REQUIRED', 'Coverage is required because teaching assignments occur during this absence.'],
    51506: [409, 'REQUEST_CONFLICT', 'The AFC request could not be created because its identifier already exists.'],
    51507: [404, 'REQUEST_NOT_FOUND', 'A pending AFC request was not found for this requester.'],
    51508: [409, 'INVALID_STATE', 'This AFC request can no longer be withdrawn.'],
    51509: [409, 'REPORT_TO_UNAVAILABLE', 'The assigned Reports-To account is unavailable and must be corrected before submission.'],
    51510: [409, 'DATE_CHANGE_NOT_ALLOWED', 'Only an approved AFC request can have its dates changed. Withdraw a pending request and submit a new one.'],
    51511: [409, 'DATE_CHANGE_PENDING', 'A date change for this AFC request is already waiting for approval.'],
    51512: [422, 'AFC_DATES_UNCHANGED', 'The new dates are the same as the approved dates.'],
    56402: [403, 'ROLE_DENIED', 'Administrator permission is required.'],
    56403: [404, 'REQUEST_NOT_FOUND', 'This AFC request no longer exists.'],
    56404: [409, 'REQUEST_CHANGED', 'This AFC request changed. Refresh and review it before changing dates.'],
    56405: [422, 'INVALID_DATE_RANGE', 'AFC dates are invalid.'],
    56406: [409, 'DATE_CHANGE_NOT_ALLOWED', 'Only an approved AFC request can have its dates changed.'],
    56407: [409, 'DATE_CHANGE_PENDING', 'A faculty date change for this request is waiting for approval.'],
    56408: [422, 'AFC_DATES_UNCHANGED', 'The new dates are the same as the current dates.']
  }[number];
  return known ? error(known[0], known[1], known[2]) : error(503, 'SQL_UNAVAILABLE', 'The AFC request service is temporarily unavailable.');
}

function normalizeRequest(row = {}) {
  return {
    afcRequestId: row.afcRequestId,
    facultyId: row.facultyId,
    facultyName: text(row.facultyName),
    requesterFirebaseUid: text(row.requesterFirebaseUid),
    reportToFirebaseUid: text(row.reportToFirebaseUid) || null,
    status: text(row.status),
    startDate: text(row.startDate),
    endDate: text(row.endDate),
    workDays: Number(row.workDays || 0),
    reason: text(row.reason),
    purposeDestination: row.purposeDestination == null ? null : text(row.purposeDestination),
    coverage: row.coverage == null ? null : text(row.coverage),
    submittedAtUtc: row.submittedAtUtc || null,
    updatedAtUtc: row.updatedAtUtc || null,
    replacesAfcRequestId: row.replacesAfcRequestId || null,
    supersededByAfcRequestId: row.supersededByAfcRequestId || null,
    versionToken: /^[0-9a-f]{16}$/i.test(text(row.versionToken)) ? text(row.versionToken).toUpperCase() : null
  };
}

function createAfcRequestApi({ verifyToken, findUser, repository, idFactory = randomUUID, writeGates = {} }) {
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
    decoded = { ...decoded, uid };

    let profile;
    try {
      profile = await findUser(uid);
    } catch (_) {
      return error(503, 'SERVICE_UNAVAILABLE', 'The SQL profile service is temporarily unavailable.');
    }

    const scope = authorizeProfile(profile);
    if (scope.status) return scope;
    return { decoded, profile, scope };
  }

  return {
    async writeCapabilities(token) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      return result(200, {
        writeCapabilities: {
          sessionEdit: writeGates.sessionEdit === true,
          sessionCreate: writeGates.sessionCreate === true,
          afcSingle: writeGates.afcSingle === true,
          afcBatch: writeGates.afcBatch === true,
          requestLifecycle: writeGates.afcRequest === true,
          decisions: writeGates.afcDecision === true,
          approvedArtifactCreation: writeGates.afcArtifact === true,
          dateChange: writeGates.afcEdit === true
        }
      });
    },

    async list(token) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      try {
        const rows = await repository.listRequests({
          actorFirebaseUid: auth.decoded.uid,
          administrator: auth.scope.administrator
        });
        return result(200, { afcRequests: rows.map(normalizeRequest), count: rows.length });
      } catch (caught) {
        return mapRepositoryError(caught);
      }
    },

    async submit(token, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!auth.scope.selfService) return error(403, 'ROLE_DENIED', 'Administrator accounts cannot submit a faculty AFC request.');
      if (writeGates.afcRequest !== true) return writeDisabled();
      const validated = validateSubmitPayload(payload, auth.decoded.uid);
      if (validated.status) return validated;
      try {
        const row = await repository.submitRequest({
          afcRequestId: idFactory(),
          ...validated,
          signatureMode: validated.signature.mode,
          signatureName: validated.signature.name,
          signatureSignedAt: validated.signature.signedAt,
          signatureFingerprint: validated.signature.fingerprint,
          signatureImageDataUrl: validated.signature.imageDataUrl,
          actorFirebaseUid: auth.decoded.uid,
          actorName: text(auth.profile.displayName)
        });
        return result(201, { afcRequest: normalizeRequest(row) });
      } catch (caught) {
        return mapRepositoryError(caught);
      }
    },

    // UX-07: the requester changes the dates of their own approved request. The
    // full request form is signed again and goes through the normal approval;
    // the old dates stay approved until the change is approved.
    async changeDates(token, afcRequestId, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!auth.scope.selfService) return error(403, 'ROLE_DENIED', 'Only the requester can change the dates of their AFC request.');
      if (writeGates.afcRequest !== true || writeGates.afcEdit !== true) return writeDisabled();
      const id = text(afcRequestId);
      if (!UUID.test(id)) return error(400, 'INVALID_REQUEST_ID', 'AFC request id is not a valid identifier.');
      const expectedVersion = text(payload?.expectedVersion);
      if (!/^[0-9a-f]{16}$/i.test(expectedVersion)) return error(400, 'INVALID_REQUEST_VERSION', 'Reload the original approved AFC request before changing dates.');
      const validated = validateSubmitPayload(payload, auth.decoded.uid);
      if (validated.status) return validated;
      try {
        const row = await repository.submitDateChange({
          expectedVersion,
          replacesAfcRequestId: id,
          afcRequestId: idFactory(),
          ...validated,
          signatureMode: validated.signature.mode,
          signatureName: validated.signature.name,
          signatureSignedAt: validated.signature.signedAt,
          signatureFingerprint: validated.signature.fingerprint,
          signatureImageDataUrl: validated.signature.imageDataUrl,
          actorFirebaseUid: auth.decoded.uid,
          actorName: text(auth.profile.displayName)
        });
        if (!row) return error(503, 'SQL_UNAVAILABLE', 'The AFC request service is temporarily unavailable.');
        return result(201, { afcRequest: normalizeRequest({ ...row, replacesAfcRequestId: id }) });
      } catch (caught) {
        return mapRepositoryError(caught);
      }
    },

    // UX-07: the ADFA office changes the dates of an approved request directly.
    // No new approval; Change History records the old and new dates.
    async officeChangeDates(token, afcRequestId, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!auth.scope.administrator) return error(403, 'ROLE_DENIED', 'Only the ADFA office can change approved AFC dates directly.');
      if (writeGates.afcEdit !== true) return writeDisabled();
      const id = text(afcRequestId);
      if (!UUID.test(id)) return error(400, 'INVALID_REQUEST_ID', 'AFC request id is not a valid identifier.');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return error(400, 'INVALID_JSON', 'AFC date JSON must be an object.');
      const expectedVersion = text(payload.expectedVersion);
      if (!/^[0-9a-f]{16}$/i.test(expectedVersion)) return error(400, 'INVALID_REQUEST_VERSION', 'Refresh the AFC requests before changing dates.');
      const startDate = text(payload.startDate), endDate = text(payload.endDate);
      const days = workDays(startDate, endDate);
      if (days === null) return error(422, 'INVALID_DATE_RANGE', 'AFC dates are outside the supported calendar or invalid.');
      if (days < 1) return error(422, 'NO_WORK_DAYS', 'The selected range contains no working days.');
      const requestId = UUID.test(text(payload.requestId)) ? text(payload.requestId) : idFactory();
      try {
        const row = await repository.updateApprovedRequestDates({ afcRequestId: id, expectedVersion, startDate, endDate, workDays: days, actorFirebaseUid: auth.decoded.uid, requestId });
        if (!row) return error(503, 'SQL_UNAVAILABLE', 'The AFC request service is temporarily unavailable.');
        return result(200, { afcRequest: { afcRequestId: row.afcRecordId || id, facultyId: row.facultyId || null, status: 'approved', startDate: text(row.startDate), endDate: text(row.endDate), workDays: Number(row.workDays || days), versionToken: text(row.versionToken) || null } });
      } catch (caught) {
        return mapRepositoryError(caught);
      }
    },

    async withdraw(token, afcRequestId) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!auth.scope.selfService) return error(403, 'ROLE_DENIED', 'Only the requester can withdraw an AFC request.');
      if (writeGates.afcRequest !== true) return writeDisabled();
      const id = text(afcRequestId);
      if (!UUID.test(id)) return error(400, 'INVALID_REQUEST_ID', 'AFC request id is not a valid identifier.');
      try {
        const row = await repository.withdrawRequest({
          afcRequestId: id,
          actorFirebaseUid: auth.decoded.uid,
          actorName: text(auth.profile.displayName),
          auditRequestId: idFactory()
        });
        return result(200, { afcRequest: normalizeRequest(row) });
      } catch (caught) {
        return mapRepositoryError(caught);
      }
    }
  };
}

module.exports = {
  createAfcRequestApi,
  authorizeProfile,
  validateSubmitPayload,
  validateSignature,
  normalizeRequest,
  TERMS_VERSION,
  TERMS_SOURCE,
  ADMIN_ROLES,
  SELF_ROLES
};
