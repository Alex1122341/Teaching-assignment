/* Synthetic disposable-database acceptance. Runner rejects remote/live hosts. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' OR USER_ID(N'paws-calendar-test-runtime') IS NULL
 THROW 54790,'Synthetic history acceptance prerequisites are missing.',1;
IF EXISTS(SELECT 1 FROM paws.ChangeHistoryContext WHERE AuditEventId='ffffffff-ffff-4fff-8fff-ffffffffffff')
 THROW 54790,'Old audit was backfilled with current relationships.',1;
BEGIN TRANSACTION;
DECLARE @Batch uniqueidentifier=NEWID(),@A uniqueidentifier='77777777-7777-4777-8777-777777777777',@B uniqueidentifier=NEWID(),@Session uniqueidentifier=NEWID(),@Second uniqueidentifier=NEWID();
DECLARE @One uniqueidentifier=NEWID(),@Two uniqueidentifier=NEWID(),@Replacement uniqueidentifier=NEWID(),@Private uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson)
VALUES(@Batch,SYSUTCDATETIME(),N'completed',REPLICATE('A',64),N'synthetic-history',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId)
VALUES(@A,N'faculty',N'Synthetic A',1,@Batch),(@B,N'faculty',N'Synthetic B',1,@Batch);
INSERT paws.SwapCandidate(FacultyId) VALUES(@A),(@B);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword)
VALUES(N'history-test-a',N'history-a@example.test',N'A',N'faculty',@A,1,0),
(N'history-test-b',N'history-b@example.test',N'B',N'faculty',@B,1,0),
(N'history-test-admin',N'history-admin@example.test',N'Admin',N'owner',NULL,1,0),
(N'history-test-disabled',N'history-disabled@example.test',N'Disabled',N'faculty',@A,0,0);
INSERT paws.Session(SessionId,AcademicYear,CourseCode,Topic,SessionType,SessionDate,SourceImportBatchId)
VALUES(@Session,N'2026-27',N'206',N'Synthetic history lab',N'LAB','2026-10-16',@Batch),(@Second,N'2026-27',N'207',N'Synthetic second',N'LEC','2026-10-16',@Batch);
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,SourceFacultyName,FacultyResolutionStatus,TeachingRole,SourceImportBatchId,SourceRow)
VALUES(NEWID(),@Session,@A,N'Synthetic A',N'resolved',N'Lead',@Batch,1);
INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,OccurredAtUtc,BeforeJson,AfterJson)
VALUES(@One,N'session_updated',N'session',CONVERT(nvarchar(36),@Session),'2026-10-16T10:00:00',N'{"room":"A"}',N'{"room":"B"}'),
(@Two,N'session_created',N'session',CONVERT(nvarchar(36),@Second),'2026-10-16T10:01:00',NULL,N'{"courseCode":"207"}');
IF (SELECT COUNT(*) FROM paws.ChangeHistoryContext WHERE AuditEventId IN(@One,@Two))<>2 THROW 54790,'Multirow event context capture failed.',1;
IF NOT EXISTS(SELECT 1 FROM paws.ChangeHistoryContext c CROSS APPLY paws_api.HistoryAffectedFaculty(NULL,NULL,c.ContextJson) f WHERE c.AuditEventId=@One AND f.FacultyId=@A)
 THROW 54790,'Event-time assignment membership missing.',1;
UPDATE paws.SessionAssignment SET FacultyId=@B,SourceFacultyName=N'Synthetic B' WHERE SessionId=@Session;
IF NOT EXISTS(SELECT 1 FROM paws.ChangeHistoryContext c CROSS APPLY paws_api.HistoryAffectedFaculty(NULL,NULL,c.ContextJson) f WHERE c.AuditEventId=@One AND f.FacultyId=@A)
 OR EXISTS(SELECT 1 FROM paws.ChangeHistoryContext c CROSS APPLY paws_api.HistoryAffectedFaculty(NULL,NULL,c.ContextJson) f WHERE c.AuditEventId=@One AND f.FacultyId=@B)
 THROW 54790,'Later assignments changed an earlier event snapshot.',1;
DECLARE @Before nvarchar(max)=(SELECT @A facultyId,N'Synthetic A' sourceFacultyName FOR JSON PATH);
DECLARE @After nvarchar(max)=(SELECT @B facultyId,N'Synthetic B' sourceFacultyName FOR JSON PATH);
INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,OccurredAtUtc,BeforeJson,AfterJson)
VALUES(@Replacement,N'session_assignments_replaced',N'session',CONVERT(nvarchar(36),@Session),'2026-10-16T10:02:00',@Before,@After);
IF (SELECT COUNT(*) FROM paws_api.HistoryAffectedFaculty(@Before,@After,NULL))<>2 THROW 54790,'Removal/replacement affected membership incomplete.',1;
INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,OccurredAtUtc,AfterJson)
VALUES(@Private,N'afc_record_created',N'afc_record',CONVERT(nvarchar(36),NEWID()),'2026-10-16T10:03:00',(SELECT @B facultyId,N'private reason B' purpose FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
DECLARE @Rows table(source nvarchar(16),eventId nvarchar(80),eventType nvarchar(128),entityType nvarchar(128),entityId nvarchar(256),occurredAtUtc datetime2(7),beforeJson nvarchar(max),afterJson nvarchar(max),metadataJson nvarchar(max),contextJson nvarchar(max),actorName nvarchar(260),academicYear nvarchar(32),facultyId uniqueidentifier,directoryFacultyJson nvarchar(max));
INSERT @Rows EXEC paws_api.ListChangeHistoryEvents N'history-test-a',N'mine','2026-10-16','2026-10-17';
IF NOT EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@One)) OR NOT EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@Replacement))
 OR EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@Private)) THROW 54790,'My history scope failed.',1;
DELETE @Rows;
INSERT @Rows EXEC paws_api.ListChangeHistoryEvents N'history-test-a',N'timetable','2026-10-16','2026-10-17';
IF NOT EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@Two)) OR EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@Private)) THROW 54790,'Public timetable scope failed.',1;
DELETE @Rows;
INSERT @Rows EXEC paws_api.ListChangeHistoryEvents N'history-test-a',N'dashboard','2026-10-16','2026-10-17';
IF NOT EXISTS(SELECT 1 FROM @Rows WHERE eventId=N'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') THROW 54790,'Recorded legacy AFC ownership was ignored.',1;
IF NOT EXISTS(SELECT 1 FROM @Rows r CROSS APPLY OPENJSON(r.directoryFacultyJson) WITH(facultyId uniqueidentifier '$.facultyId',facultyKey uniqueidentifier '$.facultyKey') mapped JOIN paws.SwapCandidate candidate ON candidate.CandidateKey=mapped.facultyKey AND candidate.FacultyId=mapped.facultyId WHERE r.eventId=N'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND mapped.facultyId=@A) THROW 54790,'Known legacy faculty could not be filtered by its opaque key.',1;
IF EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@Private)) THROW 54790,'Private AFC leaked across faculty.',1;
DELETE @Rows;
INSERT @Rows EXEC paws_api.ListChangeHistoryEvents N'history-test-b',N'dashboard','2026-10-16','2026-10-17';
IF EXISTS(SELECT 1 FROM @Rows WHERE eventId=N'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') THROW 54790,'Legacy AFC ownership leaked across faculty.',1;
IF NOT EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@Private)) THROW 54790,'Own AFC history missing.',1;
-- Forward time facts are captured by the real command inside its transaction.
DECLARE @Workbook uniqueidentifier=NEWID(),@Sheet uniqueidentifier=NEWID(),@RawRow uniqueidentifier=NEWID(),@Activity uniqueidentifier='88888888-8888-4888-8888-888888888888';
INSERT staging.ImportWorkbook(ImportWorkbookId,ImportBatchId,FileName,FileSha256,FileByteLength) VALUES(@Workbook,@Batch,N'Synthetic history.xlsx',REPLICATE('A',64),1);
INSERT staging.ImportSheet(ImportSheetId,ImportWorkbookId,SheetName,SheetIndex,MaxRow,MaxColumn,NonEmptyRowCount) VALUES(@Sheet,@Workbook,N'Synthetic',0,2,1,1);
INSERT staging.ImportRow(ImportRowId,ImportSheetId,SourceRowNumber,RawJson,ValidationStatus,ValidationErrorsJson) VALUES(@RawRow,@Sheet,2,N'{}',N'valid',N'[]');
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
VALUES(@Activity,@A,N'ccc',N'Synthetic CCC','2026-10-16','2026-10-17',@Batch,@RawRow,REPLICATE('A',64),N'Synthetic',2,N'history-test-admin');
DECLARE @ActivityVersion varchar(16)=(SELECT CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ActivityId=@Activity);
DECLARE @TimeResponse table(responseJson nvarchar(max));
INSERT @TimeResponse EXEC paws_api.ResolveCalendarActivityDayTime N'history-test-admin',@Activity,@ActivityVersion,'2026-10-16','09:00','10:00',N'Synthetic source',N'private time evidence';
DECLARE @TimeAudit uniqueidentifier=(SELECT TOP(1) AuditEventId FROM paws.AuditEvent WHERE EventType=N'calendar_activity_time_resolved' AND EntityId=CONVERT(nvarchar(36),@Activity) ORDER BY OccurredAtUtc DESC);
DECLARE @RecentStart datetime2(7)=DATEADD(day,-1,SYSUTCDATETIME()),@RecentEnd datetime2(7)=DATEADD(day,1,SYSUTCDATETIME());
DELETE @Rows;
INSERT @Rows EXEC paws_api.ListChangeHistoryEvents N'history-test-a',N'mine',@RecentStart,@RecentEnd;
IF NOT EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@TimeAudit) AND JSON_VALUE(afterJson,'$.startTime')=N'09:00') THROW 54790,'Own recorded time change missing.',1;
IF EXISTS(SELECT 1 FROM @Rows WHERE eventId=N'dddddddd-dddd-4ddd-8ddd-dddddddddddd') THROW 54790,'Legacy time ownership was inferred from the current activity.',1;
IF EXISTS(SELECT 1 FROM @Rows WHERE afterJson LIKE N'%private time evidence%') THROW 54790,'Time evidence escaped the allowlist.',1;
DELETE @Rows;
INSERT @Rows EXEC paws_api.ListChangeHistoryEvents N'history-test-b',N'mine',@RecentStart,@RecentEnd;
IF EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@TimeAudit)) THROW 54790,'Work time history leaked across faculty.',1;
DELETE @Rows;
INSERT @Rows EXEC paws_api.ListChangeHistoryEvents N'history-test-a',N'timetable',@RecentStart,@RecentEnd;
IF EXISTS(SELECT 1 FROM @Rows WHERE eventId=CONVERT(nvarchar(36),@TimeAudit)) THROW 54790,'Work time appeared in public timetable history.',1;
-- Changing the live time cannot rewrite an already captured history value.
SELECT @ActivityVersion=CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ActivityId=@Activity;
INSERT @TimeResponse EXEC paws_api.ResolveCalendarActivityDayTime N'history-test-admin',@Activity,@ActivityVersion,'2026-10-16','11:00','12:00',N'Synthetic revised source',N'private revised evidence';
IF NOT EXISTS(SELECT 1 FROM paws.ChangeHistoryContext WHERE AuditEventId=@TimeAudit AND JSON_VALUE(ContextJson,'$.workActivity.startTime')=N'09:00') THROW 54790,'Current time rewrote a historical snapshot.',1;
-- Minimal immutable receipt evidence: no private recovery before-image returned.
DECLARE @Receipt uniqueidentifier=NEWID(),@OriginalAfc uniqueidentifier=NEWID(),@RecoveryEvent uniqueidentifier=NEWID();
INSERT staging.CalendarActivityImport(ImportBatchId,SourceSha256,Dataset,PolicyVersion,Status,SourceRowCount,ActorFirebaseUid)
VALUES(@Batch,REPLICATE('A',64),N'synthetic-history',N'synthetic',N'recovered',1,N'history-test-admin');
INSERT staging.CalendarActivityImportItem(ImportBatchId,SourceRow,ImportRowId,FacultySourceName,StartDate,EndDate,OriginalLabel,ParserTreatment,ParsedIssuesJson,Category,FacultyId,AfcRecordId,Status)
VALUES(@Batch,2,@RawRow,N'Synthetic A','2026-10-16','2026-10-17',N'Synthetic CCC',N'working_candidate',N'[]',N'ccc',@A,@OriginalAfc,N'accepted');
INSERT paws.CalendarActivityImportReceipt(ReceiptId,ImportBatchId,Dataset,SourceSha256,ManifestSha256,IdempotencyKey,InsertedCount,DeletedAfcCount,ActorUid,Status)
VALUES(@Receipt,@Batch,N'synthetic-history',REPLICATE('A',64),REPLICATE('B',64),NEWID(),1,1,N'history-test-admin',N'recovered');
INSERT paws.CalendarActivityRecoveryRow(ReceiptId,OriginalAfcRecordId,ActivityId,ImportedActivityVersion,BeforeAfcJson)
VALUES(@Receipt,@OriginalAfc,@Activity,0x0000000000000001,N'{"notes":"private recovery content"}');
INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,OccurredAtUtc)
VALUES(@RecoveryEvent,N'calendar_activity_import_recovered',N'calendar_activity_receipt',CONVERT(nvarchar(36),@Receipt),SYSUTCDATETIME());
DELETE @Rows;
INSERT @Rows EXEC paws_api.ListChangeHistoryEvents N'history-test-a',N'mine',@RecentStart,@RecentEnd;
IF NOT EXISTS(SELECT 1 FROM @Rows WHERE eventId LIKE CONVERT(nvarchar(36),@RecoveryEvent)+N':%' AND JSON_VALUE(beforeJson,'$.startDate')=N'2026-10-16' AND afterJson IS NULL)
 THROW 54790,'Recovery must remove the recorded working range.',1;
IF EXISTS(SELECT 1 FROM @Rows WHERE beforeJson LIKE N'%private recovery content%' OR afterJson LIKE N'%private recovery content%') THROW 54790,'Recovery before-image escaped to history.',1;
IF ISJSON(paws_api.DoeHistoryPolicySnapshot(NEWID()))<>1 THROW 54790,'Policy snapshot must be valid JSON even for a missing version.',1;
DECLARE @Policy uniqueidentifier=NEWID(),@Reference uniqueidentifier=NEWID(),@OtherReference uniqueidentifier=NEWID(),@Rule uniqueidentifier=NEWID();
INSERT paws.DoePolicyVersion(PolicyVersionId,AcademicYear,VersionLabel,SourceReference,Active,Status,Revision)
VALUES(@Policy,N'2026-27',N'Synthetic history evidence',N'Synthetic fixture',0,N'draft',0);
INSERT paws.DoeReferenceSource(ReferenceId,PolicyVersionId,AcademicYear,Title,Section,Notes)
VALUES(@Reference,@Policy,N'2026-27',N'Same guideline',N'Teaching',N'First note'),(@OtherReference,@Policy,N'2026-27',N'Same guideline',N'Research',N'Second note');
INSERT paws.DoePolicyRule(RuleId,PolicyVersionId,AcademicYear,RuleKey,Category,RuleLabel,CalculationMode,ReferenceId)
VALUES(@Rule,@Policy,N'2026-27',N'history-rule',N'teaching',N'Synthetic rule',N'fixed',@Reference);
INSERT paws.DoeCourseMapping(MappingId,PolicyVersionId,AcademicYear,CourseCode,MappingFactsJson,ReferenceId)
VALUES(NEWID(),@Policy,N'2026-27',N'206',N'{"aliases":["old"]}',@Reference);
DECLARE @RecordedBook nvarchar(max)=paws_api.DoeHistoryPolicySnapshot(@Policy);
IF (SELECT COUNT(*) FROM OPENJSON(@RecordedBook,'$.references'))<>2 OR JSON_VALUE(@RecordedBook,'$.rules[0].referenceId')<>CONVERT(nvarchar(36),@Reference)
 OR JSON_VALUE(@RecordedBook,'$.courseMappings[0].mappingFactsJson')<>N'{"aliases":["old"]}'
 OR JSON_VALUE(@RecordedBook,'$.courseMappings[0].referenceId')<>CONVERT(nvarchar(36),@Reference)
 THROW 54790,'Policy snapshot lost reference identity, links or calculation mapping facts.',1;
CREATE USER [history-synthetic-policy-writer] WITHOUT LOGIN;
ALTER ROLE paws_runtime_doe_admin_write ADD MEMBER [history-synthetic-policy-writer];
EXECUTE AS USER=N'history-synthetic-policy-writer';
DECLARE @PolicySnapshot nvarchar(max)=paws_api.DoeHistoryPolicySnapshot(NEWID());
REVERT;
IF ISJSON(@PolicySnapshot)<>1 THROW 54790,'Existing draft role cannot invoke the audit snapshot.',1;
ROLLBACK;
IF EXISTS(SELECT 1 FROM paws.AuditEvent WHERE AuditEventId=@One) OR EXISTS(SELECT 1 FROM paws.ChangeHistoryContext WHERE AuditEventId=@One)
 THROW 54790,'Audit and event context did not roll back together.',1;
-- Denial is outside the fixture transaction: XACT_ABORT may abort on THROW.
BEGIN TRY
 EXEC paws_api.ListChangeHistoryEvents N'missing-synthetic-history-user',N'timetable','2026-10-16','2026-10-17';
 THROW 54790,'Missing profile was allowed.',1;
END TRY BEGIN CATCH IF ERROR_NUMBER()<>54701 THROW; END CATCH;
IF EXISTS(SELECT 1 FROM sys.database_role_members WHERE role_principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_history_read'))
 THROW 54790,'Migration must not add runtime membership.',1;
PRINT 'CHANGE_HISTORY_SQL_ACCEPTANCE_OK';
