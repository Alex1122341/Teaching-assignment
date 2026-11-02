'use strict';
// AFC requests, two-stage approval, approved-PDF artifacts and archived AFC
// form documents for the Frontend Demo. Approved artifacts are rendered by the
// real Beta renderer in the browser; PDFs are kept in memory only.
const { isAdministratorRole } = require('../../../server/src/auth/role-policy.js');
const { sha256Hex, uuidFor, toHex, sha256Bytes } = require('../ids.js');
const { clone, sqlError, facultyName } = require('./core.js');
const { dateRange, versionOf, bumpVersion, requireCoverage, ensureApprovedRecord } = require('./afc-date-change.js');

const userOf = (store, uid) => store.tables.users.find(u => u.firebaseUid === uid) || null;
const fp = text => sha256Hex(`signature:${text}`);

function requests(store) {
  return store.bag('afcRequests', () => {
    const t = store.tables, f = id => t.faculty.find(x => x.legacyId === id);
    const seed = [
      ['fac-002', 'pending_report_to', '2026-11-16', '2026-11-20', 'business_other', 'AVMA conference, Denver'],
      ['fac-004', 'pending_admin', '2026-12-07', '2026-12-09', 'vacation', ''],
      ['fac-006', 'approved', '2026-10-05', '2026-10-07', 'business_other', 'External examiner visit, Saskatoon'],
      ['fac-008', 'rejected', '2026-11-02', '2026-11-13', 'vacation', '']
    ];
    return seed.map(([legacy, status, startDate, endDate, reason, purpose], i) => {
      const member = f(legacy), requester = `uid-${legacy.replace('fac', 'fac')}`;
      const signedAt = '2026-09-2' + i + 'T16:00:00.000Z';
      const approvals = [];
      if (['pending_admin', 'approved', 'rejected'].includes(status)) approvals.push({ stage: 'report_to', decision: 'recommended', signatureMode: 'typed', signatureName: 'Avery Lindqvist', approverFirebaseUid: 'uid-fac-001', signatureSignedAtUtc: '2026-09-25T15:00:00.000Z', signatureFingerprint: fp('rt' + i), signatureImageDataUrl: null });
      if (status === 'approved') approvals.push({ stage: 'admin', decision: 'approved', signatureMode: 'typed', signatureName: 'ADFA General', approverFirebaseUid: 'uid-adfa-general', signatureSignedAtUtc: '2026-09-28T15:00:00.000Z', signatureFingerprint: fp('ad' + i), signatureImageDataUrl: null });
      return { afcRequestId: uuidFor(`afc-request:${i}`), facultyId: member.facultyId, facultyName: member.displayName, requesterFirebaseUid: requester, reportToFirebaseUid: 'uid-fac-001', status, startDate, endDate, workDays: 3 + (i % 3), reason, purposeDestination: purpose || null, coverage: i % 2 ? 'Lectures covered by HICC; lab rescheduled' : null, contactAddress: '123 Example Street, Calgary AB', contactPhone: '403-555-01' + (10 + i), termsVersion: '2026-09', termsSource: 'absence-from-campus-terms.pdf', signatureMode: 'typed', signatureName: member.displayName, signatureSignedAt: signedAt, signatureFingerprint: fp('app' + i), signatureImageDataUrl: null, submittedAtUtc: signedAt, updatedAtUtc: signedAt, rejectionReason: status === 'rejected' ? 'Overlaps scheduled OSCE week; please choose other dates.' : null, approvedAtUtc: status === 'approved' ? '2026-09-28T15:00:00.000Z' : null, approvals };
    });
  });
}

const rowView = q => ({ afcRequestId: q.afcRequestId, facultyId: q.facultyId, facultyName: q.facultyName, requesterFirebaseUid: q.requesterFirebaseUid, reportToFirebaseUid: q.reportToFirebaseUid, status: q.status, startDate: q.startDate, endDate: q.endDate, workDays: q.workDays, reason: q.reason, purposeDestination: q.purposeDestination, coverage: q.coverage, submittedAtUtc: q.submittedAtUtc, updatedAtUtc: q.updatedAtUtc, replacesAfcRequestId: q.replacesAfcRequestId || null, supersededByAfcRequestId: q.supersededByAfcRequestId || null, versionToken: versionOf(q) });
const decisionView = q => ({ afcRequestId: q.afcRequestId, status: q.status, rejectionReason: q.rejectionReason, approvedAtUtc: q.approvedAtUtc, updatedAtUtc: q.updatedAtUtc });

function reportToFor(store, facultyId) {
  const member = store.tables.faculty.find(f => f.facultyId === facultyId);
  const manager = member && member.reportsToFacultyId;
  const user = manager && store.tables.users.find(u => u.facultyId === manager && u.active);
  return user ? user.firebaseUid : null;
}

function createAfcRequestRepository(store) {
  return {
    async listRequests({ actorFirebaseUid, administrator = false }) {
      return requests(store).filter(q => administrator || q.requesterFirebaseUid === actorFirebaseUid || q.reportToFirebaseUid === actorFirebaseUid).sort((a, b) => b.submittedAtUtc.localeCompare(a.submittedAtUtc)).map(rowView);
    },
    async submitRequest(input) {
      const user = userOf(store, input.actorFirebaseUid);
      if (!user || !user.facultyId) throw sqlError(51503, 'A faculty-linked account is required.');
      const member = store.tables.faculty.find(f => f.facultyId === user.facultyId);
      const reportTo = reportToFor(store, user.facultyId);
      const now = store.nowIso();
      const row = { ...input, afcRequestId: input.afcRequestId, facultyId: user.facultyId, facultyName: member.displayName, requesterFirebaseUid: user.firebaseUid, reportToFirebaseUid: reportTo, status: reportTo ? 'pending_report_to' : 'pending_admin', submittedAtUtc: now, updatedAtUtc: now, versionToken: versionOf(null), rejectionReason: null, approvedAtUtc: null, approvals: [] };
      requests(store).unshift(row);
      store.audit({ domain: 'afc', changeType: 'afc_request_submitted', facultyId: user.facultyId, actorFirebaseUid: user.firebaseUid, after: rowView(row) });
      store.commit();
      return rowView(row);
    },
    // Same approval route as a new AFC request. The earlier approved dates
    // remain active until approval of this linked request.
    async submitDateChange(input) {
      const original = requests(store).find(q => q.afcRequestId === input.replacesAfcRequestId);
      if (!original || original.requesterFirebaseUid !== input.actorFirebaseUid) throw sqlError(51510, 'Only the original requester can change dates');
      if (original.status !== 'approved' || original.supersededByAfcRequestId) throw sqlError(51510, 'Only active approved AFC requests can change dates');
      if (versionOf(original) !== String(input.expectedVersion || '').toUpperCase()) throw sqlError(56404, 'Request changed; reload');
      if (requests(store).some(q => q.replacesAfcRequestId === original.afcRequestId && ['pending_report_to', 'pending_admin'].includes(q.status))) throw sqlError(51511, 'A date change is already pending');
      if (original.startDate === input.startDate && original.endDate === input.endDate) throw sqlError(51512, 'Dates unchanged');
      dateRange(input.startDate, input.endDate);
      const teaching = requireCoverage(store, original.facultyId, input.startDate, input.endDate, input.coverage);
      const actor = userOf(store, input.actorFirebaseUid);
      if (!actor || actor.active !== true || actor.facultyId !== original.facultyId) throw sqlError(51501, 'Faculty account is unavailable');
      const reportTo = reportToFor(store, original.facultyId);
      const now = store.nowIso();
      const row = { ...input, expectedVersion: undefined, afcRequestId: input.afcRequestId, facultyId: original.facultyId,
        facultyName: original.facultyName, requesterFirebaseUid: input.actorFirebaseUid, reportToFirebaseUid: reportTo,
        replacesAfcRequestId: original.afcRequestId, replacesVersion: versionOf(original), versionToken: versionOf(null),
        teachingSessions: teaching, status: reportTo ? 'pending_report_to' : 'pending_admin', submittedAtUtc: now,
        updatedAtUtc: now, approvedAtUtc: null, rejectionReason: null, approvals: [] };
      requests(store).unshift(row);
      store.audit({ domain: 'afc', changeType: 'afc_date_change_requested', facultyId: row.facultyId,
        actorFirebaseUid: input.actorFirebaseUid, before: rowView(original), after: rowView(row) });
      store.commit();
      return rowView(row);
    },
    // ADFAD direct edit: version check and before/after audit. Browser Demo only.
    async updateApprovedRequestDates(input) {
      if (!isAdministratorRole(userOf(store, input.actorFirebaseUid)?.baseRole)) throw sqlError(56402, 'Administrator required');
      const original = requests(store).find(q => q.afcRequestId === input.afcRequestId);
      if (!original) throw sqlError(56403, 'AFC request not found');
      if (original.status !== 'approved' || original.supersededByAfcRequestId) throw sqlError(56406, 'Request not approved');
      if (versionOf(original) !== String(input.expectedVersion || '').toUpperCase()) throw sqlError(56404, 'Stale AFC version');
      if (requests(store).some(q => q.replacesAfcRequestId === original.afcRequestId && ['pending_report_to', 'pending_admin'].includes(q.status))) throw sqlError(56407, 'Faculty date change is pending');
      if (original.startDate === input.startDate && original.endDate === input.endDate) throw sqlError(56408, 'Dates unchanged');
      const days = dateRange(input.startDate, input.endDate);
      const teaching = requireCoverage(store, original.facultyId, input.startDate, input.endDate, original.coverage);
      const before = rowView(original);
      const record = ensureApprovedRecord(store, original);
      original.startDate = input.startDate;
      original.endDate = input.endDate;
      original.workDays = days;
      original.teachingSessions = teaching;
      original.updatedAtUtc = store.nowIso();
      original.versionToken = bumpVersion(versionOf(original));
      record.startDate = input.startDate;
      record.endDate = input.endDate;
      record.versionToken = bumpVersion(versionOf(record));
      store.audit({ domain: 'afc', changeType: 'afc_dates_changed', facultyId: original.facultyId,
        actorFirebaseUid: input.actorFirebaseUid, before, after: rowView(original) });
      store.commit();
      return { afcRecordId: original.afcRequestId, facultyId: original.facultyId,
        startDate: original.startDate, endDate: original.endDate, workDays: original.workDays, versionToken: versionOf(original) };
    },
    async withdrawRequest({ afcRequestId, actorFirebaseUid }) {
      const q = requests(store).find(x => x.afcRequestId === afcRequestId && x.requesterFirebaseUid === actorFirebaseUid && ['pending_report_to', 'pending_admin'].includes(x.status));
      if (!q) throw sqlError(51507, 'Not found');
      q.status = 'withdrawn'; q.updatedAtUtc = store.nowIso();
      store.audit({ domain: 'afc', changeType: 'afc_request_withdrawn', facultyId: q.facultyId, actorFirebaseUid, after: rowView(q) });
      store.commit();
      return rowView(q);
    }
  };
}

