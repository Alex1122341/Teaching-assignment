'use strict';

const EXPECTED_HEADERS = Object.freeze(['Faculty Member', 'Start', 'End', 'Purpose']);

function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
      continue;
    }
    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n' && !/\s/.test(char)) {
      throw new Error(`CSV_INVALID_AFTER_QUOTE at character ${i + 1}`);
    }
    if (char === '"' && field.length === 0 && !afterQuote) { quoted = true; continue; }
    if (char === ',' ) { record.push(field); field = ''; afterQuote = false; continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      record.push(field);
      if (record.some(value => value !== '')) records.push(record);
      record = []; field = ''; afterQuote = false;
      continue;
    }
    field += char;
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTED_FIELD');
  record.push(field);
  if (record.some(value => value !== '')) records.push(record);
  return records;
}

function parseDate(value) {
  const raw = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return raw;
}

function normalizeFacultyName(value) {
  const text = String(value ?? '').normalize('NFKC').trim();
  if (!text) return '';
  const comma = text.indexOf(',');
  const ordered = comma > -1 && text.indexOf(',', comma + 1) < 0
    ? `${text.slice(comma + 1)} ${text.slice(0, comma)}`
    : text;
  return ordered.toLocaleLowerCase('en-CA').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function nameKeys(value) {
  const text = String(value ?? '').normalize('NFKC').trim();
  if (!text) return [];
  const keys = new Set([normalizeFacultyName(text)]);
  const comma = text.indexOf(',');
  if (comma > -1 && text.indexOf(',', comma + 1) < 0) keys.add(normalizeFacultyName(`${text.slice(comma + 1)} ${text.slice(0, comma)}`));
  keys.delete('');
  return [...keys];
}

function parseAfcCsv(text) {
  const rawRecords = parseCsv(text);
  if (!rawRecords.length) throw new Error('CSV_EMPTY');
  const headers = rawRecords[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value);
  if (headers.length !== EXPECTED_HEADERS.length || headers.some((value, i) => value !== EXPECTED_HEADERS[i])) {
    throw new Error('CSV_HEADERS_DO_NOT_MATCH_APPROVED_AFC_COLUMNS');
  }
  const rows = rawRecords.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      return { sourceRowNumber: index + 2, facultySourceName: values[0] ?? '', rawStartDate: values[1] ?? '', rawEndDate: values[2] ?? '', startDate: null, endDate: null, rawPurpose: values[3] ?? '', purpose: values[3] ?? '', issues: ['CSV_COLUMN_COUNT_MISMATCH'] };
    }
    const [facultySourceName, startRaw, endRaw, purpose] = values;
    const startDate = parseDate(startRaw);
    const endDate = parseDate(endRaw);
    const issues = [];
    if (!String(facultySourceName ?? '').trim()) issues.push('MISSING_FACULTY');
    else if (facultySourceName.length > 256) issues.push('FACULTY_NAME_TOO_LONG');
    if (!String(startRaw ?? '').trim()) issues.push('MISSING_START_DATE');
    else if (!startDate) issues.push('INVALID_START_DATE');
    if (!String(endRaw ?? '').trim()) issues.push('MISSING_END_DATE');
    else if (!endDate) issues.push('INVALID_END_DATE');
    if (!String(purpose ?? '').trim()) issues.push('MISSING_PURPOSE');
    else if (purpose.length > 1000) issues.push('PURPOSE_TOO_LONG');
    if (startDate && endDate && endDate < startDate) issues.push('END_BEFORE_START');
    return { sourceRowNumber: index + 2, facultySourceName, rawStartDate: startRaw, rawEndDate: endRaw, startDate, endDate, rawPurpose: purpose, purpose, issues };
  });

  const duplicateGroups = new Map();
  for (const row of rows) {
    if (row.issues.length) continue;
    const key = JSON.stringify([normalizeFacultyName(row.facultySourceName), row.startDate, row.endDate, row.purpose]);
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(row);
  }
  let duplicateGroupCount = 0;
  let duplicateExtraRows = 0;
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    duplicateGroupCount += 1;
    for (const row of group.slice(1)) { row.issues.push('DUPLICATE_SOURCE_BUSINESS_ROW'); duplicateExtraRows += 1; }
  }
  return {
    headers,
    rows,
    summary: {
      sourceRows: rows.length,
      duplicateGroups: duplicateGroupCount,
      duplicateExtraRows,
      parserInvalidRows: rows.filter(row => row.issues.some(code => code !== 'DUPLICATE_SOURCE_BUSINESS_ROW')).length
    }
  };
}

