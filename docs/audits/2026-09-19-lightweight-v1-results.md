# Runtime Lightweight V1 Results — 2026-09-19

## Status

V1 is implemented on `feature/runtime-lightweight-bundles` on top of the verified `integration/vista-secure-doe` baseline.

Implementation head verified by GitHub Actions:

`690a6dd4608a8f688085a2bee338240703f6c123`

Draft verification PR: #49.

## What changed

V1 changes the deployment layer only:

- source HTML remains unchanged;
- source JavaScript remains modular;
- `tools/static-assets.json` remains the source runtime allowlist;
- `tools/runtime-bundles.json` defines deterministic ordered startup bundles;
- `tools/build-static.js` validates bundle membership/order, concatenates source with explicit source markers, rewrites only generated HTML, and emits `.deploy-static/deployment-assets.json`;
- no minification, tree shaking, ESM migration, or business-logic refactor is performed.

## Measured result

Baseline was the unified secure + DOE server-authority head `39e2e5f294eccc9d0dcdad372c03577d0e2577a8`.

| Metric | Unified baseline | V1 generated deployment |
| --- | ---: | ---: |
| Source/application asset graph | 62 | 31 |
| JS assets | 52 | 21 |
| Timetable direct local JS | 31 | 9 |
| Faculty Dashboard direct local JS | 27 | 11 |
| User Management direct local JS | 11 | 6 |
| Password direct local JS | 4 | 3 |
| Application bytes | 1,934,772 | 1,955,538 |

The build also emits one 6,742-byte `deployment-assets.json` metadata file.

The approximately 1.1% application-byte increase is expected because V1 intentionally favors conservative page/shared bundles over aggressive source coupling. The primary improvement is request fragmentation: deployed JS file count falls about 59.6%, while source modules remain unchanged and auditable.

## Lazy/deferred boundaries retained

V1 does not bundle true lazy/deferred runtime assets:

- `afc-form-values.js`;
- `afc-pdf-browser.js`;
- `approval-workflow.js`;
- `faculty-swap-safe.js`;
- `faculty-swap-handoff.js`;
- `faculty-admin-enhancements.js`;
- PDF-lib CDN;
- `absence-from-campus-app.pdf`.

This preserves the existing AFC PDF, approval, swap compatibility, and Faculty Dashboard enhancement loading boundaries.

## Verification

GitHub Actions at the V1 implementation head:

- **Test** — success;
- **GitHub Pages Test Site** — success;
- **DOE API Test** — success.

Test evidence:
- root static/unit: 723 tests, 634 passed, 89 expected emulator-gated skips, 0 failed;
- DOE server: 112/112 passed;
- emulator root: 723/723 passed, 0 skipped;
- DOE server inside emulator gate: 112/112 passed.

Build evidence:
- 31 application deployment files;
- 21 deployed JS files;
- 9 deterministic generated bundles;
- 1,955,538 application bytes;
- 6,742 bytes of deployment metadata.

## Security / behavior result

The V1 build does not change:
- Firestore authorization;
- Firebase project selection semantics;
- sanitized `people_index` privacy boundary;
- append-only audit policy;
- approval companion-write guarantees;
- DOE server authority;
- DOE policy/evidence immutability;
- application business source modules.

No production deployment, production Rules deployment, live-data migration, DOE publication, recalculation, or production-user mutation was performed.

## Remaining gate

Do not start cache hashing or dynamic-loader bundling yet.

First complete interactive browser acceptance with an explicitly supplied lab Firebase web configuration and approved DOE API base URL. The committed configuration intentionally fails closed rather than embedding production credentials.
