:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'staging.TraineeSchemaBaseline') IS NULL THROW 55400,'Trainee baseline required.',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'staging.TraineeEmptyResultBaseline') IS NOT NULL
 OR EXISTS(SELECT 1 FROM paws.TraineeSourceEvidence) OR EXISTS(SELECT 1 FROM staging.MasterRefresh WHERE Domain=N'trainees')
 OR EXISTS(SELECT 1 FROM paws.MasterRefreshReceipt WHERE Domain=N'trainees')
 OR EXISTS(SELECT 1 FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id WHERE r.name=N'paws_runtime_trainee_read')
 OR EXISTS(SELECT 1 FROM staging.TraineeSchemaBaseline WHERE AfterSha256 IS NULL OR AfterSha256<>CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.'+ObjectName))),2)) THROW 55408,'Trainee evidence, bindings or edited modules prevent rollback.',1;
DECLARE @Name nvarchar(260),@Kind nvarchar(16),@Definition nvarchar(max),@Sql nvarchar(max);
DECLARE modules CURSOR LOCAL FAST_FORWARD FOR SELECT ObjectName,ObjectKind,BeforeDefinition FROM staging.TraineeSchemaBaseline ORDER BY ObjectName;
OPEN modules;FETCH NEXT FROM modules INTO @Name,@Kind,@Definition;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @Sql=N'CREATE OR ALTER '+SUBSTRING(@Definition,CHARINDEX(@Kind,@Definition),LEN(@Definition));EXEC sys.sp_executesql @Sql;
 FETCH NEXT FROM modules INTO @Name,@Kind,@Definition;
END;
CLOSE modules;DEALLOCATE modules;
DROP PROCEDURE paws_api.PreviewMasterAppointments;
DROP PROCEDURE paws_api.CommitMasterAppointments;
DROP PROCEDURE paws_api.RecoverMasterAppointments;
DROP PROCEDURE paws_api.PreviewMasterTrainees;
DROP PROCEDURE paws_api.CommitMasterTrainees;
DROP PROCEDURE paws_api.RecoverMasterTrainees;
DROP PROCEDURE paws_api.LockMasterTraineeScope;
DROP PROCEDURE paws_api.ListTraineeSource;
DROP TABLE paws.TraineeSourceEvidence;
DROP ROLE paws_runtime_trainee_read;
DROP TABLE staging.TraineeSchemaBaseline;
COMMIT;
