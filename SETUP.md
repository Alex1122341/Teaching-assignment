# Faculty Dashboard - Spark Basic Mode

VISTA uses Firebase Authentication and Firestore on the Spark-compatible client architecture. Production remains `tester-teaching`; committed pull-request/runtime configuration defaults to the isolated synthetic-data lab project `vista-teaching-lab`, and localhost uses the Firebase Emulator Suite.

## What works without Blaze

- Email/password sign-in through Firebase Authentication.
- ADFA General, ADFA Regular, HICC, VISC and Faculty profiles.
- ADFA General profile-first account creation and reviewed bulk provisioning from faculty records.
- HICC group ownership, course scope and membership. HICCs can change members in their own groups.
- Faculty self-service in Timetable, including Day/List teaching views, AFC requests, and privacy-safe replacement requests.
- ADFA timetable/session editing and faculty records in Faculty Dashboard.
- Dashboard-originated history in `session_change_log` and `faculty_change_log`, including before/after details for new edits.
- Self-service password change and Firebase password-reset email.

## Intentional Basic Mode limits

- Account creation uses Firebase Authentication's client API from a temporary secondary session, so the signed-in Owner session stays active. Existing Authentication users that are not linked to a dashboard profile still require individual review.
- HICC/VISC direct instructor replacement is view-only. ADFA administrators perform live timetable changes.
- Audit logs are written by the dashboard together with the edit. Direct Firebase Console edits are not automatically audited.
- `mustChangePassword` is a dashboard workflow control rather than a server-verified password-change claim.
- No Cloud Functions runtime is included or deployed. The repository contains only the Spark client and local test tooling.

## Activation order

1. Keep the current website and Firebase data backed up.
2. In Firebase Console > Authentication, confirm Email/Password sign-in is enabled.
3. Find the existing administrator in Authentication and copy the UID.
4. In Firestore Console, open `users/{UID}` for that administrator and set:
   - `role`: `adfa_general`
   - `active`: `true`
   - `mustChangePassword`: `false` (unless you intentionally want the password-change page first)
   Do this before relying on the new User Management page. Legacy `admin` still retains timetable and Faculty Dashboard access but is not ADFA General.
5. From the repository root deploy **rules and indexes** for initial activation:
   ```bash
   npx firebase deploy --project vista-teaching-lab --only firestore:rules,firestore:indexes
   ```
   If the local Firebase CLI dependency is unavailable later, any Firebase CLI installation can deploy these rules; Cloud Functions are not required.
6. Complete the one-time GitHub Pages, Firebase Authorized Domain, and **Firebase DOE Admin Job** setup in **Web deployment** below. Azure production setup is paused and is not required for the active development path.
7. Sign in once as Owner / ADFA General or another administrator and open **Faculty Dashboard**. If the privacy-safe faculty replacement directory does not exist yet, the dashboard creates `settings/faculty_swap_index` and the admin-only `settings/faculty_swap_map` from the current Faculty Database.
8. Open User Management.
9. To add one person, choose their faculty profile in **New account**. The profile supplies the name and email; choose the access role and enter a temporary password. Firebase supplies the Authentication UID after creation.
10. To prepare all faculty accounts, choose **Preview changes** under **Create missing faculty accounts**. Review the proposed creates, access updates, excluded records, and source-role cleanup before entering the temporary password and selecting **Apply reviewed changes**.
11. Keep **Require password change on next dashboard sign-in** selected for new accounts. The temporary password is sent only to Firebase Authentication and is not stored in Firestore, source code, or audit logs.
12. Create HICC groups, assign an HICC owner, course numbers and members.
13. Test with one Administrator, one HICC and one Faculty account before broader rollout.

## Link existing ADC/LAB Authentication users

When an ADC or LAB Firebase Authentication account already exists, link it to the dashboard instead of creating a second Authentication user:

1. Sign in as **Owner / ADFA General** and open **User Management**.
2. Start a new account profile and choose **ADC** or **LAB**.
3. Enter the office display name and email address.
4. Paste the account's existing Firebase Authentication UID into **Existing Firebase Authentication UID**.
5. Keep **Active** enabled and keep **Require password change on next dashboard sign-in** enabled unless there is an approved exception.
6. Save the profile. **Do not recreate the Authentication user** when an existing UID is being linked.
7. Sign in non-destructively with the office account and verify that its calendar and role-scoped tools match the approved ADC/LAB permission matrix.

