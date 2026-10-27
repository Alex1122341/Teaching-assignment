'use strict';
// Change history for the Frontend Demo. Every change a tester makes is recorded
// by the store; this maps those records to the event rows that
// paws_api.ListChangeHistoryEvents returns, so the real projection applies the
// same privacy and domain rules as Beta. A few historical events are seeded.
const { uuidFor } = require('../ids.js');

const MAP = {
  session_updated: ['timetable', 'session_updated', 'session'], session_created: ['timetable', 'session_created', 'session'],
  assignments_replaced: ['timetable', 'session_assignments_replaced', 'session'], swap_applied: ['timetable', 'swap_applied', 'session'],
  faculty_updated: ['lookup', 'FacultyUpdated', 'faculty'], faculty_deactivated: ['lookup', 'FacultyDeactivated', 'faculty'], faculty_restored: ['lookup', 'FacultyRestored', 'faculty'],
  role_periods_updated: ['lookup', 'role_periods_updated', 'role_assignment'],
  afc_record_created: ['afc', 'afc_record_created', 'afc_record'], afc_batch_created: ['afc', 'afc_record_created', 'afc_record'], afc_record_cancelled: ['afc', 'afc_record_cancelled', 'afc_record'],
  afc_request_submitted: ['afc', 'afc_request_submitted', 'afc_request'], afc_request_withdrawn: ['afc', 'afc_request_withdrawn', 'afc_request'], afc_request_recommended: ['afc', 'afc_request_recommended', 'afc_request'], afc_request_approved: ['afc', 'afc_request_approved', 'afc_request'], afc_request_rejected: ['afc', 'afc_request_rejected', 'afc_request'],
  activity_time_resolved: ['work', 'calendar_activity_time_resolved', 'calendar_activity'],
  faculty_doe_override_saved: ['doe', 'faculty_doe_override_saved', 'faculty_doe_target'], faculty_doe_override_cleared: ['doe', 'faculty_doe_override_cleared', 'faculty_doe_target'],
  manual_doe_saved: ['doe', 'manual_doe_saved', 'manual_doe_assignment'], manual_doe_deactivated: ['doe', 'manual_doe_deactivated', 'manual_doe_assignment']
};

function seeded(store) {
  return store.bag('historySeed', () => {
    const t = store.tables, out = [];
    t.sessions.filter(s => s.date >= '2026-10-01' && s.date <= '2026-10-30').slice(0, 6).forEach((s, i) => {
      const before = { ...s, room: 'HSB 1401', assignments: undefined }, after = { ...s, assignments: undefined };
      out.push({ changeId: uuidFor(`hist:s:${i}`), changedAtUtc: `2026-10-${String(5 + i * 3).padStart(2, '0')}T16:${10 + i}:00.000Z`, domain: 'teaching', changeType: 'session_updated', sessionId: s.id, facultyId: s.assignments[0]?.facultyId || null, actorFirebaseUid: 'uid-adfa-general', actorName: 'ADFA General', before, after });
    });
    t.afcRecords.filter(r => r.sourceKind === 'manual').slice(0, 3).forEach((r, i) => out.push({ changeId: uuidFor(`hist:a:${i}`), changedAtUtc: `2026-10-${String(8 + i * 4).padStart(2, '0')}T15:00:00.000Z`, domain: 'afc', changeType: 'afc_record_created', facultyId: r.facultyId, actorFirebaseUid: 'uid-adfa-general', actorName: 'ADFA General', before: null, after: { ...r } }));
    return out;
  });
}

function toEvent(store, h) {
  const map = MAP[h.changeType];
  if (!map) return null;
  const [source, eventType, entityType] = map;
  const before = h.before ? { ...h.before } : null, after = h.after ? { ...h.after } : null;
  const context = { facultyId: h.facultyId || null, academicYear: store.tables.academicYear, ...(h.sessionId ? { sessionId: h.sessionId } : {}) };
  const entityId = entityType === 'faculty' ? h.facultyId : h.sessionId || h.roleAssignmentId || (after && (after.afcRecordId || after.afcRequestId || after.activityId)) || h.changeId;
  const actor = store.tables.users.find(u => u.firebaseUid === h.actorFirebaseUid);
  return { eventId: h.changeId, source, eventType, entityType, entityId, facultyId: h.facultyId || null, actorName: h.actorName || (actor ? actor.displayName : 'PAWS user'), occurredAtUtc: h.changedAtUtc, beforeJson: before ? JSON.stringify(before) : null, afterJson: after ? JSON.stringify(after) : null, contextJson: JSON.stringify(context), metadataJson: JSON.stringify({ facultyId: h.facultyId || null }), directoryFacultyJson: JSON.stringify(store.tables.faculty.filter(f => f.facultyId === h.facultyId).map(f => ({ facultyId: f.facultyId, displayName: f.displayName }))), academicYear: store.tables.academicYear };
}

function createChangeHistoryRepository(store) {
  return {
    async list({ scope, start, end, startUtc, endUtc }) {
      const from = scope === 'dashboard' ? startUtc : `${start}T00:00:00.000Z`, to = scope === 'dashboard' ? endUtc : `${end}T00:00:00.000Z`;
      return [...(store.tables.history || []), ...seeded(store)].filter(h => h.changedAtUtc >= from && h.changedAtUtc < to).map(h => toEvent(store, h)).filter(Boolean).sort((a, b) => b.occurredAtUtc.localeCompare(a.occurredAtUtc));
    }
  };
}
module.exports = { createChangeHistoryRepository };
