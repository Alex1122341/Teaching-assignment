# PAWS P0 W1D Firestore Authority Containment Implementation Plan

> **For agentic workers:** execute this plan inline in the existing W1D worktree. Each behavior change uses a verified failing test before implementation.

**Goal:** Contain browser Firestore mutation authority for Beta business domains that are canonical in VetMed-Ops SQL, while preserving explicitly separate Firebase identity and Firestore-only functions.

**Architecture:** Firebase Auth remains identity. Canonical timetable, AFC, Faculty and DOE mutations must flow only through the trusted University API and its independent W1C gates; direct browser Firestore writes to those domains fail closed regardless of maintenance metadata. Existing user/group and other noncanonical functions remain only where repository evidence shows they do not alter SQL authority; ambiguous role authority is reported to Architect #6.

**Tech Stack:** Firestore rules v2, Firebase Rules Unit Testing + Firestore emulator, browser JavaScript, Node.js `node:test`, existing static/API freeze checks.

**Spec:** User-provided `PAWS — P0 W1D FIRESTORE AUTHORITY CONTAINMENT MODEL` pasted attachment; requirements are captured in this task plan and the feature-branch evidence matrix.

## Global Constraints

- Starting W1C tip is exactly `916a90cc2e3e9f55c01e26ace6a14f21c7d2cca9`; stop if it moves.
- No Firestore rules deployment, Firebase/config mutation, VetMed-Ops/Azure SQL mutation, W1C activation, migration 016 execution, application deployment, merge, main advance, PR, or secret/permission change.
- `settings/system_state` absence, a false `teachingDataWriteLocked`, roles, UI hiding, and malformed maintenance metadata must never reopen SQL-canonical Firestore writes.
- Keep user/group capabilities separate; do not assign undocumented ownership. Report unresolved SQL UserProfile/BaseRole conflicts to Architect #6.
- W1C AFC single, AFC batch and Session PATCH gates stay default-disabled; no Firestore fallback in the SQL data client; migration 016 remains unchanged.
- Do not weaken immutable Beta freeze tests; explain all expected W1D-only drift.

## Review Focus

1. Missing or malformed maintenance state accidentally opens canonical writes — emulator cases for missing, false, malformed, and true states.
2. Admin/ADFA/legacy roles bypass domain ownership or UI-hidden modules remain writable — emulator matrix plus explicit client-callsite contracts.
3. Retained Firestore users/groups/audit features are overblocked — positive emulator cases for their established scopes.
4. Audit/derived/public documents influence authorization or canonical state — classify each writer, source, actor, rebuildability and authorization effect; fail closed where ownership is not established.
5. Dynamic/static script loading keeps an old writer reachable — tests inspect HTML, dynamic loaders and named modules, not only rules.

---

### Task 1: W1D failing authority tests

**Files:**
- Create `tests/w1d-firestore-authority.test.js`
- Create `tests/w1d-firestore-authority-emulator.test.js`
- Modify emulator fixtures only as required by the tests.

**Interfaces:**
- Produces an explicit protected collection/path inventory used by later rules and source-contract checks.
- Emulator coverage uses the existing `FIRESTORE_EMULATOR_HOST` skip convention and `@firebase/rules-unit-testing`.

- [ ] Add red tests for session/AFC/Faculty/DOE writes denied independent of missing, false, malformed or true maintenance lock; include admin, ADFA, HICC, VISC, faculty and legacy roles.
- [ ] Add red positive tests proving established user/group and append-only account-audit behavior remains available; prove protected audit/derived paths cannot be used to mutate authority.
- [ ] Add red source/static tests covering every named legacy writer, script reachability, `public_info` and `public_schedule/ccc_events`, and absence of SQL-client Firestore fallback.
- [ ] Run focused tests and record expected failures against current rules/client sources.

### Task 2: Firestore rule containment

**Files:**
- Modify `firestore.rules`
- Modify `tests/w1d-firestore-authority-emulator.test.js`

**Interfaces:**
- Consumes Task 1's explicit collection inventory.
- Retained identity/group paths remain subject to their pre-existing role-scoped contracts.

- [ ] Deny browser create/update/delete for SQL-canonical `sessions`, `session_change_log`, `faculty`, SQL-overlapping faculty audit/DOE paths, `afc_requests` and AFC artifact/projection paths.
- [ ] Make canonical denials independent of `system_state` and maintenance lock state.
- [ ] Keep approved import job/maintenance coordination semantics only where they cannot write protected business records; remove any broad bypass that would re-enable canonical mutations.
- [ ] Preserve read rules and explicitly retained identity/group/public read functions where tests and source evidence support them.
- [ ] Run W1D rules emulator tests and affected maintenance/import/User Management tests.

### Task 3: Legacy client write containment

**Files:**
- Modify only proven reachable legacy paths among `timetable.js`, `approval-workflow.js`, `afc-workflow.js`, `afc-actions.js`, `faculty-admin-enhancements.js`, `index-maintenance.js`, `bulk-import-firestore.js`, `user-management.js`, their HTML entry points, and focused tests.

**Interfaces:**
- Client SQL writes remain behind existing W1C API gates and default-off capabilities.
- Read-only Firestore use and explicitly retained user/group operations stay independent.

- [ ] Remove or fail-close direct session create/update/delete, approval application, AFC request decision/projection, Faculty/DOE role override, and canonical import/restore client mutation paths.
- [ ] Remove obsolete writer modules from Beta runtime loading only after tracing all consumers; do not delete shared modules blindly.
- [ ] Prevent retained audit/derived writes from acting as an alternate business authority; retain only scoped, append-only identity/group audit behavior where evidence supports it.
- [ ] Do not infer ownership for `public_info` or `public_schedule/ccc_events`; document current reachability/rules and preserve or deny according to demonstrated noncanonical use, flagging unresolved ownership.
- [ ] Run focused module/UI and source-contract tests and syntax checks.

### Task 4: Authority matrix and continuity evidence

**Files:**
- Create a W1D authority matrix/spec under `docs/superpowers/specs/`
- Create a new chronological `agent.Ai/updates/` report from `UPDATE_TEMPLATE.md`
- Update `agent.Ai/PROJECT_STATE.md` and `agent.Ai/TASK_CHAIN.md` for the new breakpoint.

**Interfaces:**
- Matrix rows identify path, writer, authority, actor, reachability, client state, rule outcome, source record, rebuildability, and authorization influence.

- [ ] Classify canonical SQL domains, retained Firestore domains, public paths, audit and derived indexes; call out unresolved authority rather than invent it.
- [ ] Record script loaded/used/obsolete/future-server status with traced consumers.
- [ ] Record exact local-only safety boundaries and preserve the SQL runtime identity blocker unchanged.

### Task 5: Full W1D verification and branch handoff

**Files:** all reviewed W1D files; no freeze-gate weakening.

- [ ] Run Firebase Firestore/Auth emulator suite, W1D focused tests, W1C gates, AFC, Session PATCH, User Management, maintenance/import, server suite, root suite, JavaScript syntax, `git diff --check`, `beta-freeze`, and `beta-api-freeze`.
- [ ] Classify expected freeze drift and every unexpected failure; repair only W1D defects with RED→GREEN verification.
- [ ] Review complete diff and authority matrix against every acceptance requirement.
- [ ] Commit coherently and push only `feature/beta-w1d-firestore-authority-containment` after verification; no PR, merge, deploy, rules publish, SQL/Firebase mutation, or main change.