Do not store the UID or temporary password in this repository, documentation, screenshots, issue comments, or client code. Retrieve the UID from the authorized Firebase Authentication administration view only when it is needed for the Owner linking step.

## Web deployment

The active development/test path is now a **frontend-first GitHub Pages demo**:

- **Fixed test frontend:** `https://alex1122341.github.io/Teaching-assignment/`
- **Runtime data:** deterministic synthetic data loaded into a browser-local in-memory Firestore/Auth compatibility layer
- **Cloud writes:** none
- **Authoritative DOE backend:** disabled on the Pages demo
- **Firebase lab / DOE admin:** retained as optional manual backend tooling for a later phase
- **Azure:** paused

The Pages build still runs the full static/unit and Firebase Emulator test suites before deployment. After verification, `tools/stage-github-pages.js` injects the Pages-only demo runtime and synthetic dataset into the generated static artifact. The tracked application source keeps its normal Firebase architecture; only the staged Pages artifact is switched to the in-browser demo backend.

The demo auto-signs in with a synthetic ADFA General account and adds a small role selector so the same fixed site can be exercised as Faculty, HICC, VISC, ADC, LAB, and administrative roles. Demo writes persist only in that browser's local storage and can be reset from the demo toolbar.

The authoritative DOE API is intentionally unavailable. Timetable/Faculty UI can show DOE-related states and queue-like frontend behavior, but the Pages demo does not claim that any DOE value is authoritative.

### GitHub Pages test-site setup

1. In GitHub repository **Settings > Pages**, set the source to **GitHub Actions**.
2. Keep the standard `github-pages` Environment available to same-repository pull-request deployments.
3. No Firebase Web config, Firebase service-account secret, Authorized Domain, or Firebase Authentication user is required to run the Pages demo.
4. Open the fixed Pages URL after a successful PR deployment and confirm the banner says **Frontend Demo** and **DOE backend off**.
5. Use the role selector in the upper-left corner to exercise role-specific UI. Use **Reset demo data** to restore the deterministic synthetic dataset.

The fixed Pages URL always shows the latest successful same-repository pull request deployment. Forked pull requests do not deploy the test site. Firebase Hosting is not used for the active Frontend Demo; GitHub Pages is the fixed browser test host.

### Future Firebase lab backend

The Firebase lab automation remains in the repository for later integration testing, but it is **manual only** and does not block GitHub Pages.

When backend testing becomes a priority:
- create the `firebase-lab-admin` GitHub Environment,
- add `FIREBASE_LAB_SERVICE_ACCOUNT_JSON`,
- configure Auth with **Firebase Lab Auth Setup**,
- create/synchronize test users with **Firebase Lab Bootstrap**,
- seed/deploy `vista-teaching-lab` with **Firebase Lab Data Setup**,
- run trusted DOE operations with **Firebase DOE Admin Job**.

Use a dedicated test-only service account for `vista-teaching-lab`. Prefer these predefined roles rather than Owner/Editor:
- `roles/identitytoolkit.admin`
- `roles/datastore.user`
- `roles/firebaserules.admin`
- `roles/datastore.indexAdmin`

The JSON key belongs only in the GitHub Environment secret `FIREBASE_LAB_SERVICE_ACCOUNT_JSON`; never commit it.

### Firebase Lab browser mode (PAWS second test mode)

PAWS supports two explicit browser test modes. They are never mixed.

**1. FRONTEND DEMO (default for every pull request)**

- deterministic synthetic data
- browser-local Firebase compatibility runtime (`pages-demo-runtime.js`)
- localStorage / in-memory writes
- no Firebase Authentication, no cloud Firestore
- read-only synthetic DOE Rule Book, labelled NON-AUTHORITATIVE
- banner: `TEST SITE - GitHub Pages · Frontend Demo · synthetic browser-local data · DOE backend off`

**2. FIREBASE LAB (manual only)**

- real Firebase Authentication and real Cloud Firestore
- project `vista-teaching-lab` only — never `tester-teaching`
- real `users/{uid}` profiles resolved through the existing `faculty-access.js` authorization code
- Firestore security rules enforced
- real sessions, change requests, approvals, notifications and audit records
- the synthetic compatibility runtime is **not** installed
- banner: `FIREBASE LAB - real Firebase`
- status bar: `Project: vista-teaching-lab · Auth · Firestore · DOE policy data: LIVE · DOE authoritative writer: OFF`

Producing a Firebase Lab artifact:

