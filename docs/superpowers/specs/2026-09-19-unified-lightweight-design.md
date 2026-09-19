# Unified Lightweight Deployment Design — 2026-09-19

## Decision

Use **modular source + deterministic bundled deployment**.

Source HTML and JavaScript remain readable and independently testable. `tools/build-static.js` creates a reduced deployment graph under `.deploy-static`. No business-source files are manually merged.

First release constraints:
- no minification;
- no tree shaking;
- no ESM migration;
- no semantic transforms;
- no source-folder reorganization;
- exact source order preserved inside every bundle;
- clear `/* SOURCE: ... */` separators in generated bundles.

## Manifest model

Keep `tools/static-assets.json` as the source/dependency allowlist.

Add `tools/runtime-bundles.json` as the build-only mapping from ordered source files to generated bundle files and page replacements.

`build-static.js` will:
1. validate both manifests;
2. validate every bundle source exists in the static source allowlist;
3. validate bundle source sequences are contiguous in each page where they are replaced;
4. concatenate source bytes in declared order;
5. copy non-bundled static assets;
6. omit bundled source JS from `.deploy-static` unless explicitly retained for a dynamic consumer;
7. rewrite only the generated HTML copies in `.deploy-static`;
8. emit a deployment manifest/metrics file;
9. never edit source HTML.

## Initial bundle groups

The exact grouping is intentionally conservative and follows current contiguous script order.

Shared:
- `bundles/shared-faculty-scheduling.bundle.js`
  - `faculty-doe.js`
  - `scheduling-core.js`
- `bundles/shared-index-audit.bundle.js`
  - `data-index.js`
  - `index-maintenance.js`
  - `audit-details.js`
- `bundles/shared-auth.bundle.js`
  - `firebase-config.js`
  - `faculty-access.js`

Timetable:
- `bundles/timetable-approval-core.bundle.js`
  - approval scheduling/routing/request/state/office/lifecycle
  - calendar session
  - approval finalizer
- `bundles/timetable-app.bundle.js`
  - office capabilities through timetable/AFC UI modules, preserving current order

Faculty Dashboard:
- `bundles/faculty-doe-admin.bundle.js`
  - worksheet/rulebook/policy admin browser UI modules
- `bundles/faculty-preauth.bundle.js`
  - faculty account planner
  - approval scheduling
- `bundles/faculty-runtime-main.bundle.js`
  - maintenance/calendar/import/admin/routing/request modules through `approval-request.js`
- `bundles/faculty-runtime-tail.bundle.js`
  - `bulk-import-ui.js`
  - `derived-index-health.js`

User Management:
- `bundles/user-management.bundle.js`
  - `account-profile.js`
  - `user-management.js`

Files that remain individual in V1 include `session-guard.js`, `doe-api-client.js`, `university-closures.js`, `faculty-account-planner.js`, `faculty-swap-safe.js`, `password.js`, and true dynamic assets.

## Expected request targets

V1 startup target:
- Timetable: 31 -> about 8 direct local JS requests;
- Faculty Dashboard: 27 -> about 9;
- User Management: 11 -> about 6;
- Password: 4 -> about 3.

A later, separate lazy-bundle pass may combine AFC-PDF helpers and approval-workflow-only modules without moving them into startup.

## Caching

V1 keeps current filenames and cache policy. Content hashing / immutable cache headers are a later independent change after bundle correctness is proven.

## Rollback

Rollback is build-only:
- remove `runtime-bundles.json`;
- restore the previous `build-static.js`;
- deployment returns to one-file-per-source output;
- source/runtime business modules remain untouched.

## Acceptance

Required before calling V1 complete:
- root/static tests green;
- server DOE tests green;
- emulator suite green;
- static build green;
- generated HTML contains the expected reduced script graph;
- no bundle contains AFC PDF helpers or deferred approval implementation;
- all dynamic references resolve to deployed assets;
- no production action occurs.
