'use strict';
// In-memory equivalents of the SQL repositories behind sign-in, the Timetable
// and the Faculty Dashboard. Each method returns the same shape as its SQL
// counterpart in server/src/data so the real API code runs unchanged.
const { resolveAcademicYear } = require('../../../server/src/data/academic-year.js');
const { resolveTeachingDoe, resolveRoleDoe } = require('../../../server/src/domain/doe-calculator.js');
const { DOE_RULES } = require('../../../server/src/domain/doe-rule-book.js');
const { uuidFor } = require('../ids.js');

const GRID_START = '07:30:00';
const clone = value => JSON.parse(JSON.stringify(value));
const like = (value, search) => String(value || '').toLowerCase().includes(String(search || '').trim().toLowerCase());
const sqlError = (number, message) => Object.assign(new Error(message), { number });
const facultyName = (store, id) => (store.tables.faculty.find(row => row.facultyId === id) || {}).displayName || '';

function checkNeeded(session) {
  const start = session.startTime, end = session.endTime;
  if (!start || !end) return true;
  if (start < GRID_START) return true;
  return end <= start;
}

function sessionView(store, session, { includeAssignmentTargets = false, includeUnresolvedAssignmentLabels = false } = {}) {
  const names = session.assignments.map(row => facultyName(store, row.facultyId) || row.sourceFacultyName).filter(Boolean);
  const out = {
    id: session.id, academicYear: session.academicYear, curriculumYear: session.curriculumYear,
    courseCode: session.courseCode, courseName: session.courseName, topic: session.topic,
    sessionType: session.sessionType, date: session.date, startTime: session.startTime, endTime: session.endTime,
    room: session.room, instructorNames: names.join('; ')
  };
  if (includeAssignmentTargets) {
    const rows = session.assignments.filter(row => includeUnresolvedAssignmentLabels || row.facultyId);
    out.assignmentsJson = JSON.stringify(rows.map(row => {
      const f = store.tables.faculty.find(item => item.facultyId === row.facultyId);
      return { facultyId: row.facultyId, teachingRole: row.teachingRole, displayName: f ? f.displayName : null, ...(includeUnresolvedAssignmentLabels ? { sourceFacultyName: row.sourceFacultyName } : {}), active: f ? f.active : null };
    }));
    out.unresolvedAssignmentCount = session.assignments.filter(row => !row.facultyId).length;
  } else {
    out.assignmentsJson = '[]';
    out.unresolvedAssignmentCount = 0;
  }
  return out;
}

function createUserRepository(store) {
  return { async findByUid(uid) { const row = store.tables.users.find(user => user.firebaseUid === uid); return row ? clone(row) : null; } };
}

