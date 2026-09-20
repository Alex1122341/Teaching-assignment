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

The active development/test path is Firebase + GitHub Pages:

- **Fixed test frontend:** `https://alex1122341.github.io/Teaching-assignment/`
- **Test Authentication + Firestore:** `vista-teaching-lab`
- **DOE authoritative writes:** manually dispatched **Firebase DOE Admin Job**
- **Azure:** paused for the current development phase; retained only as production/fallback history

The GitHub Pages workflow never points at `tester-teaching` and never injects a DOE API URL. Normal timetable/faculty workflows use the isolated lab Firestore under its deployed Security Rules. DOE policy/configuration browser writes remain denied; impact preview persistence, policy publication and recalculation run through trusted GitHub Actions/admin code.

### One-time GitHub Pages and Firebase lab setup

1. In GitHub repository **Settings > Pages**, set the Pages source to **GitHub Actions**.
2. Keep the standard `github-pages` Environment available to same-repository pull-request deployments.
3. Before merge, enable Email/Password Authentication and add `alex1122341.github.io` under **Authentication > Settings > Authorized domains** manually if needed. After the setup workflow exists on `main`, **Firebase Lab Auth Setup > configure** can perform both changes using the lab Admin credential.
5. Before merge, create test-only Authentication users in `vista-teaching-lab` and matching Firestore `users/{uid}` profiles manually if needed. After the bootstrap workflow is available on `main`, **Firebase Lab Bootstrap** can create or synchronize both sides without accepting a password; use the Firebase password-reset flow to establish the initial password.
6. Run `firebase login` and `npm run config:pin:lab`, then commit the generated public `tools/lab-firebase-web-config.json` for `vista-teaching-lab`.
7. Before merge, seed/verify and deploy rules manually if needed. After merge, **Firebase Lab Data Setup > provision** can perform the canonical seed/verify plus reviewed Firestore rules/index deployment through the lab Admin credential.

The Pages workflow fails closed unless `tools/lab-firebase-web-config.json` contains a real Web SDK config for exactly `vista-teaching-lab`, emulator mode is disabled and the DOE API base URL is blank. The visible banner is **TEST SITE - GitHub Pages / Isolated Firebase Lab / vista-teaching-lab**.

The fixed Pages URL always shows the latest successful same-repository pull request deployment. Forked pull requests do not deploy the test site. Firebase Hosting is not used for the active browser test path; GitHub Pages remains the fixed test host.

### firebase-lab-admin service account permissions

Use a dedicated **test-only** service account for `vista-teaching-lab`; do not grant Owner or Editor simply to make CI convenient. The current lab automation needs these predefined roles:

- `roles/identitytoolkit.admin` — create/update test Auth users and read/update Authentication project configuration.
- `roles/datastore.user` — read/write synthetic Firestore documents through Admin SDK.
- `roles/firebaserules.admin` — deploy reviewed Firebase Security Rules.
- `roles/datastore.indexAdmin` — create/update/delete Firestore index definitions during `firebase deploy --only firestore`.

Store its JSON key only as the `FIREBASE_LAB_SERVICE_ACCOUNT_JSON` secret in the `firebase-lab-admin` GitHub Environment. Never commit the key or place it in a repository variable. Rotate/revoke the key if it is ever exposed.

### Firebase Lab Data Setup

After `FIREBASE_LAB_SERVICE_ACCOUNT_JSON` is configured, **Firebase Lab Data Setup** removes the remaining personal-CLI dependency for the test environment.

On `feature/doe-operational-readiness`, the workflow has a branch-locked automatic `provision` path that runs when the workflow itself changes. It creates or reuses the lab Firebase Web App, pins the public Web SDK config, seeds/verifies the canonical synthetic dataset, deploys reviewed Firestore rules/indexes, and commits only `tools/lab-firebase-web-config.json` back to the feature branch.

The manual modes remain available after merge:
- `verify-data` checks that every canonical synthetic seed document exists.
- `seed-data` requires `SEED:vista-teaching-lab`.
- `deploy-firestore` requires `DEPLOY-FIRESTORE:vista-teaching-lab`.
- `provision` requires `PROVISION:vista-teaching-lab` and performs the full data + Firestore setup.

The workflow never accepts another Firebase project id. GitHub Pages fails fast while the pinned Web config is still a placeholder.

### Firebase Lab Auth Setup

