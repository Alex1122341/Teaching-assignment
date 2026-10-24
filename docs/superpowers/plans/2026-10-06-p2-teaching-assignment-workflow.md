# P2 Teaching Assignment Workflow Implementation Plan

> **Execution:** Inline in the current session under `superpowers:executing-plans`; Architect#6 explicitly directs one continuous end-to-end delivery.

**Goal:** Deliver a SQL-authoritative Teaching Assignment work queue, scoped HICC/VISC review, ADFAD final assignment, explicit immutable publication, and Faculty published view in the Firebase Beta.

**Architecture:** Extend the existing normalized SQL authority foundation (`005`/`006`) with guarded migration `020+`; add dedicated repository/API/gates under the existing Node modular monolith; expose the API through the existing Firebase-authenticated client and a first-class vanilla-JS workflow page. SQL remains canonical, actor and scope come from verified Firebase UID plus `paws.UserProfile` and temporal responsibilities, state changes use narrow transactional stored procedures with audit, and publication snapshots are immutable.

**Tech Stack:** Node.js CommonJS, `node:test`, SQL Server T-SQL, vanilla HTML/CSS/JavaScript, Firebase Auth, existing API and Firebase Hosting release workflows.

**Spec:** Architect#6 conversation, P2 brief dated 2026-10-06, exact URL recorded in task instructions.

## Global Constraints

- Base is exact `main` SHA `5c2ad31da8ff58af6a8cf4904b436082cc6565a0`; branch `feature/p2-teaching-assignment-workflow`.
- HICC/VISC are stable responsibilities; assignees use `activeDate <= now < expirationDate`; group membership and package ownership are canonical and server-derived.
- No browser-direct SQL, generic mutation endpoint, client-supplied actor/ownership, Topic-based authorization, or arbitrary table DML.
- Workflow state, revisions, historical reviews, final assignments, and published releases are distinct; only explicit Publish updates the Faculty-visible release.
- New workflow gates default false; activate only after migrations, deployed API, and authorization tests pass. Keep P1 write gates and AFC decision/artifact states unchanged.
- Do not merge Experimental PR #76 or wholesale-copy its implementation.
- Live acceptance uses designated test packages and API/UI operations; no unrelated assignment edits or unaudited live writes.

## Review Focus

1. Temporal boundary, overlapping assignees, and no current assignee must fail closed; test exact expiration and overlap.
2. HICC/VISC cross-group or stale responsibility access must be denied server-side; test actor UID spoofing, Subject/Topic confusion, and cross-group package IDs.
3. Stale working revisions must not be approved or final-submitted; test revision change after submission and review conflict responses.
4. Push-back history and final assignment must remain immutable historical events; test repeated reviews and that VISC approval does not become ADFAD final assignment.
5. Published releases must remain unchanged after working/final edits; test current/previous release snapshots and faculty reads.

## Interfaces

- `createTeachingAssignmentApi({ verifyToken, findUser, repository, writeGates })` handles request auth, role/scope policy, validation, and stable response errors.
- `createSqlTeachingAssignmentWorkflowRepository(db)` exposes read methods (`listWorkQueue`, `getPackage`, `getHistory`, `getPublishedRelease(s)`) and narrowly named lifecycle methods that invoke migration-owned procedures with bound parameters.
- `createTeachingAssignmentFunctions({ api })` maps `/api/v1/teaching-assignments/...` requests to the API; the runtime composes these beside existing session/dashboard/AFC routes.
- Client API methods derive actor identity from Firebase Auth only and accept package identifiers plus business fields; UI hides unavailable actions but never replaces API authorization.

## Plan

### Task 1: Normalized workflow persistence and guarded migration

**Files:** `database/azure-sql/020_teaching_assignment_workflow.sql`, rollback companion; `server/test/p2-teaching-assignment-migration.test.js`.

- [ ] Add migration contract tests first for target DB guard, transaction, restart behavior, minimum normalized identities, temporal boundaries, revision/review history, final assignments, release snapshots, audit, disabled-by-default gates, and no broad GRANT/DML.
- [ ] Run the focused migration test and observe the expected failures.
- [ ] Implement only the missing tables/constraints/indexes/procedures after inspecting existing `005`/`006` substrate; use explicit procedure inputs, transactions, optimistic revision checks, canonical joins, and durable `AuditEvent` entries.
- [ ] Run the focused migration contract suite and verify all assertions pass.

