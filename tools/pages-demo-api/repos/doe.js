'use strict';
// Annual DOE policy, faculty worksheets, targets, manual DOE and trainee
// supervision for the Frontend Demo. Values follow the same calculators the
// Beta server uses (server/src/domain/doe-calculator.js).
const { resolveTeachingDoe, resolveRoleDoe, calculateSupervisionDoe } = require('../../../server/src/domain/doe-calculator.js');
const { uuidFor, mulberry32 } = require('../ids.js');
const { clone, sqlError } = require('./core.js');

const RESERVE = { splitThreshold: 20, splitRatio: 0.5, highTeachingTraineeCeiling: 15, teachingFocusedTraineeCeiling: 20, rollingAverageYears: 3 };
const SUPERVISION_KEYS = ['undergraduate', 'vetm506', 'fourthYearPreceptor', 'im', 'graduatePrimary', 'graduateCosupervisor', 'postdoctoral'];
const CALC_KEYS = { undergraduate: 'undergraduate', fourthYearPreceptor: 'fourthYearPreceptor', graduatePrimary: 'graduatePrimary', graduateCosupervisor: 'graduateCosupervisor', postdoctoral: 'postdoctoral' };

// Seven supervision counts per faculty, in the trainee-service column order.
function traineeRows(store) {
  const t = store.tables;
  if (!t.extra.trainees) {
    const rand = mulberry32(5065);
    t.extra.trainees = t.faculty.filter(row => row.active).map((member, index) => {
      const counts = SUPERVISION_KEYS.map((key, k) => (index + k) % 4 === 0 ? Math.floor(rand() * 4) : (k < 2 ? Math.floor(rand() * 3) : 0));
      if (index === 9) counts[4] = null; // one missing source cell, so "Source / DOE issues" has an example
      return { facultyId: member.facultyId, counts, sourceRef: { sheet: 'Trainees 2026-27', column: 'C', row: 4 + index } };
    });
  }
  return t.extra.trainees;
}

function supervisionDoe(counts) {
  const input = {};
  SUPERVISION_KEYS.forEach((key, i) => { if (CALC_KEYS[key] && counts[i] !== null) input[CALC_KEYS[key]] = counts[i]; });
  return calculateSupervisionDoe(input).calculatedDoe ?? null;
}

function rule(key, category, label, priority, mode, selectors, parameters, inputs = [], extra = {}) {
  const ruleId = uuidFor(`doe-rule:${key}`);
  return { ruleId, ruleKey: key, category, activityType: null, ruleLabel: label, priority, calculationMode: mode, tierStrategy: null, formulaText: null, mappingRequirement: extra.mappingRequirement || null, resultKind: 'credit', referenceId: 'ref-guidelines', enabled: true, reviewStatus: 'approved', selectors: selectors.map(([field, operator, value]) => ({ selectorId: uuidFor(`sel:${key}:${field}`), field, operator, valueText: Array.isArray(value) ? null : String(value), valueNumber: null, values: Array.isArray(value) ? value : undefined })), parameters: parameters.map(([name, valueNumber]) => ({ name, valueNumber, valueText: null })), tiers: [], inputs: inputs.map(name => ({ inputName: name, source: null, required: true })) };
}

