'use strict';

const { resolveAcademicYear } = require('./academic-year');

const DOE_TARGET_LIMIT = 500;
const toText = value => (value === null || value === undefined ? '' : String(value).trim());
const toNullableText = value => (value === null || value === undefined ? null : String(value).trim());
const toNumber = value => (value === null || value === undefined ? null : Number(value));
const toBoolean = value => value === true || value === 1 || value === '1';
const toUtcIso = value => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? toText(value) : date.toISOString();
};

function createSqlDoeTargetRepository(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('A SQL query adapter is required.');

  return {
    async doeTargets({ academicYear: year } = {}) {
      const academicYear = resolveAcademicYear(year);
      const rows = await db.query(
        `SELECT TOP (@limit)
             t.DoeFacultyTargetId AS doeFacultyTargetId,
             t.FacultyId AS facultyId,
             t.AcademicYear AS academicYear,
             t.ContractTeachingDoe AS contractTeachingDoe,
             t.OverrideDoe AS overrideDoe,
             t.EffectiveTargetDoe AS effectiveTargetDoe,
             t.OverrideReason AS overrideReason,
             t.OverrideNotes AS overrideNotes,
             t.Source AS source,
             t.PolicyVersionId AS policyVersionId,
             t.Active AS active,
             t.UpdatedAtUtc AS updatedAtUtc
         FROM paws.DoeFacultyTarget AS t
         WHERE t.AcademicYear = @academicYear
           AND t.Active = 1
         ORDER BY t.FacultyId, t.DoeFacultyTargetId`,
        { academicYear, limit: DOE_TARGET_LIMIT }
      );
      return rows.map(row => ({
        doeFacultyTargetId: toText(row.doeFacultyTargetId),
        facultyId: toText(row.facultyId),
        academicYear: toText(row.academicYear),
        contractTeachingDoe: toNumber(row.contractTeachingDoe),
        overrideDoe: toNumber(row.overrideDoe),
        effectiveTargetDoe: toNumber(row.effectiveTargetDoe),
        overrideReason: toNullableText(row.overrideReason),
        overrideNotes: toNullableText(row.overrideNotes),
        source: toNullableText(row.source),
        policyVersionId: toNullableText(row.policyVersionId),
        active: toBoolean(row.active),
        updatedAtUtc: toUtcIso(row.updatedAtUtc)
      }));
    }
  };
}

module.exports = { createSqlDoeTargetRepository, DOE_TARGET_LIMIT };
