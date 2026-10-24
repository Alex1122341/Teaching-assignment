:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'staging.MasterCccSchemaBaseline') IS NULL THROW 55300,'CCC upgrade baseline required.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM staging.CccReplacement WHERE FormatVersion=2)
 OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE FacultyId IS NULL OR StaffingKind<>N'assigned' OR StaffingLabel IS NOT NULL OR BlockLabel IS NOT NULL OR SourceColumn IS NOT NULL OR SourceSlotKey IS NOT NULL)
 OR EXISTS(SELECT 1 FROM staging.MasterCccSchemaBaseline WHERE AfterSha256 IS NULL OR AfterSha256<>CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.'+ObjectName))),2)) THROW 55308,'CCC staffing or changed module prevents rollback.',1;
DECLARE @Name nvarchar(260),@Kind nvarchar(16),@Definition nvarchar(max),@Sql nvarchar(max);
DECLARE modules CURSOR LOCAL FAST_FORWARD FOR SELECT ObjectName,ObjectKind,BeforeDefinition FROM staging.MasterCccSchemaBaseline ORDER BY ObjectName;
OPEN modules;FETCH NEXT FROM modules INTO @Name,@Kind,@Definition;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @Sql=N'CREATE OR ALTER '+SUBSTRING(@Definition,CHARINDEX(@Kind,@Definition),LEN(@Definition));
 EXEC sys.sp_executesql @Sql;
 FETCH NEXT FROM modules INTO @Name,@Kind,@Definition;
END;
CLOSE modules;DEALLOCATE modules;
DROP TRIGGER paws.ValidateMasterCccIdentity;
DROP PROCEDURE paws_api.AcquireCccCalendarYearLock;
DROP PROCEDURE paws_api.StageMasterCccReplacement;
ALTER TABLE staging.CccReplacement DROP CONSTRAINT CK_CccReplacement_MasterFormat,DF_CccReplacement_FormatVersion;
ALTER TABLE staging.CccReplacement DROP COLUMN FormatVersion,SourceManifestSha256,SourcePayloadManifestSha256,TrustedRowsSha256,SourceSlotCount,SourceAssignedCount,SourceUnassignedCount;
ALTER TABLE paws.CalendarActivity DROP CONSTRAINT CK_CalendarActivity_Staffing,CK_CalendarActivity_SourceSlot,UQ_CalendarActivity_Source,DF_CalendarActivity_StaffingKind;
ALTER TABLE paws.CalendarActivity DROP COLUMN StaffingKind,StaffingLabel,BlockLabel,SourceColumn,SourceSlotKey;
DROP INDEX IX_CalendarActivity_FacultyRange ON paws.CalendarActivity;
ALTER TABLE paws.CalendarActivity ALTER COLUMN FacultyId uniqueidentifier NOT NULL;
CREATE INDEX IX_CalendarActivity_FacultyRange ON paws.CalendarActivity(FacultyId,StartDate,EndDate);
ALTER TABLE paws.CalendarActivity ADD CONSTRAINT UQ_CalendarActivity_Source UNIQUE(SourceSha256,SourceSheet,SourceRow);
DROP TABLE staging.MasterCccSchemaBaseline;
COMMIT;
