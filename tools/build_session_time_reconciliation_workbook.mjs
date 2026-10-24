import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SpreadsheetFile, Workbook } = require("@oai/artifact-tool");

const [inputPath, outputPath, previewDir] = process.argv.slice(2);
if (!inputPath || !outputPath || !previewDir) {
  throw new Error("Usage: node build_session_time_reconciliation_workbook.mjs <reconciliation.json> <output.xlsx> <preview-dir>");
}

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const rows = payload.sessions;
if (!Array.isArray(rows) || rows.length !== 1937) {
  throw new Error(`Expected 1937 reconciliation rows, found ${rows?.length ?? "none"}`);
}

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const reconciliation = workbook.worksheets.add("Reconciliation");
const screenshot = workbook.worksheets.add("Screenshot Verification");
const titleFill = "#1F2937";
const accentFill = "#C8102E";
const headerFill = "#E5E7EB";
const warningFill = "#FEF3C7";
const fontFamily = "Aptos";

function styleTitle(sheet, range) {
  range.format.fill = titleFill;
  range.format.font = { bold: true, color: "#FFFFFF", size: 16, name: fontFamily };
  range.format.rowHeight = 28;
}

function styleHeader(range) {
  range.format.fill = headerFill;
  range.format.font = { bold: true, color: "#111827", name: fontFamily };
  range.format.borders = { preset: "all", style: "thin", color: "#9CA3AF" };
  range.format.wrapText = true;
  range.format.verticalAlignment = "center";
}

summary.showGridLines = false;
summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["PAWS BETA-R4D-9J Session Time Reconciliation"]];
styleTitle(summary, summary.getRange("A1:F1"));
summary.getRange("A2:F2").merge();
summary.getRange("A2").values = [["Authoritative, source-backed review of all 1,937 Azure SQL sessions. No faculty/account PII included."]];
summary.getRange("A2:F2").format.font = { italic: true, color: "#4B5563", name: fontFamily };

summary.getRange("A4:B4").values = [["Source", "SHA-256"]];
styleHeader(summary.getRange("A4:B4"));
const sourceRows = Object.values(payload.sources).map((source) => [source.fileName, source.sha256]);
summary.getRangeByIndexes(4, 0, sourceRows.length, 2).values = sourceRows;
summary.getRange(`A5:B${4 + sourceRows.length}`).format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };

const metricsStart = 9;
summary.getRange(`A${metricsStart}:C${metricsStart}`).values = [["Metric", "Recorded", "Workbook formula check"]];
styleHeader(summary.getRange(`A${metricsStart}:C${metricsStart}`));
const metrics = [
  ["Total current sessions", payload.summary.totalSessions, `=COUNTA(Reconciliation!A2:A${rows.length + 1})`],
  ["Unique SessionIds", payload.summary.uniqueSessionIds, payload.summary.uniqueSessionIds],
  ["Current grid-positionable", payload.summary.currentGridPositionable, payload.summary.currentGridPositionable],
  ["Current early-clock", payload.summary.currentEarlyClock, payload.summary.currentEarlyClock],
  ["Current reversed", payload.summary.currentReversed, payload.summary.currentReversed],
  ["Current 00:00 sentinel", payload.summary.currentMidnightSentinel, payload.summary.currentMidnightSentinel],
  ["Deterministic source matches", payload.summary.deterministicSourceMatches, `=COUNTIF(Reconciliation!H2:H${rows.length + 1},"YES")`],
  ["Deterministic corrections", payload.summary.deterministicCorrections, `=COUNTIF(Reconciliation!N2:N${rows.length + 1},"YES")`],
  ["Already correct", payload.summary.alreadyCorrect, `=COUNTIF(Reconciliation!Q2:Q${rows.length + 1},"MATCH_ALREADY_CORRECT")`],
  ["Ambiguous", payload.summary.ambiguous, `=COUNTIF(Reconciliation!Q2:Q${rows.length + 1},"SOURCE_AMBIGUOUS")+COUNTIF(Reconciliation!Q2:Q${rows.length + 1},"MULTIPLE_TIMETABLE_MATCHES")`],
  ["Unmatched", payload.summary.unmatched, `=COUNTIF(Reconciliation!Q2:Q${rows.length + 1},"NO_TIMETABLE_MATCH")`],
  ["Supporting audit matches", payload.summary.supportingAuditMatches, `=COUNTIF(Reconciliation!S2:S${rows.length + 1},"YES")`],
];
summary.getRangeByIndexes(metricsStart, 0, metrics.length, 2).values = metrics.map(([label, recorded]) => [label, recorded]);
summary.getRangeByIndexes(metricsStart, 2, metrics.length, 1).formulas = metrics.map(([, , formula]) => [typeof formula === "string" ? formula : `=${formula}`]);
summary.getRange(`A${metricsStart + 1}:C${metricsStart + metrics.length}`).format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
summary.getRange(`A${metricsStart + 1}:A${metricsStart + metrics.length}`).format.font = { name: fontFamily };
summary.getRange(`B${metricsStart + 1}:C${metricsStart + metrics.length}`).setNumberFormat("0");

