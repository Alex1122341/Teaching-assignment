param([Parameter(Mandatory=$true)][string]$PlanPath, [switch]$Apply)
$ErrorActionPreference = 'Stop'
$planJson = [System.IO.File]::ReadAllText($PlanPath)
$plan = $planJson | ConvertFrom-Json
if ($plan.academicYear -ne '2026-27' -or $plan.unresolved.Count -ne 0 -or $plan.unmatchedSourceRoles.Count -ne 0) { throw 'Plan has unresolved business roles or an unsupported academic year.' }
if ($plan.sourceSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Source digest is required.' }
$connection = New-Object System.Data.SqlClient.SqlConnection('Server=tcp:ITAPPVETOPSDB01.uc.ucalgary.ca,1433;Database=VetMed-Ops;Integrated Security=true;Encrypt=true;TrustServerCertificate=false')
$connection.Open()
try {
  $command = $connection.CreateCommand()
  $command.CommandTimeout = 90
  [void]$command.Parameters.Add('@plan', [System.Data.SqlDbType]::NVarChar, -1)
  $command.Parameters['@plan'].Value = $planJson
  [void]$command.Parameters.Add('@apply', [System.Data.SqlDbType]::Bit)
  $command.Parameters['@apply'].Value = [bool]$Apply
  $command.CommandText = @'
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
IF @@SERVERNAME <> N'ITAPPVETOPSDB01' OR DB_NAME() <> N'VetMed-Ops' THROW 51000, 'Unexpected execution environment.', 1;
DECLARE @year nvarchar(32)=JSON_VALUE(@plan,'$.academicYear');
DECLARE @sha char(64)=JSON_VALUE(@plan,'$.sourceSha256');
DECLARE @batch uniqueidentifier=CONVERT(uniqueidentifier, SUBSTRING(@sha,1,8)+'-'+SUBSTRING(@sha,9,4)+'-'+SUBSTRING(@sha,13,4)+'-'+SUBSTRING(@sha,17,4)+'-'+SUBSTRING(@sha,21,12));
SELECT action, roleId, facultyId, roleType, assignment, doe, sourceName, sourceRow, sourceSheet, sourceRef, sourceNotes, effectiveDate, expirationDate,
       parentId, oldType, oldAssignment
INTO #repair FROM OPENJSON(@plan,'$.operations') WITH (
  action nvarchar(10) '$.action', roleId uniqueidentifier '$.roleAssignmentId',
  facultyId uniqueidentifier '$.source.facultyId', roleType nvarchar(256) '$.source.roleType', assignment nvarchar(1000) '$.source.assignment',
  doe decimal(12,6) '$.source.doe', sourceName nvarchar(256) '$.source.sourceFacultyName', sourceRow int '$.source.row',
  sourceSheet nvarchar(100) '$.source.sheet', sourceRef nvarchar(1000) '$.source.sourceReference', sourceNotes nvarchar(max) '$.source.sourceNotes',
  effectiveDate date '$.source.effectiveDate', expirationDate date '$.source.expirationDate',
  parentId uniqueidentifier '$.before.RoleAssignmentId', oldType nvarchar(256) '$.before.RoleType', oldAssignment nvarchar(1000) '$.before.CourseOrSubjectOrRotation'
);
IF EXISTS (SELECT 1 FROM #repair WHERE action NOT IN ('update','insert') OR facultyId IS NULL OR doe IS NULL OR roleId IS NULL OR sourceRow IS NULL OR roleType NOT IN ('Course Coordinator','HICC','CCC')) THROW 51001,'Invalid repair operation.',1;
IF EXISTS (SELECT roleId FROM #repair GROUP BY roleId HAVING COUNT(*)<>1) THROW 51002,'Duplicate repair identity.',1;
IF EXISTS (SELECT 1 FROM #repair WHERE expirationDate IS NOT NULL AND effectiveDate IS NOT NULL AND expirationDate<=effectiveDate) THROW 51003,'Invalid source date window.',1;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM staging.ImportBatch WHERE ImportBatchId=@batch) THROW 51004,'This source repair batch already exists; inspect checkpoint before retrying.',1;
IF (SELECT COUNT(*) FROM paws.RoleAssignment WITH (UPDLOCK,HOLDLOCK) WHERE AcademicYear=@year)<>CONVERT(int,JSON_VALUE(@plan,'$.summary.beforeRoleRows')) THROW 51005,'Role snapshot changed; regenerate plan.',1;
IF EXISTS (SELECT 1 FROM #repair p LEFT JOIN paws.Faculty f ON f.FacultyId=p.facultyId WHERE f.FacultyId IS NULL OR f.Active<>1) THROW 51006,'Faculty identity is missing or inactive.',1;
IF EXISTS (SELECT 1 FROM #repair p LEFT JOIN paws.RoleAssignment r ON r.RoleAssignmentId=p.roleId WHERE p.action='update' AND
 (r.RoleAssignmentId IS NULL OR r.FacultyId IS NULL OR r.FacultyId<>p.facultyId OR r.AcademicYear IS NULL OR r.AcademicYear<>@year OR r.RoleType IS NULL OR r.RoleType<>p.oldType OR r.CourseOrSubjectOrRotation IS NULL OR r.CourseOrSubjectOrRotation<>p.oldAssignment OR r.DoeMappedValue IS NOT NULL OR r.DoeOverrideValue IS NOT NULL)) THROW 51007,'A target row changed or has authoritative DOE; no write allowed.',1;
IF EXISTS (SELECT 1 FROM #repair p JOIN paws.RoleAssignment r ON r.RoleAssignmentId=p.roleId WHERE p.action='insert') THROW 51008,'Insert identity already exists.',1;
IF EXISTS (SELECT 1 FROM #repair p JOIN paws.RoleAssignment r ON r.FacultyId=p.facultyId AND r.AcademicYear=@year AND r.RoleType=p.roleType AND r.CourseOrSubjectOrRotation=p.assignment WHERE p.action='insert') THROW 51009,'A separately credited source role already exists.',1;
IF EXISTS (SELECT 1 FROM #repair p WHERE p.action='insert' AND p.parentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM paws.RoleAssignment r WHERE r.RoleAssignmentId=p.parentId AND r.FacultyId=p.facultyId AND r.AcademicYear=@year AND r.RoleType=p.oldType AND r.DoeMappedValue IS NULL AND r.DoeOverrideValue IS NULL)) THROW 51010,'Parent role changed.',1;
DECLARE @before decimal(18,6)=(SELECT SUM(COALESCE(DoeOverrideValue,DoeMappedValue)) FROM paws.RoleAssignment WHERE AcademicYear=@year);
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,CompletedAtUtc,Status,SourceManifestSha256,ImporterVersion,ActorUpn,ValidationSummaryJson)
VALUES(@batch,SYSUTCDATETIME(),NULL,'role-doe-repair-pending',@sha,'role-doe-source-repair-v1',ORIGINAL_LOGIN(),JSON_QUERY(@plan,'$.summary'));
-- Insert children first so the old parent facts and CourseId remain available.
INSERT paws.RoleAssignment(RoleAssignmentId,FacultyId,SourceFacultyName,FacultyResolutionStatus,AcademicYear,RoleCategory,RoleType,CourseId,CourseOrSubjectOrRotation,CourseName,Details,EffectiveDate,ExpirationDate,DoeMappedValue,DoeOverrideValue,DoeOverrideReason,SpecialNotes,SourceImportBatchId,SourceRow)
SELECT p.roleId,p.facultyId,p.sourceName,'source-crosswalk',@year,r.RoleCategory,p.roleType,r.CourseId,
       CASE WHEN p.parentId IS NOT NULL THEN r.CourseOrSubjectOrRotation ELSE p.assignment END,r.CourseName,p.sourceNotes,p.effectiveDate,p.expirationDate,p.doe,NULL,NULL,p.sourceRef+N' | '+COALESCE(p.sourceNotes,N''),@batch,p.sourceRow
FROM #repair p LEFT JOIN paws.RoleAssignment r ON r.RoleAssignmentId=p.parentId WHERE p.action='insert';
DECLARE @inserted int=@@ROWCOUNT;
UPDATE r SET RoleType=p.roleType,SourceFacultyName=p.sourceName,FacultyResolutionStatus='source-crosswalk',DoeMappedValue=p.doe,
             EffectiveDate=p.effectiveDate,ExpirationDate=p.expirationDate,Details=p.sourceNotes,
             SpecialNotes=p.sourceRef+N' | '+COALESCE(p.sourceNotes,N''),SourceImportBatchId=@batch,SourceRow=p.sourceRow
FROM paws.RoleAssignment r JOIN #repair p ON p.roleId=r.RoleAssignmentId WHERE p.action='update';
DECLARE @updated int=@@ROWCOUNT;
IF @updated<>(SELECT COUNT(*) FROM #repair WHERE action='update') OR @inserted<>(SELECT COUNT(*) FROM #repair WHERE action='insert') THROW 51011,'Mutation count mismatch.',1;
IF EXISTS (SELECT 1 FROM #repair p LEFT JOIN paws.RoleAssignment r ON r.RoleAssignmentId=p.roleId WHERE r.RoleAssignmentId IS NULL OR r.DoeMappedValue IS NULL OR r.DoeMappedValue<>p.doe OR r.RoleType IS NULL OR r.RoleType<>p.roleType OR r.FacultyId IS NULL OR r.FacultyId<>p.facultyId) THROW 51012,'Source-to-SQL comparison failed.',1;
DECLARE @after decimal(18,6)=(SELECT SUM(COALESCE(DoeOverrideValue,DoeMappedValue)) FROM paws.RoleAssignment WHERE AcademicYear=@year);
IF ABS(@after-COALESCE(@before,0)-(SELECT SUM(doe) FROM #repair))>0.000001 THROW 51013,'Aggregate DOE delta mismatch.',1;
SELECT @batch AS batchId,@apply AS committed,@updated AS updated,@inserted AS inserted,@before AS beforeRoleDoe,@after AS afterRoleDoe,
       (SELECT COUNT(*) FROM paws.RoleAssignment WHERE AcademicYear=@year) AS afterRoleRows,
       (SELECT COUNT(*) FROM paws.RoleAssignment WHERE AcademicYear=@year AND DoeMappedValue IS NULL AND DoeOverrideValue IS NULL) AS missingRoleDoe,
       (SELECT COUNT(*) FROM #repair WHERE doe=0) AS explicitZeroSourceRows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
IF @apply=1 BEGIN
  UPDATE staging.ImportBatch SET Status='role-doe-repair-complete',CompletedAtUtc=SYSUTCDATETIME() WHERE ImportBatchId=@batch;
  COMMIT;
END ELSE ROLLBACK;
'@
  $reader = $command.ExecuteReader()
  $builder = New-Object System.Text.StringBuilder
  do { while ($reader.Read()) { if ($reader.FieldCount -eq 1) { [void]$builder.Append($reader.GetString(0)) } } } while ($reader.NextResult())
  $reader.Dispose()
  $builder.ToString()
} finally { $connection.Dispose() }
