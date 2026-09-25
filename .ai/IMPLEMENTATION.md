# PAWS AI Orchestration V1 — implementation handoff

## Scope and outcome

Implemented on feature/ai-orchestration-v1, based on main
bd9d540bb2a25fd2b8368e59e52d39169691ccbd. The existing worktree and all
pre-interruption work were preserved. Only Alex1122341/Teaching-assignment
was changed. No Azure repository operations, cross-repository synchronization,
branding migration, application behavior changes or merges were performed.
PAWS is the product name; existing infrastructure identifiers remain unchanged.

## Delivered

- Durable numbered issue/specification/builder/review/verification/final-review
  packages with STATUS.json and strict JSON schemas.
- Manual Sol architect/final reviewer, HY4/DeepSeek/Codex builder, opposite-model
  reviewer and Codex Terra integrator prompts, including schemas and policies.
- CLI issue capture (GitHub REST or offline JSON), prompt generation, Git/diff
  collection, guarded stage transitions, stale-task detection and readiness.
- Fixed-profile local test/build/emulator/browser execution, captured redacted
  logs, explicit FAIL/NOT RUN, source/specification-bound review evidence.
- Read-only ai-ready/workflow_dispatch artifact preparation and a path-filtered
  PR validation workflow. No automatic commits, labels, inference or merges.
- Protected-area declarations, source-based role checks, secret heuristics,
  safe ID/path handling, symlink guards and a restricted test environment.
- Reproducible non-production lifecycle demonstration with real fixture
  verification and unmistakably simulated model reviews.
- Owner quick start, audit, routing and WorkBuddy cost/entitlement research.

## Bounded final-review fixes: F1/F2 (2026-09-22 UTC)

This follow-up updates the same PR #63 / feature/ai-orchestration-v1 from
764a0c5cbc5e0fb2887ba62c2a9096b7d8615ab3. The prior DeepSeek review applies
only to that earlier head, not these changes. A fresh focused review is required.

F1: the fixed verification registry now supplies profile-specific evidence rules.
Successful exit is necessary, but insufficient:

- unit/server require one complete Node TAP report, a nonzero executed test count,
  a matching top-level plan/test points and consistent summary totals.
- emulator requires both root and server TAP reports. Incomplete/empty output
  cannot pass; failures, cancellation and bailout fail; skips/TODO remain NOT RUN.
- build requires the existing build-static JSON completion record with its output,
  metadata path and positive asset/byte counts.
- browser/demo require their existing completion markers in the correct mode,
  with nonzero matching completed/expected page counts.
- authenticated requires the normal page smoke, authenticated protected-page
  completion, Rule Book recalculation checkpoint AND password-reset completion.

Missing evidence is NOT RUN with a reason. Missing executables remain NOT RUN;
timeouts/nonzero exits remain FAIL. Additional failing checks still block readiness.
No application script was changed to manufacture success output. The isolated
documentation demo now runs a real Node unit test/TAP reporter instead of its old
plain-text pseudo-build assertion; only its fixture spec and explanation changed.

F2: removed the unreachable deleted-file fallback and clarified fingerprint
comments. Regression coverage preserves working-file deletion changing the digest,
index-only removal preserving it, and staging/committing being content-independent.

Fresh local verification of these changes:

| Check | Result |
| --- | --- |
| Focused orchestration suite, including PR-style branch environment | 64 passed; 0 failed/skipped |
| npm test | 1,070 total: 958 passed, 112 emulator-only skips; 0 failed |
| Actual fixed unit profile | NOT RUN as intended: 112 skips, not a false full PASS |
| Actual fixed server profile | PASS: 119 tests, 0 failed/skipped |
| Actual fixed emulator profile | PASS: root 1,070 + server 119, 0 failed/skipped |
| Actual fixed build profile | PASS: existing build JSON, 32 files / 20 JS / 12 bundles |
| Actual fixed browser / demo profiles | PASS: 4/4 pages in each correct mode |
| Actual fixed authenticated profile | PASS: 4/4 base pages, 3/3 protected pages, Rule Book and password reset |
| Real isolated lifecycle demonstration | PASS with Node-generated TAP |
| ai:validate / git diff --check | PASS |

The focused suite increased from 24 to 64 tests. Before the fix, 25 of the new
evidence checks failed against the old exit-code-only logic; the demo compatibility
regression also failed before it was converted to real Node test execution.
Original assertions were retained and success fixtures updated to valid evidence.
Local logs are ignored under .ai/generated/f1-*.log. New-head CI is recorded in
PR #63 Checks, not inferred from previous-head success.