const legendStart = metricsStart + metrics.length + 3;
summary.getRange(`A${legendStart}:B${legendStart}`).values = [["Classification", "Meaning"]];
styleHeader(summary.getRange(`A${legendStart}:B${legendStart}`));
const legendRows = [
  ["MATCH_ALREADY_CORRECT", "Unique authoritative match; current interval already exact."],
  ["DETERMINISTIC_TIME_CORRECTION", "Unique authoritative match; reviewed time update is allowed."],
  ["UNKNOWN_TIME_CONFIRMED_BY_TIMETABLE", "00:00 sentinel replaced only by a unique exact source match."],
  ["SOURCE_AMBIGUOUS", "Multiple current sessions share one semantic source key; no update."],
  ["MULTIPLE_TIMETABLE_MATCHES", "Multiple authoritative intervals remain; no update."],
  ["NO_TIMETABLE_MATCH", "No exact controlled-normalization match; no update."],
  ["LEGITIMATE_OUT_OF_WINDOW", "Authoritative interval is genuinely outside the grid."],
  ["OTHER_DATA_DEFECT", "Source or interval defect requires separate review."],
];
summary.getRangeByIndexes(legendStart, 0, legendRows.length, 2).values = legendRows;
summary.getRange(`A${legendStart + 1}:B${legendStart + legendRows.length}`).format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
summary.getRange("A:A").format.columnWidth = 34;
summary.getRange("B:B").format.columnWidth = 74;
summary.getRange("C:C").format.columnWidth = 24;
summary.freezePanes.freezeRows(2);

const columns = [
  "SessionId", "Date", "CourseCode", "SessionType", "PAWS_Topic", "CurrentStart", "CurrentEnd",
  "TimetableMatched", "TimetableTopic", "TimetableStart", "TimetableEnd", "MatchMethod", "Confidence",
  "CorrectionRequired", "ProposedStart", "ProposedEnd", "Classification", "Evidence", "AuditMatched",
  "AuditMatchMethod", "AuditConfidence",
];
const matrix = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))];
reconciliation.getRangeByIndexes(0, 0, matrix.length, columns.length).values = matrix;
styleHeader(reconciliation.getRangeByIndexes(0, 0, 1, columns.length));
reconciliation.tables.add(`A1:U${matrix.length}`, true, "SessionReconciliationTable");
reconciliation.freezePanes.freezeRows(1);
reconciliation.freezePanes.freezeColumns(4);
reconciliation.getRange(`A1:U${matrix.length}`).format.font = { name: fontFamily, size: 9 };
reconciliation.getRange(`E2:E${matrix.length}`).format.wrapText = true;
reconciliation.getRange(`I2:I${matrix.length}`).format.wrapText = true;
reconciliation.getRange(`R2:R${matrix.length}`).format.wrapText = true;
reconciliation.getRange(`N2:N${matrix.length}`).conditionalFormats.add("containsText", { text: "YES", format: { fill: "#FDE68A", font: { color: "#92400E", bold: true } } });
reconciliation.getRange("A:A").format.columnWidth = 38;
reconciliation.getRange("B:B").format.columnWidth = 12;
reconciliation.getRange("C:D").format.columnWidth = 12;
reconciliation.getRange("E:E").format.columnWidth = 42;
reconciliation.getRange("F:G").format.columnWidth = 12;
reconciliation.getRange("H:H").format.columnWidth = 16;
reconciliation.getRange("I:I").format.columnWidth = 42;
reconciliation.getRange("J:K").format.columnWidth = 12;
reconciliation.getRange("L:L").format.columnWidth = 32;
reconciliation.getRange("M:P").format.columnWidth = 15;
reconciliation.getRange("Q:Q").format.columnWidth = 34;
reconciliation.getRange("R:R").format.columnWidth = 64;
reconciliation.getRange("S:U").format.columnWidth = 24;

