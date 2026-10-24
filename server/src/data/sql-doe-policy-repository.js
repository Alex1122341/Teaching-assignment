'use strict';

const crypto = require('node:crypto');
const { createSqlDoeWorksheetRepository } = require('./sql-doe-worksheet-repository');
const { recordedDataset, datasetChecksum, projectRecordedSource } = require('../doe/doe-recorded-source-impact');

const text = value => value === null || value === undefined ? '' : String(value).trim();
const nullable = value => value === null || value === undefined || value === '' ? null : value;
const bool = value => value === true || value === 1 || value === '1';
const uid = () => crypto.randomUUID();

function policyError(error) {
  const message = String(error?.message || '');
  if (message.includes('DOE_POLICY_REVISION_CONFLICT')) error.code = 'DOE_POLICY_REVISION_CONFLICT';
  else if (message.includes('DOE_POLICY_NOT_DRAFT')) error.code = 'DOE_POLICY_NOT_DRAFT';
  else if (message.includes('DOE_POLICY_NOT_FOUND')) error.code = 'DOE_POLICY_NOT_FOUND';
  else if (message.includes('DOE_POLICY_ALREADY_ACTIVE')) error.code = 'DOE_POLICY_ALREADY_ACTIVE';
  else if (message.includes('DOE_POLICY_VERSION_LABEL_EXISTS')) error.code = 'DOE_POLICY_VERSION_LABEL_EXISTS';
  else if (message.includes('DOE_POLICY_CHANGED')) error.code = 'DOE_POLICY_REVISION_CONFLICT';
  else if (message.includes('DOE_ASSIGNMENT_REVISION_CONFLICT')) error.code = 'DOE_POLICY_REVISION_CONFLICT';
  return error;
}

