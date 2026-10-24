# P2A DOE Faculty Target Implementation Plan

## Scope
Implement the approved P2A design on feature/p2a-doe-target-domain. This plan does not include personal DOE import, runtime permission grants, service activation, merge, or deployment.

## Ordered tasks

### Task 1 — Worktree and baseline
- Confirm clean feature worktree based on the current verified main SHA.
- Install only dependencies recorded in package-lock files if absent.
- Run existing server baseline tests and API freeze check; record outcomes.

### Task 2 — SQL migration
- Add the P2A forward migration and exact rollback migration under database/azure-sql.
- Add SQL contract tests that fail first and assert the required keys, same-year policy FK, academic-year check, nullable/no-default contract value, computed effective target, override reason check, and active-row uniqueness.
- Apply the forward migration to VetMed-Ops in one transaction after a final object/rowcount preflight.
- Verify the exact object metadata and zero target/policy rows. Save prestate, apply result, poststate, and script hashes under C:\PAWS\Migration\Evidence.

### Task 3 — API read foundation
- Add a focused DOE target repository with one parameterized, SELECT-only query.
- Add an administrator-only Dashboard API operation and GET route; no write operation.
- Add tests first for allowed/denied roles, no repository access on denial, year canonicalization, output shape, and SQL failure handling.
- Wire the repository into the existing SQL runtime without changing the Firebase auth chain.

### Task 4 — Freeze governance and verification
- Add a fresh API freeze baseline commit only as part of the reviewed feature change; preserve every prior protected path.
- Run focused server tests, the full server suite, API freeze verification, relevant root tests, and the static freeze check.
- Inspect the complete diff and run secret/scope scans.

### Task 5 — Review handoff
- Commit only verified P2A work on the feature branch.
- Open a reviewable PR if GitHub authentication is available; do not merge or deploy.
- Append a chronological agent.Ai update and record the exact remaining release and permission gates.

## Stop conditions
- Stop the live migration if strict TLS fails, the object preflight differs, or the transaction cannot complete exactly.
- Do not grant the runtime SQL identity access to DOE targets until the data access policy is explicitly reviewed.
- Do not import personal contract DOE without a current authoritative source.