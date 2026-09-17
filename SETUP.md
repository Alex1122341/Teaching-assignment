# Faculty Dashboard - Spark Basic Mode

This branch runs the UCVM faculty role/group/history features on the Firebase Spark plan without deploying Cloud Functions. Firebase project: `tester-teaching`.

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
   npx firebase deploy --project tester-teaching --only firestore:rules,firestore:indexes
   ```
   If the local Firebase CLI dependency is unavailable later, any Firebase CLI installation can deploy these rules; Cloud Functions are not required.
6. Complete the one-time GitHub Pages, Firebase Authorized Domain, and gated Azure production setup in **Web deployment** below. Use a pull request to publish the frontend to the fixed GitHub Pages test site before any production approval.
7. Sign in once as Owner / ADFA General or another administrator and open **Faculty Dashboard**. If the privacy-safe faculty replacement directory does not exist yet, the dashboard creates `settings/faculty_swap_index` and the admin-only `settings/faculty_swap_map` from the current Faculty Database.
8. Open User Management.
9. To add one person, choose their faculty profile in **New account**. The profile supplies the name and email; choose the access role and enter a temporary password. Firebase supplies the Authentication UID after creation.
10. To prepare all faculty accounts, choose **Preview changes** under **Create missing faculty accounts**. Review the proposed creates, access updates, excluded records, and source-role cleanup before entering the temporary password and selecting **Apply reviewed changes**.
11. Keep **Require password change on next dashboard sign-in** selected for new accounts. The temporary password is sent only to Firebase Authentication and is not stored in Firestore, source code, or audit logs.
12. Create HICC groups, assign an HICC owner, course numbers and members.
13. Test with one Administrator, one HICC and one Faculty account before broader rollout.

## Web deployment

The routine release path uses two different frontend hosts for two different purposes:

- **GitHub Pages test site:** `https://alex1122341.github.io/Teaching-assignment/`
- **Azure production site:** `https://red-cliff-04871ca0f.5.azurestaticapps.net`

Both frontends use the same live Firebase backend, project `tester-teaching`, for Authentication and Firestore. The GitHub Pages test site is therefore **Not Production**, but it is connected to the **Live Firebase Backend**. Test data-changing actions deliberately. Firebase Hosting is not used for routine web releases.

### One-time GitHub Pages and Firebase setup

1. In GitHub repository **Settings > Pages**, set the Pages source to **GitHub Actions**.
2. Keep the standard `github-pages` Environment available to pull-request deployments. Do not restrict that environment to `main`, because the fixed test site is updated from same-repository pull requests.
3. In Firebase Console, open **Authentication > Settings > Authorized domains** and add `alex1122341.github.io`. This is required so Firebase Authentication can sign users in from the GitHub Pages host.
4. The fixed Pages URL always shows the latest successful same-repository pull request deployed by `.github/workflows/github-pages-test.yml`. A newer successful PR replaces the previous test version.
5. The Pages build injects a visible **TEST SITE - GitHub Pages / Not Production - Live Firebase Backend** banner with the PR number and commit identifier. That banner exists only in the Pages artifact and never in the Azure production artifact.

Forked pull requests do not deploy the test site. The Pages workflow uses the normal `pull_request` event and verifies that the PR head repository is the same repository before deployment.

### One-time gated Azure production setup

Create a GitHub Environment named `production` under **Settings > Environments** and configure it as the production release gate:

1. Add a **Required reviewer** who can approve production releases.
2. Restrict deployment branches/tags so only `main` may deploy to this environment.
3. Keep **Prevent self-review** disabled. This allows the repository owner to approve a deployment they initiated when appropriate.
4. Add `AZURE_STATIC_WEB_APPS_API_TOKEN` as a **production environment secret** containing the deployment token for the existing Azure Static Web App `ucvm-teaching-lab-web`.
5. After the environment secret is confirmed working, remove the old repository-level copy of `AZURE_STATIC_WEB_APPS_API_TOKEN` so the Azure token is available only to the approval-gated production job.

Never commit the deployment token, an ARM token, or an Azure access token to the repository.

### Routine pull-request and release flow

1. Create a feature branch and open a same-repository pull request targeting `main`.
2. The independent **Test** workflow runs static/unit tests and the Firestore/Auth emulator suite.
3. The **GitHub Pages Test Site** workflow independently runs `npm ci`, `npm test`, `npm run test:emulator`, builds `.deploy-static`, applies Pages-only staging, and publishes the verified artifact to the fixed GitHub Pages test URL.
4. Open `https://alex1122341.github.io/Teaching-assignment/` and manually validate sign-in, Timetable, Faculty Dashboard, and the changed workflow. Confirm the TEST SITE / Not Production banner is present. Because this site uses the live `tester-teaching` backend, avoid unnecessary edits to real data.
5. Additional commits to the same or another same-repository PR update the single fixed Pages test site after their verification passes. The latest successful PR version is the version visible at the fixed URL.
6. Only after the browser test is accepted, merge the pull request to `main`.
7. The `main` push starts the **Azure Static Web Apps** workflow. Its `validate_and_build` job runs the full test suite again, builds `.deploy-static`, adds the canonical `staticwebapp.config.json`, and uploads an immutable `azure-production-${{ github.sha }}` Actions artifact.
8. The production deployment then waits at the GitHub `production` Environment gate. In GitHub Actions choose **Review deployments**, select **production**, then choose **Approve and deploy**.
9. After approval, the deployment job downloads the exact artifact built before approval and sends those bytes to Azure Static Web Apps. It does not run the build again after approval.
10. If a newer `main` version arrives while an older production release is still waiting for approval, the `azure-production-main` concurrency group cancels the older run so only the newest candidate remains.

Azure is production-only in this flow; pull requests do not create Azure preview environments. GitHub Pages is the fixed browser-test host.

The GitHub Pages URL is publicly reachable and is not a security boundary. Firebase Authentication and Firestore Security Rules continue to protect application data.

### Firestore rule changes

GitHub Actions does not deploy Firestore rules in this workflow. When a pull request changes `firestore.rules`, deploy the rules manually after review:

```bash
npx firebase deploy --project tester-teaching --only firestore:rules
```

Deploy indexes separately when a reviewed change actually modifies `firestore.indexes.json`.

### Emergency/manual fallback

`tools/deploy_azure_static_web.ps1` remains an emergency/manual fallback. It uses the same `tools/build-static.js` allowlist and the committed root `staticwebapp.config.json` as GitHub Actions.

On Windows, if the downloaded script is blocked, unblock it without weakening the machine execution policy:

```powershell
powershell -NoProfile -Command "Unblock-File -LiteralPath '.\tools\deploy_azure_static_web.ps1'"
powershell -File .\tools\deploy_azure_static_web.ps1
```

Routine releases should use the GitHub Pages test site, merge to `main`, GitHub production approval, and Azure deployment instead of this local fallback.

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

Destructive failure-injection, interrupted-import, restore, takeover, and lock-enforcement testing must be run only against the Firebase emulator or another isolated disposable environment. The fixed GitHub Pages test site uses the live `tester-teaching` backend; on Pages, use only the non-destructive preflight/smoke-test steps unless a real synchronization is intentionally being performed.

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

Build the Azure publishing directory with `node tools/build-static.js`. The application bundle comes from the exact allowlist in `tools/static-assets.json`; Azure deployment metadata is staged afterward. Current query counts, migration hashes, rollback exports, and the 50,000-read estimate are recorded in `PERFORMANCE_REPORT.md`.