Scope remains F1/F2 only. No runtime/permission/workflow/infrastructure/API/merge
changes. F3 branding cleanup is deferred; F4/F5/F6 documented residual risks
remain intentionally unchanged under the owner's explicit scope instructions.

## Original implementation verification (764a0c5, 2026-09-21)

Environment: Windows, Node 24.19.0, Java 21, Chrome; existing CI uses Node 22.
Dependencies installed using the existing lockfile, with no dependency changes.

| Executed check | Result |
| --- | --- |
| Focused orchestration suite, including PR GITHUB_HEAD_REF environment | 24 passed, 0 failed/skipped |
| Final npm test | 1,030 total: 918 passed, 112 emulator-only skips, 0 failed |
| Full Firestore/Auth emulator run + server suite | 1,029 root + 119 server passed, 0 failed/skipped |
| npm run test:all | Exit 0; static run has emulator skips; server 119 passed |
| Existing static deployment build | Passed: 32 files, 20 deployed JS assets, 12 bundles |
| Existing Pages demo smoke | 4/4 pages passed |
| Existing emulator browser smoke | 4/4 pages passed |
| Existing authenticated owner smoke | 3/3 protected pages passed, including Rule Book flow |
| Existing password-reset browser smoke | Passed against local Auth emulator |
| Isolated orchestration demonstration | Passed actual fixture assertion; zero model calls |
| Both new workflow YAML documents | Parsed successfully; pinned/read-only policy assertions passed |
| ai:validate / git diff --check | Passed |

The emulator run started before the final additional-check failure regression
was added. That new guard and test were subsequently included in the 24-test
focused run and final 1,030-test npm run. Thus the different root counts above
are intentional, not a missing emulator scenario. Logs remain local and ignored
under .ai/generated; do not publish unreviewed emulator output.

Chrome initially required CHROME_PATH on Windows; the existing runner otherwise
looks for common Linux executable names. The new demo wrapper's staging inputs
were corrected to use a positive synthetic PR number and the real local Git SHA.
No existing browser/application files were edited.

The repository's existing static wrapper expects TAP summaries. On Node 24 it
can report a missing TAP summary while its underlying test command succeeds;
the direct npm test totals and explicit-TAP emulator run above are the evidence.
This pre-existing wrapper was not changed. CI on Node 22 is checked separately.

## Independent review and corrections

A bounded read-only code review found no critical defect and identified:
historical task readiness blocking future tasks, findings preventing the
integration handoff, and index-dependent hashing of deleted files. All three
were fixed with regressions. Follow-up review caught the fixture branch versus
GITHUB_HEAD_REF mismatch; fixture assertions now pass an explicit branch and
were rerun with a real PR-style environment. An extra regression ensures an
additional failing verification check cannot be hidden by required-profile passes.

Historical packages receive schema/structure validation, not a claim that old
evidence verifies today's source. Active branch readiness is checked separately;
always use ai:status ID before human approval. Source edits require fresh reviews.

## Costs, limitations and remaining human actions

NO new model API charges or API-key dependencies are introduced. Local scripts
use local compute and GitHub REST; Actions consume the account's available
allowance. Product interfaces still consume the owner's existing quotas.
Manual WorkBuddy handoff is the supported V1 path because promotional entitlement
preservation through the Open API could not be established.

The label-triggered artifact workflow is NOT RUN live before human merge:
issue workflows use the default branch. YAML/policy checks are complete, but
the owner must validate one real ai-ready Issue after merging the reviewed PR.
Create the label if absent, download/inspect artifacts and commit them on the
task's branch. The infrastructure never changes repository branch protection.

Manual review records are attestations, not authenticated model identity.
Heuristic redaction is not a guarantee; inspect prompts/diffs before sharing.
Owner browser coverage does not establish every ADC/LAB/ADFA/Faculty scenario.
Future tasks must supply their own source-based role criteria and actual evidence.
No real Sol/WorkBuddy multi-model task or live production-data test was performed.

Existing Test/Pages/Firebase workflows remain unchanged. Existing successful
same-repository PR CI may update the shared test Pages site, including for Drafts.
No production deployment is added or manually triggered by this implementation.

Review entry point: .ai/README.md. Keep the PR Draft until human review; do not merge
automatically. Future adapters or reuse in another repository require separate
authorization and billing/security review.
