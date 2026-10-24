param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
# The shared reset helper accepts only a labeled local synthetic Docker container.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041' -SkipAcceptance
foreach($file in @('045_calendar_away_classification.sql','046_calendar_commit_preflight.sql','047_change_history.sql','048_afc_form_upload.sql','049_ccc_full_replacement.sql','050_afc_record_documents.sql','051_record_document_history.sql','052_master_source_refresh.sql','053_ccc_master_slots.sql','054_trainee_source_evidence.sql','055_trainee_empty_results.sql')){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'
}
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'server/test/fixtures/faculty-availability.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/056_faculty_availability_read.sql') -Raw) 'VetMed-Ops'
node (Join-Path $PSScriptRoot 'test-faculty-availability-integration.cjs')
if($LASTEXITCODE -ne 0){throw 'Actual Node / SQL availability integration failed.'}
# Node rehearses edited-definition refusal and actual hash-bound rollback.
Invoke-TestSql "IF OBJECT_ID(N'paws_api.ListFacultyAvailability') IS NOT NULL OR (SELECT COUNT(*) FROM paws.Session WHERE CourseCode=N'AVAIL')<>64 THROW 55690,'Availability rollback changed business data.',1; PRINT 'FACULTY_AVAILABILITY_ROLLBACK_OK';" 'VetMed-Ops'
