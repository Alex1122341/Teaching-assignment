'use strict';
// Faculty edits, role effective periods and AFC record writes for the demo.
const { PROFILE_FIELDS } = require('../../../server/src/data/sql-faculty-admin-repository.js');
const { afcView, sqlError, clone } = require('./core.js');
const { isAdministratorRole } = require('../../../server/src/auth/role-policy.js');
const { dateRange, versionOf, bumpVersion } = require('./afc-date-change.js');

const AFC_REASONS = { university_travel: 'University Travel', vacation: 'Vacation', rsl: 'RSL', medical: 'Medical', mat: 'MAT', special: 'Special', other: 'Other' };
const hexVersion = n => '0x' + Number(n).toString(16).toUpperCase().padStart(16, '0');

function facultyDto(row) {
  return { facultyId: row.facultyId, preferredFirstName: row.preferredFirstName, preferredLastName: row.preferredLastName, displayName: row.displayName, ucid: row.ucid, email: row.email, recordType: row.recordType, stream: row.stream, rank: row.rank, fte: row.fte, reportsToFacultyId: row.reportsToFacultyId || null, active: row.active, updatedAtUtc: row.updatedAtUtc, profileVersion: row.profile.profileVersion, professionalProfile: Object.fromEntries(PROFILE_FIELDS.map(field => [field, row.profile[field] ?? null])) };
}

function createFacultyAdminRepository(store) {
  const t = () => store.tables;
  const find = id => { const row = t().faculty.find(item => item.facultyId === id); if (!row) throw sqlError(52303, 'Faculty not found'); return row; };
  const sameInstant = (a, b) => String(a || '').slice(0, 19) === String(b || '').slice(0, 19);
  const touch = (row, actor, action, before) => {
    row.updatedAtUtc = store.nowIso();
    store.audit({ domain: 'lookup', changeType: action, facultyId: row.facultyId, actorFirebaseUid: actor, before, after: facultyDto(row) });
    store.commit();
    return facultyDto(row);
  };
  return {
    async updateRolePeriods({ roleAssignmentId, expectedVersion, periods, actorFirebaseUid }) {
      const role = t().roles.find(row => row.roleAssignmentId === roleAssignmentId);
      if (!role) throw sqlError(53504, 'Appointment not found.');
      const current = role.scheduleVersion || null;
      if ((current || null) !== (expectedVersion || null)) throw sqlError(53509, 'Appointment changed; reload.');
      const before = role.validityPeriods;
      role.validityPeriods = periods;
      role.scheduleVersion = hexVersion((parseInt(String(current || '0x0').slice(2), 16) || 0) + 1);
      store.audit({ domain: 'lookup', changeType: 'role_periods_updated', roleAssignmentId, facultyId: role.facultyId, actorFirebaseUid, before, after: periods });
      store.commit();
      return { roleAssignmentId, scheduleVersion: role.scheduleVersion };
    },
    async updateFaculty(input) {
      const row = find(input.facultyId);
      if (!sameInstant(row.updatedAtUtc, input.expectedUpdatedAtUtc) || (input.expectedProfileVersion && input.expectedProfileVersion.toUpperCase() !== String(row.profile.profileVersion).toUpperCase())) throw sqlError(52305, 'Revision conflict');
      if (t().faculty.some(other => other.facultyId !== row.facultyId && ((input.ucid && other.ucid === input.ucid) || (input.email && other.email.toLowerCase() === String(input.email).toLowerCase())))) throw sqlError(52304, 'Identity conflict');
      const before = facultyDto(row);
      for (const key of ['preferredFirstName', 'preferredLastName', 'ucid', 'email', 'recordType', 'stream', 'rank', 'fte', 'reportsToFacultyId']) if (input[key] !== undefined) row[key] = input[key];
      row.displayName = input.displayName || `${row.preferredFirstName} ${row.preferredLastName}`.trim();
      row.storedDisplayName = `${row.preferredLastName}, ${row.preferredFirstName}`;
      for (const field of PROFILE_FIELDS) if (input.professionalProfile && input.professionalProfile[field] !== undefined) row.profile[field] = input.professionalProfile[field];
      row.profile.profileVersion = hexVersion(parseInt(row.profile.profileVersion.slice(2), 16) + 1);
      return touch(row, input.actorFirebaseUid, 'faculty_updated', before);
    },
    async deactivateFaculty({ facultyId, expectedUpdatedAtUtc, actorFirebaseUid }) {
      const row = find(facultyId);
      if (!sameInstant(row.updatedAtUtc, expectedUpdatedAtUtc)) throw sqlError(52305, 'Revision conflict');
      const before = facultyDto(row); row.active = false;
      return touch(row, actorFirebaseUid, 'faculty_deactivated', before);
    },
    async restoreFaculty({ facultyId, expectedUpdatedAtUtc, actorFirebaseUid }) {
      const row = find(facultyId);
      if (!sameInstant(row.updatedAtUtc, expectedUpdatedAtUtc)) throw sqlError(52305, 'Revision conflict');
      const before = facultyDto(row); row.active = true;
      return touch(row, actorFirebaseUid, 'faculty_restored', before);
    }
  };
}

