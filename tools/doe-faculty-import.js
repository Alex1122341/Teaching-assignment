'use strict';

const ExcelJS = require('exceljs');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DOE_RULES, SOURCE_REFERENCE: DOE_RULE_SOURCE_REFERENCE } = require('../server/src/domain/doe-rule-book');

const ACADEMIC_YEAR = '2026-27';
const TOTAL_TOLERANCE = 0.01;
const WORKSHEET_NAME = 'DOE Import';
const EXPECTED_HEADERS = Object.freeze([
  'FullName', 'UCID', 'Teaching', 'ScholarlyActivity', 'PPVMCostShare',
  'ClinicalUnsorted', 'ClinicalTeaching', 'ClinicalActivityPPVM', 'Research',
  'ContractAdmin', 'ServiceAdmin', 'Other', 'Onboarding', 'TotalContractPctFTE', 'FTE'
]);
const CATEGORY_COLUMNS = Object.freeze([
  { column: 4, categoryCode: 'scholarly_activity' },
  { column: 5, categoryCode: 'ppvm_cost_share' },
  { column: 6, categoryCode: 'clinical_unsorted' },
  { column: 7, categoryCode: 'clinical_teaching' },
  { column: 8, categoryCode: 'clinical_activity_ppvm' },
  { column: 9, categoryCode: 'research' },
  { column: 10, categoryCode: 'contract_admin' },
  { column: 11, categoryCode: 'service_admin' },
  { column: 12, categoryCode: 'other' },
  { column: 13, categoryCode: 'onboarding' }
]);

function normalizeUcid(value) {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}

function error(code, rowNumber) {
  return { code, rowNumber };
}

function readCellValue(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    return null;
  }
  return value;
}

function readUcid(cell) {
  const value = readCellValue(cell);
  if (typeof value === 'string') return normalizeUcid(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  const format = typeof cell?.numFmt === 'string' && /^0+$/.test(cell.numFmt) ? cell.numFmt.length : 0;
  return String(value).padStart(format, '0');
}

function readPercentage(cell, rowNumber, errors, code) {
  const value = readCellValue(cell);
  if (value === null || value === '') return null;
  const number = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    errors.push(error(code, rowNumber));
    return null;
  }
  return number;
}

function readFte(cell, rowNumber, errors) {
  const value = readCellValue(cell);
  if (value === null || value === '') return null;
  const number = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    errors.push(error('INVALID_FTE_VALUE', rowNumber));
    return null;
  }
  return number;
}

function parseDoeWorksheet(worksheet) {
  if (!worksheet || typeof worksheet.eachRow !== 'function') throw Object.assign(new Error(`${WORKSHEET_NAME} sheet is required.`), { code: 'DOE_IMPORT_SHEET_REQUIRED' });
  const actualHeaders = EXPECTED_HEADERS.map((_, index) => {
    const value = readCellValue(worksheet.getRow(1).getCell(index + 1));
    return value === null || value === undefined ? '' : String(value).trim();
  });
  if (actualHeaders.some((header, index) => header !== EXPECTED_HEADERS[index])) {
    throw Object.assign(new Error(`${WORKSHEET_NAME} headers do not match the approved DOE import contract.`), { code: 'DOE_IMPORT_HEADERS_INVALID' });
  }
  const sourceRows = [];
  const errors = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const sourceNameValue = readCellValue(row.getCell(1));
    const sourceName = sourceNameValue === null ? '' : String(sourceNameValue).normalize('NFKC').trim().replace(/\s+/g, ' ');
    const ucid = readUcid(row.getCell(2));
    if (!sourceName && !ucid) return;
    const hasDoeValues = [3, ...CATEGORY_COLUMNS.map(item => item.column), 14, 15]
      .some(column => readCellValue(row.getCell(column)) !== null && readCellValue(row.getCell(column)) !== '');
    if (!ucid && !hasDoeValues) return;
    const errorOffset = errors.length;
    if (!ucid) errors.push(error('UCID_REQUIRED', rowNumber));

    const rowErrors = errors.length;
    const teachingDoe = readPercentage(row.getCell(3), rowNumber, errors, 'INVALID_TEACHING_VALUE');
    const allocations = [];
    for (const { column, categoryCode } of CATEGORY_COLUMNS) {
      const allocationDoe = readPercentage(row.getCell(column), rowNumber, errors, 'INVALID_ALLOCATION_VALUE');
      if (allocationDoe !== null) allocations.push({ categoryCode, allocationDoe });
    }
    const total = readPercentage(row.getCell(14), rowNumber, errors, 'INVALID_TOTAL_VALUE');
    const fte = readFte(row.getCell(15), rowNumber, errors);
    if (total !== null && errors.length === rowErrors) {
      const suppliedTotal = [teachingDoe, ...allocations.map(item => item.allocationDoe)]
        .filter(value => value !== null)
        .reduce((sum, value) => sum + value, 0);
      if (Math.abs(suppliedTotal - total) > TOTAL_TOLERANCE) errors.push(error('TOTAL_MISMATCH', rowNumber));
    }
    sourceRows.push({
      rowNumber, sourceName, ucid, academicYear: ACADEMIC_YEAR,
      teachingDoe, totalContractPctFte: total, fte, allocations,
      validationErrors: errors.slice(errorOffset).map(item => item.code)
    });
  });
  const sourceUcidCounts = new Map();
  for (const row of sourceRows) if (row.ucid) sourceUcidCounts.set(row.ucid, (sourceUcidCounts.get(row.ucid) || 0) + 1);
  for (const row of sourceRows) if (row.ucid && sourceUcidCounts.get(row.ucid) > 1) {
    errors.push(error('DUPLICATE_SOURCE_UCID', row.rowNumber));
    row.validationErrors.push('DUPLICATE_SOURCE_UCID');
  }
  return { sourceRows, errors };
}

