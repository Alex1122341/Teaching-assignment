# Task14 CCC Full Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, sequentially; one independent whole-branch review.

**Goal:** Implement exact, atomic whole-year CCC Calendar replacement with stale-safe preview and private recovery.
**Architecture:** Reuse CalendarActivity and staging provenance, existing faculty locks and bounded workbook parsing. Separate source parser/commands from the completed AFC migration; no append semantics.
**Tech Stack:** Node22/ExcelJS/worker_threads, SQL Server, vanilla JS/node:test.
**Spec:** docs/superpowers/specs/2026-10-17-ccc-full-replacement-design.md

## Global constraints

- Dataset `ccc-calendar`, YYYY-YY scope May1–April30; crossing existing targets block.
-512KiB/5000 rows/16MiB expansion/128MiB worker/10s/max2 workers; six exact template headers.
- Live SQL/API admin checks, independent cccReplaceStage/cccReplaceCommit default false, no faculty/course guesses.
- Preserve540 migration/AFC/other categories/roles/DOE; no live replacement without new approved source/exact preview.

## Review focus

- Same person named and keyed twice is one duplicate:Task2 resolved identity duplicate tests.
- Phantom CCC insert between preview/commit invalidates complete set:Task2 concurrent scope tests.
- Existing cross-year range or resolved time must not be lost:Task2 protected-target tests.
- Response loss after commit must return same receipt:Task2 exact replay andTask3 same-key retry.
- Uploaded workbook cannot modify old import allowlist:Task1 original parser regression.

### Task1: strict workbook parser

Files:server/src/calendar/workbook-safety.js (extract shared verifyArchive/dateValue/hasFormula),ccc-workbook.js,ccc-workbook-worker.js; modify activity-workbook-worker.js import only. Tests:server/test/ccc-workbook.test.js,existing calendar-activity-workbook.test.js.
Produces parseCccWorkbook(buffer,academicYear)->{sourceSha256,academicYear,sheetName,rows}; rows sourceRow/facultySourceId/facultySourceName/startDate/endDate/courseCode/label/issues. No source trust inferred.
- [ ] RED synthetic valid/malformed/formula/duplicate/year/empty/limit workbook tests.
- [ ] Implement utility extraction and bounded new parser, GREEN old+new parser suites; commit.

### Task2: stage/preview/atomic replacement/recovery

Files:database/azure-sql/049_ccc_full_replacement.sql,049_ccc_full_replacement_acceptance.sql,rollback_049_ccc_full_replacement.sql;server/src/data/sql-ccc-replacement-repository.js;server/src/calendar/ccc-replacement-api.js;server/src/runtime/swa-ccc-replacement-functions.js;tools/test-ccc-replacement-sql.ps1. Modify runtime/HTTP/write gates/client/history projection and SQL CI/permission contract.
Produces stage/get/preview/commit and private SQL recover. Preview response batchId/academicYear/dataset/sourceSha256/previewVersion/manifestSha256/expiresAtUtc/rows/targets/issues/counts; safe receipt receiptId/deletedCount/insertedCount/committedAtUtc/idempotentReplay only.
- [ ] RED API role/gate/strict bindings and SQL contract tests.
- [ ] SQL uses staging.CccReplacement/existing source tables, resolves identity/course, binds complete snapshot15min, serializable year+faculty locks, protects refs/time/cross-year, atomic delete/insert/private receipt/audit; exact idempotency and recovery guards. No broad membership grants.
- [ ] Isolated SQL tests cover valid replacement, source problems, concurrent/expired preview, revoked actor, injected failure, retries, unrelated hashes and guarded recovery. Run via safe labeled-container runner; commit when GREEN.
- [ ] API routes and client typed payload allowlists; max1MiB exact stage only; no recovery browser endpoint. Add history events with proven affected faculty and no recovery payload exposure.

### Task3: admin page flow

Files:faculty-admin-ccc-replacement.js;modify faculty-admin.html/.js/.css,static allowlist. Tests:tests/ccc-replacement-ui.test.js,ccc-replacement-client.test.js.
- [ ] RED year/file/complete preview/blocking rows/explicit confirmation/stale/conflict/same-key/auth switch tests.
- [ ] Implement using existing import layout; full counts, old/new rows, unresolved data visible, complete-year acknowledgment; keep old migration entry unchanged and closed.
- [ ] Real synthetic Chrome desktop/mobile QA with backend parser, clear console, fixed controls; preserve original AFC/work/DOE flows; commit.

### Task4: complete review/release/acceptance inventory

- [ ] Full root/server/SQL/emulator suites and independent branch review; fix findings test-first.
- [ ] Separate reviewed freeze promotion, PR+exact-main CI/artifact comparison, stage SQL/API/Hosting coherent release. Re-pin recovery config to accepted runtime after cutover.
- [ ] Read-only live Task13/filter/Calendar verification; no migration replay. No invented live PDF or CCC replacement.
- [ ] Update original Excel12–14 factual capability/live/data/manual status and audit all25 tasks. Prepare actionable full outstanding acceptance list grouped into deployed-but-unaccepted, implemented-but-unreleased, and human/source-dependent. Preserve manual reviewer/date/results.
