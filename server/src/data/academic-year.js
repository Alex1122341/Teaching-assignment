'use strict';

// Canonical academic-year handling.
//
// The stored Azure SQL vocabulary is `YYYY-YY` (e.g. `2026-27`). Live Beta data
// proved this: every `paws.vCalendarSession` row for the current year carries
// `2026-27`, while `2026-2027` matches nothing.
//
// This module makes a silently-empty result impossible. Exactly one function
// decides the value:
//
//   omitted            -> DEFAULT_ACADEMIC_YEAR ('2026-27')
//   '2026-27'          -> '2026-27'
//   '2026-2027'        -> '2026-27'      (4-4 collapses onto its 2-2 form)
//   '2027-2028'        -> '2027-28'
//   anything malformed -> InvalidAcademicYearError (400 when explicitly supplied)
//
// Malformed input is NEVER silently converted to the default: an explicit
// `2026` or `junk` is a caller error and must surface as a 400, not as a
// valid-looking response that quietly reports the default year's data.

const DEFAULT_ACADEMIC_YEAR = '2026-27';

// A canonical year is exactly `YYYY-YY`, where the trailing two digits are the
// last two of the successor year. `2026-27` is valid; `2026-26` is not.
const CANONICAL = /^(\d{4})-(\d{2})$/;
// The accepted *input* spelling is either the canonical 2-2 form or the 4-4
// form. Anything else is malformed.
const INPUT = /^(\d{4})-(\d{2}|\d{4})$/;

class InvalidAcademicYearError extends Error {
  constructor(value) {
    super(`Academic year '${String(value)}' is not a recognised academic year.`);
    this.name = 'InvalidAcademicYearError';
    this.code = 'INVALID_ACADEMIC_YEAR';
    this.value = value;
  }
}

// Canonicalises an explicit academic-year value, or throws
// InvalidAcademicYearError when it cannot be canonicalised.
function canonicalAcademicYear(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  const match = INPUT.exec(text);
  if (!match) throw new InvalidAcademicYearError(value);

  const startYear = Number(match[1]);
  const endToken = match[2];
  // For the 4-4 form the trailing token is a full year; for the 2-2 form it is
  // the last two digits of that year.
  const endYear = endToken.length === 4 ? Number(endToken) : Math.floor(startYear / 100) * 100 + Number(endToken);

  // The academic year must span exactly one year forward: 2026-27 or 2026-2027
  // both mean "2026 then 2027". 2026-2028 and 2026-26 are rejected.
  if (endYear !== startYear + 1) throw new InvalidAcademicYearError(value);

  const canonical = `${startYear}-${String(endYear % 100).padStart(2, '0')}`;
  // Defensive: the derived value must itself satisfy the stored contract.
  if (!CANONICAL.test(canonical)) throw new InvalidAcademicYearError(value);
  return canonical;
}

// Resolves the effective academic year for a request. An omitted parameter
// falls back to the default; an explicitly supplied invalid value throws so the
// caller can answer 400 instead of returning the default year's data.
function resolveAcademicYear(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return DEFAULT_ACADEMIC_YEAR;
  return canonicalAcademicYear(text);
}

module.exports = {
  DEFAULT_ACADEMIC_YEAR,
  InvalidAcademicYearError,
  canonicalAcademicYear,
  resolveAcademicYear
};