After the `firebase-lab-admin` Environment credential exists, the manual **Firebase Lab Auth Setup** workflow can verify or configure the Authentication boundary without using the Firebase Console:

- `check` reads the Identity Toolkit project configuration and fails with a readiness summary when Email/Password or the Pages domain is missing.
- `configure` requires exact confirmation `CONFIGURE-AUTH:vista-teaching-lab`, enables email/password sign-in, preserves existing authorized domains, and adds `alex1122341.github.io`.

The service account needs permission to read Auth project config for `check` and update it for `configure`. The workflow is lab-locked and never accepts a production project id.

### Firebase Lab Bootstrap

`.github/workflows/firebase-lab-bootstrap.yml` is a manual, lab-only account bootstrap path for future test accounts. It uses the same `firebase-lab-admin` Environment credential, accepts no password input, requires an `@ucalgary.ca` email and exact `BOOTSTRAP:<email>:<role>` confirmation, creates or reuses the Firebase Authentication user, and synchronizes the matching `users/{uid}` Firestore profile.

Because GitHub only exposes a new manual workflow after that workflow exists on the default branch, this Action is primarily for post-merge lab maintenance. Before merge, the same contract is available locally through `npm run lab:bootstrap-user -- --email ...` when a valid `FIREBASE_LAB_SERVICE_ACCOUNT_JSON` is supplied. Do not pass passwords through GitHub Actions inputs.

### One-time DOE admin job setup

1. Create a GitHub Environment named `firebase-lab-admin`.
2. Add Environment secret `FIREBASE_LAB_SERVICE_ACCOUNT_JSON` containing a **test-only** service account JSON for `vista-teaching-lab`. Never commit this JSON.
3. Open **Actions > Firebase DOE Admin Job > Run workflow**.
4. Use `validate-policy` or `impact-preview` for non-destructive checks.
5. `publish-policy` requires exact confirmation `PUBLISH:<policyVersionId>`.
6. `recalculate` requires exact confirmation `RECALCULATE:<policyVersionId>:<academicYear>`.
7. To process DOE generated by Firebase-only timetable/session saves, choose `recalculate-queue` and enter exact confirmation `PROCESS-QUEUE`. The job re-reads the current session before calculating and leaves failed requests pending for retry.
8. The CLI independently refuses any Firebase project other than `vista-teaching-lab`.

This design keeps a strong DOE server-authoritative boundary without running Cloud Functions or an Azure App Service. The existing DOE server modules remain reusable service code, but the test environment invokes them as a short-lived administrative job rather than exposing them as a browser API.

### Paused Azure production setup

The Azure material below is retained for a possible future production restart. It is **not required** for the active Firebase/GitHub Pages development path.

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
2. The independent **Test** workflow runs static/unit tests and the Firestore/Auth emulator suite.
3. The **GitHub Pages Test Site** workflow independently runs `npm ci`, `npm run test:all`, `npm run test:emulator`, generates the `vista-teaching-lab` client config from the pinned `tools/lab-firebase-web-config.json`, builds `.deploy-static`, applies Pages-only staging, and publishes the verified artifact to the fixed GitHub Pages test URL.
4. Open `https://alex1122341.github.io/Teaching-assignment/` and validate sign-in, Timetable, Faculty Dashboard, and the changed workflow. Confirm the **TEST SITE / Isolated Firebase Lab / vista-teaching-lab** banner is present.
5. The Pages runtime never receives a DOE API URL. Authorized timetable/session saves write the source Firestore facts and, when faculty assignments are present, create a non-authoritative pending DOE recalculation request while stripping old DOE provenance from the edited assignment. Use **Actions > Firebase DOE Admin Job > recalculate-queue** with `PROCESS-QUEUE` to calculate authoritative DOE afterward. Policy validation, impact preview persistence, publication, and full recalculation also remain in the Admin Job. Destructive failure-injection still belongs in the Emulator Suite.
6. Additional commits to the same or another same-repository PR update the single fixed Pages test site after verification passes. The latest successful PR version is the version visible at the fixed URL.
7. Only after the browser test is accepted should the pull request be merged to `main`.
8. Azure production remains paused. If it is reactivated later, use the gated **Azure Production Deploy** process documented in the paused section above, including its source run ID and exact commit SHA checks. A `main` push does not automatically deploy Azure production.

The GitHub Pages URL is publicly reachable and is not a security boundary. Firebase Authentication and Firestore Security Rules protect application data. Firebase Hosting is not used for this active test flow.

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
