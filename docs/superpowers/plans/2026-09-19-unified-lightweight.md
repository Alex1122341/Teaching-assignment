# Unified VISTA Lightweight Deployment Implementation Plan — 2026-09-19

> Owner approval was received. The conservative build-only V1 has been implemented and verified; dynamic-loader bundling and cache hashing remain gated on interactive browser acceptance.

**Baseline:** `39e2e5f294eccc9d0dcdad372c03577d0e2577a8`

**Goal:** Preserve modular source, security, DOE server authority, workflow behavior and lazy-loading while reducing browser deployment fragmentation through deterministic build-time bundles.

**Companion design:** `docs/superpowers/specs/2026-09-19-unified-lightweight-design.md`

## Global constraints

- Do not modify `main`, PR #45 or PR #46 directly.
- Implementation branch must start from the verified unified integration baseline.
- Do not deploy Azure production, production Firebase Rules, or mutate production/live data.
- Do not publish/recalculate DOE production data.
- Do not minify, tree-shake, migrate to ESM, or broadly move source files.
- Do not delete tests or historical design documents.
- Do not change Firestore role/permission semantics.
- Source HTML remains readable and explicit; deployment HTML may be generated.
- Keep AFC PDF, PDF-lib, approval workflow and other intentional lazy paths lazy.
- Any unexpected execution-order requirement stops the affected bundle and leaves those files separate.

---

## Task 0 — Create the implementation branch after approval

From the final approved unified baseline:

```text
branch: feature/runtime-lightweight-bundles
base: exact approved integration SHA
```

Record:

- base SHA;
- branch name;
- worktree/path if using a local worktree;
- clean status.

Do not reuse an older lightweight branch.

**Commit:** none; setup only.

---

## Task 1 — RED tests for bundle policy and generated output

**Add/modify:**

- Add: `tests/runtime-bundles.test.js`
- Modify: `tests/runtime-assets.test.js`
- Modify: `tests/github-pages.test.js` only if generated-output assertions belong there
- Add later: `tools/runtime-bundles.json`

### RED assertions

Before implementing the builder, write tests requiring:

1. a versioned bundle manifest;
2. explicit ordered member arrays;
3. valid source members from `tools/static-assets.json`;
4. no duplicate member inside one bundle;
5. startup bundles may not contain:
   - `approval-workflow.js`;
   - `afc-form-values.js`;
   - `afc-pdf-browser.js`;
   - the AFC PDF template;
6. active browser bundles may not contain retired browser DOE engine/service modules;
7. every page sequence declared for replacement exactly matches source HTML order;
8. a generated build rewrites only `.deploy-static/*.html`, not repository HTML;
9. generated bundle references resolve;
10. output remains under `.deploy-static/`;
11. repeated builds produce byte-identical bundle artifacts;
12. generated deployment JS bytes obey the design ceiling.

Run the focused tests and confirm RED.

Suggested:

```bash
node --test tests/runtime-bundles.test.js tests/runtime-assets.test.js
```

**Commit:** RED tests only.

---

## Task 2 — Add deterministic bundle manifest and builder primitives

**Add:**

- `tools/runtime-bundles.json`

**Modify:**

- `tools/build-static.js`

Implement pure/testable helpers where practical:

- validate bundle schema;
- resolve ordered members;
- validate source HTML sequence;
- concatenate members with clear `/* SOURCE: ... */` separators;
- add safe statement boundaries;
- compute bundle output path;
- rewrite deployment HTML;
- calculate actual deployment file count/bytes;
- reject duplicate output paths;
- reject output path traversal.

No minification or AST transform.

### GREEN criteria

- focused bundle tests pass;
- two consecutive builds produce identical bundle checksums;
- repository source HTML hash remains unchanged.

**Commit:** bundle infrastructure only, with no broad page conversion if possible.

---

## Task 3 — Convert safe shared sequences

Prototype the lowest-risk shared sequences first.

Candidate bundles:

### `faculty-scheduling.bundle.js`

Ordered members:

1. `faculty-doe.js`
2. `scheduling-core.js`

### `data-audit.bundle.js`

Ordered members:

1. `data-index.js`
2. `index-maintenance.js`
3. `audit-details.js`

### `identity.bundle.js`

Ordered members:

1. `firebase-config.js`
2. `faculty-access.js`

Only use a candidate if exact source-page adjacency/order tests prove it is safe on every declared target page.

### RED

Tests should initially expect generated HTML to reference these bundles and originals not to be separately emitted for those page references.

### GREEN

Run:

```bash
node --test tests/runtime-bundles.test.js tests/runtime-assets.test.js tests/firebase-config.test.js tests/page-modules.test.js
node tools/build-static.js
```

Inspect generated files for:

- source markers;
- order;
- one execution per source;
- correct Firebase config ordering.

