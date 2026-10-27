'use strict';
// CCC schedule, leadership directory, working activities, availability,
// scheduling tasks and CCC replacement for the Frontend Demo.
const { isAdministratorRole } = require('../../../server/src/auth/role-policy.js');
const { sha256Hex, uuidFor } = require('../ids.js');
const { clone, sqlError, facultyName } = require('./core.js');

const profileOf = (store, uid) => store.tables.users.find(u => u.firebaseUid === uid) || {};
const todayIso = store => store.now().toISOString().slice(0, 10);
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
const hhmm = value => value ? String(value).slice(0, 5) : null;
const unavailableInDemo = () => { throw Object.assign(new Error('Workbook imports run on the PAWS server and are not available in the Frontend Demo.'), { code: 'APPROVED_SOURCE_REQUIRED' }); };

function createCccScheduleRepository(store) {
  return {
    async list({ academicYear }) {
      const entries = store.tables.activities.filter(a => a.category === 'ccc' && a.academicYear === academicYear)
        .map(a => ({ date: a.startDate, endDate: a.endDate, blockLabel: a.blockLabel, courseCode: a.courseCode, facultyName: a.staffingKind === 'unassigned' ? 'Locum' : a.facultyDisplayName, halfDay: true }));
      return { entries };
    }
  };
}

function createLeadershipDirectoryRepository(store) {
  return {
    async list({ academicYear }) {
      const faculty = new Map(store.tables.faculty.map(f => [f.facultyId, f]));
      return store.tables.roles.filter(r => r.academicYear === academicYear && ['HICC', 'Course Coordinator', 'VISC'].includes(r.roleType) && faculty.get(r.facultyId)?.active)
        .map(r => { const f = faculty.get(r.facultyId); const course = store.tables.courses.find(c => c.catalogLabel === r.courseOrSubjectOrRotation); return { roleType: r.roleType, recordedScope: r.courseOrSubjectOrRotation || null, courseCode: course ? course.courseCode : null, facultyName: f.displayName, facultyFirstName: f.preferredFirstName, facultyLastName: f.preferredLastName, facultyKey: f.facultyId, appointmentKey: r.roleAssignmentId, effectiveDate: r.effectiveDate || null, expirationDate: r.expirationDate || null, hasSchedule: r.validityPeriods ? 1 : 0, periodsJson: r.validityPeriods ? JSON.stringify(r.validityPeriods) : null }; });
    }
  };
}

function createCalendarActivityRepository(store) {
  const publicRow = a => ({ activityId: a.activityId, facultyKey: a.facultyKey, facultyDisplayName: a.facultyDisplayName, category: a.category, label: a.label, startDate: a.startDate, endDate: a.endDate, courseCode: a.courseCode, timeStatus: a.timeStatus, version: a.version, staffingKind: a.staffingKind, staffingLabel: a.staffingLabel, blockLabel: a.blockLabel, timeEvidence: clone(a.timeEvidence || []) });
  return {
    async list({ actorFirebaseUid, start, end, facultyKey = null, category = null, cursor = null, limit = 100, includeFacultyKeys = false }) {
      const profile = profileOf(store, actorFirebaseUid);
      const admin = isAdministratorRole(profile.baseRole);
      const rows = store.tables.activities
        .filter(a => a.startDate < end && a.endDate >= start)
        .filter(a => !facultyKey || a.facultyKey === facultyKey)
        .filter(a => !category || a.category === category)
        .filter(a => admin || a.category === 'ccc' || a.category === 'rotation_participant' || a.facultyKey === profile.facultyId)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.activityId.localeCompare(b.activityId));
      const offset = Number(cursor || 0) || 0, page = rows.slice(offset, offset + limit);
      const next = offset + page.length < rows.length ? String(offset + page.length) : null;
      const result = { activities: page.map(publicRow), nextCursor: next };
      if (includeFacultyKeys) result.facultyKeys = [...new Set(rows.map(a => a.facultyKey).filter(Boolean))].map(id => ({ facultyId: id, facultyKey: id }));
      return result;
    },
    async resolveTime({ activityId, expectedVersion, date, startTime, endTime, actorFirebaseUid }) {
      const a = store.tables.activities.find(x => x.activityId === activityId);
      if (!a) throw sqlError(53803, 'Not found');
      if (a.version !== expectedVersion) throw sqlError(53804, 'Changed');
      a.timeEvidence = (a.timeEvidence || []).filter(e => e.date !== date).concat([{ date, startTime, endTime }]);
      a.timeStatus = 'verified';
      a.version = (parseInt(a.version, 16) + 1).toString(16).padStart(16, '0');
      store.audit({ domain: 'working_schedule', changeType: 'activity_time_resolved', facultyId: a.facultyKey, actorFirebaseUid, after: { activityId, date, startTime, endTime } });
      store.commit();
      return publicRow(a);
    },
    stage: unavailableInDemo, preview: unavailableInDemo, getImport: unavailableInDemo, commit: unavailableInDemo
  };
}