function object(value) {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function createSqlDoePolicyRepository(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('A SQL query adapter is required.');

  async function loadVersion(policyVersionId) {
    const rows = await db.query(
      `SELECT PolicyVersionId AS policyVersionId, AcademicYear AS academicYear, VersionLabel AS versionLabel,
              SourceReference AS sourceReference, Status AS status, Revision AS revision, UpdatedBy AS updatedBy,
              ValidatedRevision AS validatedRevision, ValidatedChecksum AS validatedChecksum,
              ImpactRevision AS impactRevision, ImpactChecksum AS impactChecksum,
              CreatedAtUtc AS createdAtUtc, UpdatedAtUtc AS updatedAtUtc
         FROM paws.DoePolicyVersion WHERE PolicyVersionId=@policyVersionId`, { policyVersionId });
    const version = rows[0];
    if (!version) return null;
    const p = { policyVersionId };
    const [rules, selectors, parameters, tiers, inputs, references, exceptions, courses, subjects] = await Promise.all([
      db.query(`SELECT RuleId AS ruleId, RuleKey AS ruleKey, Category AS category, ActivityType AS activityType,
                      RuleLabel AS ruleLabel, Priority AS priority, CalculationMode AS calculationMode,
                      TierStrategy AS tierStrategy, FormulaText AS formulaText, MappingRequirement AS mappingRequirement,
                      ResultKind AS resultKind, ReferenceId AS referenceId, Enabled AS enabled, ReviewStatus AS reviewStatus
                 FROM paws.DoePolicyRule WHERE PolicyVersionId=@policyVersionId`, p),
      db.query(`SELECT s.RuleId AS ruleId, s.SelectorId AS selectorId, s.FieldName AS field, s.Operator AS operator,
                      s.ValueType AS valueType, s.ValueText AS valueText, s.ValueNumber AS valueNumber, s.ValuesJson AS valuesJson
                 FROM paws.DoeRuleSelector s JOIN paws.DoePolicyRule r ON r.RuleId=s.RuleId WHERE r.PolicyVersionId=@policyVersionId`, p),
      db.query(`SELECT p.RuleId AS ruleId, p.Name AS name, p.ValueNumber AS valueNumber, p.ValueText AS valueText
                 FROM paws.DoeRuleParameter p JOIN paws.DoePolicyRule r ON r.RuleId=p.RuleId WHERE r.PolicyVersionId=@policyVersionId`, p),
      db.query(`SELECT t.RuleId AS ruleId, t.TierId AS tierId, t.TierOrder AS tierOrder, t.FromValue AS fromValue,
                      t.ToValue AS toValue, t.Rate AS rate, t.FixedCredit AS fixedCredit
                 FROM paws.DoeRuleTier t JOIN paws.DoePolicyRule r ON r.RuleId=t.RuleId WHERE r.PolicyVersionId=@policyVersionId`, p),
      db.query(`SELECT i.RuleId AS ruleId, i.InputName AS inputName, i.Source AS source, i.Required AS required
                 FROM paws.DoeRuleInput i JOIN paws.DoePolicyRule r ON r.RuleId=i.RuleId WHERE r.PolicyVersionId=@policyVersionId`, p),
      db.query(`SELECT ReferenceId AS referenceId, Title AS title, Section AS section, TableName AS tableName,
                      PageNumber AS pageNumber, EffectiveDate AS effectiveDate, SourceReference AS sourceReference,
                      DocumentLink AS documentLink, Notes AS notes, ReviewStatus AS reviewStatus
                 FROM paws.DoeReferenceSource WHERE PolicyVersionId=@policyVersionId`, p),
      db.query(`SELECT ExceptionId AS exceptionId, Category AS category, ScopeType AS scopeType, ScopeKey AS scopeKey,
                      FacultyId AS facultyId, FixedDoe AS fixedDoe, ResultKind AS resultKind, Reason AS reason,
                      SourceReference AS sourceReference, EffectiveStart AS effectiveStart, EffectiveEnd AS effectiveEnd,
                      Recurring AS recurring, Enabled AS enabled, ReviewStatus AS reviewStatus
                 FROM paws.DoePolicyException WHERE PolicyVersionId=@policyVersionId`, p),
      db.query(`SELECT MappingId AS mappingId, CourseCode AS courseCode, UnitCount AS unitCount,
                      CurriculumStage AS curriculumStage, HiccEligible AS hiccEligible, MappingFactsJson AS mappingFactsJson,
                      ReferenceId AS referenceId, ReviewStatus AS reviewStatus, Enabled AS enabled
                 FROM paws.DoeCourseMapping WHERE PolicyVersionId=@policyVersionId`, p),
      db.query(`SELECT MappingId AS mappingId, SubjectKey AS subjectKey, SubjectName AS subjectName,
                      CurriculumStage AS curriculumStage, DevelopmentPhase AS developmentPhase, MappingFactsJson AS mappingFactsJson,
                      ReferenceId AS referenceId, ReviewStatus AS reviewStatus, Enabled AS enabled
                 FROM paws.DoeSubjectMapping WHERE PolicyVersionId=@policyVersionId`, p)
    ]);
    const group = rows => { const map = new Map(); for (const row of rows) { const key = text(row.ruleId); if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; };
    const bySelector = group(selectors), byParameter = group(parameters), byTier = group(tiers), byInput = group(inputs);
    const mappedRules = rules.map(row => ({ ...row, ruleId: text(row.ruleId), ruleKey: text(row.ruleKey), category: text(row.category), priority: Number(row.priority), enabled: bool(row.enabled), selectors: (bySelector.get(text(row.ruleId)) || []).map(x => ({ selectorId: text(x.selectorId), field: text(x.field), operator: text(x.operator), valueType: text(x.valueType), valueText: nullable(x.valueText), valueNumber: x.valueNumber === null ? null : Number(x.valueNumber), values: x.valuesJson ? object(x.valuesJson) : undefined })), parameters: (byParameter.get(text(row.ruleId)) || []).map(x => ({ name: text(x.name), valueNumber: x.valueNumber === null ? null : Number(x.valueNumber), valueText: nullable(x.valueText) })), tiers: (byTier.get(text(row.ruleId)) || []).map(x => ({ tierId: text(x.tierId), tierOrder: Number(x.tierOrder), fromValue: Number(x.fromValue), toValue: x.toValue === null ? null : Number(x.toValue), rate: x.rate === null ? null : Number(x.rate), fixedCredit: x.fixedCredit === null ? null : Number(x.fixedCredit) })), inputs: (byInput.get(text(row.ruleId)) || []).map(x => ({ inputName: text(x.inputName), source: nullable(x.source), required: bool(x.required) })) }));
    const reserveRule = mappedRules.find(rule => text(rule.category).toLowerCase() === 'reserve' && rule.enabled && text(rule.reviewStatus).toLowerCase() === 'approved');
    const reservePolicy = reserveRule ? Object.fromEntries(reserveRule.parameters.filter(item => item.valueNumber !== null).map(item => [item.name, item.valueNumber])) : null;
    return {
      version: { ...version, policyVersionId: text(version.policyVersionId), academicYear: text(version.academicYear), status: text(version.status), revision: Number(version.revision), validatedRevision: version.validatedRevision === null ? null : Number(version.validatedRevision), impactRevision: version.impactRevision === null ? null : Number(version.impactRevision) },
      rules: mappedRules,
      reservePolicy,
      references: references.map(row => ({ ...row, referenceId: text(row.referenceId), title: text(row.title), pageNumber: row.pageNumber === null ? null : Number(row.pageNumber), reviewStatus: text(row.reviewStatus) })),
      exceptions: exceptions.map(row => ({ ...row, exceptionId: text(row.exceptionId), fixedDoe: Number(row.fixedDoe), enabled: bool(row.enabled), recurring: bool(row.recurring) })),
      courseMappings: courses.map(row => ({ ...row, mappingId: text(row.mappingId), unitCount: row.unitCount === null ? null : Number(row.unitCount), hiccEligible: row.hiccEligible === null ? null : bool(row.hiccEligible), mappingFacts: object(row.mappingFactsJson), enabled: bool(row.enabled) })),
      subjectMappings: subjects.map(row => ({ ...row, mappingId: text(row.mappingId), mappingFacts: object(row.mappingFactsJson), enabled: bool(row.enabled) }))
    };
  }

  return Object.freeze({
    getPolicyVersion: loadVersion,

    async createDraft({ academicYear, versionLabel, sourceReference, actorUid, policyVersionId = uid() }) {
      try {
        const rows = await db.query(
          `SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
           IF EXISTS(SELECT 1 FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@academicYear AND VersionLabel=@versionLabel)
             THROW 52601,'DOE_POLICY_VERSION_LABEL_EXISTS',1;
           INSERT INTO paws.DoePolicyVersion(PolicyVersionId,AcademicYear,VersionLabel,SourceReference,Active,Status,Revision,UpdatedBy)
           VALUES(@policyVersionId,@academicYear,@versionLabel,@sourceReference,0,N'draft',0,@actorUid);
           INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,AfterJson)
           VALUES(NEWID(),@policyVersionId,@academicYear,N'draft_created',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,
                  (SELECT @versionLabel AS versionLabel,@sourceReference AS sourceReference FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
           COMMIT; SELECT CONVERT(nvarchar(36),PolicyVersionId) AS policyVersionId,AcademicYear AS academicYear,VersionLabel AS versionLabel,SourceReference AS sourceReference,Status AS status,Revision AS revision FROM paws.DoePolicyVersion WHERE PolicyVersionId=@policyVersionId;
           END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;`,
          { policyVersionId, academicYear, versionLabel, sourceReference, actorUid });
        return rows[0] || { policyVersionId, academicYear, versionLabel, sourceReference, status: 'draft', revision: 0 };
      } catch (error) { throw policyError(error); }
    },

    async saveDraft({ policyVersionId, academicYear, expectedRevision, actorUid, bundle, createVersion = false }) {
      const serializedRules = (bundle.rules || []).map(rule => ({ ...rule,
        selectors: (rule.selectors || []).map(selector => ({ ...selector,
          ...(Array.isArray(selector.values) ? { valuesJson: JSON.stringify(selector.values) } : {}) })),
        parameters: [...(rule.parameters || [])] }));
      if (bundle.reservePolicy) {
        const reserveRule = serializedRules.find(rule => text(rule.category).toLowerCase() === 'reserve');
        if (!reserveRule) throw Object.assign(new Error('DOE_RESERVE_RULE_REQUIRED'), { code: 'DOE_DRAFT_INVALID' });
        const reserveKeys = ['splitThreshold','splitRatio','highTeachingTraineeCeiling','teachingFocusedTraineeCeiling','rollingAverageYears'];
        reserveRule.parameters = reserveRule.parameters.filter(item => !reserveKeys.includes(text(item.name)));
        for (const name of reserveKeys) if (bundle.reservePolicy[name] !== undefined) reserveRule.parameters.push({ name, valueNumber: Number(bundle.reservePolicy[name]) });
      }
      const referencesJson = JSON.stringify(bundle.references || []);
      const rulesJson = JSON.stringify(serializedRules);
      const exceptionsJson = JSON.stringify(bundle.exceptions || []);
      const coursesJson = JSON.stringify((bundle.courseMappings || []).map(row => ({ ...row, mappingFactsJson: typeof row.mappingFactsJson === 'string' ? row.mappingFactsJson : JSON.stringify(row.mappingFacts || {}) })));
      const subjectsJson = JSON.stringify((bundle.subjectMappings || []).map(row => ({ ...row, mappingFactsJson: typeof row.mappingFactsJson === 'string' ? row.mappingFactsJson : JSON.stringify(row.mappingFacts || {}) })));
      try {
        const rows = await db.query(
          `SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
           IF @createVersion=1 BEGIN
             IF EXISTS(SELECT 1 FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@academicYear AND VersionLabel=@versionLabel)
               THROW 52601,'DOE_POLICY_VERSION_LABEL_EXISTS',1;
             INSERT INTO paws.DoePolicyVersion(PolicyVersionId,AcademicYear,VersionLabel,SourceReference,Active,Status,Revision,UpdatedBy)
             VALUES(@policyVersionId,@academicYear,@versionLabel,@sourceReference,0,N'draft',0,@actorUid);
             INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,AfterJson)
             VALUES(NEWID(),@policyVersionId,@academicYear,N'draft_created',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,
                    (SELECT @versionLabel AS versionLabel,@sourceReference AS sourceReference FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
           END;
           DECLARE @beforeJson nvarchar(max);
           SELECT @beforeJson=(SELECT PolicyVersionId AS policyVersionId,AcademicYear AS academicYear,VersionLabel AS versionLabel,SourceReference AS sourceReference,Revision AS revision,ValidatedRevision AS validatedRevision,ImpactRevision AS impactRevision FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE PolicyVersionId=@policyVersionId AND AcademicYear=@academicYear AND Status=N'draft' AND Revision=@expectedRevision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
           IF @beforeJson IS NULL BEGIN
             IF EXISTS(SELECT 1 FROM paws.DoePolicyVersion WHERE PolicyVersionId=@policyVersionId) THROW 52602,'DOE_POLICY_REVISION_CONFLICT',1;
             THROW 52603,'DOE_POLICY_NOT_FOUND',1;
           END;
           SET @beforeJson=JSON_MODIFY(@beforeJson,'$.ruleBook',JSON_QUERY(paws_api.DoeHistoryPolicySnapshot(@policyVersionId)));
           DELETE i FROM paws.DoeRuleInput i JOIN paws.DoePolicyRule r ON r.RuleId=i.RuleId WHERE r.PolicyVersionId=@policyVersionId;
           DELETE s FROM paws.DoeRuleSelector s JOIN paws.DoePolicyRule r ON r.RuleId=s.RuleId WHERE r.PolicyVersionId=@policyVersionId;
           DELETE p FROM paws.DoeRuleParameter p JOIN paws.DoePolicyRule r ON r.RuleId=p.RuleId WHERE r.PolicyVersionId=@policyVersionId;
           DELETE t FROM paws.DoeRuleTier t JOIN paws.DoePolicyRule r ON r.RuleId=t.RuleId WHERE r.PolicyVersionId=@policyVersionId;
           DELETE FROM paws.DoePolicyException WHERE PolicyVersionId=@policyVersionId;
           DELETE FROM paws.DoeCourseMapping WHERE PolicyVersionId=@policyVersionId;
           DELETE FROM paws.DoeSubjectMapping WHERE PolicyVersionId=@policyVersionId;
           DELETE FROM paws.DoePolicyRule WHERE PolicyVersionId=@policyVersionId;
           DELETE FROM paws.DoeReferenceSource WHERE PolicyVersionId=@policyVersionId;
           INSERT INTO paws.DoeReferenceSource(ReferenceId,PolicyVersionId,AcademicYear,Title,Section,TableName,PageNumber,EffectiveDate,SourceReference,DocumentLink,Notes,ReviewStatus)
           SELECT COALESCE(ReferenceId,NEWID()),@policyVersionId,@academicYear,Title,Section,TableName,PageNumber,EffectiveDate,SourceReference,DocumentLink,Notes,COALESCE(ReviewStatus,N'needs_review')
             FROM OPENJSON(@referencesJson) WITH(ReferenceId uniqueidentifier '$.referenceId',Title nvarchar(256) '$.title',Section nvarchar(256) '$.section',TableName nvarchar(128) '$.tableName',PageNumber int '$.pageNumber',EffectiveDate date '$.effectiveDate',SourceReference nvarchar(1000) '$.sourceReference',DocumentLink nvarchar(1000) '$.documentLink',Notes nvarchar(2000) '$.notes',ReviewStatus nvarchar(32) '$.reviewStatus');
           DECLARE @ruleJson TABLE(RuleId uniqueidentifier,RuleKey nvarchar(128),Category nvarchar(64),ActivityType nvarchar(128),RuleLabel nvarchar(256),Priority int,CalculationMode nvarchar(40),TierStrategy nvarchar(32),FormulaText nvarchar(1000),MappingRequirement nvarchar(16),ResultKind nvarchar(16),ReferenceId uniqueidentifier,Enabled bit,ReviewStatus nvarchar(32),SelectorJson nvarchar(max),ParameterJson nvarchar(max),TierJson nvarchar(max),InputJson nvarchar(max));
           INSERT INTO @ruleJson SELECT COALESCE(RuleId,NEWID()),RuleKey,Category,ActivityType,RuleLabel,COALESCE(Priority,0),CalculationMode,TierStrategy,FormulaText,MappingRequirement,COALESCE(ResultKind,N'credit'),ReferenceId,COALESCE(Enabled,1),COALESCE(ReviewStatus,N'needs_review'),SelectorJson,ParameterJson,TierJson,InputJson
             FROM OPENJSON(@rulesJson) WITH(RuleId uniqueidentifier '$.ruleId',RuleKey nvarchar(128) '$.ruleKey',Category nvarchar(64) '$.category',ActivityType nvarchar(128) '$.activityType',RuleLabel nvarchar(256) '$.ruleLabel',Priority int '$.priority',CalculationMode nvarchar(40) '$.calculationMode',TierStrategy nvarchar(32) '$.tierStrategy',FormulaText nvarchar(1000) '$.formulaText',MappingRequirement nvarchar(16) '$.mappingRequirement',ResultKind nvarchar(16) '$.resultKind',ReferenceId uniqueidentifier '$.referenceId',Enabled bit '$.enabled',ReviewStatus nvarchar(32) '$.reviewStatus',SelectorJson nvarchar(max) '$.selectors' AS JSON,ParameterJson nvarchar(max) '$.parameters' AS JSON,TierJson nvarchar(max) '$.tiers' AS JSON,InputJson nvarchar(max) '$.inputs' AS JSON);
           INSERT INTO paws.DoePolicyRule(RuleId,PolicyVersionId,AcademicYear,RuleKey,Category,ActivityType,RuleLabel,Priority,CalculationMode,TierStrategy,FormulaText,MappingRequirement,ResultKind,ReferenceId,Enabled,ReviewStatus)
           SELECT RuleId,@policyVersionId,@academicYear,RuleKey,Category,ActivityType,RuleLabel,Priority,CalculationMode,TierStrategy,FormulaText,MappingRequirement,ResultKind,ReferenceId,Enabled,ReviewStatus FROM @ruleJson;
           INSERT INTO paws.DoeRuleSelector(SelectorId,RuleId,FieldName,Operator,ValueType,ValueText,ValueNumber,ValuesJson)
           SELECT COALESCE(j.SelectorId,NEWID()),r.RuleId,j.FieldName,j.Operator,COALESCE(j.ValueType,N'text'),j.ValueText,j.ValueNumber,j.ValuesJson
             FROM @ruleJson r CROSS APPLY OPENJSON(r.SelectorJson) WITH(SelectorId uniqueidentifier '$.selectorId',FieldName nvarchar(128) '$.field',Operator nvarchar(16) '$.operator',ValueType nvarchar(16) '$.valueType',ValueText nvarchar(1000) '$.valueText',ValueNumber decimal(18,6) '$.valueNumber',ValuesJson nvarchar(2000) '$.valuesJson') j;
           INSERT INTO paws.DoeRuleParameter(ParameterId,RuleId,Name,ValueNumber,ValueText)
           SELECT COALESCE(j.ParameterId,NEWID()),r.RuleId,j.Name,j.ValueNumber,j.ValueText FROM @ruleJson r CROSS APPLY OPENJSON(r.ParameterJson) WITH(ParameterId uniqueidentifier '$.parameterId',Name nvarchar(128) '$.name',ValueNumber decimal(18,6) '$.valueNumber',ValueText nvarchar(1000) '$.valueText') j;
           INSERT INTO paws.DoeRuleTier(TierId,RuleId,TierOrder,FromValue,ToValue,Rate,FixedCredit)
           SELECT COALESCE(j.TierId,NEWID()),r.RuleId,j.TierOrder,j.FromValue,j.ToValue,j.Rate,j.FixedCredit FROM @ruleJson r CROSS APPLY OPENJSON(r.TierJson) WITH(TierId uniqueidentifier '$.tierId',TierOrder int '$.tierOrder',FromValue decimal(18,6) '$.fromValue',ToValue decimal(18,6) '$.toValue',Rate decimal(18,6) '$.rate',FixedCredit decimal(18,6) '$.fixedCredit') j;
           INSERT INTO paws.DoeRuleInput(RuleInputId,RuleId,InputName,Source,Required)
           SELECT NEWID(),r.RuleId,COALESCE(j.InputName,j.InputText),j.Source,COALESCE(j.Required,1) FROM @ruleJson r CROSS APPLY OPENJSON(r.InputJson) WITH(InputName nvarchar(128) '$.inputName',InputText nvarchar(128) '$',Source nvarchar(256) '$.source',Required bit '$.required') j;
           INSERT INTO paws.DoePolicyException(ExceptionId,PolicyVersionId,AcademicYear,Category,ScopeType,ScopeKey,FacultyId,FixedDoe,ResultKind,Reason,SourceReference,EffectiveStart,EffectiveEnd,Recurring,Enabled,ReviewStatus)
           SELECT COALESCE(ExceptionId,NEWID()),@policyVersionId,@academicYear,Category,ScopeType,ScopeKey,FacultyId,FixedDoe,COALESCE(ResultKind,N'credit'),Reason,SourceReference,EffectiveStart,EffectiveEnd,COALESCE(Recurring,0),COALESCE(Enabled,1),COALESCE(ReviewStatus,N'needs_review') FROM OPENJSON(@exceptionsJson) WITH(ExceptionId uniqueidentifier '$.exceptionId',Category nvarchar(64) '$.category',ScopeType nvarchar(32) '$.scopeType',ScopeKey nvarchar(256) '$.scopeKey',FacultyId uniqueidentifier '$.facultyId',FixedDoe decimal(12,6) '$.fixedDoe',ResultKind nvarchar(16) '$.resultKind',Reason nvarchar(1000) '$.reason',SourceReference nvarchar(1000) '$.sourceReference',EffectiveStart date '$.effectiveStart',EffectiveEnd date '$.effectiveEnd',Recurring bit '$.recurring',Enabled bit '$.enabled',ReviewStatus nvarchar(32) '$.reviewStatus');
           INSERT INTO paws.DoeCourseMapping(MappingId,PolicyVersionId,AcademicYear,CourseCode,UnitCount,CurriculumStage,HiccEligible,MappingFactsJson,ReferenceId,ReviewStatus,Enabled)
           SELECT COALESCE(MappingId,NEWID()),@policyVersionId,@academicYear,CourseCode,UnitCount,CurriculumStage,HiccEligible,MappingFactsJson,ReferenceId,COALESCE(ReviewStatus,N'needs_review'),COALESCE(Enabled,1) FROM OPENJSON(@coursesJson) WITH(MappingId uniqueidentifier '$.mappingId',CourseCode nvarchar(64) '$.courseCode',UnitCount decimal(10,4) '$.unitCount',CurriculumStage nvarchar(64) '$.curriculumStage',HiccEligible bit '$.hiccEligible',MappingFactsJson nvarchar(4000) '$.mappingFactsJson',ReferenceId uniqueidentifier '$.referenceId',ReviewStatus nvarchar(32) '$.reviewStatus',Enabled bit '$.enabled');
           INSERT INTO paws.DoeSubjectMapping(MappingId,PolicyVersionId,AcademicYear,SubjectKey,SubjectName,CurriculumStage,DevelopmentPhase,MappingFactsJson,ReferenceId,ReviewStatus,Enabled)
           SELECT COALESCE(MappingId,NEWID()),@policyVersionId,@academicYear,SubjectKey,SubjectName,CurriculumStage,DevelopmentPhase,MappingFactsJson,ReferenceId,COALESCE(ReviewStatus,N'needs_review'),COALESCE(Enabled,1) FROM OPENJSON(@subjectsJson) WITH(MappingId uniqueidentifier '$.mappingId',SubjectKey nvarchar(128) '$.subjectKey',SubjectName nvarchar(256) '$.subjectName',CurriculumStage nvarchar(64) '$.curriculumStage',DevelopmentPhase nvarchar(64) '$.developmentPhase',MappingFactsJson nvarchar(4000) '$.mappingFactsJson',ReferenceId uniqueidentifier '$.referenceId',ReviewStatus nvarchar(32) '$.reviewStatus',Enabled bit '$.enabled');
           UPDATE paws.DoePolicyVersion SET VersionLabel=COALESCE(NULLIF(@versionLabel,N''),VersionLabel),SourceReference=COALESCE(NULLIF(@sourceReference,N''),SourceReference),Revision=Revision+1,ValidatedRevision=NULL,ValidatedChecksum=NULL,ImpactRevision=NULL,ImpactChecksum=NULL,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME() WHERE PolicyVersionId=@policyVersionId AND Status=N'draft' AND Revision=@expectedRevision;
           IF @@ROWCOUNT<>1 THROW 52602,'DOE_POLICY_REVISION_CONFLICT',1;
           INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,BeforeJson,AfterJson)
           VALUES(NEWID(),@policyVersionId,@academicYear,N'draft_updated',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,@beforeJson,
                  (SELECT @expectedRevision+1 AS revision,@versionLabel AS versionLabel,@sourceReference AS sourceReference,JSON_QUERY(paws_api.DoeHistoryPolicySnapshot(@policyVersionId)) AS ruleBook FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
           COMMIT; SELECT @policyVersionId AS policyVersionId,@academicYear AS academicYear,N'draft' AS status,@expectedRevision+1 AS revision;
           END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;`,
          { policyVersionId, academicYear, expectedRevision, actorUid, createVersion, versionLabel: bundle.version.versionLabel, sourceReference: bundle.version.sourceReference, rulesJson, referencesJson, exceptionsJson, coursesJson, subjectsJson });
        return rows[0] || { policyVersionId, academicYear, status: 'draft', revision: expectedRevision + 1 };
      } catch (error) { throw policyError(error); }
    },

    async markValidated({ policyVersionId, academicYear, revision, checksum, valid, errors, actorUid }) {
      const rows = await db.query(
        `SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
         UPDATE paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) SET ValidatedRevision=CASE WHEN @valid=1 THEN @revision ELSE NULL END,ValidatedChecksum=CASE WHEN @valid=1 THEN @checksum ELSE NULL END,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME()
          WHERE PolicyVersionId=@policyVersionId AND AcademicYear=@academicYear AND Status=N'draft' AND Revision=@revision;
         IF @@ROWCOUNT<>1 THROW 52602,'DOE_POLICY_REVISION_CONFLICT',1;
         INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,AfterJson)
         VALUES(NEWID(),@policyVersionId,@academicYear,N'draft_validated',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,
                (SELECT @revision AS revision,@valid AS valid,@checksum AS checksum,@errors AS errors FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
         COMMIT; SELECT @revision AS revision,@checksum AS checksum,@valid AS valid; END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;`,
        { policyVersionId, academicYear, revision, checksum, valid: valid ? 1 : 0, errors: JSON.stringify(errors || []), actorUid });
      return rows[0] || { revision, checksum, valid };
    },

    async previewImpact({ policyVersionId, academicYear, revision, checksum, actorUid, calculate }) {
      const policy = await loadVersion(policyVersionId);
      if (!policy || text(policy.version.academicYear) !== text(academicYear) || text(policy.version.status).toLowerCase() !== 'draft' || Number(policy.version.revision) !== Number(revision)) {
        throw Object.assign(new Error('DOE_POLICY_REVISION_CONFLICT'), { code: 'DOE_POLICY_REVISION_CONFLICT' });
      }
      if (typeof calculate !== 'function') throw Object.assign(new Error('DOE impact preview requires a policy calculation runner.'), { code: 'DOE_IMPACT_PREVIEW_UNAVAILABLE' });
      const sources = await db.query(
        `SELECT TOP (2001) a.AssignmentFactId AS assignmentFactId,a.FacultyId AS facultyId,a.AcademicYear AS academicYear,
                a.Category AS category,a.RoleType AS roleType,a.ActivityType AS activityType,a.ScopeText AS scopeText,
                a.CourseCode AS courseCode,a.SubjectKey AS subjectKey,a.SessionId AS sessionId,
                a.SessionAssignmentId AS sessionAssignmentId,a.SourceEntityType AS sourceEntityType,
                a.SourceEntityId AS sourceEntityId,a.Revision AS revision,c.ResultDoe AS oldDoe,
                (SELECT i.InputName AS inputName,i.ValueType AS valueType,i.ValueText AS valueText,i.ValueNumber AS valueNumber
                   FROM paws.DoeAssignmentFactInput i WHERE i.AssignmentFactId=a.AssignmentFactId FOR JSON PATH) AS inputsJson
           FROM paws.DoeAssignmentFact a LEFT JOIN paws.DoeCalculationRecord c ON c.CalculationId=a.CurrentCalculationId
          WHERE a.AcademicYear=@academicYear AND a.Active=1
          ORDER BY a.AssignmentFactId`, { academicYear });
      if (sources.length > 2000) throw Object.assign(new Error('DOE impact preview exceeds the bounded 2000-assignment limit.'), { code: 'DOE_IMPACT_LIMIT_EXCEEDED' });

      const rows = [];
      const affectedFaculty = new Set();
      let assignmentsChanged = 0, needsReview = 0, mappingGaps = 0, totalDelta = 0;
      for (const source of sources) {
        const facts = {
          academicYear: text(source.academicYear), category: text(source.category), roleType: nullable(source.roleType),
          teachingRole: nullable(source.roleType), activityType: nullable(source.activityType), courseCode: nullable(source.courseCode),
          subjectKey: nullable(source.subjectKey), facultyId: text(source.facultyId), sessionId: nullable(source.sessionId),
          assignmentId: text(source.assignmentFactId), sourceEntityType: text(source.sourceEntityType),
          sourceEntityId: text(source.sourceEntityId), scopeText: nullable(source.scopeText)
        };
        for (const input of object(source.inputsJson)) {
          if (!input || !text(input.inputName)) continue;
          facts[text(input.inputName)] = text(input.valueType).toLowerCase() === 'number' ? Number(input.valueNumber) : text(input.valueType).toLowerCase() === 'boolean' ? text(input.valueText).toLowerCase() === 'true' : input.valueText;
        }
        try {
          const projection = await calculate(facts);
          const oldDoe = source.oldDoe === null ? null : Number(source.oldDoe);
          const projectedDoe = Number(projection.resultDoe);
          const changed = oldDoe === null || Math.abs(oldDoe - projectedDoe) > 0.000001;
          const deltaDoe = oldDoe === null ? null : Number((projectedDoe - oldDoe).toFixed(6));
          if (changed) { assignmentsChanged++; affectedFaculty.add(text(source.facultyId)); }
          if (deltaDoe !== null) totalDelta += deltaDoe;
          rows.push({ facultyId: source.facultyId, sourceEntityType: 'doe_assignment', sourceEntityId: text(source.assignmentFactId), oldDoe, projectedDoe, deltaDoe, status: changed ? 'calculated' : 'unchanged', issueCode: null });
        } catch (error) {
          const issueCode = text(error.code) || 'NEEDS_REVIEW';
          const needsMappingStatus = ['COURSE_MAPPING_REQUIRED','SUBJECT_MAPPING_REQUIRED'].includes(issueCode);
          needsReview++;
          if (needsMappingStatus) mappingGaps++;
          rows.push({ facultyId: source.facultyId, sourceEntityType: 'doe_assignment', sourceEntityId: text(source.assignmentFactId), oldDoe: source.oldDoe === null ? null : Number(source.oldDoe), projectedDoe: null, deltaDoe: null, status: needsMappingStatus ? 'needs_mapping' : 'needs_review', issueCode });
        }
      }
      const impactRunId = uid();
      const recorded = recordedDataset(await createSqlDoeWorksheetRepository(db).listFacultyWorksheetSources(academicYear));
      if (recorded.length + sources.length > 10000) throw Object.assign(new Error('DOE source impact exceeds the bounded 10000-line limit.'), { code: 'DOE_IMPACT_LIMIT_EXCEEDED' });
      for (const sourceLine of recorded) {
        const row = await projectRecordedSource({ ...sourceLine, calculate });
        if (row.issueCode) { needsReview++; if (row.status === 'needs_mapping') mappingGaps++; }
        else if (row.status !== 'unchanged') { assignmentsChanged++; affectedFaculty.add(text(row.facultyId)); }
        if (row.deltaDoe !== null) totalDelta += row.deltaDoe;
        rows.push(row);
      }
      const inputDatasetChecksum = datasetChecksum(sources, recorded);
      const rowJson = JSON.stringify(rows);
      const results = await db.query(
        `SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
         IF NOT EXISTS(SELECT 1 FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE PolicyVersionId=@policyVersionId AND AcademicYear=@academicYear AND Status=N'draft' AND Revision=@revision AND ValidatedRevision=@revision AND ValidatedChecksum=@checksum)
           THROW 52602,'DOE_POLICY_REVISION_CONFLICT',1;
         INSERT INTO paws.DoeImpactRun(ImpactRunId,PolicyVersionId,AcademicYear,DraftRevision,DraftChecksum,InputDatasetChecksum,FacultyAffected,AssignmentsChanged,NeedsReview,MappingGaps,TotalDelta,CreatedBy)
         VALUES(@impactRunId,@policyVersionId,@academicYear,@revision,@checksum,@inputDatasetChecksum,@facultyAffected,@assignmentsChanged,@needsReview,@mappingGaps,@totalDelta,@actorUid);
         INSERT INTO paws.DoeImpactRunRow(ImpactRunRowId,ImpactRunId,FacultyId,SourceEntityType,SourceEntityId,OldDoe,ProjectedDoe,DeltaDoe,Status,IssueCode)
         SELECT NEWID(),@impactRunId,FacultyId,SourceEntityType,SourceEntityId,OldDoe,ProjectedDoe,DeltaDoe,Status,IssueCode
           FROM OPENJSON(@rowsJson) WITH(FacultyId uniqueidentifier '$.facultyId',SourceEntityType nvarchar(64) '$.sourceEntityType',SourceEntityId nvarchar(128) '$.sourceEntityId',OldDoe decimal(12,6) '$.oldDoe',ProjectedDoe decimal(12,6) '$.projectedDoe',DeltaDoe decimal(12,6) '$.deltaDoe',Status nvarchar(24) '$.status',IssueCode nvarchar(64) '$.issueCode');
         UPDATE paws.DoePolicyVersion SET ImpactRevision=@revision,ImpactChecksum=@checksum,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME() WHERE PolicyVersionId=@policyVersionId AND Revision=@revision AND Status=N'draft';
         INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,AfterJson)
         VALUES(NEWID(),@policyVersionId,@academicYear,N'impact_previewed',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,
           (SELECT @impactRunId AS impactRunId,@revision AS revision,@facultyAffected AS facultyAffected,@assignmentsChanged AS assignmentsChanged,@needsReview AS needsReview,@mappingGaps AS mappingGaps,@totalDelta AS totalDelta FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
         COMMIT; SELECT CONVERT(nvarchar(36),@impactRunId) AS impactRunId,@revision AS revision,@facultyAffected AS facultyAffected,@assignmentsChanged AS assignmentsChanged,@needsReview AS needsReview,@mappingGaps AS mappingGaps,@totalDelta AS totalDelta,@inputDatasetChecksum AS inputDatasetChecksum;
         END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;`,
        { impactRunId, policyVersionId, academicYear, revision, checksum, inputDatasetChecksum, facultyAffected: affectedFaculty.size, assignmentsChanged, needsReview, mappingGaps, totalDelta: Number(totalDelta.toFixed(6)), actorUid, rowsJson: rowJson }
      );
      return results[0] || { impactRunId, revision, facultyAffected: affectedFaculty.size, assignmentsChanged, needsReview, mappingGaps, totalDelta: Number(totalDelta.toFixed(6)), inputDatasetChecksum };
    },

    async publishPolicy({ policyVersionId, academicYear, revision, actorUid }) {
      if (typeof db.transaction === 'function' && !db.isTransactionActive?.()) {
        return db.transaction(() => this.publishPolicy({ policyVersionId, academicYear, revision, actorUid }));
      }
      try {
        // The real SQL adapter holds SERIALIZABLE source reads through publication.
        if (typeof db.transaction === 'function') {
          const impact = await db.query(`SELECT TOP(1) InputDatasetChecksum AS inputDatasetChecksum,NeedsReview AS needsReview
            FROM paws.DoeImpactRun WHERE PolicyVersionId=@policyVersionId AND DraftRevision=@revision ORDER BY CreatedAtUtc DESC`,
            { policyVersionId, revision });
          const normalized = await db.query(`SELECT TOP (2001) a.AssignmentFactId AS assignmentFactId,a.FacultyId AS facultyId,a.AcademicYear AS academicYear,
                a.Category AS category,a.RoleType AS roleType,a.ActivityType AS activityType,a.ScopeText AS scopeText,
                a.CourseCode AS courseCode,a.SubjectKey AS subjectKey,a.SessionId AS sessionId,
                a.SessionAssignmentId AS sessionAssignmentId,a.SourceEntityType AS sourceEntityType,
                a.SourceEntityId AS sourceEntityId,a.Revision AS revision,c.ResultDoe AS oldDoe,
                (SELECT i.InputName AS inputName,i.ValueType AS valueType,i.ValueText AS valueText,i.ValueNumber AS valueNumber
                   FROM paws.DoeAssignmentFactInput i WHERE i.AssignmentFactId=a.AssignmentFactId FOR JSON PATH) AS inputsJson
           FROM paws.DoeAssignmentFact a LEFT JOIN paws.DoeCalculationRecord c ON c.CalculationId=a.CurrentCalculationId
          WHERE a.AcademicYear=@academicYear AND a.Active=1 ORDER BY a.AssignmentFactId`, { academicYear });
          const recorded = recordedDataset(await createSqlDoeWorksheetRepository(db).listFacultyWorksheetSources(academicYear));
          if (!impact.length || Number(impact[0].needsReview) !== 0 ||
              impact[0].inputDatasetChecksum !== datasetChecksum(normalized, recorded)) {
            throw Object.assign(new Error('Current DOE sources must pass a fresh complete Impact Preview before publication.'), { code: 'DOE_IMPACT_STALE_OR_INCOMPLETE' });
          }
        }
        const rows = await db.query(
          `SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
           DECLARE @checksum char(64),@impactRunId uniqueidentifier,@publicationId uniqueidentifier=NEWID(),@before nvarchar(max),@publicBefore nvarchar(max);
           SELECT @checksum=ValidatedChecksum FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE PolicyVersionId=@policyVersionId AND AcademicYear=@academicYear AND Status=N'draft' AND Revision=@revision AND ValidatedRevision=@revision AND ImpactRevision=@revision;
           SELECT @before=(SELECT PolicyVersionId AS policyVersionId,Status AS status,Revision AS revision FROM paws.DoePolicyVersion WHERE PolicyVersionId=@policyVersionId AND AcademicYear=@academicYear AND Status=N'draft' AND Revision=@revision AND ValidatedRevision=@revision AND ImpactRevision=@revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@impactRunId=(SELECT TOP(1) ImpactRunId FROM paws.DoeImpactRun WHERE PolicyVersionId=@policyVersionId AND DraftRevision=@revision ORDER BY CreatedAtUtc DESC);
           IF @before IS NULL THROW 52602,'DOE_POLICY_REVISION_CONFLICT',1;
           IF @checksum IS NULL OR @impactRunId IS NULL THROW 52604,'DOE_VALIDATION_OR_IMPACT_REQUIRED',1;
           SELECT @publicBefore=paws_api.DoeHistoryPolicySnapshot(PolicyVersionId) FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@academicYear AND Status=N'active';
           SET @before=JSON_MODIFY(@before,'$.publishedRuleBook',JSON_QUERY(@publicBefore));
           UPDATE paws.DoePolicyVersion SET Status=N'archived',Active=0,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME() WHERE AcademicYear=@academicYear AND Status=N'active';
           UPDATE paws.DoePolicyVersion SET Status=N'active',Active=1,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME() WHERE PolicyVersionId=@policyVersionId AND Revision=@revision;
           INSERT INTO paws.DoePolicyPublication(PublicationId,PolicyVersionId,AcademicYear,Revision,PolicyChecksum,ImpactRunId,PublishedBy)
           VALUES(@publicationId,@policyVersionId,@academicYear,@revision,@checksum,@impactRunId,@actorUid);
           INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,BeforeJson,AfterJson)
           VALUES(NEWID(),@policyVersionId,@academicYear,N'published',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,@before,
                  (SELECT @publicationId AS publicationId,@revision AS revision,@checksum AS checksum,@impactRunId AS impactRunId,JSON_QUERY(paws_api.DoeHistoryPolicySnapshot(@policyVersionId)) AS ruleBook FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
           COMMIT; SELECT CONVERT(nvarchar(36),@publicationId) AS publicationId,CONVERT(nvarchar(36),@policyVersionId) AS policyVersionId,@academicYear AS academicYear,@revision AS revision,@checksum AS checksum,N'active' AS status; END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;`,
          { policyVersionId, academicYear, revision, actorUid });
        return rows[0] || { policyVersionId, academicYear, revision, status: 'active' };
      } catch (error) { throw policyError(error); }
    },

    async clonePolicy({ sourcePolicyVersionId, sourceAcademicYear, academicYear, actorUid, includeExceptions = false, reuseWorkingDraft = false }) {
      if (reuseWorkingDraft) {
        if (typeof db.transaction !== 'function') throw Object.assign(new Error('Atomic working Draft creation is unavailable.'), { code: 'DOE_UNAVAILABLE' });
        if (!db.isTransactionActive?.()) return db.transaction(() => this.clonePolicy({sourcePolicyVersionId,sourceAcademicYear,academicYear,actorUid,includeExceptions,reuseWorkingDraft}));
        const locked = await db.query(`SELECT PolicyVersionId FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE PolicyVersionId=@sourcePolicyVersionId AND AcademicYear=@academicYear AND Status=N'active'`, {sourcePolicyVersionId,academicYear});
        if (!locked.length) throw Object.assign(new Error('The Active policy changed. Reload the Rule Book.'), {code:'ACTIVE_POLICY_REQUIRED'});
        const existing = await db.query(`SELECT TOP(1) v.PolicyVersionId AS policyVersionId FROM paws.DoePolicyVersion v JOIN paws.DoeAuditEvent a ON a.PolicyVersionId=v.PolicyVersionId WHERE v.AcademicYear=@academicYear AND v.Status=N'draft' AND a.Action=N'working_draft_created' AND JSON_VALUE(a.AfterJson,'$.sourcePolicyVersionId')=@sourcePolicyVersionId ORDER BY v.CreatedAtUtc DESC`, {sourcePolicyVersionId,academicYear});
        if (existing.length) return loadVersion(existing[0].policyVersionId);
      }
      const source = await loadVersion(sourcePolicyVersionId);
      if (!source) throw Object.assign(new Error('DOE_POLICY_NOT_FOUND'), { code: 'DOE_POLICY_NOT_FOUND' });
      const newPolicyVersionId = uid();
      const referenceIds = new Map((source.references || []).map(row => [row.referenceId, uid()]));
      const ruleIds = new Map((source.rules || []).map(row => [row.ruleId, uid()]));
      const next = { ...source, version: { ...source.version, policyVersionId: newPolicyVersionId, academicYear, status: 'draft', revision: 0, versionLabel: `${text(source.version.versionLabel).slice(0,48)} copy ${newPolicyVersionId.slice(0,8)}`, sourceReference: source.version.sourceReference },
        references: source.references.map(row => ({ ...row, referenceId: referenceIds.get(row.referenceId) })),
        rules: source.rules.map(row => ({ ...row, ruleId: ruleIds.get(row.ruleId), referenceId: row.referenceId ? referenceIds.get(row.referenceId) : null, selectors: row.selectors.map(item => ({ ...item, selectorId: uid() })), parameters: row.parameters.map(item => ({ ...item, parameterId: uid() })), tiers: row.tiers.map(item => ({ ...item, tierId: uid() })), inputs: row.inputs.map(item => ({ ...item })) })),
        exceptions: includeExceptions ? source.exceptions.map(row => ({ ...row, exceptionId: uid() })) : [],
        courseMappings: source.courseMappings.map(row => ({ ...row, mappingId: uid(), referenceId: row.referenceId ? referenceIds.get(row.referenceId) : null })),
        subjectMappings: source.subjectMappings.map(row => ({ ...row, mappingId: uid(), referenceId: row.referenceId ? referenceIds.get(row.referenceId) : null })) };
      if (text(source.version.academicYear) !== text(academicYear)) {
        for (const rows of [next.rules,next.references,next.courseMappings,next.subjectMappings]) for (const row of rows) row.reviewStatus = 'needs_review';
      }
      const id = next.version.policyVersionId;
      if (reuseWorkingDraft) next.version.versionLabel = `${text(source.version.versionLabel).slice(0,80)} · working Draft ${id.slice(0,8)}`;
      const saved = await this.saveDraft({ policyVersionId: id, academicYear, expectedRevision: 0, actorUid, bundle: next, createVersion: true });
      if (reuseWorkingDraft) await db.query(`INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,AfterJson) VALUES(NEWID(),@policyVersionId,@academicYear,N'working_draft_created',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,(SELECT @sourcePolicyVersionId AS sourcePolicyVersionId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER))`, {policyVersionId:id,academicYear,actorUid,sourcePolicyVersionId});
      return saved;
    },

    async getImpactPreview(policyVersionId) {
      const runs = await db.query(`SELECT TOP (1) ImpactRunId AS impactRunId, DraftRevision AS revision, FacultyAffected AS facultyAffected, AssignmentsChanged AS assignmentsChanged, NeedsReview AS needsReview, MappingGaps AS mappingGaps, TotalDelta AS totalDelta, CreatedAtUtc AS createdAtUtc FROM paws.DoeImpactRun WHERE PolicyVersionId=@policyVersionId ORDER BY CreatedAtUtc DESC`, { policyVersionId });
      if (!runs[0]) return null;
      const rows = await db.query(`SELECT FacultyId AS facultyId,SourceEntityId AS sourceEntityId,OldDoe AS oldDoe,ProjectedDoe AS projectedDoe,DeltaDoe AS deltaDoe,Status AS status,IssueCode AS issueCode FROM paws.DoeImpactRunRow WHERE ImpactRunId=@impactRunId ORDER BY FacultyId,SourceEntityId`, { impactRunId: runs[0].impactRunId });
      return { ...runs[0], rows };
    },

    async listHistory(academicYear) {
      return db.query(`SELECT v.PolicyVersionId AS policyVersionId,v.AcademicYear AS academicYear,v.VersionLabel AS versionLabel,v.SourceReference AS sourceReference,v.Status AS status,v.Revision AS revision,v.UpdatedBy AS updatedBy,v.CreatedAtUtc AS createdAtUtc,v.UpdatedAtUtc AS updatedAtUtc,p.PublicationId AS publicationId,p.PolicyChecksum AS policyChecksum,p.PublishedBy AS publishedBy,p.PublishedAtUtc AS publishedAtUtc
                        FROM paws.DoePolicyVersion v LEFT JOIN paws.DoePolicyPublication p ON p.PolicyVersionId=v.PolicyVersionId
                       WHERE v.AcademicYear=@academicYear ORDER BY v.CreatedAtUtc DESC,p.PublishedAtUtc DESC`, { academicYear });
    },

    async archivePolicy({ policyVersionId, expectedRevision, actorUid }) {
      try {
        const rows = await db.query(`SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION; DECLARE @year nvarchar(32),@before nvarchar(max);
          SELECT @before=(SELECT PolicyVersionId AS policyVersionId,AcademicYear AS academicYear,Status AS status,Revision AS revision FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE PolicyVersionId=@policyVersionId AND Revision=@expectedRevision AND Status IN(N'draft',N'archived') FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
          IF @before IS NULL THROW 52602,'DOE_POLICY_REVISION_CONFLICT',1;
          SELECT @year=AcademicYear FROM paws.DoePolicyVersion WHERE PolicyVersionId=@policyVersionId;
          UPDATE paws.DoePolicyVersion SET Status=N'archived',Active=0,Revision=Revision+1,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME() WHERE PolicyVersionId=@policyVersionId AND Revision=@expectedRevision;
          INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,BeforeJson,AfterJson) VALUES(NEWID(),@policyVersionId,@year,N'archived',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,@before,N'{"status":"archived"}');
          COMMIT; SELECT CONVERT(nvarchar(36),@policyVersionId) AS policyVersionId,@year AS academicYear,N'archived' AS status,@expectedRevision+1 AS revision; END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;`, { policyVersionId, expectedRevision, actorUid });
        return rows[0] || { policyVersionId, status: 'archived', revision: expectedRevision + 1 };
      } catch (error) { throw policyError(error); }
    },

    async recalculate({ academicYear, policyVersionId, policyRevision, actorUid, limit = 250, calculate, preview = false }) {
      if (typeof calculate !== 'function') throw Object.assign(new Error('DOE recalculation requires the active-policy calculation runner.'), { code: 'DOE_RECALCULATION_UNAVAILABLE' });
      const boundedLimit = Number.isSafeInteger(Number(limit)) ? Math.min(250, Math.max(1, Number(limit))) : 250;
      const sources = await db.query(
        `SELECT TOP (@limit) a.AssignmentFactId AS assignmentFactId,a.FacultyId AS facultyId,a.AcademicYear AS academicYear,
                a.Category AS category,a.RoleType AS roleType,a.ActivityType AS activityType,a.ScopeText AS scopeText,
                a.CourseCode AS courseCode,a.SubjectKey AS subjectKey,a.SessionId AS sessionId,
                a.SessionAssignmentId AS sessionAssignmentId,a.SourceEntityType AS sourceEntityType,
                a.SourceEntityId AS sourceEntityId,a.Revision AS revision,
                (SELECT i.InputName AS inputName,i.ValueType AS valueType,i.ValueText AS valueText,i.ValueNumber AS valueNumber
                   FROM paws.DoeAssignmentFactInput i WHERE i.AssignmentFactId=a.AssignmentFactId FOR JSON PATH) AS inputsJson
           FROM paws.DoeAssignmentFact a LEFT JOIN paws.DoeCalculationRecord currentCalc ON currentCalc.CalculationId=a.CurrentCalculationId
          WHERE a.AcademicYear=@academicYear AND a.Active=1 AND (currentCalc.CalculationId IS NULL OR currentCalc.PolicyVersionId<>@policyVersionId)
          ORDER BY a.AssignmentFactId`, { academicYear, policyVersionId, limit: boundedLimit });
      const records = [];
      let needsReview = 0;
      for (const source of sources) {
        const facts = {
          academicYear: text(source.academicYear), category: text(source.category), roleType: nullable(source.roleType),
          teachingRole: nullable(source.roleType), activityType: nullable(source.activityType), courseCode: nullable(source.courseCode),
          subjectKey: nullable(source.subjectKey), facultyId: text(source.facultyId), sessionId: nullable(source.sessionId),
          assignmentId: text(source.assignmentFactId), sourceEntityType: text(source.sourceEntityType),
          sourceEntityId: text(source.sourceEntityId), scopeText: nullable(source.scopeText)
        };
        for (const input of object(source.inputsJson)) {
          if (!input || !text(input.inputName)) continue;
          facts[text(input.inputName)] = text(input.valueType).toLowerCase() === 'number' ? Number(input.valueNumber) : text(input.valueType).toLowerCase() === 'boolean' ? text(input.valueText).toLowerCase() === 'true' : input.valueText;
        }
        try {
          const result = await calculate(facts);
          records.push({
            calculationId: uid(), assignmentFactId: source.assignmentFactId, sourceRevision: Number(source.revision),
            academicYear: text(source.academicYear), policyVersionId: text(result.policyVersionId || policyVersionId), ruleId: nullable(result.ruleId),
            ruleKey: nullable(result.ruleKey), exceptionId: nullable(result.exceptionId), category: text(result.category || source.category),
            facultyId: text(source.facultyId), sessionId: nullable(source.sessionId), assignmentId: text(source.assignmentFactId),
            sourceEntityType: 'doe_assignment', sourceEntityId: text(source.assignmentFactId), factsJson: JSON.stringify(result.factsSnapshot || facts),
            inputsJson: JSON.stringify(result.inputsSnapshot || {}), parametersJson: JSON.stringify(result.parameterSnapshot || {}),
            ruleJson: JSON.stringify(result.ruleSnapshot || {}), referenceJson: result.referenceSnapshot ? JSON.stringify(result.referenceSnapshot) : null,
            calculationText: text(result.calculationText), resultDoe: Number(result.resultDoe), status: 'calculated',
            calculationTrigger: 'policy_recalculate', calculatedBy: actorUid
          });
        } catch (error) {
          needsReview++;
          const issueCode = text(error.code) || 'NEEDS_REVIEW';
          records.push({
            calculationId: uid(), assignmentFactId: source.assignmentFactId, sourceRevision: Number(source.revision),
            academicYear: text(source.academicYear), policyVersionId, ruleId: null, ruleKey: null, exceptionId: null,
            category: text(source.category), facultyId: text(source.facultyId), sessionId: nullable(source.sessionId),
            assignmentId: text(source.assignmentFactId), sourceEntityType: 'doe_assignment', sourceEntityId: text(source.assignmentFactId),
            factsJson: JSON.stringify(facts), inputsJson: '{}', parametersJson: '{}',
            ruleJson: JSON.stringify({ status: 'needs_review', issueCode, message: text(error.message) }), referenceJson: null,
            calculationText: text(error.message), resultDoe: null, status: 'needs_review', calculationTrigger: 'policy_recalculate', calculatedBy: actorUid
          });
        }
      }
      if (preview) return { preview: true, policyVersionId, policyRevision, recordsProjected: records.length, needsReview,
        scope: 'normalized_assignment_facts', limit: boundedLimit,
        rows: records.map(row => ({ assignmentFactId: row.assignmentFactId, facultyId: row.facultyId, sourceRevision: row.sourceRevision, resultDoe: row.resultDoe, status: row.status, calculationText: row.calculationText })) };
      const rowsJson = JSON.stringify(records);
      const results = await db.query(
        `SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
         IF NOT EXISTS(SELECT 1 FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE PolicyVersionId=@policyVersionId AND AcademicYear=@academicYear AND Status=N'active' AND Revision=@policyRevision)
           THROW 52605,'DOE_POLICY_CHANGED',1;
         IF EXISTS(SELECT 1 FROM OPENJSON(@rowsJson) WITH(AssignmentFactId uniqueidentifier '$.assignmentFactId',SourceRevision bigint '$.sourceRevision') j
                   LEFT JOIN paws.DoeAssignmentFact a WITH(UPDLOCK,HOLDLOCK) ON a.AssignmentFactId=j.AssignmentFactId AND a.AcademicYear=@academicYear AND a.Active=1 AND a.Revision=j.SourceRevision
                   WHERE a.AssignmentFactId IS NULL)
           THROW 52606,'DOE_ASSIGNMENT_REVISION_CONFLICT',1;
         INSERT INTO paws.DoeCalculationRecord(CalculationId,AcademicYear,PolicyVersionId,RuleId,RuleKey,ExceptionId,Category,FacultyId,SessionId,AssignmentId,SourceEntityType,SourceEntityId,FactsSnapshotJson,InputsSnapshotJson,ParameterSnapshotJson,RuleSnapshotJson,ReferenceSnapshotJson,CalculationText,ResultDoe,CalculationStatus,CalculationTrigger,CalculatedBy)
         SELECT CalculationId,AcademicYear,PolicyVersionId,RuleId,RuleKey,ExceptionId,Category,FacultyId,SessionId,AssignmentId,SourceEntityType,SourceEntityId,FactsJson,InputsJson,ParametersJson,RuleJson,ReferenceJson,CalculationText,ResultDoe,Status,CalculationTrigger,CalculatedBy
           FROM OPENJSON(@rowsJson) WITH(CalculationId uniqueidentifier '$.calculationId',AssignmentFactId uniqueidentifier '$.assignmentFactId',SourceRevision bigint '$.sourceRevision',AcademicYear nvarchar(32) '$.academicYear',PolicyVersionId uniqueidentifier '$.policyVersionId',RuleId uniqueidentifier '$.ruleId',RuleKey nvarchar(128) '$.ruleKey',ExceptionId uniqueidentifier '$.exceptionId',Category nvarchar(64) '$.category',FacultyId uniqueidentifier '$.facultyId',SessionId uniqueidentifier '$.sessionId',AssignmentId uniqueidentifier '$.assignmentId',SourceEntityType nvarchar(64) '$.sourceEntityType',SourceEntityId nvarchar(128) '$.sourceEntityId',FactsJson nvarchar(max) '$.factsJson',InputsJson nvarchar(max) '$.inputsJson',ParametersJson nvarchar(max) '$.parametersJson',RuleJson nvarchar(max) '$.ruleJson',ReferenceJson nvarchar(max) '$.referenceJson',CalculationText nvarchar(1000) '$.calculationText',ResultDoe decimal(12,6) '$.resultDoe',Status nvarchar(24) '$.status',CalculationTrigger nvarchar(64) '$.calculationTrigger',CalculatedBy nvarchar(128) '$.calculatedBy');
         UPDATE a SET CurrentCalculationId=j.CalculationId,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME()
           FROM paws.DoeAssignmentFact a JOIN OPENJSON(@rowsJson) WITH(AssignmentFactId uniqueidentifier '$.assignmentFactId',SourceRevision bigint '$.sourceRevision',CalculationId uniqueidentifier '$.calculationId') j
             ON a.AssignmentFactId=j.AssignmentFactId AND a.Revision=j.SourceRevision AND a.Active=1 AND a.AcademicYear=@academicYear;
         INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,AfterJson)
         VALUES(NEWID(),@policyVersionId,@academicYear,N'recalculated',N'doe_policy_version',CONVERT(nvarchar(128),@policyVersionId),@actorUid,
           (SELECT @recordCount AS recordsCreated,@needsReview AS needsReview,@policyRevision AS policyRevision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
         COMMIT; SELECT @recordCount AS recordsCreated,@needsReview AS needsReview,@policyVersionId AS policyVersionId,@policyRevision AS policyRevision;
         END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;`,
        { policyVersionId, academicYear, policyRevision, actorUid, rowsJson, recordCount: records.length, needsReview }
      ).catch(error => { throw policyError(error); });
      const remaining = await db.query(`SELECT COUNT_BIG(*) AS remaining FROM paws.DoeAssignmentFact a LEFT JOIN paws.DoeCalculationRecord c ON c.CalculationId=a.CurrentCalculationId WHERE a.AcademicYear=@academicYear AND a.Active=1 AND (c.CalculationId IS NULL OR c.PolicyVersionId<>@policyVersionId)`, { academicYear, policyVersionId });
      return { ...(results[0] || { recordsCreated: records.length, needsReview, policyVersionId, policyRevision }), limit: boundedLimit, remaining: Number(remaining[0]?.remaining || 0) };
    }
  });
}

module.exports = { createSqlDoePolicyRepository };
