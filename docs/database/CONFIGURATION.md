# CONFIGURATION.md — Databases, Projects and Client Configuration

**Lab project:** `vista-teaching-lab` (Firestore Native, `northamerica-northeast1` / Montreal)
**Reserved live project:** `tester-teaching` — not used by the active GitHub Pages test path; retained for future production migration.

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
| Public exposure | fixed GitHub Pages test site; synthetic/test data only | not used by the active test site |
| Configuration | committed lab-targeting template (`firebase-config.js`); GitHub Pages injects public Web SDK config from `LAB_FIREBASE_WEB_CONFIG_JSON` | legacy/future production configuration retained separately |

---

## 2. Files

| File | Purpose |
| --- | --- |
| `firebase-config.js` | **Single source of truth** for client Firebase configuration. The committed template targets the lab project with placeholder SDK values. GitHub Pages regenerates this file from `LAB_FIREBASE_WEB_CONFIG_JSON` before building. |
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

## 6. GitHub Pages lab runtime and trusted DOE administration

The active browser test runtime is the fixed GitHub Pages site:

`https://alex1122341.github.io/Teaching-assignment/`

The workflow requires repository Actions variable `LAB_FIREBASE_WEB_CONFIG_JSON`. It must contain the public Firebase Web SDK configuration for **`vista-teaching-lab`**. The workflow writes it only to a runner temporary file, regenerates `firebase-config.js`, and fails closed unless the resulting project is exactly `vista-teaching-lab`, emulator mode is off, and `UCVM_DOE_API_BASE_URL` is blank.

The Firebase Web SDK configuration is public client metadata. It is not a service credential and must never contain a private key.

Authoritative DOE writes use a separate trust boundary:

- workflow: `.github/workflows/firebase-doe-admin.yml`
- GitHub Environment: `firebase-lab-admin`
- Environment secret: `FIREBASE_LAB_SERVICE_ACCOUNT_JSON`
- Firebase project lock: `vista-teaching-lab`
- execution: manual `workflow_dispatch` only
- destructive operations: exact typed confirmation is required for policy publish, full recalculation, and queued recalculation processing

The admin job reuses the existing DOE server services directly. It does **not** expose a long-lived HTTP API and it does not grant browser write access to authoritative DOE collections.

For normal Firebase-only timetable mutations, authorized admins may create strict `pending` `doe_recalculation_requests`. The browser strips old DOE provenance from the affected session assignments and does not generate replacement DOE values. Run the `recalculate-queue` operation with confirmation `PROCESS-QUEUE` to consume those requests with the trusted server-side engine.

One-time setup for the lab:

1. In Firebase Authentication for `vista-teaching-lab`, enable Email/Password.
2. Add `alex1122341.github.io` to **Authentication > Settings > Authorized domains**.
3. Create test-only Authentication accounts and matching `users/{uid}` profiles.
4. In GitHub **Settings > Secrets and variables > Actions > Variables**, create `LAB_FIREBASE_WEB_CONFIG_JSON` with the lab Web SDK JSON.
5. Create GitHub Environment `firebase-lab-admin` and add test-only secret `FIREBASE_LAB_SERVICE_ACCOUNT_JSON`.
6. Seed synthetic Firestore data with `npm run db:seed`, then verify with `npm run db:verify`.
7. Deploy lab Firestore rules/indexes with `npm run db:deploy`.

Azure production workflows are retained in the repository as paused/fallback infrastructure. They are not prerequisites for Pages testing, Firebase lab data, or the DOE admin job.

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
