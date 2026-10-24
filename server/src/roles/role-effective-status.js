'use strict';

// Effective status of a role appointment on a Calgary calendar date.
//
// Server counterpart of faculty-role-periods.js (the Faculty Dashboard rules), kept in step by
// tests/leadership-directory-view.test.js, which runs both over the same cases:
//   * RoleAppointmentSchedule periods take precedence; otherwise the legacy EffectiveDate /
//     ExpirationDate pair is the single period. Nothing is inferred from the academic year.
//   * startDate and endDate are inclusive Calgary dates; a null endDate is open-ended.
//   * A period without a start date cannot prove anything: "dates-needed" (the Dashboard's rule).
//   * All recorded periods in the future: "upcoming" (Dashboard: "Inactive · not started").
//   * Otherwise not effective today: "inactive" (ended, or a gap between periods).
// The reported dates are those of the period that decides the status: the current period's end,
// the most recent recorded end, or the next start.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = value => typeof value === 'string' && DATE.test(value) &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

function calgaryDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const clean = value => (validDate(value) ? value : null);

// Returns the list of { startDate, endDate } periods, or null when the stored schedule is unusable.
function effectivePeriods({ hasSchedule, periodsJson, effectiveDate, expirationDate }) {
  if (!hasSchedule) return [{ startDate: clean(effectiveDate), endDate: clean(expirationDate) }];
  let parsed;
  try { parsed = typeof periodsJson === 'string' ? JSON.parse(periodsJson) : periodsJson; } catch (_) { return null; }
  if (!Array.isArray(parsed) || parsed.length > 12) return null;
  const periods = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const startDate = item.startDate == null || item.startDate === '' ? null : item.startDate;
    const endDate = item.endDate == null || item.endDate === '' ? null : item.endDate;
    if ((startDate !== null && !validDate(startDate)) || (endDate !== null && !validDate(endDate))) return null;
    if (startDate && endDate && endDate < startDate) return null;
    periods.push({ startDate, endDate });
  }
  return periods;
}

function classify(source, asOf) {
  if (!validDate(asOf)) throw new Error('A Calgary as-of date is required.');
  const periods = effectivePeriods(source);
  if (periods === null) return { status: 'dates-needed', startDate: null, endDate: null };
  const current = periods.find(p => p.startDate && p.startDate <= asOf && (!p.endDate || asOf <= p.endDate));
  if (current) return { status: 'active', startDate: current.startDate, endDate: current.endDate };
  const unknown = periods.find(p => !p.startDate && (!p.endDate || asOf <= p.endDate));
  if (unknown) return { status: 'dates-needed', startDate: null, endDate: unknown.endDate };
  if (!periods.length) return { status: 'inactive', startDate: null, endDate: null };
  const future = periods.filter(p => p.startDate && p.startDate > asOf).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const ended = periods.filter(p => p.endDate && p.endDate < asOf).sort((a, b) => b.endDate.localeCompare(a.endDate));
  if (future.length && !ended.length) return { status: 'upcoming', startDate: future[0].startDate, endDate: future[0].endDate };
  return { status: 'inactive', startDate: null, endDate: ended.length ? ended[0].endDate : null, nextStartDate: future.length ? future[0].startDate : null };
}

module.exports = { calgaryDate, classify, effectivePeriods, validDate };
