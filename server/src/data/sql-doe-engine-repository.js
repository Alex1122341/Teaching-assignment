'use strict';

const text = value => value === null || value === undefined ? '' : String(value).trim();
const nullableText = value => value === null || value === undefined ? null : String(value).trim();
const bool = value => value === true || value === 1 || value === '1';
const json = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { throw new Error('DOE policy contains invalid normalized JSON.'); }
};

function createSqlDoeEngineRepository(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('A SQL query adapter is required.');

  return {
    async loadActivePolicy(academicYear) {
      const versions = await db.query(
        `SELECT TOP (1) PolicyVersionId AS policyVersionId, AcademicYear AS academicYear,
                VersionLabel AS versionLabel, SourceReference AS sourceReference,
                Status AS status, Revision AS revision, UpdatedBy AS updatedBy,
                ValidatedRevision AS validatedRevision, ValidatedChecksum AS validatedChecksum,
                ImpactRevision AS impactRevision, ImpactChecksum AS impactChecksum,
                CreatedAtUtc AS createdAtUtc, UpdatedAtUtc AS updatedAtUtc
           FROM paws.DoePolicyVersion WITH (HOLDLOCK)
          WHERE AcademicYear=@academicYear AND Status=N'active'
          ORDER BY UpdatedAtUtc DESC, PolicyVersionId` ,
        { academicYear }
      );
      const version = versions[0];
      if (!version) return null;
      const policyVersionId = version.policyVersionId;
      const childParams = { policyVersionId };
      const [ruleRows, selectorRows, parameterRows, tierRows, inputRows, references,
        exceptions, courseMappings, subjectMappings] = await Promise.all([
        db.query(`SELECT RuleId AS ruleId, PolicyVersionId AS policyVersionId, RuleKey AS ruleKey,
                         Category AS category, ActivityType AS activityType, RuleLabel AS ruleLabel,
                         Priority AS priority, CalculationMode AS calculationMode, TierStrategy AS tierStrategy,
                         FormulaText AS formulaText, MappingRequirement AS mappingRequirement,
                         ResultKind AS resultKind, ReferenceId AS referenceId, Enabled AS enabled,
                         ReviewStatus AS reviewStatus
                    FROM paws.DoePolicyRule WHERE PolicyVersionId=@policyVersionId ORDER BY Priority DESC, RuleKey`, childParams),
        db.query(`SELECT s.RuleId AS ruleId, s.FieldName AS field, s.Operator AS operator,
                         s.ValueType AS valueType, s.ValueText AS valueText, s.ValueNumber AS valueNumber,
                         s.ValuesJson AS valuesJson
                    FROM paws.DoeRuleSelector s INNER JOIN paws.DoePolicyRule r ON r.RuleId=s.RuleId
                   WHERE r.PolicyVersionId=@policyVersionId ORDER BY r.RuleKey, s.FieldName`, childParams),
        db.query(`SELECT p.RuleId AS ruleId, p.Name AS name, p.ValueNumber AS valueNumber, p.ValueText AS valueText
                    FROM paws.DoeRuleParameter p INNER JOIN paws.DoePolicyRule r ON r.RuleId=p.RuleId
                   WHERE r.PolicyVersionId=@policyVersionId ORDER BY r.RuleKey, p.Name`, childParams),
        db.query(`SELECT t.RuleId AS ruleId, t.TierOrder AS tierOrder, t.FromValue AS fromValue,
                         t.ToValue AS toValue, t.Rate AS rate, t.FixedCredit AS fixedCredit
                    FROM paws.DoeRuleTier t INNER JOIN paws.DoePolicyRule r ON r.RuleId=t.RuleId
                   WHERE r.PolicyVersionId=@policyVersionId ORDER BY r.RuleKey, t.TierOrder`, childParams),
        db.query(`SELECT i.RuleId AS ruleId, i.InputName AS inputName, i.Source AS source, i.Required AS required
                    FROM paws.DoeRuleInput i INNER JOIN paws.DoePolicyRule r ON r.RuleId=i.RuleId
                   WHERE r.PolicyVersionId=@policyVersionId ORDER BY r.RuleKey, i.InputName`, childParams),
        db.query(`SELECT ReferenceId AS referenceId, Title AS title, Section AS section, TableName AS tableName,
                         PageNumber AS pageNumber, EffectiveDate AS effectiveDate, SourceReference AS sourceReference,
                         DocumentLink AS documentLink, Notes AS notes, ReviewStatus AS reviewStatus
                    FROM paws.DoeReferenceSource WHERE PolicyVersionId=@policyVersionId ORDER BY Title, ReferenceId`, childParams),
        db.query(`SELECT ExceptionId AS exceptionId, PolicyVersionId AS policyVersionId, AcademicYear AS academicYear,
                         Category AS category, ScopeType AS scopeType, ScopeKey AS scopeKey, FacultyId AS facultyId,
                         FixedDoe AS fixedDoe, ResultKind AS resultKind, Reason AS reason,
                         SourceReference AS sourceReference, EffectiveStart AS effectiveStart, EffectiveEnd AS effectiveEnd,
                         Recurring AS recurring, Enabled AS enabled, ReviewStatus AS reviewStatus
                    FROM paws.DoePolicyException WHERE PolicyVersionId=@policyVersionId ORDER BY ExceptionId`, childParams),
        db.query(`SELECT MappingId AS mappingId, CourseCode AS courseCode, UnitCount AS unitCount,
                         CurriculumStage AS curriculumStage, HiccEligible AS hiccEligible,
                         MappingFactsJson AS mappingFactsJson, ReferenceId AS referenceId,
                         ReviewStatus AS reviewStatus, Enabled AS enabled
                    FROM paws.DoeCourseMapping WHERE PolicyVersionId=@policyVersionId ORDER BY CourseCode`, childParams),
        db.query(`SELECT MappingId AS mappingId, SubjectKey AS subjectKey, SubjectName AS subjectName,
                         CurriculumStage AS curriculumStage, DevelopmentPhase AS developmentPhase,
                         MappingFactsJson AS mappingFactsJson, ReferenceId AS referenceId,
                         ReviewStatus AS reviewStatus, Enabled AS enabled
                    FROM paws.DoeSubjectMapping WHERE PolicyVersionId=@policyVersionId ORDER BY SubjectKey`, childParams)
      ]);

      const byRule = rows => {
        const map = new Map();
        for (const row of rows) {
          const key = text(row.ruleId);
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(row);
        }
        return map;
      };
      const selectors = byRule(selectorRows), parameters = byRule(parameterRows), tiers = byRule(tierRows), inputs = byRule(inputRows);
      const rules = ruleRows.map(row => ({
        ruleId: text(row.ruleId), ruleKey: text(row.ruleKey), category: text(row.category),
        activityType: nullableText(row.activityType), ruleLabel: text(row.ruleLabel), priority: Number(row.priority),
        calculationMode: text(row.calculationMode), tierStrategy: nullableText(row.tierStrategy),
        formulaText: nullableText(row.formulaText), mappingRequirement: nullableText(row.mappingRequirement),
        resultKind: text(row.resultKind), referenceId: nullableText(row.referenceId), enabled: bool(row.enabled),
        reviewStatus: text(row.reviewStatus),
        selectors: (selectors.get(text(row.ruleId)) || []).map(item => ({
          field: text(item.field), operator: text(item.operator),
          valueText: item.valueText === null ? null : text(item.valueText),
          valueNumber: item.valueNumber === null ? null : Number(item.valueNumber),
          values: json(item.valuesJson, undefined)
        })),
        parameters: (parameters.get(text(row.ruleId)) || []).map(item => ({
          name: text(item.name), valueNumber: item.valueNumber === null ? null : Number(item.valueNumber),
          valueText: nullableText(item.valueText)
        })),
        tiers: (tiers.get(text(row.ruleId)) || []).map(item => ({
          tierOrder: Number(item.tierOrder), fromValue: Number(item.fromValue),
          toValue: item.toValue === null ? null : Number(item.toValue),
          rate: item.rate === null ? null : Number(item.rate),
          fixedCredit: item.fixedCredit === null ? null : Number(item.fixedCredit)
        })),
        inputs: (inputs.get(text(row.ruleId)) || []).map(item => ({
          inputName: text(item.inputName), source: nullableText(item.source), required: bool(item.required)
        }))
      }));

      return {
        version: { ...version, policyVersionId: text(policyVersionId), academicYear: text(version.academicYear), status: text(version.status), revision: Number(version.revision) },
        rules,
        references: references.map(row => ({ ...row, referenceId: text(row.referenceId), title: text(row.title), pageNumber: row.pageNumber === null ? null : Number(row.pageNumber), effectiveDate: row.effectiveDate ? new Date(row.effectiveDate).toISOString().slice(0, 10) : null })),
        exceptions: exceptions.map(row => ({ ...row, exceptionId: text(row.exceptionId), category: nullableText(row.category), fixedDoe: Number(row.fixedDoe), enabled: bool(row.enabled), recurring: bool(row.recurring), reviewStatus: text(row.reviewStatus) })),
        courseMappings: courseMappings.map(row => ({ ...row, mappingId: text(row.mappingId), courseCode: text(row.courseCode), unitCount: row.unitCount === null ? null : Number(row.unitCount), hiccEligible: row.hiccEligible === null ? null : bool(row.hiccEligible), enabled: bool(row.enabled), reviewStatus: text(row.reviewStatus) })),
        subjectMappings: subjectMappings.map(row => ({ ...row, mappingId: text(row.mappingId), subjectKey: text(row.subjectKey), subjectName: text(row.subjectName), enabled: bool(row.enabled), reviewStatus: text(row.reviewStatus) }))
      };
    }
  };
}

module.exports = { createSqlDoeEngineRepository };
