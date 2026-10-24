:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'staging.TraineeEmptyResultBaseline') IS NULL
 THROW 55500,'Empty-result patch baseline required.',1;
BEGIN TRY
 BEGIN TRANSACTION;
 IF (SELECT COUNT(*) FROM staging.TraineeEmptyResultBaseline)<>1 OR EXISTS(
  SELECT 1 FROM staging.TraineeEmptyResultBaseline WHERE ObjectName<>N'paws_api.ListTraineeSource'
   OR BeforeSha256<>CONVERT(varchar(64),HASHBYTES('SHA2_256',BeforeDefinition),2)
   OR AfterSha256 IS NULL OR OBJECT_ID(ObjectName) IS NULL
   OR OBJECT_DEFINITION(OBJECT_ID(ObjectName)) IS NULL
   OR AfterSha256<>CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(ObjectName))),2)
 ) THROW 55508,'Edited trainee reader or invalid baseline prevents rollback.',1;
 DECLARE @Before nvarchar(max)=(SELECT BeforeDefinition FROM staging.TraineeEmptyResultBaseline),@Sql nvarchar(max);
 SET @Sql=N'ALTER '+SUBSTRING(@Before,CHARINDEX(N'PROCEDURE',UPPER(@Before)),LEN(@Before));
 EXEC sys.sp_executesql @Sql;
 DROP TABLE staging.TraineeEmptyResultBaseline;
 COMMIT;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
PRINT 'MASTER_TRAINEE_EMPTY_ARRAY_ROLLBACK_OK';