async function readDoeWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(WORKSHEET_NAME);
  if (!worksheet) throw Object.assign(new Error(`${WORKSHEET_NAME} sheet is required.`), { code: 'DOE_IMPORT_SHEET_REQUIRED' });
  return parseDoeWorksheet(worksheet);
}

function parseDoeCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const records = [];
  let record = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      record.push(field); field = '';
      if (record.some(value => value !== '')) records.push(record);
      record = [];
    } else field += ch;
  }
  if (quoted) throw Object.assign(new Error('DOE CSV contains an unclosed quoted field.'), { code: 'DOE_IMPORT_CSV_INVALID' });
  record.push(field);
  if (record.some(value => value !== '')) records.push(record);
  if (!records.length || records[0].length !== EXPECTED_HEADERS.length || records[0].some((header, index) => String(header).trim() !== EXPECTED_HEADERS[index])) {
    throw Object.assign(new Error('DOE CSV headers do not match the approved import contract.'), { code: 'DOE_IMPORT_HEADERS_INVALID' });
  }
  const worksheet = {
    getRow(rowNumber) {
      const cells = records[rowNumber - 1] || [];
      return { getCell(column) { return { value: cells[column - 1] ?? null }; } };
    },
    eachRow(callback) {
      for (let rowNumber = 1; rowNumber < records.length; rowNumber += 1) {
        const cells = records[rowNumber];
        callback({ getCell(column) { return { value: cells[column - 1] ?? null }; } }, rowNumber + 1);
      }
    }
  };
  return parseDoeWorksheet(worksheet);
}

async function readDoeSource(filePath) {
  if (path.extname(filePath).toLowerCase() === '.csv') {
    return parseDoeCsv(await fs.readFile(filePath, 'utf8'));
  }
  return readDoeWorkbook(filePath);
}

function normalizedName(value) {
  return (value === null || value === undefined ? '' : String(value))
    .normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-CA');
}