1. Run the **Firebase Lab Pages** workflow manually (`workflow_dispatch`).
2. Type `FIREBASE-LAB:vista-teaching-lab` as the confirmation.
3. The workflow runs `npm ci`, `npm test`, builds the static site, stages it with `--mode lab`, verifies no synthetic runtime or credential is present, and uploads `firebase-lab-<sha>`.
4. Download the artifact and serve it locally, or type `PUBLISH-LAB-TO-PAGES` to publish it to the shared Pages URL. Publishing is explicit and never automatic.

Firebase Lab mode requires:

- the GitHub Environment `firebase-lab` with the secret `LAB_FIREBASE_WEB_CONFIG`, containing only the **public Firebase Web SDK configuration** for `vista-teaching-lab` (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). Generate it with `npm run config:pin:lab` or `node tools/build-firebase-config.js --project vista-teaching-lab`.
- lab test accounts created by the existing **Firebase Lab Bootstrap** workflow. Do not hard-code passwords or UIDs.
- seeded lab data from **Firebase Lab Data Setup**.

Never put a service-account or Admin credential in `LAB_FIREBASE_WEB_CONFIG`. Those remain GitHub-environment only (`FIREBASE_LAB_SERVICE_ACCOUNT_JSON`).

A normal pull request never produces a Firebase Lab artifact and never turns the shared Pages URL into a cloud-writing site.

Note: `Firebase Lab Pages` is a new workflow file. GitHub only offers `workflow_dispatch` for workflows that already exist on the repository default branch, so it cannot receive a real dispatch acceptance run until this change is merged into `main`. A first post-merge live workflow run remains required to prove the manual dispatch end to end.

### Firebase Lab Data Setup

`.github/workflows/firebase-lab-data-setup.yml` is manual-only. It supports:
- `verify-data`
- `seed-data` with confirmation `SEED:vista-teaching-lab`
- `deploy-firestore` with confirmation `DEPLOY-FIRESTORE:vista-teaching-lab`
- `provision` with confirmation `PROVISION:vista-teaching-lab`

None of these operations run on push or pull request.

### Firebase Lab Auth Setup

The manual **Firebase Lab Auth Setup** workflow can later check or configure Email/Password and the GitHub Pages authorized domain using the lab Admin credential.

### Firebase Lab Bootstrap

The manual **Firebase Lab Bootstrap** workflow can later create or synchronize test Authentication users and matching `users/{uid}` profiles without accepting passwords as workflow inputs.

### DOE admin job

The manual **Firebase DOE Admin Job** remains the future trusted execution path for authoritative policy validation, impact preview persistence, publication, recalculation, and queued recalculation processing. It is not needed for Frontend Demo Mode.

### Azure SQL beta through the existing Static Web App

The current PAWS beta does **not** require a separate App Service. The reviewed beta path reuses the existing Free Static Web App `ucvm-teaching-lab-web` and deploys same-origin Managed Functions beside the frontend. Firebase Authentication remains the user sign-in boundary; the Managed Functions verify the Firebase ID token and access the canonical `paws.*` Azure SQL objects with a dedicated least-privilege contained user.

This is intentionally a beta bridge. The SQL credential and Firebase Admin service-account JSON live only in Static Web Apps server-side Application Settings. They must never be copied into `firebase-config.js`, GitHub source, the static deployment artifact, issue/PR text, or chat.

The first Azure SQL beta slice is read-only for timetable sessions:

- `GET /api/health/sql`
- `GET /api/v1/me`
- `GET /api/v1/sessions`
- timetable reads from Azure SQL when the production client is built with `--paws-session-backend azure-sql`
- session add/edit/delete/swap/multi-edit controls fail closed while that backend is active
- Firestore remains intact as the reviewed rollback path; no request automatically dual-writes or falls back

#### One-time beta server-side configuration

The reviewed targets are pinned in `tools/configure_paws_swa_beta.ps1`:

- subscription: the existing PAWS Azure subscription
- resource group: `rg-ucvm-teaching-lab`
- Static Web App: `ucvm-teaching-lab-web`
- SQL server: `ucvm-teaching-lab-xz-20260911.database.windows.net`
- database: `teaching-assignment-lab`
- contained SQL principal: `paws_swa_beta`

Always run the read-only preview first:

```powershell
.\tools\configure_paws_swa_beta.ps1 -Preview
```

Preview verifies the pinned Azure resources and prints only resource names plus the required Application Setting names. It does not create/rotate the SQL principal and does not change Static Web Apps settings.

