# UCVM Project and Database Performance Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Secure the deployed asset boundary, reduce routine Firestore reads, remove verified dead code and duplicate data, and preserve the existing UI and business behavior.

**Architecture:** Generate both hosting packages from one explicit asset manifest. Replace eager whole-collection reads with a derived faculty index, schedule statistics, `facultyIds` session keys, and request-targeted document reads. Apply destructive cleanup only through an idempotent audited migration backed by a typed Firestore export.

**Tech Stack:** Static HTML/CSS/JavaScript, Firebase Auth, Firestore compat SDK, Firebase Hosting, Azure Static Web Apps, Node.js test runner, Firestore/Auth emulators, PowerShell deployment, Firestore REST API.

**Spec:** `docs/superpowers/specs/2026-09-13-project-database-performance-cleanup-design.md`

## Global Constraints

- Preserve all current UI navigation, visible fields, role behavior, exports, AFC, Swap, DOE, History, timeout, and refresh protection.
- Preserve every business record and audit/history record.
- Database cleanup requires a verified typed JSON backup and dry run.
- A DOE compatibility field is removed only when its canonical `doe` value exists and is equal.
- Firebase and Azure must publish the same allowlisted application assets.
- `.git`, tests, tools, rules, indexes, logs, docs, and local output must be unreachable from both hosts.
- Keep the root AFC PDF template because the Spark client renders AFC PDFs from it.

---

### Task 1: Allowlisted static deployment

**Files:**
- Create: `tools/static-assets.json`
- Create: `tools/build-static.js`
- Create: `tests/hosting-boundary.test.js`
- Modify: `firebase.json`
- Modify: `tools/deploy_azure_static_web.ps1`

**Interfaces:**
- Consumes: repository-root application files.
- Produces: `.deploy-static/` containing only manifest entries; `buildStatic(outputDir)` validates every source and rejects unsafe paths.

- [ ] **Step 1: Write a failing hosting-boundary test**

Assert that `firebase.json` uses `.deploy-static`, both deployment paths consume `tools/static-assets.json`, required app assets are present, and forbidden path probes are absent from the manifest.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/hosting-boundary.test.js`  
Expected: FAIL because the manifest and builder do not exist.

- [ ] **Step 3: Implement the manifest and builder**

The manifest contains only the HTML, JavaScript, CSS, and root AFC PDF needed by the pages. `tools/build-static.js` removes and recreates `.deploy-static`, verifies every resolved source stays inside the repository, copies files, and prints file count and byte count. Configure Firebase Hosting `public` as `.deploy-static` and invoke the builder through `hosting.predeploy`. Update the Azure packaging script to call the same builder and deploy the generated directory.

- [ ] **Step 4: Verify and deploy the containment fix**

Run the focused test, `node tools/build-static.js`, and Firebase deploy. Probe `/`, `/approval-workflow.js`, `/.git/HEAD`, `/firestore.rules`, `/tests/policy.test.js`, and `/tools/export_firestore_rest.py`. Required assets must return 200; forbidden paths must return 404.

- [ ] **Step 5: Commit the containment change**

Commit message: `Secure static hosting asset boundary`

### Task 2: Shared indexing model and migration tests

**Files:**
- Create: `data-index.js`
- Create: `tests/data-index.test.js`
- Modify: `index.html`
- Modify: `faculty-admin.html`
- Modify: `user-management.html`

**Interfaces:**
- Produces: `UCVM_DATA_INDEX.facultyEntry(id, faculty, sessionStats)`, `UCVM_DATA_INDEX.facultySearchText(faculty)`, `UCVM_DATA_INDEX.sessionFacultyIds(session)`, `UCVM_DATA_INDEX.buildFacultyIndex(facultyRows, sessions)`, and `UCVM_DATA_INDEX.scheduleStats(sessions)`.

- [ ] **Step 1: Write failing pure-function tests**

Cover name/rank/campus/department/specialty search text, DOE override presence, unique faculty IDs derived from assignments, stable sorted index output, session counts, and records with missing optional fields.

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test tests/data-index.test.js`  
Expected: FAIL because `data-index.js` does not exist.

- [ ] **Step 3: Implement the pure indexing module**

Expose a CommonJS export for tests and `window.UCVM_DATA_INDEX` in browsers. Do not access Firebase from this module.

- [ ] **Step 4: Load the module on affected pages and verify tests**

Add the script before page-specific code. Run the focused tests and the existing static tests.

- [ ] **Step 5: Commit the shared model**

Commit message: `Add shared faculty and session index model`

### Task 3: Maintain derived index fields on every write path

**Files:**
- Create: `tests/index-maintenance.test.js`
- Modify: `index.html`
- Modify: `faculty-admin.html`
- Modify: `user-management.js`
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: Task 2 indexing functions.
- Produces: `settings/faculty_index`, `settings/schedule_stats`, and `sessions[].facultyIds` kept current by edit, swap, bulk-add, full synchronization, faculty edit, and account routing paths.