const screenshotTopics = new Set([
  "Dystocia", "Clinical Pathology - Renal 2", "Student Supports at UCVM", '"Exploring Wellness Resources',
  "Exploring Wellness Resources", "Clinical Pathology - Minerals", "Companion Rodents",
  "Clinical Pathology - Endocrine 1", "Building a Wellness Toolkit Assignment", "Fluids (pharm)",
  "Biomechanics", "Renal pharmacology (pharm)", "Movement/Gait--Theory",
]);
const screenshotRows = rows.filter((row) => ["2026-09-21", "2026-09-22"].includes(row.Date) && screenshotTopics.has(row.PAWS_Topic));
screenshot.getRange("A1:J1").merge();
screenshot.getRange("A1").values = [["Screenshot-Specific Authoritative Reconciliation"]];
styleTitle(screenshot, screenshot.getRange("A1:J1"));
const shotColumns = ["Date", "CourseCode", "SessionType", "PAWS_Topic", "CurrentStart", "CurrentEnd", "ProposedStart", "ProposedEnd", "Classification", "AuditMatched"];
const shotMatrix = [shotColumns, ...screenshotRows.map((row) => shotColumns.map((column) => row[column] ?? ""))];
screenshot.getRangeByIndexes(2, 0, shotMatrix.length, shotColumns.length).values = shotMatrix;
styleHeader(screenshot.getRangeByIndexes(2, 0, 1, shotColumns.length));
screenshot.tables.add(`A3:J${shotMatrix.length + 2}`, true, "ScreenshotVerificationTable");
screenshot.freezePanes.freezeRows(3);
screenshot.getRange("A:A").format.columnWidth = 14;
screenshot.getRange("B:C").format.columnWidth = 12;
screenshot.getRange("D:D").format.columnWidth = 48;
screenshot.getRange("E:H").format.columnWidth = 14;
screenshot.getRange("I:I").format.columnWidth = 34;
screenshot.getRange("J:J").format.columnWidth = 14;
screenshot.getRange(`I4:I${shotMatrix.length + 2}`).format.fill = warningFill;

workbook.recalculate();
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const inspection = await workbook.inspect({ kind: "workbook,sheet,table,formula", maxChars: 12000, tableMaxRows: 5, tableMaxCols: 8 });
await fs.writeFile(path.join(previewDir, "inspection.txt"), inspection.ndjson ?? String(inspection), "utf8");
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, maxChars: 8000 });
await fs.writeFile(path.join(previewDir, "formula-errors.txt"), errors.ndjson ?? String(errors), "utf8");

for (const [sheetName, range] of [["Summary", "A1:F35"], ["Reconciliation", "A1:U35"], ["Screenshot Verification", "A1:J20"]]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName.replaceAll(" ", "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, rowCount: rows.length, screenshotRowCount: screenshotRows.length, previewDir }));