After the preview has been reviewed, the explicit apply form is:

```powershell
.\tools\configure_paws_swa_beta.ps1 `
  -Apply `
  -FirebaseServiceAccountPath "C:\private\tester-teaching-service-account.json"
```

The service-account file stays on the operator's local machine. The script verifies that its `project_id` matches `tester-teaching`, prompts locally for the approved PAWS bootstrap account identity, generates the SQL password in memory by default, creates or rotates `paws_swa_beta`, applies `database/azure-sql/004_swa_beta_permissions.sql`, and sets these server-side names:

- `PAWS_SQL_CONNECTION_STRING`
- `PAWS_SQL_READS=on`
- `PAWS_SQL_AUTH=on`
- `PAWS_ACCOUNT_BOOTSTRAP_JSON`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

The script reports setting **names only** after configuration. It does not print the SQL password, connection string, bootstrap JSON, or Firebase Admin JSON. If an operator intentionally wants to supply the database password rather than use the generated one, add `-PromptForSqlPassword` and enter it only at the local secure prompt.

Operator order for the beta release:

1. Run `configure_paws_swa_beta.ps1 -Preview`.
2. Review the pinned resource names and the six required server-side setting names.
3. Only with explicit approval, run the script with `-Apply` and a local Firebase service-account file path.
4. Confirm the script reports the required setting names without values.
5. Merge only a reviewed, green implementation to `main`; the `main` build creates one exact frontend + Managed Functions artifact.
6. Manually dispatch **Azure Production Deploy** with the successful source run ID and exact main commit SHA.
7. Require the post-deploy `/api/health/sql` gate to pass.
8. Run authenticated browser smoke for `/api/v1/me`, `/api/v1/sessions`, timetable SQL reads, and the SQL-mode read-only session guard.

`tools/bootstrap_paws_azure_runtime.ps1` is **not required for this beta path**. It remains the future App Service + Managed Identity bootstrap and should not be used merely to make the current Free Static Web Apps beta work.

### Paused Azure production setup

The Azure material below is retained for a possible future production restart. It is **not required** for the active GitHub Pages Frontend Demo path. If Azure production is reactivated, the manual deployment must use the verified **source run ID** and the exact **commit SHA** from the approved `main` artifact; a `main` push does not automatically deploy production.

### One-time gated Azure production setup (paused)

Production has two gates. The repository-enforced gate is the manual **Azure Production Deploy** workflow; the GitHub `production` Environment remains defense in depth and the home for the Azure secret. A `main` push can build a candidate artifact but does not automatically deploy it.

1. Create a GitHub Environment named `production` under **Settings > Environments**.
2. Add a **Required reviewer** when available. If configured, GitHub will still show **Review deployments** / **Approve and deploy** after the manual workflow is dispatched.
3. Restrict deployment branches/tags so only `main` may deploy to this environment.
4. Keep **Prevent self-review** disabled when the repository owner must be able to approve a deployment they initiated.
5. Add `AZURE_STATIC_WEB_APPS_API_TOKEN` as a **production environment secret** containing the deployment token for the existing Azure Static Web App `ucvm-teaching-lab-web`.
6. Under **Settings > Secrets and variables > Actions > Variables**, add `PRODUCTION_DOE_API_BASE_URL`: the approved HTTPS Azure App Service base URL for the DOE API. The production Firebase Web SDK config is pinned in `tools/production-firebase-web-config.json`; it is public client metadata. The same approved DOE API URL is consumed by both GitHub Pages compatibility builds and the later Azure production build.
7. Confirm the DOE App Service `GET /api/health` endpoint is healthy and its `ALLOWED_ORIGINS` includes both `https://alex1122341.github.io` and `https://red-cliff-04871ca0f.5.azurestaticapps.net`. The Pages workflow verifies the first origin before publishing a test artifact; the production build verifies the second origin and fails closed if health or CORS is wrong.
8. After the environment secret is confirmed working, remove the old repository-level copy of `AZURE_STATIC_WEB_APPS_API_TOKEN` so the Azure token is available only to the production job.

Never commit the deployment token, an ARM token, or an Azure access token to the repository. The manual workflow is mandatory even if Environment reviewer protection is accidentally absent.

### DOE API App Service production setup (paused)

The DOE API is deployed separately from the static frontend.

1. Create a Node.js 22 Azure App Service for the DOE API.
2. In GitHub Actions repository variables set:
   - `DOE_API_APP_NAME` to the Azure App Service name.
   - `PRODUCTION_DOE_API_BASE_URL` to the App Service HTTPS base URL.
