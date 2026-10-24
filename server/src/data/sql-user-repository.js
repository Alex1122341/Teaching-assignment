'use strict';

function createSqlUserRepository(db) {
  return {
    async findByUid(uid, timing) {
      const rows = await db.query(
        `SELECT FirebaseUid AS firebaseUid,
                Email AS email,
                DisplayName AS displayName,
                BaseRole AS baseRole,
                FacultyId AS facultyId,
                Active AS active,
                MustChangePassword AS mustChangePassword
         FROM paws.UserProfile
         WHERE FirebaseUid = @uid`,
        { uid },
        { timing, queryMetric: 'sql_user_query' }
      );
      return rows[0] || null;
    }
  };
}

module.exports = { createSqlUserRepository };