function baseBundle(store, year, status, label) {
  const policyVersionId = uuidFor(`doe-policy:${year}:${label}`);
  const rules = [
    rule('teaching.lecture', 'teaching', 'Lecture', 30, 'per_hour', [['teachingRole', 'equals', 'Lecture']], [['rate', 0.3]], ['hours']),
    rule('teaching.srl', 'teaching', 'Self-directed / SRL', 30, 'per_hour', [['teachingRole', 'equals', 'SRL']], [['rate', 0.3]], ['hours']),
    rule('teaching.lab_primary', 'teaching', 'Lab Primary', 30, 'per_hour', [['teachingRole', 'equals', 'Lab Primary']], [['rate', 0.21]], ['hours']),
    rule('teaching.lab_secondary', 'teaching', 'Lab Secondary', 30, 'per_hour', [['teachingRole', 'equals', 'Lab Secondary']], [['rate', 0.19]], ['hours']),
    rule('teaching.osce_no_credit', 'teaching', 'OSCE (no DOE credit)', 40, 'fixed', [['sessionType', 'equals', 'OSCE']], [['fixed', 0]]),
    rule('teaching.quiz_no_credit', 'teaching', 'Quiz/Midterm (no DOE credit)', 40, 'fixed', [['sessionType', 'equals', 'Quiz/Midterm']], [['fixed', 0]]),
    rule('role.course_coordinator', 'course_coordination', 'Course Coordinator', 20, 'fixed', [['roleType', 'equals', 'Course Coordinator']], [['fixed', 3.5]]),
    rule('role.hicc', 'hicc', 'HICC Course Development', 20, 'fixed', [['roleType', 'equals', 'HICC']], [['fixed', 2]], [], { mappingRequirement: 'course' }),
    rule('role.visc', 'visc', 'VISC Coordination', 20, 'fixed', [['roleType', 'equals', 'VISC']], [['fixed', 5]]),
    rule('role.rotation_coordinator', 'rotation', 'Designated Rotation Coordination', 20, 'fixed', [['roleType', 'equals', 'Designated Rotation Coordinator']], [['fixed', 2]]),
    rule('role.rotation_participant', 'rotation', 'Rotation Participant', 20, 'per_week', [['roleType', 'equals', 'Rotation Participant']], [['rate', 1.25]], ['weeks']),
    rule('role.ccc', 'rotation', 'Community Care Clinic', 20, 'per_shift', [['roleType', 'equals', 'CCC']], [['rate', 0.5]], ['shifts']),
    rule('supervision.trainees', 'supervision', 'Trainees & Supervision', 10, 'per_trainee', [['category', 'equals', 'supervision']], [['rate', 1]], ['trainees']),
    { ...rule('reserve_policy', 'reserve', 'Teaching reserve logic', 0, 'fixed', [], Object.entries(RESERVE)), resultKind: 'reserve' }
  ];
  return {
    version: { policyVersionId, academicYear: year, versionLabel: label, sourceReference: 'UCVM Workload Guidelines + MASTER allocation (synthetic demo copy)', status, revision: 1, updatedBy: 'Frontend Demo', validatedRevision: status === 'active' ? 1 : null, validatedChecksum: null, impactRevision: null, impactChecksum: null, createdAtUtc: '2026-07-01T15:00:00.000Z', updatedAtUtc: '2026-07-01T15:00:00.000Z' },
    rules,
    reservePolicy: { ...RESERVE },
    references: [{ referenceId: 'ref-guidelines', title: 'UCVM Workload Guidelines', section: '6.4', tableName: 'Table 3', pageNumber: 5, effectiveDate: '2025-04-01', sourceReference: 'Faculty Council approved 2025-03-12', documentLink: null, notes: 'Demo copy', reviewStatus: 'approved' }],
    exceptions: [],
    courseMappings: store.tables.courses.map(course => ({ mappingId: uuidFor(`map:${course.courseCode}`), courseCode: course.courseCode, unitCount: course.units, curriculumStage: `Year ${course.curriculumYear}`, hiccEligible: true, mappingFacts: { aliases: [course.catalogLabel] }, mappingFactsJson: JSON.stringify({ aliases: [course.catalogLabel] }), referenceId: 'ref-guidelines', reviewStatus: 'approved', enabled: true })),
    subjectMappings: ['Anatomy', 'Physiology', 'Pharmacology', 'Pathology', 'Microbiology', 'Epidemiology', 'Behaviour'].map(subject => ({ mappingId: uuidFor(`subject:${subject}`), subjectKey: subject.toLowerCase(), subjectName: subject, curriculumStage: 'Years 1-3', developmentPhase: 'maintenance', mappingFacts: {}, mappingFactsJson: '{}', referenceId: 'ref-guidelines', reviewStatus: 'approved', enabled: true }))
  };
}

function policies(store) {
  return store.bag('doePolicies', () => {
    const year = store.tables.academicYear;
    const active = baseBundle(store, year, 'active', `${year} Guidelines + MASTER allocation`);
    return { versions: [active], history: [{ policyVersionId: active.version.policyVersionId, academicYear: year, versionLabel: active.version.versionLabel, sourceReference: active.version.sourceReference, status: 'active', revision: 1, updatedBy: 'Frontend Demo', createdAtUtc: active.version.createdAtUtc, updatedAtUtc: active.version.updatedAtUtc, publicationId: uuidFor('pub:1'), policyChecksum: 'demo', publishedBy: 'Frontend Demo', publishedAtUtc: '2026-07-01T15:00:00.000Z' }], impact: {} };
  });
}
const findVersion = (store, id) => policies(store).versions.find(row => row.version.policyVersionId === id) || null;

