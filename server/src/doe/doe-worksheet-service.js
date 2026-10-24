'use strict';

const { applyTeachingReserve, normalizePolicy } = require('./doe-reserve-service');

const text = value => String(value ?? '').trim();
const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const round = value => value === null ? null : Number(Number(value).toFixed(6));

function lineSection(category) {
  const value = text(category).toLowerCase();
  if (['supervision', 'trainee_supervision'].includes(value)) return 'supervision';
  if (['adjustment', 'exception', 'approved_activity'].includes(value)) return 'adjustments';
  if (['role', 'rotation', 'course_coordination', 'hicc', 'visc'].includes(value)) return 'roles';
  return 'scheduledTeaching';
}

function sumLines(lines) {
  const rows = (Array.isArray(lines) ? lines : []).filter(row => !(row.applicable === false && finite(row.resultDoe) === null));
  if (rows.some(row => finite(row?.resultDoe) === null || ['needs_review', 'needs-review', 'error'].includes(text(row?.status).toLowerCase()))) return null;
  return round(rows.reduce((sum, row) => sum + finite(row.resultDoe), 0));
}

function policyVersion(lines) {
  const ids = [...new Set(lines.map(row => text(row.policyVersionId)).filter(Boolean))];
  return ids.length === 1 ? ids[0] : ids.length > 1 ? 'mixed' : '';
}

