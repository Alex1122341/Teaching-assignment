'use strict';

const { randomUUID } = require('node:crypto');

const text = value => value === null || value === undefined ? '' : String(value).trim();
const intervalHours = (start, end) => {
  const minutes = value => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(text(value));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const first = minutes(start), last = minutes(end);
  return first === null || last === null || last <= first ? null : (last - first) / 60;
};
const dateParts = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  if (!match) return {};
  const date = new Date(`${text(value)}T00:00:00Z`);
  return { year: Number(match[1]), week: Math.ceil((((date - new Date(Date.UTC(date.getUTCFullYear(), 0, 1))) / 86400000) + 1) / 7) };
};

function createDoeSessionService({ repository, calculationService, idFactory = randomUUID, clock = () => new Date() } = {}) {
  if (!repository || typeof repository.loadSessionDoeFacts !== 'function' || typeof repository.saveSessionDoeCalculations !== 'function') {
    throw new TypeError('A session DOE repository is required.');
  }
  if (!calculationService || typeof calculationService.preview !== 'function') {
    throw new TypeError('A server DOE calculation service is required.');
  }

  return Object.freeze({
    async recalculate({ sessionId, actor, trigger } = {}) {
      const loaded = await repository.loadSessionDoeFacts(sessionId);
      if (!loaded) return { status: 'needs_review', issueCodes: ['SESSION_NOT_FOUND'], assignmentCount: 0 };
      const orphanedIds = (loaded.orphanedAssignments || []).map(row => text(row.assignmentFactId)).filter(Boolean);
      if (orphanedIds.length && typeof repository.deactivateOrphanedSessionDoeFacts === 'function') {
        await repository.deactivateOrphanedSessionDoeFacts({ assignmentFactIds: orphanedIds, actorUid: text(actor?.uid) });
      }
      const facts = loaded.assignments.filter(row => text(row.facultyId));
      if (!facts.length) return { status: 'needs_review', issueCodes: ['NO_RESOLVED_FACULTY_ASSIGNMENTS'], assignmentCount: 0 };

      const calculatedAt = clock().toISOString();
      const rows = [];
      const issueCodes = new Set();
      for (const assignment of facts) {
        const time = dateParts(loaded.sessionDate);
        const ruleFacts = {
          academicYear: text(loaded.academicYear), category: 'teaching', activityType: text(loaded.sessionType),
          teachingRole: text(assignment.teachingRole), role: text(assignment.teachingRole),
          courseCode: text(loaded.courseCode), course: text(loaded.courseCode),
          sessionType: text(loaded.sessionType), curriculumStage: text(loaded.curriculumYear),
          hours: assignment.creditedHours !== null && assignment.creditedHours !== undefined && assignment.creditedHours !== '' && Number.isFinite(Number(assignment.creditedHours))
            ? Number(assignment.creditedHours) : intervalHours(loaded.startTime, loaded.endTime),
          shifts: 1, date: text(loaded.sessionDate), topic: text(loaded.topic),
          facultyId: text(assignment.facultyId), sessionId: text(sessionId),
          assignmentId: text(assignment.sessionAssignmentId), sourceEntityType: 'session_assignment',
          sourceEntityId: text(assignment.sessionAssignmentId), ...time
        };
        if (ruleFacts.hours === null) delete ruleFacts.hours;
        let result;
        try {
          result = await calculationService.preview({ academicYear: loaded.academicYear, facts: ruleFacts });
        } catch (error) {
          const code = text(error.code) || 'DOE_CALCULATION_FAILED';
          issueCodes.add(code);
          const version = await repository.loadActivePolicy(loaded.academicYear).catch(() => null);
          if (!version?.version?.policyVersionId) continue;
          result = {
            ok: false, academicYear: loaded.academicYear,
            policyVersionId: text(version.version.policyVersionId),
            policyRevision: Number(version.version.revision || 0),
            category: 'teaching', factsSnapshot: ruleFacts, inputsSnapshot: {}, parameterSnapshot: {},
            ruleSnapshot: { status: 'needs_review', issueCode: code, message: text(error.message) || 'DOE requires review.' },
            referenceSnapshot: null, ruleId: null, ruleKey: null, exceptionId: null,
            calculationText: `Needs Review · ${code}`, resultDoe: null, status: 'needs_review'
          };
        }
        rows.push({
          assignmentFactId: text(assignment.sessionAssignmentId), sessionAssignmentId: text(assignment.sessionAssignmentId),
          sessionId: text(sessionId), facultyId: text(assignment.facultyId), academicYear: text(loaded.academicYear),
          category: 'teaching', roleType: text(assignment.teachingRole), activityType: text(loaded.sessionType),
          scopeText: text(loaded.courseCode), courseCode: text(loaded.courseCode), subjectKey: null,
          sourceEntityType: 'session_assignment', sourceEntityId: text(assignment.sessionAssignmentId),
          assignmentId: text(assignment.sessionAssignmentId), revision: Number(assignment.doeRevision || 0) + 1,
          calculationId: idFactory(), policyVersionId: result.policyVersionId, policyRevision: result.policyRevision,
          ruleId: result.ruleId || null, ruleKey: result.ruleKey || null, exceptionId: result.exceptionId || null,
          factsSnapshot: result.factsSnapshot || ruleFacts, inputsSnapshot: result.inputsSnapshot || {},
          parameterSnapshot: result.parameterSnapshot || {}, ruleSnapshot: result.ruleSnapshot || {},
          referenceSnapshot: result.referenceSnapshot || null, calculationText: result.calculationText,
          resultDoe: result.resultDoe ?? null, calculationStatus: result.status === 'calculated' ? 'calculated' : 'needs_review',
          calculationTrigger: text(trigger) || 'session_change', calculatedBy: text(actor?.uid), calculatedAt
        });
      }
      if (rows.length) await repository.saveSessionDoeCalculations({ rows, actorUid: text(actor?.uid), trigger: text(trigger) || 'session_change' });
      const calculatedCount = rows.filter(row => row.calculationStatus === 'calculated').length;
      const reviewCount = facts.length - calculatedCount;
      return {
        status: reviewCount ? 'needs_review' : 'calculated', assignmentCount: facts.length,
        calculatedCount, needsReviewCount: reviewCount, issueCodes: [...issueCodes]
      };
    }
  });
}

module.exports = { createDoeSessionService };
