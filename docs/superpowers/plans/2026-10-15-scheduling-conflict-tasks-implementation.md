# Scheduling Conflict Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner already selected sequential native implementation followed by independent whole-branch review; do not ask them to select an execution method again.

**Goal:** Extend PAWS Tasks with authoritative scheduling conflicts, scoped filters and ADFA review that cannot hide unresolved conflicts.

**Architecture:** SQL derives current session-centered issues and stores review metadata separately. The authenticated API exposes an allowlisted DTO; the existing sidebar consumes it while retaining SWAP requests and out-of-grid navigation. Source versions and guarded transactions protect review commands from stale evidence.

**Tech Stack:** Existing vanilla JavaScript, CommonJS Node 22, node:test, SQL Server, PowerShell synthetic-container acceptance and Firebase Authentication. No new dependencies or Firestore business path.

**Spec:** `docs/superpowers/specs/2026-10-15-scheduling-conflict-tasks-design.md`, approved by owner on 2026-10-15, including ADFA-only review authority.

## Global Constraints

- Work only in Teaching-assignment-azure / Beta, current isolated worktree and feat/scheduling-conflict-tasks-20261015, from b53c23e; preserve the unrelated untracked race fixture.
- Read scope matches existing session API; only shared administrator-role aliases may review. ADC/LAB and faculty/HICC/VISC cannot review.
- “Reviewing or closing a task must never make a still-existing conflict disappear from the default queue.”
- “Missing/invalid times cannot establish a timed overlap.” Use Conflict and Needs Review independently from Unreviewed and Reviewed.
- No private AFC purpose/date-range, UCID, email, DOE, HR or canonical FacultyId in task responses, filter choices, counts or errors.
- Preserve existing SWAP, DOE, audit and scope behavior. Do not translate the conservative SWAP availability scalar directly into a confirmed conflict.
- Review writes require `PAWS_SCHEDULING_TASK_REVIEW_ENABLED === 'true'`; default is disabled. No role membership or live gate changes.
- No merge/release/live migration in this plan. Build/freeze promotion is a separate reviewed commit after product acceptance.
- Tests precede behavioral implementation. Each task uses RED → minimal GREEN → focused regression → commit. Do not claim full acceptance while runtime freeze is intentionally pending its separate review.

## Review Focus

1. Equal-looking source restored after correction must invalidate an old review: SQL source rowversion test in Task 2.
2. A shared session must not reveal a co-instructor's AFC issue to ordinary faculty: SQL and API tests in Tasks 1/3.
3. Undated sessions and a year with only undated problems must remain discoverable: scope/list tests in Tasks 1/4.
4. New source rows or permission changes during pagination must force refresh rather than skip or expose data: Tasks 1/3/4.
5. Concurrent source edits and two reviewers must not accept stale evidence or overwrite review: actual two-connection races in Tasks 2/5.

## File and interface map

- `database/azure-sql/043_scheduling_tasks.sql`: source version columns, typed issue projection, scoped list/read and review table/command/permissions. Corresponding `_acceptance.sql` and `rollback_043_scheduling_tasks.sql` exercise/undo this migration only.
- `server/src/data/sql-scheduling-task-repository.js`: parameterized procedure adapter and DTO allowlist.
- `server/src/scheduling/scheduling-task-api.js`: token/profile authorization, query/body validation, gate and safe errors.
- `server/src/runtime/swa-scheduling-task-functions.js`: method/path dispatch; register in existing `swa-sql-runtime.js`.
- `workspace-tasks.js` and `workspace.css`: extend current sidebar; no second page or parallel calendar.
- `paws-data-client.js`, `timetable.js`: API client methods and academic-year/navigation/refresh adapter.
- `tools/test-scheduling-task-sql.ps1`, `tools/test-scheduling-task-races.ps1`: reuse labeled disposable SQL boundary, never live connection settings.
- `.github/workflows/calendar-activity-sql.yml`: add scheduling acceptance before existing independent suites for early isolated execution; retain previous checks.

### Shared contract

`SchedulingTask` has `issueKey`, `facultyKey` (nullable), `displayName` (nullable), `courseCode`, `sessionId`, `relatedSessions` (safe id/course/date/startTime/endTime), `date`, `startTime`, `endTime`, `type`, `severity`, `reviewStatus`, `evidenceVersion`, `reviewVersion`, `canReview`. Opaque issue/evidence keys are 64-character hex digests; faculty keys reuse the existing sanitized key mapping, never canonical FacultyId. Review version is 16-character hex, all zeroes for no saved review.

