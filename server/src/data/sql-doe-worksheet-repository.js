'use strict';

const { resolveTeachingDoe, resolveRoleDoe } = require('../domain/doe-calculator');
const engine = require('../domain/doe-policy-engine');
const { sourceFacts } = require('../doe/doe-recorded-source-impact');

function resolutionEvidence(resolved) {
  return {
    resultDoe: resolved.effectiveDoe, calculatedDoe: resolved.calculatedDoe,
    storedDoe: resolved.storedDoe ?? resolved.mappedDoe ?? null, overrideDoe: resolved.overrideDoe ?? null,
    doeSource: resolved.source, status: resolved.source === 'missing' ? 'needs_review' : resolved.status,
    applicable: resolved.applicable, requiresReview: resolved.requiresReview === true,
    reviewReason: resolved.reviewReason, ruleKey: resolved.ruleCode,
    reference: { title: resolved.sourceReference || resolved.calculatorSource }, calculatorVersion: resolved.calculatorVersion,
    errorCode: resolved.reviewReason ? resolved.reviewReason.replace(/-/g, '_').toUpperCase() : null
  };
}

const text = value => value === null || value === undefined ? '' : String(value).trim();
const number = value => value === null || value === undefined || value === '' ? null : Number(value);
const bool = value => value === true || value === 1 || value === '1';
const parseObject = value => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try { const result = JSON.parse(value); return result && typeof result === 'object' && !Array.isArray(result) ? result : null; }
  catch (_) { return null; }
};

const RESERVE_PARAMETERS = new Set([
  'splitThreshold', 'splitRatio', 'highTeachingTraineeCeiling',
  'teachingFocusedTraineeCeiling', 'rollingAverageYears'
]);

