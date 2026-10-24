# PAWS Post-P3 Beta Stabilization Plan

> **For agentic workers:** Use `superpowers:executing-plans` and follow the tasks in order. Keep live SQL writes behind reviewed, reversible SQL and aggregate before/after evidence.

**Goal:** Stabilize the live Beta by improving data quality, safe SQL-backed timetable edits, timeout notice lifecycle, academic-year Check Needed discovery, DOE readiness, and repository hygiene.

**Architecture:** Firebase remains identity only; VetMed-Ops remains the business source of truth through the University API. Frontend capabilities follow server authorization, and existing Firestore timetable writes stay disabled. Ambiguous DOE/data decisions remain visible as source requirements rather than guessed values.

**Tech Stack:** Vanilla JavaScript, Node.js University API, SQL Server/VetMed-Ops, GitHub Actions, Firebase Authentication.

**Spec:** Owner-supplied PAWS stabilization prompt, 2026-10-04.

## Global Constraints

- Base is exact `main` SHA `783777f2dd0693cbc521ebc625817872514c2ada`.
- Do not expose SQL/RDP/SMB publicly or restore Firestore business authority.
- Do not infer Contract Teaching DOE, ambiguous Role DOE, faculty identity, or unknown date/time.
- Session edits require server-side Firebase identity, SQL profile/role checks, transaction, and AuditEvent.
- Preserve the one-hour idle timeout and blocking reload protections.
- Do not delete retained AFC acceptance evidence or rewrite database history.

## Review Focus

- Malformed/unsupported session edit fields and role spoofing: API tests reject them and preserve state.
- Assignment fields are rejected by the scalar edit endpoint; Faculty assignments and DOE values remain unchanged.
- Year boundary and malformed/unknown session times: Check Needed partition tests.
- Timeout notice persistence across reload and reauthentication: lifecycle regression tests.
- Ambiguous DOE source or multiple normalization candidates: report for review; no data mutation.

## Tasks

### Task 1: Baseline and repository inventory

- Capture clean worktree/base SHA, GitHub branches and PRs, CI and live release identities.
- Classify all non-main branches and open PRs before any closure/deletion.
- Keep this implementation on `feature/beta-post-p3-stabilization`.

### Task 2: VetMed-Ops quality audit and DOE readiness

- Run the specified aggregate-only audit across faculty, courses, sessions, assignments, roles, AFC, profiles, and DOE tables.
- Create exact candidate normalization SQL with affected counts, transaction/rollback, and before-state evidence.
- Apply only deterministic normalizations; report ambiguous records in `DATA_QUALITY_NEEDS_REVIEW`.
- Add `docs/PAWS-DOE-Data-Readiness.md`; leave target/role DOE values unset without authoritative sources.

### Task 3: SQL-backed session editing

- Add failing API/repository tests, then implement the narrow existing-session update endpoint with server-derived identity, allowed admin roles, field/date/course/type validation, a transactional scalar update, and audit evidence.
- Keep separate assignment and Firestore-based swap mutations hidden until an independently reviewed SQL write path exists.
- Add the data-client/UI capability only after the write contract is tested; hide unsupported create/bulk-add controls.
- Verify Faculty denial and no Firestore timetable writes.

### Task 4: Timeout notice lifecycle

- Add failing lifecycle regression coverage for timeout → redirect → notice → successful authenticated bootstrap → notice cleared.
- Clear/dismiss non-blocking notices without weakening timeout or reload protections.

### Task 5: Academic-year Check Needed list

- Add explicit `ALL`, `GRID-READY`, and `CHECK NEEDED` list modes over the full academic year.
- Reuse canonical disposition reasons, preserve chronological stable ordering, and keep the week warning.
- Test partition/union coverage and reason counts.

### Task 6: Verification and release evidence

- Run focused, root, and server suites; static/API freeze and build checks; inspect the full diff.
- Update continuity state and chronological update, then open one PR from the feature branch.
- Deploy only after exact checks pass, preserving the live ACA revision/digest and rollback evidence.
- Complete UI/API acceptance with already-authorized test sessions; stop only an unavoidable login-specific dependency, while finishing independent work.

## Current Execution Note

The Beta page currently shows the authenticated `adfa_general` dashboard. The local legacy checkout is dirty and remains untouched; the clean feature worktree is based on the verified live `main` SHA above.