function createDoeEngineRepository(store) {
  return { async loadActivePolicy(academicYear) { const row = policies(store).versions.find(v => v.version.academicYear === academicYear && v.version.status === 'active'); return row ? clone(row) : null; } };
}

function createDoePolicyRepository(store) {
  const bump = (bundle, actorUid) => { bundle.version.revision += 1; bundle.version.updatedBy = actorUid; bundle.version.updatedAtUtc = store.nowIso(); };
  const need = (id, revision) => { const row = findVersion(store, id); if (!row) throw sqlError(52101, 'Policy version not found'); if (revision !== undefined && Number(revision) !== Number(row.version.revision)) throw Object.assign(new Error('The policy changed. Reload it.'), { code: 'POLICY_REVISION_CONFLICT', statusCode: 409 }); return row; };
  const log = (row, action) => policies(store).history.unshift({ policyVersionId: row.version.policyVersionId, academicYear: row.version.academicYear, versionLabel: row.version.versionLabel, sourceReference: row.version.sourceReference, status: row.version.status, revision: row.version.revision, updatedBy: row.version.updatedBy, createdAtUtc: row.version.createdAtUtc, updatedAtUtc: row.version.updatedAtUtc, action });
  return {
    async getPolicyVersion(id) { const row = findVersion(store, id); return row ? clone(row) : null; },
    async createDraft({ academicYear, versionLabel, sourceReference, actorUid }) {
      const row = baseBundle(store, academicYear, 'draft', versionLabel || `${academicYear} draft`);
      row.version.policyVersionId = uuidFor(`doe-policy:draft:${academicYear}:${Date.now()}`); row.version.sourceReference = sourceReference || row.version.sourceReference; row.version.revision = 0; row.version.updatedBy = actorUid;
      policies(store).versions.push(row); log(row, 'draft_created'); store.commit();
      return clone(row.version);
    },
    async saveDraft({ policyVersionId, expectedRevision, actorUid, bundle }) {
      const row = need(policyVersionId, expectedRevision);
      for (const key of ['rules', 'references', 'exceptions', 'courseMappings', 'subjectMappings']) if (Array.isArray(bundle?.[key])) row[key] = clone(bundle[key]);
      bump(row, actorUid); log(row, 'draft_saved'); store.commit();
      return clone(row.version);
    },
    async markValidated({ policyVersionId, revision, checksum, valid }) { const row = need(policyVersionId); row.version.validatedRevision = valid ? revision : null; row.version.validatedChecksum = valid ? checksum : null; store.commit(); return { revision, checksum, valid }; },
    async previewImpact({ policyVersionId, revision, checksum, calculate }) {
      const row = need(policyVersionId);
      const result = { impactRunId: uuidFor(`impact:${policyVersionId}:${revision}`), revision, facultyAffected: 0, assignmentsChanged: 0, needsReview: 0, mappingGaps: 0, totalDelta: 0, inputDatasetChecksum: 'demo', rows: [] };
      row.version.impactRevision = revision; row.version.impactChecksum = checksum; policies(store).impact[policyVersionId] = result; store.commit();
      if (typeof calculate === 'function') { /* the demo keeps impact at zero: recorded sources stay authoritative */ }
      return result;
    },
    async getImpactPreview(policyVersionId) { return clone(policies(store).impact[policyVersionId] || null); },
    async publishPolicy({ policyVersionId, academicYear, revision, actorUid }) {
      const row = need(policyVersionId, revision);
      for (const other of policies(store).versions) if (other.version.academicYear === academicYear && other.version.status === 'active') other.version.status = 'archived';
      row.version.status = 'active'; bump(row, actorUid); log(row, 'published'); store.commit();
      return { policyVersionId, academicYear, revision: row.version.revision, status: 'active' };
    },
    async clonePolicy({ sourcePolicyVersionId, academicYear, actorUid }) {
      const source = need(sourcePolicyVersionId);
      const existing = policies(store).versions.find(row => row.version.academicYear === academicYear && row.version.status === 'draft');
      if (existing) return clone(existing);
      const row = clone(source);
      row.version = { ...row.version, policyVersionId: uuidFor(`doe-policy:clone:${academicYear}:${Date.now()}`), academicYear, status: 'draft', revision: 0, versionLabel: `${academicYear} draft (copied)`, validatedRevision: null, impactRevision: null, updatedBy: actorUid, createdAtUtc: store.nowIso(), updatedAtUtc: store.nowIso() };
      policies(store).versions.push(row); log(row, 'cloned'); store.commit();
      return clone(row);
    },
    async listHistory(academicYear) { return clone(policies(store).history.filter(row => row.academicYear === academicYear)); },
    async archivePolicy({ policyVersionId, expectedRevision, actorUid }) { const row = need(policyVersionId, expectedRevision); row.version.status = 'archived'; bump(row, actorUid); log(row, 'archived'); store.commit(); return { policyVersionId, status: 'archived', revision: row.version.revision }; },
    async recalculate({ policyVersionId, policyRevision, preview = false }) {
      const count = store.tables.sessions.reduce((sum, s) => sum + s.assignments.length, 0);
      return preview ? { preview: true, policyVersionId, policyRevision, recordsProjected: count, needsReview: 0 } : { recordsCreated: count, needsReview: 0, policyVersionId, policyRevision, limit: 250, remaining: 0 };
    }
  };
}

