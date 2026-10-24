/* Preserve the authorized read scope and emit [] for an empty scalar JSON projection. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws.TraineeSourceEvidence') IS NULL
 OR OBJECT_ID(N'staging.TraineeSchemaBaseline') IS NULL OR OBJECT_ID(N'staging.TraineeEmptyResultBaseline') IS NOT NULL
 THROW 55500,'Accepted trainee foundation and unapplied empty-result patch required.',1;
DECLARE @Before nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListTraineeSource')),
 @Needle nvarchar(100)=N'JSON_QUERY(@Rows) rows',@Replacement nvarchar(120)=N'JSON_QUERY(COALESCE(@Rows,N''[]'')) rows',@Patched nvarchar(max);
IF @Before IS NULL OR (LEN(@Before)-LEN(REPLACE(@Before,@Needle,N'')))/LEN(@Needle)<>1
 THROW 55500,'Unexpected trainee reader definition; inspect before patching.',1;
SET @Patched=REPLACE(@Before,@Needle,@Replacement);
IF CHARINDEX(N'PROCEDURE',UPPER(@Patched))=0 THROW 55500,'Expected stored procedure definition.',1;
BEGIN TRY
 BEGIN TRANSACTION;
 CREATE TABLE staging.TraineeEmptyResultBaseline(
  ObjectName nvarchar(260) NOT NULL PRIMARY KEY,BeforeDefinition nvarchar(max) NOT NULL,
  BeforeSha256 char(64) NOT NULL,AfterSha256 char(64) NULL,AppliedAtUtc datetime2(7) NOT NULL
 );
 INSERT staging.TraineeEmptyResultBaseline(ObjectName,BeforeDefinition,BeforeSha256,AppliedAtUtc)
 VALUES(N'paws_api.ListTraineeSource',@Before,CONVERT(varchar(64),HASHBYTES('SHA2_256',@Before),2),SYSUTCDATETIME());
 SET @Patched=N'ALTER '+SUBSTRING(@Patched,CHARINDEX(N'PROCEDURE',UPPER(@Patched)),LEN(@Patched));
 EXEC sys.sp_executesql @Patched;
 UPDATE staging.TraineeEmptyResultBaseline SET AfterSha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(ObjectName))),2);
 COMMIT;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
PRINT 'MASTER_TRAINEE_EMPTY_ARRAY_PATCH_OK';
