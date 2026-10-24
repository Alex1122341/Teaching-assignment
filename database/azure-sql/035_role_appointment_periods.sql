:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53500,'Requires VetMed-Ops.',1;
IF OBJECT_ID(N'paws.RoleAssignment',N'U') IS NULL OR OBJECT_ID(N'paws.SupportTable',N'U') IS NULL
 THROW 53500,'Requires accepted role and support schema.',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'paws.RoleAppointmentSchedule',N'U') IS NULL
 CREATE TABLE paws.RoleAppointmentSchedule (
  RoleAssignmentId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES paws.RoleAssignment(RoleAssignmentId),
  PeriodsJson nvarchar(max) NOT NULL CHECK(ISJSON(PeriodsJson)=1),
  UpdatedAtUtc datetime2(7) NOT NULL,
  UpdatedByFirebaseUid nvarchar(128) NOT NULL,
  ScheduleVersion rowversion NOT NULL
 );
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
  SELECT @old=PeriodsJson,@version=CONVERT(varchar(18),ScheduleVersion,1) FROM paws.RoleAppointmentSchedule WITH(UPDLOCK,HOLDLOCK) WHERE RoleAssignmentId=@RoleAssignmentId;
  IF (@version IS NULL AND @ExpectedVersion IS NOT NULL) OR (@version IS NOT NULL AND (@ExpectedVersion IS NULL OR @version<>@ExpectedVersion)) THROW 53509,'Appointment changed; reload.',1;
  IF @version IS NULL INSERT paws.RoleAppointmentSchedule(RoleAssignmentId,PeriodsJson,UpdatedAtUtc,UpdatedByFirebaseUid) VALUES(@RoleAssignmentId,@PeriodsJson,SYSUTCDATETIME(),@ActorFirebaseUid);
  ELSE UPDATE paws.RoleAppointmentSchedule SET PeriodsJson=@PeriodsJson,UpdatedAtUtc=SYSUTCDATETIME(),UpdatedByFirebaseUid=@ActorFirebaseUid WHERE RoleAssignmentId=@RoleAssignmentId;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson)
   VALUES(NEWID(),N'role_periods_updated',N'role_assignment',@RoleAssignmentId,@ActorFirebaseUid,SYSUTCDATETIME(),(SELECT JSON_QUERY(@old) AS beforePeriods,JSON_QUERY(@PeriodsJson) AS afterPeriods FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES));
  SELECT RoleAssignmentId AS roleAssignmentId,CONVERT(varchar(18),ScheduleVersion,1) AS scheduleVersion FROM paws.RoleAppointmentSchedule WHERE RoleAssignmentId=@RoleAssignmentId;
  COMMIT;
 END TRY
 BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH
END;
GO
GRANT SELECT ON OBJECT::paws.RoleAppointmentSchedule TO paws_runtime_read;
GRANT EXECUTE ON OBJECT::paws_api.SetRoleAppointmentPeriods TO paws_runtime_faculty_admin_write;
-- Explicitly register only this new schedule table for Developer guarded recovery.
IF NOT EXISTS(SELECT 1 FROM paws.SupportTable WHERE TableName=N'[paws].[RoleAppointmentSchedule]')
 INSERT paws.SupportTable(TableName,ColumnsSql,TypedSql,PredicateSql,UpdateSql,HasIdentity,ReadSql,InsertSql)
 VALUES(N'[paws].[RoleAppointmentSchedule]',N'[RoleAssignmentId],[PeriodsJson],[UpdatedAtUtc],[UpdatedByFirebaseUid]',
 N'[RoleAssignmentId] uniqueidentifier ''$."RoleAssignmentId"'',[PeriodsJson] nvarchar(max) ''$."PeriodsJson"'',[UpdatedAtUtc] datetime2(7) ''$."UpdatedAtUtc"'',[UpdatedByFirebaseUid] nvarchar(128) ''$."UpdatedByFirebaseUid"''',
 N't.[RoleAssignmentId]=k.[RoleAssignmentId]',N'[PeriodsJson]=r.[PeriodsJson],[UpdatedAtUtc]=r.[UpdatedAtUtc],[UpdatedByFirebaseUid]=r.[UpdatedByFirebaseUid]',0,
 N't.[RoleAssignmentId],t.[PeriodsJson],t.[UpdatedAtUtc],t.[UpdatedByFirebaseUid]',N'[RoleAssignmentId],[PeriodsJson],[UpdatedAtUtc],[UpdatedByFirebaseUid]');
GO
CREATE OR ALTER TRIGGER paws.SupportCapture_RoleAppointmentSchedule ON paws.RoleAppointmentSchedule AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @op uniqueidentifier=TRY_CONVERT(uniqueidentifier,SESSION_CONTEXT(N'paws_support_operation'));
 IF @op IS NULL RETURN;
 IF NOT EXISTS(SELECT 1 FROM paws.SupportOperation WHERE OperationId=@op AND UndoneAtUtc IS NULL) THROW 53302,'Support operation is not active.',1;
 INSERT paws.SupportChange(OperationId,TableName,KeyJson,BeforeJson,AfterJson)
 SELECT @op,N'[paws].[RoleAppointmentSchedule]',
 (SELECT COALESCE(i.RoleAssignmentId,d.RoleAssignmentId) AS RoleAssignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),
 CASE WHEN d.RoleAssignmentId IS NOT NULL THEN (SELECT d.RoleAssignmentId,d.PeriodsJson,d.UpdatedAtUtc,d.UpdatedByFirebaseUid FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) END,
 CASE WHEN i.RoleAssignmentId IS NOT NULL THEN (SELECT i.RoleAssignmentId,i.PeriodsJson,i.UpdatedAtUtc,i.UpdatedByFirebaseUid FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) END
 FROM inserted i FULL JOIN deleted d ON i.RoleAssignmentId=d.RoleAssignmentId;
END;
GO
COMMIT;
GO

