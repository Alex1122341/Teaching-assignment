'use strict';

function createSqlDoeAssignmentRepository(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('A SQL query adapter is required.');

  return Object.freeze({
    async loadSessionDoeFacts(sessionId) {
      const rows = await db.query(
        `SELECT s.SessionId AS sessionId, s.AcademicYear AS academicYear,
                s.CurriculumYear AS curriculumYear, s.CourseCode AS courseCode,
                s.SessionType AS sessionType, s.Topic AS topic,
                CONVERT(varchar(10),s.SessionDate,23) AS sessionDate,
                CONVERT(varchar(8),s.StartTime,108) AS startTime, CONVERT(varchar(8),s.EndTime,108) AS endTime,
                sa.SessionAssignmentId AS sessionAssignmentId, sa.FacultyId AS facultyId,
                sa.TeachingRole AS teachingRole, sa.CreditedHours AS creditedHours, existing.Revision AS doeRevision
           FROM paws.Session AS s
           LEFT JOIN paws.SessionAssignment AS sa ON sa.SessionId=s.SessionId
           LEFT JOIN paws.DoeAssignmentFact AS existing ON existing.SessionAssignmentId=sa.SessionAssignmentId
          WHERE s.SessionId=@sessionId AND (existing.Active IS NULL OR existing.Active=1)
          ORDER BY sa.SessionAssignmentId`, { sessionId });
      if (!rows.length) return null;
      const { sessionId: id, academicYear, curriculumYear, courseCode, sessionType, topic, sessionDate, startTime, endTime } = rows[0];
      const orphaned = await db.query(
        `SELECT a.AssignmentFactId AS assignmentFactId, a.SessionAssignmentId AS sessionAssignmentId
           FROM paws.DoeAssignmentFact AS a
          WHERE a.SessionId=@sessionId AND a.Active=1 AND a.SessionAssignmentId IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM paws.SessionAssignment AS sa WHERE sa.SessionAssignmentId=a.SessionAssignmentId)`,
        { sessionId }
      );
      return {
        sessionId: id, academicYear, curriculumYear, courseCode, sessionType, topic, sessionDate, startTime, endTime,
        orphanedAssignments: orphaned.map(row => ({ assignmentFactId: row.assignmentFactId, sessionAssignmentId: row.sessionAssignmentId })),
        assignments: rows.filter(row => row.sessionAssignmentId).map(row => ({
          sessionAssignmentId: row.sessionAssignmentId, facultyId: row.facultyId,
          teachingRole: row.teachingRole, creditedHours: row.creditedHours, doeRevision: row.doeRevision
        }))
      };
    },

    async saveSessionDoeCalculations({ rows, actorUid, trigger }) {
      if (!Array.isArray(rows) || !rows.length) return [];
      return db.query(
        `SET XACT_ABORT ON;
         BEGIN TRY
           BEGIN TRANSACTION;
           DECLARE @items TABLE (
             assignmentFactId uniqueidentifier, sessionAssignmentId uniqueidentifier, sessionId uniqueidentifier,
             facultyId uniqueidentifier, academicYear nvarchar(32), category nvarchar(64), roleType nvarchar(128),
             activityType nvarchar(128), scopeText nvarchar(256), courseCode nvarchar(64), sourceEntityType nvarchar(64),
             sourceEntityId nvarchar(128), revision bigint, calculationId uniqueidentifier, policyVersionId uniqueidentifier,
             policyRevision bigint, ruleId uniqueidentifier, ruleKey nvarchar(128), exceptionId uniqueidentifier,
             factsJson nvarchar(max), inputsJson nvarchar(max), parametersJson nvarchar(max), ruleJson nvarchar(max),
             referenceJson nvarchar(max), calculationText nvarchar(2000), resultDoe decimal(12,6),
             calculationStatus nvarchar(24), calculationTrigger nvarchar(64), calculatedBy nvarchar(128), calculatedAt datetime2(7), action nvarchar(64));
           INSERT @items
           SELECT j.assignmentFactId,j.sessionAssignmentId,j.sessionId,j.facultyId,j.academicYear,j.category,j.roleType,
                  j.activityType,j.scopeText,j.courseCode,j.sourceEntityType,j.sourceEntityId,j.revision,j.calculationId,
                  j.policyVersionId,j.policyRevision,j.ruleId,j.ruleKey,j.exceptionId,j.factsJson,j.inputsJson,j.parametersJson,
                  j.ruleJson,j.referenceJson,j.calculationText,j.resultDoe,j.calculationStatus,j.calculationTrigger,j.calculatedBy,j.calculatedAt,
                  CASE WHEN EXISTS(SELECT 1 FROM paws.DoeAssignmentFact AS old WHERE old.SessionAssignmentId=j.sessionAssignmentId)
                       THEN N'doe_assignment_recalculated' ELSE N'doe_assignment_created' END
             FROM OPENJSON(@rowsJson) WITH (
               assignmentFactId uniqueidentifier '$.assignmentFactId', sessionAssignmentId uniqueidentifier '$.sessionAssignmentId',
               sessionId uniqueidentifier '$.sessionId', facultyId uniqueidentifier '$.facultyId', academicYear nvarchar(32) '$.academicYear',
               category nvarchar(64) '$.category', roleType nvarchar(128) '$.roleType', activityType nvarchar(128) '$.activityType',
               scopeText nvarchar(256) '$.scopeText', courseCode nvarchar(64) '$.courseCode', sourceEntityType nvarchar(64) '$.sourceEntityType',
               sourceEntityId nvarchar(128) '$.sourceEntityId', revision bigint '$.revision', calculationId uniqueidentifier '$.calculationId',
               policyVersionId uniqueidentifier '$.policyVersionId', policyRevision bigint '$.policyRevision', ruleId uniqueidentifier '$.ruleId',
               ruleKey nvarchar(128) '$.ruleKey', exceptionId uniqueidentifier '$.exceptionId', factsJson nvarchar(max) '$.factsSnapshot' AS JSON,
               inputsJson nvarchar(max) '$.inputsSnapshot' AS JSON, parametersJson nvarchar(max) '$.parameterSnapshot' AS JSON,
               ruleJson nvarchar(max) '$.ruleSnapshot' AS JSON, referenceJson nvarchar(max) '$.referenceSnapshot' AS JSON,
               calculationText nvarchar(2000) '$.calculationText', resultDoe decimal(12,6) '$.resultDoe',
               calculationStatus nvarchar(24) '$.calculationStatus', calculationTrigger nvarchar(64) '$.calculationTrigger', calculatedBy nvarchar(128) '$.calculatedBy',
               calculatedAt datetime2(7) '$.calculatedAt') AS j;
           IF EXISTS (SELECT 1 FROM @items WHERE policyVersionId IS NULL OR facultyId IS NULL OR assignmentFactId IS NULL
                       OR calculationId IS NULL OR calculationStatus NOT IN(N'calculated',N'needs_review')
                       OR (calculationStatus=N'calculated' AND resultDoe IS NULL)
                       OR (calculationStatus=N'needs_review' AND resultDoe IS NOT NULL))
             THROW 52510, 'DOE_SESSION_CALCULATION_INVALID', 1;
           IF EXISTS (SELECT 1 FROM @items i LEFT JOIN paws.DoePolicyVersion p WITH(UPDLOCK,HOLDLOCK)
                       ON p.PolicyVersionId=i.policyVersionId AND p.AcademicYear=i.academicYear
                      WHERE p.PolicyVersionId IS NULL OR p.Status<>N'active' OR p.Revision<>i.policyRevision)
             THROW 52511, 'DOE_POLICY_CHANGED', 1;

           INSERT paws.DoeCalculationRecord
             (CalculationId,AcademicYear,PolicyVersionId,RuleId,RuleKey,ExceptionId,Category,FacultyId,SessionId,AssignmentId,
              SourceEntityType,SourceEntityId,FactsSnapshotJson,InputsSnapshotJson,ParameterSnapshotJson,RuleSnapshotJson,
              ReferenceSnapshotJson,CalculationText,ResultDoe,CalculationStatus,CalculationTrigger,CalculatedBy,CalculatedAtUtc)
           SELECT calculationId,academicYear,policyVersionId,ruleId,ruleKey,exceptionId,category,facultyId,sessionId,
                  sourceEntityId,sourceEntityType,sourceEntityId,factsJson,inputsJson,parametersJson,ruleJson,referenceJson,
                  calculationText,resultDoe,calculationStatus,calculationTrigger,calculatedBy,calculatedAt FROM @items;

           MERGE paws.DoeAssignmentFact WITH(HOLDLOCK) AS target
           USING @items AS source ON target.SessionAssignmentId=source.sessionAssignmentId
           WHEN MATCHED THEN UPDATE SET Category=source.category,RoleType=source.roleType,ActivityType=source.activityType,
             ScopeText=source.scopeText,CourseCode=source.courseCode,SessionId=source.sessionId,
             CurrentCalculationId=source.calculationId,Revision=source.revision,Active=1,UpdatedBy=@actorUid,UpdatedAtUtc=source.calculatedAt
           WHEN NOT MATCHED THEN INSERT
             (AssignmentFactId,FacultyId,AcademicYear,Category,RoleType,ActivityType,ScopeText,CourseCode,SessionId,SessionAssignmentId,
              SourceEntityType,SourceEntityId,Active,Revision,CurrentCalculationId,CreatedBy,UpdatedBy,CreatedAtUtc,UpdatedAtUtc)
             VALUES(source.assignmentFactId,source.facultyId,source.academicYear,source.category,source.roleType,source.activityType,
              source.scopeText,source.courseCode,source.sessionId,source.sessionAssignmentId,source.sourceEntityType,source.sourceEntityId,
              1,source.revision,source.calculationId,@actorUid,@actorUid,source.calculatedAt,source.calculatedAt);

           INSERT paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,FacultyId,ActorUid,AfterJson,ChangedAtUtc)
           SELECT NEWID(),policyVersionId,academicYear,action,N'doe_assignment',CONVERT(nvarchar(128),assignmentFactId),facultyId,@actorUid,
                  (SELECT assignmentFactId,sessionId,sessionAssignmentId,calculationId,calculationStatus,resultDoe,calculationTrigger AS calculationTrigger FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),calculatedAt
             FROM @items;
           COMMIT TRANSACTION;
           SELECT assignmentFactId,sessionAssignmentId,calculationId,calculationStatus,resultDoe FROM @items;
         END TRY
         BEGIN CATCH
           IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
           THROW;
         END CATCH;`,
        { rowsJson: JSON.stringify(rows), actorUid, trigger }
      );
    },

    async deactivateOrphanedSessionDoeFacts({ assignmentFactIds, actorUid } = {}) {
      const ids = [...new Set((Array.isArray(assignmentFactIds) ? assignmentFactIds : []).map(String).filter(Boolean))];
      if (!ids.length) return [];
      return db.query(
        `SET XACT_ABORT ON;
         BEGIN TRY
           BEGIN TRANSACTION;
           DECLARE @changed TABLE(AssignmentFactId uniqueidentifier,FacultyId uniqueidentifier,AcademicYear nvarchar(32),CurrentCalculationId uniqueidentifier);
           UPDATE a WITH(UPDLOCK,HOLDLOCK)
              SET Active=0,Revision=Revision+1,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME()
             OUTPUT inserted.AssignmentFactId,inserted.FacultyId,inserted.AcademicYear,deleted.CurrentCalculationId
               INTO @changed
             FROM paws.DoeAssignmentFact AS a
            WHERE a.Active=1 AND a.SessionAssignmentId IS NOT NULL
              AND a.AssignmentFactId IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@idsJson));
           INSERT paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,FacultyId,ActorUid,AfterJson)
           SELECT NEWID(),c.PolicyVersionId,changed.AcademicYear,N'doe_assignment_deactivated',N'doe_assignment',CONVERT(nvarchar(128),changed.AssignmentFactId),changed.FacultyId,@actorUid,
                  (SELECT N'session_assignment_removed' AS reason,changed.CurrentCalculationId AS preservedCalculationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
             FROM @changed AS changed LEFT JOIN paws.DoeCalculationRecord AS c ON c.CalculationId=changed.CurrentCalculationId;
           COMMIT TRANSACTION;
           SELECT AssignmentFactId AS assignmentFactId FROM @changed;
         END TRY
         BEGIN CATCH
           IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
           THROW;
         END CATCH;`,
        { idsJson: JSON.stringify(ids), actorUid }
      );
    },

    async saveDoeAssignment({ assignment, calculation, auditRecord, expectedRevision }) {
      const params = {
        assignmentFactId: assignment.assignmentFactId, facultyId: assignment.facultyId, academicYear: assignment.academicYear,
        category: assignment.category, roleType: assignment.roleType, activityType: assignment.activityType,
        scopeText: assignment.scopeText, courseCode: assignment.courseCode, subjectKey: assignment.subjectKey,
        sessionId: assignment.sessionId, sourceEntityType: assignment.sourceEntityType, sourceEntityId: assignment.sourceEntityId,
        notes: assignment.notes, revision: assignment.revision, expectedRevision,
        createdBy: assignment.createdBy, updatedBy: assignment.updatedBy,
        calculationId: calculation.calculationId, policyVersionId: calculation.policyVersionId, policyRevision: calculation.policyRevision,
        ruleId: calculation.ruleId, ruleKey: calculation.ruleKey, exceptionId: calculation.exceptionId,
        calculationCategory: calculation.category, assignmentId: calculation.assignmentId,
        factsJson: JSON.stringify(calculation.factsSnapshot), inputsJson: JSON.stringify(calculation.inputsSnapshot),
        parametersJson: JSON.stringify(calculation.parameterSnapshot), ruleJson: JSON.stringify(calculation.ruleSnapshot),
        referenceJson: calculation.referenceSnapshot ? JSON.stringify(calculation.referenceSnapshot) : null,
        calculationText: calculation.calculationText, resultDoe: calculation.resultDoe, calculationStatus: calculation.status,
        calculationTrigger: calculation.calculationTrigger, calculatedBy: calculation.calculatedBy, calculatedAt: calculation.calculatedAt,
        assignmentInputsJson: JSON.stringify(assignment.inputs || {}),
        auditEventId: auditRecord.auditEventId, auditAction: auditRecord.action,
        auditAfterJson: JSON.stringify(auditRecord.after), changedAt: auditRecord.changedAt
      };
      const rows = await db.query(
        `SET XACT_ABORT ON;
         BEGIN TRY
           BEGIN TRANSACTION;
           DECLARE @beforeJson nvarchar(max)=NULL;
           IF NOT EXISTS (
             SELECT 1 FROM paws.DoePolicyVersion WITH (UPDLOCK,HOLDLOCK)
              WHERE PolicyVersionId=@policyVersionId AND AcademicYear=@academicYear AND Status=N'active' AND Revision=@policyRevision
           ) THROW 51031, 'DOE_POLICY_CHANGED', 1;

           IF NOT EXISTS (
             SELECT 1 FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK)
              WHERE FacultyId=@facultyId
           ) THROW 51032, 'FACULTY_NOT_FOUND', 1;

           IF @expectedRevision>0
             SELECT @beforeJson=(SELECT AssignmentFactId AS assignmentFactId,Category AS category,RoleType AS roleType,
                                        ScopeText AS scopeText,CourseCode AS courseCode,SubjectKey AS subjectKey,Notes AS notes,
                                        Revision AS revision,CurrentCalculationId AS calculationId
                                   FROM paws.DoeAssignmentFact WITH (UPDLOCK,HOLDLOCK)
                                  WHERE AssignmentFactId=@assignmentFactId AND FacultyId=@facultyId AND AcademicYear=@academicYear AND Active=1
                                  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
           IF @expectedRevision>0 AND @beforeJson IS NULL THROW 51034, 'DOE_ASSIGNMENT_NOT_FOUND', 1;

           INSERT INTO paws.DoeCalculationRecord
             (CalculationId,AcademicYear,PolicyVersionId,RuleId,RuleKey,ExceptionId,Category,FacultyId,SessionId,AssignmentId,
              SourceEntityType,SourceEntityId,FactsSnapshotJson,InputsSnapshotJson,ParameterSnapshotJson,RuleSnapshotJson,
              ReferenceSnapshotJson,CalculationText,ResultDoe,CalculationStatus,CalculationTrigger,CalculatedBy,CalculatedAtUtc)
           VALUES
             (@calculationId,@academicYear,@policyVersionId,@ruleId,@ruleKey,@exceptionId,@calculationCategory,@facultyId,@sessionId,@assignmentId,
              N'doe_assignment',CONVERT(nvarchar(128),@assignmentFactId),@factsJson,@inputsJson,@parametersJson,@ruleJson,
              @referenceJson,@calculationText,@resultDoe,@calculationStatus,@calculationTrigger,@calculatedBy,@calculatedAt);

           IF @expectedRevision=0
           BEGIN
             INSERT INTO paws.DoeAssignmentFact
               (AssignmentFactId,FacultyId,AcademicYear,Category,RoleType,ActivityType,ScopeText,CourseCode,SubjectKey,SessionId,
                SourceEntityType,SourceEntityId,Notes,Active,Revision,CurrentCalculationId,CreatedBy,UpdatedBy)
             VALUES
               (@assignmentFactId,@facultyId,@academicYear,@category,@roleType,@activityType,@scopeText,@courseCode,@subjectKey,@sessionId,
                @sourceEntityType,CONVERT(nvarchar(128),@assignmentFactId),@notes,1,@revision,@calculationId,@createdBy,@updatedBy);
           END
           ELSE
           BEGIN
             UPDATE paws.DoeAssignmentFact
                SET Category=@category,RoleType=@roleType,ActivityType=@activityType,ScopeText=@scopeText,
                    CourseCode=@courseCode,SubjectKey=@subjectKey,SessionId=@sessionId,Notes=@notes,
                    Revision=@revision,CurrentCalculationId=@calculationId,UpdatedBy=@updatedBy,UpdatedAtUtc=@calculatedAt
              WHERE AssignmentFactId=@assignmentFactId AND FacultyId=@facultyId AND AcademicYear=@academicYear
                AND Active=1 AND Revision=@expectedRevision;
             IF @@ROWCOUNT<>1 THROW 51033, 'DOE_ASSIGNMENT_REVISION_CONFLICT', 1;
           END;

           DELETE FROM paws.DoeAssignmentFactInput WHERE AssignmentFactId=@assignmentFactId;
           IF ISJSON(@assignmentInputsJson)=1
           BEGIN
             INSERT INTO paws.DoeAssignmentFactInput
               (AssignmentFactInputId,AssignmentFactId,InputName,ValueType,ValueText,ValueNumber)
             SELECT NEWID(),@assignmentFactId,[key],
                    CASE WHEN [type]=1 THEN N'text' WHEN [type]=3 THEN N'boolean' ELSE N'number' END,
                    CASE WHEN [type]=1 THEN [value] WHEN [type]=3 THEN [value] END,
                    CASE WHEN [type]=2 THEN TRY_CONVERT(decimal(18,6),[value]) END
               FROM OPENJSON(@assignmentInputsJson);
           END;

           INSERT INTO paws.DoeAuditEvent
             (AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,FacultyId,ActorUid,BeforeJson,AfterJson,ChangedAtUtc)
           VALUES
             (@auditEventId,@policyVersionId,@academicYear,@auditAction,N'doe_assignment',CONVERT(nvarchar(128),@assignmentFactId),
              @facultyId,@updatedBy,@beforeJson,@auditAfterJson,@changedAt);

           COMMIT TRANSACTION;
           SELECT CONVERT(nvarchar(36),@assignmentFactId) AS assignmentFactId,@revision AS revision;
         END TRY
         BEGIN CATCH
           IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
           THROW;
         END CATCH;`, params);
      return rows[0] || { assignmentFactId: assignment.assignmentFactId, revision: assignment.revision };
    },

    async deactivateDoeAssignment({ actorUid, facultyId, academicYear, assignmentFactId, expectedRevision, reason }) {
      const rows = await db.query(
        `SET XACT_ABORT ON;
         BEGIN TRY
           BEGIN TRANSACTION;
           DECLARE @policyVersionId uniqueidentifier=NULL,@beforeJson nvarchar(max);
           SELECT TOP (1) @policyVersionId=PolicyVersionId FROM paws.DoePolicyVersion WITH (HOLDLOCK)
            WHERE AcademicYear=@academicYear AND Status=N'active';
           SELECT @beforeJson=(SELECT AssignmentFactId AS assignmentFactId,FacultyId AS facultyId,Category AS category,
                                      RoleType AS roleType,ScopeText AS scopeText,Revision AS revision,CurrentCalculationId AS calculationId
                                 FROM paws.DoeAssignmentFact WITH (UPDLOCK,HOLDLOCK)
                                WHERE AssignmentFactId=@assignmentFactId AND FacultyId=@facultyId AND AcademicYear=@academicYear AND Active=1
                                FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
           IF @beforeJson IS NULL THROW 51034, 'DOE_ASSIGNMENT_NOT_FOUND', 1;
           UPDATE paws.DoeAssignmentFact SET Active=0,Revision=Revision+1,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME(),Notes=COALESCE(NULLIF(@reason,N''),Notes)
            WHERE AssignmentFactId=@assignmentFactId AND FacultyId=@facultyId AND AcademicYear=@academicYear AND Active=1 AND Revision=@expectedRevision;
           IF @@ROWCOUNT<>1 THROW 51033, 'DOE_ASSIGNMENT_REVISION_CONFLICT', 1;
           INSERT INTO paws.DoeAuditEvent
             (AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,FacultyId,ActorUid,BeforeJson,AfterJson)
           VALUES (NEWID(),@policyVersionId,@academicYear,N'doe_assignment_deactivated',N'doe_assignment',CONVERT(nvarchar(128),@assignmentFactId),
                   @facultyId,@actorUid,@beforeJson,(SELECT N'deactivated' AS status,@reason AS reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
           COMMIT TRANSACTION;
           SELECT CONVERT(nvarchar(36),@assignmentFactId) AS assignmentFactId,CONVERT(bit,0) AS active,@expectedRevision+1 AS revision;
         END TRY
         BEGIN CATCH
           IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
           THROW;
         END CATCH;`, { actorUid, facultyId, academicYear, assignmentFactId, expectedRevision, reason });
      return rows[0] || { assignmentFactId, active: false, revision: expectedRevision + 1 };
    }
  });
}

module.exports = { createSqlDoeAssignmentRepository };
