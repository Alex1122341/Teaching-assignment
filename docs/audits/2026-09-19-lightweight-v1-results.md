# Runtime Lightweight Results — V1 + Lazy V2 — 2026-09-19

## Status

The deployment-lightweight pass is implemented on `feature/runtime-lightweight-bundles` on top of `integration/vista-secure-doe`.

Current verified head:

`d80d445bec92be342627c9bd6dbe5718831b7756`

Draft review: PR #49.

No merge to `main`, production deployment, production Rules deployment, live-data mutation, DOE publication, or production recalculation has been performed.

## Architecture retained

The source repository remains modular:

- source HTML remains readable and unchanged by the build;
- source JavaScript remains independently testable;
- `tools/static-assets.json` remains the source runtime allowlist;
- `tools/runtime-bundles.json` declares deterministic startup and lazy deployment bundles;
- `tools/build-static.js` rewrites only generated files under `.deploy-static`;
- build metadata is emitted outside the public site under `.deploy-metadata`;
- no minification, tree shaking, ESM migration, or source-folder flattening is used.

## Final measured deployment graph

Original unified secure + DOE baseline: `39e2e5f294eccc9d0dcdad372c03577d0e2577a8`.

The current CI reporter measures the current modular source graph against the generated deployment. Small source-byte differences from the original baseline are caused by later safety/test fixes; file/request counts remain directly comparable.

| Metric | Modular source graph | Current generated deployment | Reduction / change |
| --- | ---: | ---: | ---: |
| Application assets | 62 | 30 | -32 (-51.6%) |
| JavaScript assets | 52 | 20 | -32 (-61.5%) |
| Timetable direct local JS | 31 | 10 | -21 (-67.7%) |
| Faculty Dashboard direct local JS | 27 | 12 | -15 (-55.6%) |
| User Management direct local JS | 11 | 6 | -5 (-45.5%) |
| Password direct local JS | 4 | 3 | -1 (-25.0%) |
| Application bytes | 1,934,817 | 1,944,521 | +9,704 (+0.5%) |
| JavaScript bytes | 742,309 | 753,494 | +11,185 (+1.5%) |

Generated deployment bundles: **12**.

The small byte increase is intentional. The optimization target is browser request/file fragmentation while retaining conservative, auditable source boundaries.

## V1 startup bundling

V1 introduced deterministic shared/page bundles while keeping the business source tree modular. Later topology refinement traded one additional startup request on Timetable and Faculty Dashboard for materially lower duplicated bytes.

Current startup counts are therefore:

- Timetable: **31 -> 10**;
- Faculty Dashboard: **27 -> 12**;
- User Management: **11 -> 6**;
- Password: **4 -> 3**.

## Lazy V2

### AFC PDF helper

`afc-form-values.js` + `afc-pdf-browser.js` are represented by:

`bundles/afc-pdf.lazy.bundle.js`

Result:
- two AFC helper JS deployment files -> one lazy bundle;
- AFC helper lazy requests: **2 -> 1**;
- PDF-lib CDN and the AFC PDF template remain separately lazy;
- authenticated Chrome smoke explicitly calls `UCVM_ASSETS.ensureAfcPdf()` and verifies both AFC globals.

### Approval workflow

`faculty-swap-handoff.js` + `approval-workflow.js` are represented by:

`bundles/approval-workflow.lazy.bundle.js`

Result:
- two approval helper JS deployment files -> one lazy bundle;
- approval helper requests: **2 -> 1**;
- `faculty-swap-safe.js` remains standalone because Faculty Dashboard also consumes it;
- the duplicate direct loader in `faculty-access.js` was removed in favor of `UCVM_ASSETS.ensureApprovalWorkflow()`;
- Chrome verifies the approval lazy bundle exists exactly once and the compatibility handoff executes first.

## Browser acceptance

The generated site is exercised with headless Chrome against local Firebase Auth + Firestore emulators only.

Verified:
- signed-out generated pages: **4/4 passed**;
- authenticated protected pages: **3/3 passed** — Timetable, Faculty Dashboard, User Management;
- AFC lazy bundle is actually executed;
- approval lazy bundle is actually executed;
- no Firebase production/cloud endpoint is permitted by the smoke gate;
- no local generated JS/CSS/HTML 404 is accepted;
- no uncaught browser exception is accepted.

The approval smoke exposed a real emulator-initialization race. `UCVM.init()` now configures the Firebase emulators only once, preventing a lazy module from calling `useEmulator()` after Auth has already made a request.

## Verification evidence

Current verified head `d80d445bec92be342627c9bd6dbe5718831b7756`:

- Test workflow run 274: **success**;
- static/unit tests: **success**;
- Firestore/Auth emulator suite: **success**;
- generated build: **success**;
- lightweight metrics step: **success**;
- authenticated Chrome smoke: **success**.

Earlier V1 exact-head verification also completed GitHub Pages Test Site and DOE API Test successfully. PR #49 is intentionally stacked on the integration branch, so those workflows, which are filtered to PRs targeting `main`, do not re-run on every stacked lightweight commit.

## Security / behavior result

The lightweight pass does not weaken or move:
- Firestore authorization;
- sanitized `people_index` privacy;
- append-only audit behavior;
- approval companion-write guarantees;
- DOE server authority;
- DOE evidence immutability;
- production configuration isolation.

## Remaining phase

The remaining proposed optimization is **content-hashed generated assets + cache policy**. Its purpose is repeat-load caching, not further file-count reduction.

Expected file-count reduction for that phase: **0**.

Any cache implementation must:
- keep HTML no-cache;
- hash generated bundle filenames from content;
- rewrite generated references deterministically;
- keep dynamic/lazy bundle URLs correct;
- preserve the same Firebase/Azure generated artifact;
- be verified separately for GitHub Pages, Firebase Hosting and Azure behavior.