Types: `instructor_overlap`, `afc_unavailable`, `duplicate_assignment`, `duplicate_session_assignment`, `invalid_schedule`, `missing_schedule`, `calendar_activity_overlap`, `calendar_time_unknown`. Severities: `Conflict`, `Needs Review`. Review statuses: `Unreviewed`, `Reviewed`.

List query: `{academicYear, start?, end?, undated?: 'include'|'only'|'exclude', facultyKey?, courseCode?, type?, reviewStatus?, cursor?, limit?}`. Year is a nonempty stored label, maximum32 characters, not inferred from display dates. Dates are ISO, paired, start-inclusive/end-exclusive, maximum550 days. Default undated=include and limit=50, maximum100. Null/malformed values and unknown keys are rejected. Cursor binds actor, scope/filter signature, source digest and stable offset within that exact snapshot; validate all components server-side, never trust them as authorization.

List response: `{tasks, total, nextCursor, snapshotVersion, academicYears, filters:{faculty,courses}, capabilities:{canReview}}`. All facets derive from authorized scope before optional filters; all totals derive after filters, before pagination. Years derive only from authorized sessions. Initial UI gets year choices through existing authorized `allSessions()`; when there are no sessions, render an empty state without sending an invented year.

Repository `createSqlSchedulingTaskRepository(db)` provides `list({actorFirebaseUid, query})` and `review({actorFirebaseUid, issueKey, academicYear, expectedEvidenceVersion, expectedReviewVersion, reviewStatus})`.

API `createSchedulingTaskApi({verifyToken,findUser,repository,writeGates})` provides `list(token,query)` and `review(token,issueKey,body)`, returning `{status,body}`. Client methods are `schedulingTasks(query)` and `reviewSchedulingTask(issueKey,body)`.

## Task 1 — Scoped SQL issue detection

**Files:** Create migration043, acceptance043, rollback043 and `tools/test-scheduling-task-sql.ps1`; create `server/test/scheduling-task-schema.test.js`. Reuse existing baseline runner through041, then apply042 followed by043 in the isolated database.

**Interfaces:** `paws_api.SchedulingTaskIssues(@AcademicYear nvarchar(32))` returns internal typed findings with canonical source identity and evidence digest. `paws_api.ListSchedulingTasks(@ActorFirebaseUid nvarchar(128), @QueryJson nvarchar(max))` returns one `responseJson` matching the shared list contract. Canonical internal rows never leave the stored-procedure boundary.

- [x] Write synthetic SQL fixtures/assertions for valid09:00–10:00 versus09:30–10:30 yielding exactly one pair;10:00–11:00 adjacency yielding zero; repeated assignments not multiplying overlaps; exact duplicate-session key yielding duplicate type instead of a second overlap.
- [x] Add assertions for active/cancelled AFC; invalid/null/reversed time yielding Needs Review; undated rows included by default; missing course/unresolved/unassigned faculty; known/unknown Calendar time. A valid AFC conflict and missing-time issue coexist when both facts are supported.
- [x] Add scoped actor assertions: facultyA sees only own issues even on a shared session with facultyB; facultyB's AFC reason/date ranges/IDs never appear. Missing required profile and inactive actor fail. Verify authorized facets/counts and all date/type/status/course/faculty filters, including zero results.
- [x] Run `pwsh -File tools/test-scheduling-task-sql.ps1 -ContainerName paws-calendar-sql-test` against the existing labeled disposable container boundary. Observe failure because043/procedures are absent; never substitute a live server if Docker is unavailable.
- [x] Implement043 projection and list. Reuse canonical joins and strict half-open overlap. Normalize duplicate-session identity exactly like existing session create validation. Retain undated records by AcademicYear. Build scoped filter facets; order Conflict first, then date (undated first), then issueKey. Bind paging to a scoped evidence/review digest; return409-equivalent SQL error on changed snapshot. Unknown faculty has null key and a safe “Not provided” label.
- [x] Add `SchedulingVersion rowversion` only to Session and SessionAssignment if absent; fail safely on unexpected existing rowversion rather than add a second. Reuse existing AfcVersion, ActivityVersion and TimeVersion. Include these and source IDs in evidence digests. Owner-approved review correction (2026-10-15): add one assignment-version metadata table and transactional trigger, retaining a version when the last assignment is removed and advancing it during supported Undo. No background scanner, business-value changes or new runtime grants.
- [x] Implement empty-state guarded rollback: drop only043 objects and its added columns after asserting no persisted review/audit data; otherwise refuse. Record migration preconditions and never remove earlier objects.
- [x] Run the SQL runner to `SCHEDULING_TASK_DETECTION_OK`; run `node --test server/test/scheduling-task-schema.test.js`. Commit the independently testable detection slice.

