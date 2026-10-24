/* Synthetic disposable-container acceptance ONLY. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF USER_ID(N'paws-calendar-test-runtime') IS NULL OR OBJECT_ID(N'dbo.CccSlotContext') IS NULL THROW 55390,'Disposable fixture required.',1;
IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivity a JOIN dbo.CccSlotContext c ON a.ActivityId=c.OldId AND a.ActivityVersion=c.OldVersion AND a.StaffingKind=N'assigned' AND a.StaffingLabel IS NULL) THROW 55390,'Upgrade changed legacy activity or version.',1;
IF paws_api.CccScopeSnapshot('2026-27') COLLATE Latin1_General_100_BIN2<>(SELECT BeforeScope FROM dbo.CccSlotContext) COLLATE Latin1_General_100_BIN2 THROW 55390,'Legacy receipt snapshot changed.',1;
DECLARE @Seed uniqueidentifier,@Raw uniqueidentifier,@Faculty uniqueidentifier,@Other uniqueidentifier,@Inactive uniqueidentifier,@Locum uniqueidentifier=NEWID();
SELECT @Seed=Seed,@Raw=RawId,@Faculty=Faculty,@Other=OtherFaculty,@Inactive=InactiveFaculty FROM dbo.CccSlotContext;
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid,StaffingKind,StaffingLabel,BlockLabel,SourceColumn,SourceSlotKey)
SELECT CASE WHEN col=N'C' THEN @Locum ELSE NEWID() END,CASE WHEN col=N'D' THEN @Faculty END,N'ccc',N'CCC','2026-10-20','2026-10-20',@Seed,@Raw,REPLICATE('A',64),N'CCC',2,N'synthetic',CASE WHEN col=N'D' THEN N'assigned' ELSE N'unassigned' END,CASE WHEN col<>N'D' THEN N'Locum' END,N'Example Block',col,CONCAT(N'CCC!',col,N'2') FROM(VALUES(N'C'),(N'D'),(N'E')) columns(col);
IF (SELECT COUNT(*) FROM paws.CalendarActivity WHERE SourceSha256=REPLICATE('A',64) AND SourceRow=2)<>3 THROW 55390,'Physical row staffing cells collapsed.',1;
-- Null faculty cannot become another activity, an unnamed label, or a fake key.
BEGIN TRY UPDATE paws.CalendarActivity SET Category=N'clinical_day' WHERE ActivityId=@Locum;THROW 55390,'Null faculty outside CCC accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>547 THROW;END CATCH;
BEGIN TRY UPDATE paws.CalendarActivity SET StaffingLabel=NULL WHERE ActivityId=@Locum;THROW 55390,'Missing Locum label accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>547 THROW;END CATCH;
BEGIN TRY UPDATE paws.CalendarActivity SET StaffingLabel=N'Unknown' WHERE ActivityId=@Locum;THROW 55390,'Unknown staffing accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>547 THROW;END CATCH;
BEGIN TRY UPDATE paws.CalendarActivity SET SourceColumn=NULL,SourceSlotKey=N'CCC!2' WHERE ActivityId=@Locum;THROW 55390,'Null source column accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>547 THROW;END CATCH;
BEGIN TRY UPDATE paws.CalendarActivity SET FacultyId=@Inactive WHERE StaffingKind=N'assigned' AND SourceColumn=N'D';THROW 55390,'Inactive MASTER assignment accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>55306 THROW;END CATCH;
IF paws_api.CalendarActivityAvailability(@Other,'2026-10-20','09:00','10:00',NULL)<>N'Available' THROW 55390,'Locum blocked unrelated faculty.',1;
DECLARE @Result TABLE(responseJson nvarchar(max));DECLARE @Response nvarchar(max);
INSERT @Result EXEC paws_api.ListCalendarActivities N'ccc-slots-admin','2026-10-01','2026-11-01',NULL,N'ccc',NULL,100,0;
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.activities'))<>4 OR (SELECT COUNT(*) FROM OPENJSON(@Response,'$.activities') WHERE JSON_VALUE(value,'$.staffingKind')=N'unassigned' AND JSON_VALUE(value,'$.facultyKey') IS NULL AND JSON_VALUE(value,'$.facultyDisplayName')=N'Locum')<>2 THROW 55390,'Public authorized staffing list incomplete.',1;
INSERT @Result EXEC paws_api.ListCalendarActivities N'ccc-slots-faculty','2026-10-01','2026-11-01',NULL,N'ccc',NULL,100,0;
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.activities'))<>2 OR EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.activities') WHERE JSON_VALUE(value,'$.staffingKind')=N'unassigned') THROW 55390,'Personal scope exposed unassigned slots.',1;
DECLARE @Version varchar(16)=(SELECT CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ActivityId=@Locum);
INSERT @Result EXEC paws_api.ResolveCalendarActivityDayTime N'ccc-slots-admin',@Locum,@Version,'2026-10-20','09:00','10:00',N'Synthetic evidence',N'Confirmed fixture time';
SELECT @Response=responseJson FROM @Result;
IF JSON_VALUE(@Response,'$.staffingLabel')<>N'Locum' OR JSON_VALUE(@Response,'$.timeStatus')<>N'verified' OR JSON_VALUE(@Response,'$.facultyKey') IS NOT NULL THROW 55390,'Unassigned timing lost staffing or identity safety.',1;
IF paws_api.CalendarActivityAvailability(@Other,'2026-10-20','09:00','10:00',NULL)<>N'Available' THROW 55390,'Verified Locum blocked faculty.',1;
IF paws_api.MasterRefreshSnapshot('2026-27')<>(SELECT DoeSnapshot FROM dbo.CccSlotContext) THROW 55390,'CCC schema or slots changed DOE/roles.',1;
PRINT 'MASTER_CCC_SLOTS_ACCEPTANCE_OK';