function worksheetSources(store, academicYear, facultyId = null) {
  const t = store.tables;
  const active = policies(store).versions.find(v => v.version.academicYear === academicYear && v.version.status === 'active');
  const trainees = new Map(traineeRows(store).map(row => [row.facultyId, row]));
  const manual = store.bag('manualDoe', () => []);
  return t.faculty.filter(row => row.active && (!facultyId || row.facultyId === facultyId)).map(member => {
    const lines = [];
    for (const session of t.sessions) {
      if (session.academicYear !== academicYear) continue;
      for (const a of session.assignments.filter(x => x.facultyId === member.facultyId)) {
        const resolved = resolveTeachingDoe({ ...a, sessionType: session.sessionType });
        lines.push({ lineId: a.sessionAssignmentId, sourceEntityType: 'session_assignment', sourceEntityId: a.sessionAssignmentId, category: 'teaching', roleType: a.teachingRole || '', sessionId: session.id, courseCode: session.courseCode, scopeText: `${session.courseCode} · ${session.topic}`, legacyResultDoe: a.doeCredit, legacyDoeStatus: a.doeStatus, facts: { sessionType: session.sessionType, date: session.date }, creditedHours: a.creditedHours, doeQuantity: a.doeQuantity, resultDoe: resolved.effectiveDoe ?? null, calculatedDoe: resolved.calculatedDoe ?? null, storedDoe: resolved.storedDoe ?? null, doeSource: resolved.source, status: resolved.source === 'missing' ? 'needs_review' : resolved.status, applicable: resolved.applicable, requiresReview: resolved.requiresReview === true, reviewReason: resolved.reviewReason ?? null, ruleKey: resolved.ruleCode, reference: { title: resolved.sourceReference || resolved.calculatorSource }, errorCode: resolved.reviewReason ? resolved.reviewReason.replace(/-/g, '_').toUpperCase() : null, calculatedAt: session.updatedAtUtc });
      }
    }
    for (const role of t.roles.filter(r => r.facultyId === member.facultyId && r.academicYear === academicYear)) {
      const resolved = resolveRoleDoe(role);
      lines.push({ lineId: role.roleAssignmentId, sourceEntityType: 'legacy_role_assignment', sourceEntityId: role.roleAssignmentId, category: 'role', roleType: role.roleType, scopeText: role.courseOrSubjectOrRotation, facts: { sourceDetails: role.details, sourceAllocationStatus: role.sourceAllocationStatus }, legacyResultDoe: role.doeOverrideValue ?? role.doeMappedValue, notes: role.specialNotes, resultDoe: resolved.effectiveDoe ?? null, calculatedDoe: resolved.calculatedDoe ?? null, storedDoe: resolved.storedDoe ?? resolved.mappedDoe ?? null, overrideDoe: resolved.overrideDoe ?? null, doeSource: resolved.source, status: resolved.source === 'missing' ? 'needs_review' : resolved.status, applicable: resolved.applicable, requiresReview: resolved.requiresReview === true, reviewReason: resolved.reviewReason ?? null, ruleKey: resolved.ruleCode, reference: { title: resolved.sourceReference || resolved.calculatorSource }, errorCode: resolved.reviewReason ? resolved.reviewReason.replace(/-/g, '_').toUpperCase() : null, overrideReason: role.doeOverrideReason, effectiveDate: role.effectiveDate || null, expirationDate: role.expirationDate || null });
    }
    for (const row of manual.filter(m => m.facultyId === member.facultyId && m.academicYear === academicYear && m.active)) {
      lines.push({ lineId: row.assignmentId, assignmentFactId: row.assignmentId, sourceEntityId: row.assignmentId, sourceEntityType: 'manual_doe_assignment', category: 'role', roleType: row.roleType, scopeText: row.scopeText, courseCode: row.courseCode || '', subjectKey: row.subjectKey || '', resultDoe: row.doeValue, status: 'manual', doeSource: 'manual_adjustment', active: true, revision: row.revision, notes: row.notes || '', calculatedAt: row.updatedAtUtc, calculationText: 'Negotiated manual adjustment; additive to existing DOE.', reference: { title: 'Administrator-entered negotiated DOE' } });
    }
    const trainee = trainees.get(member.facultyId);
    if (trainee) lines.push({ lineId: uuidFor(`supervision:${member.facultyId}`), sourceEntityId: uuidFor(`supervision:${member.facultyId}`), sourceEntityType: 'supervision_source_snapshot', category: 'supervision', activityType: 'trainee_supervision', scopeText: '# Trainees · current-year source snapshot', resultDoe: supervisionDoe(trainee.counts), status: 'source_snapshot', calculatedAt: '2026-09-01T15:00:00.000Z', facts: { counts: trainee.counts }, reference: { title: 'Trainee supervision 2026-27 (synthetic)' } });
    const target = t.targets.find(row => row.facultyId === member.facultyId && row.academicYear === academicYear && row.active);
    return {
      facultyId: member.facultyId, displayName: member.displayName, stream: member.stream, facultyActive: member.active, academicYear, policyStatus: 'consistent',
      targetPolicyVersionLabel: active ? active.version.versionLabel : '', workloadSourceReference: 'Teaching Assignments 2026-27 MASTER (synthetic)',
      supervisionDataAvailable: Boolean(trainee),
      target: target ? { contractTeachingDoe: target.contractTeachingDoe, overrideDoe: target.overrideDoe, overrideReason: target.overrideReason || '', overrideNotes: target.overrideNotes || '', effectiveTargetDoe: target.effectiveTargetDoe, source: target.source, policyVersionId: target.policyVersionId || '' } : { contractTeachingDoe: null, overrideDoe: null, effectiveTargetDoe: null },
      reservePolicy: { ...RESERVE }, lines: lines.map(line => ({ ...line, policyVersionId: active?.version.policyVersionId || '' }))
    };
  });
}