function createAfcApprovalRepository(store) {
  const find = id => { const q = requests(store).find(x => x.afcRequestId === id); if (!q) throw sqlError(51602, 'Not found'); return q; };
  const sign = (input, stage, decision) => ({ stage, decision, signatureMode: input.signatureMode, signatureName: input.signatureName, approverFirebaseUid: input.actorFirebaseUid, signatureSignedAtUtc: input.signatureSignedAt, signatureFingerprint: input.signatureFingerprint, signatureImageDataUrl: input.signatureImageDataUrl || null });
  const done = (q, change, actor) => { q.updatedAtUtc = store.nowIso(); store.audit({ domain: 'afc', changeType: change, facultyId: q.facultyId, actorFirebaseUid: actor, after: decisionView(q) }); store.commit(); return decisionView(q); };
  return {
    async recommendRequest(input) {
      const q = find(input.afcRequestId);
      if (q.status !== 'pending_report_to') throw sqlError(51603, 'Invalid state');
      if (q.reportToFirebaseUid !== input.actorFirebaseUid) throw sqlError(51604, 'Not the Reports-To approver');
      q.approvals.push(sign(input, 'report_to', 'recommended')); q.status = 'pending_admin';
      return done(q, 'afc_request_recommended', input.actorFirebaseUid);
    },
    async rejectRequest(input) {
      const q = find(input.afcRequestId);
      if (!['pending_report_to', 'pending_admin'].includes(q.status)) throw sqlError(51603, 'Invalid state');
      const admin = isAdministratorRole(userOf(store, input.actorFirebaseUid)?.baseRole);
      if (!(admin || (q.status === 'pending_report_to' && q.reportToFirebaseUid === input.actorFirebaseUid))) throw sqlError(51604, 'Role denied');
      q.approvals.push(sign(input, q.status === 'pending_admin' ? 'admin' : 'report_to', 'rejected')); q.status = 'rejected'; q.rejectionReason = input.rejectionReason;
      return done(q, 'afc_request_rejected', input.actorFirebaseUid);
    },
    async approveRequest(input) {
      const q = find(input.afcRequestId);
      if (q.status !== 'pending_admin') throw sqlError(q.status === 'pending_report_to' ? 51608 : 51603, 'Invalid state');
      if (!isAdministratorRole(userOf(store, input.actorFirebaseUid)?.baseRole)) throw sqlError(51604, 'Role denied');
      // Recheck the original revision at final approval; a stale replacement must
      // never supersede newer office dates or a second approved replacement.
      let original = null;
      if (q.replacesAfcRequestId) {
        original = requests(store).find(item => item.afcRequestId === q.replacesAfcRequestId);
        if (!original || original.status !== 'approved' || versionOf(original) !== q.replacesVersion) throw sqlError(56404, 'Original approved request changed; reload before approval');
        const priorRecord = ensureApprovedRecord(store, original);
        priorRecord.active = false;
        priorRecord.versionToken = bumpVersion(versionOf(priorRecord));
        const before = rowView(original);
        original.status = 'superseded';
        original.supersededByAfcRequestId = q.afcRequestId;
        original.updatedAtUtc = store.nowIso();
        original.versionToken = bumpVersion(versionOf(original));
        store.audit({ domain: 'afc', changeType: 'afc_dates_changed', facultyId: q.facultyId,
          actorFirebaseUid: input.actorFirebaseUid, before, after: { replacementRequestId: q.afcRequestId, dates: { startDate: q.startDate, endDate: q.endDate } } });
      }
      q.approvals.push(sign(input, 'admin', 'approved')); q.status = 'approved'; q.approvedAtUtc = store.nowIso();
      q.versionToken = bumpVersion(versionOf(q));
      ensureApprovedRecord(store, q);
      return done(q, 'afc_request_approved', input.actorFirebaseUid);
    }
  };
}

