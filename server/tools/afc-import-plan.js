'use strict';

const fs = require('node:fs');
const { parseAfcCsv, reconcileAfcRows } = require('../../tools/afc-source-import');

function buildAfcImportPlan(csvText, directory, existingRecords) {
  const parsed = parseAfcCsv(csvText);
  const reconciled = reconcileAfcRows(parsed.rows, { ...directory, existingRecords });
  return {
    source: parsed.summary,
    summary: reconciled.summary,
    rows: reconciled.rows.map(row => ({
      sourceRowNumber: row.sourceRowNumber,
      facultySourceName: row.facultySourceName,
      rawStartDate: row.rawStartDate,
      rawEndDate: row.rawEndDate,
      rawPurpose: row.rawPurpose,
      startDate: row.startDate,
      endDate: row.endDate,
      purpose: row.purpose,
      rawIssues: row.issues,
      status: row.status,
      correction: row.correction,
      facultyId: row.facultyId,
      facultyResolutionMethod: row.facultyResolutionMethod,
      writeAction: row.writeAction,
      existingRecordIds: row.existingRecordIds || []
    }))
  };
}

if (require.main === module) {
  try {
    const sourcePath = process.argv[2];
    if (!sourcePath) throw new Error('AFC source file path is required');
    const inputText = fs.readFileSync(0, 'utf8');
    const context = JSON.parse(inputText);
    const csvText = fs.readFileSync(sourcePath, 'utf8');
    process.stdout.write(JSON.stringify(buildAfcImportPlan(csvText, context.directory || {}, context.existingRecords || [])));
  } catch (error) {
    process.stderr.write(`AFC plan error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildAfcImportPlan };
