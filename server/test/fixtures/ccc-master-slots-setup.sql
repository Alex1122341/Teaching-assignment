/* Synthetic pre-upgrade preservation fixture, labeled container only. */
IF USER_ID(N'paws-calendar-test-runtime') IS NULL THROW 55390,'Disposable fixture required.',1;
DECLARE @Seed uniqueidentifier=NEWID(),@Book uniqueidentifier=NEWID(),@Sheet uniqueidentifier=NEWID(),@Raw uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Other uniqueidentifier=NEWID(),@Inactive uniqueidentifier=NEWID(),@Old uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Seed,SYSUTCDATETIME(),N'completed',REPLICATE('B',64),N'ccc-slots-test',N'{}');
INSERT staging.ImportWorkbook(ImportWorkbookId,ImportBatchId,FileName,FileSha256,FileByteLength) VALUES(@Book,@Seed,N'synthetic.xlsx',REPLICATE('B',64),100);
INSERT staging.ImportSheet(ImportSheetId,ImportWorkbookId,SheetName,SheetIndex,MaxRow,MaxColumn,NonEmptyRowCount) VALUES(@Sheet,@Book,N'CCC',1,4,5,3);
INSERT staging.ImportRow(ImportRowId,ImportSheetId,SourceRowNumber,RawJson,ValidationStatus,ValidationErrorsJson) VALUES(@Raw,@Sheet,2,N'{}',N'accepted',N'[]');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Example Assigned',1,@Seed),(@Other,N'faculty',N'Example Available',1,@Seed),(@Inactive,N'faculty',N'Example Departed',0,@Seed);
INSERT paws.SwapCandidate(CandidateKey,FacultyId) VALUES(NEWID(),@Faculty),(NEWID(),@Other);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword) VALUES(N'ccc-slots-admin',N'admin@example.test',N'Admin',N'owner',NULL,1,0),(N'ccc-slots-faculty',N'faculty@example.test',N'Faculty',N'faculty',@Faculty,1,0);
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid) VALUES(@Old,@Faculty,N'ccc',N'Legacy CCC','2026-10-01','2026-10-01',@Seed,@Raw,REPLICATE('B',64),N'Legacy',2,N'synthetic');
CREATE TABLE dbo.CccSlotContext(Seed uniqueidentifier,RawId uniqueidentifier,Faculty uniqueidentifier,OtherFaculty uniqueidentifier,InactiveFaculty uniqueidentifier,OldId uniqueidentifier,OldVersion binary(8),BeforeScope nvarchar(max),DoeSnapshot nvarchar(max));
INSERT dbo.CccSlotContext SELECT @Seed,@Raw,@Faculty,@Other,@Inactive,@Old,ActivityVersion,paws_api.CccScopeSnapshot('2026-27'),paws_api.MasterRefreshSnapshot('2026-27') FROM paws.CalendarActivity WHERE ActivityId=@Old;
