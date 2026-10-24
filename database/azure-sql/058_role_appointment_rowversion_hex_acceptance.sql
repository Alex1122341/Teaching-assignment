:ON ERROR EXIT
SET NOCOUNT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 55882,'Requires VetMed-Ops.',1;
IF OBJECT_ID(N'paws.RoleAppointmentSchedule',N'U') IS NULL OR OBJECT_ID(N'paws_api.SetRoleAppointmentPeriods',N'P') IS NULL
 THROW 55883,'Role Appointment schedule or save procedure missing.',1;
GO
DECLARE @BadVersions bigint;
SELECT @BadVersions=COUNT_BIG(*)
FROM paws.RoleAppointmentSchedule
WHERE LEN(CONVERT(varchar(18),CONVERT(varbinary(8),ScheduleVersion),1))<>18
 OR LEFT(CONVERT(varchar(18),CONVERT(varbinary(8),ScheduleVersion),1),2)<>'0x';
IF @BadVersions<>0 THROW 55884,'Schedule version hex conversion failed.',1;

DECLARE @Definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'paws_api.SetRoleAppointmentPeriods',N'P'));
DECLARE @Probe nvarchar(max)=N'CONVERT(varchar(18),CONVERT(varbinary(8),ScheduleVersion),1)';
IF @Definition IS NULL OR (LEN(@Definition)-LEN(REPLACE(@Definition,@Probe,N'')))/LEN(@Probe)<>2
 THROW 55885,'Stored procedure version read/write still uses raw rowversion conversion.',1;
IF CHARINDEX(N'THROW 53509',@Definition)=0 OR CHARINDEX(N'WITH(UPDLOCK,HOLDLOCK)',@Definition)=0
 THROW 55886,'Optimistic concurrency guard changed.',1;

PRINT N'ROLE_APPOINTMENT_ROWVERSION_HEX_READONLY_ACCEPTANCE_PASSED';
GO
