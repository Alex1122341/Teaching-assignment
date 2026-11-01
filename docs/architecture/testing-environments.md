# Testing environments and source map

Repository inspected at main069914cdfa1c2fb0f844b0abdd278f5275bde8f4 on2026-10-28. Workflow files and generated banner/metadata, not an old repository name or URL, establish the mode under test.

| Mode | Entry/build | Identity and data | What a pass proves |
| --- | --- | --- | --- |
| PAWS Frontend Demo (normal same-repository PR Pages workflow) | `tools/build-static.js`, then `tools/build-paws-pages.js`, then `tools/stage-github-pages.js --mode paws` | `frontend/` PAWS pages; `tools/pages-demo-api/` bundles reusable server APIs against synthetic in-browser repositories; simulated Auth/role selector and localStorage | UI and simulated workflow behavior only. Not real authentication, Firestore rules, SQL concurrency, email delivery or secure document storage. |
| Legacy Frontend Demo (`--mode demo`) | `web/` build plus explicit demo staging | Legacy browser pages and synthetic Firebase-compatible runtime | Legacy demo behavior only; do not substitute it for the PAWS page set. |
| Firebase Lab (manual only) | `.github/workflows/firebase-lab-pages.yml`; `tools/stage-github-pages.js --mode lab` | Legacy `web/` app; real Firebase Auth/Firestore restricted to vista-teaching-lab; DOE browser writer off | Only the exact Lab workflows and fixtures actually exercised. No University SQL proof. |
| PAWS Beta reference (outside this repo) | Alex1122341/Teaching-assignment-azure | Hosting/Auth → University API → University SQL; some SQL-authorized collaboration storage | Separate deployed-system acceptance. This repository contains ported source/tests, not that live deployment. |

## Source ownership

- `frontend/pages`, `frontend/scripts`, `frontend/styles`, `frontend/assets`: PAWS UI used by the default `--mode paws` build; allowlist `tools/static-assets.paws.json`.
- `tools/pages-demo-api`: browser adapter, synthetic store/repositories, safe shims and testing-only helpers. `pending()` / DEMO_AREA_PENDING means missing behavior; mark it Blocked.
- `web/`: legacy Firebase-facing app. Its allowlist is `tools/static-assets.json`; bundle map is `tools/runtime-bundles.json`. Paths are relative to web/. Preserve its tests and separate build.
- `server/src`: reusable API, DOE and SQL-related implementation. Running this code in a browser against mock repositories does not run SQL.
- `firebase/`: Lab Firestore rules/indexes. Ordinary data authorization is enforced here only in the real Lab path, not by the Demo role panel.
- `database/`, `deploy/`, dated reports: historical/ported operational material. Their presence is not authorization to migrate or deploy production.
- `docs/architecture/graphify`: public source-only relationship snapshot. It is documentation, never a web runtime asset.

## Mode and deployment checks

The normal PR workflow is `.github/workflows/github-pages-test.yml`: exact PR head, PAWS demo build and browser smoke, then shared GitHub Pages deployment. Check its actual deployment URL and banner PR/SHA. Another same-repository PR can replace the shared site; there is no automatic private preview URL per PR.

Firebase Lab publishes only with its manual confirmation and optional explicit publish input. The two workflow concurrency groups differ, so coordinate operators before overwriting the shared URL. Repository secrets contain configuration; never print them. Public Web SDK config is not an Admin credential. Keep any real DOE API origin blank in Lab and use trusted admin tooling for DOE writes.

Documentation changes do not seed cloud data, create real users, enable trusted write gates, run database migrations or deploy the SQL Beta. The PR Pages workflow **can** republish the browser-local test site.

## Known baseline differences (originally recorded on 2026-10-28)

1. Existing AGENTS.md described an old Alex1122341 repository and Lab default; current workflow actually uses this organization and PAWS Frontend Demo. The new entry documents supersede that description.
2. Legacy `web/js/core/faculty-access.js` still schedules an administrator Dashboard redirect. Calendar-home is a product requirement; record a failing acceptance case until the runtime is changed and tested.
3. The current port has no `server/src/access/` PR148 effective-access subsystem. Its old user-management form and simulated role edits do not prove SQL-authorized dated multi-role administration.
4. Demo API `ALL_WRITES` makes simulated gates true. Actual production gate parity, persistence, idempotent audit and transaction/rollback require a real isolated backend lane.
5. Some older directory/tool README material links to missing SETUP/shared paths or retired Azure hosts. Resolve paths against current files; retain operational history as history.

For permissions, use the [authority-specific matrix](../security/role-matrix.md). For acceptance, use the [manual test catalog](../acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md).
