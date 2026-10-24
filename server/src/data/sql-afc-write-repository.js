'use strict';

// B1: the only SQL business write in this module is the reviewed, hard-coded
// stored procedure. No caller-controlled SQL, table DML, or generic mutation
// helper belongs on the Dashboard path.

const CREATE_AFC_PROCEDURE = 'paws_api.CreateAfcRecord';
const CREATE_AFC_BATCH_PROCEDURE = 'paws_api.CreateAfcManualBatch';

function createSqlAfcWriteRepository(db) {
  return {
    async cancelAfcRecord({ afcRecordId, sourceKind, expectedVersion, actorFirebaseUid, actorName = null, requestId } = {}) {
      const rows = await db.query(`EXEC paws_api.CancelAfcRecord
        @AfcRecordId = @afcRecordId, @SourceKind = @sourceKind,
        @ExpectedVersion = @expectedVersion, @ActorFirebaseUid = @actorFirebaseUid,
        @ActorName = @actorName, @RequestId = @requestId`,
      { afcRecordId, sourceKind, expectedVersion, actorFirebaseUid, actorName, requestId });
      return rows[0] || null;
    },
    async createAfcRecord({
      afcRecordId,
      facultyId,
      startDate,
      endDate,
      reasonCode,
      notes = null,
      actorFirebaseUid,
      actorName = null,
      requestId,
      documentId = null
    } = {}) {
      const rows = await db.query(
        `EXEC ${documentId?'paws_api.CreateAfcRecordWithDocument':CREATE_AFC_PROCEDURE}
          @AfcRecordId = @afcRecordId,
          @FacultyId = @facultyId,
          @StartDate = @startDate,
          @EndDate = @endDate,
          @ReasonCode = @reasonCode,
          @Notes = @notes,
          @ActorFirebaseUid = @actorFirebaseUid,
          @ActorName = @actorName,
          @RequestId = @requestId${documentId?', @DocumentId = @documentId':''}`,
        {
          afcRecordId,
          facultyId,
          startDate,
          endDate,
          reasonCode,
          notes,
          actorFirebaseUid,
          actorName,
          requestId,
          ...(documentId?{documentId}:{})
        }
      );
      return rows[0] || null;
    },

    async createAfcManualBatch({ requestId, rows: inputRows, actorFirebaseUid, actorName = null } = {}) {
      const rowsJson = JSON.stringify((inputRows || []).map(row => ({
        rowIndex: row.rowIndex,
        facultyId: row.facultyId,
        startDate: row.startDate,
        endDate: row.endDate,
        purpose: row.purpose
      })));
      const rows = await db.query(
        `EXEC ${CREATE_AFC_BATCH_PROCEDURE}
          @RequestId = @requestId,
          @RowsJson = @rowsJson,
          @ActorFirebaseUid = @actorFirebaseUid,
          @ActorName = @actorName`,
        { requestId, rowsJson, actorFirebaseUid, actorName }
      );
      const batchStatus = rows[0] && rows[0].batchStatus ? rows[0].batchStatus : 'CREATED';
      return {
        status: batchStatus,
        rows: rows.map(row => ({
          rowIndex: Number(row.rowIndex),
          afcRecordId: row.afcRecordId,
          facultyId: row.facultyId,
          startDate: row.startDate,
          endDate: row.endDate,
          purpose: row.purpose,
          status: row.rowStatus || batchStatus
        }))
      };
    }
  };
}

module.exports = { createSqlAfcWriteRepository, CREATE_AFC_PROCEDURE, CREATE_AFC_BATCH_PROCEDURE };
