# UCVM DOE API

The DOE API is the authoritative server-side calculation layer for UCVM teaching DOE. Frontend clients submit assignment facts; the API loads the Active annual Rule Book from the repository, calculates DOE, records provenance for writes, and returns worksheet/result contracts used by Lookup, DOE List, Timetable, Swap, and Approval.

## Local tests

From the repository root:

```bash
npm --prefix server install --no-audit --no-fund
npm --prefix server test
```

The root verification command also includes this suite:

```bash
npm run test:all
```

## Run locally

Set the environment values described in `.env.example`, then run:

```bash
npm --prefix server start
```

Health check:

```text
GET /api/health
```

returns:

```json
{"ok":true,"service":"ucvm-doe-api"}
```

All `/api/doe/*` endpoints require a Firebase ID token in `Authorization: Bearer <token>`. The token is resolved to the current `users/{uid}` profile before DOE authorization is evaluated.

## Environment contract

- `PORT` — HTTP listener port. Azure App Service normally supplies this.
- `FIREBASE_PROJECT_ID` — Firebase project used by the server repository/authentication layer.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — complete service-account JSON supplied at runtime only. Never commit it. In Azure, use an App Setting backed by Key Vault, or an approved workload-identity/ADC configuration.
- `ALLOWED_ORIGINS` — comma-separated exact frontend origins allowed to call the API, for example `https://alex1122341.github.io`. Requests from an Origin outside the allowlist fail closed with `ORIGIN_NOT_ALLOWED`.
- `DOE_REPOSITORY` — currently `firestore`; reserved as the storage adapter selector for the future Azure SQL repository.

If `FIREBASE_SERVICE_ACCOUNT_JSON` is present but is invalid JSON or lacks required credential fields, server startup fails closed.

## Trust boundary

The browser is not authoritative for DOE formulas, rates, mappings, or deterministic results. The API uses database policy configuration and server-side calculation. Firebase Admin SDK writes bypass client Firestore Rules, so API authorization and service contracts are mandatory; the browser-facing Rules intentionally deny direct DOE policy/evidence writes.

## App Service package

The server imports shared DOE/domain modules from the repository root, so `server/` must **not** be deployed by itself. Build the App Service artifact from the repository root:

```bash
node tools/build-doe-api.js
```

This stages `output/doe-api/` with `server/` plus every shared runtime module at the relative paths expected by the server. The deployment root is `output/doe-api/`, and the startup command remains:

```bash
npm --prefix server start
```

CI smoke-loads the staged entrypoint before the branch is eligible for deployment.

## Deployment boundary

The staged artifact is prepared for Azure App Service verification, but repository CI only tests it. No workflow in this package deploys the DOE API to production. Production deployment requires separate explicit authorization and Azure environment configuration. A locked server dependency graph is also required before production artifact approval.