function reconcileDoeRows(sourceRows, facultyRows, { validationErrors = 0 } = {}) {
  const sourceCounts = new Map();
  const databaseByUcid = new Map();
  for (const source of sourceRows) {
    const ucid = normalizeUcid(source.ucid);
    if (ucid) sourceCounts.set(ucid, (sourceCounts.get(ucid) || 0) + 1);
  }
  for (const faculty of facultyRows) {
    const ucid = normalizeUcid(faculty.ucid);
    if (!ucid) continue;
    const matches = databaseByUcid.get(ucid) || [];
    matches.push(faculty);
    databaseByUcid.set(ucid, matches);
  }

  let exactActiveMatches = 0;
  let exactInactiveMatches = 0;
  let noMatch = 0;
  let conflicts = 0;
  let nameWarnings = 0;
  let teachingTargetRows = 0;
  let nonTeachingAllocationRows = 0;
  const issues = [];
  const importRows = [];

  for (const source of sourceRows) {
    const ucid = normalizeUcid(source.ucid);
    const rowIssues = [...(source.validationErrors || [])];
    if (!ucid) rowIssues.push('UCID_REQUIRED');
    else if (sourceCounts.get(ucid) > 1 && !rowIssues.includes('DUPLICATE_SOURCE_UCID')) rowIssues.push('DUPLICATE_SOURCE_UCID');
    const candidates = ucid ? (databaseByUcid.get(ucid) || []) : [];
    if (ucid && !candidates.length && !rowIssues.length) {
      noMatch += 1;
      issues.push({ rowNumber: source.rowNumber, code: 'NO_UCID_MATCH' });
      continue;
    }
    if (rowIssues.some(code => code !== 'DUPLICATE_SOURCE_UCID' && code !== 'DUPLICATE_DATABASE_UCID')) {
      for (const code of new Set(rowIssues)) issues.push({ rowNumber: source.rowNumber, code });
      continue;
    }
    if (candidates.length > 1) rowIssues.push('DUPLICATE_DATABASE_UCID');
    const match = candidates.length === 1 ? candidates[0] : null;
    if (rowIssues.length) {
      conflicts += 1;
      const code = rowIssues.some(value => value === 'DUPLICATE_SOURCE_UCID' || value === 'DUPLICATE_DATABASE_UCID')
        ? 'UCID_CONFLICT'
        : rowIssues[0];
      issues.push({ rowNumber: source.rowNumber, code });
      continue;
    }
    const hasNameWarning = Boolean(match && normalizedName(source.sourceName) && normalizedName(match.displayName) && normalizedName(source.sourceName) !== normalizedName(match.displayName));
    const matchClass = hasNameWarning ? 'EXACT_UCID_NAME_WARNING' : 'EXACT_UNIQUE_UCID_MATCH';
    if (hasNameWarning) {
      nameWarnings += 1;
      issues.push({ rowNumber: source.rowNumber, code: matchClass });
    }
    if (match.active === false || match.active === 0 || match.active === '0') {
      exactInactiveMatches += 1;
      continue;
    }

    exactActiveMatches += 1;
    if (source.teachingDoe !== null) teachingTargetRows += 1;
    nonTeachingAllocationRows += source.allocations.length;
    importRows.push({
      sourceRowNumber: source.rowNumber,
      facultyId: String(match.facultyId),
      academicYear: ACADEMIC_YEAR,
      teachingDoe: source.teachingDoe,
      fte: source.fte ?? null,
      allocations: source.allocations.map(item => ({ ...item })),
      matchClass
    });
  }

  const activeFaculty = facultyRows.filter(faculty => faculty.active === true || faculty.active === 1 || faculty.active === '1').length;
  const activeFacultyWithTeachingTarget = importRows.filter(row => row.teachingDoe !== null).length;
  const activeFacultyRows = facultyRows.filter(faculty => faculty.active === true || faculty.active === 1 || faculty.active === '1');
  const importedById = new Map(importRows.map(row => [row.facultyId, row]));
  const ftePopulatedBefore = activeFacultyRows.filter(faculty => faculty.fte !== null && faculty.fte !== undefined && faculty.fte !== '').length;
  const ftePopulatedAfter = activeFacultyRows.filter(faculty => {
    const source = importedById.get(String(faculty.facultyId));
    return source && source.fte !== null ? true : faculty.fte !== null && faculty.fte !== undefined && faculty.fte !== '';
  }).length;
  const summary = {
    sourceRows: sourceRows.length,
    exactActiveMatches,
    exactInactiveMatches,
    noMatch,
    conflicts,
    nameWarnings,
    teachingTargetRows,
    nonTeachingAllocationRows,
    validationErrors: Number(validationErrors) || 0,
    activeFaculty,
    sourceMatchedFaculty: exactActiveMatches,
    ftePopulatedBefore,
    ftePopulatedAfter,
    fteNullAfter: Math.max(0, activeFaculty - ftePopulatedAfter),
    explicitZeroFteValues: importRows.filter(row => row.fte === 0).length,
    activeFacultyWithTeachingTarget,
    activeFacultyMissingTeachingTarget: Math.max(0, activeFaculty - activeFacultyWithTeachingTarget)
  };
  return { summary, issues, importRows };
}