function createDoeWorksheetRepository(store) {
  return {
    async getFacultyWorksheetSource(facultyId, academicYear) { return worksheetSources(store, academicYear, facultyId)[0] || null; },
    async listFacultyWorksheetSources(academicYear) { return worksheetSources(store, academicYear, null); }
  };
}

function createDoeAssignmentRepository(store) {
  const t = () => store.tables;
  return {
    async loadSessionDoeFacts(sessionId) {
      const s = t().sessions.find(row => row.id === sessionId);
      if (!s) return null;
      return { sessionId: s.id, academicYear: s.academicYear, sessionType: s.sessionType, courseCode: s.courseCode, curriculumYear: s.curriculumYear, sessionDate: s.date, startTime: s.startTime, endTime: s.endTime, topic: s.topic, assignments: s.assignments.map(a => ({ sessionAssignmentId: a.sessionAssignmentId, facultyId: a.facultyId, teachingRole: a.teachingRole, creditedHours: a.creditedHours, doeRevision: 0 })), orphanedAssignments: [] };
    },
    async saveSessionDoeCalculations({ rows }) {
      for (const row of rows) for (const s of t().sessions) for (const a of s.assignments) if (a.sessionAssignmentId === row.sessionAssignmentId && row.resultDoe != null) { a.doeCredit = row.resultDoe; a.doeStatus = 'calculated'; }
      store.commit(); return { saved: rows.length };
    },
    async deactivateOrphanedSessionDoeFacts() { return { deactivated: 0 }; },
    async saveDoeAssignment({ assignment, calculation }) {
      const list = store.bag('doeAssignments', () => []);
      const row = { ...assignment, ...calculation, active: true, revision: (assignment.revision || 0) + 1 };
      const index = list.findIndex(x => x.assignmentFactId === row.assignmentFactId);
      if (index >= 0) list[index] = row; else list.push(row);
      store.commit(); return row;
    },
    async deactivateDoeAssignment({ assignmentFactId }) {
      const list = store.bag('doeAssignments', () => []);
      const row = list.find(x => x.assignmentFactId === assignmentFactId);
      if (row) row.active = false;
      store.commit(); return row || null;
    }
  };
}