## Task 2 — Durable review with stale-source protection

**Files:** Extend043/acceptance/rollback; create `tools/test-scheduling-task-races.ps1`, `server/test/scheduling-task-review.test.js` and uniquely named synthetic race fixtures under `server/test/fixtures/scheduling-task-*.sql` (leave existing unrelated fixture untouched).

**Interfaces:** `paws.SchedulingTaskReview` keyed by issue digest with evidence digest, review status, actor, timestamps and rowversion. `paws_api.ReviewSchedulingTask(@ActorFirebaseUid, @IssueKey, @AcademicYear, @ExpectedEvidenceVersion, @ExpectedReviewVersion, @ReviewStatus)` returns the refreshed safe task. Add narrow execute-only role `paws_scheduling_task_review`; do not bind any account. Existing read role receives only the scoped read procedure.

- [x] Write SQL assertions: `Reviewed` remains in the default list/count; reopening yields `Unreviewed`; source correction removes current finding; restore the identical displayed values and assert `Unreviewed` with a new evidenceVersion. Old review and old source versions reject without audit/write changes.
- [x] Add all administrator-alias allow cases and ADC/LAB/faculty/HICC/VISC/inactive denies using actual impersonated narrow roles. Assert direct review-table/source DML denied and audit contains no private source snapshots.
- [x] Run acceptance and observe missing review procedure/behavior failures before implementing it.
- [x] Implement one transaction: actor authorization, ordered source/key-range locks, rederive issue, compare evidence/review version, upsert review and append existing AuditEvent. Use serializable locking on relevant session/assignment/AFC/activity ranges so inserts cannot escape validation. Source readers and review command use the same issue projection. Missing/resolved/out-of-scope keys return a common safe failure. A review request never writes Session, assignment, AFC, Calendar or DOE.
- [x] Implement two-connection fixtures that observe a blocked review or source writer rather than relying on sleeps: concurrent same-version reviewers, Session edit, assignment insert/remove, AFC mutation and Calendar time mutation. After serialization assert either accepted current evidence or stale rejection, never silent overwrite. Capture actual wait evidence and restore synthetic transactions.
- [x] Run SQL runner/races to `SCHEDULING_TASK_REVIEW_OK` and `SCHEDULING_TASK_RACES_OK`; verify populated rollback refusal and empty rollback success. Commit review slice.

## Task 3 — Authenticated API and safe client

**Files:** Create the three server modules in the file map and `server/test/scheduling-task-{api,repository,runtime}.test.js`; modify `server/src/runtime/swa-sql-runtime.js`, `server/src/data/write-gates.js`, `paws-data-client.js`; create `tests/scheduling-task-client.test.js`.

**Interfaces:** Shared contract above; routes `GET /api/v1/scheduling-tasks` and `POST /api/v1/scheduling-tasks/:issueKey/review`. Review body contains only academicYear, expectedEvidenceVersion, expectedReviewVersion, reviewStatus. Gate name/property: PAWS_SCHEDULING_TASK_REVIEW_ENABLED / schedulingTaskReview.

- [x] Write public-seam tests asserting invalid/missing token401, invalid profile403, nonadministrator review403 before repository access, disabled gate503, stale409 and private unexpected error503. Administrator aliases pass; query/body actor injection and duplicate query fields fail400. Wrong method405 and route404 remain explicit.
- [x] Write client and repository tests asserting parameterized calls use verified actor; recursive DTO allowlisting strips injected email/UCID/AFC purposes/private IDs from related sessions/facets as well as primary rows. Cursor replay across actors/filters cannot widen scope. A malicious cursor is rejected, not interpolated into SQL.
- [x] Run `node --test server/test/scheduling-task-api.test.js server/test/scheduling-task-repository.test.js server/test/scheduling-task-runtime.test.js tests/scheduling-task-client.test.js`; observe missing-module failures.
- [x] Implement the shared signatures, closed validators, existing profile/role helpers, explicit SQL error mapping and default-off gate. Handle no-auth refresh at the client through existing conventions. Register the route without changing SWAP/Calendar dispatch.
- [x] Re-run focused tests; run server regression suite via `npm test --prefix server`. Record any expected freeze checks separately from genuine regressions; commit API/client slice.

## Task 4 — Existing Tasks sidebar integration

**Files:** Modify `workspace-tasks.js`, `workspace.css`, `timetable.js`; create `tests/scheduling-task-ui.test.js`. Retain existing runtime asset entry, so no new static module is necessary.

