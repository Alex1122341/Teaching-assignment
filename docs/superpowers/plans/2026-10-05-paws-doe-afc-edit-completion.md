# PAWS DOE/FTE + AFC + Edit Completion Plan

Implement one reviewed feature branch from exact main `340f599e13de98847b2e41a057be32517e79fee7`, with groups for role/source copy, DOE/FTE, rule reference, AFC reconciliation/multi-input, and session editing. Every behavior change follows test-first; migrations and live imports remain separate from local code verification and require inspected prestate, deterministic identities, dry-run evidence, transaction boundaries, and post-write aggregate verification.

## Task 1 — Establish implementation ledger and source contracts

- Confirm clean branch/worktree and exact starting SHA; preserve the unrelated dirty checkout.
- Create the plan-owned SDD workspace and ledger. Record baseline tests, freeze checks, Node versions, and relevant existing APIs/schema.
- Read source CSVs and UCVM Workload Guidelines; verify source hashes and record non-sensitive summaries only.
- Inspect exact migration 008/013, DOE read models, import scripts, current role mapping, AFC import/manual schemas, and session-edit API before designing deltas.
- Expected: no business DB writes; reproducible baseline and task dependency notes.

## Task 2 — Role display labels and current-source terminology

- Add failing contract tests distinguishing internal role keys from display labels.
- Implement shared display mapping `adfa_general` → ADFAD Owner, `adfa_regular` → ADFAD Admin across current UI surfaces and relevant current documentation.
- Add failing current-runtime source-copy checks; replace only stale current business-data claims of Azure SQL with PAWS University API / VetMed-Ops terminology.
- Preserve accurate Azure infrastructure and frozen/historical evidence.
- Expected: focused UI/contract tests and repository-wide categorized stale-copy scan.

## Task 3 — DOE/FTE reconciliation, import, and Faculty workload view

- Add parser/reconciliation tests for normalized exact unique UCID, name-order warning, no-match, duplicate/conflicting UCID, numeric/blank/zero FTE, category mapping, decimal totals, and idempotency.
- Implement a dry-run-first DOE/FTE import with source provenance. UCID alone determines writes; do not default blank FTE or fabricate missing categories.
- Inspect live migration/schema state and exact authorization before choosing/applying any required migration; use DoeFacultyTarget and migration 013's DoeFacultyAllocation rather than duplicate columns.
- Populate one active 2026-27 policy version and deterministic target/allocation rows only after source mapping and dry-run counts pass.
- Add Faculty API/view support and UI separating FTE, contract DOE, assigned teaching DOE, role/service DOE, rule reference and completeness.
- Expected: repeat import is idempotent; unresolved no-match/conflict rows are isolated; post-import aggregates match validated source rows.

## Task 4 — Versioned UCVM Workload Guideline rule reference

- Add tests for exact rates, tiers, temporal stage, source/version metadata, and explicit non-inference constraints.
- Inspect DoeRuleSeed, existing policy metadata, and read models; choose the smallest compatible representation.
- Implement year/stage-sensitive HICC/VISC rule references and supervision/teaching rules without applying absent source inputs to faculty or assignments.
- Surface rule basis/required inputs/source/policy in Faculty DOE view.
- Expected: exact values are asserted; existing 91 teaching DOE, 64 ambiguous HICC/coordinator and 14 CCC gaps remain unresolved absent authoritative evidence.

## Task 5 — AFC latest-source parser and reconciliation

- Add failing tests for parsing 810 source business rows, exact duplicates, missing faculty/purpose, reversed dates, deterministic name normalization/aliases, exact purpose preservation, and reconciliation states.
- Implement source hash/row provenance, preview/dry-run counts, deterministic existing/new/changed/history classification, and idempotent writes.
- Resolve anomalies only from objectively matching source/history evidence; quarantine unresolved records individually and never guess a faculty identity or date correction.
- Preserve history unless the source is proven an authoritative replacement snapshot.
- Expected: valid deterministic majority can proceed independently of anomalies; each source row is accounted for.

## Task 6 — AFC manual-purpose model and multi-input API/UI