function createDoeTargetOverrideRepository(store) {
  return {
    async getFacultyTargetSource(facultyId, academicYear) {
      const member = store.tables.faculty.find(row => row.facultyId === facultyId);
      if (!member) return null;
      const target = store.tables.targets.find(row => row.facultyId === facultyId && row.academicYear === academicYear);
      return target ? clone(target) : { doeFacultyTargetId: null, facultyId, academicYear, contractTeachingDoe: member.contractTeachingDoe, overrideDoe: null, effectiveTargetDoe: member.contractTeachingDoe, source: 'contract', policyVersionId: null };
    },
    async saveFacultyTargetOverride({ target, auditRecord }) {
      let row = store.tables.targets.find(r => r.facultyId === target.facultyId && r.academicYear === target.academicYear);
      if (!row) { row = { doeFacultyTargetId: uuidFor(`target:${target.facultyId}:${target.academicYear}`), active: true }; store.tables.targets.push(row); }
      Object.assign(row, { contractTeachingDoe: target.contractTeachingDoe, overrideDoe: target.overrideDoe, overrideReason: target.overrideReason, overrideNotes: target.overrideNotes, effectiveTargetDoe: target.effectiveTargetDoe, source: target.source, policyVersionId: target.policyVersionId, updatedAtUtc: target.updatedAt, academicYear: target.academicYear, facultyId: target.facultyId });
      store.audit({ domain: 'doe', changeType: auditRecord.action, facultyId: target.facultyId, actorFirebaseUid: auditRecord.actorUid, before: auditRecord.before, after: auditRecord.after });
      store.commit();
      return clone(row);
    }
  };
}

function createManualDoeRepository(store) {
  const list = () => store.bag('manualDoe', () => []);
  return {
    async scopeSuggestions() {
      const courses = store.tables.courses.map(c => ({ scopeText: `${c.courseCode}: ${c.courseName}`, courseCode: c.courseCode, subjectKey: null }));
      const subjects = ['Anatomy', 'Physiology', 'Pharmacology', 'Pathology', 'Microbiology', 'Epidemiology', 'Behaviour'].map(s => ({ scopeText: s, courseCode: null, subjectKey: s.toLowerCase() }));
      return [...courses, ...subjects];
    },
    async saveManualAssignment(input) {
      const rows = list();
      let row = rows.find(r => r.assignmentId === input.assignmentId);
      if (row && input.expectedRevision != null && Number(input.expectedRevision) !== row.revision) throw sqlError(51611, 'Manual DOE changed; reload.');
      if (input.deactivate) { if (!row) throw sqlError(51610, 'Not found'); row.active = false; row.revision += 1; }
      else {
        if (!row) { row = { assignmentId: input.assignmentId, revision: 0, active: true }; rows.push(row); }
        Object.assign(row, { facultyId: input.facultyId, academicYear: input.academicYear, roleType: input.roleType, scopeText: input.scopeText, courseCode: input.courseCode, subjectKey: input.subjectKey, doeValue: input.doeValue, notes: input.notes, active: true, revision: row.revision + 1, updatedAtUtc: store.nowIso() });
      }
      store.audit({ domain: 'doe', changeType: input.deactivate ? 'manual_doe_deactivated' : 'manual_doe_saved', facultyId: input.facultyId, actorFirebaseUid: input.actorUid, after: clone(row) });
      store.commit();
      return { assignmentFactId: row.assignmentId, assignmentId: row.assignmentId, revision: row.revision, active: row.active, resultDoe: row.doeValue, roleType: row.roleType, scopeText: row.scopeText };
    }
  };
}

module.exports = { createDoeEngineRepository, createDoePolicyRepository, createDoeWorksheetRepository, createDoeAssignmentRepository, createDoeTargetOverrideRepository, createManualDoeRepository, traineeRows, supervisionDoe, SUPERVISION_KEYS };
