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
| Public exposure | optional backend-integration target only; the active Pages demo does not connect to it | not used by the active test site |
| Configuration | committed lab-targeting template (`firebase-config.js`) plus optional lab tooling for a later backend phase | legacy/future production configuration retained separately |

---

## 2. Files

| File | Purpose |
| --- | --- |
| `firebase-config.js` | **Single source of truth** for real Firebase client configuration. The committed template targets the lab project with placeholder SDK values; GitHub Pages Frontend Demo Mode overrides Firebase only in the staged artifact and does not require a real Web config. |
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
| `npm run config:pin:lab` | fetch and pin the public `vista-teaching-lab` Web SDK config |
| `npm run lab:bootstrap-user` | create/reuse a lab Auth user and synchronize its `users/{uid}` profile using Admin credentials |
| `npm run lab:auth:check` | verify Email/Password + Pages authorized-domain readiness using Admin credentials |
| `npm run lab:auth:configure` | enforce the lab Auth boundary with exact project confirmation |
| `npm run lab:data:verify` | verify the canonical synthetic dataset through Admin credentials |
| `npm run lab:data:seed` | seed and verify the canonical synthetic dataset through Admin credentials |

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

## 6. GitHub Pages frontend demo and optional Firebase lab backend

The active browser test runtime is the fixed GitHub Pages site:

`https://alex1122341.github.io/Teaching-assignment/`

For the current frontend-first phase, GitHub Pages does **not** connect to Cloud Firestore or Firebase Authentication. After the normal build and CI verification, `tools/stage-github-pages.js` injects:

- `pages-demo-data.js` — the deterministic synthetic dataset from `tools/seed/dataset.js`
- `pages-demo-runtime.js` — an in-browser Firebase Auth/Firestore compatibility layer

The staged demo auto-signs a synthetic account, supports role switching, reads/writes browser-local demo state, and provides a reset control. No demo write leaves the browser.

Authoritative DOE is disabled in this mode. The Pages artifact never receives a DOE API URL and does not present browser-computed DOE as authoritative.

The Firebase lab project `vista-teaching-lab` remains available for a later backend-integration phase. Its Web config pinning, Auth setup, user bootstrap, synthetic data setup, rules/index deployment, and DOE Admin jobs are all optional/manual and do not block the Pages demo.

### Optional future lab Admin credential

When cloud-backend testing resumes, use a dedicated test-only `firebase-lab-admin` service account with least-privilege roles:

- `roles/identitytoolkit.admin`
- `roles/datastore.user`
- `roles/firebaserules.admin`
- `roles/datastore.indexAdmin`

Store its JSON only in the GitHub Environment secret `FIREBASE_LAB_SERVICE_ACCOUNT_JSON`. Never commit it.

Azure production workflows remain paused/fallback infrastructure and are not prerequisites for the Pages frontend demo.

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
