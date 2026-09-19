# Unified Lightweight Implementation Plan — 2026-09-19

## Phase 1 — Build-only startup bundles

- [x] Add RED tests for deterministic bundle configuration, source ordering, generated HTML replacement and lazy exclusions.
- [x] Add `tools/runtime-bundles.json`.
- [x] Refactor `tools/build-static.js` into testable functions while retaining the CLI.
- [x] Generate bundle files with source separators and no transforms.
- [x] Rewrite only `.deploy-static` HTML.
- [x] Omit bundled source JS from deployment output unless required independently by a dynamic loader.
- [x] Emit `.deploy-static/deployment-assets.json` with files/bytes/source mapping.
- [x] Update static/runtime tests to distinguish source allowlist from generated deployment graph.
- [x] Update `AGENTS.md` deployment wording to define `.deploy-static` as the publish source of truth generated from both manifests.
- [x] Run exact-head CI.

Phase 1 verified head before this documentation-only closeout: `690a6dd4608a8f688085a2bee338240703f6c123`.

## Phase 2 — Measure

Verified build output:

| Metric | Before | V1 | Change |
| --- | ---: | ---: | ---: |
| Source/deployment application assets | 62 | 31 | -50.0% |
| JavaScript assets | 52 | 21 | -59.6% |
| Timetable direct local scripts | 31 | 9 | -71.0% |
| Faculty Dashboard direct local scripts | 27 | 11 | -59.3% |
| User Management direct local scripts | 11 | 6 | -45.5% |
| Password direct local scripts | 4 | 3 | -25.0% |
| Application build bytes | 1,934,772 | 1,955,538 | +1.1% |

`deployment-assets.json` is one additional build metadata file (6,742 bytes) and is not counted as an application asset above.

The small byte increase is intentional in V1: cross-page bundles duplicate about 19 KB of source text and add source-boundary markers. The optimization target is HTTP/file fragmentation, not minification.

Lazy/deferred behavior remains separate:
- AFC PDF helpers remain lazy;
- `approval-workflow.js` remains deferred;
- `faculty-swap-safe.js`, `faculty-swap-handoff.js`, and `faculty-admin-enhancements.js` remain independently deployable where required;
- the AFC PDF template remains lazy.

## Verification evidence

At exact V1 head `690a6dd4608a8f688085a2bee338240703f6c123`:

- Test workflow: success.
- GitHub Pages Test Site workflow: success.
- DOE API Test workflow: success.
- static/root suite: 723 tests, 634 passed, 89 emulator-gated skipped, 0 failed;
- server suite: 112/112 passed;
- emulator root suite: 723/723 passed, 0 skipped;
- server suite inside emulator gate: 112/112 passed;
- generated static build: 31 application files, 21 JS assets, 9 bundles, 1,955,538 application bytes.

No production deployment, production Rules deployment, live-data mutation, DOE publication, or DOE recalculation was performed.

## Phase 3 — Lazy bundles

Deferred until interactive browser acceptance of V1.

Candidates after that gate:
- AFC PDF helper lazy bundle: `afc-form-values.js` + `afc-pdf-browser.js`;
- approval lazy bundle: preserve `faculty-swap-safe.js` compatibility while evaluating whether `faculty-swap-handoff.js` + `approval-workflow.js` can become one lazy artifact.

This phase changes dynamic loader behavior, so it is deliberately not mixed into the verified build-only V1.

## Phase 4 — Cache strategy

Deferred until stable browser acceptance:
- content-hash generated JS/CSS bundles;
- keep HTML no-cache;
- allow immutable long-lived caching for hashed assets;
- verify GitHub Pages and Azure behavior separately.

## Non-goals

Do not:
- merge source business modules by hand;
- delete tests/docs for file-count optics;
- remove compatibility files without consumer proof;
- minify in V1;
- tree-shake in V1;
- migrate to ESM in V1;
- change Firestore authorization;
- deploy production;
- mutate live data;
- publish/recalculate DOE in production.

## Current gate

The build-only V1 is green. Interactive browser acceptance remains the next gate because the committed lab Firebase configuration is intentionally a safe template and the DOE API base URL is environment configuration rather than a committed production credential.
