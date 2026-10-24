/* Annual source evidence. Browser callers receive only their authorized scope. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws.MasterRefreshReceipt') IS NULL OR OBJECT_ID(N'staging.MasterCccSchemaBaseline') IS NULL THROW 55400,'Accepted MASTER foundations required.',1;
IF OBJECT_ID(N'paws.TraineeSourceEvidence') IS NOT NULL THROW 55400,'Inspect existing trainee evidence upgrade.',1;
BEGIN TRANSACTION;
CREATE TABLE staging.TraineeSchemaBaseline(ObjectName nvarchar(260) NOT NULL PRIMARY KEY,ObjectKind nvarchar(16) NOT NULL,BeforeDefinition nvarchar(max) NOT NULL,AfterSha256 char(64) NULL);
INSERT staging.TraineeSchemaBaseline(ObjectName,ObjectKind,BeforeDefinition)
SELECT name,kind,OBJECT_DEFINITION(OBJECT_ID(N'paws_api.'+name)) FROM(VALUES(N'MasterRefreshSnapshot',N'FUNCTION'),(N'PreviewMasterRefresh',N'PROCEDURE'),(N'CommitMasterRefresh',N'PROCEDURE'),(N'RecoverMasterRefresh',N'PROCEDURE'),(N'ListChangeHistoryEvents',N'PROCEDURE')) names(name,kind);
CREATE TABLE paws.TraineeSourceEvidence(
 FacultyId uniqueidentifier NOT NULL REFERENCES paws.Faculty(FacultyId),AcademicYear varchar(7) NOT NULL,
 SourceSha256 char(64) NOT NULL,SourceManifestSha256 char(64) NOT NULL,
 SourceRefJson nvarchar(max) NOT NULL CHECK(ISJSON(SourceRefJson)=1),RawCountsJson nvarchar(max) NOT NULL CHECK(ISJSON(RawCountsJson)=1),
 CategoryDoeJson nvarchar(max) NOT NULL CHECK(ISJSON(CategoryDoeJson)=1),SourceDoe decimal(12,6) NULL,SourceTotal decimal(12,6) NULL,
 PrivateNotesJson nvarchar(max) NULL CHECK(PrivateNotesJson IS NULL OR ISJSON(PrivateNotesJson)=1),CellEvidenceJson nvarchar(max) NULL CHECK(CellEvidenceJson IS NULL OR ISJSON(CellEvidenceJson)=1),
 AllocationStatus nvarchar(32) NOT NULL CHECK(AllocationStatus IN(N'matched',N'source_missing',N'held_mismatch',N'needs_review')),
 SourceImportBatchId uniqueidentifier NOT NULL REFERENCES staging.ImportBatch(ImportBatchId),UpdatedAtUtc datetime2(7) NOT NULL,UpdatedBy nvarchar(128) NOT NULL,EvidenceVersion rowversion NOT NULL,
 CONSTRAINT PK_TraineeSourceEvidence PRIMARY KEY(FacultyId,AcademicYear)
);
CREATE ROLE paws_runtime_trainee_read AUTHORIZATION dbo;
GO
CREATE PROCEDURE paws_api.ListTraineeSource
 @ActorFirebaseUid nvarchar(128),@AcademicYear varchar(7),@Query nvarchar(200)=N'',@Category nvarchar(32)=NULL,@ExpectedRole nvarchar(128)=NULL,@ExpectedFacultyId uniqueidentifier=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Role nvarchar(128),@Faculty uniqueidentifier,@Admin bit;
  SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@Faculty=FacultyId FROM paws.UserProfile WITH(HOLDLOCK) WHERE FirebaseUid=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Active=1 AND MustChangePassword=0;
  SET @Admin=IIF(@Role IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin'),1,0);
  IF @Role IS NULL OR @Role NOT IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin',N'faculty',N'hicc',N'visc')
   OR(@Admin=0 AND(@Faculty IS NULL OR NOT EXISTS(SELECT 1 FROM paws.Faculty WHERE FacultyId=@Faculty AND Active=1)))
   OR @ExpectedRole IS NULL OR @ExpectedRole COLLATE Latin1_General_100_BIN2<>@Role COLLATE Latin1_General_100_BIN2
   OR(@Admin=0 AND(@ExpectedFacultyId IS NULL OR @ExpectedFacultyId<>@Faculty)) OR(@Admin=1 AND @ExpectedFacultyId IS NOT NULL) THROW 55401,'Current authorized trainee scope required.',1;
  IF LEN(ISNULL(@AcademicYear,''))<>7 OR TRY_CONVERT(int,LEFT(@AcademicYear,4)) NOT BETWEEN 1900 AND 9998 OR @AcademicYear<>CONCAT(LEFT(@AcademicYear,4),'-',RIGHT(CONVERT(varchar(4),TRY_CONVERT(int,LEFT(@AcademicYear,4))+1),2))
   OR @Query IS NULL OR @Category IS NOT NULL AND @Category COLLATE Latin1_General_100_BIN2 NOT IN(N'undergrad',N'vetm506',N'preceptor',N'im',N'grad_primary',N'grad_cosupervised',N'postdoc') THROW 55402,'Invalid trainee filters.',1;
  DECLARE @Index int=CASE @Category WHEN N'undergrad' THEN 0 WHEN N'vetm506' THEN 1 WHEN N'preceptor' THEN 2 WHEN N'im' THEN 3 WHEN N'grad_primary' THEN 4 WHEN N'grad_cosupervised' THEN 5 WHEN N'postdoc' THEN 6 END;
  DECLARE @Pattern nvarchar(850)=N'%'+REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(@Query)),N'~',N'~~'),N'%',N'~%'),N'_',N'~_'),N'[',N'~[')+N'%',@Rows nvarchar(max);
  DECLARE @LatestSource char(64)=(SELECT TOP(1) SourceSha256 FROM paws.MasterRefreshReceipt WHERE Domain=N'trainees' AND AcademicYear=@AcademicYear AND Status=N'committed' ORDER BY CommittedAtUtc DESC,ReceiptId DESC);
  SET @Rows=(SELECT f.FacultyId facultyId,COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) displayName,
   JSON_QUERY(data.RawCounts) rawCounts,t.SourceDoe sourceDoe,t.SourceTotal sourceTotal,s.RawDoe currentRawDoe,
   CASE WHEN t.FacultyId IS NULL AND s.SnapshotId IS NULL THEN N'not_provided' WHEN t.FacultyId IS NULL OR @LatestSource IS NULL OR t.SourceSha256<>@LatestSource THEN N'previous_source' ELSE t.AllocationStatus END sourceStatus,
   JSON_QUERY(t.PrivateNotesJson) privateNotes,JSON_QUERY(t.SourceRefJson) sourceRef
   FROM paws.Faculty f LEFT JOIN paws.TraineeSourceEvidence t ON t.FacultyId=f.FacultyId AND t.AcademicYear=@AcademicYear
   LEFT JOIN paws.DoeSupervisionSourceSnapshot s ON s.FacultyId=f.FacultyId AND s.AcademicYear=@AcademicYear
   OUTER APPLY(SELECT COALESCE(t.RawCountsJson,JSON_QUERY(s.EvidenceJson,'$.counts')) RawCounts) data
   WHERE f.Active=1 AND(@Admin=1 OR f.FacultyId=@Faculty)
    AND(@Query=N'' OR f.DisplayName LIKE @Pattern ESCAPE N'~' OR CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName) LIKE @Pattern ESCAPE N'~' OR t.PrivateNotesJson LIKE @Pattern ESCAPE N'~')
    AND(@Index IS NULL OR TRY_CONVERT(decimal(12,6),JSON_VALUE(data.RawCounts,CONCAT(N'$[',@Index,N']')))>0)
   ORDER BY f.DisplayName,f.FacultyId FOR JSON PATH,INCLUDE_NULL_VALUES);
  IF (SELECT COUNT(*) FROM OPENJSON(@Rows))>500 THROW 55404,'Complete bounded trainee coverage required.',1;
  DECLARE @Version varchar(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot(@AcademicYear)),2);
  SELECT(SELECT JSON_QUERY(@Rows) rows,@Version version,
   JSON_QUERY((SELECT @ActorFirebaseUid actorUid,@Role role,CASE WHEN @Admin=0 THEN @Faculty END facultyId,@Admin administrator FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) scope,
   JSON_QUERY(N'["Counts describe supervision assignments, not unique students. Blanks remain unavailable; totals sum known source quantities.","Inactive and unresolved source identities are excluded. Unmatched existing snapshots remain previous-source evidence.","Source DOE and current raw/applied DOE are separate; missing or different source values do not replace recorded allocations."]') coverage
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
  COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON OBJECT::paws_api.ListTraineeSource TO paws_runtime_trainee_read;
GRANT SELECT ON OBJECT::paws.TraineeSourceEvidence TO paws_master_refresh_operator;

GO
ALTER FUNCTION paws_api.MasterRefreshSnapshot(@AcademicYear varchar(7)) RETURNS nvarchar(max)
AS
BEGIN
 DECLARE @Snapshot nvarchar(max)=(SELECT
 JSON_QUERY((SELECT r.* FROM paws.RoleAssignment r WHERE r.AcademicYear=@AcademicYear ORDER BY r.RoleAssignmentId FOR JSON PATH,INCLUDE_NULL_VALUES)) roles,
 JSON_QUERY((SELECT s.RoleAssignmentId,s.PeriodsJson,s.UpdatedAtUtc,s.UpdatedByFirebaseUid,CONVERT(varchar(16),CONVERT(binary(8),s.ScheduleVersion),2) version FROM paws.RoleAppointmentSchedule s JOIN paws.RoleAssignment r ON r.RoleAssignmentId=s.RoleAssignmentId WHERE r.AcademicYear=@AcademicYear ORDER BY s.RoleAssignmentId FOR JSON PATH,INCLUDE_NULL_VALUES)) periods,
 JSON_QUERY((SELECT e.RoleAssignmentId,e.AcademicYear,e.SourceSha256,e.SourceJson,e.AllocationStatus,e.UpdatedAtUtc,e.UpdatedBy,CONVERT(varchar(16),CONVERT(binary(8),e.EvidenceVersion),2) version FROM paws.MasterRoleSourceEvidence e WHERE e.AcademicYear=@AcademicYear ORDER BY e.RoleAssignmentId FOR JSON PATH,INCLUDE_NULL_VALUES)) evidence,
 JSON_QUERY((SELECT d.DefinitionId,d.AcademicYear,d.RoleType,d.ScopeHash,d.SourceJson,d.SourceSha256,d.UpdatedAtUtc,d.UpdatedBy,CONVERT(varchar(16),CONVERT(binary(8),d.DefinitionVersion),2) version FROM paws.MasterRoleDefinition d WHERE d.AcademicYear=@AcademicYear ORDER BY d.DefinitionId FOR JSON PATH,INCLUDE_NULL_VALUES)) definitions,
 JSON_QUERY((SELECT f.FacultyId,f.DisplayName,f.PreferredFirstName,f.PreferredLastName,f.Active,f.UpdatedAtUtc FROM paws.Faculty f ORDER BY f.FacultyId FOR JSON PATH,INCLUDE_NULL_VALUES)) identities,
 JSON_QUERY((SELECT p.PolicyVersionId,p.Revision,p.Status,p.UpdatedAtUtc,JSON_QUERY(paws_api.DoeHistoryPolicySnapshot(p.PolicyVersionId)) bundle FROM paws.DoePolicyVersion p WHERE p.AcademicYear=@AcademicYear ORDER BY p.PolicyVersionId FOR JSON PATH,INCLUDE_NULL_VALUES)) policies,
 JSON_QUERY((SELECT a.* FROM paws.DoeAssignmentFact a WHERE a.AcademicYear=@AcademicYear ORDER BY a.AssignmentFactId FOR JSON PATH,INCLUDE_NULL_VALUES)) facts,
 JSON_QUERY((SELECT s.* FROM paws.DoeSupervisionSourceSnapshot s WHERE s.AcademicYear=@AcademicYear ORDER BY s.SnapshotId FOR JSON PATH,INCLUDE_NULL_VALUES)) supervision,
 JSON_QUERY((SELECT w.* FROM paws.DoeWorkloadSource w WHERE w.AcademicYear=@AcademicYear FOR JSON PATH,INCLUDE_NULL_VALUES)) workload
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
 SET @Snapshot=JSON_MODIFY(@Snapshot,'$.trainees',JSON_QUERY((SELECT t.* FROM paws.TraineeSourceEvidence t WHERE t.AcademicYear=@AcademicYear ORDER BY t.FacultyId FOR JSON PATH,INCLUDE_NULL_VALUES)));
 SET @Snapshot=JSON_MODIFY(@Snapshot,'$.targets',JSON_QUERY((SELECT t.* FROM paws.DoeFacultyTarget t WHERE t.AcademicYear=@AcademicYear ORDER BY t.FacultyId FOR JSON PATH,INCLUDE_NULL_VALUES)));
 SET @Snapshot=JSON_MODIFY(@Snapshot,'$.manualAllocations',JSON_QUERY((SELECT m.* FROM paws.ManualDoeAssignment m WHERE m.AcademicYear=@AcademicYear ORDER BY m.AssignmentId FOR JSON PATH,INCLUDE_NULL_VALUES)));
 SET @Snapshot=JSON_MODIFY(@Snapshot,'$.teaching',JSON_QUERY((SELECT a.*,c.SessionDate sourceSessionDate,c.StartTime sourceStartTime,c.EndTime sourceEndTime,c.SessionType sourceSessionType FROM paws.SessionAssignment a JOIN paws.vCalendarSession c ON c.SessionId=a.SessionId WHERE c.AcademicYear=@AcademicYear ORDER BY a.SessionAssignmentId FOR JSON PATH,INCLUDE_NULL_VALUES)));
 SET @Snapshot=JSON_MODIFY(@Snapshot,'$.assignmentInputs',JSON_QUERY((SELECT i.* FROM paws.DoeAssignmentFactInput i JOIN paws.DoeAssignmentFact a ON a.AssignmentFactId=i.AssignmentFactId WHERE a.AcademicYear=@AcademicYear ORDER BY i.AssignmentFactInputId FOR JSON PATH,INCLUDE_NULL_VALUES)));
 SET @Snapshot=JSON_MODIFY(@Snapshot,'$.calculations',JSON_QUERY((SELECT c.* FROM paws.DoeCalculationRecord c JOIN paws.DoeAssignmentFact a ON a.CurrentCalculationId=c.CalculationId WHERE a.AcademicYear=@AcademicYear ORDER BY c.CalculationId,a.AssignmentFactId FOR JSON PATH,INCLUDE_NULL_VALUES)));
 RETURN @Snapshot;
END;
GO
CREATE PROCEDURE paws_api.PreviewMasterAppointments @Domain nvarchar(32),@AcademicYear varchar(7),@SourceJson nvarchar(max),@ActorFirebaseUid nvarchar(128),@DoeGuardJson nvarchar(max)=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC paws_api.AssertMasterRefreshOperator @ActorFirebaseUid;
  IF @Domain IS NULL OR @Domain<>N'appointments' OR @AcademicYear IS NULL OR LEN(@AcademicYear)<>7 OR TRY_CONVERT(int,LEFT(@AcademicYear,4)) NOT BETWEEN 1900 AND 9998 OR @AcademicYear<>CONCAT(LEFT(@AcademicYear,4),'-',RIGHT(CONVERT(varchar(4),TRY_CONVERT(int,LEFT(@AcademicYear,4))+1),2))
   OR ISNULL(ISJSON(@SourceJson),0)<>1 OR DATALENGTH(@SourceJson)>16777216 OR ISNULL(JSON_VALUE(@SourceJson,'$.academicYear'),'')<>@AcademicYear OR ISNULL(JSON_VALUE(@SourceJson,'$.schemaVersion'),'')<>'1' THROW 55202,'Invalid MASTER source.',1;
  DECLARE @Source varchar(64)=JSON_VALUE(@SourceJson,'$.sourceSha256'),@Manifest varchar(64)=JSON_VALUE(@SourceJson,'$.manifestSha256'),@Batch uniqueidentifier=NEWID(),@Lock int;
  IF LEN(ISNULL(@Source,''))<>64 OR TRY_CONVERT(binary(32),@Source,2) IS NULL OR LEN(ISNULL(@Manifest,''))<>64 OR TRY_CONVERT(binary(32),@Manifest,2) IS NULL THROW 55202,'Invalid source hash.',1;
  IF EXISTS(SELECT 1 FROM(VALUES(N'appointments'),(N'rotations'),(N'cccAllocations'),(N'roleDefinitions'),(N'trainees'),(N'cccSlots'),(N'issues')) p(name) WHERE NOT EXISTS(SELECT 1 FROM OPENJSON(@SourceJson) j WHERE j.[key]=p.name AND j.type=4)) THROW 55202,'MASTER source arrays required.',1;
  DECLARE @Resource nvarchar(255)=N'paws:master-refresh:appointments:'+@AcademicYear;
  EXEC @Lock=sys.sp_getapplock @Resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
  IF @Lock<0 THROW 55209,'MASTER scope busy.',1;
  DECLARE @Items TABLE(n int IDENTITY PRIMARY KEY,SourceJson nvarchar(max),FacultyId uniqueidentifier,RoleType nvarchar(256),Scope nvarchar(1000),SourceDoe decimal(12,6),RoleId uniqueidentifier,IsNew bit NOT NULL DEFAULT 0,Status nvarchar(32),Issue nvarchar(64));
  INSERT @Items(SourceJson,FacultyId,RoleType,Scope,SourceDoe)
   SELECT value,TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.facultyId')),JSON_VALUE(value,'$.roleType'),JSON_VALUE(value,'$.scope'),TRY_CONVERT(decimal(12,6),JSON_VALUE(value,'$.sourceDoe'))
   FROM(SELECT value FROM OPENJSON(@SourceJson,'$.appointments') UNION ALL SELECT value FROM OPENJSON(@SourceJson,'$.rotations') UNION ALL
    SELECT JSON_MODIFY(JSON_MODIFY(value,'$.roleType',N'CCC'),'$.scope',N'CCC shifts') FROM OPENJSON(@SourceJson,'$.cccAllocations')) sourceRows;
  IF (SELECT COUNT(*) FROM @Items) NOT BETWEEN 1 AND 5000 OR EXISTS(SELECT 1 FROM @Items WHERE RoleType IS NULL OR RoleType NOT IN(N'HICC',N'VISC',N'CCC',N'Rotation Participant',N'Designated Rotation Coordinator') OR NULLIF(LTRIM(RTRIM(Scope)),N'') IS NULL OR JSON_QUERY(SourceJson,'$.periods') IS NULL OR TRY_CONVERT(int,JSON_VALUE(SourceJson,'$.sourceRef.row')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(SourceJson,'$.sourceRef.row'))<2 OR SourceDoe<0 OR (JSON_VALUE(SourceJson,'$.sourceDoe') IS NOT NULL AND SourceDoe IS NULL)) THROW 55202,'Invalid appointment rows.',1;
  IF EXISTS(SELECT 1 FROM @Items WHERE ISNULL(UPPER(JSON_VALUE(SourceJson,'$.sourceRef.sha256')),'')<>UPPER(@Source) OR NULLIF(JSON_VALUE(SourceJson,'$.sourceRef.sheet'),'') IS NULL OR NULLIF(JSON_VALUE(SourceJson,'$.sourceRef.column'),'') IS NULL) THROW 55202,'Invalid appointment provenance.',1;
  IF EXISTS(SELECT 1 FROM @Items a JOIN @Items b ON a.n<b.n AND a.FacultyId=b.FacultyId AND a.RoleType=b.RoleType AND a.Scope=b.Scope) THROW 55202,'Duplicate source appointment.',1;
  UPDATE i SET Issue=N'IDENTITY_REVIEW' FROM @Items i WHERE i.FacultyId IS NULL OR NOT EXISTS(SELECT 1 FROM paws.Faculty f WITH(UPDLOCK,HOLDLOCK) WHERE f.FacultyId=i.FacultyId AND f.Active=1);
  UPDATE i SET Issue=N'AMBIGUOUS_ROLE' FROM @Items i WHERE (SELECT COUNT(*) FROM paws.RoleAssignment r WITH(UPDLOCK,HOLDLOCK) WHERE r.AcademicYear=@AcademicYear AND r.FacultyId=i.FacultyId AND r.RoleType=i.RoleType AND LTRIM(RTRIM(r.CourseOrSubjectOrRotation))=i.Scope)>1;
  UPDATE i SET RoleId=r.RoleAssignmentId FROM @Items i JOIN paws.RoleAssignment r WITH(UPDLOCK,HOLDLOCK) ON r.AcademicYear=@AcademicYear AND r.FacultyId=i.FacultyId AND r.RoleType=i.RoleType AND LTRIM(RTRIM(r.CourseOrSubjectOrRotation))=i.Scope WHERE i.Issue IS NULL;
  UPDATE i SET Issue=N'DOE_MISMATCH' FROM @Items i JOIN paws.RoleAssignment r ON r.RoleAssignmentId=i.RoleId WHERE i.SourceDoe IS NOT NULL AND (COALESCE(r.DoeOverrideValue,r.DoeMappedValue) IS NULL OR ABS(COALESCE(r.DoeOverrideValue,r.DoeMappedValue)-i.SourceDoe)>0.000001);
  UPDATE @Items SET Issue=N'SOURCE_DOE_MISSING' WHERE Issue IS NULL AND RoleId IS NOT NULL AND SourceDoe IS NULL;
  IF ISNULL(ISJSON(@DoeGuardJson),0)<>1 OR ISNULL(JSON_VALUE(@DoeGuardJson,'$.schemaVersion'),'')<>'1' OR ISNULL(UPPER(JSON_VALUE(@DoeGuardJson,'$.sourceManifestSha256')),'')<>UPPER(@Manifest)
   OR LEN(ISNULL(JSON_VALUE(@DoeGuardJson,'$.doeGuardHash'),''))<>64 OR TRY_CONVERT(binary(32),JSON_VALUE(@DoeGuardJson,'$.doeGuardHash'),2) IS NULL
   OR NOT EXISTS(SELECT 1 FROM OPENJSON(@DoeGuardJson) WHERE [key]='rows' AND type=4) THROW 55206,'Trusted DOE guard required.',1;
  IF ISNULL(JSON_VALUE(@DoeGuardJson,'$.contextHash'),'')<>CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot(@AcademicYear)),2) THROW 55204,'DOE context changed before staging.',1;
  UPDATE i SET Issue=N'ENGINE_DOE_REVIEW' FROM @Items i WHERE i.Issue IS NULL AND i.SourceDoe IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM OPENJSON(@DoeGuardJson,'$.rows') g WHERE JSON_VALUE(g.value,'$.roleType')=i.RoleType AND JSON_VALUE(g.value,'$.scope')=i.Scope AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(g.value,'$.facultyId'))=i.FacultyId
    AND ((i.RoleId IS NULL AND JSON_VALUE(g.value,'$.isNew')='true') OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(g.value,'$.roleId'))=i.RoleId)
    AND (i.RoleId IS NOT NULL OR(JSON_VALUE(g.value,'$.aggregateStatus')=N'safe' AND paws_api.MasterDoeAggregateSafe(@DoeGuardJson,i.FacultyId,@AcademicYear)=1))
    AND JSON_VALUE(g.value,'$.status')='matched' AND ABS(TRY_CONVERT(decimal(12,6),JSON_VALUE(g.value,'$.sourceDoe'))-i.SourceDoe)<0.000001
    AND ABS(TRY_CONVERT(decimal(12,6),JSON_VALUE(g.value,'$.activeDoe'))-i.SourceDoe)<0.000001 AND ABS(TRY_CONVERT(decimal(12,6),JSON_VALUE(g.value,'$.candidateDoe'))-i.SourceDoe)<0.000001);

  UPDATE i SET Issue=N'SOURCE_ROW_REVIEW' FROM @Items i WHERE i.Issue IS NULL AND EXISTS(SELECT 1 FROM OPENJSON(@SourceJson,'$.issues') j WHERE JSON_VALUE(j.value,'$.sourceRef.sheet')=JSON_VALUE(i.SourceJson,'$.sourceRef.sheet') AND JSON_VALUE(j.value,'$.sourceRef.row')=JSON_VALUE(i.SourceJson,'$.sourceRef.row'));
  UPDATE @Items SET IsNew=1,RoleId=NEWID() WHERE Issue IS NULL AND RoleId IS NULL;
  UPDATE @Items SET Status=IIF(SourceDoe IS NULL,N'source_missing',N'matched') WHERE Issue IS NULL;
  DECLARE @Operations nvarchar(max)=(SELECT n,RoleId roleId,FacultyId facultyId,RoleType roleType,Scope scope,IsNew isNew,Status allocationStatus,JSON_QUERY(SourceJson) source FROM @Items WHERE Issue IS NULL ORDER BY n FOR JSON PATH,INCLUDE_NULL_VALUES);
  DECLARE @Held nvarchar(max)=(SELECT RoleId roleId,RoleType roleType,Scope scope,Issue code FROM(
   SELECT RoleId,RoleType,Scope,Issue FROM @Items WHERE Issue IS NOT NULL
   UNION ALL SELECT r.RoleAssignmentId,r.RoleType,r.CourseOrSubjectOrRotation,N'HELD_REMOVAL'
   FROM paws.RoleAssignment r WHERE r.AcademicYear=@AcademicYear AND r.RoleType IN(N'HICC',N'VISC',N'CCC',N'Rotation Participant',N'Designated Rotation Coordinator')
   AND NOT EXISTS(SELECT 1 FROM @Items i WHERE i.FacultyId=r.FacultyId AND i.RoleType=r.RoleType AND i.Scope=LTRIM(RTRIM(r.CourseOrSubjectOrRotation)))
   ) held ORDER BY RoleType,Scope,RoleId FOR JSON PATH,INCLUDE_NULL_VALUES);
  DECLARE @Snapshot nvarchar(max)=paws_api.MasterRefreshSnapshot(@AcademicYear),@BeforeHash char(64);
  SET @BeforeHash=CONVERT(varchar(64),HASHBYTES('SHA2_256',@Snapshot),2);
  INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Batch,SYSUTCDATETIME(),N'master_staged',UPPER(@Source),N'master-refresh-v1',N'{}');
  INSERT staging.MasterRefresh(BatchId,Domain,AcademicYear,SourceSha256,ManifestSha256,SourceJson,OperationsJson,HeldIssuesJson,BeforeHash,DoeGuardJson,ActorUid,ExpiresAtUtc)
   VALUES(@Batch,@Domain,@AcademicYear,UPPER(@Source),UPPER(@Manifest),@SourceJson,@Operations,@Held,@BeforeHash,@DoeGuardJson,@ActorFirebaseUid,DATEADD(minute,15,SYSUTCDATETIME()));
  SELECT(SELECT BatchId batchId,Domain domain,AcademicYear academicYear,SourceSha256 sourceSha256,ManifestSha256 manifestSha256,CONVERT(varchar(16),CONVERT(binary(8),PreviewVersion),2) expectedVersion,ExpiresAtUtc expiresAtUtc,BeforeHash beforeHash,JSON_VALUE(DoeGuardJson,'$.doeGuardHash') doeGuardHash,JSON_QUERY(OperationsJson) operations,JSON_QUERY(HeldIssuesJson) heldIssues FROM staging.MasterRefresh WHERE BatchId=@Batch FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
  COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.CommitMasterAppointments @Domain nvarchar(32),@BatchId uniqueidentifier,@ExpectedVersion varchar(16),@ManifestSha256 varchar(64),@SourceSha256 varchar(64),@IdempotencyKey uniqueidentifier,@ActorFirebaseUid nvarchar(128),@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC paws_api.AssertMasterRefreshOperator @ActorFirebaseUid;
  IF @Domain IS NULL OR @Domain<>N'appointments' OR @BatchId IS NULL OR @IdempotencyKey IS NULL OR ISNULL(@Confirm,0)<>1 OR LEN(ISNULL(@ExpectedVersion,''))<>16 OR TRY_CONVERT(binary(8),@ExpectedVersion,2) IS NULL OR LEN(ISNULL(@ManifestSha256,''))<>64 OR LEN(ISNULL(@SourceSha256,''))<>64 THROW 55202,'Explicit MASTER preview confirmation required.',1;
  DECLARE @Receipt uniqueidentifier,@Year varchar(7),@Operations nvarchar(max),@Source nvarchar(max),@Held nvarchar(max),@BeforeHash char(64),@DoeGuard nvarchar(max),@Version binary(8),@Status nvarchar(16),@Expires datetime2(7),@Lock int;
  SELECT @Receipt=ReceiptId FROM paws.MasterRefreshReceipt WITH(UPDLOCK,HOLDLOCK) WHERE IdempotencyKey=@IdempotencyKey;
  IF @Receipt IS NOT NULL
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM paws.MasterRefreshReceipt WHERE ReceiptId=@Receipt AND BatchId=@BatchId AND Domain=@Domain AND SourceSha256=UPPER(@SourceSha256) AND ManifestSha256=UPPER(@ManifestSha256) AND ExpectedVersion=CONVERT(binary(8),@ExpectedVersion,2) AND ActorUid=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Status=N'committed') THROW 55207,'MASTER replay key conflict.',1;
   SELECT(SELECT ReceiptId receiptId,AppliedCount appliedCount,HeldCount heldCount,CAST(1 AS bit) idempotentReplay FROM paws.MasterRefreshReceipt WHERE ReceiptId=@Receipt FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
   COMMIT;RETURN;
  END;
  SELECT @Year=AcademicYear,@Operations=OperationsJson,@Source=SourceJson,@Held=HeldIssuesJson,@BeforeHash=BeforeHash,@DoeGuard=DoeGuardJson,@Version=PreviewVersion,@Status=Status,@Expires=ExpiresAtUtc FROM staging.MasterRefresh WITH(UPDLOCK,HOLDLOCK) WHERE BatchId=@BatchId AND Domain=@Domain AND ActorUid=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND SourceSha256=UPPER(@SourceSha256) AND ManifestSha256=UPPER(@ManifestSha256);
  IF @Version IS NULL OR @Version<>CONVERT(binary(8),@ExpectedVersion,2) OR @Status<>N'staged' THROW 55204,'MASTER preview changed.',1;
  IF @Expires<SYSUTCDATETIME() THROW 55205,'MASTER preview expired.',1;
  DECLARE @Resource nvarchar(255)=N'paws:master-refresh:appointments:'+@Year;
  EXEC @Lock=sys.sp_getapplock @Resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
  IF @Lock<0 THROW 55209,'MASTER scope busy.',1;
  DECLARE @Count bigint;
  SELECT @Count=COUNT_BIG(*) FROM paws.RoleAssignment WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.RoleAppointmentSchedule WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.MasterRoleSourceEvidence WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.MasterRoleDefinition WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.Faculty WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeAssignmentFact WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyRule WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleSelector WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleParameter WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleTier WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleInput WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeReferenceSource WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyException WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeCourseMapping WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeSubjectMapping WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeSupervisionSourceSnapshot WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeWorkloadSource WITH(UPDLOCK,HOLDLOCK);
  DECLARE @Before nvarchar(max)=paws_api.MasterRefreshSnapshot(@Year);
  IF CONVERT(varchar(64),HASHBYTES('SHA2_256',@Before),2)<>@BeforeHash THROW 55204,'MASTER before-state changed.',1;
  DECLARE @Op TABLE(n int PRIMARY KEY,RoleId uniqueidentifier,FacultyId uniqueidentifier,RoleType nvarchar(256),Scope nvarchar(1000),IsNew bit,AllocationStatus nvarchar(32),SourceJson nvarchar(max));
  INSERT @Op SELECT n,RoleId,FacultyId,RoleType,Scope,IsNew,AllocationStatus,SourceJson FROM OPENJSON(@Operations) WITH(n int '$.n',RoleId uniqueidentifier '$.roleId',FacultyId uniqueidentifier '$.facultyId',RoleType nvarchar(256) '$.roleType',Scope nvarchar(1000) '$.scope',IsNew bit '$.isNew',AllocationStatus nvarchar(32) '$.allocationStatus',SourceJson nvarchar(max) '$.source' AS JSON);
  IF EXISTS(SELECT 1 FROM @Op o WHERE NOT EXISTS(SELECT 1 FROM paws.Faculty f WHERE f.FacultyId=o.FacultyId AND f.Active=1) OR (o.IsNew=1 AND JSON_VALUE(o.SourceJson,'$.sourceDoe') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM OPENJSON(@DoeGuard,'$.rows') g WHERE JSON_VALUE(g.value,'$.roleType')=o.RoleType AND JSON_VALUE(g.value,'$.scope')=o.Scope AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(g.value,'$.facultyId'))=o.FacultyId AND JSON_VALUE(g.value,'$.status')='matched' AND JSON_VALUE(g.value,'$.aggregateStatus')=N'safe' AND paws_api.MasterDoeAggregateSafe(@DoeGuard,o.FacultyId,@Year)=1))) THROW 55206,'MASTER identity or allocation changed.',1;
  DECLARE @Role uniqueidentifier,@Faculty uniqueidentifier,@Type nvarchar(256),@Scope nvarchar(1000),@New bit,@Allocation nvarchar(32),@Row nvarchar(max),@n int=0,@next int,@Periods nvarchar(max),@OldPeriods nvarchar(max);
  DECLARE @PeriodRows TABLE(n int,StartDate date,EndDate date,RawStart varchar(40),RawEnd varchar(40),Kind int);
  WHILE 1=1
  BEGIN
   SELECT @next=MIN(n) FROM @Op WHERE n>@n;IF @next IS NULL BREAK;SET @n=@next;
   SELECT @Role=RoleId,@Faculty=FacultyId,@Type=RoleType,@Scope=Scope,@New=IsNew,@Allocation=AllocationStatus,@Row=SourceJson FROM @Op WHERE n=@n;
   IF @New=1 INSERT paws.RoleAssignment(RoleAssignmentId,FacultyId,SourceFacultyName,FacultyResolutionStatus,AcademicYear,RoleCategory,RoleType,CourseOrSubjectOrRotation,DoeMappedValue,SourceImportBatchId,SourceRow)
    VALUES(@Role,@Faculty,JSON_VALUE(@Row,'$.sourceName'),N'resolved',@Year,N'MASTER appointment',@Type,@Scope,TRY_CONVERT(decimal(12,6),JSON_VALUE(@Row,'$.sourceDoe')),@BatchId,TRY_CONVERT(int,JSON_VALUE(@Row,'$.sourceRef.row')));
   ELSE UPDATE paws.RoleAssignment SET CourseOrSubjectOrRotation=@Scope WHERE RoleAssignmentId=@Role AND FacultyId=@Faculty AND RoleType=@Type AND AcademicYear=@Year;
   IF @@ROWCOUNT<>1 THROW 55204,'MASTER appointment changed.',1;
   SET @Periods=JSON_QUERY(@Row,'$.periods');SET @OldPeriods=NULL;DELETE @PeriodRows;
   INSERT @PeriodRows SELECT TRY_CONVERT(int,j.[key]),TRY_CONVERT(date,JSON_VALUE(j.value,'$.startDate'),23),TRY_CONVERT(date,JSON_VALUE(j.value,'$.endDate'),23),JSON_VALUE(j.value,'$.startDate'),JSON_VALUE(j.value,'$.endDate'),j.type FROM OPENJSON(@Periods) j;
   IF (SELECT COUNT(*) FROM @PeriodRows) NOT BETWEEN 1 AND 12 OR EXISTS(SELECT 1 FROM @PeriodRows WHERE Kind<>5 OR StartDate IS NULL OR EndDate IS NULL OR LEN(RawStart)<>10 OR LEN(RawEnd)<>10 OR CONVERT(varchar(10),StartDate,23)<>RawStart OR CONVERT(varchar(10),EndDate,23)<>RawEnd OR EndDate<StartDate) OR EXISTS(SELECT 1 FROM @PeriodRows a JOIN @PeriodRows b ON a.n<b.n AND a.StartDate<=b.EndDate AND b.StartDate<=a.EndDate) THROW 55202,'Invalid effective periods.',1;
   SELECT @OldPeriods=PeriodsJson FROM paws.RoleAppointmentSchedule WHERE RoleAssignmentId=@Role;
   IF @OldPeriods IS NULL INSERT paws.RoleAppointmentSchedule(RoleAssignmentId,PeriodsJson,UpdatedAtUtc,UpdatedByFirebaseUid) VALUES(@Role,@Periods,SYSUTCDATETIME(),@ActorFirebaseUid);
   ELSE UPDATE paws.RoleAppointmentSchedule SET PeriodsJson=@Periods,UpdatedAtUtc=SYSUTCDATETIME(),UpdatedByFirebaseUid=@ActorFirebaseUid WHERE RoleAssignmentId=@Role;
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson) VALUES(NEWID(),N'role_periods_updated',N'role_assignment',@Role,@ActorFirebaseUid,SYSUTCDATETIME(),(SELECT JSON_QUERY(@OldPeriods) beforePeriods,JSON_QUERY(@Periods) afterPeriods FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES));
   UPDATE paws.MasterRoleSourceEvidence SET SourceSha256=UPPER(@SourceSha256),SourceJson=@Row,AllocationStatus=@Allocation,UpdatedAtUtc=SYSUTCDATETIME(),UpdatedBy=@ActorFirebaseUid WHERE RoleAssignmentId=@Role;
   IF @@ROWCOUNT=0 INSERT paws.MasterRoleSourceEvidence(RoleAssignmentId,AcademicYear,SourceSha256,SourceJson,AllocationStatus,UpdatedAtUtc,UpdatedBy) VALUES(@Role,@Year,UPPER(@SourceSha256),@Row,@Allocation,SYSUTCDATETIME(),@ActorFirebaseUid);
  END;
  DECLARE @Definitions TABLE(n int IDENTITY PRIMARY KEY,RoleType nvarchar(256),ScopeHash char(64),SourceJson nvarchar(max));
  INSERT @Definitions(RoleType,ScopeHash,SourceJson) SELECT JSON_VALUE(value,'$.roleType'),CONVERT(varchar(64),HASHBYTES('SHA2_256',LOWER(LTRIM(RTRIM(JSON_VALUE(value,'$.scope'))))),2),value FROM OPENJSON(@Source,'$.roleDefinitions');
  IF EXISTS(SELECT 1 FROM @Definitions WHERE RoleType IS NULL OR RoleType NOT IN(N'HICC',N'VISC',N'Rotation Participant',N'Designated Rotation Coordinator') OR ScopeHash IS NULL) THROW 55202,'Invalid MASTER role definition.',1;
  UPDATE d SET SourceJson=s.SourceJson,SourceSha256=UPPER(@SourceSha256),UpdatedAtUtc=SYSUTCDATETIME(),UpdatedBy=@ActorFirebaseUid FROM paws.MasterRoleDefinition d JOIN @Definitions s ON d.AcademicYear=@Year AND d.RoleType=s.RoleType AND d.ScopeHash=s.ScopeHash;
  INSERT paws.MasterRoleDefinition(DefinitionId,AcademicYear,RoleType,ScopeHash,SourceJson,SourceSha256,UpdatedAtUtc,UpdatedBy) SELECT NEWID(),@Year,s.RoleType,s.ScopeHash,s.SourceJson,UPPER(@SourceSha256),SYSUTCDATETIME(),@ActorFirebaseUid FROM @Definitions s WHERE NOT EXISTS(SELECT 1 FROM paws.MasterRoleDefinition d WHERE d.AcademicYear=@Year AND d.RoleType=s.RoleType AND d.ScopeHash=s.ScopeHash);
  SET @Receipt=NEWID();DECLARE @Applied int=(SELECT COUNT(*) FROM @Op),@HeldCount int=(SELECT COUNT(*) FROM OPENJSON(@Held)),@AfterHash char(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot(@Year)),2);
  INSERT paws.MasterRefreshReceipt(ReceiptId,BatchId,Domain,AcademicYear,SourceSha256,ManifestSha256,ExpectedVersion,IdempotencyKey,ActorUid,BeforeJson,AfterHash,AppliedCount,HeldCount) VALUES(@Receipt,@BatchId,@Domain,@Year,UPPER(@SourceSha256),UPPER(@ManifestSha256),@Version,@IdempotencyKey,@ActorFirebaseUid,@Before,@AfterHash,@Applied,@HeldCount);
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson) VALUES(NEWID(),N'master_source_refreshed',N'master_refresh',@Receipt,@ActorFirebaseUid,SYSUTCDATETIME(),(SELECT @Year academicYear,@Domain domain,@Applied appliedCount,@HeldCount heldCount,ORIGINAL_LOGIN() operatorLogin FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  UPDATE staging.MasterRefresh SET Status=N'committed' WHERE BatchId=@BatchId;
  UPDATE staging.ImportBatch SET Status=N'master_committed',CompletedAtUtc=SYSUTCDATETIME() WHERE ImportBatchId=@BatchId;
  SELECT(SELECT @Receipt receiptId,@Applied appliedCount,@HeldCount heldCount,CAST(0 AS bit) idempotentReplay FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
  COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.RecoverMasterAppointments @ReceiptId uniqueidentifier,@ActorFirebaseUid nvarchar(128),@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC paws_api.AssertMasterRefreshOperator @ActorFirebaseUid;
  IF @ReceiptId IS NULL OR ISNULL(@Confirm,0)<>1 THROW 55202,'Explicit MASTER recovery confirmation required.',1;
  DECLARE @Year varchar(7),@Before nvarchar(max),@Expected char(64),@Batch uniqueidentifier,@Status nvarchar(16),@Operations nvarchar(max),@Lock int;
  SELECT @Year=AcademicYear,@Before=BeforeJson,@Expected=AfterHash,@Batch=BatchId,@Status=Status FROM paws.MasterRefreshReceipt WITH(UPDLOCK,HOLDLOCK) WHERE ReceiptId=@ReceiptId AND Domain=N'appointments';
  IF @Year IS NULL THROW 55203,'MASTER receipt not found.',1;
  IF @Status<>N'committed' THROW 55208,'MASTER recovery already used.',1;
  DECLARE @Resource nvarchar(255)=N'paws:master-refresh:appointments:'+@Year;
  EXEC @Lock=sys.sp_getapplock @Resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
  IF @Lock<0 THROW 55209,'MASTER scope busy.',1;
  DECLARE @Count bigint;
  SELECT @Count=COUNT_BIG(*) FROM paws.RoleAssignment WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.RoleAppointmentSchedule WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.MasterRoleSourceEvidence WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.MasterRoleDefinition WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.Faculty WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeAssignmentFact WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@Year;
  SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyRule WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleSelector WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleParameter WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleTier WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleInput WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeReferenceSource WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyException WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeCourseMapping WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeSubjectMapping WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeSupervisionSourceSnapshot WITH(UPDLOCK,HOLDLOCK);
  SELECT @Count=COUNT_BIG(*) FROM paws.DoeWorkloadSource WITH(UPDLOCK,HOLDLOCK);
  IF CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot(@Year)),2)<>@Expected THROW 55208,'MASTER recovery after-state changed.',1;
  SELECT @Operations=OperationsJson FROM staging.MasterRefresh WHERE BatchId=@Batch;
  DECLARE @Affected TABLE(RoleId uniqueidentifier PRIMARY KEY,IsNew bit);
  INSERT @Affected SELECT RoleId,IsNew FROM OPENJSON(@Operations) WITH(RoleId uniqueidentifier '$.roleId',IsNew bit '$.isNew');
  -- Capture faculty context while newly created roles still exist.
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson)
   SELECT NEWID(),N'role_periods_updated',N'role_assignment',a.RoleId,@ActorFirebaseUid,SYSUTCDATETIME(),(SELECT JSON_QUERY(s.PeriodsJson) beforePeriods,JSON_QUERY(COALESCE(old.PeriodsJson,N'[]')) afterPeriods FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)
   FROM @Affected a LEFT JOIN paws.RoleAppointmentSchedule s ON s.RoleAssignmentId=a.RoleId LEFT JOIN OPENJSON(@Before,'$.periods') WITH(RoleAssignmentId uniqueidentifier,PeriodsJson nvarchar(max)) old ON old.RoleAssignmentId=a.RoleId;
  DELETE e FROM paws.MasterRoleSourceEvidence e JOIN @Affected a ON a.RoleId=e.RoleAssignmentId WHERE NOT EXISTS(SELECT 1 FROM OPENJSON(@Before,'$.evidence') WITH(RoleAssignmentId uniqueidentifier) b WHERE b.RoleAssignmentId=e.RoleAssignmentId);
  UPDATE e SET SourceSha256=b.SourceSha256,SourceJson=b.SourceJson,AllocationStatus=b.AllocationStatus,UpdatedAtUtc=b.UpdatedAtUtc,UpdatedBy=b.UpdatedBy FROM paws.MasterRoleSourceEvidence e JOIN @Affected a ON a.RoleId=e.RoleAssignmentId JOIN OPENJSON(@Before,'$.evidence') WITH(RoleAssignmentId uniqueidentifier,SourceSha256 char(64),SourceJson nvarchar(max),AllocationStatus nvarchar(32),UpdatedAtUtc datetime2(7),UpdatedBy nvarchar(128)) b ON b.RoleAssignmentId=e.RoleAssignmentId;
  DELETE s FROM paws.RoleAppointmentSchedule s JOIN @Affected a ON a.RoleId=s.RoleAssignmentId WHERE NOT EXISTS(SELECT 1 FROM OPENJSON(@Before,'$.periods') WITH(RoleAssignmentId uniqueidentifier) b WHERE b.RoleAssignmentId=s.RoleAssignmentId);
  UPDATE s SET PeriodsJson=b.PeriodsJson,UpdatedAtUtc=b.UpdatedAtUtc,UpdatedByFirebaseUid=b.UpdatedByFirebaseUid FROM paws.RoleAppointmentSchedule s JOIN @Affected a ON a.RoleId=s.RoleAssignmentId JOIN OPENJSON(@Before,'$.periods') WITH(RoleAssignmentId uniqueidentifier,PeriodsJson nvarchar(max),UpdatedAtUtc datetime2(7),UpdatedByFirebaseUid nvarchar(128)) b ON b.RoleAssignmentId=s.RoleAssignmentId;
  UPDATE r SET CourseOrSubjectOrRotation=b.CourseOrSubjectOrRotation FROM paws.RoleAssignment r JOIN @Affected a ON a.RoleId=r.RoleAssignmentId AND a.IsNew=0 JOIN OPENJSON(@Before,'$.roles') WITH(RoleAssignmentId uniqueidentifier,CourseOrSubjectOrRotation nvarchar(1000)) b ON b.RoleAssignmentId=r.RoleAssignmentId;
  DELETE r FROM paws.RoleAssignment r JOIN @Affected a ON a.RoleId=r.RoleAssignmentId WHERE a.IsNew=1;
  IF @@ROWCOUNT<>(SELECT COUNT(*) FROM @Affected WHERE IsNew=1) THROW 55208,'MASTER new-role recovery incomplete.',1;
  DELETE FROM paws.MasterRoleDefinition WHERE AcademicYear=@Year;
  INSERT paws.MasterRoleDefinition(DefinitionId,AcademicYear,RoleType,ScopeHash,SourceJson,SourceSha256,UpdatedAtUtc,UpdatedBy)
   SELECT DefinitionId,AcademicYear,RoleType,ScopeHash,SourceJson,SourceSha256,UpdatedAtUtc,UpdatedBy FROM OPENJSON(@Before,'$.definitions') WITH(DefinitionId uniqueidentifier,AcademicYear varchar(7),RoleType nvarchar(256),ScopeHash char(64),SourceJson nvarchar(max),SourceSha256 char(64),UpdatedAtUtc datetime2(7),UpdatedBy nvarchar(128));
  UPDATE paws.MasterRefreshReceipt SET Status=N'recovered' WHERE ReceiptId=@ReceiptId;
  UPDATE staging.MasterRefresh SET Status=N'recovered' WHERE BatchId=@Batch;
  UPDATE staging.ImportBatch SET Status=N'master_recovered' WHERE ImportBatchId=@Batch;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson) VALUES(NEWID(),N'master_source_recovered',N'master_refresh',@ReceiptId,@ActorFirebaseUid,SYSUTCDATETIME(),(SELECT @Year academicYear,ORIGINAL_LOGIN() operatorLogin FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  SELECT(SELECT @ReceiptId receiptId,CAST(1 AS bit) recovered FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
  COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.LockMasterTraineeScope @AcademicYear varchar(7)
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 55409,'Trainee transaction required.',1;
 DECLARE @Lock int,@Resource nvarchar(255)=N'paws:master-refresh:trainees:'+@AcademicYear,@Count bigint;
 EXEC @Lock=sys.sp_getapplock @Resource=@Resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
 IF @Lock<0 THROW 55409,'Trainee scope busy.',1;
 SELECT @Count=COUNT_BIG(*) FROM paws.RoleAssignment WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
 SELECT @Count=COUNT_BIG(*) FROM paws.RoleAppointmentSchedule WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.MasterRoleSourceEvidence WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
 SELECT @Count=COUNT_BIG(*) FROM paws.MasterRoleDefinition WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
 SELECT @Count=COUNT_BIG(*) FROM paws.Faculty WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyVersion WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeAssignmentFact WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
 SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyRule WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleSelector WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleParameter WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleTier WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeRuleInput WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeReferenceSource WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoePolicyException WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeCourseMapping WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeSubjectMapping WITH(UPDLOCK,HOLDLOCK);
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeSupervisionSourceSnapshot WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
 SELECT @Count=COUNT_BIG(*) FROM paws.DoeWorkloadSource WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
 SELECT @Count=COUNT_BIG(*) FROM paws.TraineeSourceEvidence WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
END;
GO
CREATE PROCEDURE paws_api.PreviewMasterTrainees @Domain nvarchar(32),@AcademicYear varchar(7),@SourceJson nvarchar(max),@ActorFirebaseUid nvarchar(128),@DoeGuardJson nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC paws_api.AssertMasterRefreshOperator @ActorFirebaseUid;
  IF ISNULL(@Domain,N'')<>N'trainees' OR LEN(ISNULL(@AcademicYear,''))<>7 OR TRY_CONVERT(int,LEFT(@AcademicYear,4)) NOT BETWEEN 1900 AND 9998 OR @AcademicYear<>CONCAT(LEFT(@AcademicYear,4),'-',RIGHT(CONVERT(varchar(4),TRY_CONVERT(int,LEFT(@AcademicYear,4))+1),2))
   OR ISNULL(ISJSON(@SourceJson),0)<>1 OR DATALENGTH(@SourceJson)>16777216 OR ISNULL(JSON_VALUE(@SourceJson,'$.academicYear'),'')<>@AcademicYear OR ISNULL(JSON_VALUE(@SourceJson,'$.schemaVersion'),'')<>'1' THROW 55202,'Invalid trainee MASTER source.',1;
  DECLARE @Source varchar(64)=JSON_VALUE(@SourceJson,'$.sourceSha256'),@Manifest varchar(64)=JSON_VALUE(@SourceJson,'$.manifestSha256'),@Batch uniqueidentifier=NEWID();
  IF LEN(ISNULL(JSON_VALUE(@SourceJson,'$.sourceSha256'),''))<>64 OR TRY_CONVERT(binary(32),@Source,2) IS NULL OR LEN(ISNULL(JSON_VALUE(@SourceJson,'$.manifestSha256'),''))<>64 OR TRY_CONVERT(binary(32),@Manifest,2) IS NULL
   OR NOT EXISTS(SELECT 1 FROM OPENJSON(@SourceJson) WHERE [key]='trainees' AND type=4) THROW 55202,'Invalid trainee source provenance.',1;
  EXEC paws_api.LockMasterTraineeScope @AcademicYear;
  IF ISNULL(ISJSON(@DoeGuardJson),0)<>1 OR ISNULL(JSON_VALUE(@DoeGuardJson,'$.schemaVersion'),'')<>'1' OR ISNULL(UPPER(JSON_VALUE(@DoeGuardJson,'$.sourceManifestSha256')),'')<>UPPER(@Manifest)
   OR LEN(ISNULL(JSON_VALUE(@DoeGuardJson,'$.doeGuardHash'),''))<>64 OR TRY_CONVERT(binary(32),JSON_VALUE(@DoeGuardJson,'$.doeGuardHash'),2) IS NULL OR NOT EXISTS(SELECT 1 FROM OPENJSON(@DoeGuardJson) WHERE [key]='rows' AND type=4) THROW 55206,'Trusted trainee DOE guard required.',1;
  DECLARE @BeforeHash char(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot(@AcademicYear)),2);
  IF ISNULL(JSON_VALUE(@DoeGuardJson,'$.contextHash'),'')<>@BeforeHash THROW 55204,'Trainee context changed before staging.',1;
  DECLARE @Items TABLE(n int PRIMARY KEY,FacultyId uniqueidentifier,SourceJson nvarchar(max),SourceDoe decimal(12,6),SnapshotId uniqueidentifier,CreateSnapshot bit NOT NULL DEFAULT 0,Status nvarchar(32),Issue nvarchar(64));
  INSERT @Items(n,FacultyId,SourceJson,SourceDoe) SELECT TRY_CONVERT(int,j.[key])+1,TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.facultyId')),j.value,TRY_CONVERT(decimal(12,6),JSON_VALUE(j.value,'$.sourceDoe')) FROM OPENJSON(@SourceJson,'$.trainees') j;
  IF (SELECT COUNT(*) FROM @Items) NOT BETWEEN 1 AND 5000 OR EXISTS(SELECT 1 FROM @Items i WHERE ISNULL(UPPER(JSON_VALUE(i.SourceJson,'$.sourceRef.sha256')),'')<>UPPER(@Source) OR ISNULL(JSON_VALUE(i.SourceJson,'$.sourceRef.sheet'),'')<>N'# Trainees' OR TRY_CONVERT(int,JSON_VALUE(i.SourceJson,'$.sourceRef.row')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(i.SourceJson,'$.sourceRef.row'))<2
   OR NULLIF(JSON_VALUE(i.SourceJson,'$.sourceName'),'') IS NULL OR TRY_CONVERT(decimal(18,6),JSON_VALUE(i.SourceJson,'$.sourceName')) IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM OPENJSON(i.SourceJson) WHERE [key]='rawCounts' AND type=4) OR (SELECT COUNT(*) FROM OPENJSON(i.SourceJson,'$.rawCounts'))<>7
   OR NOT EXISTS(SELECT 1 FROM OPENJSON(i.SourceJson) WHERE [key]='categoryDoe' AND type=4) OR (SELECT COUNT(*) FROM OPENJSON(i.SourceJson,'$.categoryDoe'))<>7
   OR EXISTS(SELECT 1 FROM OPENJSON(i.SourceJson,'$.rawCounts') v WHERE v.type NOT IN(0,2) OR v.type=2 AND(TRY_CONVERT(decimal(12,6),v.value) IS NULL OR TRY_CONVERT(decimal(12,6),v.value)<0))
   OR EXISTS(SELECT 1 FROM OPENJSON(i.SourceJson,'$.categoryDoe') v WHERE v.type NOT IN(0,2) OR v.type=2 AND(TRY_CONVERT(decimal(12,6),v.value) IS NULL OR TRY_CONVERT(decimal(12,6),v.value)<0))
   OR EXISTS(SELECT 1 FROM OPENJSON(i.SourceJson) v WHERE v.[key] IN(N'sourceDoe',N'sourceTotal') AND(v.type NOT IN(0,2) OR v.type=2 AND(TRY_CONVERT(decimal(12,6),v.value) IS NULL OR TRY_CONVERT(decimal(12,6),v.value)<0)))) THROW 55202,'Invalid nullable trainee quantities.',1;
  UPDATE i SET Issue=N'IDENTITY_REVIEW' FROM @Items i WHERE i.FacultyId IS NULL OR NOT EXISTS(SELECT 1 FROM paws.Faculty f WHERE f.FacultyId=i.FacultyId AND f.Active=1);
  UPDATE i SET Issue=N'DUPLICATE_SOURCE_FACULTY' FROM @Items i WHERE EXISTS(SELECT 1 FROM @Items d WHERE d.FacultyId=i.FacultyId AND d.n<>i.n);
  UPDATE i SET SnapshotId=s.SnapshotId FROM @Items i JOIN paws.DoeSupervisionSourceSnapshot s ON s.FacultyId=i.FacultyId AND s.AcademicYear=@AcademicYear;
  UPDATE @Items SET Status=CASE WHEN SourceDoe IS NULL THEN N'source_missing' ELSE N'held_mismatch' END WHERE Issue IS NULL;
  UPDATE i SET Status=N'matched' FROM @Items i WHERE i.Issue IS NULL AND i.SourceDoe IS NOT NULL AND EXISTS(
   SELECT 1 FROM OPENJSON(@DoeGuardJson,'$.rows') g WHERE JSON_VALUE(g.value,'$.roleType')=N'Trainee Supervision' AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(g.value,'$.facultyId'))=i.FacultyId AND JSON_VALUE(g.value,'$.status')=N'matched' AND(i.SnapshotId IS NOT NULL OR(JSON_VALUE(g.value,'$.aggregateStatus')=N'safe' AND paws_api.MasterDoeAggregateSafe(@DoeGuardJson,i.FacultyId,@AcademicYear)=1))
    AND ABS(TRY_CONVERT(decimal(12,6),JSON_VALUE(g.value,'$.sourceDoe'))-i.SourceDoe)<0.000001 AND ABS(TRY_CONVERT(decimal(12,6),JSON_VALUE(g.value,'$.activeDoe'))-i.SourceDoe)<0.000001 AND ABS(TRY_CONVERT(decimal(12,6),JSON_VALUE(g.value,'$.candidateDoe'))-i.SourceDoe)<0.000001)
   AND(i.SnapshotId IS NULL OR EXISTS(SELECT 1 FROM paws.DoeSupervisionSourceSnapshot s WHERE s.SnapshotId=i.SnapshotId AND ABS(s.RawDoe-i.SourceDoe)<0.000001));
  UPDATE @Items SET Status=N'needs_review' WHERE Issue IS NULL AND Status=N'matched' AND SnapshotId IS NULL AND NOT EXISTS(SELECT 1 FROM paws.DoeWorkloadSource WHERE AcademicYear=@AcademicYear);
  UPDATE @Items SET CreateSnapshot=1,SnapshotId=NEWID() WHERE Issue IS NULL AND Status=N'matched' AND SnapshotId IS NULL;
  DECLARE @Operations nvarchar(max)=(SELECT n,FacultyId facultyId,SnapshotId snapshotId,CreateSnapshot createSnapshot,Status allocationStatus,JSON_QUERY(SourceJson) source FROM @Items WHERE Issue IS NULL ORDER BY n FOR JSON PATH,INCLUDE_NULL_VALUES),
   @Held nvarchar(max)=(SELECT n,FacultyId facultyId,COALESCE(Issue,CASE WHEN Status=N'source_missing' THEN N'SOURCE_DOE_MISSING' ELSE N'DOE_REVIEW' END) code FROM @Items WHERE Issue IS NOT NULL OR Status<>N'matched' ORDER BY n FOR JSON PATH,INCLUDE_NULL_VALUES);
  INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Batch,SYSUTCDATETIME(),N'master_staged',UPPER(@Source),N'master-trainees-v1',N'{}');
  INSERT staging.MasterRefresh(BatchId,Domain,AcademicYear,SourceSha256,ManifestSha256,SourceJson,OperationsJson,HeldIssuesJson,BeforeHash,DoeGuardJson,ActorUid,ExpiresAtUtc) VALUES(@Batch,N'trainees',@AcademicYear,UPPER(@Source),UPPER(@Manifest),@SourceJson,@Operations,@Held,@BeforeHash,@DoeGuardJson,@ActorFirebaseUid,DATEADD(minute,15,SYSUTCDATETIME()));
  SELECT(SELECT BatchId batchId,Domain domain,AcademicYear academicYear,SourceSha256 sourceSha256,ManifestSha256 manifestSha256,CONVERT(varchar(16),CONVERT(binary(8),PreviewVersion),2) expectedVersion,ExpiresAtUtc expiresAtUtc,BeforeHash beforeHash,JSON_VALUE(DoeGuardJson,'$.doeGuardHash') doeGuardHash,JSON_QUERY(OperationsJson) operations,JSON_QUERY(HeldIssuesJson) heldIssues FROM staging.MasterRefresh WHERE BatchId=@Batch FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
  COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.CommitMasterTrainees @Domain nvarchar(32),@BatchId uniqueidentifier,@ExpectedVersion varchar(16),@ManifestSha256 varchar(64),@SourceSha256 varchar(64),@IdempotencyKey uniqueidentifier,@ActorFirebaseUid nvarchar(128),@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC paws_api.AssertMasterRefreshOperator @ActorFirebaseUid;
  IF ISNULL(@Domain,N'')<>N'trainees' OR @BatchId IS NULL OR @IdempotencyKey IS NULL OR ISNULL(@Confirm,0)<>1 OR LEN(ISNULL(@ExpectedVersion,''))<>16 OR TRY_CONVERT(binary(8),@ExpectedVersion,2) IS NULL OR LEN(ISNULL(@ManifestSha256,''))<>64 OR LEN(ISNULL(@SourceSha256,''))<>64 THROW 55202,'Explicit trainee preview confirmation required.',1;
  DECLARE @Receipt uniqueidentifier,@Year varchar(7),@Operations nvarchar(max),@Held nvarchar(max),@BeforeHash char(64),@DoeGuard nvarchar(max),@Version binary(8),@Status nvarchar(16),@Expires datetime2(7);
  SELECT @Receipt=ReceiptId FROM paws.MasterRefreshReceipt WITH(UPDLOCK,HOLDLOCK) WHERE IdempotencyKey=@IdempotencyKey;
  IF @Receipt IS NOT NULL
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM paws.MasterRefreshReceipt WHERE ReceiptId=@Receipt AND BatchId=@BatchId AND Domain=@Domain AND SourceSha256=UPPER(@SourceSha256) AND ManifestSha256=UPPER(@ManifestSha256) AND ExpectedVersion=CONVERT(binary(8),@ExpectedVersion,2) AND ActorUid=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Status=N'committed') THROW 55207,'Trainee replay key conflict.',1;
   SELECT(SELECT ReceiptId receiptId,AppliedCount appliedCount,HeldCount heldCount,CAST(1 AS bit) idempotentReplay FROM paws.MasterRefreshReceipt WHERE ReceiptId=@Receipt FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;COMMIT;RETURN;
  END;
  SELECT @Year=AcademicYear,@Operations=OperationsJson,@Held=HeldIssuesJson,@BeforeHash=BeforeHash,@DoeGuard=DoeGuardJson,@Version=PreviewVersion,@Status=Status,@Expires=ExpiresAtUtc FROM staging.MasterRefresh WITH(UPDLOCK,HOLDLOCK) WHERE BatchId=@BatchId AND Domain=@Domain AND ActorUid=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND SourceSha256=UPPER(@SourceSha256) AND ManifestSha256=UPPER(@ManifestSha256);
  IF @Version IS NULL OR @Version<>CONVERT(binary(8),@ExpectedVersion,2) OR @Status<>N'staged' THROW 55204,'Trainee preview changed.',1;
  IF @Expires<SYSUTCDATETIME() THROW 55205,'Trainee preview expired.',1;
  EXEC paws_api.LockMasterTraineeScope @Year;
  DECLARE @Before nvarchar(max)=paws_api.MasterRefreshSnapshot(@Year);
  IF CONVERT(varchar(64),HASHBYTES('SHA2_256',@Before),2)<>@BeforeHash THROW 55204,'Trainee source, allocation or identity changed.',1;
  DECLARE @Op TABLE(n int PRIMARY KEY,FacultyId uniqueidentifier,SnapshotId uniqueidentifier,CreateSnapshot bit,Status nvarchar(32),SourceJson nvarchar(max));
  INSERT @Op SELECT n,FacultyId,SnapshotId,CreateSnapshot,Status,SourceJson FROM OPENJSON(@Operations) WITH(n int '$.n',FacultyId uniqueidentifier '$.facultyId',SnapshotId uniqueidentifier '$.snapshotId',CreateSnapshot bit '$.createSnapshot',Status nvarchar(32) '$.allocationStatus',SourceJson nvarchar(max) '$.source' AS JSON);
  IF EXISTS(SELECT 1 FROM @Op o WHERE NOT EXISTS(SELECT 1 FROM paws.Faculty f WHERE f.FacultyId=o.FacultyId AND f.Active=1)) THROW 55204,'Trainee identity changed.',1;
  DECLARE @n int=0,@Next int,@Faculty uniqueidentifier,@Snapshot uniqueidentifier,@Create bit,@Allocation nvarchar(32),@Row nvarchar(max),@Evidence nvarchar(max),@AuditBefore nvarchar(max),@SourceDoe decimal(12,6),@SourceRef nvarchar(1000)=CONCAT(N'MASTER SHA256 ',UPPER(@SourceSha256));
  WHILE 1=1
  BEGIN
   SELECT @Next=MIN(n) FROM @Op WHERE n>@n;IF @Next IS NULL BREAK;SET @n=@Next;
   SELECT @Faculty=FacultyId,@Snapshot=SnapshotId,@Create=CreateSnapshot,@Allocation=Status,@Row=SourceJson FROM @Op WHERE n=@n;
   SET @AuditBefore=(SELECT @Faculty facultyId,@Year academicYear,JSON_QUERY(COALESCE(e.RawCountsJson,JSON_QUERY(s.EvidenceJson,'$.counts'))) counts,e.SourceDoe sourceDoe,e.AllocationStatus allocationStatus FROM paws.Faculty f LEFT JOIN paws.TraineeSourceEvidence e ON e.FacultyId=f.FacultyId AND e.AcademicYear=@Year LEFT JOIN paws.DoeSupervisionSourceSnapshot s ON s.FacultyId=f.FacultyId AND s.AcademicYear=@Year WHERE f.FacultyId=@Faculty FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
   SET @SourceDoe=TRY_CONVERT(decimal(12,6),JSON_VALUE(@Row,'$.sourceDoe'));
   SET @Evidence=(SELECT JSON_VALUE(@Row,'$.sourceName') sourceName,JSON_QUERY(@Row,'$.sourceRef') sourceRef,JSON_QUERY(@Row,'$.rawCounts') counts,JSON_QUERY(@Row,'$.categoryDoe') categoryCredits,@SourceDoe cachedRawDoe,@SourceDoe rawDoe,JSON_QUERY(@Row,'$.privateNotes') notes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
   IF @Allocation=N'matched'
   BEGIN
    IF @Create=1 AND paws_api.MasterDoeAggregateSafe(@DoeGuard,@Faculty,@Year)<>1 THROW 55206,'Complete safe trainee worksheet projection required.',1;
    IF @Create=1 INSERT paws.DoeSupervisionSourceSnapshot(SnapshotId,FacultyId,AcademicYear,RawDoe,EvidenceJson,SourceReference,SourceSha256,CreatedBy) VALUES(@Snapshot,@Faculty,@Year,@SourceDoe,@Evidence,@SourceRef,UPPER(@SourceSha256),@ActorFirebaseUid);
    ELSE UPDATE paws.DoeSupervisionSourceSnapshot SET EvidenceJson=@Evidence,SourceReference=@SourceRef,SourceSha256=UPPER(@SourceSha256) WHERE SnapshotId=@Snapshot AND FacultyId=@Faculty AND AcademicYear=@Year AND ABS(RawDoe-@SourceDoe)<0.000001;
    IF @@ROWCOUNT<>1 THROW 55204,'Trainee allocation changed.',1;
   END;
   UPDATE paws.TraineeSourceEvidence SET SourceSha256=UPPER(@SourceSha256),SourceManifestSha256=UPPER(@ManifestSha256),SourceRefJson=JSON_QUERY(@Row,'$.sourceRef'),RawCountsJson=JSON_QUERY(@Row,'$.rawCounts'),CategoryDoeJson=JSON_QUERY(@Row,'$.categoryDoe'),SourceDoe=@SourceDoe,SourceTotal=TRY_CONVERT(decimal(12,6),JSON_VALUE(@Row,'$.sourceTotal')),PrivateNotesJson=JSON_QUERY(@Row,'$.privateNotes'),CellEvidenceJson=JSON_QUERY(@Row,'$.cellEvidence'),AllocationStatus=@Allocation,SourceImportBatchId=@BatchId,UpdatedAtUtc=SYSUTCDATETIME(),UpdatedBy=@ActorFirebaseUid WHERE FacultyId=@Faculty AND AcademicYear=@Year;
   IF @@ROWCOUNT=0 INSERT paws.TraineeSourceEvidence(FacultyId,AcademicYear,SourceSha256,SourceManifestSha256,SourceRefJson,RawCountsJson,CategoryDoeJson,SourceDoe,SourceTotal,PrivateNotesJson,CellEvidenceJson,AllocationStatus,SourceImportBatchId,UpdatedAtUtc,UpdatedBy) VALUES(@Faculty,@Year,UPPER(@SourceSha256),UPPER(@ManifestSha256),JSON_QUERY(@Row,'$.sourceRef'),JSON_QUERY(@Row,'$.rawCounts'),JSON_QUERY(@Row,'$.categoryDoe'),@SourceDoe,TRY_CONVERT(decimal(12,6),JSON_VALUE(@Row,'$.sourceTotal')),JSON_QUERY(@Row,'$.privateNotes'),JSON_QUERY(@Row,'$.cellEvidence'),@Allocation,@BatchId,SYSUTCDATETIME(),@ActorFirebaseUid);
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,ImportBatchId) VALUES(NEWID(),N'trainee_source_refreshed',N'faculty',CONVERT(nvarchar(36),@Faculty),@ActorFirebaseUid,SYSUTCDATETIME(),@AuditBefore,(SELECT @Faculty facultyId,(SELECT DisplayName FROM paws.Faculty WHERE FacultyId=@Faculty) displayName,@Year academicYear,JSON_QUERY(@Row,'$.rawCounts') counts,@SourceDoe sourceDoe,@Allocation allocationStatus FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),(SELECT ORIGINAL_LOGIN() operatorLogin FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@BatchId);
  END;
  SET @Receipt=NEWID();DECLARE @Applied int=(SELECT COUNT(*) FROM @Op),@HeldCount int=(SELECT COUNT(*) FROM OPENJSON(@Held)),@AfterHash char(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot(@Year)),2);
  INSERT paws.MasterRefreshReceipt(ReceiptId,BatchId,Domain,AcademicYear,SourceSha256,ManifestSha256,ExpectedVersion,IdempotencyKey,ActorUid,BeforeJson,AfterHash,AppliedCount,HeldCount) VALUES(@Receipt,@BatchId,N'trainees',@Year,UPPER(@SourceSha256),UPPER(@ManifestSha256),@Version,@IdempotencyKey,@ActorFirebaseUid,@Before,@AfterHash,@Applied,@HeldCount);
  UPDATE staging.MasterRefresh SET Status=N'committed' WHERE BatchId=@BatchId;UPDATE staging.ImportBatch SET Status=N'master_committed',CompletedAtUtc=SYSUTCDATETIME() WHERE ImportBatchId=@BatchId;
  SELECT(SELECT @Receipt receiptId,@Applied appliedCount,@HeldCount heldCount,CAST(0 AS bit) idempotentReplay FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.RecoverMasterTrainees @ReceiptId uniqueidentifier,@ActorFirebaseUid nvarchar(128),@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC paws_api.AssertMasterRefreshOperator @ActorFirebaseUid;
  IF @ReceiptId IS NULL OR ISNULL(@Confirm,0)<>1 THROW 55202,'Explicit trainee recovery confirmation required.',1;
  DECLARE @Year varchar(7),@Before nvarchar(max),@Expected char(64),@Batch uniqueidentifier,@Status nvarchar(16),@Operations nvarchar(max);
  SELECT @Year=AcademicYear,@Before=BeforeJson,@Expected=AfterHash,@Batch=BatchId,@Status=Status FROM paws.MasterRefreshReceipt WITH(UPDLOCK,HOLDLOCK) WHERE ReceiptId=@ReceiptId AND Domain=N'trainees';
  IF @Year IS NULL THROW 55203,'Trainee receipt not found.',1;
  IF @Status<>N'committed' THROW 55208,'Trainee recovery already used.',1;
  SELECT @Operations=OperationsJson FROM staging.MasterRefresh WITH(UPDLOCK,HOLDLOCK) WHERE BatchId=@Batch;
  EXEC paws_api.LockMasterTraineeScope @Year;
  IF CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot(@Year)),2)<>@Expected THROW 55208,'Trainee recovery after-state changed.',1;
  DECLARE @Affected TABLE(FacultyId uniqueidentifier PRIMARY KEY);
  INSERT @Affected SELECT FacultyId FROM OPENJSON(@Operations) WITH(FacultyId uniqueidentifier '$.facultyId');
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,ImportBatchId)
   SELECT NEWID(),N'trainee_source_recovered',N'faculty',CONVERT(nvarchar(36),a.FacultyId),@ActorFirebaseUid,SYSUTCDATETIME(),
   (SELECT a.FacultyId facultyId,(SELECT DisplayName FROM paws.Faculty WHERE FacultyId=a.FacultyId) displayName,@Year academicYear,JSON_QUERY(e.RawCountsJson) counts,e.SourceDoe sourceDoe,e.AllocationStatus allocationStatus FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),
   (SELECT a.FacultyId facultyId,(SELECT DisplayName FROM paws.Faculty WHERE FacultyId=a.FacultyId) displayName,@Year academicYear,JSON_QUERY(old.RawCountsJson) counts,old.SourceDoe sourceDoe,old.AllocationStatus allocationStatus FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),
   (SELECT ORIGINAL_LOGIN() operatorLogin FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@Batch
   FROM @Affected a JOIN paws.TraineeSourceEvidence e ON e.FacultyId=a.FacultyId AND e.AcademicYear=@Year
   LEFT JOIN OPENJSON(@Before,'$.trainees') WITH(FacultyId uniqueidentifier,RawCountsJson nvarchar(max),SourceDoe decimal(12,6),AllocationStatus nvarchar(32)) old ON old.FacultyId=a.FacultyId;
  DELETE e FROM paws.TraineeSourceEvidence e JOIN @Affected a ON a.FacultyId=e.FacultyId WHERE e.AcademicYear=@Year;
  INSERT paws.TraineeSourceEvidence(FacultyId,AcademicYear,SourceSha256,SourceManifestSha256,SourceRefJson,RawCountsJson,CategoryDoeJson,SourceDoe,SourceTotal,PrivateNotesJson,CellEvidenceJson,AllocationStatus,SourceImportBatchId,UpdatedAtUtc,UpdatedBy)
   SELECT b.FacultyId,b.AcademicYear,b.SourceSha256,b.SourceManifestSha256,b.SourceRefJson,b.RawCountsJson,b.CategoryDoeJson,b.SourceDoe,b.SourceTotal,b.PrivateNotesJson,b.CellEvidenceJson,b.AllocationStatus,b.SourceImportBatchId,b.UpdatedAtUtc,b.UpdatedBy
   FROM OPENJSON(@Before,'$.trainees') WITH(FacultyId uniqueidentifier,AcademicYear varchar(7),SourceSha256 char(64),SourceManifestSha256 char(64),SourceRefJson nvarchar(max),RawCountsJson nvarchar(max),CategoryDoeJson nvarchar(max),SourceDoe decimal(12,6),SourceTotal decimal(12,6),PrivateNotesJson nvarchar(max),CellEvidenceJson nvarchar(max),AllocationStatus nvarchar(32),SourceImportBatchId uniqueidentifier,UpdatedAtUtc datetime2(7),UpdatedBy nvarchar(128)) b JOIN @Affected a ON a.FacultyId=b.FacultyId WHERE b.AcademicYear=@Year;
  DELETE s FROM paws.DoeSupervisionSourceSnapshot s JOIN @Affected a ON a.FacultyId=s.FacultyId WHERE s.AcademicYear=@Year AND NOT EXISTS(SELECT 1 FROM OPENJSON(@Before,'$.supervision') WITH(SnapshotId uniqueidentifier) old WHERE old.SnapshotId=s.SnapshotId);
  UPDATE s SET RawDoe=b.RawDoe,EvidenceJson=b.EvidenceJson,SourceReference=b.SourceReference,SourceSha256=b.SourceSha256,CreatedBy=b.CreatedBy,CreatedAtUtc=b.CreatedAtUtc FROM paws.DoeSupervisionSourceSnapshot s JOIN @Affected a ON a.FacultyId=s.FacultyId JOIN OPENJSON(@Before,'$.supervision') WITH(SnapshotId uniqueidentifier,RawDoe decimal(12,6),EvidenceJson nvarchar(max),SourceReference nvarchar(1000),SourceSha256 char(64),CreatedBy nvarchar(128),CreatedAtUtc datetime2(7)) b ON b.SnapshotId=s.SnapshotId WHERE s.AcademicYear=@Year;
  UPDATE paws.MasterRefreshReceipt SET Status=N'recovered' WHERE ReceiptId=@ReceiptId;UPDATE staging.MasterRefresh SET Status=N'recovered' WHERE BatchId=@Batch;UPDATE staging.ImportBatch SET Status=N'master_recovered' WHERE ImportBatchId=@Batch;
  SELECT(SELECT @ReceiptId receiptId,CAST(1 AS bit) recovered FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO

ALTER PROCEDURE paws_api.PreviewMasterRefresh @Domain nvarchar(32),@AcademicYear varchar(7),@SourceJson nvarchar(max),@ActorFirebaseUid nvarchar(128),@DoeGuardJson nvarchar(max)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 IF @Domain=N'trainees' EXEC paws_api.PreviewMasterTrainees @Domain,@AcademicYear,@SourceJson,@ActorFirebaseUid,@DoeGuardJson;
 ELSE EXEC paws_api.PreviewMasterAppointments @Domain,@AcademicYear,@SourceJson,@ActorFirebaseUid,@DoeGuardJson;
END;
GO
ALTER PROCEDURE paws_api.CommitMasterRefresh @Domain nvarchar(32),@BatchId uniqueidentifier,@ExpectedVersion varchar(16),@ManifestSha256 varchar(64),@SourceSha256 varchar(64),@IdempotencyKey uniqueidentifier,@ActorFirebaseUid nvarchar(128),@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;
 IF @Domain=N'trainees' EXEC paws_api.CommitMasterTrainees @Domain,@BatchId,@ExpectedVersion,@ManifestSha256,@SourceSha256,@IdempotencyKey,@ActorFirebaseUid,@Confirm;
 ELSE EXEC paws_api.CommitMasterAppointments @Domain,@BatchId,@ExpectedVersion,@ManifestSha256,@SourceSha256,@IdempotencyKey,@ActorFirebaseUid,@Confirm;
END;
GO
ALTER PROCEDURE paws_api.RecoverMasterRefresh @ReceiptId uniqueidentifier,@ActorFirebaseUid nvarchar(128),@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;
 EXEC paws_api.AssertMasterRefreshOperator @ActorFirebaseUid;
 DECLARE @Domain nvarchar(32)=(SELECT Domain FROM paws.MasterRefreshReceipt WHERE ReceiptId=@ReceiptId);
 IF @Domain=N'trainees' EXEC paws_api.RecoverMasterTrainees @ReceiptId,@ActorFirebaseUid,@Confirm;
 ELSE EXEC paws_api.RecoverMasterAppointments @ReceiptId,@ActorFirebaseUid,@Confirm;
END;
GO
ALTER PROCEDURE paws_api.ListChangeHistoryEvents
 @ActorFirebaseUid nvarchar(128),@Scope nvarchar(16),@StartUtc datetime2(7),@EndExclusiveUtc datetime2(7)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Role nvarchar(128),@Faculty uniqueidentifier,@Admin bit=0;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@Faculty=FacultyId FROM paws.UserProfile
 WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL OR @Role NOT IN(N'owner',N'administrator',N'admin',N'developer',N'adfa_general',N'adfa_regular',N'faculty',N'hicc',N'visc',N'adc',N'lab')
 OR (@Role IN(N'faculty',N'hicc',N'visc') AND @Faculty IS NULL) THROW 54701,'History role denied.',1;
 IF @Scope NOT IN(N'mine',N'timetable',N'dashboard') OR @StartUtc IS NULL OR @EndExclusiveUtc IS NULL OR @StartUtc>=@EndExclusiveUtc
 THROW 54702,'Invalid history range or scope.',1;
 IF @Scope=N'mine' AND @Faculty IS NULL THROW 54703,'My history requires a faculty link.',1;
 IF @Role IN(N'owner',N'administrator',N'admin',N'developer',N'adfa_general',N'adfa_regular') SET @Admin=1;
 SELECT TOP(10001) * INTO #HistoryEvents FROM (
 SELECT N'audit' source,CONVERT(nvarchar(36),e.AuditEventId) eventId,e.EventType eventType,e.EntityType entityType,e.EntityId entityId,
 e.OccurredAtUtc occurredAtUtc,e.BeforeJson beforeJson,e.AfterJson afterJson,e.MetadataJson metadataJson,c.ContextJson contextJson,
 e.ActorName actorName,CAST(NULL AS nvarchar(32)) academicYear,CAST(NULL AS uniqueidentifier) facultyId
 FROM paws.AuditEvent e LEFT JOIN paws.ChangeHistoryContext c ON c.AuditEventId=e.AuditEventId
 WHERE e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc AND (
 (@Scope IN(N'mine',N'timetable') AND e.EventType IN(N'session_updated',N'session_created',N'session_assignments_replaced',N'swap_applied',N'session_deleted')
 AND (@Scope=N'timetable' OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,c.ContextJson) af WHERE af.FacultyId=@Faculty)))
 OR (@Scope=N'dashboard' AND e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored',N'role_periods_updated',N'trainee_source_refreshed',N'trainee_source_recovered',N'afc_form_uploaded',N'afc_form_linked',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected')
 AND (@Admin=1 OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,c.ContextJson) af WHERE af.FacultyId=@Faculty)
 OR(e.EventType IN(N'afc_form_uploaded',N'afc_form_linked',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected') AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.MetadataJson,'$.facultyId'))=@Faculty)
 OR(e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored') AND TRY_CONVERT(uniqueidentifier,e.EntityId)=@Faculty)))
 )
 UNION ALL
 SELECT N'doe',CONVERT(nvarchar(36),e.AuditEventId),e.Action,e.EntityType,e.EntityId,e.ChangedAtUtc,e.BeforeJson,e.AfterJson,NULL,
 (SELECT CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM paws.DoePolicyPublication p WHERE p.PolicyVersionId=e.PolicyVersionId) THEN 1 ELSE 0 END) wasPublished FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),
 e.ActorName,e.AcademicYear,e.FacultyId
 FROM paws.DoeAuditEvent e WHERE @Scope=N'dashboard' AND e.ChangedAtUtc>=@StartUtc AND e.ChangedAtUtc<@EndExclusiveUtc
 AND ((e.EntityType=N'doe_policy_version' AND e.Action IN(N'draft_created',N'draft_updated',N'working_draft_created',N'published',N'archived')
 AND (@Admin=1 OR e.Action=N'published' OR(e.Action=N'archived' AND EXISTS(SELECT 1 FROM paws.DoePolicyPublication p WHERE p.PolicyVersionId=e.PolicyVersionId AND p.PublishedAtUtc<=e.ChangedAtUtc))))
 OR(e.EntityType IN(N'doe_assignment',N'faculty_doe_target',N'manual_doe_assignment') AND (@Admin=1 OR e.FacultyId=@Faculty)))
 UNION ALL
 -- Receipt/recovery bindings prove historical membership without inferring it
 -- from today's assignments. Only immutable source activity facts are selected;
 -- confidential AFC recovery before-images never leave this read procedure.
 SELECT N'work',CONCAT(CONVERT(nvarchar(36),e.AuditEventId),N':',CONVERT(nvarchar(36),recovery.ActivityId)),e.EventType,N'calendar_activity',CONVERT(nvarchar(256),recovery.ActivityId),e.OccurredAtUtc,
 CASE WHEN e.EventType=N'calendar_activity_import_recovered' THEN(SELECT item.FacultyId facultyId,item.OriginalLabel label,item.Category category,item.StartDate startDate,item.EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END,
 CASE WHEN e.EventType=N'calendar_activity_import_committed' THEN(SELECT item.FacultyId facultyId,item.OriginalLabel label,item.Category category,item.StartDate startDate,item.EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END,NULL,NULL,
 e.ActorName,NULL,item.FacultyId
 FROM paws.AuditEvent e JOIN paws.CalendarActivityImportReceipt receipt ON receipt.ReceiptId=TRY_CONVERT(uniqueidentifier,e.EntityId)
 JOIN paws.CalendarActivityRecoveryRow recovery ON recovery.ReceiptId=receipt.ReceiptId
 JOIN staging.CalendarActivityImportItem item ON item.ImportBatchId=receipt.ImportBatchId AND item.AfcRecordId=recovery.OriginalAfcRecordId
 WHERE @Scope IN(N'mine',N'dashboard') AND e.EventType IN(N'calendar_activity_import_committed',N'calendar_activity_import_recovered')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR item.FacultyId=@Faculty)
 UNION ALL
 SELECT N'work',CONVERT(nvarchar(36),e.AuditEventId),e.EventType,e.EntityType,e.EntityId,e.OccurredAtUtc,e.BeforeJson,JSON_QUERY(c.ContextJson,'$.workActivity'),NULL,c.ContextJson,
 e.ActorName,NULL,TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.ContextJson,'$.facultyId'))
 FROM paws.AuditEvent e LEFT JOIN paws.ChangeHistoryContext c ON c.AuditEventId=e.AuditEventId
 WHERE e.EventType=N'calendar_activity_time_resolved' AND @Scope IN(N'mine',N'dashboard')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.ContextJson,'$.facultyId'))=@Faculty)
 UNION ALL
 SELECT N'work',CONVERT(nvarchar(36),e.AuditEventId),e.EventType,e.EntityType,e.EntityId,e.OccurredAtUtc,e.BeforeJson,e.AfterJson,NULL,NULL,
 e.ActorName,NULL,COALESCE(TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.AfterJson,'$.facultyId')),TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.BeforeJson,'$.facultyId')))
 FROM paws.AuditEvent e WHERE e.EventType IN(N'ccc_activity_added',N'ccc_activity_removed') AND @Scope IN(N'mine',N'dashboard')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,NULL) affected WHERE affected.FacultyId=@Faculty))
 ) events ORDER BY occurredAtUtc DESC,source,eventId;
 IF (SELECT COUNT(*) FROM #HistoryEvents)>10000 OR (SELECT COALESCE(SUM(CONVERT(bigint,COALESCE(DATALENGTH(beforeJson),0))+COALESCE(DATALENGTH(afterJson),0)+COALESCE(DATALENGTH(contextJson),0)+COALESCE(DATALENGTH(metadataJson),0)),0) FROM #HistoryEvents)>12582912
 THROW 54704,'Narrow the history range before reading.',1;
 -- Resolve only proven historical IDs to opaque filter keys. Today's roster is
 -- never evidence of affected membership; current names label the filter only.
 SELECT events.*,(
 SELECT candidate.FacultyId facultyId,candidate.CandidateKey facultyKey,
 COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) displayName
 FROM paws.SwapCandidate candidate JOIN paws.Faculty f ON f.FacultyId=candidate.FacultyId
 WHERE candidate.FacultyId IN(
 SELECT FacultyId FROM paws_api.HistoryAffectedFaculty(events.beforeJson,events.afterJson,events.contextJson)
 UNION SELECT events.facultyId WHERE events.facultyId IS NOT NULL
 UNION SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(events.metadataJson,'$.facultyId')) WHERE events.eventType IN(N'afc_form_uploaded',N'afc_form_linked',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected')
 UNION SELECT TRY_CONVERT(uniqueidentifier,events.entityId) WHERE events.eventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored')
 ) FOR JSON PATH) directoryFacultyJson
 FROM #HistoryEvents events ORDER BY occurredAtUtc DESC,source,eventId;
END;
GO
UPDATE staging.TraineeSchemaBaseline SET AfterSha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.'+ObjectName))),2);
COMMIT;
GO
