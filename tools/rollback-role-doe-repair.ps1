param([Parameter(Mandatory=$true)][string]$PlanPath, [Parameter(Mandatory=$true)][string]$PostSnapshotPath, [switch]$Apply)
$ErrorActionPreference = 'Stop'
$planJson = [System.IO.File]::ReadAllText($PlanPath)
$plan=$planJson | ConvertFrom-Json
if($plan.academicYear -ne '2026-27' -or $plan.sourceSha256 -notmatch '^[a-f0-9]{64}$'){throw 'Unsupported repair plan.'}
$snapshotJson=[System.IO.File]::ReadAllText($PostSnapshotPath)
$connection = New-Object System.Data.SqlClient.SqlConnection('Server=tcp:ITAPPVETOPSDB01.uc.ucalgary.ca,1433;Database=VetMed-Ops;Integrated Security=true;Encrypt=true;TrustServerCertificate=false')
$connection.Open()
try {
  $command=$connection.CreateCommand()
  $command.CommandTimeout=90
  [void]$command.Parameters.Add('@plan',[System.Data.SqlDbType]::NVarChar,-1)
  $command.Parameters['@plan'].Value=$planJson
  [void]$command.Parameters.Add('@snapshot',[System.Data.SqlDbType]::NVarChar,-1)
  $command.Parameters['@snapshot'].Value=$snapshotJson
  [void]$command.Parameters.Add('@apply',[System.Data.SqlDbType]::Bit)
  $command.Parameters['@apply'].Value=[bool]$Apply
  $command.CommandText=@'
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
IF @@SERVERNAME<>N'ITAPPVETOPSDB01' OR DB_NAME()<>N'VetMed-Ops' THROW 51100,'Unexpected environment.',1;
DECLARE @sha char(64)=JSON_VALUE(@plan,'$.sourceSha256');
DECLARE @batch uniqueidentifier=CONVERT(uniqueidentifier,SUBSTRING(@sha,1,8)+'-'+SUBSTRING(@sha,9,4)+'-'+SUBSTRING(@sha,13,4)+'-'+SUBSTRING(@sha,17,4)+'-'+SUBSTRING(@sha,21,12));
SELECT * INTO #undo FROM OPENJSON(@plan,'$.operations') WITH (
 action nvarchar(10) '$.action',roleId uniqueidentifier '$.roleAssignmentId',facultyId uniqueidentifier '$.source.facultyId',
 roleType nvarchar(256) '$.source.roleType',doe decimal(12,6) '$.source.doe',beforeJson nvarchar(max) '$.before' AS JSON);
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM #undo WHERE action IS NULL OR action NOT IN('update','insert') OR roleId IS NULL OR facultyId IS NULL OR doe IS NULL OR roleType IS NULL) THROW 51105,'Invalid rollback plan.',1;
IF EXISTS(SELECT roleId FROM #undo GROUP BY roleId HAVING COUNT(*)<>1) THROW 51106,'Duplicate rollback identity.',1;
IF NOT EXISTS (SELECT 1 FROM staging.ImportBatch WHERE ImportBatchId=@batch AND Status='role-doe-repair-complete') THROW 51101,'Completed repair batch required.',1;
IF (SELECT COUNT(*) FROM paws.RoleAssignment WITH(UPDLOCK,HOLDLOCK) WHERE SourceImportBatchId=@batch)<>(SELECT COUNT(*) FROM #undo) THROW 51102,'Repair rows changed; stop for review.',1;
IF EXISTS(SELECT 1 FROM #undo p LEFT JOIN paws.RoleAssignment r ON r.RoleAssignmentId=p.roleId WHERE
 r.RoleAssignmentId IS NULL OR r.SourceImportBatchId IS NULL OR r.SourceImportBatchId<>@batch OR r.FacultyId IS NULL OR r.FacultyId<>p.facultyId OR
 r.RoleType IS NULL OR r.RoleType<>p.roleType OR r.DoeMappedValue IS NULL OR r.DoeMappedValue<>p.doe OR r.DoeOverrideValue IS NOT NULL) THROW 51103,'Repair row changed; stop for review.',1;
-- Require every complete postimage captured immediately after the repair.
-- This rejects edits to dates, notes, provenance, course fields, or any other column.
IF EXISTS(SELECT 1 FROM #undo p LEFT JOIN paws.RoleAssignment r ON r.RoleAssignmentId=p.roleId
 OUTER APPLY(SELECT j.value FROM OPENJSON(@snapshot,'$.roles') j WHERE CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.RoleAssignmentId'))=p.roleId) s
 WHERE s.value IS NULL OR HASHBYTES('SHA2_256',s.value)<>HASHBYTES('SHA2_256',(SELECT r.* FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER))) THROW 51107,'Complete postimage changed or missing; rollback requires review.',1;
DELETE r FROM paws.RoleAssignment r JOIN #undo p ON p.roleId=r.RoleAssignmentId WHERE p.action='insert';
DECLARE @deleted int=@@ROWCOUNT;
UPDATE r SET SourceFacultyName=b.SourceFacultyName,FacultyResolutionStatus=b.FacultyResolutionStatus,RoleType=b.RoleType,
 Details=b.Details,EffectiveDate=b.EffectiveDate,ExpirationDate=b.ExpirationDate,DoeMappedValue=b.DoeMappedValue,
 SpecialNotes=b.SpecialNotes,SourceImportBatchId=b.SourceImportBatchId,SourceRow=b.SourceRow
FROM paws.RoleAssignment r JOIN #undo p ON p.roleId=r.RoleAssignmentId
CROSS APPLY OPENJSON(p.beforeJson) WITH(SourceFacultyName nvarchar(256),FacultyResolutionStatus nvarchar(100),RoleType nvarchar(256),
 Details nvarchar(max),EffectiveDate date,ExpirationDate date,DoeMappedValue decimal(12,6),SpecialNotes nvarchar(max),SourceImportBatchId uniqueidentifier,SourceRow int) b
WHERE p.action='update';
DECLARE @restored int=@@ROWCOUNT;
IF @deleted<>(SELECT COUNT(*) FROM #undo WHERE action='insert') OR @restored<>(SELECT COUNT(*) FROM #undo WHERE action='update') THROW 51104,'Rollback count mismatch.',1;
SELECT @batch batchId,@apply committed,@deleted deleted,@restored restored FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
IF @apply=1 BEGIN
 UPDATE staging.ImportBatch SET Status='role-doe-repair-rolled-back',CompletedAtUtc=SYSUTCDATETIME() WHERE ImportBatchId=@batch;
 COMMIT;
END ELSE ROLLBACK;
'@
  $reader=$command.ExecuteReader()
  $builder=New-Object System.Text.StringBuilder
  do { while($reader.Read()){if($reader.FieldCount -eq 1){[void]$builder.Append($reader.GetString(0))}} } while($reader.NextResult())
  $reader.Dispose()
  $builder.ToString()
} finally { $connection.Dispose() }
