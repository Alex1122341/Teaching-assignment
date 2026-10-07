# PAWS AI workflow V1

A small manual AI handoff system with automated preparation and verification.
No model API calls, no automatic merge, no application behavior changes.

## Quick start

Use Node 22+ and Git. These utilities have no new npm dependencies.
Existing application tests still need `npm ci`; emulator checks need Java 21,
and browser checks need Chrome. Run commands at the repository root.

On Windows, set CHROME_PATH to the installed Chrome executable when running
browser profiles; the existing smoke runner's automatic lookup is Linux-oriented.
Product name: PAWS. Existing repository, Firebase and workflow identifiers remain
unchanged; this infrastructure does not perform a branding migration.

1. Create a GitHub Issue and run `npm run ai:task -- 72`. Private access uses
   an optional read-only GH_TOKEN for the GitHub issue request only.
   Offline alternative: `npm run ai:task -- 72 --issue-file issue.json`,
   where issue.json contains number, title, body. A PR number is rejected online.
2. Commit .ai/tasks/72 on the dedicated task branch shown in STATUS.json.
   This command does not create or switch Git branches.
3. Copy .ai/generated/72/architect-prompt.md into ChatGPT Sol Extra High.
   Save strict spec.json and 02-architecture-spec.md. Resolve open questions,
   confirm requirements with the owner, then `npm run ai:advance -- 72 implementation`.
4. `npm run ai:builder -- 72 hy4` (or deepseek/codex). Give the generated
   builder-prompt.md to that product. Builder records changes/tests/PR in
   03-builder-handoff.md; keep STATUS.branch and pull_request current.
   Set spec.preferred_implementer before changing builders; the review generator
   defaults to the opposite model and rejects the recorded builder as reviewer.
5. `npm run ai:collect -- 72`, then `npm run ai:advance -- 72 review`.
   Use `npm run ai:review -- 72 deepseek` after HY4, or hy4 after DeepSeek.
   Save review.json and 04-review.md. Reviews use the exact digest values
   from generated context and include every spec acceptance ID.
6. `npm run ai:advance -- 72 verification`; `npm run ai:integrator -- 72`.
   A valid adversarial review may contain blockers at this handoff: integration
   is where Codex repairs them. Clean, fresh review evidence is mandatory before
   advancing to final_review, and no blockers are ignored at readiness.
   Codex Terra checks the diff, repairs in-scope blockers and runs
   `npm run ai:verify -- 72` for profiles listed in spec.required_tests.
   This writes verification.json and 05-verification.md, with redacted logs
   under .ai/generated/72. Any source fix requires fresh review evidence.
7. `npm run ai:advance -- 72 final_review`;
   `npm run ai:final-review -- 72`. Sol performs read-only final review and
   returns final-review.json plus 06-final-review.md.
8. `npm run ai:advance -- 72 ready_for_human`; `npm run ai:status -- 72`.
   Human checks actual CI, logs, diff and outstanding risks, then decides whether
   to merge. The framework never merges or applies readiness labels itself.

All generated prompts are ready to copy, but inspect them for private data first.
They embed the applicable strict output schema and operating policies. Provide
repository access to the model, or separately inspect and attach the sanitized
working-diff.txt from ai:collect plus relevant non-sensitive source evidence.
Prompts do not silently copy repository source, logs or protected diffs.
Numbered Markdown files describe handoffs; JSON files are machine-validated.
Schemas under schemas/ reject unexpected fields. The initial specification is
intentionally incomplete: templates never pretend requirements are approved.

## GitHub entry point

After a human merges this infrastructure, a maintainer may label an open Issue
ai-ready or dispatch **AI Task Package** with its number. It checks actor write
permission, fetches that issue as data, and uploads a seven-day task artifact.
Download and inspect it; copy its task folder into .ai/tasks/<ID> on your own
branch. Artifact extraction may omit the common .ai prefix; place files explicitly.
No workflow creates commits, comments or PRs, invokes models or merges.

The label must exist (create it manually in repository settings). Label events
and workflow_dispatch only use this workflow after it reaches the default branch.
Local ai:task works immediately on this feature branch.