function createWorksheetService({ repository } = {}) {
  if (!repository?.getFacultyWorksheetSource) throw new Error('Faculty DOE worksheet repository is required.');

  function materializeWorksheet(source, { facultyId, academicYear } = {}) {
    if (!source) return {
      facultyId: text(facultyId), academicYear: text(academicYear), status: 'not_found', lines: [],
      errors: [{ code: 'FACULTY_DOE_SOURCE_NOT_FOUND', message: 'Faculty DOE source was not found.' }],
      totals: { assignedTeachingDoe: null, effectiveTargetDoe: null, remainingDoe: null }
    };

    const lines = (Array.isArray(source.lines) ? source.lines : []).map(row => ({ ...row }));
    const errors = [];
    if (text(source.policyStatus).toLowerCase() === 'mixed') errors.push({ code: 'MIXED_POLICY_VERSIONS', message: 'Faculty DOE source rows span multiple policy versions and require review.' });
    if (text(source.policyStatus).toLowerCase() === 'missing_version') errors.push({ code: 'POLICY_VERSION_NOT_FOUND', message: 'Faculty DOE provenance references a missing policy version.' });
    for (const row of lines) {
      if (row.applicable === false && finite(row.resultDoe) === null) continue;
      const blocking = finite(row.resultDoe) === null || ['needs_review', 'needs-review', 'error'].includes(text(row.status).toLowerCase());
      if (blocking || row.requiresReview || text(row.status) === 'stored-calculation-mismatch') {
        errors.push({ code: text(row.errorCode) || 'DOE_LINE_UNAVAILABLE', message: text(row.reviewReason).replace(/-/g, ' ') || 'A DOE line requires review.', lineId: text(row.lineId), sourceEntityId: text(row.sourceEntityId), errorCode: text(row.errorCode) || null, blocking });
      }
    }

    const target = finite(source.target?.effectiveTargetDoe);
    if (target === null) errors.push({ code: 'DOE_TARGET_UNAVAILABLE', message: 'Effective Teaching DOE target is unavailable.' });
    try { normalizePolicy(source.reservePolicy); }
    catch (error) { errors.push({ code: error.code || 'RESERVE_POLICY_INVALID', message: error.message, blocking: true }); }
    const sections = { scheduledTeaching: { lines: [] }, roles: { lines: [] }, supervision: { lines: [] }, adjustments: { lines: [] } };
    for (const row of lines) sections[lineSection(row.category)].lines.push(row);
    sections.scheduledTeaching.subtotal = sumLines(sections.scheduledTeaching.lines);
    sections.roles.subtotal = sumLines(sections.roles.lines);
    sections.supervision.rawSubtotal = source.supervisionDataAvailable === false ? null : sumLines(sections.supervision.lines);
    if (source.supervisionDataAvailable === false) errors.push({
      code: 'SUPERVISION_DATA_UNAVAILABLE',
      message: 'Trainee supervision data has not been supplied for this faculty and academic year; an empty dataset does not confirm zero supervision.',
      blocking: true
    });
    sections.adjustments.subtotal = sumLines(sections.adjustments.lines);

    let reserve = null;
    // Negotiated adjustments are applied after the source supervision reserve.
    // A reduction must not be absorbed by an automatic increase in supervision.
    const manualRoleDoe = sumLines(sections.roles.lines.filter(line => line.sourceEntityType === 'manual_doe_assignment'));
    if (!errors.some(error => error.blocking !== false)) {
      try {
        reserve = applyTeachingReserve({
          teachingTarget: target, stream: source.stream, rawSupervision: sections.supervision.rawSubtotal,
          assignedTeaching: round(sections.scheduledTeaching.subtotal + sections.roles.subtotal - manualRoleDoe + sections.adjustments.subtotal),
          policy: source.reservePolicy
        });
      } catch (error) {
        errors.push({ code: error.code || 'RESERVE_CALCULATION_FAILED', message: error.message });
      }
    }

    sections.supervision.appliedSubtotal = reserve ? reserve.appliedSupervision : null;
    const assigned = reserve ? round(sections.scheduledTeaching.subtotal + sections.roles.subtotal + sections.adjustments.subtotal + reserve.appliedSupervision) : null;
    const lastCalculatedAt = lines.map(row => text(row.calculatedAt)).filter(Boolean).sort().at(-1) || '';
    return {
      facultyId: text(source.facultyId || facultyId), academicYear: text(source.academicYear || academicYear),
      displayName: text(source.displayName), stream: text(source.stream), status: errors.length ? 'needs_review' : 'calculated',
      policyVersionId: policyVersion(lines), target: { ...(source.target || {}) }, reservePolicy: { ...(source.reservePolicy || {}) },
      targetPolicyVersionLabel: text(source.targetPolicyVersionLabel),
      workloadSourceReference: text(source.workloadSourceReference),
      calculationBasis: lines.some(line => ['legacy_session_assignment', 'legacy_role_assignment', 'supervision_source_snapshot', 'manual_doe_assignment'].includes(text(line.sourceEntityType))) ? 'recorded_sources' : 'annual_engine',
      reserve, lines, sections, errors,
      completeness: { valuesComplete: !errors.some(error => error.blocking !== false), policyConsistent: !errors.length, reviewLineCount: errors.filter(error => error.lineId).length },
      totals: {
        scheduledTeachingDoe: sections.scheduledTeaching.subtotal, roleDoe: sections.roles.subtotal,
        rawSupervisionDoe: sections.supervision.rawSubtotal, appliedSupervisionDoe: sections.supervision.appliedSubtotal,
        adjustmentDoe: sections.adjustments.subtotal, assignedTeachingDoe: assigned,
        effectiveTargetDoe: target, remainingDoe: assigned === null || target === null ? null : round(target - assigned)
      },
      lastCalculatedAt
    };
  }

  async function buildFacultyWorksheet({ facultyId, academicYear } = {}) {
    const source = await repository.getFacultyWorksheetSource(text(facultyId), text(academicYear));
    return materializeWorksheet(source, { facultyId, academicYear });
  }

  async function previewFacultyWorksheet({ facultyId, academicYear, removeSourceEntityId, addLine } = {}) {
    const source = await repository.getFacultyWorksheetSource(text(facultyId), text(academicYear));
    if (!source) return materializeWorksheet(null, { facultyId, academicYear });
    const removeId = text(removeSourceEntityId);
    const lines = (Array.isArray(source.lines) ? source.lines : [])
      .filter(line => !removeId || text(line.sourceEntityId) !== removeId);
    if (addLine && typeof addLine === 'object' && !Array.isArray(addLine)) lines.push({ ...addLine });
    return materializeWorksheet({ ...source, lines }, { facultyId, academicYear });
  }

  async function listFacultyDoe({ academicYear } = {}) {
    const year = text(academicYear), worksheets = [];
    if (repository.listFacultyWorksheetSources) {
      const sources = await repository.listFacultyWorksheetSources(year);
      for (const source of sources || []) worksheets.push(materializeWorksheet(source, { facultyId: source?.facultyId, academicYear: year }));
    } else {
      if (!repository.listFacultyIdsForDoe) throw new Error('Faculty DOE list repository is required.');
      for (const facultyId of await repository.listFacultyIdsForDoe(year) || []) worksheets.push(await buildFacultyWorksheet({ facultyId, academicYear: year }));
    }
    return worksheets.map(row => {
      const lines = Array.isArray(row.lines) ? row.lines : [];
      const roleLines = lines.filter(line => lineSection(line.category) === 'roles');
      const roleAssignments = roleLines.filter(line => ['doe_assignment','manual_doe_assignment'].includes(text(line.sourceEntityType))).map(line => ({
        assignmentFactId: text(line.assignmentFactId || line.sourceEntityId), roleType: text(line.roleType),
        courseCode: text(line.courseCode), subjectKey: text(line.subjectKey), resultDoe: finite(line.resultDoe),
        status: text(line.status), ruleKey: text(line.ruleKey), ruleId: text(line.ruleId), reference: line.reference || null,
        scopeText: text(line.scopeText), notes: text(line.notes), revision: Number(line.revision || 0), facts: { ...(line.facts || {}) }
      }));
      const lineIssueCodes = lines.map(line => text(line.errorCode)).filter(Boolean);
      const worksheetIssueCodes = (row.errors || []).map(error => text(error.code)).filter(Boolean);
      const issueCodes = [...new Set([...lineIssueCodes, ...worksheetIssueCodes])];
      const isMappingIssue = code => /(?:^|_)MAPPING_(?:REQUIRED|AMBIGUOUS)$/.test(text(code).toUpperCase());
      return {
        facultyId: row.facultyId, displayName: row.displayName, academicYear: row.academicYear,
        policyVersionId: row.policyVersionId, status: row.status, lastCalculatedAt: row.lastCalculatedAt,
        targetPolicyVersionLabel: row.targetPolicyVersionLabel,
        workloadSourceReference: row.workloadSourceReference, calculationBasis: row.calculationBasis,
        target: { ...(row.target || {}) }, roleAssignmentCount: roleAssignments.length, roleAssignments,
        teachingLineCount: lines.filter(line => lineSection(line.category) === 'scheduledTeaching').length,
        supervisionLineCount: lines.filter(line => lineSection(line.category) === 'supervision').length,
        adjustmentLineCount: lines.filter(line => lineSection(line.category) === 'adjustments').length,
        serverFactCount: lines.length,
        unratedLineCount: lines.filter(line => !(line.applicable === false && finite(line.resultDoe) === null)
          && (finite(line.resultDoe) === null || ['needs_review', 'needs-review', 'error'].includes(text(line.status).toLowerCase()))).length,
        missingMappingCount: lines.filter(line => isMappingIssue(line.errorCode)).length,
        issueCount: (row.errors || []).length, issueCodes, ...row.totals
      };
    });
  }

  return Object.freeze({ buildFacultyWorksheet, previewFacultyWorksheet, listFacultyDoe });
}

module.exports = { createWorksheetService, lineSection };
