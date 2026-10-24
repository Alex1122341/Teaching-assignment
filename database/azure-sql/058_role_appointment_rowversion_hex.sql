:ON ERROR EXIT
-- Correct rowversion serialization only; leave existing concurrency, authorization,
-- history, table schema, grants, and DOE behavior unchanged.
SET NOCOUNT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 55880,'Requires VetMed-Ops.',1;
IF OBJECT_ID(N'paws.RoleAppointmentSchedule',N'U') IS NULL OR OBJECT_ID(N'paws_api.SetRoleAppointmentPeriods',N'P') IS NULL
 THROW 55881,'Existing Role Appointment schedule and approved procedure required.',1;
GO
CREATE OR ALTER PROCEDURE paws_api.SetRoleAppointmentPeriods
 @RoleAssignmentId uniqueidentifier,@ExpectedVersion varchar(18),@PeriodsJson nvarchar(max),@ActorFirebaseUid nvarchar(128)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF ISJSON(@PeriodsJson)<>1 OR LEFT(LTRIM(@PeriodsJson),1)<>N'[' OR RIGHT(RTRIM(@PeriodsJson),1)<>N']' THROW 53501,'Invalid periods.',1;
 DECLARE @p TABLE(n int,StartDate date,EndDate date,RawStart nvarchar(40),RawEnd nvarchar(40),Kind int);
 INSERT @p SELECT TRY_CONVERT(int,j.[key]),TRY_CONVERT(date,JSON_VALUE(j.value,'$.startDate'),23),TRY_CONVERT(date,JSON_VALUE(j.value,'$.endDate'),23),JSON_VALUE(j.value,'$.startDate'),JSON_VALUE(j.value,'$.endDate'),j.type FROM OPENJSON(@PeriodsJson) j;
 IF (SELECT COUNT(*) FROM @p)>12 OR EXISTS(SELECT 1 FROM @p WHERE Kind<>5 OR StartDate IS NULL OR LEN(RawStart)<>10 OR CONVERT(varchar(10),StartDate,23)<>RawStart OR (RawEnd IS NOT NULL AND (EndDate IS NULL OR LEN(RawEnd)<>10 OR CONVERT(varchar(10),EndDate,23)<>RawEnd)) OR EndDate<StartDate)
 THROW 53501,'Invalid effective period dates.',1;
 IF EXISTS(SELECT 1 FROM @p a JOIN @p b ON a.n<b.n WHERE a.StartDate<=COALESCE(b.EndDate,'9999-12-31') AND b.StartDate<=COALESCE(a.EndDate,'9999-12-31')) THROW 53501,'Overlapping effective periods.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WITH(UPDLOCK,HOLDLOCK) WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0 AND BaseRole IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin'))
   THROW 53503,'Administrator required.',1;
  IF NOT EXISTS(SELECT 1 FROM paws.RoleAssignment WITH(UPDLOCK,HOLDLOCK) WHERE RoleAssignmentId=@RoleAssignmentId) THROW 53504,'Appointment not found.',1;
  DECLARE @old nvarchar(max),@version varchar(18);
  SELECT @old=PeriodsJson,@version=CONVERT(varchar(18),CONVERT(varbinary(8),ScheduleVersion),1) FROM paws.RoleAppointmentSchedule WITH(UPDLOCK,HOLDLOCK) WHERE RoleAssignmentId=@RoleAssignmentId;
  IF (@version IS NULL AND @ExpectedVersion IS NOT NULL) OR (@version IS NOT NULL AND (@ExpectedVersion IS NULL OR @version<>@ExpectedVersion)) THROW 53509,'Appointment changed; reload.',1;
  IF @version IS NULL INSERT paws.RoleAppointmentSchedule(RoleAssignmentId,PeriodsJson,UpdatedAtUtc,UpdatedByFirebaseUid) VALUES(@RoleAssignmentId,@PeriodsJson,SYSUTCDATETIME(),@ActorFirebaseUid);
  ELSE UPDATE paws.RoleAppointmentSchedule SET PeriodsJson=@PeriodsJson,UpdatedAtUtc=SYSUTCDATETIME(),UpdatedByFirebaseUid=@ActorFirebaseUid WHERE RoleAssignmentId=@RoleAssignmentId;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson)
   VALUES(NEWID(),N'role_periods_updated',N'role_assignment',@RoleAssignmentId,@ActorFirebaseUid,SYSUTCDATETIME(),(SELECT JSON_QUERY(@old) AS beforePeriods,JSON_QUERY(@PeriodsJson) AS afterPeriods FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES));
  SELECT RoleAssignmentId AS roleAssignmentId,CONVERT(varchar(18),CONVERT(varbinary(8),ScheduleVersion),1) AS scheduleVersion FROM paws.RoleAppointmentSchedule WHERE RoleAssignmentId=@RoleAssignmentId;
  COMMIT;
 END TRY
 BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH
END;
GO
