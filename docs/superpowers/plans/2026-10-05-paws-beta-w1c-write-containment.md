# PAWS Beta W1C Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Contain the three currently exposed Beta write routes behind independent fail-closed server gates and prepare a safe local SQL boundary reconciliation artifact.

**Architecture:** Preserve existing Firebase token and SQL-profile authorization. Add a server-owned write-gate configuration to the shared Dashboard API, checking each domain after authentication/role checks and before any write-repository call. Keep client capability state false until a later approved stage; client flags never authorize writes. Reconcile the stored procedure only through a deterministic, hash-guarded SQL artifact.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, vanilla JavaScript, SQL Server T-SQL, PowerShell/Remote Desktop Commander for read-only host inspection.

**Spec:** `docs/superpowers/specs/2026-10-05-paws-beta-w1c-write-containment.md` (requirements derived from Architect #6's W1C prompt).

## Global Constraints

- Base SHA is `1dca1037f61e8dbb054cc53b119d2b73982ab810`; never advance `main`.
- No live SQL writes/DDL/DCL, procedure execution, Firebase/Firestore mutation, service/tunnel change, W1C deployment, PR, or merge.
- Three independent environment gates: `PAWS_AFC_SINGLE_WRITE_ENABLED`, `PAWS_AFC_BATCH_WRITE_ENABLED`, and `PAWS_SESSION_EDIT_WRITE_ENABLED`; only the exact ordinal string `true` enables; missing/false/other values disable.
- Disabled writes return HTTP 503 with `WRITE_DISABLED` and do not call the corresponding write repository.
- Azure is parity/reference only; no dual-write path.
- Never output or persist credentials, tokens, cookies, private identities, or sensitive records.

## Review Focus

- Missing or malformed flags must fail closed; exercise absent, false, and non-true values per route.
- Invalid auth and non-admin roles must remain denied without any write repository call.
- Feature flags must be independently scoped; enabling one route must not enable another.
- SQL migration preconditions must reject any definition other than the exact audited source or exact canonical target.
- Browser UI and legacy Firestore paths must not be represented as security controls; keep their separate authority and residual risk explicit.

---

### Task 1: Establish W1C live baseline and identity evidence

**Files:**
- Create: `agent.Ai/updates/2026-10-05-<time>-paws-beta-w1c-write-containment.md`
- Read-only inspect: deployed University runtime, Static Beta assets, VetMed-Ops SQL metadata, Firebase deployed rules, Azure parity source, official GitHub Status and exact-main workflow.

**Interfaces:**
- Consumes: frozen main SHA and W1C live audit requirements.
- Produces: source/runtime hashes, route classifications, identity and permission status, static capability evidence, Azure parity status, Firestore authorization status, and release-gate status.

- [ ] Verify branch/base and preserve all unrelated worktrees.
- [ ] Inspect current University process, launch source, runtime hashes and non-secret gate configuration; do not invoke write routes.
- [ ] Read SQL identity, effective permissions, object existence and `UpdateCalendarSession` definition/hash; capture migration 012 target hash without executing any procedure.
- [ ] Inspect Static Beta source/UI capability and Firestore mutation surfaces; retrieve deployed rules only via supported read-only access.
- [ ] Compare Azure/VetMed-OPS current counts and stable keys when access is available; otherwise record PARITY_UNVERIFIED.
- [ ] Inspect GitHub Status and exact-main run 37366171691; only if the official Actions incident is resolved, pause W1C and follow the W1C prompt's same-run recovery instructions.

### Task 2: Add server-side write gate with regression tests

**Files:**
- Create/modify: `server/src/runtime/write-gate.js` (or a narrowly equivalent existing module)
- Modify: `server/src/runtime/swa-sql-runtime.js`, `server/src/data/dashboard-api.js`
- Test: `server/test/write-gate.test.js`, relevant API tests

**Interfaces:**
- Produces `createWriteGate(env)` returning independent AFC single, AFC batch, and session-edit booleans; missing/false/non-true values are false.
- `createDashboardApi` consumes the independent gate and checks it before validating or invoking any write repository while preserving existing auth and role authorization.

- [ ] Add failing tests for all three routes: missing/false/non-true disabled flags → 503 `WRITE_DISABLED`, zero write repository calls.
- [ ] Verify failing tests fail for missing gate behavior, not fixture errors.
- [ ] Add tests proving 401 stays 401, faculty/hicc/visc/retired roles remain denied, and GET routes remain unaffected.
- [ ] Add tests proving explicit `true` enables only its corresponding route and preserves existing server authorization/validation.
- [ ] Implement the minimal gate/config wiring and stable error response.
- [ ] Run focused tests and the server test suite.

### Task 3: Align local client capability presentation

**Files:**
- Modify: `paws-data-client.js`, `faculty-admin.js`, `faculty-admin.html`, `timetable.js` only where required by existing patterns
- Test: `tests/paws-data-client.test.js`, relevant timetable and faculty-admin tests

**Interfaces:**
- Client capability functions report false for Session Edit, AFC single, and AFC batch until a future explicit client release; server gates remain authoritative.

- [ ] Add failing tests showing write controls/capability are unavailable by default while read views still work.
- [ ] Verify expected failing behavior.
- [ ] Update capability presentation without removing APIs or weakening authorization.
- [ ] Run focused client tests and static build/freeze checks relevant to the modified asset set.

### Task 4: Prepare migration 016 and rollback design

**Files:**
- Create: `database/azure-sql/016_session_edit_boundary_reconciliation.sql`
- Create: `database/azure-sql/rollback_016_session_edit_boundary_reconciliation.sql` (fail-closed operational guidance/artifact only; never execute live)
- Test: `server/test/session-edit-migration-016.test.js`
- Modify: `docs/superpowers/specs/2026-10-05-paws-beta-w1c-write-containment.md`

**Interfaces:**
- Migration 016 uses verified deterministic hashes and guards the exact source/target definitions before executing the canonical migration-012 procedure body.

- [ ] Add failing contract tests for May 1 lower-inclusive and next May 1 upper-exclusive boundaries, AuditEvent/transaction/rollback/actor/allowlist/duplicate checks, and no assignment mutation.
- [ ] Verify expected failures.
- [ ] Add tests for migration idempotence and rejection of an unknown starting hash.
- [ ] Implement the deterministic hash precondition using freshly captured exact live/source definition hashes; if evidence cannot be obtained, do not invent values and leave the artifact blocked.
- [ ] Document safe rollback as disabling the server session gate; never restore weaker validation while leaving session writes enabled.
- [ ] Run focused SQL contract tests; do not connect the artifact to live SQL.

### Task 5: Complete evidence, verify and commit

**Files:**
- Update: the new chronological `agent.Ai/updates/` record; update `PROJECT_STATE.md` and `TASK_CHAIN.md` only if this work changes the breakpoint.

- [ ] Record exact outcomes, blockers, and non-actions without secrets.
- [ ] Run focused tests, `npm test --prefix server`, root `npm test`, `node --check` for changed JS, `git diff --check`, and applicable artifact/build checks.
- [ ] Review the full diff against the W1C spec; remove unrelated changes.
- [ ] Commit a coherent W1C implementation on `feature/beta-w1c-write-containment` only after verification.
- [ ] Do not open a PR, merge, deploy, push unless normal repository access and the prompt's scope explicitly permit it; never activate flags or apply migration 016 live.

## Current task prompt ruling

- Ruling: Interpret a gate as enabled only when its value is exactly the lowercase string `true` — this matches the task's fail-closed requirement and the implementation/spec; accepting case variants would broaden activation. Cost if wrong: an operator expecting `TRUE` to enable a domain will instead see 503 until the documented exact value is configured.
- The current Architect #6 prompt explicitly permits a normal commit and push to this feature branch after verification and explicitly forbids a PR. That instruction supersedes the stale conditional wording above.
