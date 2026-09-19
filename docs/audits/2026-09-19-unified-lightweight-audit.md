# Unified Lightweight Audit — 2026-09-19

## Baseline

Verified unified branch: `integration/vista-secure-doe`

Exact baseline SHA: `39e2e5f294eccc9d0dcdad372c03577d0e2577a8`

Ancestry:
- contains PR #46 audit/database/security head `0f5a7c9156634dc5a359c15198e18b4570b5b60e`;
- contains latest PR #45 DOE server-authority head `f2e5c0453246c4b596b78649f66a75d58d6eac2d`;
- GitHub compare reports the unified baseline ahead of both heads and behind neither;
- exact-head Test, GitHub Pages Test Site, and DOE API Test workflows all passed.

No production deployment, production Rules deployment, live-data migration, DOE publication, or production recalculation is part of this audit.

## Repository baseline

| Metric | Value |
| --- | ---: |
| Tracked files | 254 |
| Root files | 79 |
| JavaScript files | 185 |
| Root JavaScript files | 57 |
| Test JS files | 86 |
| Docs files | 32 |
| Tools files | 17 |

Repository-file count is not the optimization target. PR46 already consolidated same-domain static tests and removed stale branches; further cosmetic consolidation is out of scope.

## Static deployment-source baseline

`tools/static-assets.json` currently contains 62 source assets.

| Metric | Value |
| --- | ---: |
| Static source assets | 62 |
| JS source assets | 52 |
| Total source-asset bytes | 1,934,772 |
| AFC PDF | 1,042,973 |
| Bytes excluding AFC PDF | 891,799 |
| JS bytes | 742,264 |

The AFC template is intentionally lazy and is not a lightweighting target.

## Direct local scripts by page

| Page | Direct JS | Direct JS bytes |
| --- | ---: | ---: |
| Timetable (`index.html`) | 31 | 352,176 |
| Faculty Dashboard | 27 | 345,652 |
| User Management | 11 | 101,788 |
| Password | 4 | 25,907 |

External Firebase CDN scripts are not included in these counts.

## Intentional dynamic boundaries

Keep separate and lazy/deferred:
- `afc-form-values.js`
- `afc-pdf-browser.js`
- PDF-lib CDN
- `approval-workflow.js`
- `faculty-swap-handoff.js`
- `faculty-admin-enhancements.js`

`faculty-swap-safe.js` is directly loaded by Faculty Dashboard and is also a prerequisite of the Timetable approval loader, so removal or bundling must preserve both paths.

## Security and architecture invariants

The lightweight pass must preserve:
- `firebase-config.js` as the browser Firebase configuration boundary;
- isolated lab/preview behavior and emulator behavior;
- Owner-only raw user enumeration with faculty-facing use of `settings/people_index`;
- append-only audit history;
- routed/legacy approval companion-write guarantees;
- DOE server authority through the DOE API;
- Firestore Rules as authorization truth;
- immutable DOE evidence/provenance;
- current AFC, approval, swap, bulk-import and recovery behavior.

## Important configuration gate

The committed `firebase-config.js` is a safe lab template, not a production config. A remote interactive preview still requires an explicitly generated/injected lab web config. DOE API browser actions likewise require an approved `doeApiBaseUrl`. A green static build proves packaging and tests; it does not by itself prove authenticated browser acceptance.

## Conclusion

The remaining lightweight opportunity is request/deployment fragmentation. The source tree should remain modular. The first implementation should use deterministic build-time concatenation, preserve exact source order, avoid minification/tree-shaking/ESM migration, and make generated deployment output auditable and reversible.