- Add contract tests for arbitrary exact Purpose, backward-compatible single entry, max 20, row-indexed validation, duplicate detection, all-or-nothing writes, request idempotency, audit metadata and server-side admin authorization.
- Add the smallest migration/API changes after live migration-state inspection; manual purpose remains display-authoritative while legacy ReasonCode remains compatible.
- Implement API validation before transaction; resolve Faculty deterministically; compare duplicates against unified AFC data; create row-level audit evidence with server-derived actor.
- Implement grid/paste/edit/remove/validate/review/submit UI using canonical searchable Faculty choices.
- Expected: ADFAD Owner/Admin succeeds; Faculty/HICC/VISC is rejected before repository mutation; existing AFC workflow regressions pass.

## Task 7 — Existing-session edit frontend activation and sentinel acceptance

- Add tests for admin editable status and actions, Faculty/HICC/VISC read-only behavior, SQL API call path, and absence of Firestore mutation fallback.
- Enable only supported scalar edits using the existing PATCH route and internal role keys.
- Use the authorized designated accounts through normal login as needed; never log or persist credentials/tokens.
- Create a uniquely generated synthetic session only after confirming canonical FK/year constraints and non-collision. Exercise owner edit, SQL mutation, AuditEvent, refresh, and Faculty server denial through actual public API/UI.
- Remove the synthetic session business row safely and verify zero unexpected sentinel residue; preserve append-only audit events.

## Task 8 — Integrated verification and source-write closeout

- Run targeted DOE, AFC, session-edit tests, root/server suites, static/API freeze checks, `git diff --check`, and secret/scope scans.
- Re-run DOE/FTE and AFC dry-runs against fresh read-only live baselines. Review identity, validation, anomaly, idempotency and history counts before applying already-authorized deterministic rows.
- Apply safe validated data in transactions; verify source-to-database representation, FTE/DOE coverage, AFC identity/provenance, duplicate/orphan checks, and audit counts.
- Update continuity notes only from fresh evidence; keep private source files and credentials out of Git.
- Expected: concise evidence report records complete, partial, and unresolved counts without overstating coverage.

## Task 9 — PR, CI, Beta release and public acceptance

- Review complete diff against scope and migration/rollback safety; commit meaningful groups on the single feature branch.
- Push without force, open one coherent PR, resolve CI errors, and merge only when acceptance gates pass.
- Verify exact-main CI, deploy the authorized Beta static/API changes through established release workflows, then perform authenticated owner and Faculty public-path acceptance.
- Expected: final report includes branch/commits/PR/final SHA, exact CI/deploy evidence, API revision, test-account outcomes, and ACCEPTED/PARTIAL/BLOCKED verdict.

## Addendum — Migration 015 guard and Beta Sign-in event path

### Task 10 — Migration 015 temporary-principal safety contract

- Test that migration 015 accepts only the verified temporary Beta runtime principal `UC\\sa-xinyu.zhu1`, rejects missing/wrong targets, and retains the schema/object ownership guard.
- Replace the blanket database-role rejection with an explicit note that existing `db_owner` membership is temporary Beta security debt and is not changed by this migration.
- Evaluate effective permission as the target runtime user after creating the procedure. Add only the exact procedure `EXECUTE` grant when it is not already effective; fail closed when effective permission cannot be verified.
- Verify no role membership, broad DML, database, or schema-level grants are introduced, and preserve existing AFC records and guarded rollback behavior.
- Expected: static migration contract tests pass; live apply happens once only after local review and fresh preflight.

### Task 11 — Sign-in event path diagnosis

- Confirm `init()` completes `bindControls()` before `initFirebaseAuth()` updates the visible connection state; verify no shipped helper replaces the `gate-sign-in` node or removes its listener.
- Inspect the live button's DOM identity, hit-test target, visibility, console errors, and safe click result without entering credentials.
- Add a regression test for the exact confirmed source-level event/bootstrap behavior. Do not alter auth architecture or frozen live assets directly.
- Expected: fix only a confirmed local defect; if the browser does not expose listener/breakpoint evidence, record the precise remaining runtime-proof blocker instead of guessing.
