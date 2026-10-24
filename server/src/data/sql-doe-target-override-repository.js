'use strict';

function createSqlDoeTargetOverrideRepository(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('A SQL query adapter is required.');

  return Object.freeze({
    async getFacultyTargetSource(facultyId, academicYear) {
      const rows = await db.query(
        `SELECT f.FacultyId AS facultyId, t.DoeFacultyTargetId AS doeFacultyTargetId,
                t.AcademicYear AS academicYear, t.ContractTeachingDoe AS contractTeachingDoe,
                t.OverrideDoe AS overrideDoe, t.OverrideReason AS overrideReason, t.OverrideNotes AS overrideNotes,
                t.EffectiveTargetDoe AS effectiveTargetDoe, t.Source AS source, t.PolicyVersionId AS policyVersionId
           FROM paws.Faculty AS f
           LEFT JOIN paws.DoeFacultyTarget AS t ON t.FacultyId=f.FacultyId AND t.AcademicYear=@academicYear AND t.Active=1
          WHERE f.FacultyId=@facultyId`, { facultyId, academicYear }
      );
      return rows[0] || null;
    },

    async saveFacultyTargetOverride({ target, auditRecord }) {
      const params = {
        facultyId: target.facultyId, academicYear: target.academicYear,
        contractTeachingDoe: target.contractTeachingDoe, overrideDoe: target.overrideDoe,
        overrideReason: target.overrideReason, overrideNotes: target.overrideNotes,
        source: target.source, policyVersionId: target.policyVersionId, updatedBy: target.updatedBy,
        auditEventId: auditRecord.auditEventId, auditAction: auditRecord.action,
        auditEntityId: auditRecord.entityId, actorUid: auditRecord.actorUid,
        auditBeforeJson: JSON.stringify(auditRecord.before), auditAfterJson: JSON.stringify(auditRecord.after)
      };
      const rows = await db.query(
        `SET XACT_ABORT ON;
         BEGIN TRY
           BEGIN TRANSACTION;
           IF NOT EXISTS (SELECT 1 FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK) WHERE FacultyId=@facultyId)
             THROW 51041, 'FACULTY_NOT_FOUND', 1;
           DECLARE @beforeJson nvarchar(max),@targetId uniqueidentifier;
           SELECT TOP (1) @targetId=DoeFacultyTargetId,
                          @beforeJson=(SELECT DoeFacultyTargetId AS targetId,ContractTeachingDoe AS contractTeachingDoe,
                                              OverrideDoe AS overrideDoe,OverrideReason AS overrideReason,OverrideNotes AS overrideNotes
                                         FROM paws.DoeFacultyTarget WITH (UPDLOCK,HOLDLOCK)
                                        WHERE FacultyId=@facultyId AND AcademicYear=@academicYear AND Active=1
                                        FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
             FROM paws.DoeFacultyTarget WITH (UPDLOCK,HOLDLOCK)
            WHERE FacultyId=@facultyId AND AcademicYear=@academicYear AND Active=1;

           IF @targetId IS NULL
           BEGIN
             SET @targetId=NEWID();
             INSERT INTO paws.DoeFacultyTarget
               (DoeFacultyTargetId,FacultyId,AcademicYear,ContractTeachingDoe,OverrideDoe,OverrideReason,OverrideNotes,Source,PolicyVersionId,Active,UpdatedBy)
             VALUES (@targetId,@facultyId,@academicYear,@contractTeachingDoe,@overrideDoe,@overrideReason,@overrideNotes,@source,@policyVersionId,1,@updatedBy);
           END
           ELSE
           BEGIN
             UPDATE paws.DoeFacultyTarget
                SET OverrideDoe=@overrideDoe,OverrideReason=@overrideReason,OverrideNotes=@overrideNotes,
                    Source=@source,PolicyVersionId=@policyVersionId,UpdatedBy=@updatedBy,UpdatedAtUtc=SYSUTCDATETIME()
              WHERE DoeFacultyTargetId=@targetId AND Active=1;
           END;

           INSERT INTO paws.DoeAuditEvent
             (AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,FacultyId,ActorUid,BeforeJson,AfterJson)
           VALUES (@auditEventId,@policyVersionId,@academicYear,@auditAction,N'faculty_doe_target',CONVERT(nvarchar(128),@targetId),
                   @facultyId,@actorUid,@beforeJson,@auditAfterJson);
           COMMIT TRANSACTION;
           SELECT CONVERT(nvarchar(36),t.DoeFacultyTargetId) AS doeFacultyTargetId,
                  CONVERT(nvarchar(36),t.FacultyId) AS facultyId,t.AcademicYear AS academicYear,
                  t.ContractTeachingDoe AS contractTeachingDoe,t.OverrideDoe AS overrideDoe,
                  t.OverrideReason AS overrideReason,t.OverrideNotes AS overrideNotes,
                  t.EffectiveTargetDoe AS effectiveTargetDoe,t.PolicyVersionId AS policyVersionId,t.UpdatedBy AS updatedBy
             FROM paws.DoeFacultyTarget AS t WHERE t.DoeFacultyTargetId=@targetId;
         END TRY
         BEGIN CATCH
           IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
           THROW;
         END CATCH;`, params);
      return rows[0] || { ...target, doeFacultyTargetId: auditRecord.entityId };
    }
  });
}

module.exports = { createSqlDoeTargetOverrideRepository };
