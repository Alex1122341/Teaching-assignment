/* Synthetic disposable-container acceptance. Never run on University SQL. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF USER_ID(N'paws-calendar-test-runtime') IS NULL OR DB_NAME()<>N'VetMed-Ops' THROW 55290,'Disposable fixture required.',1;
DECLARE @Seed uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Existing uniqueidentifier=NEWID(),@Mismatch uniqueidentifier=NEWID(),@Removed uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Seed,SYSUTCDATETIME(),N'completed',REPLICATE('B',64),N'master-test',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Example Master Faculty',1,@Seed);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword) VALUES(N'master-test-admin',N'master-admin@example.test',N'Synthetic administrator',N'owner',NULL,1,0),(N'master-test-faculty',N'master-faculty@example.test',N'Synthetic faculty',N'faculty',@Faculty,1,0);
INSERT paws.RoleAssignment(RoleAssignmentId,FacultyId,SourceFacultyName,FacultyResolutionStatus,AcademicYear,RoleCategory,RoleType,CourseOrSubjectOrRotation,DoeMappedValue,DoeOverrideValue,DoeOverrideReason,SourceImportBatchId,SourceRow)
VALUES(@Existing,@Faculty,N'Example Master Faculty',N'resolved','2026-27',N'Assigned',N'VISC',N'Example Area',5,0,N'Explicit zero must survive',@Seed,2),
(@Mismatch,@Faculty,N'Example Master Faculty',N'resolved','2026-27',N'Assigned',N'Designated Rotation Coordinator',N'Example Rotation',2,NULL,NULL,@Seed,3),
(@Removed,@Faculty,N'Example Master Faculty',N'resolved','2026-27',N'Assigned',N'HICC',N'Old Course',6,NULL,NULL,@Seed,4);
INSERT paws.RoleAppointmentSchedule(RoleAssignmentId,PeriodsJson,UpdatedAtUtc,UpdatedByFirebaseUid) VALUES(@Existing,N'[{"startDate":"2026-05-01","endDate":"2027-04-30"}]',SYSUTCDATETIME(),N'synthetic');
CREATE TABLE dbo.MasterTestContext(Seed uniqueidentifier,Faculty uniqueidentifier,ExistingRole uniqueidentifier,MismatchRole uniqueidentifier,RemovedRole uniqueidentifier,SourceJson nvarchar(max),PreviewJson nvarchar(max),RequestKey uniqueidentifier,ReceiptId uniqueidentifier NULL);
DECLARE @Row nvarchar(max)=(SELECT @Faculty facultyId,N'Example Master Faculty' sourceName,N'VISC' roleType,N'Example Area' scope,CAST(0 AS decimal(12,6)) sourceDoe,
 JSON_QUERY(N'[{"startDate":"2026-05-01","endDate":"2026-08-31"},{"startDate":"2027-03-01","endDate":"2027-04-30"}]') periods,
 JSON_QUERY((SELECT REPLICATE('A',64) sha256,N'VISCs' sheet,2 row,N'A' [column] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) sourceRef FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
DECLARE @Missing nvarchar(max)=JSON_MODIFY(JSON_MODIFY(@Row,'$.scope',N'New Missing Area'),'$.sourceDoe',NULL),@Wrong nvarchar(max)=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Row,'$.roleType',N'Designated Rotation Coordinator'),'$.scope',N'Example Rotation'),'$.sourceDoe',1),@Eligible nvarchar(max)=JSON_MODIFY(JSON_MODIFY(@Row,'$.scope',N'New Approved Area'),'$.sourceDoe',2);
DECLARE @Source nvarchar(max)=(SELECT 1 schemaVersion,'2026-27' academicYear,REPLICATE('A',64) sourceSha256,REPLICATE('C',64) manifestSha256,
 JSON_QUERY(N'['+@Row+N','+@Missing+N','+@Wrong+N','+@Eligible+N']') appointments,JSON_QUERY(N'[]') rotations,JSON_QUERY(N'[]') cccAllocations,
 JSON_QUERY(N'[{"roleType":"HICC","scope":"Vacant Course"}]') roleDefinitions,JSON_QUERY(N'[]') cccSlots,JSON_QUERY(N'[]') trainees,JSON_QUERY(N'[]') issues FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
INSERT dbo.MasterTestContext VALUES(@Seed,@Faculty,@Existing,@Mismatch,@Removed,@Source,NULL,NEWID(),NULL);
GO
CREATE PROCEDURE dbo.StageMasterTest @WithAggregate bit=1,@UnsafeAggregate bit=0
AS
BEGIN
 DECLARE @Source nvarchar(max)=(SELECT SourceJson FROM dbo.MasterTestContext);
 DECLARE @Result TABLE(responseJson nvarchar(max));
 -- Synthetic trusted calculation evidence. JavaScript tests exercise the actual
 -- annual engine; these values isolate database binding/atomicity behavior.
 DECLARE @Guard nvarchar(max)=(SELECT 1 schemaVersion,REPLICATE('C',64) sourceManifestSha256,REPLICATE('D',64) doeGuardHash,
  CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot('2026-27')),2) contextHash,
  JSON_QUERY((SELECT JSON_VALUE(j.value,'$.facultyId') facultyId,JSON_VALUE(j.value,'$.roleType') roleType,JSON_VALUE(j.value,'$.scope') scope,
   r.RoleAssignmentId roleId,CAST(IIF(r.RoleAssignmentId IS NULL,1,0) AS bit) isNew,N'matched' status,N'safe' aggregateStatus,TRY_CONVERT(decimal(12,6),JSON_VALUE(j.value,'$.sourceDoe')) sourceDoe,
   COALESCE(r.DoeOverrideValue,r.DoeMappedValue,TRY_CONVERT(decimal(12,6),JSON_VALUE(j.value,'$.sourceDoe'))) activeDoe,
   COALESCE(r.DoeOverrideValue,r.DoeMappedValue,TRY_CONVERT(decimal(12,6),JSON_VALUE(j.value,'$.sourceDoe'))) candidateDoe
   FROM OPENJSON(@Source,'$.appointments') j LEFT JOIN paws.RoleAssignment r ON r.AcademicYear='2026-27' AND r.FacultyId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.facultyId')) AND r.RoleType=JSON_VALUE(j.value,'$.roleType') AND r.CourseOrSubjectOrRotation=JSON_VALUE(j.value,'$.scope') FOR JSON PATH,INCLUDE_NULL_VALUES)) rows
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 SET @Guard=JSON_MODIFY(@Guard,'$.facultyImpacts',JSON_QUERY((SELECT Faculty facultyId,N'2026-27' academicYear,N'safe' status,REPLICATE('E',64) sourceHash,REPLICATE('F',64) evidenceHash,2 expectedRoleDelta,
 JSON_QUERY(N'{"scheduledTeachingDoe":10,"roleDoe":8,"rawSupervisionDoe":5,"appliedSupervisionDoe":5,"adjustmentDoe":0,"assignedTeachingDoe":23,"effectiveTargetDoe":40,"remainingDoe":17}') before,
 JSON_QUERY(IIF(@UnsafeAggregate=1,N'{"scheduledTeachingDoe":10,"roleDoe":10,"rawSupervisionDoe":5,"appliedSupervisionDoe":4,"adjustmentDoe":0,"assignedTeachingDoe":25,"effectiveTargetDoe":40,"remainingDoe":15}',N'{"scheduledTeachingDoe":10,"roleDoe":10,"rawSupervisionDoe":5,"appliedSupervisionDoe":5,"adjustmentDoe":0,"assignedTeachingDoe":25,"effectiveTargetDoe":40,"remainingDoe":15}')) proposed FROM dbo.MasterTestContext FOR JSON PATH)));
 IF @WithAggregate=0 SET @Guard=JSON_MODIFY(@Guard,'$.facultyImpacts',NULL);
 INSERT @Result EXEC paws_api.PreviewMasterRefresh N'appointments','2026-27',@Source,N'master-test-admin',@Guard;
 UPDATE dbo.MasterTestContext SET PreviewJson=(SELECT responseJson FROM @Result),RequestKey=NEWID();
END;
GO
CREATE PROCEDURE dbo.ApplyMasterTest @Key uniqueidentifier=NULL
AS
BEGIN
 DECLARE @Preview nvarchar(max),@Request uniqueidentifier,@Batch uniqueidentifier,@Version varchar(16),@Source varchar(64),@Manifest varchar(64);
 SELECT @Preview=PreviewJson,@Request=COALESCE(@Key,RequestKey) FROM dbo.MasterTestContext;
 SELECT @Batch=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@Preview,'$.batchId')),@Version=JSON_VALUE(@Preview,'$.expectedVersion'),@Source=JSON_VALUE(@Preview,'$.sourceSha256'),@Manifest=JSON_VALUE(@Preview,'$.manifestSha256');
 EXEC paws_api.CommitMasterRefresh N'appointments',@Batch,@Version,@Manifest,@Source,@Request,N'master-test-admin',1;
END;
GO
EXEC dbo.StageMasterTest;
DECLARE @Preview nvarchar(max)=(SELECT PreviewJson FROM dbo.MasterTestContext);
IF (SELECT COUNT(*) FROM OPENJSON(@Preview,'$.operations'))<>3 OR (SELECT COUNT(*) FROM OPENJSON(@Preview,'$.heldIssues'))<>2 OR @Preview NOT LIKE N'%DOE_MISMATCH%' OR @Preview NOT LIKE N'%HELD_REMOVAL%' THROW 55290,'Incorrect appointment reconciliation.',1;
DECLARE @Source nvarchar(max)=(SELECT SourceJson FROM dbo.MasterTestContext);
BEGIN TRY EXEC paws_api.PreviewMasterRefresh N'appointments','2026-27',@Source,N'master-test-admin';THROW 55290,'Missing engine guard accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>55206 THROW;END CATCH;
EXEC dbo.StageMasterTest @WithAggregate=0;
IF (SELECT COUNT(*) FROM OPENJSON((SELECT PreviewJson FROM dbo.MasterTestContext),'$.operations'))<>2 THROW 55290,'Scalar match bypassed absent aggregate guard.',1;
EXEC dbo.StageMasterTest @UnsafeAggregate=1;
IF (SELECT COUNT(*) FROM OPENJSON((SELECT PreviewJson FROM dbo.MasterTestContext),'$.operations'))<>2 THROW 55290,'Unsafe applied supervision change accepted.',1;
EXEC dbo.StageMasterTest;PRINT 'MASTER_AGGREGATE_GUARD_OK';
-- Runtime cannot stage by impersonating a valid administrator actor.
EXECUTE AS USER=N'paws-calendar-test-runtime';
BEGIN TRY EXEC dbo.StageMasterTest;REVERT;THROW 55290,'Runtime staged MASTER.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>229 BEGIN REVERT;THROW;END;END CATCH;REVERT;
-- Snapshot guards must detect identity and schedule edits and phantom roles.
BEGIN TRY
 BEGIN TRANSACTION;UPDATE paws.Faculty SET Active=0 WHERE FacultyId=(SELECT Faculty FROM dbo.MasterTestContext);EXEC dbo.ApplyMasterTest;THROW 55290,'Stale identity accepted.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55204 THROW;END CATCH;
BEGIN TRY
 BEGIN TRANSACTION;UPDATE paws.RoleAppointmentSchedule SET UpdatedByFirebaseUid=N'changed' WHERE RoleAssignmentId=(SELECT ExistingRole FROM dbo.MasterTestContext);EXEC dbo.ApplyMasterTest;THROW 55290,'Stale schedule accepted.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55204 THROW;END CATCH;
BEGIN TRY
 BEGIN TRANSACTION;
 INSERT paws.RoleAssignment(RoleAssignmentId,FacultyId,SourceFacultyName,FacultyResolutionStatus,AcademicYear,RoleType,CourseOrSubjectOrRotation,SourceImportBatchId,SourceRow)
 SELECT NEWID(),Faculty,N'Example Master Faculty',N'resolved','2026-27',N'VISC',N'New Missing Area',Seed,9 FROM dbo.MasterTestContext;
 EXEC dbo.ApplyMasterTest;THROW 55290,'Phantom role accepted.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55204 THROW;END CATCH;
-- Refresh the staged fixture before the next independent stale-state case.
EXEC dbo.StageMasterTest;
-- A direct rule-parameter edit must invalidate the guard even when the parent
-- policy Revision is unchanged. This catches edits outside normal UI tooling.
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @Parameter uniqueidentifier=(SELECT TOP(1) p.ParameterId FROM paws.DoeRuleParameter p JOIN paws.DoePolicyRule r ON r.RuleId=p.RuleId WHERE r.AcademicYear='2026-27' AND p.ValueNumber IS NOT NULL ORDER BY p.ParameterId);
 IF @Parameter IS NULL THROW 55290,'Synthetic engine parameter fixture missing.',1;
 UPDATE paws.DoeRuleParameter SET ValueNumber=ValueNumber+1 WHERE ParameterId=@Parameter;
 EXEC dbo.ApplyMasterTest;THROW 55290,'Stale policy child accepted.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55204 THROW;END CATCH;
EXEC dbo.StageMasterTest;
GO
CREATE TRIGGER paws.MasterTestAuditFailure ON paws.AuditEvent AFTER INSERT AS
BEGIN
 IF EXISTS(SELECT 1 FROM inserted WHERE EventType=N'master_source_refreshed') THROW 55291,'Injected audit failure.',1;
END;
GO
BEGIN TRY EXEC dbo.ApplyMasterTest;THROW 55290,'Audit failure was ignored.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>55291 THROW;END CATCH;
IF EXISTS(SELECT 1 FROM paws.MasterRefreshReceipt WHERE Domain=N'appointments') OR EXISTS(SELECT 1 FROM paws.MasterRoleSourceEvidence) OR EXISTS(SELECT 1 FROM paws.RoleAssignment WHERE CourseOrSubjectOrRotation=N'New Missing Area') THROW 55290,'Failed transaction left partial state.',1;
DROP TRIGGER paws.MasterTestAuditFailure;
EXEC dbo.StageMasterTest;
DECLARE @Result TABLE(responseJson nvarchar(max));INSERT @Result EXEC dbo.ApplyMasterTest;
UPDATE dbo.MasterTestContext SET ReceiptId=TRY_CONVERT(uniqueidentifier,JSON_VALUE((SELECT responseJson FROM @Result),'$.receiptId'));
IF JSON_VALUE((SELECT responseJson FROM @Result),'$.appliedCount')<>N'3' THROW 55290,'Incorrect receipt.',1;
IF NOT EXISTS(SELECT 1 FROM paws.RoleAssignment WHERE CourseOrSubjectOrRotation=N'New Approved Area' AND DoeMappedValue=2 AND DoeOverrideValue IS NULL) THROW 55290,'Matching new source credit not preserved.',1;
IF NOT EXISTS(SELECT 1 FROM paws.RoleAssignment WHERE RoleAssignmentId=(SELECT ExistingRole FROM dbo.MasterTestContext) AND DoeMappedValue=5 AND DoeOverrideValue=0 AND DoeOverrideReason=N'Explicit zero must survive') THROW 55290,'Explicit allocation changed.',1;
IF NOT EXISTS(SELECT 1 FROM paws.RoleAssignment WHERE RoleAssignmentId=(SELECT MismatchRole FROM dbo.MasterTestContext) AND DoeMappedValue=2) OR NOT EXISTS(SELECT 1 FROM paws.RoleAssignment WHERE RoleAssignmentId=(SELECT RemovedRole FROM dbo.MasterTestContext) AND DoeMappedValue=6) THROW 55290,'Held allocation changed.',1;
IF NOT EXISTS(SELECT 1 FROM paws.RoleAppointmentSchedule WHERE RoleAssignmentId=(SELECT ExistingRole FROM dbo.MasterTestContext) AND (SELECT COUNT(*) FROM OPENJSON(PeriodsJson))=2) THROW 55290,'Appointment gap lost.',1;
IF NOT EXISTS(SELECT 1 FROM paws.MasterRoleSourceEvidence e JOIN paws.RoleAssignment r ON r.RoleAssignmentId=e.RoleAssignmentId WHERE r.CourseOrSubjectOrRotation=N'New Missing Area' AND e.AllocationStatus=N'source_missing' AND r.DoeMappedValue IS NULL AND r.DoeOverrideValue IS NULL) THROW 55290,'Missing allocation was inferred.',1;
IF (SELECT COUNT(*) FROM paws.MasterRoleDefinition)<>1 OR EXISTS(SELECT 1 FROM paws.RoleAssignment WHERE CourseOrSubjectOrRotation=N'Vacant Course') THROW 55290,'Vacant definition assigned credit.',1;
IF EXISTS(SELECT 1 FROM paws.CalendarActivity) OR EXISTS(SELECT 1 FROM paws.AfcRecord) THROW 55290,'Appointment became a work session or absence.',1;
DELETE @Result;INSERT @Result EXEC dbo.ApplyMasterTest;
IF JSON_VALUE((SELECT responseJson FROM @Result),'$.idempotentReplay')<>N'true' OR (SELECT COUNT(*) FROM paws.MasterRefreshReceipt WHERE Domain=N'appointments')<>1 THROW 55290,'Identical retry duplicated data.',1;
DECLARE @OtherKey uniqueidentifier=NEWID();BEGIN TRY EXEC dbo.ApplyMasterTest @OtherKey;THROW 55290,'Different key committed twice.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>55204 THROW;END CATCH;
DECLARE @Receipt uniqueidentifier=(SELECT ReceiptId FROM dbo.MasterTestContext);
BEGIN TRY
 BEGIN TRANSACTION;UPDATE paws.RoleAssignment SET SpecialNotes=N'later manual update' WHERE RoleAssignmentId=(SELECT ExistingRole FROM dbo.MasterTestContext);EXEC paws_api.RecoverMasterRefresh @Receipt,N'master-test-admin',1;THROW 55290,'Recovery overwrote manual update.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55208 THROW;END CATCH;
EXEC paws_api.RecoverMasterRefresh @Receipt,N'master-test-admin',1;
IF EXISTS(SELECT 1 FROM paws.RoleAssignment WHERE CourseOrSubjectOrRotation=N'New Missing Area') OR EXISTS(SELECT 1 FROM paws.MasterRoleSourceEvidence) OR EXISTS(SELECT 1 FROM paws.MasterRoleDefinition) THROW 55290,'Guarded recovery failed.',1;
IF NOT EXISTS(SELECT 1 FROM paws.RoleAppointmentSchedule WHERE RoleAssignmentId=(SELECT ExistingRole FROM dbo.MasterTestContext) AND (SELECT COUNT(*) FROM OPENJSON(PeriodsJson))=1) THROW 55290,'Original schedule not restored.',1;
IF NOT EXISTS(SELECT 1 FROM paws.RoleAssignment WHERE RoleAssignmentId=(SELECT ExistingRole FROM dbo.MasterTestContext) AND DoeMappedValue=5 AND DoeOverrideValue=0) THROW 55290,'Recovery changed DOE.',1;
PRINT 'MASTER_APPOINTMENT_ACCEPTANCE_OK';
