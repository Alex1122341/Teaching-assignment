# AI orchestration V1: pre-implementation audit

Audit date: 2026-09-21. Source: Alex1122341/Teaching-assignment at
bd9d540bb2a25fd2b8368e59e52d39169691ccbd. Dedicated branch:
feature/ai-orchestration-v1. PRs 57–61 were read-only inspected and are all
merged/closed; their branches and PR metadata will not be changed.

## Existing mechanisms

- Vanilla browser app; Firebase Authentication and Firestore. No model SDK,
  orchestration directory, or paid inference integration exists.
- Root npm test runs Node tests. test:all includes static and server tests;
  test:emulator runs Firestore/Auth security suites and server tests.
- tools/build-static.js generates the allowlisted .deploy-static artifact and
  hashed bundles. .ai and tools/ai must never enter that allowlist.
- tools/browser-smoke.js uses Chrome DevTools Protocol directly (not Playwright);
  supports --demo and --authenticated. Password smoke and synthetic emulator
  seeding already exist. Reuse these commands; do not invent role permissions.
- Test and Pages workflows already validate exact PR heads. Pages publishes
  every successful same-repository PR to a shared test URL, including Drafts.
  This task leaves those workflows unchanged.
- Firebase administrative workflows have intentional manual write gates.
  No ai command will run seed/deploy/admin commands against cloud services.
- server/ remains used by current Firebase administration. This task neither
  extracts nor removes it. Independent Azure separation is out of scope.
- AGENTS.md lists formal/legacy roles; office-capabilities.js and firestore.rules
  additionally define developer, adc, lab and delegated officeAccess.
  Tests must cite these implementation sources, not copy an invented matrix.
- No npm executable in the initial shell PATH; Node 24 and Java 21 are present.
  Use a temporary npm installation to honor package-lock.json; CI uses Node 22.

## Implementation decisions

Use dependency-free CommonJS utilities under tools/ai, strict JSON Schemas,
versioned .ai/tasks/<positive-issue-id> packages, explicit manual role prompts,
and local fixed verification profiles. JSON is the machine-readable authority;
Markdown handoffs explain evidence and decisions.

Issue capture uses read-only GitHub REST or a downloaded JSON issue fixture.
An issues:labeled / workflow_dispatch workflow checks maintainer permission,
reads the issue as data and uploads an artifact. No automatic commits, comments,
labels, model calls or merges. A path-filtered read-only PR workflow validates
the framework; existing application CI remains authoritative.

Transitions require artifacts; reviews and verification bind to source and spec
digests. Failed, skipped, stale or missing checks cannot become PASS.
Human acceptance is mandatory; readiness is a local report, never a merge.

No new runtime dependencies. A small JSON Schema subset evaluator supports only
keywords used by the checked-in schemas and rejects unsupported keywords.
Tests cover schema strictness, state transitions, hostile input/path traversal,
secret rejection/redaction, stale evidence, and actual command results.

Implement in three cohesive groups: task validation/CLI and tests; prompts,
policies/example/docs; GitHub artifact/validation workflows and full verification.
No new confirmation gate is needed: the user explicitly authorized implementation.