function indexCandidates(values, getNames) {
  const index = new Map();
  for (const value of values) {
    if (value.active === false || !value.facultyId) continue;
    for (const name of getNames(value)) {
      for (const key of nameKeys(name)) {
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(value.facultyId);
      }
    }
  }
  return index;
}

function resolveFacultyName(sourceName, directory = {}) {
  const faculty = directory.faculty || [];
  const aliases = directory.aliases || [];
  const mappings = directory.mappings || {};
  const ids = new Set(faculty.filter(item => item.active !== false).map(item => item.facultyId));
  const sourceKeys = nameKeys(sourceName);
  const canonical = indexCandidates(faculty, item => [item.displayName, `${item.preferredFirstName || ''} ${item.preferredLastName || ''}`]);
  const lookup = index => new Set(sourceKeys.flatMap(key => [...(index.get(key) || [])]));
  const canonicalMatches = lookup(canonical);
  if (canonicalMatches.size > 1) return { status: 'AMBIGUOUS', facultyId: null, method: null };
  if (canonicalMatches.size === 1) return { status: 'MATCHED', facultyId: [...canonicalMatches][0], method: 'CANONICAL_NAME' };

  const aliasIndex = indexCandidates(aliases, item => [item.aliasName, item.targetPreferredSourceName, item.targetDisplayName]);
  const aliasMatches = lookup(aliasIndex);
  if (aliasMatches.size > 1) return { status: 'AMBIGUOUS', facultyId: null, method: null };
  if (aliasMatches.size === 1) return { status: 'MATCHED', facultyId: [...aliasMatches][0], method: 'FACULTY_ALIAS' };

  const mapped = new Set();
  const mappingEntries = Array.isArray(mappings)
    ? mappings.map(item => [item.sourceName, item.facultyId])
    : Object.entries(mappings);
  for (const [key, facultyId] of mappingEntries) {
    if (nameKeys(key).some(candidate => sourceKeys.includes(candidate)) && ids.has(facultyId)) mapped.add(facultyId);
  }
  if (mapped.size > 1) return { status: 'AMBIGUOUS', facultyId: null, method: null };
  if (mapped.size === 1) return { status: 'MATCHED', facultyId: [...mapped][0], method: 'EXPLICIT_IMPORT_MAPPING' };
  return { status: 'NO_MATCH', facultyId: null, method: null };
}

function businessKey(row) {
  return JSON.stringify([row.facultyId, row.startDate, row.endDate, row.purpose]);
}

function validExisting(record) { return record.active !== false; }

