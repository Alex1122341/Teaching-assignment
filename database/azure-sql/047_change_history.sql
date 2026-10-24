/* Read-only history source plus forward event-time evidence. No audit backfill,
   business-data changes, role memberships, write-gate or policy activation. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 54700,'History migration requires VetMed-Ops.',1;
IF OBJECT_ID(N'paws.AuditEvent',N'U') IS NULL OR OBJECT_ID(N'paws.DoeAuditEvent',N'U') IS NULL
 OR OBJECT_ID(N'paws_api.CommitCalendarActivityImport',N'P') IS NULL
 OR OBJECT_ID(N'paws.SwapCandidate',N'U') IS NULL THROW 54700,'History prerequisites are missing.',1;
IF OBJECT_ID(N'paws.ChangeHistoryContext') IS NOT NULL OR OBJECT_ID(N'paws_api.ListChangeHistoryEvents') IS NOT NULL
 OR OBJECT_ID(N'paws_api.HistoryAffectedFaculty') IS NOT NULL OR OBJECT_ID(N'paws_api.DoeHistoryPolicySnapshot') IS NOT NULL
 OR OBJECT_ID(N'paws.CaptureChangeHistoryContext') IS NOT NULL
 OR DATABASE_PRINCIPAL_ID(N'paws_runtime_history_read') IS NOT NULL
 THROW 54700,'History objects already exist; inspect rather than reapplying.',1;
BEGIN TRANSACTION;
CREATE TABLE paws.ChangeHistoryContext(
 AuditEventId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES paws.AuditEvent(AuditEventId),
 ContextJson nvarchar(max) NOT NULL CHECK(ISJSON(ContextJson)=1),
 CapturedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE FUNCTION paws_api.HistoryAffectedFaculty(@Before nvarchar(max),@After nvarchar(max),@Context nvarchar(max))
RETURNS TABLE AS RETURN
(
 SELECT DISTINCT FacultyId FROM (
 SELECT TRY_CONVERT(uniqueidentifier,COALESCE(JSON_VALUE(j.value,'$.facultyId'),JSON_VALUE(j.value,'$.FacultyId'))) FacultyId
 FROM OPENJSON(CASE WHEN LEFT(LTRIM(COALESCE(@Before,N'')),1)=N'[' THEN @Before ELSE COALESCE(JSON_QUERY(@Before,'$.assignments'),N'[]') END) j
 UNION ALL
 SELECT TRY_CONVERT(uniqueidentifier,COALESCE(JSON_VALUE(j.value,'$.facultyId'),JSON_VALUE(j.value,'$.FacultyId')))
 FROM OPENJSON(CASE WHEN LEFT(LTRIM(COALESCE(@After,N'')),1)=N'[' THEN @After ELSE COALESCE(JSON_QUERY(@After,'$.assignments'),N'[]') END) j
 UNION ALL
 SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.facultyId')) FROM OPENJSON(@Context,'$.affectedFaculty') j
 UNION ALL SELECT TRY_CONVERT(uniqueidentifier,COALESCE(JSON_VALUE(@Before,'$.facultyId'),JSON_VALUE(@Before,'$.FacultyId')))
 UNION ALL SELECT TRY_CONVERT(uniqueidentifier,COALESCE(JSON_VALUE(@After,'$.facultyId'),JSON_VALUE(@After,'$.FacultyId')))
 UNION ALL SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(@Context,'$.facultyId'))
 ) evidence WHERE FacultyId IS NOT NULL
);
GO
CREATE FUNCTION paws_api.DoeHistoryPolicySnapshot(@PolicyVersionId uniqueidentifier) RETURNS nvarchar(max) AS
BEGIN
 RETURN (
 SELECT JSON_QUERY((SELECT r.RuleKey ruleKey,r.Category category,r.ActivityType activityType,r.RuleLabel ruleLabel,r.Priority priority,
 r.CalculationMode calculationMode,r.TierStrategy tierStrategy,r.FormulaText formulaText,r.MappingRequirement mappingRequirement,r.ResultKind resultKind,r.ReferenceId referenceId,r.Enabled enabled,r.ReviewStatus reviewStatus,
 JSON_QUERY((SELECT s.FieldName field,s.Operator operator,s.ValueType valueType,s.ValueText valueText,s.ValueNumber valueNumber,s.ValuesJson valuesJson FROM paws.DoeRuleSelector s WHERE s.RuleId=r.RuleId ORDER BY s.FieldName,s.Operator,s.SelectorId FOR JSON PATH,INCLUDE_NULL_VALUES)) selectors,
 JSON_QUERY((SELECT p.Name name,p.ValueNumber valueNumber,p.ValueText valueText FROM paws.DoeRuleParameter p WHERE p.RuleId=r.RuleId ORDER BY p.Name FOR JSON PATH,INCLUDE_NULL_VALUES)) parameters,
 JSON_QUERY((SELECT t.TierOrder tierOrder,t.FromValue fromValue,t.ToValue toValue,t.Rate rate,t.FixedCredit fixedCredit FROM paws.DoeRuleTier t WHERE t.RuleId=r.RuleId ORDER BY t.TierOrder FOR JSON PATH,INCLUDE_NULL_VALUES)) tiers,
 JSON_QUERY((SELECT i.InputName inputName,i.Source source,i.Required required FROM paws.DoeRuleInput i WHERE i.RuleId=r.RuleId ORDER BY i.InputName FOR JSON PATH,INCLUDE_NULL_VALUES)) inputs
 FROM paws.DoePolicyRule r WHERE r.PolicyVersionId=@PolicyVersionId ORDER BY r.RuleKey FOR JSON PATH,INCLUDE_NULL_VALUES)) rules,
 JSON_QUERY((SELECT c.MappingId mappingId,c.CourseCode courseCode,c.UnitCount unitCount,c.CurriculumStage curriculumStage,c.HiccEligible hiccEligible,c.MappingFactsJson mappingFactsJson,c.ReferenceId referenceId,c.ReviewStatus reviewStatus,c.Enabled enabled FROM paws.DoeCourseMapping c WHERE c.PolicyVersionId=@PolicyVersionId ORDER BY c.CourseCode,c.MappingId FOR JSON PATH,INCLUDE_NULL_VALUES)) courseMappings,
 JSON_QUERY((SELECT s.MappingId mappingId,s.SubjectKey subjectKey,s.SubjectName subjectName,s.CurriculumStage curriculumStage,s.DevelopmentPhase developmentPhase,s.MappingFactsJson mappingFactsJson,s.ReferenceId referenceId,s.ReviewStatus reviewStatus,s.Enabled enabled FROM paws.DoeSubjectMapping s WHERE s.PolicyVersionId=@PolicyVersionId ORDER BY s.SubjectKey,s.MappingId FOR JSON PATH,INCLUDE_NULL_VALUES)) subjectMappings,
 JSON_QUERY((SELECT x.ExceptionId exceptionId,x.Category category,x.ScopeType scopeType,x.ScopeKey scopeKey,x.FacultyId facultyId,x.FixedDoe fixedDoe,x.ResultKind resultKind,x.Reason reason,x.SourceReference sourceReference,x.EffectiveStart effectiveStart,x.EffectiveEnd effectiveEnd,x.Recurring recurring,x.Enabled enabled,x.ReviewStatus reviewStatus FROM paws.DoePolicyException x WHERE x.PolicyVersionId=@PolicyVersionId ORDER BY x.ExceptionId FOR JSON PATH,INCLUDE_NULL_VALUES)) exceptions,
 JSON_QUERY((SELECT s.ReferenceId referenceId,s.Title title,s.Section section,s.TableName tableName,s.PageNumber pageNumber,s.EffectiveDate effectiveDate,s.SourceReference sourceReference,s.DocumentLink documentLink,s.Notes notes,s.ReviewStatus reviewStatus FROM paws.DoeReferenceSource s WHERE s.PolicyVersionId=@PolicyVersionId ORDER BY s.Title,s.ReferenceId FOR JSON PATH,INCLUDE_NULL_VALUES)) [references]
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
END;
GO
CREATE TRIGGER paws.CaptureChangeHistoryContext ON paws.AuditEvent AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 -- This reads current relationships ONLY for events being inserted in this
 -- transaction. Old audits are deliberately never populated from current data.
 INSERT paws.ChangeHistoryContext(AuditEventId,ContextJson)
 SELECT e.AuditEventId,(
 SELECT s.CourseCode courseCode,s.CourseName courseName,s.Topic topic,s.AcademicYear academicYear,subject.Label viscSubject,
 COALESCE(TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.AfterJson,'$.facultyId')),TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.BeforeJson,'$.facultyId')),
 CASE WHEN e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored') THEN TRY_CONVERT(uniqueidentifier,e.EntityId) END,roleRow.FacultyId,requestRow.FacultyId,activity.FacultyId) facultyId,
 JSON_QUERY(CASE WHEN activity.ActivityId IS NOT NULL THEN(SELECT activity.FacultyId facultyId,activity.OriginalLabel label,JSON_VALUE(e.MetadataJson,'$.activityDate') date,CONVERT(char(5),dayTime.StartTime,108) startTime,CONVERT(char(5),dayTime.EndTime,108) endTime FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) END) workActivity,
 JSON_QUERY((SELECT DISTINCT f.FacultyId facultyId,c.CandidateKey facultyKey,
 COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) displayName
 FROM paws.Faculty f LEFT JOIN paws.SwapCandidate c ON c.FacultyId=f.FacultyId
 WHERE f.FacultyId IN(SELECT FacultyId FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,NULL))
 OR f.FacultyId IN(SELECT a.FacultyId FROM paws.SessionAssignment a WHERE a.SessionId=s.SessionId)
 OR f.FacultyId=roleRow.FacultyId OR f.FacultyId=requestRow.FacultyId OR f.FacultyId=activity.FacultyId
 OR (e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored') AND f.FacultyId=TRY_CONVERT(uniqueidentifier,e.EntityId))
 FOR JSON PATH)) affectedFaculty
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)
 FROM inserted e
 LEFT JOIN paws.Session s ON s.SessionId=CASE WHEN e.EntityType=N'session' THEN TRY_CONVERT(uniqueidentifier,e.EntityId)
 WHEN e.EventType=N'swap_applied' THEN TRY_CONVERT(uniqueidentifier,COALESCE(JSON_VALUE(e.AfterJson,'$.SessionId'),JSON_VALUE(e.BeforeJson,'$.SessionId'))) END
 LEFT JOIN paws.TeachingSessionOwnership ownership ON ownership.SessionId=s.SessionId
 LEFT JOIN paws.Subject subject ON subject.SubjectId=ownership.SubjectId
 LEFT JOIN paws.RoleAssignment roleRow ON e.EventType=N'role_periods_updated' AND roleRow.RoleAssignmentId=TRY_CONVERT(uniqueidentifier,e.EntityId)
 LEFT JOIN paws.AfcRequest requestRow ON e.EntityType=N'afc_request' AND requestRow.AfcRequestId=TRY_CONVERT(uniqueidentifier,e.EntityId)
 LEFT JOIN paws.CalendarActivity activity ON e.EventType=N'calendar_activity_time_resolved' AND activity.ActivityId=TRY_CONVERT(uniqueidentifier,e.EntityId)
 LEFT JOIN paws.CalendarActivityDayTime dayTime ON dayTime.ActivityId=activity.ActivityId AND dayTime.ActivityDate=TRY_CONVERT(date,JSON_VALUE(e.MetadataJson,'$.activityDate'))
 WHERE e.EventType IN(N'session_updated',N'session_created',N'session_assignments_replaced',N'swap_applied',N'session_deleted',N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored',N'role_periods_updated',
 N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected',N'calendar_activity_time_resolved');
END;
GO
CREATE PROCEDURE paws_api.ListChangeHistoryEvents
 @ActorFirebaseUid nvarchar(128),@Scope nvarchar(16),@StartUtc datetime2(7),@EndExclusiveUtc datetime2(7)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Role nvarchar(128),@Faculty uniqueidentifier,@Admin bit=0;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@Faculty=FacultyId FROM paws.UserProfile
 WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL OR @Role NOT IN(N'owner',N'administrator',N'admin',N'developer',N'adfa_general',N'adfa_regular',N'faculty',N'hicc',N'visc',N'adc',N'lab')
 OR (@Role IN(N'faculty',N'hicc',N'visc') AND @Faculty IS NULL) THROW 54701,'History role denied.',1;
 IF @Scope NOT IN(N'mine',N'timetable',N'dashboard') OR @StartUtc IS NULL OR @EndExclusiveUtc IS NULL OR @StartUtc>=@EndExclusiveUtc
 OR DATEDIFF(day,@StartUtc,@EndExclusiveUtc)>3660 THROW 54702,'Invalid history range or scope.',1;
 IF @Scope=N'mine' AND @Faculty IS NULL THROW 54703,'My history requires a faculty link.',1;
 IF @Role IN(N'owner',N'administrator',N'admin',N'developer',N'adfa_general',N'adfa_regular') SET @Admin=1;
 SELECT TOP(10001) * INTO #HistoryEvents FROM (
 SELECT N'audit' source,CONVERT(nvarchar(36),e.AuditEventId) eventId,e.EventType eventType,e.EntityType entityType,e.EntityId entityId,
 e.OccurredAtUtc occurredAtUtc,e.BeforeJson beforeJson,e.AfterJson afterJson,e.MetadataJson metadataJson,c.ContextJson contextJson,
 CASE WHEN @Admin=1 THEN e.ActorName END actorName,CAST(NULL AS nvarchar(32)) academicYear,CAST(NULL AS uniqueidentifier) facultyId
 FROM paws.AuditEvent e LEFT JOIN paws.ChangeHistoryContext c ON c.AuditEventId=e.AuditEventId
 WHERE e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc AND (
 (@Scope IN(N'mine',N'timetable') AND e.EventType IN(N'session_updated',N'session_created',N'session_assignments_replaced',N'swap_applied',N'session_deleted')
 AND (@Scope=N'timetable' OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,c.ContextJson) af WHERE af.FacultyId=@Faculty)))
 OR (@Scope=N'dashboard' AND e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored',N'role_periods_updated',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected')
 AND (@Admin=1 OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,c.ContextJson) af WHERE af.FacultyId=@Faculty)
 OR(e.EventType IN(N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected') AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.MetadataJson,'$.facultyId'))=@Faculty)
 OR(e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored') AND TRY_CONVERT(uniqueidentifier,e.EntityId)=@Faculty)))
 )
 UNION ALL
 SELECT N'doe',CONVERT(nvarchar(36),e.AuditEventId),e.Action,e.EntityType,e.EntityId,e.ChangedAtUtc,e.BeforeJson,e.AfterJson,NULL,
 (SELECT CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM paws.DoePolicyPublication p WHERE p.PolicyVersionId=e.PolicyVersionId) THEN 1 ELSE 0 END) wasPublished FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),
 CASE WHEN @Admin=1 THEN e.ActorName END,e.AcademicYear,e.FacultyId
 FROM paws.DoeAuditEvent e WHERE @Scope=N'dashboard' AND e.ChangedAtUtc>=@StartUtc AND e.ChangedAtUtc<@EndExclusiveUtc
 AND ((e.EntityType=N'doe_policy_version' AND e.Action IN(N'draft_created',N'draft_updated',N'working_draft_created',N'published',N'archived')
 AND (@Admin=1 OR e.Action=N'published' OR(e.Action=N'archived' AND EXISTS(SELECT 1 FROM paws.DoePolicyPublication p WHERE p.PolicyVersionId=e.PolicyVersionId AND p.PublishedAtUtc<=e.ChangedAtUtc))))
 OR(e.EntityType IN(N'doe_assignment',N'faculty_doe_target',N'manual_doe_assignment') AND (@Admin=1 OR e.FacultyId=@Faculty)))
 UNION ALL
 -- Receipt/recovery bindings prove historical membership without inferring it
 -- from today's assignments. Only immutable source activity facts are selected;
 -- confidential AFC recovery before-images never leave this read procedure.
 SELECT N'work',CONCAT(CONVERT(nvarchar(36),e.AuditEventId),N':',CONVERT(nvarchar(36),recovery.ActivityId)),e.EventType,N'calendar_activity',CONVERT(nvarchar(256),recovery.ActivityId),e.OccurredAtUtc,
 CASE WHEN e.EventType=N'calendar_activity_import_recovered' THEN(SELECT item.FacultyId facultyId,item.OriginalLabel label,item.Category category,item.StartDate startDate,item.EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END,
 CASE WHEN e.EventType=N'calendar_activity_import_committed' THEN(SELECT item.FacultyId facultyId,item.OriginalLabel label,item.Category category,item.StartDate startDate,item.EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END,NULL,NULL,
 CASE WHEN @Admin=1 THEN e.ActorName END,NULL,item.FacultyId
 FROM paws.AuditEvent e JOIN paws.CalendarActivityImportReceipt receipt ON receipt.ReceiptId=TRY_CONVERT(uniqueidentifier,e.EntityId)
 JOIN paws.CalendarActivityRecoveryRow recovery ON recovery.ReceiptId=receipt.ReceiptId
 JOIN staging.CalendarActivityImportItem item ON item.ImportBatchId=receipt.ImportBatchId AND item.AfcRecordId=recovery.OriginalAfcRecordId
 WHERE @Scope IN(N'mine',N'dashboard') AND e.EventType IN(N'calendar_activity_import_committed',N'calendar_activity_import_recovered')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR item.FacultyId=@Faculty)
 UNION ALL
 SELECT N'work',CONVERT(nvarchar(36),e.AuditEventId),e.EventType,e.EntityType,e.EntityId,e.OccurredAtUtc,e.BeforeJson,JSON_QUERY(c.ContextJson,'$.workActivity'),NULL,c.ContextJson,
 CASE WHEN @Admin=1 THEN e.ActorName END,NULL,TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.ContextJson,'$.facultyId'))
 FROM paws.AuditEvent e LEFT JOIN paws.ChangeHistoryContext c ON c.AuditEventId=e.AuditEventId
 WHERE e.EventType=N'calendar_activity_time_resolved' AND @Scope IN(N'mine',N'dashboard')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.ContextJson,'$.facultyId'))=@Faculty)
 ) events ORDER BY occurredAtUtc DESC,source,eventId;
 IF (SELECT COUNT(*) FROM #HistoryEvents)>10000 OR (SELECT COALESCE(SUM(CONVERT(bigint,COALESCE(DATALENGTH(beforeJson),0))+COALESCE(DATALENGTH(afterJson),0)+COALESCE(DATALENGTH(contextJson),0)+COALESCE(DATALENGTH(metadataJson),0)),0) FROM #HistoryEvents)>12582912
 THROW 54704,'Narrow the history range before reading.',1;
 -- Resolve only proven historical IDs to opaque filter keys. Today's roster is
 -- never evidence of affected membership; current names label the filter only.
 SELECT events.*,(
 SELECT candidate.FacultyId facultyId,candidate.CandidateKey facultyKey,
 COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) displayName
 FROM paws.SwapCandidate candidate JOIN paws.Faculty f ON f.FacultyId=candidate.FacultyId
 WHERE candidate.FacultyId IN(
 SELECT FacultyId FROM paws_api.HistoryAffectedFaculty(events.beforeJson,events.afterJson,events.contextJson)
 UNION SELECT events.facultyId WHERE events.facultyId IS NOT NULL
 UNION SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(events.metadataJson,'$.facultyId')) WHERE events.eventType IN(N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected')
 UNION SELECT TRY_CONVERT(uniqueidentifier,events.entityId) WHERE events.eventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored')
 ) FOR JSON PATH) directoryFacultyJson
 FROM #HistoryEvents events ORDER BY occurredAtUtc DESC,source,eventId;
END;
GO
CREATE ROLE paws_runtime_history_read AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::paws_api.ListChangeHistoryEvents TO paws_runtime_history_read;
GRANT EXECUTE ON OBJECT::paws_api.DoeHistoryPolicySnapshot TO paws_runtime_doe_admin_write;
GRANT EXECUTE ON OBJECT::paws_api.DoeHistoryPolicySnapshot TO paws_runtime_doe_policy_publish;
COMMIT TRANSACTION;
GO