**Interfaces:** Extend PAWS_TASKS.configure adapter with `academicYear()` and authorized allSessions existing callback. Keep `hasUser`, `allSessions`, `disposition`, `reason`, `openSession`. Existing PAWS_TASKS.refresh stays the invalidation entry point. Tasks owns a year selector using authorized years; initial selection follows current list year when available, otherwise latest authorized label; manual selection persists only for the current identity.

- [x] Write DOM workflow tests for severity/status, safe faculty/course/date display, both session links, five requested filters plus year/undated options, total versus loaded rows and Load more. Assert reviewed active item remains in All, default review status includes both, and no delete/dismiss action exists.
- [x] Add tests for ADFA review success/stale/retry; denied roles have no review controls; source error clears old conflict values; source change during paging restarts; logout/account switch clears filters/data and ignores late responses. Keep successful SWAP-request loading independent from conflict failure.
- [x] Add tests for undated-only year, absent academic years, invalid-time legacy deduplication, valid out-of-grid warnings, pending SWAP navigation and open-session week jump. Structured issue filters apply to Schedule; Requests retains its own existing search behavior and explanatory label.
- [x] Run `node --test tests/scheduling-task-ui.test.js` and observe missing controls/behavior failures.
- [x] Implement sidebar flow and compact collapsible filters; show `Reviewed · Conflict remains` where appropriate. UI derives review controls from server capability and respects the write-disabled message. Count combines authorized conflict total, retained local navigation warnings and pending SWAP count; explicitly label partial failure instead of showing zero. Refresh after edits/SWAP/review using current adapter hooks.
- [x] Re-run UI/client tests and existing scheduling/SWAP regression tests. Perform synthetic browser workflow at desktop and390px, keyboard-only controls and horizontal content checks. Commit UI slice.

## Task 5 — Independent acceptance and release preparation

**Files:** Modify `.github/workflows/calendar-activity-sql.yml`; add `docs/scheduling-task-acceptance-20261015.md` and `docs/scheduling-task-release-20261015.md`. Update continuity records. Only after accepted product review, separately update existing freeze governance files and manifest-derived reporting as required.

- [x] Add the new synthetic runner/race steps without deleting prior Calendar/ADFA acceptance. Verify runner rejects unlabeled/nonlocal targets before migration; synthetic guard tests are in `server/test/scheduling-task-schema.test.js` and `server/test/scheduling-task-review.test.js`.
- [x] Run `npm test`, `npm test --prefix server`, existing full emulator lane and actual SQL suites. Capture exact commits/counts/skips; failures are not acceptance. Browser evidence must use synthetic source data and no real schedule/review mutations.
- [x] Request fresh independent whole-branch product review against b53c23e with approved spec/plan. Resolve findings with regression tests; re-run affected and full suites. No new implementation subagents: native execution remains selected.
- [x] Commit accepted product, then obtain a separate independent immutable-freeze review. Preserve current/baseline union, Git-blob trust, repository and artifact checks, and attack tests. New server files must be auto-covered by API source discovery; verify rather than assuming. Record actual protected counts; do not invent manifest names or drift exceptions.
- [x] Build `node tools/build-static.js` and canonical Azure candidate artifact through the existing build workflow. Validate static and API repository/artifact freezes; download and inspect exact-head CI artifact and digest. The plain static build lacks host config by design; use the canonical artifact for artifact freeze validation.
- [x] Create/update a draft feature PR, accurately describing stacked PR98/99 dependencies, and attach it to this chat. Preserve review base even if main-target CI requires a larger stacked diff. Record SQL rollback checks, source-version additions, gate default, narrow role and service-account prerequisite in the release runbook.
- [x] Update agent.Ai checkpoint with evidence and remaining release prerequisites. Mark Task02 candidate complete only after review and acceptance; then proceed to next full-directive task without merging/deploying automatically.

## Execution notes and self-review

Use the existing local Node22 binary/runtime and pnpm-provided npm if Node is not on PATH. Commands above assume that runtime has been added to PATH. Never install new application dependencies just to run the plan.

Coverage checked: all eight issue types, five requested filters, unknown timing, undated years, personal privacy, ADFA-only review, stale/recreated facts, real races, error/identity transitions, current navigation, immutable governance and delivery boundary map to Tasks1–5. Signatures and status strings match across SQL/API/client/UI tasks. Source rowversions make restore-to-same-values distinguishable without a second conflict datastore. No optional review note/history UI or activity-only queue is added.

Plan status: candidate complete at separately reviewed governance a356df1 protecting product a3dd9ca. All four Important findings have RED→GREEN regression evidence. Exact-candidate Build38806801078 and SQL38806807330, independent governance, actual Chrome/adapter tests, and downloaded artifact12006518723 digest/inventory/freezes pass. No merge/live migration/role/gate/deployment authorized. Task03 proceeds separately.
