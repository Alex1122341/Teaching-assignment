# BETA-R4D-11A Dashboard UI + DOE + Faculty Course Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the useful read-only Dashboard profile, grouped course/session experience, DOE evidence, and admin read-only tabs on the Azure SQL/API architecture without reintroducing Firestore.

**Architecture:** Keep Firebase Auth and `paws-data-client.js` as the only browser data path. Add only GET, server-authorized SQL aggregate routes needed for cross-faculty read-only tabs; keep faculty detail lazy and render stored DOE values without policy recalculation.

**Tech Stack:** Plain HTML/CSS/JavaScript, Azure SQL read repository, Node `node:test`, existing Firebase-authenticated PAWS client.

**Spec:** `C:/Users/xinyu/.codex/attachments/7cc3fd61-815d-4fd0-a865-653a0c11f642/已粘贴的文本.txt`

## Global Constraints

- Browser remains Firebase Authentication → PAWS API → Azure SQL.
- No Firestore SDK, Firestore reads, fallback, or writes on the Dashboard runtime.
- Dashboard mutations/imports/rule editing remain absent and read-only.
- No schema migration, SQL write, deployment, merge, baseline promotion, or live Azure mutation.
- Self-service roles remain server-scoped to their own FacultyId.
- Stored `DoeCredit` and stored role DOE are authoritative; no browser policy engine or recalculation.
- Current frozen baseline `25e8f483b7d2455c0f96b00c82f3fde30760ac17` is not edited or promoted.

## Review Focus

- Null, zero, and negative DOE values remain distinguishable and visible.
- Missing DOE lines mark a summary partial/needs-review instead of becoming zero.
- Course/session grouping is deterministic by curriculum year, course code, date, start time, and session id.
- Self-service rendering cannot load or display another FacultyId.
- Aggregate tabs never fan out into N+1 faculty detail calls.

### Task 1: Pure dashboard view models and DOE aggregation

**Files:**
- Create: `dashboard-view-model.js`
- Test: `tests/dashboard-view-model.test.js`

**Interfaces:**
- Produces `groupTeachingAssignments(assignments)`, `effectiveRoleDoe(role)`, `summarizeDoe(detail)`, and `formatDoe(value)` for the UI.

- [x] Write failing tests for year/course grouping, deterministic session sorting, stored DOE-only totals, null/zero/negative override semantics, and partial status.
- [x] Run the focused test file and observe the expected failures.
- [x] Implement the pure helpers with no DOM, network, or Firebase dependencies.
- [x] Re-run focused tests and the existing DOE regression tests.
- [x] Commit the model and tests.

### Task 2: Read-only aggregate API for admin tabs

**Files:**
- Modify: `server/src/data/sql-dashboard-repository.js`
- Modify: `server/src/data/dashboard-api.js`
- Modify: `server/src/runtime/swa-dashboard-functions.js`
- Modify: `server/src/runtime/swa-sql-runtime.js` only if route wiring requires it
- Test: `server/test/dashboard-api-r4d11a.test.js`

**Interfaces:**
- Produces `GET /api/v1/dashboard/teaching-summary`, `GET /api/v1/dashboard/roles`, and `GET /api/v1/dashboard/doe-overview`; all are administrator-only, parameterized, SQL read-only, and self-service/denied roles receive 403.

- [x] Write failing route/repository tests for authorization, empty/null/zero/negative DOE, exact HICC/VISC vocabulary, malformed academic year, and no N+1 query shape.
- [x] Run the server test file and observe failures.
- [x] Implement SQL aggregation over existing `paws` tables/views only; use stored values and effective override semantics.
- [x] Wire GET-only routes and client-facing response DTOs.
- [x] Re-run focused server tests and the full server suite.
- [x] Commit the API changes.

### Task 3: API client, tabs, rich profile, grouped courses, and self-service UI

**Files:**
- Modify: `paws-data-client.js`
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.js`
- Modify: `faculty-admin.css`
- Test: `tests/faculty-admin-r4d11a-ui-parity.test.js`
- Update: existing Stage 3 Dashboard tests whose assertions intentionally describe the retired lookup-only UI.

**Interfaces:**
- Consumes the Task 1 view-model helpers and Task 2 aggregate methods.
- Produces lazy `dashboardTeachingSummary`, `dashboardRoles`, and `dashboardDoeOverview` client methods; tabbed admin UI; structured self-service profile.

- [x] Write failing UI/static tests for four tabs, no imports/CRUD/rule editor, rich profile order, year→course→session details, DOE evidence, no Firestore dependencies, and bounded initial requests.
- [x] Run the focused UI tests and observe failures.
- [x] Implement client methods with existing bearer/error handling and no fallback.
- [x] Implement tab markup and lazy tab loaders; preserve the current `/me`, roster, detail cache, and self-service scope.
- [x] Implement rich profile and grouped course/session rendering using stored DOE fields.
- [x] Add responsive styles and truthful partial/needs-review states.
- [x] Re-run focused UI tests; existing Stage 3 tests retain two obsolete source-shape assertions for the retired lookup-only UI.
- [x] Commit the UI changes.

### Task 4: Documentation, governance drift evidence, and final verification

**Files:**
- Create: `agent.Ai/PROJECT_STATE.md` update entry
- Create: `agent.Ai/TASK_CHAIN.md` update entry
- Create: `agent.Ai/updates/2026-09-28-beta-r4d11a-dashboard-ui-doe-parity.md`

- [x] Run `node --check` on every changed JavaScript file and `git diff --check`.
- [x] Run `npm test`, `npm test --prefix server`, and `node tools/beta-freeze.js`; classify every failure and record intentional protected-runtime drift only (including the new shipped view-model asset absent from the older baseline).
- [x] Verify no Firebase Firestore SDK or legacy Dashboard dependency was added to `faculty-admin.html`/`faculty-admin.js`/`paws-data-client.js`.
- [x] Review the complete branch diff, commit documentation, and report the final SHA without creating a PR or deployment.
