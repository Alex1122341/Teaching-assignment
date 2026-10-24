# P3 Stage A Activation Preparation Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task, using TDD for new executable safeguards and `superpowers:verification-before-completion` before commit/push/report.

**Goal:** Prepare a safe, branch-only Stage A activation package for accepted P3B4 while preserving the live VetMed-Ops and PAWS runtime.

**Architecture:** Separate read-only evidence collection, non-executed SQL permission/deployment artifacts, deterministic local package creation, and the A0-A8 operator runbook. Any live-side action in this plan is an explicitly bounded read-only query or backup `VERIFYONLY`; no migration, grant, service, runtime, test-data, or cloud mutation is allowed.

**Tech Stack:** Node.js 22, PowerShell, SQL Server scripts, existing Git/npm lockfiles, SHA-256.

**Spec:** `docs/superpowers/specs/2026-10-04-p3-stage-a-activation-prep.md`

## Global Constraints

- Base SHA `b6e74ff5ff34ef5f3b2541f8a3528341ff38f943`; branch `feature/p3-stage-a-activation-prep`.
- Do not alter the unrelated dirty primary checkout.
- Never execute 009/010/011, GRANT/REVOKE, service/runtime changes, deploy, or test data writes.
- Keep credentials and live row data out of source, logs, evidence, and Git.
- Node 22 is mandatory for package/build/test claims.
- Do not merge or create a PR.

## Review Focus

- Permission verifier accidentally accepts inherited/broad rights — test forbidden role, schema, DML, ALTER, CONTROL rights fail closed.
- Deployment script overwrites unexpected or unbacked runtime — test each required precondition fails before any filesystem replacement.
- Package leaks config/secrets — test inventory excludes secret files and has a deterministic digest.
- Backup media validation is overstated as restore proof — assert evidence labels keep those claims distinct.
- Rollback destroys business evidence — assert 009/010/011 rollback stop/forward-repair boundaries are explicit.

---

### Task 1: Derive identity and permission contract

**Files:** create `database/azure-sql/p3-stage-a/apply_runtime_permissions.sql`, `database/azure-sql/p3-stage-a/verify_runtime_permissions.sql`, and a Node contract test under `tests/`.

**Interfaces:** accepted runtime files and migrations 009-011; no runtime product edits.

- [ ] Inspect exact accepted runtime SQL reads and procedure calls plus existing `NT SERVICE\PAWSApi` metadata using read-only queries.
- [ ] Write the contract test first; run it and record expected initial failure.
- [ ] Author a transactionally safe, explicit permission artifact (not executed) and verifier that fails on forbidden extras.
- [ ] Run focused test and whole repository tests under Node 22.

### Task 2: Capture recovery and schema evidence

**Files:** create a narrowly scoped read-only collection script and safe baseline inventory/hash evidence, plus tests for non-disclosure and non-mutation boundaries.

**Interfaces:** VetMed-Ops msdb backup metadata and allowlisted AFC schema objects only.

- [ ] Inspect only VetMed-Ops full/log backup metadata; select newest usable full and derive contiguous required logs.
- [ ] Run `RESTORE VERIFYONLY` for the selected full (and logs if supported); record exact permission/media outcome. Never run `RESTORE DATABASE`.
- [ ] Export only schema definitions needed to prove current AFC/view rollback baseline; store safe hashes/inventory and source script instead of environment-specific definitions where appropriate.
- [ ] Prove whether a full restore has actually been performed: this task does not perform one.
- [ ] Run focused tests and Node 22 suite.

### Task 3: Resolve accepted test-data strategy from existing evidence

**Files:** update Stage A evidence/runbook only.

- [ ] Search repo/history for existing approved account, QA data convention, isolated DB/schema, or synthetic acceptance procedure.
- [ ] Document an already-approved safe strategy if one exists; create no user or live row.
- [ ] Otherwise present only the spec's two owner choices and mark the data gate accordingly.

### Task 4: Build deterministic candidate and guarded deployment artifact

**Files:** create package builder/manifest, deployment guard script, and contract tests. Do not modify P3 product assets.

- [ ] Add failing tests for exact package inclusion, secret/config exclusion, SHA manifest, and deployment preflight failure cases.
- [ ] Build candidate from accepted P3 runtime and the exact locked dependencies under Node 22.
- [ ] Implement package builder and verify repeated outputs have identical inventory/hash.
- [ ] Author guarded deployment script with explicit opt-in apply switch; test dry/preflight behavior only. Never target or copy to server.

### Task 5: Write activation and rollback runbook

**Files:** create `docs/runbooks/p3-stage-a-activation.md` and concise operator manifest.

- [ ] Define A0-A8, with PASS/STOP/rollback/forward recovery at each gate.
- [ ] Include exact hash, Node 22, backup, schema, identity, runtime capture, permission, smoke, and test-data gates.
- [ ] Specify loopback/internal acceptance; Stage B stable public ingress; A8 holds frontend cutover.
- [ ] Mark 009/010 rollback constraints and 011 artifact preservation boundary.

### Task 6: Record, verify, and publish preparation branch

- [ ] Add chronological `agent.Ai/updates/` report; update project state/task chain only if breakpoint changes.
- [ ] Run exact full tests/build under Node 22 and inspect diff/secrets and generated package digest.
- [ ] Commit coherent prep artifacts, push feature branch non-force, and report exact SHA. Do not merge or deploy.
