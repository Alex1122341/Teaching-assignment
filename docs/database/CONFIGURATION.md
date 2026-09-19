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
| Configuration | committed (`firebase-config.js`) | generated at deploy time, never committed |

---

## 2. Files

| File | Purpose |
| --- | --- |
| `firebase-config.js` | **Single source of truth** for the client configuration. Committed default targets the lab project. |
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

Production configuration is **generated at deploy time and never committed**.
The deploy pipeline must:

1. Run `node tools/build-firebase-config.js --project <production-project-id>`
   in the build step, before `tools/build-static.js`.
2. Deploy with an explicit `--project`. Never rely on the `.firebaserc` default.
3. Keep the production project out of `.firebaserc` `default`, so a mistaken
   deploy lands on the lab project rather than in production.

**Never commit a production API key, service-account key, or deployment token to
this repository.** `tests/firebase-config.test.js` fails the build if a real
Firebase API key pattern or the legacy project id reappears in a runtime file.

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
