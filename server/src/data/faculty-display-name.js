'use strict';

// Only trusted, fixed repository aliases may be used; never interpolate request data.
function facultyDisplayNameSql(alias = 'f') {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid faculty table alias.');
  const first = `NULLIF(LTRIM(RTRIM(${alias}.PreferredFirstName)), N'')`;
  const last = `NULLIF(LTRIM(RTRIM(${alias}.PreferredLastName)), N'')`;
  return `LTRIM(RTRIM(REPLACE(CASE WHEN ${first} IS NOT NULL OR ${last} IS NOT NULL THEN CONCAT(${first}, CASE WHEN ${first} IS NOT NULL AND ${last} IS NOT NULL THEN N' ' ELSE N'' END, ${last}) ELSE ${alias}.DisplayName END, N',', N' ')))`;
}

module.exports = { facultyDisplayNameSql };
