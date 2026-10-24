/* Guarded rollback: remove only the added CCC read procedure, never the CCC records. */
IF DB_NAME()<>N'VetMed-Ops' THROW 55708,'The CCC rollback requires VetMed-Ops.',1;
DECLARE @ObjectId int=OBJECT_ID(N'paws_api.ListCccSchedule',N'P');
IF @ObjectId IS NULL THROW 55708,'The CCC reader is not installed.',1;
DECLARE @ExpectedDefinitionSha256 varchar(64)=N'$(PAWS_CCC_SCHEDULE_DEFINITION_SHA256)';
DECLARE @Definition nvarchar(max)=OBJECT_DEFINITION(@ObjectId);
IF LEN(@ExpectedDefinitionSha256)<>64 OR @ExpectedDefinitionSha256 LIKE '%[^0-9A-Fa-f]%'
 OR @Definition IS NULL
 OR CONVERT(varchar(64),HASHBYTES('SHA2_256',@Definition),2)<>UPPER(@ExpectedDefinitionSha256)
 THROW 55708,'CCC reader definition differs from the accepted installed version; refuse rollback.',1;
IF EXISTS(
 SELECT 1 FROM sys.database_permissions p
 WHERE p.major_id=@ObjectId AND p.class=1
   AND NOT (p.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_read')
            AND p.permission_name=N'EXECUTE' AND p.state=N'G')
) THROW 55708,'Unexpected CCC reader grants; refuse rollback.',1;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
REVOKE EXECUTE ON OBJECT::paws_api.ListCccSchedule FROM paws_runtime_read;
DROP PROCEDURE paws_api.ListCccSchedule;
COMMIT TRANSACTION;
GO