3. In the GitHub `production` Environment add `AZURE_DOE_API_PUBLISH_PROFILE` containing the publish profile for that App Service.
4. Configure the App Service settings:
   - `FIREBASE_PROJECT_ID=tester-teaching`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` as a Key Vault reference or otherwise approved server credential
   - `DOE_REPOSITORY=firestore`
   - `ALLOWED_ORIGINS=https://alex1122341.github.io,https://red-cliff-04871ca0f.5.azurestaticapps.net`
5. Run **Actions > Azure DOE API Production Deploy > Run workflow** with the exact current `main` SHA.
6. The workflow re-tests the server, stages a self-contained App Service zip, deploys it, and requires health/CORS checks to pass for both the Azure production frontend and the GitHub Pages test frontend before it reports success.

The DOE API workflow cannot create the Azure subscription resource or invent server credentials. Those remain one-time Azure administration tasks.

### Routine pull-request and test flow

1. Create a feature branch and open a same-repository pull request targeting `main`.
2. The independent **Test** workflow runs static/unit tests, the Firestore/Auth emulator suite, the lightweight deployment build, and browser smoke checks.
3. The **GitHub Pages Test Site** workflow independently repeats the verified tests, builds `.deploy-static`, and then stages **Frontend Demo Mode** into that generated artifact.
4. Pages staging injects the deterministic synthetic dataset plus the browser-local Firebase compatibility runtime. It does not require a Firebase Web config, Firebase Authentication account, service-account secret, Cloud Firestore connection, or DOE API.
5. Open `https://alex1122341.github.io/Teaching-assignment/` and confirm the banner shows **Frontend Demo** and **DOE backend off**. Use the role selector to test administrative, Faculty, HICC, VISC, ADC, and LAB views.
6. Demo edits stay in the current browser's local storage. Use **Reset demo data** to restore the canonical synthetic dataset.
7. Additional commits to the same or another same-repository PR update the single fixed Pages test site after verification passes. The latest successful PR version is the version visible at the fixed URL.
8. Only after the frontend behavior is accepted should the pull request be merged to `main`.
9. Firebase lab, DOE Admin, and Azure production workflows remain separate manual backend paths and are not prerequisites for frontend testing.

The GitHub Pages URL is publicly reachable and is not a security boundary. The staged demo contains synthetic data only and performs no cloud writes.

### Firestore rule changes

GitHub Actions does not deploy Firestore rules in this workflow. When a pull request changes `firestore.rules`, deploy the rules manually after review:

```bash
npx firebase deploy --project vista-teaching-lab --only firestore:rules
```

Deploy indexes separately when a reviewed change actually modifies `firestore.indexes.json`.

### Emergency/manual fallback

`tools/deploy_azure_static_web.ps1` remains an emergency/manual fallback. It uses the same `tools/build-static.js` allowlist and the committed root `staticwebapp.config.json` as GitHub Actions.

On Windows, if the downloaded script is blocked, unblock it without weakening the machine execution policy:

```powershell
powershell -NoProfile -Command "Unblock-File -LiteralPath '.\tools\deploy_azure_static_web.ps1'"
powershell -File .\tools\deploy_azure_static_web.ps1
```

During the current Firebase-only development phase, routine testing uses GitHub Pages and `vista-teaching-lab`. The Azure fallback remains dormant unless production deployment is explicitly reactivated.

## Faculty replacement requests

For **Request replacement for me**, the faculty-facing picker is sourced from the complete active Faculty Database through a sanitized derived directory rather than from dashboard login accounts. The browser receives a display name, opaque candidate key, aliases needed for timetable matching, and binary away-from-campus availability dates. It does not receive another faculty member's UCID, email, DOE, AFC purpose/reason, or other Faculty Database fields.

The picker shows **Available** when clear. An AFC conflict shows only **Unavailable**. A timetable overlap may show the conflicting course and time because the timetable is already visible to authorized timetable users. `Sessional` and `Other` are also available; either choice requires a non-blank Reason / Note.

Normal faculty requests store only the opaque candidate key and display name. During approval, ADFA resolves that key using the admin-only mapping, reloads the live faculty and timetable data, rechecks AFC and timetable conflicts, and then applies the replacement. Approved `Sessional` / `Other` requests write that literal category/name with no Faculty UCID.

The sanitized directory is rebuilt whenever the full Faculty Dashboard derived indexes are rebuilt, and approved AFC dates are added to its binary availability projection in the same approval batch.

