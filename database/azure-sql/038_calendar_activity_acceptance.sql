:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53890,'Wrong synthetic database.',1;
IF OBJECT_ID(N'paws.CalendarActivity') IS NULL THROW 53890,'Calendar activity foundation is missing.',1;
BEGIN TRANSACTION;
DECLARE @Batch uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Other uniqueidentifier=NEWID(),@Afc uniqueidentifier=NEWID(),@Raw uniqueidentifier=NEWID(),@Request uniqueidentifier=NEWID();
DECLARE @Inactive uniqueidentifier=NEWID(),@AmbiguousA uniqueidentifier=NEWID(),@AmbiguousB uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson)
VALUES(@Batch,SYSUTCDATETIME(),N'completed',REPLICATE('A',64),N'synthetic',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,PreferredFirstName,PreferredLastName,DisplayName,Active,SourceImportBatchId)
VALUES(@Faculty,N'faculty',N'Alex',N'Synthetic',N'Alex Synthetic',1,@Batch),(@Other,N'faculty',N'Other',N'Synthetic',N'Other Synthetic',1,@Batch);
INSERT paws.Faculty(FacultyId,RecordType,PreferredFirstName,PreferredLastName,DisplayName,Active,SourceImportBatchId)
VALUES(@Inactive,N'faculty',N'Inactive',N'Synthetic',N'Inactive Synthetic',0,@Batch),
(@AmbiguousA,N'faculty',N'AmbiguousA',N'Synthetic',N'AmbiguousA Synthetic',1,@Batch),
(@AmbiguousB,N'faculty',N'AmbiguousB',N'Synthetic',N'AmbiguousB Synthetic',1,@Batch);
INSERT paws.FacultyAlias(FacultyAliasId,FacultyId,AliasName,TargetPreferredSourceName,TargetDisplayName,Active,SourceImportBatchId)
VALUES(NEWID(),@AmbiguousA,N'Ambiguous Synthetic',N'AmbiguousA Synthetic',N'AmbiguousA Synthetic',1,@Batch),
(NEWID(),@AmbiguousB,N'Ambiguous  Synthetic',N'AmbiguousB Synthetic',N'AmbiguousB Synthetic',1,@Batch);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword)
VALUES(N'calendar-test-admin',N'admin@example.test',N'Synthetic Admin',N'owner',NULL,1,0),
(N'calendar-test-faculty',N'faculty@example.test',N'Synthetic Faculty',N'faculty',@Faculty,1,0);
INSERT paws.SwapCandidate(FacultyId) VALUES(@Faculty),(@Other);
DECLARE @EmptyResponse table(responseJson nvarchar(max));
INSERT @EmptyResponse EXEC paws_api.ListCalendarActivities @ActorFirebaseUid=N'calendar-test-faculty',@StartDate='2026-05-01',@EndExclusive='2026-05-02';
DECLARE @EmptyJson nvarchar(max)=(SELECT responseJson FROM @EmptyResponse);
IF JSON_QUERY(@EmptyJson,'$.activities') IS NULL OR JSON_QUERY(@EmptyJson,'$.activities')<>N'[]'
 THROW 53890,'An authorized empty Calendar range must return an activities array.',1;