### Task 2: Domain policy, write gates, SQL repository, and runtime wiring

**Files:** `server/src/data/write-gates.js`, `server/foundation/teaching-assignment/authority.js`, new `server/src/teaching-assignment/*`, `server/src/runtime/swa-sql-runtime.js`; new server tests.

- [ ] Add failing tests for P2 gate false/true parsing; active-date inclusive/expiry-exclusive handling; overlap conflict; HICC exact Subject/Course scope; VISC group leadership; ADFAD-only finalization; anonymous/faculty/viewer/admin-identity spoof denials.
- [ ] Run focused tests to confirm the missing behavior fails.
- [ ] Implement domain policy and the narrow SQL repository; keep data-access parameters bound, use vetted stored procedures for every write, derive actor from authenticated UID and UserProfile, and return conflict on stale revisions.
- [ ] Run focused domain/repository tests and existing authorization tests.

### Task 3: HTTP API and lifecycle conformance

**Files:** new `server/src/teaching-assignment/teaching-assignment-api.js` and route adapter; `server/src/runtime/swa-sql-runtime.js`; new `server/test/p2-teaching-assignment-api.test.js` and HTTP route tests.

- [ ] Add failing API tests for work queue/detail/history/published read scopes and draft, submit, approve, push-back, final-submit, final-assignment, and publish transitions including stale and unauthorized conflicts.
- [ ] Run focused tests to confirm failures.
- [ ] Implement only specified route surfaces, route/body limits, stable errors, actor derivation, role/scope checks, and gate checks; do not add generic mutation routes.
- [ ] Run focused API tests plus server suite.

### Task 4: Firebase client and complete workflow UI

**Files:** `paws-data-client.js`, `index.html`, new `teaching-assignment.html`, `teaching-assignment.js`, `teaching-assignment.css`; UI/client tests.

- [ ] Add failing client/UI tests for exact API paths, no actor/ownership fields in request bodies, queue filters/status/next action, separate Working/Submitted/Reviewed/Final/Published sections, push-back history, ADFAD controls, Publish confirmation, and Faculty current/previous releases.
- [ ] Run focused frontend tests to confirm failures.
- [ ] Implement the first-class Work Queue and package detail views with authenticated API calls, server-provided capability use, escaped content, accessible status/actions, and privacy-safe Faculty Published reads.
- [ ] Run focused frontend tests, static build, and existing full root suite.

### Task 5: Beta migrations, controlled workflow acceptance, and gates

**Files:** operations evidence under `agent.Ai/updates/` and current-state docs.

- [ ] Verify the live VetMed-Ops migration preflight/numbering/object state and transfer hash before any SQL write; STOP only if unexpected state blocks safe migration.
- [ ] Apply guarded migrations with gate settings false; verify schema/procedure identity, health, release and trust anchor.
- [ ] Use actual UI/API with the minimum designated test package to execute HICC draft/submit → VISC push back → HICC revision/resubmit → VISC approve → HICC final submit → ADFAD final assignment → Publish → Faculty published read; verify audit and immutable previous release.
- [ ] Enable only P2 gates whose deployed surfaces and authorization acceptance passed; verify P1 Session/AFC gates remain unchanged.

### Task 6: Full verification, one PR, merge, and release

**Files:** required freeze manifest/baseline promotion if protected runtime changes, tests, continuity update.

- [ ] Run focused P2 suites, root `npm test`, server tests, emulator where relevant, migration checks, beta/API freeze, candidate/static build, diff check, and secret scan; examine all output.
- [ ] Promote only the reviewed protected runtime delta to a new immutable freeze baseline; retain zero-drift checks and all prior P1 capabilities.
- [ ] Commit coherent work on the single feature branch; push; create one PR; monitor/fix hosted CI; merge with merge commit only after green acceptance and ensure exact-main CI passes.
- [ ] Deploy University API if changed and Firebase Hosting only; activate tested workflow gates; perform final public acceptance and record exact release SHA, gate state, audit, and remaining genuine deferrals.

