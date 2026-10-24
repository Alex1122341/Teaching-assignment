'use strict';

const SUBMIT_PROCEDURE = 'paws_api.SubmitAfcRequest';
const WITHDRAW_PROCEDURE = 'paws_api.WithdrawAfcRequest';

function createSqlAfcRequestRepository(db) {
  return {
    async listRequests({ actorFirebaseUid, administrator = false } = {}) {
      return db.query(
        `SELECT
           ar.AfcRequestId AS afcRequestId,
           ar.FacultyId AS facultyId,
           ar.FacultyName AS facultyName,
           ar.RequesterFirebaseUid AS requesterFirebaseUid,
           ar.ReportToFirebaseUid AS reportToFirebaseUid,
           ar.Status AS status,
           CONVERT(varchar(10), ar.StartDate, 23) AS startDate,
           CONVERT(varchar(10), ar.EndDate, 23) AS endDate,
           ar.WorkDays AS workDays,
           ar.Reason AS reason,
           ar.PurposeDestination AS purposeDestination,
           ar.Coverage AS coverage,
           ar.SubmittedAtUtc AS submittedAtUtc,
           ar.UpdatedAtUtc AS updatedAtUtc
         FROM paws.AfcRequest AS ar
         WHERE @administrator = 1
            OR ar.RequesterFirebaseUid = @actorFirebaseUid
            OR ar.ReportToFirebaseUid = @actorFirebaseUid
         ORDER BY ar.SubmittedAtUtc DESC, ar.AfcRequestId`,
        { actorFirebaseUid, administrator: administrator ? 1 : 0 }
      );
    },

    async submitRequest(input = {}) {
      const rows = await db.query(
        `EXEC ${SUBMIT_PROCEDURE}
          @AfcRequestId = @afcRequestId,
          @StartDate = @startDate,
          @EndDate = @endDate,
          @WorkDays = @workDays,
          @Reason = @reason,
          @PurposeDestination = @purposeDestination,
          @Coverage = @coverage,
          @ContactAddress = @contactAddress,
          @ContactPhone = @contactPhone,
          @TermsVersion = @termsVersion,
          @TermsSource = @termsSource,
          @SignatureMode = @signatureMode,
          @SignatureName = @signatureName,
          @SignatureSignedAt = @signatureSignedAt,
          @SignatureFingerprint = @signatureFingerprint,
          @SignatureImageDataUrl = @signatureImageDataUrl,
          @ActorFirebaseUid = @actorFirebaseUid`,
        input
      );
      return rows[0] || null;
    },

    async withdrawRequest({ afcRequestId, actorFirebaseUid, auditRequestId } = {}) {
      const rows = await db.query(
        `EXEC ${WITHDRAW_PROCEDURE}
          @AfcRequestId = @afcRequestId,
          @ActorFirebaseUid = @actorFirebaseUid,
          @AuditRequestId = @auditRequestId`,
        { afcRequestId, actorFirebaseUid, auditRequestId }
      );
      return rows[0] || null;
    }
  };
}

module.exports = {
  createSqlAfcRequestRepository,
  SUBMIT_PROCEDURE,
  WITHDRAW_PROCEDURE
};
