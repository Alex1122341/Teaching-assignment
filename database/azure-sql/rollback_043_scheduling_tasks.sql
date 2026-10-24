/* Empty, unbound candidate only. Retain all populated deployments and audit history. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 54308,'Scheduling rollback requires VetMed-Ops.',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'paws.SchedulingTaskReview',N'U') IS NULL OR OBJECT_ID(N'paws_api.ListSchedulingTasks',N'P') IS NULL
 OR OBJECT_ID(N'paws_api.ReviewSchedulingTask',N'P') IS NULL OR OBJECT_ID(N'paws_api.SchedulingTaskIssues',N'IF') IS NULL
 OR COL_LENGTH(N'paws.Session',N'SchedulingVersion') IS NULL OR COL_LENGTH(N'paws.SessionAssignment',N'SchedulingVersion') IS NULL
 OR OBJECT_ID(N'paws.SchedulingAssignmentRevision',N'U') IS NULL OR OBJECT_ID(N'paws.SchedulingAssignmentChanged',N'TR') IS NULL
 THROW 54308,'Inspect the incomplete scheduling migration before rollback.',1;
IF EXISTS(SELECT 1 FROM paws.SchedulingTaskReview)
 OR EXISTS(SELECT 1 FROM paws.AuditEvent WHERE EventType=N'SchedulingTaskReviewed')
 OR EXISTS(SELECT 1 FROM sys.database_role_members WHERE role_principal_id=DATABASE_PRINCIPAL_ID(N'paws_scheduling_task_review'))
 THROW 54308,'Populated or bound scheduling rollback is refused; preserve history and repair forward.',1;
IF EXISTS(SELECT 1 FROM sys.database_permissions WHERE grantee_principal_id=DATABASE_PRINCIPAL_ID(N'paws_scheduling_task_review')
 AND (class<>1 OR major_id<>OBJECT_ID(N'paws_api.ReviewSchedulingTask') OR permission_name<>N'EXECUTE' OR state<>N'G'))
 THROW 54308,'Inspect additional scheduling role permissions before rollback.',1;
GO
DROP PROCEDURE paws_api.ReviewSchedulingTask;
DROP PROCEDURE paws_api.ListSchedulingTasks;
DROP FUNCTION paws_api.SchedulingTaskIssues;
DROP TABLE paws.SchedulingTaskReview;
DROP TRIGGER paws.SchedulingAssignmentChanged;
DROP TABLE paws.SchedulingAssignmentRevision;
ALTER TABLE paws.Session DROP COLUMN SchedulingVersion;
ALTER TABLE paws.SessionAssignment DROP COLUMN SchedulingVersion;
DROP ROLE paws_scheduling_task_review;
COMMIT;
