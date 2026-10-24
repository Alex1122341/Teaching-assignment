# PAWS Beta W1C — Effective Write Containment and Runtime Identity Readiness

## Goal

Establish the actual effective write exposure of the frozen Beta runtime, then prepare a local-only fail-closed server gate and deterministic session-date reconciliation so no write domain is considered enabled merely because the UI hides a control or W2 has not started.

## Authority and boundaries

- Architect #6 W1C prompt in the current PAWS architecture thread is the source requirements for this specification.
- Frozen base: `origin/main` `1dca1037f61e8dbb054cc53b119d2b73982ab810`.
- Canonical future writable authority: Firebase Authentication → University PAWS API → server authorization → narrow procedures → VetMed-Ops.
- Azure `teaching-assignment-lab` remains a read-only parity/reference source.
- No live SQL DDL/DCL, permissions, data writes, procedure invocation, Firebase/Firestore mutation, service change, tunnel change, W1C deployment, main advance, PR, merge, or write-flag activation.
- Each server-side domain gate is independent; absent/false means disabled; only explicit `true` enables that domain.
- Disabled routes return a stable service-unavailable response without calling a write repository or SQL procedure. Existing authentication and role authorization remain intact.
- The SQL artifact `016_session_edit_boundary_reconciliation.sql` may be created locally only. It must fail closed unless the current procedure matches either the audited weaker live definition or the intended migration-012-compatible definition; it must be idempotent for the compliant definition.
- Live Firestore rules, Azure parity, authenticated reads, and runtime identity are inspection-only. Unknown evidence remains explicitly unverified.
- Existing work in all other worktrees and branches is preserved.

## Required outcomes

1. Classify each live write route as EFFECTIVELY_ACTIVE, SERVER_DISABLED, DB_PERMISSION_BLOCKED, DB_OBJECT_MISSING, or UNKNOWN using source, process identity, configuration, SQL permissions, and object evidence without invoking write routes.
2. Add independent server-side fail-closed gates for AFC single, AFC batch, and session edit.
3. Align the local Beta client so it does not advertise those writes as available while all client capability flags remain false; client state is not an authorization control.
4. Add migration 016 restoring the May 1 inclusive / next May 1 exclusive academic-year rule without changing audit, transaction, actor, allowlist, duplicate-session, or assignment semantics.
5. Add tests for gate defaults, auth preservation, zero repository calls, migration preconditions/idempotence, and date boundary contracts.
6. Record fresh read-only parity, identity, deployed rules, authenticated-read, GitHub Status and AFC release-gate evidence, with unavailable data classified precisely.
7. Keep all changes on `feature/beta-w1c-write-containment`; do not create a PR or deploy.

## Acceptance

- Missing/false flags fail closed independently for all three POST/PATCH routes.
- Disabled requests never invoke a write repository; invalid authentication still returns 401 and non-admin write attempts remain denied.
- Explicitly enabled routes preserve existing authorization and validation semantics.
- Existing GET routes are unaffected.
- Migration 016's precondition admits only the exact audited weaker definition or exact canonical target; unknown definitions fail closed; the compliant target is idempotent.
- Date range is `SessionDate >= May 1 of AcademicStartYear AND SessionDate < May 1 of the next AcademicStartYear`.
- All requested focused tests and existing relevant suites are run and reported exactly.
- No live write/deployment/configuration/permission change occurs.