function createSessionRepository(store) {
  const t = () => store.tables;
  const find = id => t().sessions.find(row => row.id === id);
  const academicYearOk = (year, date) => { const m = /^(\d{4})-(\d{2})$/.exec(year || ''); return m && date >= `${m[1]}-05-01` && date < `${Number(m[1]) + 1}-05-01`; };
  const course = code => t().courses.find(row => row.courseCode.toUpperCase() === String(code || '').trim().toUpperCase());
  function recordSessionChange(sessionId, action, before, after, actorFirebaseUid, actorName) {
    store.audit({ domain: 'teaching', changeType: action, sessionId, actorFirebaseUid, actorName, before, after });
  }
  function buildAssignments(sessionId, sessionType, startTime, endTime, assignments) {
    return (assignments || []).map((row, index) => {
      const hours = startTime && endTime ? Math.round(((Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5))) - (Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5)))) / 6) / 10 : null;
      const resolved = resolveTeachingDoe({ sessionType, teachingRole: row.teachingRole, creditedHours: hours });
      if (!t().faculty.some(f => f.facultyId === row.facultyId && f.active)) throw sqlError(51254, 'Faculty invalid');
      return { sessionAssignmentId: uuidFor(`assignment:${sessionId}:${row.facultyId}:${index}:${Date.now()}`), facultyId: row.facultyId, teachingRole: row.teachingRole || null, labLead: row.teachingRole === 'Lab Primary' ? 'Yes' : '', creditedHours: hours, doeRate: resolved.rate ?? null, doeQuantity: hours, doeUnit: 'credited hour', doeCredit: resolved.calculatedDoe ?? null, doeStatus: resolved.calculatedDoe == null ? 'needs_review' : 'calculated', sourceFacultyName: facultyName(store, row.facultyId) };
    });
  }
  const repo = {
    async list({ start = null, end = null, facultyId = null, academicYear = null, includeAssignmentTargets = false, includeUnresolvedAssignmentLabels = false } = {}) {
      return t().sessions
        .filter(row => academicYear === null || row.academicYear === academicYear)
        .filter(row => !(start && end) || (row.date >= start && row.date < end))
        .filter(row => !facultyId || row.assignments.some(a => a.facultyId === facultyId))
        .map(row => sessionView(store, row, { includeAssignmentTargets, includeUnresolvedAssignmentLabels }));
    },
    async updateExisting({ sessionId, patch, actorFirebaseUid, actorName = null } = {}) {
      const session = find(sessionId);
      if (!session) return null;
      if (patch.courseCode !== undefined && !course(patch.courseCode)) throw sqlError(51243, 'Course not found');
      if (patch.date !== undefined && !academicYearOk(session.academicYear, patch.date)) throw sqlError(51245, 'Date outside year');
      const before = clone(session);
      for (const key of Object.keys(patch)) session[key] = patch[key];
      if (patch.courseCode !== undefined) { const c = course(patch.courseCode); session.courseCode = c.courseCode; session.courseName = c.courseName; }
      session.updatedAtUtc = store.nowIso();
      recordSessionChange(sessionId, 'session_updated', before, clone(session), actorFirebaseUid, actorName);
      store.commit();
      return sessionView(store, session, { includeAssignmentTargets: true });
    },
    async createNew({ session, actorFirebaseUid, actorName = null } = {}) {
      const c = course(session.courseCode);
      if (!c) throw sqlError(51251, 'Course not found');
      const id = uuidFor(`session:new:${session.courseCode}:${session.date}:${session.startTime}:${Date.now()}:${Math.random()}`);
      const row = { id, academicYear: session.academicYear, curriculumYear: String(session.curriculumYear), courseCode: c.courseCode, courseName: c.courseName, topic: session.topic, sessionType: session.sessionType, date: session.date, startTime: session.startTime.length === 5 ? session.startTime + ':00' : session.startTime, endTime: session.endTime.length === 5 ? session.endTime + ':00' : session.endTime, room: session.room || null, updatedAtUtc: store.nowIso(), assignments: [] };
      row.assignments = buildAssignments(id, row.sessionType, row.startTime, row.endTime, session.assignments);
      t().sessions.push(row);
      recordSessionChange(id, 'session_created', null, clone(row), actorFirebaseUid, actorName);
      store.commit();
      return sessionView(store, row, { includeAssignmentTargets: true });
    },
    async createBatch({ requestId, sessions, actorFirebaseUid, actorName = null } = {}) {
      const done = store.bag('sessionBatches', () => ({}));
      if (done[requestId]) return done[requestId].map(row => ({ ...row, idempotentReplay: true }));
      const created = [];
      for (const session of sessions) created.push(await repo.createNew({ session, actorFirebaseUid, actorName }));
      done[requestId] = created;
      store.commit();
      return created;
    },
    async replaceAssignments({ sessionId, assignments, actorFirebaseUid, actorName = null } = {}) {
      const session = find(sessionId);
      if (!session) return null;
      const before = clone(session.assignments);
      session.assignments = buildAssignments(sessionId, session.sessionType, session.startTime, session.endTime, assignments);
      recordSessionChange(sessionId, 'assignments_replaced', before, clone(session.assignments), actorFirebaseUid, actorName);
      store.commit();
      return sessionView(store, session, { includeAssignmentTargets: true });
    }
  };
  return repo;
}