- [ ] **Step 1: Write failing maintenance and rule tests**

Assert every session write derives `facultyIds`; full imports rebuild both settings documents; faculty edits patch/rebuild the faculty index; non-admin roles cannot forge derived settings.

- [ ] **Step 2: Run focused static and emulator tests and verify failure**

Run: `node --test tests/index-maintenance.test.js` plus the emulator security suite.

- [ ] **Step 3: Implement atomic/bounded maintenance**

Use `UCVM_DATA_INDEX.sessionFacultyIds(next)` before each session write. Full replacement writes index/stat documents after session and faculty batches succeed. Single-record changes update the relevant index entry with a transaction or rebuild from the already-loaded authoritative data. Add the array index required for `facultyIds array-contains` combined with date ordering only if the implemented query requires it.

- [ ] **Step 4: Run focused and full tests**

All index maintenance and permission assertions must pass.

- [ ] **Step 5: Commit maintenance paths**

Commit message: `Maintain Firestore lookup indexes`

### Task 4: Replace eager reads with targeted reads

**Files:**
- Create: `tests/targeted-reads.test.js`
- Modify: `faculty-admin.html`
- Modify: `user-management.js`
- Modify: `approval-workflow.js`
- Modify: `availability-lookup.js`
- Modify: `tests/read-efficiency.test.js`

**Interfaces:**
- Consumes: `settings/faculty_index`, `settings/schedule_stats`, and session `facultyIds`.
- Produces: `loadFacultyDetail(id)`, `listenFacultySessions(id)`, and `ensureRequestSessions(requests)` with promise caching and stale-request protection.

- [ ] **Step 1: Write failing query-shape tests**

Reject unconditional Faculty Admin `faculty.onSnapshot()` and `sessions.onSnapshot()`. Require the index reads, faculty document-by-ID read, `facultyIds array-contains` session query, and request session ID reads.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/targeted-reads.test.js tests/read-efficiency.test.js`.

- [ ] **Step 3: Implement index-first Faculty Admin and User Management**

Render the directory from the index. Fetch full detail and matching sessions on selection. Preserve deep Lookup search through index search text. Load full role detail only when the Roles tab is opened. Keep a one-release fallback only when the index document is missing.

- [ ] **Step 4: Implement request-targeted approval loading**

Fetch only session IDs missing from the current visible-session map. Do not call `allSessions()` from approval impact rendering.

- [ ] **Step 5: Verify UI and read tests**

Run focused tests, full tests, and local browser checks for Lookup, Roles, DOE, approval impact, and search parity.

- [ ] **Step 6: Commit targeted reads**

Commit message: `Load faculty and approval data on demand`

### Task 5: Idempotent database migration and cleanup

**Files:**
- Create: `tools/optimize_firestore_data.py`
- Create: `tests/firestore-cleanup.test.js`
- Modify: `tools/README.md`

**Interfaces:**
- CLI: `python tools/optimize_firestore_data.py --project tester-teaching --backup PATH --dry-run` and the same command with `--apply --actor-uid UID --actor-name NAME`.
- Produces: aggregate JSON report, bounded Firestore commits, one `account_audit` cleanup record, and post-run verification.

- [ ] **Step 1: Write failing fixture tests**

Cover `facultyIds` backfill, redundant session provenance removal, equal canonical DOE removal, unequal DOE preservation/reporting, completed migration marker removal, idempotency, and retention of all business/audit document paths.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/firestore-cleanup.test.js`.

- [ ] **Step 3: Implement decoder, planner, and REST commit writer**

Reuse the Firebase CLI token pattern from `export_firestore_rest.py`. Dry run must not issue commits. Apply mode requires the backup path and actor values, validates the backup project/hash, commits at most 300 writes per request, and writes aggregate counts without copying private field values into logs.

- [ ] **Step 4: Create fresh backup and run dry run**

Export top-level collections, record SHA-256 and counts, then produce the cleanup report. Review mismatch counts; any DOE mismatch remains untouched.

- [ ] **Step 5: Apply and verify migration**

Apply the plan, export again, and compare collection/document identities. Only the completed marker document may disappear; business and history counts must be unchanged. Verify every session has correct `facultyIds` and every removed DOE field had an equal canonical value in the backup.

- [ ] **Step 6: Commit migration tooling**

Commit message: `Add audited Firestore optimization migration`

### Task 6: Remove dead runtime and repository code

