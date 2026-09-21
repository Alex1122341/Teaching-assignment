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

## Verification evidence (local, 2026-09-21)

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