**AI Orchestration Checks** is a small path-filtered PR check. Existing Test,
Pages and Firebase workflows are unchanged. The existing Pages workflow may
publish a successful Draft PR to the shared test URL; Draft status does not
suppress that existing behavior.

## Commands and verification profiles

| Command | Result |
| --- | --- |
| ai:task ID [--issue-file FILE] | Capture issue and initialize durable package |
| ai:architect ID | Sol architecture prompt |
| ai:builder ID hy4/deepseek/codex | Builder prompt |
| ai:review ID hy4/deepseek/codex | Independent read-only review prompt |
| ai:integrator ID | Codex Terra verification prompt |
| ai:verify ID [profile,profile] | Execute fixed local checks and record actual results |
| ai:final-review ID | Sol final-review prompt |
| ai:collect ID | Branch, PR number, changed files, source digests, sanitized diff |
| ai:advance ID STAGE | Guarded next-stage transition |
| ai:status ID | Evidence/readiness report, stale task warning; nonzero until ready |
| ai:validate | Validate all stored task packages |
| ai:demo | Run the isolated synthetic lifecycle in examples/documentation-demo |

Profiles reuse existing code: unit (root Node tests), server (server Node tests),
build (static artifact), emulator (Firestore/Auth + root/server tests), browser
(existing static smoke), demo (build/stage/smoke), authenticated (synthetic local
emulator seed + owner/password smoke). No cloud deployment/admin profile exists.

A unit run with emulator skips is NOT RUN for complete verification. Choose
emulator in required_tests when full security coverage is required, and retain
unit output as partial evidence. A missing executable, timeout or failure never
becomes PASS. ai:verify replaces the previous verification record; supply all
required profiles together for the final run. Browser profiles require a built
artifact; run build first, or use demo which includes building.

A new code/spec edit invalidates previous evidence through SHA-256 digests.
Evidence-only commits can retain valid records when their source/spec digests
match and the reviewed commit is an ancestor. UTF-8 source line endings are
normalized for Windows/Linux checkout portability. Logs are ignored local
artifacts; retain relevant CI links or selected redacted logs for human review.
Do not mistake local attestations for authenticated model identity.

ai:validate always checks stored structures. It rechecks current-source readiness
only for ready packages whose STATUS.branch matches the active Git/PR branch;
historical packages explicitly report not_evaluated so later work does not
invalidate history. Keep STATUS.branch accurate. Before human approval always
run ai:status ID, which checks the requested task regardless of branch.

## Role-sensitive tasks

Use spec.role_checks to cite actual source and define allowed and denied cases.
Authority is in AGENTS.md, faculty-access.js, office-capabilities.js,
firestore.rules and existing tests. Current developer/ADC/LAB/ADFA/Faculty
behavior must be inspected per task. The existing owner smoke does not prove
all roles; report other scenarios NOT TESTED until exercised with synthetic data.
Never alter business permissions just to make orchestration work.

## Files, safety and costs

- tasks/: durable task packages; templates/task/: pending handoff templates.
- prompts/: role contracts; schemas/: strict status/spec/review/verification.
- policies/: workflow, protected areas, routing and shared operating rules.
- generated/: ignored copy prompts, metadata and redacted test logs.
- examples/: synthetic demonstration only.
- tools/ai/: small dependency-free CLI; tests/ai-orchestration.test.js: tests.

No source/config/environment dump is included automatically in prompts.
Diff collection excludes common protected files; secret detection is heuristic
and cannot guarantee removal of unknown credentials or personal data.
Never place sensitive information in issues/task files in this public repository.
Issue text and model output remain untrusted. No shell command comes from them.

GitHub automation uses its applicable free/included allowance; local checks use
your machine. ChatGPT/Codex/WorkBuddy steps use manually selected existing product
entitlements, with their limits. **NO new model API charges** are introduced.
See WORKBUDDY-RESEARCH.md for verified facts and remaining billing uncertainty.

Future V2 can add CI evidence import or officially supported adapters after
billing/security review. There is no speculative adapter framework in V1.