function teachingAssignmentsFor(store, facultyId, year) {
  const rows = [];
  for (const session of store.tables.sessions) {
    if (session.academicYear !== year) continue;
    for (const a of session.assignments) {
      if (a.facultyId !== facultyId) continue;
      const base = { sessionAssignmentId: a.sessionAssignmentId, sessionId: session.id, academicYear: session.academicYear, curriculumYear: session.curriculumYear, courseCode: session.courseCode, courseName: session.courseName, topic: session.topic, sessionType: session.sessionType, date: session.date, startTime: session.startTime || '', endTime: session.endTime || '', room: session.room || '', teachingRole: a.teachingRole || '', labLead: a.labLead || '', creditedHours: a.creditedHours, doeRate: a.doeRate, doeQuantity: a.doeQuantity, doeUnit: a.doeUnit || '', doeCredit: a.doeCredit, doeStatus: a.doeStatus || '' };
      const doe = resolveTeachingDoe(base);
      rows.push({ ...base, doeApplicable: doe.applicable, calculatedDoeCredit: doe.calculatedDoe ?? null, effectiveDoeCredit: doe.effectiveDoe ?? null, doeCalculationStatus: doe.status, doeReviewReason: doe.reviewReason ?? null, doeRuleCode: doe.ruleCode || null, doeCalculatorSource: doe.calculatorSource || null, doeSource: doe.source });
    }
  }
  return rows.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

function roleView(role) {
  const doe = role.facultyResolutionStatus === 'manual_adjustment'
    ? { calculatedDoe: null, effectiveDoe: role.doeMappedValue, status: 'manual', source: 'manual_adjustment' }
    : resolveRoleDoe(role);
  return {
    roleAssignmentId: role.roleAssignmentId, validityPeriods: role.validityPeriods || null, scheduleVersion: role.scheduleVersion || '', facultyResolutionStatus: role.facultyResolutionStatus || '', academicYear: role.academicYear, roleCategory: role.roleCategory || '', roleType: role.roleType, courseOrSubjectOrRotation: role.courseOrSubjectOrRotation || '', courseName: role.courseName || '', details: role.details || '', effectiveDate: role.effectiveDate || '', expirationDate: role.expirationDate || '', sourceAllocationStatus: role.sourceAllocationStatus || '', doeMappedValue: role.doeMappedValue ?? null, doeOverrideValue: role.doeOverrideValue ?? null, doeOverrideReason: role.doeOverrideReason || '', specialNotes: role.specialNotes || '',
    calculatedDoe: doe.calculatedDoe ?? null, effectiveDoe: doe.effectiveDoe ?? null, doeCalculationStatus: doe.status, doeReviewReason: doe.reviewReason ?? null, doeRuleCode: doe.ruleCode || null, doeCalculatorSource: doe.calculatorSource || null, doeSource: doe.source, doeCandidates: doe.candidates || null, doeCandidateBasis: doe.candidateBasis || null, doeCourseUnits: doe.courseUnits ?? null, doeHiccDevelopmentApplicable: doe.hiccDevelopmentApplicable ?? null, doeCourseEvidenceSource: doe.courseEvidenceSource || null
  };
}

function afcView(store, row) {
  return { afcRecordId: row.afcRecordId, facultyId: row.facultyId, facultyName: facultyName(store, row.facultyId), startDate: row.startDate, endDate: row.endDate, reasonCode: row.reasonCode || '', purpose: row.purpose || '', reason: row.reason || '', notes: row.notes || '', legacyPurpose: row.legacyPurpose || '', active: row.active, sourceKind: row.sourceKind, createdAtUtc: row.createdAtUtc, createdByName: row.createdByName || '', recordKey: row.recordKey || '', versionToken: row.versionToken || '', documentId: row.documentId || null };
}

function manualRoleRows(store, year) {
  return (store.bag('manualDoe', () => []) || []).filter(row => row.academicYear === year && row.active).map(row => ({ facultyId: row.facultyId, roleAssignmentId: row.assignmentId, academicYear: year, roleCategory: 'Manual DOE adjustment', roleType: row.roleType, courseOrSubjectOrRotation: row.courseCode || row.subjectKey || row.scopeText || '', courseName: row.scopeText || '', details: 'Negotiated manual adjustment (additive)', effectiveDate: '', expirationDate: '', sourceAllocationStatus: '', doeMappedValue: row.doeValue, doeOverrideValue: null, doeOverrideReason: '', specialNotes: row.notes || '', facultyResolutionStatus: 'manual_adjustment', scheduleVersion: '', validityPeriods: null }));
}

function teachingTotals(store, facultyId, year) {
  const lines = teachingAssignmentsFor(store, facultyId, year);
  const credit = lines.filter(row => row.doeApplicable !== false);
  const recorded = credit.filter(row => row.doeCredit != null);
  return {
    lines, credit,
    recordedDoe: recorded.length ? recorded.reduce((sum, row) => sum + row.doeCredit, 0) : null,
    effectiveDoe: credit.some(row => row.effectiveDoeCredit != null) ? credit.reduce((sum, row) => sum + (row.effectiveDoeCredit || 0), 0) : (credit.length ? null : 0),
    recordedCount: recorded.length,
    calculatedCount: credit.filter(row => row.doeCredit == null && row.calculatedDoeCredit != null).length,
    missingCount: credit.filter(row => row.effectiveDoeCredit == null).length,
    notApplicableCount: lines.length - credit.length
  };
}

function createDashboardRepository(store) {
  const t = () => store.tables;
  const rolesFor = (year) => t().roles.filter(role => role.academicYear === year).concat(manualRoleRows(store, year));
  return {
    async reportFaculty() {
      return t().faculty.map(row => ({ facultyId: row.facultyId, preferredFirstName: row.preferredFirstName, preferredLastName: row.preferredLastName, displayName: row.displayName, rank: row.rank, stream: row.stream, fte: row.fte, active: row.active }));
    },
    async summary({ academicYear: year, facultyId = null } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      const sessions = t().sessions.filter(row => row.academicYear === resolvedYear && (!facultyId || row.assignments.some(a => a.facultyId === facultyId)));
      const roles = rolesFor(resolvedYear).filter(row => !facultyId || row.facultyId === facultyId);
      return {
        academicYear: resolvedYear,
        activeFacultyCount: t().faculty.filter(row => row.active).length,
        sessionCount: sessions.length,
        assignmentCount: sessions.reduce((sum, row) => sum + row.assignments.filter(a => !facultyId || a.facultyId === facultyId).length, 0),
        courseCount: new Set(sessions.map(row => row.courseCode)).size,
        roleAssignmentCount: roles.length,
        hiccCount: roles.filter(row => row.roleType === 'HICC').length,
        viscCount: roles.filter(row => row.roleType === 'VISC').length,
        afcRecordCount: t().afcRecords.filter(row => !facultyId || row.facultyId === facultyId).length,
        gridPositionableCount: sessions.filter(row => !checkNeeded(row)).length,
        checkNeededCount: sessions.filter(checkNeeded).length
      };
    },
    async faculty({ academicYear: year, search = null, limit = 500, facultyId = null, status = 'active' } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      if (!['active', 'inactive', 'all'].includes(status)) throw new Error('Invalid Faculty status filter');
      return t().faculty
        .filter(row => status === 'all' || (status === 'active' ? row.active : !row.active))
        .filter(row => !facultyId || row.facultyId === facultyId)
        .filter(row => !search || [row.displayName, row.storedDisplayName, row.email, row.ucid].some(v => like(v, search)))
        .sort((a, b) => a.preferredLastName.localeCompare(b.preferredLastName))
        .slice(0, limit || 500)
        .map(row => ({
          facultyId: row.facultyId, preferredFirstName: row.preferredFirstName, preferredLastName: row.preferredLastName, displayName: row.displayName, ucid: row.ucid, email: row.email, recordType: row.recordType, stream: row.stream, rank: row.rank, fte: row.fte, reportsToFacultyId: row.reportsToFacultyId || '', reportsToName: facultyName(store, row.reportsToFacultyId), active: row.active, updatedAtUtc: row.updatedAtUtc, teachingArea: row.profile.teachingArea, professionalCategory: row.profile.professionalCategory,
          sessionCount: t().sessions.filter(s => s.academicYear === resolvedYear && s.assignments.some(a => a.facultyId === row.facultyId)).length,
          roleCount: rolesFor(resolvedYear).filter(r => r.facultyId === row.facultyId).length,
          afcCount: t().afcRecords.filter(a => a.facultyId === row.facultyId).length,
          jointAppointmentCount: 0
        }));
    },
    async listAfcRecords({ search = null, reason = null, active, limit = 500 } = {}) {
      return t().afcRecords
        .filter(row => !search || [facultyName(store, row.facultyId), row.reason, row.legacyPurpose, row.notes].some(v => like(v, search)))
        .filter(row => !reason || row.reasonCode === reason || row.reason === reason)
        .filter(row => active !== true && active !== false ? true : row.active === active)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .slice(0, limit || 500)
        .map(row => afcView(store, row));
    },
    async facultyById({ facultyId, academicYear: year, includeInactive = false } = {}) {
      const record = t().faculty.find(row => row.facultyId === facultyId);
      if (!record || (!record.active && !includeInactive)) return null;
      const resolvedYear = resolveAcademicYear(year);
      const teachingAssignments = teachingAssignmentsFor(store, facultyId, resolvedYear);
      const target = t().targets.find(row => row.facultyId === facultyId && row.academicYear === resolvedYear);
      const profile = record.profile;
      return {
        faculty: { facultyId: record.facultyId, recordType: record.recordType, preferredFirstName: record.preferredFirstName, preferredLastName: record.preferredLastName, displayName: record.displayName, storedDisplayName: record.storedDisplayName, hrName: record.hrName, hrNameSource: 'Faculty Master List (synthetic)', ucid: record.ucid, email: record.email, stream: record.stream, rank: record.rank, fte: record.fte, fteSourceReference: 'Faculty Master List (synthetic)', fteSourceRow: null, fteSourceUpdatedAtUtc: null, reportsToFacultyId: record.reportsToFacultyId || '', reportsToName: facultyName(store, record.reportsToFacultyId), active: record.active, updatedAtUtc: record.updatedAtUtc, versionToken: record.versionToken },
        academicYear: resolvedYear,
        professionalProfile: { ...profile },
        jointAppointments: [],
        roles: rolesFor(resolvedYear).filter(row => row.facultyId === facultyId).map(roleView),
        afcRecords: t().afcRecords.filter(row => row.facultyId === facultyId).map(row => ({ ...afcView(store, row), purpose: row.legacyPurpose || row.reason })),
        contractDoe: { academicYear: resolvedYear, teachingDoe: target ? target.contractTeachingDoe : null, source: target ? target.source : '', policyVersionId: '', policyVersionLabel: '', sourceReference: target ? target.source : '', allocations: target ? [{ categoryCode: 'teaching', allocationDoe: target.contractTeachingDoe, sourceReference: target.source }] : [] },
        doeRuleBook: { academicYear: resolvedYear, policyVersionId: '', policyVersionLabel: 'UCVM Workload Guidelines (synthetic demo copy)', sourceReference: 'UCVM Workload Guidelines', rules: DOE_RULES.map(rule => ({ doeRuleId: rule.ruleCode, ruleCode: rule.ruleCode, category: rule.category || '', ruleLabel: rule.ruleLabel || '', academicYearOrStage: rule.academicYearOrStage || '', rateOrTierPct: rule.rateOrTierPct || '', basis: rule.basis || '', requiredInput: rule.requiredInput || '', calculationOrNote: rule.calculationOrNote || '', sourceReference: rule.sourceReference || '' })) },
        teachingAssignments,
        sessionCount: teachingAssignments.length,
        checkNeededCount: teachingAssignments.filter(row => checkNeeded(row)).length,
        linkedRecords: { activeUserProfileCount: t().users.filter(u => u.facultyId === facultyId && u.active).length, currentTeachingSessionCount: teachingAssignments.length, currentRoleCount: rolesFor(resolvedYear).filter(r => r.facultyId === facultyId).length, currentTeachingResponsibilityCount: 0 }
      };
    },
    async teachingSummary({ academicYear: year } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      return t().faculty.filter(row => row.active).map(member => {
        const teach = teachingTotals(store, member.facultyId, resolvedYear);
        const roles = rolesFor(resolvedYear).filter(row => row.facultyId === member.facultyId).map(roleView);
        const roleRecorded = roles.filter(row => row.doeOverrideValue != null || row.doeMappedValue != null);
        const roleCalculated = roles.filter(row => row.doeOverrideValue == null && row.doeMappedValue == null && row.effectiveDoe != null);
        const roleMissing = roles.filter(row => row.effectiveDoe == null);
        const roleDoe = roles.length ? (roles.some(r => r.effectiveDoe != null) ? roles.reduce((s, r) => s + (r.effectiveDoe || 0), 0) : null) : 0;
        const recordedRoleDoe = roleRecorded.length ? roleRecorded.reduce((s, r) => s + (r.doeOverrideValue ?? r.doeMappedValue), 0) : null;
        const lines = teach.lines;
        const sessions = new Set(lines.map(row => row.sessionId));
        const year = n => lines.filter(row => String(row.curriculumYear) === String(n)).length;
        const effectiveDoeTotal = teach.credit.length + roles.length === 0 ? 0 : (teach.effectiveDoe ?? 0) + (roleDoe ?? 0);
        return {
          facultyId: member.facultyId, displayName: member.displayName,
          recordedTeachingDoe: teach.recordedDoe, assignedTeachingDoe: teach.effectiveDoe,
          recordedRoleDoe, roleDoe,
          recordedDoeTotal: (teach.recordedDoe ?? 0) + (recordedRoleDoe ?? 0), effectiveDoeTotal,
          teachingLineCount: teach.credit.length, teachingRecordedCount: teach.recordedCount, teachingCalculatedCount: teach.calculatedCount, teachingResolvedCount: teach.recordedCount + teach.calculatedCount, teachingMissingCount: teach.missingCount, teachingNotApplicableCount: teach.notApplicableCount,
          roleLineCount: roles.length, roleRecordedCount: roleRecorded.length, roleCalculatedCount: roleCalculated.length, roleResolvedCount: roleRecorded.length + roleCalculated.length, roleMissingCount: roleMissing.length,
          doeComplete: teach.missingCount + roleMissing.length === 0,
          year1Assignments: year(1), year2Assignments: year(2), year3Assignments: year(3), year4Assignments: year(4),
          creditedHours: lines.reduce((s, row) => s + (row.creditedHours || 0), 0),
          courseCount: new Set(lines.map(row => row.courseCode)).size,
          sessionCount: sessions.size
        };
      }).sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    async roles({ academicYear: year } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      return rolesFor(resolvedYear).map(role => ({ facultyId: role.facultyId, displayName: facultyName(store, role.facultyId), ...roleView(role) }));
    },
    async doeOverview({ academicYear: year } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      const summary = await this.teachingSummary({ academicYear: resolvedYear });
      const sum = key => summary.reduce((s, row) => s + (row[key] || 0), 0);
      const roles = rolesFor(resolvedYear);
      const active = t().faculty.filter(row => row.active);
      const targets = t().targets.filter(row => row.academicYear === resolvedYear && row.active);
      const teachingLineCount = sum('teachingLineCount'), roleLineCount = sum('roleLineCount');
      const teachingMissingCount = sum('teachingMissingCount'), roleMissingCount = sum('roleMissingCount');
      return {
        academicYear: resolvedYear,
        contractTargetCoverage: { activeFacultyCount: active.length, teachingTargetCount: targets.length, missingTeachingTargetCount: Math.max(0, active.length - targets.length), coveragePercent: active.length ? (targets.length / active.length) * 100 : null, allocationCategories: [{ categoryCode: 'teaching', allocationRowCount: targets.length, facultyCount: targets.length }] },
        teachingLineCount, teachingRecordedCount: sum('teachingRecordedCount'), teachingCalculatedCount: sum('teachingCalculatedCount'), teachingResolvedCount: sum('teachingResolvedCount'), teachingMissingCount, teachingNotApplicableCount: sum('teachingNotApplicableCount'),
        recordedTeachingDoe: sum('recordedTeachingDoe'), teachingDoe: sum('assignedTeachingDoe'),
        roleLineCount, roleRecordedCount: sum('roleRecordedCount'), roleCalculatedCount: sum('roleCalculatedCount'), roleResolvedCount: sum('roleResolvedCount'), roleMissingCount,
        recordedRoleDoe: sum('recordedRoleDoe'), roleDoe: sum('roleDoe'),
        recordedDoeTotal: sum('recordedDoeTotal'), effectiveDoeTotal: sum('effectiveDoeTotal'),
        doeStatus: teachingLineCount + roleLineCount === 0 ? 'none' : teachingMissingCount + roleMissingCount > 0 ? 'partial' : 'complete',
        overrideCount: roles.filter(r => r.doeOverrideValue != null).length, overrideZeroCount: roles.filter(r => r.doeOverrideValue === 0).length, overrideNegativeCount: roles.filter(r => r.doeOverrideValue < 0).length,
        partial: teachingMissingCount > 0 || roleMissingCount > 0
      };
    },
    async roleCategoryVocabulary() {
      const seen = new Map();
      for (const role of t().roles) seen.set(`${role.roleCategory}|${role.roleType}`, { roleCategory: role.roleCategory || '', roleType: role.roleType });
      return [...seen.values()];
    },
    async doeTargets({ academicYear: year } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      return t().targets.filter(row => row.academicYear === resolvedYear && row.active).map(clone);
    }
  };
}

module.exports = { createUserRepository, createSessionRepository, createDashboardRepository, teachingAssignmentsFor, roleView, afcView, checkNeeded, facultyName, clone, like, sqlError, GRID_START };
