# DOE API — Azure App Service Deployment Contract

## Purpose

The UCVM DOE API is the authoritative calculation service for Annual DOE Rule Book operations and faculty teaching DOE. GitHub Pages / VISTA remains the static frontend. The browser sends assignment facts and Firebase identity tokens; the API performs rule lookup, mapping resolution, calculation, protected writes, audit/provenance, recalculation, and Faculty DOE Worksheet generation.

## Target topology

```text
VISTA / GitHub Pages or Azure static frontend
                 |
                 | HTTPS + Firebase ID token
                 v
        Azure App Service — DOE API
                 |
                 | server repository adapter
                 v
              Firestore
```

The repository adapter is intentionally isolated so Firestore can later be replaced by an Azure SQL adapter without changing the public DOE API contract.

## Runtime

- Node.js 22
- Source package: `server/`
- App Service artifact: `output/doe-api/`, created with `node tools/build-doe-api.js` from the repository root.
- The artifact preserves `server/` and the shared root DOE/domain modules at the relative paths used by the server imports. Deploying `server/` by itself is unsupported.
- Start command from the artifact root: `npm --prefix server start`.
- Health endpoint: `GET /api/health`

## Required Azure App Settings

```text
FIREBASE_PROJECT_ID=<authorized Firebase project id>
FIREBASE_SERVICE_ACCOUNT_JSON=<Key Vault reference or approved runtime credential>
ALLOWED_ORIGINS=https://alex1122341.github.io,<approved production frontend origin>
DOE_REPOSITORY=firestore
```

`PORT` is normally injected by Azure App Service.

Do not commit a Firebase service-account JSON. For Azure production, store the secret in Key Vault and expose it through an App Setting / Key Vault reference, or use an approved workload identity / Application Default Credential arrangement. Invalid credential JSON causes startup to fail closed.

## Browser API configuration

The frontend reads the DOE API base URL from the existing runtime configuration surface (`window.UCVM_CONFIG.doeApiBaseUrl` / `window.UCVM_DOE_API_BASE_URL`). The production main-build injects this from the GitHub Actions repository variable `PRODUCTION_DOE_API_BASE_URL`; the production hostname is not committed to source.

The main-build production verifier requires a non-local HTTPS endpoint. It then calls `GET /api/health` with the Azure Static Web Apps production Origin and requires both the expected `{ok:true, service:"ucvm-doe-api"}` payload and the matching `Access-Control-Allow-Origin` response header. The configured frontend origin must therefore appear in the App Service `ALLOWED_ORIGINS`; otherwise the production artifact build fails before upload. The build does not deploy the App Service itself, so the endpoint must already exist and be healthy before a production release is approved.

## CI verification

Pull requests use `.github/workflows/doe-api-test.yml` to:

1. check out the exact PR head;
2. use Node 22;
3. install `server/` dependencies;
4. run the DOE API test suite;
5. verify the Firebase Admin package resolves;
6. stage `output/doe-api/` with `node tools/build-doe-api.js`;
7. smoke-load the staged `server/src/server.js` entrypoint.

The workflow has read-only repository permission and contains no Azure deployment step.

The main Test and GitHub Pages workflows also execute `npm run test:all`, so frontend/root and server test suites are part of the same exact-head acceptance gate. Firestore/Auth emulator tests remain in the existing root CI gate.

## Production deployment gate

The repository includes the manual `.github/workflows/azure-doe-api-production-deploy.yml` workflow. It never runs on a push or pull request. It accepts only an exact commit SHA and refuses to deploy unless that SHA is the current `main` head.

One-time GitHub/Azure configuration:

- create the Azure App Service with Node.js 22;
- set GitHub Actions variable `DOE_API_APP_NAME` to the App Service name;
- set GitHub Actions variable `PRODUCTION_DOE_API_BASE_URL` to its HTTPS base URL;
- add `AZURE_DOE_API_PUBLISH_PROFILE` as a secret in the GitHub `production` Environment;
- configure the App Service settings listed above, including the authorized Firebase project/credential, `DOE_REPOSITORY=firestore`, and `ALLOWED_ORIGINS`.

The staged App Service artifact now has a root `package.json` whose `npm start` delegates to `npm --prefix server start`. The deployment workflow installs production server dependencies into the staged package, creates an immutable zip, deploys that exact zip with the pinned Azure Web Apps deploy action, and then retries the production `/api/health` + CORS verifier.

Before deployment, require all of the following:

- exact-head root/unit/server CI green;
- exact-head Firestore/Auth emulator suite green;
- GitHub Pages test build green;
- non-destructive UI acceptance complete;
- approved Azure App Service and Key Vault/runtime credential configuration;
- the required GitHub production Environment secret and Actions variables;
- separate authorization for any Firebase production Rules/data migration/recalculation.

Deploying the DOE API does not itself authorize a production data migration or administrative recalculation.