## Teaching-summary bulk import and recovery

The **Faculty Dashboard > Teaching Summary** synchronization card is restricted to Owner / ADFA General. Selecting a source JSON performs a read-only preflight first. The preflight validates the source, fingerprints the exact raw bytes, compares source/current faculty and session sets, and shows creates, updates, stale sessions, warnings, and blocking errors before any teaching data is changed.

Before an import can start, the dashboard generates a pre-import recovery backup. The administrator operating the import is responsible for saving that downloaded backup somewhere durable and retrievable; the browser does not upload or centrally archive the recovery file. Keep the backup together with the exact source JSON used for the import until the import has completed and the resulting timetable has been accepted.

If an import fails after the maintenance lock is acquired, the teaching-data lock intentionally remains active. Normal session, faculty-data, change-request, and derived-index writes stay blocked while viewing remains available. There is no force-unlock path. Recovery must finish through one of the supported terminal paths:

- **Resume Import** requires selecting the exact original source file. Its raw-byte fingerprint must match the interrupted job before any resume work continues.
- **Restore Recovery Backup** requires the matching backup generated for that interrupted import. Restore is checkpointed and resumes if interrupted.
- **Take Over Recovery** is available only to another Owner / ADFA General. A non-blank reason is required, and takeover changes the recovery owner without changing the active import ID or bypassing its current phase.

Stale session deletion is not reached until the imported source has been verified. Completion is not reached until final session IDs match, derived indexes are rebuilt, and the provisional index verification passes. Only a terminal `COMPLETED` or `RESTORED` transition releases the lock, in the same Firestore batch as the terminal job update.

Destructive failure-injection, interrupted-import, restore, takeover, and lock-enforcement testing must be run only against the Firebase emulator or another isolated disposable environment. GitHub Pages points at isolated `vista-teaching-lab`, but destructive failure-injection testing should still use the Emulator Suite so the shared lab remains reproducible.

This feature depends on the reviewed maintenance rules in `firestore.rules`. Frontend banners and disabled controls are usability guards; Firestore Security Rules are the actual backend enforcement boundary. Deploy the reviewed rules before relying on production maintenance enforcement:

```bash
npx firebase deploy --project tester-teaching --only firestore:rules
```

Do not describe the maintenance lock as production-enforced until that rules deployment has been confirmed.

## Passwords

The account creation form accepts a temporary password only while creating the Authentication login. It clears that value after the operation and never stores it in the dashboard database. `Send password reset` uses Firebase Authentication's standard reset-email flow. A signed-in user can change their own password on `password.html`.

If you manually create a user with a temporary password and want the dashboard to prompt for a change, check `Require password change on next dashboard sign-in` on that user's profile.

## History

The Timetable and Faculty Dashboard create `session_change_log` / `faculty_change_log` records as part of their normal save workflow. `faculty-access.js` captures the form's starting values and, after a successful save closes the editor, enriches the newest matching actor log with before/after details. The History tab merges these logs where appropriate and shows Calgary time, actor, action and before/after values when available. The base log still exists even if the enrichment step is interrupted.

Older log records remain visible but may show `Legacy entry; detailed before/after values were not recorded.` because earlier versions did not store those fields.

## Timetable editing and AFC requests

Use **Faculty Dashboard > Teaching Summary** for the highest-permission workbook replacement and synchronization tools. Timetable administrators can choose **Select Sessions**, select up to 200 writable sessions across Day, Week, Month, or List views, and review them in one spreadsheet-style editor. Saving validates every row before creating one atomic batch containing one session update and one `session_change_log` record per changed session. CCC entries remain read-only.

New AFC requests require both the off-campus contact address and telephone number from the official form. Applicant, Reports To, and administrator signatures, approval state, immutable PDF chunks, and audit records remain in Firestore. Existing approved legacy requests without these newer contact fields stay readable and approvable.

## Development checks

Install the root development dependencies with `npm ci`. Run static tests with `npm test`; run the Firestore rule suite with `npm run test:emulator`. The `test-support/` modules are pure policy fixtures used by those tests and are excluded from the web deployment bundle.

Build the deployable static directory with `node tools/build-static.js`. The application bundle comes from the exact allowlist in `tools/static-assets.json`; host-specific metadata is staged afterward. Current query counts, migration hashes, rollback exports, and the 50,000-read estimate are recorded in `PERFORMANCE_REPORT.md`.
