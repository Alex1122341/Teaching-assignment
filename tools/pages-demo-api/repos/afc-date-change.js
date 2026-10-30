'use strict';
// Frontend Demo only: browser-local AFC date changes. No Firestore/SQL writes.
const { uuidFor } = require('../ids.js');
const { sqlError } = require('./core.js');
const { workDays } = require('../../../server/src/afc/afc-policy.js');

const INITIAL_VERSION = '0000000000000001';
const VALID_VERSION = /^[0-9a-f]{16}$/i;
const strictDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T12:00:00.000Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const versionOf = row => VALID_VERSION.test(row?.versionToken || '') ? String(row.versionToken).toUpperCase() : INITIAL_VERSION;
const bumpVersion = version => (BigInt('0x' + versionOf({ versionToken: version })) + 1n).toString(16).toUpperCase().padStart(16, '0');
const dateRange = (startDate, endDate) => {
  if (!strictDate(startDate) || !strictDate(endDate) || endDate < startDate) throw sqlError(56405, 'Invalid date range');
  const days = workDays(startDate, endDate);
  if (!Number.isInteger(days) || days < 1) throw sqlError(56405, 'Dates must contain at least one workday');
  return days;
};
const teachingSessions = (store, facultyId, startDate, endDate) => store.tables.sessions
  .filter(s => s.date >= startDate && s.date <= endDate && s.assignments?.some(a => a.facultyId === facultyId))
  .map(s => ({ sessionId: s.id, courseCode: s.courseCode, date: s.date, startTime: s.startTime, endTime: s.endTime, sessionType: s.sessionType, topic: s.topic }));
function requireCoverage(store, facultyId, startDate, endDate, coverage) {
  const sessions = teachingSessions(store, facultyId, startDate, endDate);
  if (sessions.length && !String(coverage || '').trim()) throw sqlError(51505, 'Coverage is required for scheduled teaching');
  return sessions;
}
function requestRecordId(q) { return uuidFor('afc-from-request:' + q.afcRequestId); }
function findApprovedRecord(store, q) {
  return store.tables.afcRecords.find(r => r.afcRequestId === q.afcRequestId || r.afcRecordId === requestRecordId(q)) || null;
}
function ensureApprovedRecord(store, q) {
  let row = findApprovedRecord(store, q);
  if (row) return row;
  const vacation = q.reason === 'vacation';
  row = { afcRecordId: requestRecordId(q), afcRequestId: q.afcRequestId, facultyId: q.facultyId,
    startDate: q.startDate, endDate: q.endDate, reasonCode: vacation ? 'vacation' : 'university_travel',
    reason: vacation ? 'Vacation' : 'University Travel', purpose: q.purposeDestination || '',
    notes: 'Approved AFC request', legacyPurpose: q.purposeDestination || (vacation ? 'Vacation' : 'University Travel'),
    active: true, sourceKind: 'manual', createdAtUtc: q.approvedAtUtc || store.nowIso(),
    createdByName: 'AFC approval', recordKey: 'AFC-R-' + q.afcRequestId.slice(0, 8),
    versionToken: versionOf(q), documentId: null };
  store.tables.afcRecords.unshift(row);
  return row;
}
module.exports = { strictDate, dateRange, versionOf, bumpVersion, teachingSessions, requireCoverage, ensureApprovedRecord };