function createCccReplacementRepository() {
  return { stage: unavailableInDemo, stageTrustedMaster: unavailableInDemo, get: unavailableInDemo, preview: unavailableInDemo, recover: unavailableInDemo, commit: unavailableInDemo };
}

function createFacultyAvailabilityRepository(store) {
  return {
    async list({ actorFirebaseUid, facultyId, mode, startDate, endDate, kind, cursor, limit }) {
      const t = store.tables, profile = profileOf(store, actorFirebaseUid);
      const own = profile.facultyId === facultyId, privileged = isAdministratorRole(profile.baseRole) || own;
      const from = mode === 'upcoming' ? todayIso(store) : startDate, to = mode === 'range' ? endDate : '2099-12-31';
      const items = [];
      for (const s of t.sessions) {
        if (!s.assignments.some(a => a.facultyId === facultyId) || s.date < from || s.date > to) continue;
        items.push({ eventKey: `session:${s.id}`, kind: 'teaching', label: privileged ? `${s.courseCode} · ${s.sessionType} · ${s.topic}` : 'Teaching', startDate: s.date, endDate: s.date, startTime: hhmm(s.startTime), endTime: hhmm(s.endTime), availability: s.startTime ? 'busy' : 'time_unconfirmed', timeStatus: s.startTime ? 'verified' : 'unconfirmed', courseCode: privileged ? s.courseCode : null, sessionId: privileged ? s.id : null, detail: privileged ? s.room : null });
      }
      for (const a of t.activities) {
        if (a.facultyKey !== facultyId || a.endDate < from || a.startDate > to) continue;
        items.push({ eventKey: `activity:${a.activityId}`, kind: 'work', label: privileged ? a.label : 'Working activity', startDate: a.startDate, endDate: a.endDate, startTime: a.timeEvidence[0]?.startTime || null, endTime: a.timeEvidence[0]?.endTime || null, availability: a.category === 'teaching_excellence' ? 'informational' : a.timeEvidence.length ? 'busy' : 'time_unconfirmed', timeStatus: a.timeStatus, courseCode: privileged ? a.courseCode : null, sessionId: null, detail: privileged ? a.blockLabel : null, timeEvidence: a.timeEvidence });
      }
      for (const r of t.afcRecords) {
        if (r.facultyId !== facultyId || !r.active || r.endDate < from || r.startDate > to) continue;
        items.push({ eventKey: `afc:${r.afcRecordId}`, kind: 'afc', label: privileged ? `AFC · ${r.reason}` : 'Away', startDate: r.startDate, endDate: r.endDate, startTime: null, endTime: null, availability: 'away', timeStatus: 'all_day', courseCode: null, sessionId: null, detail: privileged ? r.notes || null : null });
      }
      for (const q of (store.tables.extra.afcRequests || [])) {
        if (q.facultyId !== facultyId || !['pending_report_to', 'pending_admin'].includes(q.status) || q.endDate < from || q.startDate > to) continue;
        items.push({ eventKey: `pending:${q.afcRequestId}`, kind: 'pending', label: privileged ? 'Pending AFC request' : 'Tentative', startDate: q.startDate, endDate: q.endDate, startTime: null, endTime: null, availability: 'tentative', timeStatus: 'all_day', courseCode: null, sessionId: null, detail: null });
      }
      for (const r of t.roles) {
        if (r.facultyId !== facultyId || (r.expirationDate && r.expirationDate < from)) continue;
        items.push({ eventKey: `role:${r.roleAssignmentId}`, kind: 'role', label: privileged ? `${r.roleType} · ${r.courseOrSubjectOrRotation}` : 'Ongoing responsibility', startDate: r.effectiveDate || null, endDate: r.expirationDate || null, startTime: null, endTime: null, availability: 'ongoing', timeStatus: 'not_applicable', courseCode: null, sessionId: null, detail: null });
      }
      const filtered = items.filter(i => kind === 'all' || i.kind === kind).sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')) || a.eventKey.localeCompare(b.eventKey));
      const offset = Number(cursor || 0), page = filtered.slice(offset, offset + limit);
      return { items: page, total: filtered.length, nextCursor: offset + page.length < filtered.length ? String(offset + page.length) : null, today: todayIso(store), coverage: { undatedSessions: t.sessions.filter(s => !s.startTime && s.assignments.some(a => a.facultyId === facultyId)).length, undatedRoles: t.roles.filter(r => r.facultyId === facultyId && !r.effectiveDate).length } };
    }
  };
}

