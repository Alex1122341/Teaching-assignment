param([Parameter(Mandatory=$true)][string]$ContainerName,[switch]$CheckRollback)
$ErrorActionPreference='Stop'
$taskRollbackRequested=[bool]$CheckRollback
# The shared runner checks local transport and the synthetic label before any reset.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/042_adfa_swap_preview.sql') -Raw) 'VetMed-Ops'
$migrationPath=Join-Path $repoPath 'database/azure-sql/043_scheduling_tasks.sql'
if(Test-Path -LiteralPath $migrationPath){Invoke-TestSql (Get-Content -LiteralPath $migrationPath -Raw) 'VetMed-Ops'}
$taskFailures=@()
foreach($taskAcceptance in @('043_scheduling_tasks_acceptance.sql','043_scheduling_tasks_review_acceptance.sql','043_scheduling_tasks_recreation_acceptance.sql')){
 try{Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath "database/azure-sql/$taskAcceptance") -Raw) 'VetMed-Ops'}
 catch{$taskFailures+=$taskAcceptance;Write-Output "SCHEDULING_TASK_ACCEPTANCE_FAILED $taskAcceptance"}
}
if($taskFailures.Count){throw ('DISPOSABLE_SQL_ACCEPTANCE_FAILED: '+($taskFailures -join ', '))}
if($taskRollbackRequested){
 $rollbackPath=Join-Path $repoPath 'database/azure-sql/rollback_043_scheduling_tasks.sql'
 if(-not(Test-Path -LiteralPath $rollbackPath)){throw 'SCHEDULING_TASK_ROLLBACK_MISSING'}
 $rollbackText=(Get-Content -LiteralPath $rollbackPath -Raw).Replace("`r`n","`n")
 $rollbackText=[regex]::Replace($rollbackText,'(?m)^:[^\r\n]+\r?\n','')
 $guardBatch=($rollbackText -split '(?m)^GO[ \t]*$')[0]
 $guardLiteral=$guardBatch.Replace("'","''")
 $guardTest="DECLARE @Rejected bit=0;BEGIN TRY EXEC(N'$guardLiteral');END TRY BEGIN CATCH DECLARE @Error int=ERROR_NUMBER();IF XACT_STATE()<>0 ROLLBACK;IF @Error=54308 SET @Rejected=1;ELSE THROW;END CATCH;IF XACT_STATE()<>0 ROLLBACK;IF @Rejected=0 THROW 54390,'Unsafe rollback was accepted.',1;"
 Invoke-TestSql "INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,OccurredAtUtc) VALUES(NEWID(),N'SchedulingTaskReviewed',N'SchedulingTask',N'synthetic-rollback',SYSUTCDATETIME());" 'VetMed-Ops'
 Invoke-TestSql $guardTest 'VetMed-Ops'
 Invoke-TestSql "DELETE paws.AuditEvent WHERE EventType=N'SchedulingTaskReviewed' AND EntityId=N'synthetic-rollback';CREATE USER task_rollback_bound WITHOUT LOGIN;ALTER ROLE paws_scheduling_task_review ADD MEMBER task_rollback_bound;" 'VetMed-Ops'
 Invoke-TestSql $guardTest 'VetMed-Ops'
 Invoke-TestSql 'ALTER ROLE paws_scheduling_task_review DROP MEMBER task_rollback_bound;DROP USER task_rollback_bound;' 'VetMed-Ops'
 Invoke-TestSql "INSERT paws.SchedulingTaskReview(IssueKey,EvidenceVersion,ReviewStatus,ActorFirebaseUid) VALUES(REPLICATE('A',64),REPLICATE('B',64),N'Reviewed',N'synthetic-rollback');" 'VetMed-Ops'
 Invoke-TestSql $guardTest 'VetMed-Ops'
 Invoke-TestSql "DELETE paws.SchedulingTaskReview WHERE ActorFirebaseUid=N'synthetic-rollback';" 'VetMed-Ops'
 Invoke-TestSql (Get-Content -LiteralPath $rollbackPath -Raw) 'VetMed-Ops'
 Invoke-TestSql "IF OBJECT_ID(N'paws_api.SchedulingTaskIssues') IS NOT NULL OR OBJECT_ID(N'paws_api.ListSchedulingTasks') IS NOT NULL OR COL_LENGTH(N'paws.Session',N'SchedulingVersion') IS NOT NULL OR COL_LENGTH(N'paws.SessionAssignment',N'SchedulingVersion') IS NOT NULL OR OBJECT_ID(N'paws.SchedulingAssignmentRevision') IS NOT NULL OR OBJECT_ID(N'paws.SchedulingAssignmentChanged') IS NOT NULL THROW 54390,'Rollback left scheduling objects.',1;PRINT 'SCHEDULING_TASK_ROLLBACK_OK';" 'VetMed-Ops'
}
