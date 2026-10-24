param([Parameter(Mandatory=$true)][string]$PlanPath,[switch]$Apply)
$ErrorActionPreference='Stop'
$sourcePlan=[IO.File]::ReadAllText($PlanPath)
$sql=@'
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @plan nvarchar(max)=@payload;
DECLARE @year nvarchar(32)=JSON_VALUE(@plan,'$.academicYear');
SELECT snapshotId,facultyId,rawDoe,evidence,sourceReference INTO #source
FROM OPENJSON(@plan,'$.rows') WITH (
 snapshotId uniqueidentifier '$.snapshotId', facultyId uniqueidentifier '$.facultyId',
 rawDoe decimal(12,6) '$.rawDoe', evidence nvarchar(max) '$.evidence' AS JSON,
 sourceReference nvarchar(1000) '$.sourceReference');
IF COALESCE(@year,N'')<>N'2026-27' OR (SELECT COUNT(*) FROM #source)<>116 THROW 51020,'Invalid supervision source plan.',1;
IF COALESCE(JSON_VALUE(@plan,'$.sourceSha256'),'')<>'a834d571a25942a1242c9ae3d4f56f975525dfa48658c76883a92dac6bb1d1b4'
 OR COALESCE(JSON_VALUE(@plan,'$.guidelineSha256'),'')<>'e1b3261e268b43b14e474051a8fd68fe3910d45cf2179c72fd118bc8f7a005b5'
 OR (SELECT SUM(rawDoe) FROM #source)<>569.25
 OR (SELECT COUNT(*) FROM #source WHERE rawDoe=0)<>42 THROW 51028,'Approved source evidence changed.',1;
IF COALESCE(TRY_CONVERT(decimal(12,6),JSON_VALUE(@plan,'$.parameters.splitThreshold')),-1)<>35
 OR COALESCE(TRY_CONVERT(decimal(12,6),JSON_VALUE(@plan,'$.parameters.splitRatio')),-1)<>0.5
 OR COALESCE(TRY_CONVERT(decimal(12,6),JSON_VALUE(@plan,'$.parameters.highTeachingTraineeCeiling')),-1)<>15
 OR COALESCE(TRY_CONVERT(decimal(12,6),JSON_VALUE(@plan,'$.parameters.teachingFocusedTraineeCeiling')),-1)<>7.5
 OR COALESCE(TRY_CONVERT(int,JSON_VALUE(@plan,'$.parameters.rollingAverageYears')),-1)<>3 THROW 51029,'Approved workload parameters changed.',1;
IF EXISTS(SELECT 1 FROM #source WHERE snapshotId IS NULL OR facultyId IS NULL OR rawDoe IS NULL OR rawDoe<0 OR ISJSON(evidence)<>1) THROW 51021,'Invalid supervision row.',1;
IF EXISTS(SELECT facultyId FROM #source GROUP BY facultyId HAVING COUNT(*)<>1) THROW 51022,'Duplicate source identity.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM paws.DoeWorkloadSource WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@year)
 OR EXISTS(SELECT 1 FROM paws.DoeSupervisionSourceSnapshot WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@year)
 THROW 51023,'Source recovery already exists; inspect checkpoint, do not rerun.',1;
IF EXISTS(SELECT 1 FROM #source s LEFT JOIN paws.Faculty f ON f.FacultyId=s.facultyId WHERE f.FacultyId IS NULL OR f.Active<>1) THROW 51024,'Source Faculty identity changed.',1;
IF EXISTS(SELECT 1 FROM paws.DoeAssignmentFact WHERE AcademicYear=@year AND Active=1 AND Category IN(N'supervision',N'trainee_supervision')) THROW 51025,'Annual supervision facts now exist; no duplicate import allowed.',1;
INSERT paws.DoeWorkloadSource(AcademicYear,ParametersJson,SourceReference,SourceSha256,ApprovedBy)
VALUES(@year,JSON_QUERY(@plan,'$.parameters'),JSON_VALUE(@plan,'$.workloadSourceReference'),JSON_VALUE(@plan,'$.guidelineSha256'),ORIGINAL_LOGIN());
INSERT paws.DoeSupervisionSourceSnapshot(SnapshotId,FacultyId,AcademicYear,RawDoe,EvidenceJson,SourceReference,SourceSha256,CreatedBy)
SELECT snapshotId,facultyId,@year,rawDoe,evidence,sourceReference,JSON_VALUE(@plan,'$.sourceSha256'),ORIGINAL_LOGIN() FROM #source;
IF @@ROWCOUNT<>116 THROW 51026,'Import row count differs.',1;
IF EXISTS(SELECT 1 FROM #source s JOIN paws.DoeSupervisionSourceSnapshot t ON t.SnapshotId=s.snapshotId WHERE s.rawDoe<>t.RawDoe OR s.facultyId<>t.FacultyId OR s.evidence<>t.EvidenceJson) THROW 51027,'Source reconciliation failed.',1;
SELECT @apply committed,COUNT(*) snapshots,SUM(RawDoe) rawDoe,SUM(CASE WHEN RawDoe=0 THEN 1 ELSE 0 END) explicitZeros
FROM paws.DoeSupervisionSourceSnapshot WHERE AcademicYear=@year FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
IF @apply=1 COMMIT; ELSE ROLLBACK;
'@
$connection=[System.Data.SqlClient.SqlConnection]::new('Server=tcp:ITAPPVETOPSDB01.uc.ucalgary.ca,1433;Database=VetMed-Ops;Integrated Security=true;Encrypt=true;TrustServerCertificate=false')
try {
 $connection.Open();$command=$connection.CreateCommand();$command.CommandTimeout=120;$command.CommandText=$sql
 [void]$command.Parameters.Add('@payload',[System.Data.SqlDbType]::NVarChar,-1);$command.Parameters['@payload'].Value=$sourcePlan
 [void]$command.Parameters.Add('@apply',[System.Data.SqlDbType]::Bit);$command.Parameters['@apply'].Value=[bool]$Apply
 $reader=$command.ExecuteReader();while($reader.Read()){$reader.GetString(0)};$reader.Close()
} finally {$connection.Dispose()}