// Scheduling tasks are derived from the timetable on every read, like the
// server procedure, with review state kept per issue.
function detectTasks(store, academicYear) {
  const t = store.tables, tasks = [];
  const add = (type, severity, session, facultyId, related = []) => {
    const issueKey = sha256Hex(`${type}|${session.id}|${facultyId || ''}|${related.map(r => r.id).join(',')}`);
    tasks.push({ issueKey, facultyKey: facultyId, displayName: facultyId ? facultyName(store, facultyId) : null, courseCode: session.courseCode, sessionId: session.id, date: session.date, startTime: hhmm(session.startTime), endTime: hhmm(session.endTime), type, severity, evidenceVersion: sha256Hex(`${issueKey}|${session.updatedAtUtc}`), relatedSessions: related.map(r => ({ id: r.id, courseCode: r.courseCode, date: r.date, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) })) });
  };
  const sessions = t.sessions.filter(s => s.academicYear === academicYear);
  const byFacultyDate = new Map();
  for (const s of sessions) {
    if (!s.startTime || !s.endTime) { add('calendar_time_unknown', 'Needs Review', s, s.assignments[0]?.facultyId || null); continue; }
    if (s.endTime <= s.startTime) add('invalid_schedule', 'Conflict', s, null);
    for (const a of s.assignments) {
      const key = `${a.facultyId}|${s.date}`;
      if (!byFacultyDate.has(key)) byFacultyDate.set(key, []);
      byFacultyDate.get(key).push(s);
      const afc = t.afcRecords.find(r => r.facultyId === a.facultyId && r.active && r.startDate <= s.date && r.endDate >= s.date);
      if (afc) add('afc_unavailable', 'Conflict', s, a.facultyId);
      const act = t.activities.find(x => x.facultyKey === a.facultyId && x.startDate <= s.date && x.endDate >= s.date && (x.timeEvidence || []).some(e => e.date === s.date && overlaps(e.startTime, e.endTime, hhmm(s.startTime), hhmm(s.endTime))));
      if (act) add('calendar_activity_overlap', 'Conflict', s, a.facultyId);
    }
  }
  for (const [key, list] of byFacultyDate) {
    const facultyId = key.split('|')[0];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlaps(list[i].startTime, list[i].endTime, list[j].startTime, list[j].endTime)) add('instructor_overlap', 'Conflict', list[i], facultyId, [list[j]]);
  }
  return tasks;
}

function createSchedulingTaskRepository(store) {
  const reviews = () => store.bag('taskReviews', () => ({}));
  const decorate = (task, admin) => { const r = reviews()[task.issueKey]; return { ...task, reviewStatus: r ? r.status : 'Unreviewed', reviewVersion: (r ? r.version : 1).toString(16).padStart(16, '0'), canReview: admin }; };
  return {
    async list({ actorFirebaseUid, query }) {
      const profile = profileOf(store, actorFirebaseUid), admin = isAdministratorRole(profile.baseRole);
      let tasks = detectTasks(store, query.academicYear).map(task => decorate(task, admin));
      if (!admin) tasks = tasks.filter(task => task.facultyKey && task.facultyKey === profile.facultyId);
      const facets = { faculty: [...new Map(tasks.filter(x => x.facultyKey).map(x => [x.facultyKey, { facultyKey: x.facultyKey, displayName: x.displayName }])).values()], courses: [...new Set(tasks.map(x => x.courseCode))].sort().map(courseCode => ({ courseCode })) };
      const filtered = tasks
        .filter(x => !query.start || (x.date >= query.start && x.date < query.end))
        .filter(x => query.undated === 'only' ? !x.startTime : query.undated === 'exclude' ? Boolean(x.startTime) : true)
        .filter(x => !query.facultyKey || x.facultyKey === query.facultyKey)
        .filter(x => !query.courseCode || x.courseCode === query.courseCode)
        .filter(x => !query.type || x.type === query.type)
        .filter(x => !query.reviewStatus || x.reviewStatus === query.reviewStatus)
        .sort((a, b) => a.date.localeCompare(b.date) || a.issueKey.localeCompare(b.issueKey));
      const snapshotVersion = sha256Hex(JSON.stringify(filtered.map(x => x.issueKey + x.reviewStatus)));
      const offset = query.cursor ? Number(query.cursor.split(':')[1]) : 0;
      const page = filtered.slice(offset, offset + (query.limit || 50));
      return { tasks: page, total: filtered.length, snapshotVersion, nextCursor: offset + page.length < filtered.length ? `${snapshotVersion}:${offset + page.length}` : null, academicYears: [{ academicYear: store.tables.academicYear }], filters: facets, capabilities: { canReview: admin } };
    },
    async review({ actorFirebaseUid, issueKey, academicYear, expectedEvidenceVersion, expectedReviewVersion, reviewStatus }) {
      const task = detectTasks(store, academicYear).find(x => x.issueKey === issueKey);
      if (!task) throw sqlError(53903, 'Task not found');
      const current = reviews()[issueKey] || { status: 'Unreviewed', version: 1 };
      if (task.evidenceVersion !== expectedEvidenceVersion || current.version.toString(16).padStart(16, '0') !== expectedReviewVersion) throw sqlError(53904, 'Changed');
      reviews()[issueKey] = { status: reviewStatus, version: current.version + 1, by: actorFirebaseUid };
      store.commit();
      return decorate(task, true);
    }
  };
}

module.exports = { createCccScheduleRepository, createLeadershipDirectoryRepository, createCalendarActivityRepository, createCccReplacementRepository, createFacultyAvailabilityRepository, createSchedulingTaskRepository, detectTasks };