PRINT 'CALENDAR_ACTIVITY_EMPTY_RANGE_OK';
INSERT staging.AfcRecordRaw(ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson)
VALUES(@Batch,@Raw,2,N'Former Synthetic','2026-11-05','2026-11-06',N'CCC Day',N'{}',N'valid',N'[]');
INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow)
VALUES(@Afc,@Faculty,'2026-11-05','2026-11-06',N'CCC Day',1,@Batch,2);
DECLARE @Rows nvarchar(max)=N'[{"sourceRow":2,"facultySourceName":"Former Synthetic","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"CCC Day","category":"ccc","treatment":"working_candidate","issues":[]},{"sourceRow":3,"facultySourceName":"Alex Synthetic","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"OPA","category":null,"treatment":"retain_afc","issues":[]},{"sourceRow":267,"facultySourceName":"Departed Synthetic","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"CCC Day","category":"ccc","treatment":"excluded","issues":[]}]';
SET @Rows=JSON_MODIFY(@Rows,'append $',JSON_QUERY(N'{"sourceRow":4,"facultySourceName":"Inactive Synthetic","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"CCC Day","category":"ccc","treatment":"working_candidate","issues":[]}'));
SET @Rows=JSON_MODIFY(@Rows,'append $',JSON_QUERY(N'{"sourceRow":5,"facultySourceName":"Ambiguous Synthetic","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"CCC Day","category":"ccc","treatment":"working_candidate","issues":[]}'));
SET @Rows=JSON_MODIFY(@Rows,'append $',JSON_QUERY(N'{"sourceRow":6,"facultySourceName":"Unknown Synthetic","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"CCC Day","category":"ccc","treatment":"working_candidate","issues":[]}'));
DECLARE @Response table(responseJson nvarchar(max));
INSERT @Response EXEC paws_api.StageCalendarActivityImport @ActorFirebaseUid=N'calendar-test-admin',@RequestId=@Request,@SourceSha256='4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@RowsJson=@Rows;
DECLARE @Preview nvarchar(max)=(SELECT responseJson FROM @Response);
IF JSON_VALUE(@Preview,'$.counts.accepted')<>N'1' OR JSON_VALUE(@Preview,'$.counts.retained')<>N'1' OR JSON_VALUE(@Preview,'$.counts.excluded')<>N'1' OR JSON_VALUE(@Preview,'$.counts.quarantined')<>N'3' THROW 53890,'Source treatments or lineage resolution are incorrect.',1;
IF EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Request) THROW 53890,'Staged rows became live before commit.',1;
IF paws_api.CalendarActivityNameKey(N'  Zoë'+NCHAR(160)+N' O''Connor ,'+NCHAR(9)+N' Jr  ')<>N'ZOË O''CONNOR, JR' THROW 53890,'Name normalization contract differs.',1;
IF paws_api.CalendarActivityPurposeCategory(N'OPA') IS NOT NULL THROW 53890,'OPA became working activity.',1;
DECLARE @Sheet uniqueidentifier=(SELECT TOP(1) ImportSheetId FROM staging.ImportSheet WHERE ImportWorkbookId IN(SELECT ImportWorkbookId FROM staging.ImportWorkbook WHERE ImportBatchId=@Request));
DECLARE @ImportRow uniqueidentifier=(SELECT TOP(1) ImportRowId FROM staging.ImportRow WHERE ImportSheetId=@Sheet AND SourceRowNumber=2),@Activity uniqueidentifier=NEWID();
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
VALUES(@Activity,@Faculty,N'ccc',N'CCC Day','2026-04-29','2026-05-03',@Request,@ImportRow,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',N'AFC records',900,N'calendar-test-admin');
INSERT paws.CalendarActivityDayTime(ActivityId,ActivityDate,StartTime,EndTime,EvidenceRef,EvidenceNote,ActorUid)
VALUES(@Activity,'2026-05-01','09:00','10:00',N'synthetic-ref',N'private evidence note',N'calendar-test-admin');
DELETE FROM @Response;
INSERT @Response EXEC paws_api.ListCalendarActivities @ActorFirebaseUid=N'calendar-test-faculty',@StartDate='2026-05-01',@EndExclusive='2026-05-02';
DECLARE @Public nvarchar(max)=(SELECT responseJson FROM @Response);
IF JSON_QUERY(@Public,'$.activities') IS NULL OR (SELECT COUNT(*) FROM OPENJSON(@Public,'$.activities'))<>1
 THROW 53890,'A populated Calendar range must return an activities array.',1;
IF COALESCE(JSON_VALUE(@Public,'$.activities[0].activityId'),N'')<>CONVERT(nvarchar(36),@Activity)
 OR JSON_QUERY(@Public,'$.activities[0].timeEvidence') IS NULL
 OR COALESCE(JSON_VALUE(@Public,'$.activities[0].timeEvidence[0].date'),N'')<>N'2026-05-01'
 OR COALESCE(JSON_VALUE(@Public,'$.activities[0].timeEvidence[0].startTime'),N'')<>N'09:00'
 OR COALESCE(JSON_VALUE(@Public,'$.activities[0].timeEvidence[0].endTime'),N'')<>N'10:00'
 THROW 53890,'A populated Calendar range lost its activity or timing evidence.',1;
IF COALESCE(JSON_VALUE(@Public,'$.activities[0].startDate'),N'')<>N'2026-04-29' OR COALESCE(JSON_VALUE(@Public,'$.activities[0].endDate'),N'')<>N'2026-05-03' THROW 53890,'Range intersection clipped original dates.',1;
IF @Public LIKE N'%private%' OR @Public LIKE N'%facultyId%' OR @Public LIKE N'%ucid%' OR @Public LIKE N'%email%' OR @Public LIKE N'%sourceRow%' OR @Public LIKE N'%evidenceRef%' THROW 53890,'Private activity metadata leaked.',1;
IF COALESCE(JSON_VALUE(@Public,'$.activities[0].timeStatus'),N'')<>N'partial' THROW 53890,'Incomplete range timing was labeled verified.',1;
DELETE FROM @EmptyResponse;
INSERT @EmptyResponse EXEC paws_api.ListCalendarActivities @ActorFirebaseUid=N'calendar-test-faculty',@StartDate='2027-01-01',@EndExclusive='2027-01-02';
SET @EmptyJson=(SELECT responseJson FROM @EmptyResponse);
IF JSON_QUERY(@EmptyJson,'$.activities') IS NULL OR JSON_QUERY(@EmptyJson,'$.activities')<>N'[]'
 THROW 53890,'An empty filtered Calendar range must return an activities array.',1;
DELETE FROM @EmptyResponse;
INSERT @EmptyResponse EXEC paws_api.ListCalendarActivities @ActorFirebaseUid=N'calendar-test-admin',@StartDate='2026-05-01',@EndExclusive='2026-05-02',@Category=N'clinical_day';
SET @EmptyJson=(SELECT responseJson FROM @EmptyResponse);
IF JSON_QUERY(@EmptyJson,'$.activities') IS NULL OR JSON_QUERY(@EmptyJson,'$.activities')<>N'[]'
 THROW 53890,'An empty Calendar category must return an activities array.',1;
ROLLBACK TRANSACTION;
PRINT 'CALENDAR_ACTIVITY_FOUNDATION_ACCEPTANCE_OK';
