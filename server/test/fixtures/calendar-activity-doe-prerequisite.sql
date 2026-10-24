SET NOCOUNT ON;
DECLARE @Batch uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson)
VALUES(@Batch,SYSUTCDATETIME(),N'synthetic-prerequisite',REPLICATE('F',64),N'calendar-test',N'{"synthetic":true}');
INSERT paws.DoeRuleSeed(DoeRuleSeedId,Category,RuleLabel,AcademicYearOrStage,RateOrTierPct,Basis,RequiredInput,AuthoritativeInExcel,RawJson,SourceImportBatchId,SourceRow)
SELECT NEWID(),N'Assigned Teaching',RuleLabel,N'2026-27',Rate,N'per credited hour',N'creditedHours',N'Yes synthetic fixture',N'{"synthetic":true}',@Batch,RowNumber
FROM (VALUES(N'Lecture',N'0.3',1),(N'SRL',N'0.3',2),(N'Lab Primary',N'0.21',3),(N'Lab Secondary',N'0.19',4)) seeds(RuleLabel,Rate,RowNumber);
INSERT paws.DoeRuleSeed(DoeRuleSeedId,Category,RuleLabel,AcademicYearOrStage,RateOrTierPct,RequiredInput,AuthoritativeInExcel,RawJson,SourceImportBatchId,SourceRow)
VALUES(NEWID(),N'Development',N'VISC',N'2026-27',N'5',N'subject mapping',N'Used in Role Assignments',N'{"synthetic":true}',@Batch,5);
PRINT 'SYNTHETIC_DOE_PREREQUISITE_SEEDS_ONLY';
