'use strict';

(function exposeAfcBatchHelpers(root) {
  function normalizePastedDate(value, field) {
    const raw = String(value ?? '').trim();
    if (!raw) return { value: '', error: '' };

    let parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!parts) parts = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(raw);
    const year = parts ? Number(parts[1]) : 0;
    const month = parts ? Number(parts[2]) : 0;
    const day = parts ? Number(parts[3]) : 0;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!parts || year < 1 || month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) {
      return { value: '', error: `Invalid ${field}: "${raw}". Use YYYY-MM-DD or YYYY/M/D.` };
    }
    return { value: `${parts[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, error: '' };
  }

  function validCanonicalDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1];
  }

  function parsePaste(raw, resolveFaculty) {
    const lines = String(raw || '').replace(/\r/g, '').split('\n').filter(line => line.trim());
    if (lines.length && /faculty member|^faculty\s*\t/i.test(lines[0])) lines.shift();
    if (!lines.length) return { rows: [], error: 'Paste at least one AFC row.' };
    if (lines.length > 20) return { rows: [], error: 'Paste no more than 20 rows.' };
    const rows = lines.map(line => {
      const columns = line.split('\t');
      const [facultyEntry = '', sourceStartDate = '', sourceEndDate = ''] = columns;
      const purpose = columns.length > 4 ? columns.slice(3).join('\t') : columns[3] || '';
      const resolved = resolveFaculty(facultyEntry.trim());
      const start = normalizePastedDate(sourceStartDate, 'Start Date');
      const end = normalizePastedDate(sourceEndDate, 'End Date');
      const dateErrors = { startDate: start.error, endDate: end.error };
      const errors = Object.values(dateErrors).filter(Boolean);
      return { facultyId: resolved?.facultyId || '', facultyEntry, startDate: start.value, endDate: end.value, purpose, importError: columns.length < 4 ? 'Expected Faculty Member, Start, End, Purpose.' : '', dateErrors, errors, status: errors.length ? 'INVALID' : 'EDIT' };
    });
    return { rows, error: '' };
  }

  function validateRows(rows, resolveFaculty) {
    const seen = new Set();
    return rows.map((row, rowIndex) => {
      const errors = row.importError ? [row.importError] : [];
      const dateErrors = row.dateErrors || {};
      errors.push(...Object.values(dateErrors).filter(Boolean));
      const facultyRow = resolveFaculty(row.facultyEntry || row.facultyId);
      if (!facultyRow) errors.push('Choose an active Faculty member.');
      else row.facultyId = facultyRow.facultyId;
      const startValid = validCanonicalDate(row.startDate);
      const endValid = validCanonicalDate(row.endDate);
      if ((!startValid && !dateErrors.startDate) || (!endValid && !dateErrors.endDate)) errors.push('Enter valid YYYY-MM-DD dates.');
      else if (startValid && endValid && row.endDate < row.startDate) errors.push('End date is before start date.');
      if (!String(row.purpose ?? '').trim()) errors.push('Purpose is required.');
      else if (row.purpose.length > 1000) errors.push('Purpose exceeds 1,000 characters.');
      const identity = JSON.stringify([row.facultyId, row.startDate, row.endDate, row.purpose]);
      if (!errors.length && seen.has(identity)) errors.push('Duplicate row in this batch.');
      if (!errors.length) seen.add(identity);
      row.errors = errors;
      row.status = errors.length ? (errors.some(value => value.includes('Duplicate row')) ? 'DUPLICATE_IN_BATCH' : 'INVALID') : 'NEW';
      row.rowIndex = rowIndex;
      return row;
    });
  }

  function toApiRows(rows) {
    return rows.map(({ facultyId, startDate, endDate, purpose }) => ({ facultyId, startDate, endDate, purpose }));
  }

  function canSubmitRows(rows, inFlight = false) {
    return !inFlight && rows.length > 0 && rows.every(row => !row.errors?.length);
  }

  function successMessage(outcome) {
    const rows = Array.isArray(outcome?.rows) ? outcome.rows : [];
    if (outcome?.idempotentReplay) {
      return 'This batch was already applied; no additional AFC records were created (' + rows.length + ' rows).';
    }
    const created = rows.filter(row => row.status === 'NEW' || row.status === 'CREATED').length;
    return 'Created ' + created + ' AFC record(s).';
  }

  const helpers = Object.freeze({ normalizePastedDate, parsePaste, validateRows, toApiRows, canSubmitRows, successMessage });
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (root) root.UCVM_AFC_BATCH = helpers;
})(typeof window === 'undefined' ? null : window);
