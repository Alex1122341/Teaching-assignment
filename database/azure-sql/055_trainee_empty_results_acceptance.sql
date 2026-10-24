:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'dbo.TraineeContext') IS NULL THROW 55590,'Synthetic trainee fixture required.',1;
DECLARE @Self uniqueidentifier=(SELECT A FROM dbo.TraineeContext),@Response nvarchar(max);
DECLARE @Result TABLE(responseJson nvarchar(max));
DECLARE @Cases TABLE(Id int IDENTITY PRIMARY KEY,Actor nvarchar(128),RoleName nvarchar(128),FacultyId uniqueidentifier,Year varchar(7),Query nvarchar(200),Category nvarchar(32));
INSERT @Cases VALUES
 (N'trainee-self',N'faculty',@Self,'2026-27',N'no-matching-faculty-or-notes-555',NULL),
 (N'trainee-admin',N'owner',NULL,'2026-27',N'no-matching-faculty-or-notes-555',NULL),
 (N'trainee-self',N'faculty',@Self,'2026-27',N'',N'undergrad'),
 (N'trainee-admin',N'owner',NULL,'2026-27',N'',N'vetm506'),
 (N'trainee-self',N'faculty',@Self,'2027-28',N'',N'preceptor'),
 (N'trainee-admin',N'owner',NULL,'2027-28',N'',N'preceptor');
DECLARE @Id int=1,@Actor nvarchar(128),@Role nvarchar(128),@Faculty uniqueidentifier,@Year varchar(7),@Query nvarchar(200),@Category nvarchar(32);
WHILE @Id<=(SELECT MAX(Id) FROM @Cases)
BEGIN
 SELECT @Actor=Actor,@Role=RoleName,@Faculty=FacultyId,@Year=Year,@Query=Query,@Category=Category FROM @Cases WHERE Id=@Id;
 INSERT @Result EXEC paws_api.ListTraineeSource @Actor,@Year,@Query,@Category,@Role,@Faculty;
 SELECT @Response=responseJson FROM @Result;DELETE @Result;
 IF COALESCE(JSON_QUERY(@Response,'$.rows'),N'NULL')<>N'[]'
  OR NOT EXISTS(SELECT 1 FROM OPENJSON(@Response) WHERE [key]=N'rows' AND [type]=4)
  OR COALESCE(JSON_VALUE(@Response,'$.scope.actorUid'),N'')<>@Actor
  OR COALESCE(JSON_VALUE(@Response,'$.scope.role'),N'')<>@Role
  OR JSON_VALUE(@Response,'$.version') IS NULL THROW 55590,'Empty trainee result lost array, version or scope.',1;
 SET @Id+=1;
END;
PRINT 'MASTER_TRAINEE_EMPTY_ARRAY_ACCEPTANCE_OK';
