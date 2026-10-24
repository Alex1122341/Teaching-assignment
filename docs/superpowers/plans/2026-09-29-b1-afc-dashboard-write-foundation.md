# B1 AFC Dashboard Write Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a non-live, least-privilege Azure SQL AFC manual-record foundation with unified reads, administrator-only GET/POST API access, and an admin Dashboard AFC Records tab while preserving the B0 read-only and Firestore containment boundaries.

**Architecture:** Keep imported `paws.AfcRecord` immutable and add manual rows to `paws.AfcManualRecord`. Expose both through `paws.vAfcRecordUnified`; perform writes only through static `paws_api.CreateAfcRecord`, which atomically writes the manual row and existing `paws.AuditEvent`. The server API remains the authorization boundary, and the browser receives only explicit AFC client methods and an administrator-only UI.

**Tech Stack:** SQL Server migration/procedure scripts, Node.js CommonJS API/runtime, vanilla HTML/CSS/JavaScript, Node test runner.

**Spec:** Architect instruction `PAWS BETA-R4D-12B1 AFC LINE-BY-LINE + ISOLATED SQL CREATE-WRITE FOUNDATION` in the architect3 conversation.

## Global Constraints

- Base exactly `68cd57074bbcf7916da6a031a238175d5530ae0b`; stop if `origin/main` moves.
- Work only on `feature/beta-r4d12b1-afc-dashboard-write-foundation`.
- B0 remains live/closed; no SQL apply, permission apply, deployment, PR, merge, baseline promotion, or live data mutation.
- Preserve `sessionBackend() === 'azure-sql'` and `sessionWritesEnabled() === false`.
- Do not modify migrations 001–006, imported `paws.AfcRecord` provenance, authority/DOE/session domains, or Firestore workflows.
- Manual AFC writes are one-record-only, administrator-only, audit-backed, and procedure-only.
- All current and new tests must pass; intentional static/API freeze drift is reported, never hidden.

## Review Focus

- Migration 007 must not reference migration-005/006-only objects; pin this in migration contract tests.
- `Special`/`Other` notes and same-day ranges must be validated identically in SQL, API, and UI; pin boundary tests.
- Actor and request identifiers must be server-generated/trusted; pin a hostile-body test.
- Procedure execution must not imply direct table DML or broad schema EXECUTE; pin permission proof tests.
- AFC creation must not touch Firestore, sessions, authority, or DOE; pin B0/domain-isolation tests.

### Task 1: Baseline and test harness

**Files:** Create B1 contract tests and update continuity only after implementation; do not modify production code before a failing test exists.

- [ ] Verify `origin/main`, clean tree, exact starting SHA, and branch.
- [ ] Add focused tests for migration contracts, procedure security, repository boundaries, API auth/method/validation behavior, and client/UI contracts.
- [ ] Run each new focused test before implementation and confirm the expected RED failure.

### Task 2: SQL manual AFC foundation

**Files:**
- Create `database/azure-sql/007_afc_manual_write_foundation.sql`
- Create `database/azure-sql/007_afc_manual_write_permissions.sql`
- Create `database/azure-sql/007_afc_manual_write_least_privilege_proof.sql`
- Test with server/static SQL contract tests.

- [ ] Add rerun-safe `paws.AfcManualRecord` with required identity/date/reason/audit fields, FK to `paws.Faculty`, date/reason/notes checks, and bounded indexes.
- [ ] Add `paws.vAfcRecordUnified` with imported/manual source distinction and deterministic reason display.
- [ ] Add owned `paws_api` schema and static `paws_api.CreateAfcRecord` with exact parameters, server-side validation, `XACT_ABORT`, transaction, TRY/CATCH rollback, manual insert plus `AuditEvent` insert, and normalized result.
- [ ] Add proposal-only least-privilege grants/proof: unified-view SELECT and exact procedure EXECUTE only; retain direct DML and `paws` EXECUTE DENYs and staging denial.
- [ ] Verify migration/proof scripts contain no dynamic SQL, sample data, authority/DOE/session changes, or 005/006 dependencies.