function createAfcWriteRepository(store) {
  const t = () => store.tables;
  const check = ({ facultyId, startDate, endDate, reasonCode, notes }) => {
    if (!startDate || !endDate) throw sqlError(51205, 'Dates required');
    if (endDate < startDate) throw sqlError(51206, 'Range');
    if (reasonCode && !AFC_REASONS[reasonCode]) throw sqlError(51207, 'Reason');
    if ((reasonCode === 'special' || reasonCode === 'other') && !String(notes || '').trim()) throw sqlError(51208, 'Notes required');
    if (!t().faculty.some(row => row.facultyId === facultyId && row.active)) throw sqlError(51210, 'Faculty');
  };
  return {
    async createAfcRecord({ afcRecordId, facultyId, startDate, endDate, reasonCode, notes = null, actorFirebaseUid, actorName = null, documentId = null }) {
      check({ facultyId, startDate, endDate, reasonCode, notes });
      const row = { afcRecordId, facultyId, startDate, endDate, reasonCode, reason: AFC_REASONS[reasonCode], purpose: '', notes: notes || '', legacyPurpose: AFC_REASONS[reasonCode], active: true, sourceKind: 'manual', createdAtUtc: store.nowIso(), createdByName: actorName || '', recordKey: `AFC-M-${afcRecordId.slice(0, 8)}`, versionToken: afcRecordId.replace(/-/g, '').slice(0, 16).toUpperCase(), documentId };
      t().afcRecords.unshift(row);
      store.audit({ domain: 'afc', changeType: 'afc_record_created', facultyId, actorFirebaseUid, actorName, after: clone(row) });
      store.commit();
      return afcView(store, row);
    },
    async createAfcManualBatch({ requestId, rows, actorFirebaseUid, actorName = null }) {
      const done = store.bag('afcBatches', () => ({}));
      if (done[requestId]) return { status: 'ALREADY_APPLIED', rows: done[requestId] };
      const created = [];
      for (const input of rows) {
        check({ facultyId: input.facultyId, startDate: input.startDate, endDate: input.endDate });
        const afcRecordId = require('../ids.js').uuidFor(`afc:batch:${requestId}:${input.rowIndex}`);
        t().afcRecords.unshift({ afcRecordId, facultyId: input.facultyId, startDate: input.startDate, endDate: input.endDate, reasonCode: '', reason: input.purpose, purpose: input.purpose, notes: '', legacyPurpose: input.purpose, active: true, sourceKind: 'manual', createdAtUtc: store.nowIso(), createdByName: actorName || '', recordKey: `AFC-B-${afcRecordId.slice(0, 8)}`, versionToken: afcRecordId.replace(/-/g, '').slice(0, 16).toUpperCase(), documentId: null });
        created.push({ rowIndex: input.rowIndex, afcRecordId, facultyId: input.facultyId, startDate: input.startDate, endDate: input.endDate, purpose: input.purpose, status: 'CREATED' });
      }
      done[requestId] = created;
      store.audit({ domain: 'afc', changeType: 'afc_batch_created', actorFirebaseUid, actorName, after: created });
      store.commit();
      return { status: 'CREATED', rows: created };
    },
    async updateAfcDates({ afcRecordId, sourceKind, expectedVersion, startDate, endDate, actorFirebaseUid }) {
      const actor = t().users.find(u => u.firebaseUid === actorFirebaseUid && u.active === true);
      if (!actor || !isAdministratorRole(actor.baseRole)) throw sqlError(56402, 'Administrator permission required');
      const row = t().afcRecords.find(r => r.afcRecordId === afcRecordId && r.sourceKind === sourceKind);
      if (!row) throw sqlError(56403, 'Record not found');
      if (row.active === false) throw sqlError(56406, 'Withdrawn record cannot be edited');
      if (versionOf(row) !== String(expectedVersion || '').toUpperCase()) throw sqlError(56404, 'Version conflict');
      if (row.startDate === startDate && row.endDate === endDate) throw sqlError(56408, 'Unchanged dates');
      const days = dateRange(startDate, endDate);
      const before = clone(row);
      row.startDate = startDate;
      row.endDate = endDate;
      row.workDays = days;
      row.versionToken = bumpVersion(versionOf(row));
      store.audit({ domain: 'afc', changeType: 'afc_dates_changed', afcRecordId, facultyId: row.facultyId,
        actorFirebaseUid, before: { startDate: before.startDate, endDate: before.endDate },
        after: { startDate, endDate, workDays: days } });
      store.commit();
      return afcView(store, row);
    },
    async cancelAfcRecord({ afcRecordId, sourceKind, expectedVersion, actorFirebaseUid, actorName = null }) {
      const row = t().afcRecords.find(item => item.afcRecordId === afcRecordId && item.sourceKind === sourceKind);
      if (!row) throw sqlError(53603, 'Not found');
      if (expectedVersion && expectedVersion.toUpperCase() !== row.versionToken.toUpperCase()) throw sqlError(53604, 'Changed');
      row.active = false;
      row.versionToken = (parseInt(row.versionToken.slice(-8), 16) + 1).toString(16).toUpperCase().padStart(16, '0');
      store.audit({ domain: 'afc', changeType: 'afc_record_cancelled', facultyId: row.facultyId, actorFirebaseUid, actorName, after: clone(row) });
      store.commit();
      return afcView(store, row);
    }
  };
}

module.exports = { createFacultyAdminRepository, createAfcWriteRepository, AFC_REASONS };
