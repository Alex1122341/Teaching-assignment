# CONFIGURATION.md — Databases, Projects and Client Configuration

**Lab project:** `vista-teaching-lab` (Firestore Native, `northamerica-northeast1` / Montreal)
**Legacy shared project:** `tester-teaching` — no longer referenced by any runtime file.

---

## 1. Why there is a separate lab project

This repository is **public**, and every pull request publishes a GitHub Pages
preview site. Before this change the client configuration was hard-coded inside
`faculty-access.js` and `faculty-admin.js` and pointed at the shared live project,
so a public preview URL talked to live data.

The lab project fixes that:

| | Lab project | Production |
| --- | --- | --- |
| Data | synthetic only (`tools/seed/dataset.js`) | real |
| Public exposure | acceptable — nothing real in it | must never be reached from a preview |
| Configuration | committed lab-targeting template (`firebase-config.js`); usable cloud values are generated/injected for the preview build | generated at build time from a tools-only public Web SDK config plus the external DOE API URL |

---

## 2. Files

| File | Purpose |
| --- | --- |
| `firebase-config.js` | **Single source of truth** for client Firebase configuration. The committed template targets the lab project but intentionally contains placeholder SDK values; a cloud preview needs generated/injected lab SDK configuration. |
| `.firebaserc` | Project aliases. `default` is the lab project, so a deploy without `--project` cannot reach production. |
| `firebase.json` | Rules, indexes, hosting and emulator ports. |
| `firestore.rules` | Authorisation model. See `docs/database/SCHEMA.md`. |
| `firestore.indexes.json` | Composite indexes. |
| `tools/build-firebase-config.js` | Regenerates `firebase-config.js` from the Firebase CLI without printing values. |
| `tools/seed-database.js` | Seeds a database (emulator or live). |
| `tools/seed/dataset.js` | Deterministic synthetic dataset. |

---

## 3. Local development

No cloud project and no credentials are required. When the page is served from
`localhost`, `firebase-config.js` sets `UCVM_FIREBASE_EMULATOR`, and
`faculty-access.js` points the SDK at the Emulator Suite.

```bash
npm ci
npm run db:seed:emulator      # starts the emulator, seeds it, verifies 254/254
firebase emulators:start      # serve the app against the local database
```

To serve the static bundle directly:

```bash
node tools/build-static.js    # writes .deploy-static/
```

---

## 4. Commands

| Command | Effect |
| --- | --- |
| `npm test` | static + unit tests (unchanged, used by CI) |
| `npm run test:static` | static tests with a loud warning when tests were skipped |
| `npm run test:emulator` | full suite with the Firestore and Auth emulators |
| `npm run db:seed` | seed the lab project |
| `npm run db:verify` | confirm every seeded document is present |
| `npm run db:seed:emulator` | seed the emulator |
| `npm run db:deploy` | deploy rules and indexes to the lab project |
| `npm run config:generate` | regenerate `firebase-config.js` |

---

## 5. Pointing at a real project

```bash
node tools/build-firebase-config.js --project <project-id>
```

The generator writes the values straight to `firebase-config.js` and prints only
the project id, so it is safe to run in a CI log.

To deploy rules and indexes to a specific project:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project <project-id>
```

---

## 6. Production

Production runtime configuration is generated during the `main` build.

The Firebase Web SDK config for production project `tester-teaching` is pinned in `tools/production-firebase-web-config.json`. This is public client configuration, not a server credential. The file is deliberately outside `tools/static-assets.json`, so it is not shipped as a standalone frontend asset and is never used by pull-request previews. PR previews continue to use the isolated lab configuration.

Before a production release can build, define this GitHub repository **Actions variable**:

- `PRODUCTION_DOE_API_BASE_URL` — the approved HTTPS Azure App Service base URL for the DOE API.

After tests/emulators pass, the `Azure Static Web Apps` main-push workflow runs:

```bash
node tools/build-firebase-config.js --from-json tools/production-firebase-web-config.json --doe-api-base-url "$PRODUCTION_DOE_API_BASE_URL"
node tools/verify-production-client-config.js
node tools/verify-production-doe-api.js
node tools/build-static.js
```

The main build fails closed if the DOE API URL is missing/invalid or if the live DOE API health/CORS verification fails.

The verifier requires project `tester-teaching`, a non-placeholder Firebase web config, emulator mode off, and a non-local HTTPS DOE API endpoint before the production artifact can be uploaded.

For Firebase Rules/index deployment, always use an explicit `--project tester-teaching`. Never rely on the `.firebaserc` default. Keep the production project out of `.firebaserc` `default`, so a mistaken deploy lands on the lab project rather than in production.

**Never commit a service-account key, deployment token, ARM token, or other server credential to this repository.** Firebase Web SDK configuration is public client metadata; the production copy is allowed only in the tools-only config file and must never be hard-coded into runtime source files or added to the preview/deployment source allowlist. `tests/firebase-config.test.js` enforces that boundary.

---

## 7. Guardrails already in place

| Guard | Where |
| --- | --- |
| No hard-coded project config in runtime sources | `tests/firebase-config.test.js` |
| Config loads before the shared Firebase helper | `tests/firebase-config.test.js` |
| Deploy default is the lab project | `.firebaserc` + `tests/firebase-config.test.js` |
| Mirror/preview safety | the `MIRROR.md` policy document, which lives in the `Mirror-Teaching-` repository rather than this one |
| Rule evaluation budget | `tests/rules-evaluation-budget.test.js` |

---

## 8. Adding a new collection

1. Add the collection and its fields to `docs/database/SCHEMA.md`.
2. Add `match` rules to `firestore.rules` with an explicit `hasOnly(...)` field
   allowlist and `update`/`delete` decisions.
3. Add composite indexes to `firestore.indexes.json` if any query needs them.
4. Add synthetic documents to `tools/seed/dataset.js`.
5. Re-seed and verify: `npm run db:seed && npm run db:verify`.
6. Deploy: `npm run db:deploy`.
7. Add a positive **and** a negative emulator test for the new access boundary.