### Task 3: Read and write repositories

**Files:**
- Modify `server/src/data/sql-dashboard-repository.js`
- Create `server/src/data/sql-afc-write-repository.js`
- Test repository query/procedure boundaries.

- [ ] Add bounded `listAfcRecords()` reading only `paws.vAfcRecordUnified`, joining `paws.Faculty` once, with deterministic sorting and max 2000.
- [ ] Change faculty detail, summary AFC count, and roster AFC count to the unified view while preserving imported fields and self-scope.
- [ ] Add `createAfcRecord()` that invokes only the hard-coded reviewed procedure with server-provided IDs/actor values; reject arbitrary SQL and direct DML patterns.

### Task 4: Dashboard API/runtime

**Files:**
- Modify `server/src/data/dashboard-api.js`
- Modify `server/src/runtime/swa-dashboard-functions.js`
- Modify `server/src/runtime/swa-sql-runtime.js`
- Modify `swa-api/index.js`
- Test API auth, validation, method, DTO, and runtime routing.

- [ ] Add administrator-only `GET /api/v1/dashboard/afc-records` and `POST /api/v1/dashboard/afc-records`.
- [ ] Preserve the existing role matrix and profile/password gates; self-service roles receive 403 for admin list/create; unauthenticated receives 401.
- [ ] Parse JSON safely, validate strict dates/UUID/reason/notes, generate `AfcRecordId` and `RequestId` with `crypto.randomUUID()`, and derive actor UID/name from decoded token and SQL profile.
- [ ] Return bounded error codes/statuses and map unexpected SQL failures to 503 without leaking SQL details; return 201 with the safe AFC DTO.
- [ ] Make only the AFC route accept GET/POST; all other methods return 405 with `Allow: GET, POST`, while all existing Dashboard routes remain GET-only.
- [ ] Wire the write repository into the runtime without changing timetable behavior.

### Task 5: Browser client and administrator UI

**Files:**
- Modify `paws-data-client.js`
- Modify `faculty-admin.html`
- Modify `faculty-admin.js` and any narrowly required CSS.
- Test client methods and UI source/DOM behavior.

- [ ] Add explicit `dashboardAfcRecords()` and `createDashboardAfcRecord(payload)` methods only; keep session write disabled.
- [ ] Add admin-only AFC Records tab with line-by-line imported/manual rows, filters, canonical FacultyId selector, fixed reason options, notes rules, same-day support, and no edit/delete controls.
- [ ] Disable Submit while in flight, show bounded saving/failure status, refresh from server on success, and refresh affected detail/KPI data without optimistic fabrication.
- [ ] Keep Faculty/HICC/VISC self-service detail reads and the timetable-side temporary AFC facade; do not re-enable Firestore/legacy submit.

### Task 6: Full verification, continuity, and handoff

**Files:**
- Create dated `agent.Ai/updates/2026-09-29-b1-afc-dashboard-write-foundation.md`
- Update `agent.Ai/PROJECT_STATE.md` and `agent.Ai/TASK_CHAIN.md` at the B1 breakpoint.

- [ ] Run focused B1 tests, `npm test --prefix server`, root `npm test`, available emulator/release gates, `git diff --check`, and `node --check` on changed JS.
- [ ] Run `node tools/beta-freeze.js` and `node tools/beta-api-freeze.js`; report exact intentional drift, do not modify baselines or manifests to hide it.
- [ ] Verify no SQL scripts were applied and no Azure/Firebase/Firestore/ACR/ACA/SWA mutation occurred.
- [ ] Commit `feat: add isolated SQL AFC create foundation` on the exact feature branch, push it, verify remote SHA, keep PR unopened, and report `READY FOR ARCHITECT B1 REVIEW` or the exact blocker.

