# P3 Faculty Management Implementation Plan

> **For agentic workers:** Use the exact Architect#6 P3 Faculty Management instruction in the Architect#6 conversation as the specification. This work is already authorized for uninterrupted execution.

**Goal:** Deliver authenticated SQL-backed Faculty edit, inactive list, restore, and safe deactivation in Beta.

**Architecture:** Keep Firebase Auth as identity, SQL UserProfile as role authority, and VetMed-Ops as the canonical Faculty store. Expose narrow gated API methods backed by transactional stored procedures; keep the existing admin UI read-only for self-service Faculty.

**Tech Stack:** Vanilla browser JavaScript, Node.js API, Azure SQL Server stored procedures, Node test runner.

**Spec:** Architect#6 P3 Faculty Management instruction, dated 2026-10-07.

## Global Constraints

- Base exactly `4f7e7ce51ea97e45f15e9422449a4fa26aebfc0a`; one branch `feature/p3-faculty-management`.
- Faculty edits/restores/deactivation use SQL and transactional audit; no Firestore Faculty business writes.
- Gate defaults false; only enable it after acceptance.
- Preserve existing P1/P2 gates and behavior.
- No physical Faculty delete, no role rewrite, no Firebase account deletion.
- Protected runtime changes require a separate baseline promotion in the same PR.

## Review Focus

- Admin role aliases and denied self-service roles: test API role matrix.
- Inactive identities with duplicate UCID/email: test conflict before SQL mutation.
- Stale editor version: test 409 and no stored-procedure call.
- Linked accounts and history: test soft deactivation without cascades and warning counts.
- Legacy Firestore script: test it is no longer shipped/executable from the dashboard.

---

### Task 1: SQL contract and authorization tests

**Files:** `server/test/faculty-admin-api.test.js`, `server/test/faculty-admin-migration.test.js`, `tests/faculty-admin-sql-only.test.js`

- [ ] Write tests for the gate, admin role aliases, self-service denial, validation, conflict mapping, restore/deactivate and migration invariants.
- [ ] Run them and confirm the missing methods/migration fail as expected.

### Task 2: Guarded SQL write domain

**Files:** `database/azure-sql/023_faculty_admin_write.sql`, `database/azure-sql/rollback_023_faculty_admin_write.sql`

- [ ] Add transactional guarded prerequisites after migration 022, role, exact procedure grants, uniqueness checks, concurrency checks, linked-record warning counts, and audit JSON before/after.
- [ ] Keep rollback limited to permissions/procedures and refuse unsafe/incomplete state.

### Task 3: Gated API and UI

**Files:** `server/src/data/write-gates.js`, `server/src/data/dashboard-api.js`, `server/src/data/sql-dashboard-repository.js`, `server/src/data/sql-faculty-admin-repository.js`, `server/src/runtime/swa-dashboard-functions.js`, `server/src/runtime/swa-sql-runtime.js`, `paws-data-client.js`, `faculty-admin.js`, `faculty-admin.html`, `tools/static-assets.json`.

- [ ] Add server-derived admin capability, strict input allowlist/version checks, bounded inactive status filtering and narrow procedures.
- [ ] Add admin Active/Inactive/All filter, canonical editor, explicit deactivation confirmation/warnings, restore action, and self-view read-only behavior.
- [ ] Disable/remove the legacy Firestore Faculty mutation script from shipped dashboard paths.

### Task 4: Verify, promote, and release

**Files:** workflow freeze inputs, `agent.Ai/PROJECT_STATE.md`, `agent.Ai/TASK_CHAIN.md`, `agent.Ai/updates/<timestamp>-p3-faculty-management.md`.

- [ ] Run required root/server/emulator/migration/freeze/build/diff/secret checks.
- [ ] Apply migration and perform agent-authenticated Beta acceptance, then enable only the new Faculty gate.
- [ ] Commit product and separate freeze promotion on the one branch; push, PR, green CI, merge, exact-main CI, API/Hosting release, and regression acceptance.