function buildDoeImportPayload(sourceRows, errors = [], { sourceFileName = null, sourceFileSha256 = null } = {}) {
  return {
    academicYear: ACADEMIC_YEAR,
    sourceFileName,
    sourceFileSha256,
    validationErrors: errors.length,
    doeRuleBook: {
      sourceReference: DOE_RULE_SOURCE_REFERENCE,
      rules: DOE_RULES.map(rule => ({
        ...rule,
        rawJson: JSON.stringify({
          ruleCode: rule.ruleCode,
          category: rule.category,
          policyReferenceOnly: true
        })
      }))
    },
    sourceRows: sourceRows.map(row => ({
      rowNumber: row.rowNumber,
      sourceName: row.sourceName,
      ucid: normalizeUcid(row.ucid),
      teachingDoe: row.teachingDoe,
      fte: row.fte ?? null,
      validationErrors: [...new Set(row.validationErrors || errors.filter(item => item.rowNumber === row.rowNumber).map(item => item.code))],
      allocations: row.allocations.map(item => ({
        categoryCode: item.categoryCode,
        allocationDoe: item.allocationDoe
      }))
    }))
  };
}

module.exports = {
  ACADEMIC_YEAR,
  buildDoeImportPayload,
  CATEGORY_COLUMNS,
  EXPECTED_HEADERS,
  TOTAL_TOLERANCE,
  WORKSHEET_NAME,
  normalizeUcid,
  parseDoeCsv,
  parseDoeWorksheet,
  readDoeSource,
  readDoeWorkbook,
  reconcileDoeRows
};

async function cli(args) {
  const mode = args[0];
  const workbookPath = args[1];
  if (!['--summary', '--write-payload'].includes(mode) || !workbookPath) {
    throw new Error('Usage: doe-faculty-import.js --summary <workbook.xlsx> | --write-payload <workbook.xlsx> <private-output.json>');
  }
  const parsed = await readDoeSource(workbookPath);
  const coverage = { Teaching: parsed.sourceRows.filter(row => row.teachingDoe !== null).length };
  for (const { categoryCode } of CATEGORY_COLUMNS) {
    coverage[categoryCode] = parsed.sourceRows.filter(row => row.allocations.some(item => item.categoryCode === categoryCode)).length;
  }
  if (mode === '--summary') {
    process.stdout.write(`${JSON.stringify({ sourceRows: parsed.sourceRows.length, uniqueUcids: new Set(parsed.sourceRows.map(row => row.ucid)).size, validationErrorCount: parsed.errors.length, validationErrors: parsed.errors.map(({ rowNumber, code }) => ({ rowNumber, code })), coverage })}\n`);
    return;
  }
  const outputPath = args[2];
  if (!outputPath) throw new Error('A private payload output path is required.');
  const resolvedOutput = path.resolve(outputPath);
  const repositoryRoot = path.resolve(__dirname, '..') + path.sep;
  if (resolvedOutput.toLowerCase().startsWith(repositoryRoot.toLowerCase())) {
    throw new Error('DOE source payloads must remain outside the repository.');
  }
  const sourceBytes = await fs.readFile(workbookPath);
  const payload = buildDoeImportPayload(parsed.sourceRows, parsed.errors, {
    sourceFileName: path.basename(workbookPath),
    sourceFileSha256: crypto.createHash('sha256').update(sourceBytes).digest('hex').toUpperCase()
  });
  await fs.writeFile(resolvedOutput, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ payloadRows: parsed.sourceRows.length, validationErrorCount: parsed.errors.length, validationErrors: parsed.errors.map(({ rowNumber, code }) => ({ rowNumber, code }))})}\n`);
}

if (require.main === module) {
  cli(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.code || 'DOE_IMPORT_FAILED'}\n`);
    process.exitCode = 1;
  });
}