function createSqlDoeWorksheetRepository(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('A SQL query adapter is required.');

  async function loadSources(academicYear, facultyId = null) {
    const params = { academicYear, facultyId: text(facultyId), limit: 501 };
    const [facultyRows, targetRows, policyRows, reserveRows, assignmentRows, sessionRows, legacyRoleRows, supervisionSourceRows, manualRows] = await Promise.all([
      db.query(
        `SELECT TOP (@limit) f.FacultyId AS facultyId, f.DisplayName AS displayName, f.Stream AS stream, f.Active AS facultyActive
           FROM paws.Faculty AS f
          WHERE (@facultyId=N'' OR f.FacultyId=TRY_CONVERT(uniqueidentifier,@facultyId))
          ORDER BY f.DisplayName, f.FacultyId`, params),
      db.query(
        `SELECT t.FacultyId AS facultyId, t.ContractTeachingDoe AS contractTeachingDoe,
                t.OverrideDoe AS overrideDoe, t.OverrideReason AS overrideReason,
                t.OverrideNotes AS overrideNotes, t.EffectiveTargetDoe AS effectiveTargetDoe,
                t.Source AS source, t.PolicyVersionId AS policyVersionId, v.VersionLabel AS targetPolicyVersionLabel
           FROM paws.DoeFacultyTarget AS t
           LEFT JOIN paws.DoePolicyVersion AS v ON v.PolicyVersionId=t.PolicyVersionId
          WHERE t.AcademicYear=@academicYear AND t.Active=1
            AND (@facultyId=N'' OR t.FacultyId=TRY_CONVERT(uniqueidentifier,@facultyId))`, params),
      db.query(
        `SELECT PolicyVersionId AS policyVersionId, AcademicYear AS academicYear, Status AS status,
                Revision AS revision, VersionLabel AS versionLabel
           FROM paws.DoePolicyVersion
          WHERE AcademicYear=@academicYear AND Status=N'active'`, params),
      db.query(
        `SELECT p.Name AS name, p.ValueNumber AS valueNumber, p.ValueText AS valueText
           FROM paws.DoeRuleParameter AS p
           INNER JOIN paws.DoePolicyRule AS r ON r.RuleId=p.RuleId
           INNER JOIN paws.DoePolicyVersion AS v ON v.PolicyVersionId=r.PolicyVersionId
          WHERE v.AcademicYear=@academicYear AND v.Status=N'active'
            AND r.Enabled=1 AND r.ReviewStatus=N'approved'`, params),
      db.query(
        `SELECT a.AssignmentFactId AS assignmentFactId, a.FacultyId AS facultyId,
                a.AcademicYear AS academicYear, a.Category AS category, a.RoleType AS roleType,
                a.ActivityType AS activityType, a.ScopeText AS scopeText, a.CourseCode AS courseCode,
                a.SubjectKey AS subjectKey, a.SessionId AS sessionId, a.SessionAssignmentId AS sessionAssignmentId,
                a.SourceEntityType AS sourceEntityType, a.SourceEntityId AS sourceEntityId, a.Notes AS notes,
                a.Active AS active, a.Revision AS revision, a.CurrentCalculationId AS currentCalculationId,
                c.PolicyVersionId AS policyVersionId, c.RuleId AS ruleId, c.RuleKey AS ruleKey,
                c.FactsSnapshotJson AS factsSnapshotJson, c.InputsSnapshotJson AS inputsSnapshotJson,
                c.ParameterSnapshotJson AS parameterSnapshotJson, c.RuleSnapshotJson AS ruleSnapshotJson,
                c.ReferenceSnapshotJson AS referenceSnapshotJson, c.CalculationText AS calculationText,
                c.ResultDoe AS resultDoe, c.CalculationStatus AS calculationStatus, c.CalculatedAtUtc AS calculatedAt
           FROM paws.DoeAssignmentFact AS a
           LEFT JOIN paws.DoeCalculationRecord AS c ON c.CalculationId=a.CurrentCalculationId
          WHERE a.AcademicYear=@academicYear AND a.Active=1
            AND (@facultyId=N'' OR a.FacultyId=TRY_CONVERT(uniqueidentifier,@facultyId))
          ORDER BY a.FacultyId, a.CreatedAtUtc, a.AssignmentFactId`, params),
      db.query(
        `SELECT sa.SessionAssignmentId AS sessionAssignmentId, sa.SessionId AS sessionId,
                sa.FacultyId AS facultyId, sa.TeachingRole AS teachingRole,
                sa.DoeCredit AS doeCredit, sa.DoeStatus AS doeStatus,
                sa.CreditedHours AS creditedHours, sa.DoeQuantity AS doeQuantity,
                s.SessionType AS sessionType
           FROM paws.SessionAssignment AS sa
           INNER JOIN paws.vCalendarSession AS s ON s.SessionId=sa.SessionId
          WHERE s.AcademicYear=@academicYear AND sa.FacultyId IS NOT NULL
            AND (@facultyId=N'' OR sa.FacultyId=TRY_CONVERT(uniqueidentifier,@facultyId))
            AND NOT EXISTS (SELECT 1 FROM paws.DoeAssignmentFact AS a
                             WHERE a.SessionAssignmentId=sa.SessionAssignmentId AND a.Active=1)
          ORDER BY sa.FacultyId, s.SessionDate, sa.SessionAssignmentId`, params),
      db.query(
        `SELECT r.RoleAssignmentId AS roleAssignmentId, r.FacultyId AS facultyId,
                r.RoleType AS roleType, r.CourseOrSubjectOrRotation AS scopeText,
                (SELECT e.AllocationStatus FROM paws.vMasterRoleFacts e WHERE e.RoleAssignmentId=r.RoleAssignmentId) AS sourceAllocationStatus,
                (SELECT e.Units units,e.Weeks weeks,e.SubjectCount subjectCount,e.UniqueRotationTypes uniqueRotationTypes,e.Shifts shifts,e.HalfDayDeduction halfDayDeduction FROM paws.vMasterRoleFacts e WHERE e.RoleAssignmentId=r.RoleAssignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) sourceFactsJson,
                r.DoeMappedValue AS doeMappedValue, r.DoeOverrideValue AS doeOverrideValue,
                r.DoeOverrideReason AS doeOverrideReason, r.SpecialNotes AS specialNotes,
                r.EffectiveDate AS effectiveDate, r.ExpirationDate AS expirationDate,
                r.AcademicYear AS academicYear, r.CourseName AS courseName, r.Details AS details,
                (SELECT e.ExceptionId AS exceptionId,e.Category AS category,e.ScopeType AS scopeType,e.ScopeKey AS scopeKey,
                  e.FacultyId AS facultyId,e.FixedDoe AS fixedDoe,e.Reason AS reason,e.SourceReference AS sourceReference,
                  e.Enabled AS enabled,e.EffectiveStart AS effectiveStart,e.EffectiveEnd AS effectiveEnd,v.PolicyVersionId AS policyVersionId
                  FROM paws.DoePolicyException e JOIN paws.DoePolicyVersion v ON v.PolicyVersionId=e.PolicyVersionId
                  WHERE v.AcademicYear=@academicYear AND v.Status=N'active' AND e.Enabled=1 AND e.ReviewStatus=N'approved'
                    AND (e.FacultyId IS NULL OR e.FacultyId=r.FacultyId)
                    AND ((e.ScopeType IN(N'source_entity',N'assignment') AND e.ScopeKey=CONVERT(nvarchar(128),r.RoleAssignmentId))
                      OR e.ScopeType NOT IN(N'source_entity',N'assignment'))
                  FOR JSON PATH) AS annualExceptionsJson
           FROM paws.RoleAssignment AS r
          WHERE (r.AcademicYear=@academicYear OR r.AcademicYear IS NULL)
            AND r.FacultyId IS NOT NULL AND (@facultyId=N'' OR r.FacultyId=TRY_CONVERT(uniqueidentifier,@facultyId))
          ORDER BY r.FacultyId, r.RoleAssignmentId`, params),
      db.query(
        `SELECT w.ParametersJson AS parametersJson, w.SourceReference AS workloadSourceReference,
                w.SourceSha256 AS workloadSourceSha256, s.SnapshotId AS snapshotId,
                s.FacultyId AS facultyId, s.RawDoe AS rawDoe, s.EvidenceJson AS evidenceJson,
                s.SourceReference AS sourceReference, s.CreatedAtUtc AS calculatedAt
           FROM paws.DoeWorkloadSource AS w
           LEFT JOIN paws.DoeSupervisionSourceSnapshot AS s ON s.AcademicYear=w.AcademicYear
             AND (@facultyId=N'' OR s.FacultyId=TRY_CONVERT(uniqueidentifier,@facultyId))
          WHERE w.AcademicYear=@academicYear`, params),
      db.query(`SELECT AssignmentId AS assignmentFactId,FacultyId AS facultyId,RoleType AS roleType,
        ScopeText AS scopeText,CourseCode AS courseCode,SubjectKey AS subjectKey,DoeValue AS resultDoe,
        Notes AS notes,Revision AS revision,UpdatedAtUtc AS calculatedAt
        FROM paws.ManualDoeAssignment WHERE AcademicYear=@academicYear AND Active=1
          AND (@facultyId=N'' OR FacultyId=TRY_CONVERT(uniqueidentifier,@facultyId))
        ORDER BY FacultyId,CreatedAtUtc,AssignmentId`, params)
    ]);

    if (facultyRows.length > 500) throw Object.assign(new Error('DOE source coverage exceeds 500 faculty; complete coverage is required before producing worksheet or publication evidence.'), { code: 'DOE_SOURCE_LIMIT_EXCEEDED' });
    const policy = policyRows.length === 1 ? policyRows[0] : null;
    const targets = new Map(targetRows.map(row => [text(row.facultyId).toLowerCase(), row]));
    const reservePolicy = {};
    for (const row of reserveRows) {
      const name = text(row.name);
      if (RESERVE_PARAMETERS.has(name)) reservePolicy[name] = row.valueNumber === null ? row.valueText : Number(row.valueNumber);
    }
    const workloadSource = supervisionSourceRows[0] || null;
    const sourceReservePolicy = parseObject(workloadSource?.parametersJson);
    // Explicit, owner-supplied policy evidence fills only absent annual parameters.
    if (sourceReservePolicy) for (const name of RESERVE_PARAMETERS) {
      if (reservePolicy[name] === undefined) reservePolicy[name] = sourceReservePolicy[name];
    }
    const assignmentsByFaculty = new Map();
    const pushLine = (faculty, line) => {
      const key = text(faculty).toLowerCase();
      if (!assignmentsByFaculty.has(key)) assignmentsByFaculty.set(key, []);
      assignmentsByFaculty.get(key).push(line);
    };

    for (const row of assignmentRows) {
      const facts = parseObject(row.factsSnapshotJson) || {};
      const reference = parseObject(row.referenceSnapshotJson);
      pushLine(row.facultyId, {
        lineId: text(row.assignmentFactId), assignmentFactId: text(row.assignmentFactId),
        sourceEntityType: text(row.sourceEntityType), sourceEntityId: text(row.sourceEntityId),
        category: text(row.category), roleType: text(row.roleType), activityType: text(row.activityType),
        scopeText: text(row.scopeText), courseCode: text(row.courseCode), subjectKey: text(row.subjectKey),
        notes: text(row.notes), active: bool(row.active), revision: Number(row.revision || 0),
        sessionId: text(row.sessionId), resultDoe: number(row.resultDoe), status: text(row.calculationStatus) || 'needs_review',
        policyVersionId: text(row.policyVersionId), ruleId: text(row.ruleId), ruleKey: text(row.ruleKey),
        calculationId: text(row.currentCalculationId),
        facts, inputs: parseObject(row.inputsSnapshotJson), parameters: parseObject(row.parameterSnapshotJson),
        rule: parseObject(row.ruleSnapshotJson), reference, calculationText: text(row.calculationText),
        calculatedAt: row.calculatedAt || null,
        errorCode: row.calculationStatus && text(row.calculationStatus).toLowerCase() !== 'calculated' ? text(row.calculationStatus).toUpperCase() : null
      });
    }

    for (const row of manualRows) pushLine(row.facultyId, {
      lineId: text(row.assignmentFactId), assignmentFactId: text(row.assignmentFactId), sourceEntityId: text(row.assignmentFactId),
      sourceEntityType: 'manual_doe_assignment', category: 'role', roleType: text(row.roleType),
      scopeText: text(row.scopeText), courseCode: text(row.courseCode), subjectKey: text(row.subjectKey),
      resultDoe: number(row.resultDoe), status: 'manual', doeSource: 'manual_adjustment', active: true,
      revision: Number(row.revision), notes: text(row.notes), calculatedAt: row.calculatedAt,
      calculationText: 'Negotiated manual adjustment; additive to existing DOE.', reference: { title: 'Administrator-entered negotiated DOE' }
    });

    for (const row of sessionRows) pushLine(row.facultyId, {
      lineId: text(row.sessionAssignmentId), sourceEntityType: 'legacy_session_assignment',
      sourceEntityId: text(row.sessionAssignmentId), category: 'teaching', roleType: text(row.teachingRole),
      sessionId: text(row.sessionId), legacyResultDoe: number(row.doeCredit), legacyDoeStatus: text(row.doeStatus),
      facts: { sessionType: text(row.sessionType) },
      creditedHours: number(row.creditedHours), doeQuantity: number(row.doeQuantity),
      ...resolutionEvidence(resolveTeachingDoe(row))
    });

    for (const row of legacyRoleRows) {
      if (assignmentRows.some(a => text(a.sourceEntityType).toLowerCase() === 'role_assignment'
          && text(a.facultyId).toLowerCase() === text(row.facultyId).toLowerCase()
          && text(a.sourceEntityId).toLowerCase() === text(row.roleAssignmentId).toLowerCase())) continue;
      const resolved = resolutionEvidence(resolveRoleDoe({ ...row, academicYear: row.academicYear || academicYear, courseOrSubjectOrRotation: row.scopeText }));
      const facts = sourceFacts({ facultyId: row.facultyId, academicYear }, {
        lineId: row.roleAssignmentId, sourceEntityId: row.roleAssignmentId, sourceEntityType: 'legacy_role_assignment',
        roleType: row.roleType, scopeText: row.scopeText
      });
      let exceptionRows = [];
      try { exceptionRows = JSON.parse(row.annualExceptionsJson || '[]'); } catch (_) {}
      const exception = (Array.isArray(exceptionRows) ? exceptionRows : []).filter(e => engine.exceptionMatches({ ...e, enabled: bool(e.enabled) }, facts));
      // An approved annual exception only clears a review when it agrees with the recorded allocation.
      const accepted = exception.length === 1 && number(resolved.resultDoe) !== null &&
        Math.abs(Number(exception[0].fixedDoe) - Number(resolved.resultDoe)) < 0.000001 ? exception[0] : null;
      pushLine(row.facultyId, {
      lineId: text(row.roleAssignmentId), sourceEntityType: 'legacy_role_assignment',
      sourceEntityId: text(row.roleAssignmentId), category: 'role', roleType: text(row.roleType),
      scopeText: text(row.scopeText), facts: { ...parseObject(row.sourceFactsJson), sourceDetails: text(row.details), sourceAllocationStatus: text(row.sourceAllocationStatus) },
      legacyResultDoe: number(row.doeOverrideValue) ?? number(row.doeMappedValue), notes: text(row.specialNotes),
      ...resolved,
      ...(accepted ? { status: 'annual_exception', requiresReview: false, reviewReason: null, errorCode: null,
        doeSource: 'annual_exception', policyVersionId: text(accepted.policyVersionId),
        reference: { title: text(accepted.sourceReference), reason: text(accepted.reason), exceptionId: text(accepted.exceptionId) } } : {}),
      overrideReason: text(row.doeOverrideReason), effectiveDate: row.effectiveDate || null, expirationDate: row.expirationDate || null
    });
    }

    for (const row of supervisionSourceRows) {
      if (!row.facultyId || assignmentRows.some(a => text(a.facultyId).toLowerCase() === text(row.facultyId).toLowerCase()
          && ['supervision', 'trainee_supervision'].includes(text(a.category).toLowerCase()))) continue;
      pushLine(row.facultyId, {
        lineId: text(row.snapshotId), sourceEntityId: text(row.snapshotId), sourceEntityType: 'supervision_source_snapshot',
        category: 'supervision', activityType: 'trainee_supervision', scopeText: '# Trainees · current-year source snapshot',
        resultDoe: number(row.rawDoe), status: 'source_snapshot', calculatedAt: row.calculatedAt,
        facts: parseObject(row.evidenceJson), reference: { title: text(row.sourceReference) }
      });
    }

    return facultyRows.map(row => {
      const key = text(row.facultyId).toLowerCase(), targetRow = targets.get(key);
      const lines = assignmentsByFaculty.get(key) || [];
      const versions = [...new Set(lines.map(line => text(line.policyVersionId)).filter(Boolean))];
      const policyStatus = versions.some(versionId => versionId !== text(policy?.policyVersionId)) ? 'mixed'
        : lines.some(line => line.policyVersionId && !policy?.policyVersionId) ? 'missing_version' : 'consistent';
      return {
        facultyId: text(row.facultyId), displayName: text(row.displayName), stream: text(row.stream), facultyActive: bool(row.facultyActive),
        academicYear, policyStatus,
        // Target snapshot provenance is not an annual calculation policy.
        targetPolicyVersionLabel: text(targetRow?.targetPolicyVersionLabel),
        workloadSourceReference: text(workloadSource?.workloadSourceReference),
        supervisionDataAvailable: lines.some(line => ['supervision', 'trainee_supervision'].includes(text(line.category).toLowerCase())),
        target: targetRow ? {
          contractTeachingDoe: number(targetRow.contractTeachingDoe), overrideDoe: number(targetRow.overrideDoe),
          overrideReason: text(targetRow.overrideReason), overrideNotes: text(targetRow.overrideNotes),
          effectiveTargetDoe: number(targetRow.effectiveTargetDoe), source: text(targetRow.source),
          policyVersionId: text(targetRow.policyVersionId)
        } : { contractTeachingDoe: null, overrideDoe: null, effectiveTargetDoe: null },
        reservePolicy: { ...reservePolicy }, lines
      };
    });
  }

  return Object.freeze({
    async getFacultyWorksheetSource(facultyId, academicYear) {
      if (!text(facultyId)) throw new TypeError('Faculty ID is required.');
      return (await loadSources(academicYear, facultyId))[0] || null;
    },
    async listFacultyWorksheetSources(academicYear) {
      return loadSources(academicYear, null);
    }
  });
}

module.exports = { createSqlDoeWorksheetRepository };
