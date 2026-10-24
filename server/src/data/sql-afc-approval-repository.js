'use strict';

const RECOMMEND_PROCEDURE = 'paws_api.RecommendAfcRequest';
const REJECT_PROCEDURE = 'paws_api.RejectAfcRequest';
const APPROVE_PROCEDURE = 'paws_api.ApproveAfcRequest';

function createSqlAfcApprovalRepository(db) {
  const decisionParams = input => ({
    afcRequestId: input.afcRequestId,
    approvalId: input.approvalId,
    signatureMode: input.signatureMode,
    signatureName: input.signatureName,
    signatureSignedAt: input.signatureSignedAt,
    signatureFingerprint: input.signatureFingerprint,
    signatureImageDataUrl: input.signatureImageDataUrl,
    actorFirebaseUid: input.actorFirebaseUid
  });

  return {
    async recommendRequest(input = {}) {
      const rows = await db.query(
        `EXEC ${RECOMMEND_PROCEDURE}
          @AfcRequestId = @afcRequestId,
          @ApprovalId = @approvalId,
          @SignatureMode = @signatureMode,
          @SignatureName = @signatureName,
          @SignatureSignedAt = @signatureSignedAt,
          @SignatureFingerprint = @signatureFingerprint,
          @SignatureImageDataUrl = @signatureImageDataUrl,
          @ActorFirebaseUid = @actorFirebaseUid`,
        decisionParams(input)
      );
      return rows[0] || null;
    },

    async rejectRequest(input = {}) {
      const rows = await db.query(
        `EXEC ${REJECT_PROCEDURE}
          @AfcRequestId = @afcRequestId,
          @ApprovalId = @approvalId,
          @RejectionReason = @rejectionReason,
          @SignatureMode = @signatureMode,
          @SignatureName = @signatureName,
          @SignatureSignedAt = @signatureSignedAt,
          @SignatureFingerprint = @signatureFingerprint,
          @SignatureImageDataUrl = @signatureImageDataUrl,
          @ActorFirebaseUid = @actorFirebaseUid`,
        { ...decisionParams(input), rejectionReason: input.rejectionReason }
      );
      return rows[0] || null;
    },

    async approveRequest(input = {}) {
      const rows = await db.query(
        `EXEC ${APPROVE_PROCEDURE}
          @AfcRequestId = @afcRequestId,
          @ApprovalId = @approvalId,
          @SignatureMode = @signatureMode,
          @SignatureName = @signatureName,
          @SignatureSignedAt = @signatureSignedAt,
          @SignatureFingerprint = @signatureFingerprint,
          @SignatureImageDataUrl = @signatureImageDataUrl,
          @ActorFirebaseUid = @actorFirebaseUid`,
        decisionParams(input)
      );
      return rows[0] || null;
    }
  };
}

module.exports = {
  createSqlAfcApprovalRepository,
  RECOMMEND_PROCEDURE,
  REJECT_PROCEDURE,
  APPROVE_PROCEDURE
};
