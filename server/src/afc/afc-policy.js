'use strict';

const CLOSURES = new Set([
  '2026-01-01','2026-02-16','2026-04-03','2026-04-06','2026-05-18','2026-07-01','2026-08-03','2026-09-07','2026-09-30','2026-10-12','2026-11-11','2026-12-25','2026-12-28','2026-12-29','2026-12-30','2026-12-31',
  '2027-01-01','2027-02-15','2027-03-26','2027-03-29','2027-05-24','2027-07-01','2027-08-02','2027-09-06','2027-09-30','2027-10-11','2027-11-11','2027-12-27','2027-12-28','2027-12-29','2027-12-30','2027-12-31'
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DATE = '2026-01-01';
const MAX_DATE = '2027-12-31';

function parseDate(value) {
  const text = String(value || '');
  if (!DATE_RE.test(text) || text < MIN_DATE || text > MAX_DATE) return null;
  const date = new Date(text + 'T12:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return date;
}

function workDays(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end < start) return null;
  if ((end - start) / 86400000 > 366) return null;
  let count = 0;
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.getUTCDay();
    const key = date.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !CLOSURES.has(key)) count += 1;
  }
  return count;
}

module.exports = { CLOSURES, MIN_DATE, MAX_DATE, parseDate, workDays };