**Files:**
- Create: `tests/runtime-assets.test.js`
- Modify: `index.html`
- Modify: `faculty-admin.html`
- Modify: `SETUP.md`
- Modify: `tools/README.md`
- Delete: `tools/migrate_assigned_ad_rest.js`
- Delete: `functions/index.js`
- Delete: `functions/afc-pdf.js`
- Delete: `functions/afc-policy.js`
- Delete: `functions/bootstrap-general.js`
- Delete: `functions/templates/absence-from-campus-app.pdf`
- Delete or replace: `functions/package.json`, `functions/package-lock.json`, unused callable-only portions of `tests/security-emulator.test.js`
- Delete locally: `.afc-sample.js`, `.faculty-admin-inline.js`, `firestore-debug.log`, `output/`, and generated render artifacts.

**Interfaces:**
- Produces: one development dependency location retaining Firebase CLI, Firebase client test SDK, and rules-unit-testing; no undeployed callable implementation.

- [ ] **Step 1: Write failing runtime asset tests**

Assert pages do not load `firebase-functions-compat.js`, the active AFC client remains present, the root PDF remains in the deployment manifest, and no deployed script references callable-only exports.

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/runtime-assets.test.js`.

- [ ] **Step 3: Remove dead code and reorganize development dependencies**

Preserve Firestore rule tests and their dependencies. Update commands in documentation and deployment scripts. Remove only callable-specific tests.

- [ ] **Step 4: Remove completed migration code and local artifacts**

Delete `runDirectoryMigration` and its invocation. Do not remove audit labels for the completed historical action.

- [ ] **Step 5: Run dependency install, focused tests, and full emulator suite**

The lockfile install and all retained tests must pass from documented commands.

- [ ] **Step 6: Commit dead-code cleanup**

Commit message: `Remove undeployed and completed migration code`

### Task 7: Split oversized pages and lazy-load AFC dependencies

**Files:**
- Create: `timetable.css`
- Create: `timetable.js`
- Create: `faculty-admin.css`
- Create: `faculty-admin.js`
- Create: `asset-loader.js`
- Create: `tests/page-modules.test.js`
- Modify: `index.html`
- Modify: `faculty-admin.html`
- Modify: `faculty-dashboard.html`
- Modify: `faculty-dashboard.js`
- Modify: `tools/static-assets.json`

**Interfaces:**
- Produces: `UCVM_ASSETS.loadScriptOnce(url, globalName)` and `UCVM_ASSETS.ensureAfcPdf()`; HTML files contain structure and bootstrap only.

- [ ] **Step 1: Write failing module-boundary tests**

Set maximum inline script/style sizes, require named assets, and require PDF-lib to be absent from initial page markup.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/page-modules.test.js`.

- [ ] **Step 3: Extract page code without behavior changes**

Move the existing timetable and Faculty Admin inline blocks verbatim first, update script order, then run tests before consolidating helpers.

- [ ] **Step 4: Add lazy AFC dependency loading**

Load PDF-lib immediately before `UCVM_AFC_PDF.render`; cache the promise and return clear errors on load failure. Signature capture remains local code and must not contact a third party.

- [ ] **Step 5: Consolidate duplicated helpers**

Move shared role/name/DOE/date/assignment normalization into the existing `UCVM` namespace, updating callers one helper family at a time with focused tests after each change.

- [ ] **Step 6: Run full tests and browser parity checks**

Verify all views and actions listed in Global Constraints.

- [ ] **Step 7: Commit modularization**

Commit message: `Modularize timetable and faculty admin pages`

### Task 8: Final deployment, metrics, and Git history containment

**Files:**
- Modify: `SETUP.md`
- Modify: `tools/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: verified Firebase/Azure release, before/after metrics, a local Git bundle backup, and a repository free of historical private data blobs.

- [ ] **Step 1: Run final automated verification**

Run JavaScript syntax checks, every Node test, the Firestore/Auth emulator suite, the static builder, and `git diff --check`.

- [ ] **Step 2: Deploy Firebase and Azure**

Deploy the same manifest build to both hosts. Verify content hashes for application assets and 404 responses for forbidden paths.

- [ ] **Step 3: Run live browser verification**

Check role routing, timetable views, Faculty Lookup/detail/search, DOE override, Change History scope, AFC, Swap highlight, approval queue, exports, and console errors without approving or rejecting real requests.

- [ ] **Step 4: Measure reads and payloads**

Record actual query result counts for clean login, one Faculty selection, User Management, and Approval Queue. Compare with the baseline.

- [ ] **Step 5: Prepare Git history cleanup**

Create and verify an external `git bundle --all`. Produce the exact history rewrite file list and verify the rewritten clone before changing the remote.

- [ ] **Step 6: Perform action-time repository changes**

Immediately before changing GitHub visibility or force-updating history, verify the target repository and backup bundle. Change the repository to private, remove historical faculty-summary and old schedule-data files from all revisions, force-update the remote, and verify a fresh clone.

- [ ] **Step 7: Publish final documentation and commit**

Document deployment, migration hash/counts, retained data, removed fields, measured reads, rollback locations, and verification evidence. Commit message: `Complete project and database performance cleanup`