function reconcileAfcRows(sourceRows, { faculty = [], aliases = [], mappings = {}, existingRecords = [] } = {}) {
  const directory = { faculty, aliases, mappings };
  const existing = existingRecords.filter(validExisting);
  const output = [];
  const seenSourceKeys = new Set();
  for (const source of sourceRows) {
    const row = { ...source, issues: [...(source.issues || [])], correction: null, facultyId: null, facultyResolutionMethod: null, writeAction: 'NONE' };
    const originalIssues = new Set(row.issues);
    let resolved = resolveFacultyName(row.facultySourceName, directory);

    if (originalIssues.has('MISSING_FACULTY') && row.startDate && row.endDate && String(row.purpose || '').trim()) {
      const ids = new Set(existing.filter(item => item.startDate === row.startDate && item.endDate === row.endDate && item.purpose === row.purpose).map(item => item.facultyId));
      if (ids.size === 1) {
        row.facultyId = [...ids][0];
        row.correction = 'FACULTY_FROM_EXACT_HISTORY';
        row.issues = row.issues.filter(code => code !== 'MISSING_FACULTY');
        resolved = { status: 'MATCHED', facultyId: row.facultyId, method: 'EXACT_AFC_HISTORY' };
      }
    }
    if (!row.facultyId && resolved.status === 'MATCHED') row.facultyId = resolved.facultyId;

    if (originalIssues.has('MISSING_PURPOSE') && row.facultyId && row.startDate && row.endDate) {
      const purposes = new Set(existing.filter(item => item.facultyId === row.facultyId && item.startDate === row.startDate && item.endDate === row.endDate && String(item.purpose || '').trim()).map(item => item.purpose));
      if (purposes.size === 1) {
        row.purpose = [...purposes][0];
        row.correction = row.correction || 'PURPOSE_FROM_EXACT_HISTORY';
        row.issues = row.issues.filter(code => code !== 'MISSING_PURPOSE');
      }
    }
    if (originalIssues.has('END_BEFORE_START') && row.facultyId && row.startDate && row.endDate && String(row.purpose || '').trim()) {
      const swappedStart = row.endDate;
      const swappedEnd = row.startDate;
      const matches = existing.filter(item => item.facultyId === row.facultyId && item.startDate === swappedStart && item.endDate === swappedEnd && item.purpose === row.purpose);
      if (matches.length) {
        row.startDate = swappedStart;
        row.endDate = swappedEnd;
        row.correction = row.correction || 'REVERSED_DATES_FROM_EXACT_HISTORY';
        row.issues = row.issues.filter(code => code !== 'END_BEFORE_START');
      }
    }

    row.facultyResolutionMethod = resolved.method;
    if (resolved.status !== 'MATCHED' && !row.facultyId) row.issues.push(resolved.status === 'AMBIGUOUS' ? 'AMBIGUOUS_FACULTY' : 'NO_FACULTY_MATCH');
    row.issues = [...new Set(row.issues)];
    if (row.issues.length) {
      row.status = 'SOURCE_ROW_REQUIRES_REVIEW';
      output.push(row);
      continue;
    }

    const key = businessKey(row);
    if (seenSourceKeys.has(key)) {
      row.issues.push('DUPLICATE_SOURCE_BUSINESS_ROW');
      row.status = 'SOURCE_ROW_REQUIRES_REVIEW';
      output.push(row);
      continue;
    }
    seenSourceKeys.add(key);
    const same = existing.filter(item => businessKey(item) === key);
    if (row.correction) row.status = 'SOURCE_ERROR_DETERMINISTICALLY_RESOLVED';
    else if (same.length) row.status = 'SOURCE_CURRENT';
    else if (existing.some(item => item.facultyId === row.facultyId && item.startDate === row.startDate && item.endDate === row.endDate && item.purpose !== row.purpose)) row.status = 'SOURCE_CHANGED';
    else row.status = 'SOURCE_NEW';
    row.existingRecordIds = same.map(item => item.afcRecordId).filter(Boolean);
    row.writeAction = same.length ? 'NONE' : 'INSERT';
    output.push(row);
  }

  const sourceKeys = new Set(output.filter(row => row.writeAction !== 'NONE' || row.status === 'SOURCE_CURRENT' || row.status === 'SOURCE_ERROR_DETERMINISTICALLY_RESOLVED').map(businessKey));
  const representedKeys = new Set(existing.map(businessKey));
  const summary = {
    sourceRows: sourceRows.length,
    validRows: output.filter(row => ['SOURCE_CURRENT', 'SOURCE_NEW', 'SOURCE_CHANGED', 'SOURCE_ERROR_DETERMINISTICALLY_RESOLVED'].includes(row.status)).length,
    exactExisting: output.filter(row => row.status === 'SOURCE_CURRENT').length,
    inserts: output.filter(row => row.writeAction === 'INSERT').length,
    corrected: output.filter(row => row.status === 'SOURCE_ERROR_DETERMINISTICALLY_RESOLVED').length,
    intentionalDuplicates: 0,
    duplicateExtraRows: output.filter(row => row.issues.includes('DUPLICATE_SOURCE_BUSINESS_ROW')).length,
    skippedInvalid: output.filter(row => row.status === 'SOURCE_ROW_REQUIRES_REVIEW').length,
    unresolved: output.filter(row => row.status === 'SOURCE_ROW_REQUIRES_REVIEW').length,
    sourceCurrent: output.filter(row => row.status === 'SOURCE_CURRENT').length,
    sourceNew: output.filter(row => row.status === 'SOURCE_NEW').length,
    sourceChanged: output.filter(row => row.status === 'SOURCE_CHANGED').length,
    represented: output.filter(row => ['SOURCE_CURRENT', 'SOURCE_NEW', 'SOURCE_CHANGED', 'SOURCE_ERROR_DETERMINISTICALLY_RESOLVED'].includes(row.status) && representedKeys.has(businessKey(row))).length,
    dbOnlyHistory: existing.filter(record => !sourceKeys.has(businessKey(record))).length
  };
  return { rows: output, summary };
}

module.exports = { EXPECTED_HEADERS, parseAfcCsv, normalizeFacultyName, resolveFacultyName, reconcileAfcRows };
