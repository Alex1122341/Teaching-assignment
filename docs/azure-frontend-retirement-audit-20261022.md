# PAWS Beta Azure frontend retirement inventory (2026-10-22)

## Scope and source provenance

Read-only whole-tree search was performed against:
- `Alex1122341/Teaching-assignment-azure` main at `ad605dbb9ab92457df972703c723e2b991fa284c` (1,035 tracked files).
- Open PR #125 at `099d6b809f9bf3618e77bb5f5a139043b28d10e4`.
- Every allowlisted static resource in `tools/static-assets.json` (85 on main, 86 on PR #125).
- Frontend HTML/CSS/JS, environment configuration, build scripts, workflows, packaging wrappers, SQL-related adapters and relevant frontend test dependencies.

Search categories: Azure/ACA/ACR/SWA, Azure URLs/domains, MSAL/Microsoft identity, static deployment tokens, release outputs, static imports and SQL-backed UI state names. This inventory distinguishes a **browser dependency** from a **historical name** and from an **actual non-browser Azure cloud service**.

## Published browser assets: only two files required changes

| Source | Observed residue before change | Minimal replacement |
| --- | --- | --- |
| `paws-data-client.js` | `createPawsAzureDataClient` (5 occurrences) | `createPawsDataClient`; retain `UCVM_PAWS_DATA`, Firebase token provider and existing HTTPS University API semantics |
| `timetable.js` | `azureSessionRow`, `fetchAzureSessions`, `azure-sql*` view states, and user-visible `PAWS Azure data client` error | `mapPawsSessionRow`, `fetchPawsSessions`, `vetmed-ops*` internal states and generic PAWS data client error |

No published HTML, CSS, other JS or JSON asset matched the Azure/SWA/MSAL indicators. No Azure Static Web Apps HTTP origin was identified in the current Firebase static bundle. The live origin is separately configured in `paws-api-origin.js` for the University-hosted API via Cloudflare.

All existing timetable, AFC, DOE and faculty business paths remain unchanged; only internal client aliases, UI states and message text are renamed. Related frontend tests are updated and a new manifest-wide regression guard prevents Azure front-end references reappearing.

## Existing Azure Static Web Apps removal (do not redo)

The legacy SWA static deployment workflows, `tools/deploy_azure_static_web.ps1` and `staticwebapp.config.json` were deleted by the 2026-10-19 retirement. The active browser host is **Firebase Hosting**. See `agent.Ai/updates/2026-10-19-retire-azure-swa-static.md`.

## Non-browser Azure items discovered, **not modified in this frontend-only PR**

1. `.github/workflows/azure-beta-aca-deploy.yml` and `.github/workflows/azure-beta-acr-publish.yml` still implement ACA/ACR deployments. They are non-database Azure infrastructure. Deprecate via a **separate deployment migration** after confirming no consumers; do not remove a production deployment path by renaming frontend UI symbols.
2. `.github/workflows/azure-beta-build.yml` still builds an ACA Functions container; `deploy/aca/Dockerfile` uses an Azure Functions base image. The build also creates the frozen `.azure-production` artifact consumed by current Firebase Hosting release provenance. Replace this build contract in a separate coordinated release-governance PR.
3. `swa-api/index.js`, `swa-api/host.json` and `swa-api/package.json` contain Azure Functions host registration and dependency. This wrapper is not browser-shipped. `server/src/runtime/swa-sql-runtime.js` and `server/src/runtime/university-api.js` are **live University API dependencies** and MUST be retained; migrate any unused Functions adapter only with API freeze/deployment audit.
4. `tools/build-beta-release.js`, `tools/build-swa-api.js` and related freeze scripts/tests use historical SWA and `.azure-production` names. Names alone do not create a cloud dependency; changing artifact paths would currently invalidate the GitHub CI and Firebase release attestations.
5. `tools/preview_beta_sql_runtime.ps1` retains obsolete Static Web Apps administration/settings guidance even though it otherwise addresses SQL. Review separately against existing SQL operational tooling.

## Open PR #125 integration blocker

PR #125 introduces an independent Testing UI and identity switcher, which is conceptually platform-neutral and should be retained. However, **its Testing infrastructure design still mandates Azure non-DB components**:
- `config/environments/testing.template.json`: `*.azurecontainerapps.io` API origin.
- `.github/workflows/paws-testing-deploy.yml`: ACR/ACA-based API deployment.
- `.github/workflows/paws-testing-db-reset.yml`: Azure-specific Testing SQL provisioning/networking workflow.
- `deploy/testing/testing-api.env.template`, `tools/verify-testing-api-env.js` and `tools/testing-preflight.js`: Azure Container Apps assumptions.
- `server/src/runtime/environment.js`: Testing SQL host restrictions are DB-specific but its validation should be reviewed if the final DB is not Azure SQL.

**PR #125 must be rebased and its non-database Azure Testing architecture redesigned** before it merges; do not create paid ACA/ACR resources to satisfy retired infrastructure instructions. The current frontend cleanup intentionally does not rewrite PR #125 or change SQL access policy.

## In-scope and out-of-scope safeguards

In scope: two shipped JS files, associated source-level tests, no-Azure-static-asset test and this audit.

Out of scope: SQL data/schema, Firebase/Auth projects, University Node API, SQL connection methods, Docker/ACA deployment cutover, production hosting, PR #125 source and existing release history. Do not delete `database/azure-sql/**`, DB-related Azure authentication code, `swa-sql-runtime.js` or historical audit records.

The immutable static freeze is promoted with a separate governance commit anchored to the accepted product commit; all API runtime bytes and SQL files remain unchanged.
