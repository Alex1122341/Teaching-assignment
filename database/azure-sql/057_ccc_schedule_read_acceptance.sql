/* Synthetic disposable-container acceptance ONLY for paws_api.ListCccSchedule (SQL 057).
   Requires the labeled disposable fixture created by tools/test-ccc-schedule-sql.ps1.
   Never run against VetMed-Ops production. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF USER_ID(N'paws-calendar-test-runtime') IS NULL OR OBJECT_ID(N'paws_api.ListCccSchedule',N'P') IS NULL
 THROW 55790,'Disposable CCC fixture and installed reader required.',1;
IF OBJECT_ID(N'dbo.CccScheduleContext') IS NOT NULL THROW 55790,'CCC fixture is not fresh.',1;

DECLARE @Batch uniqueidentifier=NEWID(),@Book uniqueidentifier=NEWID(),@Sheet uniqueidentifier=NEWID();
DECLARE @ActiveFaculty uniqueidentifier=NEWID(),@OtherFaculty uniqueidentifier=NEWID(),@InactiveFaculty uniqueidentifier=NEWID();
DECLARE @Course uniqueidentifier=NEWID(),@Sha char(64)=REPLICATE('C',64);
DECLARE @Row2 uniqueidentifier=NEWID(),@Row3 uniqueidentifier=NEWID(),@Row4 uniqueidentifier=NEWID(),@Row5 uniqueidentifier=NEWID(),
        @Row6 uniqueidentifier=NEWID(),@Row7 uniqueidentifier=NEWID(),@Row8 uniqueidentifier=NEWID(),@Row9 uniqueidentifier=NEWID(),
        @Row10 uniqueidentifier=NEWID(),@Row11 uniqueidentifier=NEWID(),@Row12 uniqueidentifier=NEWID(),@Row13 uniqueidentifier=NEWID();

INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,CompletedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson)
 VALUES(@Batch,SYSUTCDATETIME(),SYSUTCDATETIME(),N'completed',REPLICATE('B',64),N'synthetic',N'{}');
INSERT staging.ImportWorkbook(ImportWorkbookId,ImportBatchId,FileName,FileSha256,FileByteLength)
 VALUES(@Book,@Batch,N'ccc-schedule-synthetic.xlsx',REPLICATE('A',64),1);
INSERT staging.ImportSheet(ImportSheetId,ImportWorkbookId,SheetName,SheetIndex,MaxRow,MaxColumn,NonEmptyRowCount)
 VALUES(@Sheet,@Book,N'Synthetic',0,20,5,20);
INSERT staging.ImportRow(ImportRowId,ImportSheetId,SourceRowNumber,RawJson,ValidationStatus,ValidationErrorsJson)
 SELECT rows.id,@Sheet,rows.n,N'{}',N'accepted',N'[]' FROM(VALUES
  (@Row2,2),(@Row3,3),(@Row4,4),(@Row5,5),(@Row6,6),(@Row7,7),(@Row8,8),
  (@Row9,9),(@Row10,10),(@Row11,11),(@Row12,12),(@Row13,13)) rows(id,n);

INSERT paws.Faculty(FacultyId,RecordType,PreferredFirstName,PreferredLastName,DisplayName,Active,SourceImportBatchId)
 VALUES(@ActiveFaculty,N'faculty',N'Alexandre',N'Ellis',N'Ellis, Alexandre',1,@Batch),
       (@OtherFaculty,N'faculty',N'Zoe',N'Park',N'Park, Zoe',1,@Batch),
       (@InactiveFaculty,N'faculty',N'Ina',N'Retired',N'Retired, Ina',0,@Batch);
INSERT paws.Course(CourseId,CourseCode,CourseName,SourceImportBatchId) VALUES(@Course,N'292',N'Community Care Clinic',@Batch);

INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword) VALUES
 (N'ccc-owner',N'owner@example.test',N'Synthetic Owner',N'owner',NULL,1,0),
 (N'ccc-faculty',N'faculty@example.test',N'Synthetic Faculty',N'faculty',@ActiveFaculty,1,0),
 (N'ccc-hicc',N'hicc@example.test',N'Synthetic HICC',N'hicc',@OtherFaculty,1,0),
 (N'ccc-visc',N'visc@example.test',N'Synthetic VISC',N'visc',@OtherFaculty,1,0),
 (N'ccc-adc',N'adc@example.test',N'Synthetic ADC',N'adc',NULL,1,0),
 (N'ccc-lab',N'lab@example.test',N'Synthetic LAB',N'lab',NULL,1,0),
 (N'ccc-viewer',N'viewer@example.test',N'Synthetic Viewer',N'viewer',NULL,1,0),
 (N'ccc-inactive',N'inactive@example.test',N'Synthetic Inactive',N'owner',NULL,0,0),
 (N'ccc-password',N'password@example.test',N'Synthetic Password',N'owner',NULL,1,1),
 (N'ccc-unlinked',N'unlinked@example.test',N'Synthetic Unlinked',N'faculty',NULL,1,0);

/* 12 synthetic CCC rows: 10 inside 2026-27, 1 next year, 1 inactive faculty; plus 1 non-CCC activity. */
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,
 SourceSha256,SourceSheet,SourceRow,CreatedByUid,StaffingKind,StaffingLabel,BlockLabel,SourceColumn,SourceSlotKey)
 SELECT NEWID(),rows.faculty,N'ccc',rows.label,rows.starts,rows.ends,@Course,@Batch,rows.rowid,@Sha,N'Synthetic',rows.n,N'ccc-owner',
        rows.kind,rows.stafflabel,rows.block,rows.col,
        CASE WHEN rows.col IS NULL THEN NULL ELSE CONCAT(N'Synthetic!',rows.col,rows.n) END
 FROM(VALUES
  (@ActiveFaculty,N'CCC Clinic','2026-10-21','2026-10-21',@Row2,2,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 5',CAST(NULL AS nvarchar(4))),
  (@OtherFaculty,N'CCC Clinic','2026-10-21','2026-10-22',@Row3,3,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 5',CAST(NULL AS nvarchar(4))),
  (CAST(NULL AS uniqueidentifier),N'CCC Clinic','2026-10-22','2026-10-22',@Row4,4,N'unassigned',N'Locum',N'Block 6',N'D'),
  (@ActiveFaculty,N'CCC half day AM','2026-10-23','2026-10-23',@Row5,5,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 7',CAST(NULL AS nvarchar(4))),
  (@ActiveFaculty,N'CCC Clinic','2026-05-01','2026-05-01',@Row6,6,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 1',CAST(NULL AS nvarchar(4))),
  (@OtherFaculty,N'CCC Clinic','2027-04-30','2027-04-30',@Row7,7,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 9',CAST(NULL AS nvarchar(4))),
  (@OtherFaculty,N'CCC Clinic','2027-05-01','2027-05-01',@Row8,8,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 1',CAST(NULL AS nvarchar(4))),
  (@InactiveFaculty,N'CCC Clinic','2026-11-01','2026-11-01',@Row9,9,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 8',CAST(NULL AS nvarchar(4))),
  (@ActiveFaculty,N'CCC Clinic','2026-11-02','2026-11-03',@Row10,10,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 2',CAST(NULL AS nvarchar(4))),
  (@ActiveFaculty,N'CCC Clinic','2026-11-04','2026-11-04',@Row11,11,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 3',CAST(NULL AS nvarchar(4))),
  (@ActiveFaculty,N'CCC Clinic','2026-11-05','2026-11-05',@Row12,12,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 4',CAST(NULL AS nvarchar(4))),
  (@ActiveFaculty,N'CCC Clinic','2026-11-06','2026-11-06',@Row13,13,N'assigned',CAST(NULL AS nvarchar(32)),N'Block 5',CAST(NULL AS nvarchar(4)))
 ) rows(faculty,label,starts,ends,rowid,n,kind,stafflabel,block,col);
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,
 SourceSha256,SourceSheet,SourceRow,CreatedByUid)
 SELECT NEWID(),@ActiveFaculty,N'clinical_day',N'Not a CCC row','2026-11-07','2026-11-07',@Course,@Batch,@Row13,@Sha,N'Synthetic',14,N'ccc-owner';

INSERT paws.CalendarActivityDayTime(ActivityId,ActivityDate,StartTime,EndTime,EvidenceRef,EvidenceNote,ActorUid)
 SELECT a.ActivityId,t.date,t.starts,t.ends,N'synthetic',N'Confirmed fixture time',N'ccc-owner'
 FROM paws.CalendarActivity a
 JOIN(VALUES
  ('2026-11-02','09:00','10:00'),
  ('2026-11-04','09:00','11:00'),
  ('2026-11-05','08:00','16:00')
 ) t(date,starts,ends) ON a.StartDate=CONVERT(date,t.date) AND a.Category=N'ccc';

CREATE TABLE dbo.CccScheduleContext(FacultyCount int,ActivityCount int,ProfileCount int,DefinitionHash varchar(64),SampleBlockLabel nvarchar(1000));
INSERT dbo.CccScheduleContext
 SELECT (SELECT COUNT(*) FROM paws.Faculty),(SELECT COUNT(*) FROM paws.CalendarActivity),(SELECT COUNT(*) FROM paws.UserProfile),
        CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListCccSchedule'))),2),
        (SELECT BlockLabel FROM paws.CalendarActivity WHERE SourceRow=2);
IF (SELECT COUNT(*) FROM dbo.CccScheduleContext)<>1 THROW 55790,'CCC fixture context was not created.',1;

/* Only paws_runtime_read may execute the reader, and only with EXECUTE. */
IF EXISTS(SELECT 1 FROM sys.database_permissions p WHERE p.major_id=OBJECT_ID(N'paws_api.ListCccSchedule') AND p.class=1
  AND NOT(p.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_read') AND p.permission_name=N'EXECUTE' AND p.state=N'G'))
 THROW 55790,'CCC reader grants are not exactly paws_runtime_read EXECUTE.',1;
IF NOT EXISTS(SELECT 1 FROM sys.database_permissions p WHERE p.major_id=OBJECT_ID(N'paws_api.ListCccSchedule') AND p.class=1
  AND p.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_read') AND p.permission_name=N'EXECUTE' AND p.state=N'G')
 THROW 55790,'CCC reader has no paws_runtime_read EXECUTE grant.',1;

DECLARE @Result TABLE(responseJson nvarchar(max));
DECLARE @Response nvarchar(max);
DECLARE @Rejected bit;

/* Every supported role reads the same cross-faculty year. */
INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-owner','2026-27';
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>10 THROW 55790,'Owner year coverage is not 10 CCC rows.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2027-05-01') THROW 55790,'Next academic year leaked into 2026-27.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2026-11-01') THROW 55790,'Inactive faculty CCC row was published.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2026-11-07') THROW 55790,'Non-CCC category leaked into the CCC schedule.',1;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2026-05-01') THROW 55790,'First day of the academic year is missing.',1;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2027-04-30') THROW 55790,'Last day of the academic year is missing.',1;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.halfDay')=N'true')<>2 THROW 55790,'Half day is not exactly the labelled row and the 120-minute row.',1;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2026-10-23' AND JSON_VALUE(value,'$.halfDay')=N'true') THROW 55790,'Explicit half-day label was not honoured.',1;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2026-11-04' AND JSON_VALUE(value,'$.halfDay')=N'true') THROW 55790,'Verified 120-minute day was not treated as half day.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date') IN(N'2026-11-02',N'2026-11-05') AND JSON_VALUE(value,'$.halfDay')=N'true') THROW 55790,'Multi-day or full-day record was misclassified as half day.',1;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.facultyName')=N'Locum')<>1 THROW 55790,'Unassigned CCC slot is not published as Locum.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.facultyName')=N'Retired, Ina') THROW 55790,'Inactive faculty name was published.',1;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2026-10-21' AND JSON_VALUE(value,'$.endDate')=N'2026-10-21' AND JSON_VALUE(value,'$.blockLabel')=N'Block 5')
 THROW 55790,'Single-day row lost its date range or block label.',1;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2026-10-21' AND JSON_VALUE(value,'$.endDate')=N'2026-10-22')
 THROW 55790,'A distinct end date was collapsed onto the shared start date.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.courseCode')<>N'292') THROW 55790,'Course code was not joined from paws.Course.',1;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>10 THROW 55790,'CCC reader duplicated or dropped rows.',1;
IF (SELECT COUNT(DISTINCT CONCAT(JSON_VALUE(value,'$.date'),'|',JSON_VALUE(value,'$.endDate'),'|',JSON_VALUE(value,'$.blockLabel'),'|',JSON_VALUE(value,'$.facultyName'))) FROM OPENJSON(@Response,'$.entries'))<>10 THROW 55790,'CCC reader produced duplicate schedule rows.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') CROSS APPLY OPENJSON(value) field
   WHERE field.[key] NOT IN(N'date',N'endDate',N'blockLabel',N'courseCode',N'facultyName',N'halfDay'))
 THROW 55790,'CCC reader exposed a field outside the six-key allowlist.',1;

INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-faculty','2026-27';
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>10 THROW 55790,'Linked faculty did not receive the cross-faculty CCC year.',1;

INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-hicc','2026-27';
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>10 THROW 55790,'HICC did not receive the cross-faculty CCC year.',1;

INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-visc','2026-27';
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>10 THROW 55790,'VISC did not receive the cross-faculty CCC year.',1;

INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-adc','2026-27';
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>10 THROW 55790,'ADC did not receive the cross-faculty CCC year.',1;

INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-lab','2026-27';
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>10 THROW 55790,'LAB did not receive the cross-faculty CCC year.',1;

/* Academic-year boundaries: the next year contains exactly its own row. */
INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-owner','2027-28';
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>1 THROW 55790,'2027-28 did not contain exactly one CCC row.',1;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.entries') WHERE JSON_VALUE(value,'$.date')=N'2027-05-01')
 THROW 55790,'2027-28 did not contain its own CCC row.',1;

INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-owner','2024-25';
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.entries'))<>0 THROW 55790,'An empty academic year did not return an empty schedule.',1;
IF @Response NOT LIKE N'%entries%' THROW 55790,'Empty year response shape changed.',1;

/* Denials: each must raise 55701 and must not return rows. */
SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-viewer','2026-27';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55701 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'An unsupported role read the CCC schedule.',1;

SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-inactive','2026-27';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55701 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'An inactive account read the CCC schedule.',1;

SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-password','2026-27';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55701 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'An account that must change its password read the CCC schedule.',1;

SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-unlinked','2026-27';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55701 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'A faculty account without a Faculty link read the CCC schedule.',1;

SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-unknown-actor','2026-27';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55701 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'An unknown actor read the CCC schedule.',1;

/* Invalid academic years must raise 55702, never fall back to a default. */
SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-owner','2026-2028';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55702 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'A four/four malformed year was accepted.',1;

SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-owner','2026-28';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55702 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'A non-consecutive year was accepted.',1;

SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-owner','junk';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55702 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'A malformed year was accepted.',1;

SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-owner',NULL;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55702 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'A NULL year was accepted.',1;

SET @Rejected=0;
BEGIN TRY INSERT @Result EXEC paws_api.ListCccSchedule N'ccc-owner','2019-20';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55702 THROW;SET @Rejected=1;END CATCH;
IF @Rejected=0 THROW 55790,'An out-of-range year was accepted.',1;

/* The reader must not mutate any business table. */
IF (SELECT COUNT(*) FROM paws.Faculty)<>(SELECT FacultyCount FROM dbo.CccScheduleContext)
 OR (SELECT COUNT(*) FROM paws.CalendarActivity)<>(SELECT ActivityCount FROM dbo.CccScheduleContext)
 OR (SELECT COUNT(*) FROM paws.UserProfile)<>(SELECT ProfileCount FROM dbo.CccScheduleContext)
 THROW 55790,'CCC reader changed business rows.',1;
IF (SELECT BlockLabel FROM paws.CalendarActivity WHERE SourceRow=2) COLLATE Latin1_General_100_BIN2
   <>(SELECT SampleBlockLabel FROM dbo.CccScheduleContext) COLLATE Latin1_General_100_BIN2
 THROW 55790,'CCC reader changed a CCC source row.',1;

PRINT 'CCC_SCHEDULE_READ_ACCEPTANCE_OK';
