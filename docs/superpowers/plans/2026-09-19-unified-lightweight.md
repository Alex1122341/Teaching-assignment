# Unified Lightweight Implementation Plan — 2026-09-19

## Phase 1 — Build-only startup bundles

- [ ] Add RED tests for deterministic bundle configuration, source ordering, generated HTML replacement and lazy exclusions.
- [ ] Add `tools/runtime-bundles.json`.
- [ ] Refactor `tools/build-static.js` into testable functions while retaining the CLI.
- [ ] Generate bundle files with source separators and no transforms.
- [ ] Rewrite only `.deploy-static` HTML.
- [ ] Omit bundled source JS from deployment output unless required independently by a dynamic loader.
- [ ] Emit `.deploy-static/deployment-assets.json` with files/bytes/source mapping.
- [ ] Update static/runtime tests to distinguish source allowlist from generated deployment graph.
- [ ] Update `AGENTS.md` deployment wording to define `.deploy-static` as the publish source of truth generated from both manifests.
- [ ] Run exact-head CI.

## Phase 2 — Measure

Record before/after:
- deployed files;
- deployed JS files;
- total deployed bytes;
- JS bytes;
- Timetable direct scripts;
- Faculty Dashboard direct scripts;
- User Management direct scripts;
- Password direct scripts.

Do not accept a request-count improvement that accidentally makes AFC PDF or approval workflow eager.

## Phase 3 — Lazy bundles (only after Phase 1 is green)

Candidates:
- AFC PDF helper lazy bundle: `afc-form-values.js` + `afc-pdf-browser.js`;
- approval lazy bundle: preserve `faculty-swap-safe.js` compatibility while evaluating whether `faculty-swap-handoff.js` + `approval-workflow.js` can become one lazy artifact.

Update both `asset-loader.js` and the deferred loader in `faculty-access.js` if approval artifact names change.

## Phase 4 — Cache strategy

After stable browser acceptance:
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

Unified baseline SHA `39e2e5f294eccc9d0dcdad372c03577d0e2577a8` is green in Test, GitHub Pages Test Site and DOE API Test. Interactive browser acceptance remains a separate gate because lab Firebase web config and DOE API base URL are environment configuration, not committed production credentials.