function createAfcArtifactRepository(store) {
  const memory = new Map();
  const notFound = () => { throw Object.assign(new Error('The approved AFC artifact is not available.'), { code: 'ARTIFACT_NOT_FOUND', statusCode: 404 }); };
  const allowed = (q, uid) => q.requesterFirebaseUid === uid || q.reportToFirebaseUid === uid || isAdministratorRole(userOf(store, uid)?.baseRole);
  return {
    async getApprovedArtifact({ afcRequestId, actorFirebaseUid }) {
      const q = requests(store).find(x => x.afcRequestId === afcRequestId);
      if (!q || !allowed(q, actorFirebaseUid) || !memory.has(afcRequestId)) notFound();
      return memory.get(afcRequestId);
    },
    async getApprovedArtifactSource({ afcRequestId, actorFirebaseUid }) {
      const q = requests(store).find(x => x.afcRequestId === afcRequestId);
      if (!q || q.status !== 'approved' || !allowed(q, actorFirebaseUid)) throw Object.assign(new Error('The approved AFC artifact is not available.'), { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
      const member = store.tables.faculty.find(f => f.facultyId === q.facultyId) || {};
      const sessions = store.tables.sessions.filter(s => s.date >= q.startDate && s.date <= q.endDate && s.assignments.some(a => a.facultyId === q.facultyId)).map(s => ({ date: s.date, courseCode: s.courseCode, sessionType: s.sessionType, startTime: s.startTime, endTime: s.endTime, topic: s.topic }));
      const snapshot = { afcRequestId: q.afcRequestId, facultyName: q.facultyName, preferredFirstName: member.preferredFirstName, preferredLastName: member.preferredLastName, employeeId: member.ucid, rank: member.rank, requesterFirebaseUid: q.requesterFirebaseUid, reportToFirebaseUid: q.reportToFirebaseUid, approvedAtUtc: q.approvedAtUtc, startDate: q.startDate, endDate: q.endDate, workDays: q.workDays, reason: q.reason, purposeDestination: q.purposeDestination, contactAddress: q.contactAddress, contactPhone: q.contactPhone, coverage: q.coverage || (sessions.length ? 'Coverage arranged with the course HICC' : null), teachingSessions: sessions, applicantSignatureMode: q.signatureMode, applicantSignatureName: q.signatureName, applicantSignatureUid: q.requesterFirebaseUid, applicantSignatureSignedAtUtc: q.signatureSignedAt, applicantSignatureFingerprint: q.signatureFingerprint, applicantSignatureImageDataUrl: q.signatureImageDataUrl, approvals: q.approvals.filter(a => a.decision !== 'rejected') };
      const json = JSON.stringify(snapshot);
      return { sourceSnapshotJson: json, sourceSnapshotSha256: sha256Hex(json) };
    },
    async createOrGetApprovedArtifact({ afcRequestId, sourceSnapshotSha256, pdfBytes, pdfSha256, byteLength, templateSha256, rendererVersion }) {
      if (memory.has(afcRequestId)) return memory.get(afcRequestId);
      const hex = value => typeof value === 'string' ? value : toHex(value);
      const artifact = { afcArtifactId: uuidFor(`artifact:${afcRequestId}`), afcRequestId, contentType: 'application/pdf', pdfBytes, pdfSha256: hex(pdfSha256), byteLength, sourceSnapshotSha256: hex(sourceSnapshotSha256), templateSha256: hex(templateSha256), rendererVersion, createdAtUtc: store.nowIso() };
      memory.set(afcRequestId, artifact);
      return artifact;
    }
  };
}

function createAfcFormRepository(store) {
  const docs = new Map(); // PDF bytes stay in this browser tab's memory only
  const meta = () => store.bag('afcFormDocuments', () => []);
  return {
    async upload({ facultyId, requestId, fileName, pdfBytes, sha256, pageCount }) {
      const existing = meta().find(d => d.requestId === requestId);
      if (existing) return { ...existing, idempotentReplay: true };
      const row = { documentId: uuidFor(`afc-form:${requestId}`), requestId, facultyId, fileName, byteLength: pdfBytes.length, pageCount, sha256, createdAtUtc: store.nowIso() };
      meta().unshift(row); docs.set(row.documentId, pdfBytes); store.commit();
      return { ...row, idempotentReplay: false };
    },
    async list({ facultyId, cursor = null, limit = 25 }) {
      const rows = meta().filter(d => d.facultyId.toLowerCase() === facultyId.toLowerCase());
      const offset = Number(cursor || 0), page = rows.slice(offset, offset + limit);
      return { documents: page, nextCursor: offset + page.length < rows.length ? String(offset + page.length) : null };
    },
    async get({ documentId }) {
      const row = meta().find(d => d.documentId === documentId);
      if (!row || !docs.has(documentId)) throw sqlError(54803, 'Not found (archived PDFs are kept only for this browser session in the demo).');
      return { ...row, pdfBytes: docs.get(documentId) };
    }
  };
}

// Stand-in for the server's worker-thread PDF check: loads the PDF with pdf-lib.
async function validateDemoPdf(bytes) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return { sha256: toHex(sha256Bytes(bytes)), pageCount: doc.getPageCount() };
}

module.exports = { createAfcRequestRepository, createAfcApprovalRepository, createAfcArtifactRepository, createAfcFormRepository, validateDemoPdf, requests };
