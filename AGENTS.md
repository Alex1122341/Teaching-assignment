# AGENTS.md

## First visit — required
Read [agent.md](agent.md), [PAWS_CONSTITUTION.md](PAWS_CONSTITUTION.md), the [environment map](docs/architecture/testing-environments.md) and [role matrix](docs/security/role-matrix.md) before substantive changes. They explain the product, selected runtime and authority-specific permissions. Use the [English manual acceptance catalog](docs/acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md) for affected workflows.

## Repository and modes
- Target repository: **UCVM-Teaching-Assignment/Teaching-assignment**. Work on a feature branch and reviewed PR against main; preserve unrelated work.
- Normal PR Pages publication is the **PAWS Frontend Demo**: synthetic, browser-local data and simulated identity. The shared URL/banner identifies the actual deployed PR/SHA. Inspect `.github/workflows/github-pages-test.yml` before a release.
- PAWS Demo sources are `frontend/` and `tools/pages-demo-api/`; build using `tools/build-paws-pages.js` and stage `--mode paws`. Its public allowlist is `tools/static-assets.paws.json`.
- Legacy `web/` has a separate build: `tools/build-static.js`, `tools/static-assets.json`, `tools/runtime-bundles.json`. Keep its tests/build intact. Edit the source tree actually selected by the task.
- Firebase Lab is manual, explicitly selected and restricted to **vista-teaching-lab**. Review `.github/workflows/firebase-lab-pages.yml`. Production tester-teaching and University SQL are outside this Testing target.
- Publish only the generated `.deploy-static` artifact for the chosen mode. Documents, Graphify, credentials, exports, staff originals and repository sources are not runtime assets. Historical Azure/SQL tooling is not an active deployment instruction.

## Authority and data
Use the selected authority's existing role/scope helpers: legacy `web/js/core/faculty-access.js`, PAWS `frontend/scripts/faculty-access.js`, ported API `server/src/auth/role-policy.js`, and Lab `firebase/firestore.rules`. Differences are recorded in the role matrix; a browser alias must never expand a server role. Formal roles and additional Developer/ADC/LAB office contexts are not interchangeable.

Enforce scope, privacy, stale-request protection and approvals at the trusted boundary. Demo role switching is only a UI test harness. Preserve binary AFC availability, sanitized faculty candidates, required Sessional/Other notes and final availability rechecks. Read the Constitution before changing names, DOE, academic-year scope, originals, migrations or audit behavior. Keep authoritative DOE writes out of the Lab browser; use reviewed trusted admin tooling. Never weaken Firestore rules to make a screen work.

## Graphify — before relationship tracing and after every merge
Read [the graph guide](docs/architecture/script-dependency-graph.md). Consult the raw index or views **before** investigating imports/calls, build wiring, API/repository dependencies or change impact; verify referenced current source. Refresh when the source fingerprint differs or the graph is missing. After every merge, regenerate raw index and both views from exact merged main, record SHA/hash/counts/warnings and verify a source edge. An absent edge does not prove a script unused. Keep raw multigraph intact; cluster a copy. Code-only extraction must not upload source or invoke model labeling.

## Verification and handoff
- Use tests before behavior changes where practical; preserve audit, version/revision checks, DOE calculations, approval rules and lazy/deferred feature boundaries.
- Run `npm test` before claiming completion. Use `npm run test:all` for static/server coverage; rules changes also need the Firestore/Auth emulator suite when available. Report environmental blockers and skips accurately.
- Build/test the selected artifact. Root package scripts and workflow files are authoritative for commands.
- Manual acceptance uses synthetic fixtures and the specified Demo/Lab/backend lane. Missing fixtures/adapters are Blocked, not Pass or silently N/A.
- Report tested SHA/mode, changed files, tests, evidence and remaining gaps. Separate implementation, simulation, real persistence/security acceptance and human signoff.
