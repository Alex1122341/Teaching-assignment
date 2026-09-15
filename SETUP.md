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
6. Complete the one-time GitHub/Azure setup in **Web deployment** below, then use a pull request to publish and validate the frontend through Azure Static Web Apps.
7. Sign in once as Owner / ADFA General or another administrator and open **Faculty Dashboard**. If the privacy-safe faculty replacement directory does not exist yet, the dashboard creates `settings/faculty_swap_index` and the admin-only `settings/faculty_swap_map` from the current Faculty Database.
8. Open User Management.
9. To add one person, choose their faculty profile in **New account**. The profile supplies the name and email; choose the access role and enter a temporary password. Firebase supplies the Authentication UID after creation.
10. To prepare all faculty accounts, choose **Preview changes** under **Create missing faculty accounts**. Review the proposed creates, access updates, excluded records, and source-role cleanup before entering the temporary password and selecting **Apply reviewed changes**.
11. Keep **Require password change on next dashboard sign-in** selected for new accounts. The temporary password is sent only to Firebase Authentication and is not stored in Firestore, source code, or audit logs.
12. Create HICC groups, assign an HICC owner, course numbers and members.
13. Test with one Administrator, one HICC and one Faculty account before broader rollout.

## Web deployment

Azure Static Web Apps is the routine web host. Firebase remains the Authentication, Firestore, and Firestore Security Rules backend; Firebase Hosting is not used for normal preview or production releases.

### One-time GitHub setup

Create the GitHub Actions repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN` with the deployment token for the existing Azure Static Web App `ucvm-teaching-lab-web`. Never commit the deployment token, an ARM token, or an Azure access token to the repository.

The dedicated `.github/workflows/azure-static-web-apps.yml` workflow uses the repository secret only for same-repository pull requests and pushes to `main`. Forked pull requests do not receive the deployment secret and do not create Azure previews.

### Routine pull-request flow

1. Create a feature branch and open a same-repository pull request targeting `main`.
2. The existing **Test** workflow runs static/unit tests and the Firestore/Auth emulator suite.
3. The **Azure Static Web Apps** workflow independently runs the same verification, builds `.deploy-static` with `node tools/build-static.js`, stages `staticwebapp.config.json`, and deploys a temporary Azure PR preview environment.
4. Open the Azure Preview URL from the deployment result and validate the timetable, Faculty Dashboard, sign-in, and any changed workflow. Preview and production currently use the same Firebase project, `tester-teaching`, so test any data-changing actions deliberately.
5. Additional commits to the same pull request update the same PR preview environment.
6. Merge the validated pull request. The resulting push to `main` runs verification again and automatically deploys the existing Azure production Static Web App.
7. Closing or merging the pull request triggers cleanup of its temporary Azure preview environment.

The preview URL is externally reachable; it is not a security boundary. Firebase Authentication and Firestore Security Rules continue to protect application data.

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

Routine releases should use the GitHub pull-request preview and `main` production deployment instead of this local fallback.

## Faculty replacement requests

For **Request replacement for me**, the faculty-facing picker is sourced from the complete active Faculty Database through a sanitized derived directory rather than from dashboard login accounts. The browser receives a display name, opaque candidate key, aliases needed for timetable matching, and binary away-from-campus availability dates. It does not receive another faculty member's UCID, email, DOE, AFC purpose/reason, or other Faculty Database fields.

The picker shows **Available** when clear. An AFC conflict shows only **Unavailable**. A timetable overlap may show the conflicting course and time because the timetable is already visible to authorized timetable users. `Sessional` and `Other` are also available; either choice requires a non-blank Reason / Note.

Normal faculty requests store only the opaque candidate key and display name. During approval, ADFA resolves that key using the admin-only mapping, reloads the live faculty and timetable data, rechecks AFC and timetable conflicts, and then applies the replacement. Approved `Sessional` / `Other` requests write that literal category/name with no Faculty UCID.

The sanitized directory is rebuilt whenever the full Faculty Dashboard derived indexes are rebuilt, and approved AFC dates are added to its binary availability projection in the same approval batch.

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