**Commit:** shared bundle conversion.

---

## Task 4 — Timetable startup bundling

Current baseline:

- 31 direct local scripts;
- 352,176 startup JS bytes.

Create conservative page-specific bundle groups only where the current Timetable script sequence is preserved exactly.

Candidate areas:

- approval startup sequence;
- post-identity Timetable/AFC UI sequence.

Keep small boundary files standalone when that avoids semantic reordering.

### Do not bundle into startup

- `approval-workflow.js`;
- `faculty-swap-handoff.js` if it is still a deferred compatibility step;
- AFC PDF-only helpers;
- PDF-lib;
- PDF template.

### RED

Add generated-output tests asserting:

- Timetable deployment HTML request count falls into the approved target;
- lazy files are absent from startup bundle content;
- expected globals exist before their consumers by source-order inspection;
- `doe-api-client.js` remains available before DOE-consuming Timetable paths;
- no retired browser DOE engine enters deployment.

### GREEN target

Timetable direct local startup JS:

- target 8–12;
- no material startup-byte growth.

Run focused Timetable/static tests before full suite.

Suggested:

```bash
node --test tests/runtime-bundles.test.js tests/runtime-assets.test.js tests/timetable.test.js tests/timetable-selection.test.js tests/page-modules.test.js tests/doe-api-consumers.test.js
node tools/build-static.js
```

**Commit:** Timetable deployment bundles.

---

## Task 5 — Faculty Dashboard startup bundling

Baseline:

- 27 direct local scripts;
- 345,652 startup JS bytes.

Candidate groups:

- DOE admin presentation:
  - `doe-worksheet-view.js`
  - `doe-rulebook-admin.js`
  - `doe-policy-admin.js`
- Faculty admin/bulk-import sequences;
- small pre-auth sequence if it is cheaper than unsafe reordering.

Keep `faculty-swap-safe.js` standalone if bundling it would duplicate a large module solely to save one request.

### RED

Generated-output tests must prove:

- DOE admin UI remains browser presentation/API client only;
- Faculty page request count falls into target range;
- bulk import/recovery source order remains unchanged;
- `firebase-config.js` still executes before Firebase initialization;
- Faculty self-service permissions are unchanged.

### GREEN target

Faculty Dashboard direct startup JS:

- target 9–12;
- source duplication remains within global byte ceiling.

Run:

```bash
node --test tests/runtime-bundles.test.js tests/runtime-assets.test.js tests/faculty.test.js tests/page-modules.test.js tests/bulk-import.test.js tests/doe-policy-admin.test.js tests/doe-api-consumers.test.js
node tools/build-static.js
```

**Commit:** Faculty Dashboard deployment bundles.

---

## Task 6 — User Management and Password

Baselines:

- User Management: 11 scripts / 101,788 bytes.
- Password: 4 scripts / 25,907 bytes.

Use shared bundles and only minimal page-specific bundling.

Targets:

- User Management: 5–6 direct startup JS;
- Password: approximately 3.

Do not complicate Password solely to reach one request.

Run:

```bash
node --test tests/runtime-bundles.test.js tests/user-management.test.js tests/password-flow.test.js tests/firebase-config.test.js
node tools/build-static.js
```

**Commit:** small-page deployment bundles.

---

## Task 7 — Lazy bundle consolidation

Only after startup bundling is green.

### AFC PDF lazy helper

Candidate generated lazy bundle:

- `afc-form-values.js`
- `afc-pdf-browser.js`

Update `asset-loader.js` to load the generated lazy helper while preserving:

1. PDF-lib lazy load;
2. helper lazy load;
3. PDF template fetched only during actual generation.

`afc-form-state.js` remains startup code.

### Approval lazy path

Evaluate combining:

- `faculty-swap-handoff.js`;
- `approval-workflow.js`;

only if compatibility/load-order tests prove it.

`faculty-swap-safe.js` may stay separately lazy because it is also a Faculty Dashboard dependency.

### RED/GREEN

Tests must assert no lazy bundle is requested by generated startup HTML.

Focused:

```bash
node --test tests/runtime-bundles.test.js tests/runtime-assets.test.js tests/afc.test.js tests/faculty-swap.test.js tests/approval.test.js
node tools/build-static.js
```

**Commit:** lazy generated bundles.

---

## Task 8 — Measurement gate before full verification

Build twice.

Record:

- deployed file count;
- deployed JS artifact count;
- total bytes;
- bytes excluding PDF;
- JS bytes;
- per-page direct script count;
- per-page startup JS bytes;
- lazy JS artifacts/bytes;
- duplicate source bytes, if any.

Acceptance thresholds:

| Metric | Baseline | Acceptance |
|---|---:|---:|
| Browser JS assets | 52 | approx. 18–24 |
| Timetable scripts | 31 | 8–12 |
| Faculty Dashboard scripts | 27 | 9–12 |
| User Management scripts | 11 | 5–6 |
| Password scripts | 4 | about 3 |
| Browser JS bytes | 742,264 | <= 105% of baseline |
| Per-page startup bytes | measured above | <= 101% except documented separators |

If byte ceilings fail:

- split or share bundles differently;
- accept additional requests;
- do not minify as a workaround.

**Commit:** measurement adjustments only if necessary.

---

## Task 9 — Full verification

Fresh exact-head verification:

```bash
npm test
npm run test:server
npm run test:emulator
node tools/build-static.js
```

Also run the repository's full CI-equivalent commands.

Required green domains:

- Firebase config isolation;
- Auth/Firestore security;
- people index privacy;
- faculty-swap projection;
- append-only audit;
- approval routing;
- AFC;
- bulk import/recovery;
- Timetable;
- Faculty Dashboard;
- User Management;
- Password;
- DOE API/server authority;
- DOE policy admin presentation;
- DOE permissions;
- static dependency graph;
- Pages staging/build;
- Azure build boundary.

No test may be deleted or weakened merely because generated deployment differs.

---

## Task 10 — Browser/local smoke

Use emulator-safe/local configuration.

Verify:

### Timetable

- login shell;
- Day/Week/Month/List;
- single edit;
- batch edit;
- selection;
- exports;
- closures;
- approval lazy load;
- faculty swap;
- AFC form;
- AFC PDF lazy generation.

### Faculty Dashboard

- lookup;
- Teaching Summary;
- Roles;
- Faculty Database;
- DOE Rules;
- validation/preview UI;
- bulk import/recovery UI.

### User Management

- load;
- role/permission presentation;
- group/member display using sanitized people index.

### Password

- forced-change shell;
- normal flow shell.

Inspect:

- console errors;
- network 404;
- duplicate execution;
- missing globals;
- lazy requests appearing at startup;
- desktop and narrow layout.

If usable lab SDK configuration is not injected, do not claim authenticated cloud-browser acceptance. Record that environment dependency explicitly.

---

## Task 11 — Final report

Write/update performance evidence with exact before/after numbers.

Report:

- implementation base SHA;
- final SHA;
- generated bundle names and member lists;
- source files changed;
- source files deleted: expected none for bundling;
- deployment assets before/after;
- JS assets before/after;
- request counts before/after;
- bytes before/after;
- lazy boundaries;
- test counts;
- emulator results;
- build results;
- smoke results;
- remaining environment/configuration dependencies;
- rollback instructions.

Explicitly confirm:

- no production deployment;
- no production/live-data write;
- no migration;
- no DOE production publication/recalculation;
- no weakening of Rules;
- no merge to `main` unless separately authorized.

---

## Deferred Phase 2

Do not implement in this plan:

- content-hashed asset filenames;
- immutable-cache headers;
- minification;
- tree shaking;
- ESM conversion;
- source-directory reorganization.

After Phase 1 is accepted, remeasure cross-page caching and decide whether a separate Phase 2 is justified.

## Implementation status — V1 closeout

| Task | Status |
|---|---|
| Task 0 — implementation branch | Completed |
| Task 1 — RED bundle tests | Completed |
| Task 2 — deterministic manifest/builder | Completed |
| Task 3 — safe shared sequences | Completed |
| Task 4 — Timetable startup bundles | Completed |
| Task 5 — Faculty Dashboard startup bundles | Completed |
| Task 6 — User Management / Password | Completed |
| Task 7 — lazy bundle consolidation | Deferred until browser acceptance |
| Cache/content hashing | Deferred until browser acceptance |

### Verified output

- source runtime allowlist: 62 assets / 52 JS;
- generated application deployment: 31 assets / 21 JS;
- generated bundles: 9;
- Timetable direct local JS: 31 → 9;
- Faculty Dashboard: 27 → 11;
- User Management: 11 → 6;
- Password: 4 → 3;
- application bytes: 1,934,772 → 1,955,538 (+1.1%);
- deployment metadata: 6,742 bytes.

### Verification evidence

Implementation head `690a6dd4608a8f688085a2bee338240703f6c123`:
- Test: success;
- GitHub Pages Test Site: success;
- DOE API Test: success;
- root emulator: 723/723 passed;
- server tests: 112/112 passed.

A later documentation-only closeout head `1d866725e82bec77d9757c3cb8198b76ff6bfd78` also completed all three workflows successfully before the integration documentation merge.

### Remaining gate

Do not implement Task 7 or cache hashing until interactive browser acceptance is completed with an explicitly supplied lab Firebase web configuration and approved DOE API base URL. The repository continues to fail closed rather than embedding production credentials.
