# UCVM Teaching Project and Database Performance Cleanup

**Date:** 2026-09-13  
**Status:** Approved in chat; implementation pending written-spec review

## Objective

Reduce Firestore reads, initial network transfer, repository clutter, and deployment exposure while preserving the current UI, permissions, records, workflows, and visible results.

## Verified baseline

- The live Firestore export contains 2,012 top-level documents in 12 collections.
- The `faculty` collection contains 116 documents and about 3.2 MB in Firestore REST JSON form.
- The `sessions` collection contains 1,861 documents and about 4.4 MB in Firestore REST JSON form.
- Faculty Admin currently opens listeners for all faculty and all sessions, producing about 1,978 initial reads including the signed-in profile.
- The session audit found no exact duplicate sessions, missing required session fields, broken user/faculty references, broken group/user references, or request/session references.
- Firebase Hosting currently publishes 189 files because its repository-root public directory includes `.git` files despite the existing ignore pattern. The intended web application has about 20 deployable files.
- The public Git repository history contains deleted faculty-summary and historical schedule data files.

## User-visible behavior

The following must remain visually and functionally equivalent:

- Timetable Day, Week, Month, and List views
- Course and date filters
- Faculty-default own-teaching Day view
- Session detail and bulk session entry
- Swap requests, pending Swap calendar highlight, and approval queue
- Faculty Lookup, Teaching Summary, Roles & Appointments, DOE List, Faculty Database, and Change History
- DOE override emphasis
- AFC request, signatures, approval, records, PDF, CCC display, and availability lookup
- CSV, JSON, Outlook invitation, and calendar exports
- User Management, HICC groups, password change, idle timeout, and refresh protection

The only permitted visible differences are short loading states when a heavy detail set is opened for the first time and clearer progress during intentionally large exports or availability checks.

## Read optimization

### Faculty index

Create an administrator-readable `settings/faculty_index` document containing the lightweight fields needed to render and search the directory list:

- faculty ID / UCID
- display and HR names
- rank, appointment, campus, department, specialty
- status and active state
- Reports To routing display
- contract and assigned DOE summary, including override presence
- timetable assignment count
- a normalized search string covering the current Lookup search surface

Faculty Admin and User Management will load this one document instead of reading all 116 full faculty documents. Opening a faculty record will fetch that full document by ID. Import and edit operations will rebuild or patch the index in the same logical operation.

### Faculty-specific session queries

Add a normalized `facultyIds` array to every session. All session creation, edit, swap, bulk import, and summary synchronization paths must keep it synchronized with `assignments[].ucid`.

Faculty Admin will query sessions with `array-contains` for the selected faculty instead of subscribing to all 1,861 sessions. Counts needed before selection will come from the faculty index and schedule statistics.

### Approval requests

The approval workflow will use sessions already loaded in the visible date range and fetch only the document IDs referenced by pending requests. It will not call the all-session loader merely to render approval impact.

### Intentional full reads

Export All, bulk replacement, and an availability lookup across the full academic year may still load all sessions. These reads happen only after an explicit user action, reuse an in-memory promise/cache, and show progress.

### Expected reads

- Faculty Admin initial data: approximately 3–5 reads before a person is selected.
- Selecting a person: one faculty document plus that person’s matching session count.
- User Management: approximately 7 reads with the current four users and one group.
- Approval Queue with two pending session requests: approximately two session reads instead of 1,861.

## Database cleanup

A fresh typed JSON backup outside the repository is required before mutation. The migration will support dry-run output, record counts, field counts, reference checks, and a post-migration export comparison.

### Documents removed

- Delete `settings/migrations_assigned_ad_removed` after the corresponding runtime migration code is removed.

### Session fields removed

Remove repeated import provenance after retaining it in the global synchronization settings and history logs:

- `sourceWorkbook`
- `sourceSchema`
- `sourceCourseTypes`
- `bulkImportedAt`
- `bulkImportedBy`
- a redundant `id` field when it equals the Firestore document ID

Retain `sourceSystem`, timestamps, actor fields, assignments, instructor display text, lab details, and all scheduling fields.

### Faculty fields removed

Remove flat DOE compatibility fields only when the canonical value exists in the `doe` map and is equal. A mismatch is reported and left unchanged. Candidate fields are:

- `doeTeaching`
- `doeResearch`
- `doeServiceAdmin`
- `doeFte`
- `doeClinicianDiagnostician`
- `doeClinicalTeaching`
- `doeClinicalTimeNoStudent`
- `doeClinicalActivityPPVM`
- `doeRotationClinical`
- `doeRotationIntenseFieldPathology`
- `doeOnboarding`
- `doeOtherDiagnostic`
- `doeScholarlyActivity`
- `doeServiceCommitments`
- `doeContractFteMatches`
- `doeTotalContractFTE`

Remove regenerable import metadata after confirming it has no UI, rule, export, or migration dependency:

- `specialtySearchText`
- `sourceKeyRow`
- `doeImportedAt`
- `doeImportedBy`
- `doeImportedByName`
- `doeSourceYear`
- `teachingDoeModelImportedAt`
- `teachingDoeModelImportedBy`
- `teachingDoeModelImportedByName`

All HR identity, education, appointment, specialty, department, office, certification, experience, Faculty Summary, Workload DOE, AFC, override, routing, and audit data remain.

### Records explicitly retained

Retain every faculty, session, user, group, public CCC schedule record, AFC request, AFC audit record, change request, account audit record, faculty change log, and session change log. Rejected and completed requests are historical records and are not cleanup candidates.

## Code and repository cleanup

- Replace repository-root Firebase Hosting with a generated allowlist deployment directory.
- Share the same deploy manifest between Firebase and Azure packaging.
- Remove completed Assigned AD migration runtime code and its one-off REST tool.
- Remove the unused Firebase Functions browser SDK from pages.
- Remove the undeployed Spark-incompatible Cloud Functions reference implementation, its duplicate PDF template, and tests that exist only for those unused callables. Preserve Firestore rule tests for the deployed application.
- Move required Firebase CLI and rule-test development dependencies to a clearly named development package location.
- Extract large inline page scripts and styles into named assets.
- Consolidate repeated role, faculty-name, DOE, date, escaping, and assignment helpers behind the existing shared application namespace.
- Lazy-load PDF/signature dependencies when AFC PDF or signature functionality is opened.
- Delete ignored local artifacts: emulator logs, generated PDF renders, and extracted temporary scripts.
- Remove completed implementation-plan documents from the active source tree after their relevant constraints are retained in current documentation and tests.

The root AFC PDF template remains because the deployed Spark application uses it to generate approved AFC PDFs in the browser.

## Hosting and Git history security

Firebase Hosting will publish only allowlisted application files. After deployment, `.git/HEAD`, Git objects, tests, tools, rules, indexes, logs, and documentation must return 404.

Before rewriting Git history, create a local Git bundle outside the repository and verify it. Remove the historical faculty-summary JSON and old embedded schedule-data files from every Git revision, then force-update the remote branch. Repository visibility should be changed to private because it contains an HR-oriented internal application. Deployment from a private repository remains possible.

Changing repository visibility and force-updating remote history are separate high-impact operations and require an action-time check immediately before execution.

## Migration order

1. Record baseline tests, reads, asset list, database counts, and hashes.
2. Fix Firebase Hosting packaging and deploy the exposure fix.
3. Refactor shared code and remove dead runtime dependencies without changing data.
4. Add the faculty index, schedule statistics, and `facultyIds` support.
5. Switch readers to the optimized paths and verify UI parity.
6. Run the database cleanup migration in dry-run mode.
7. Re-export Firestore and verify counts, references, retained fields, requests, and logs.
8. Apply the cleanup migration and write an audit event describing aggregate field removals.
9. Run all automated tests and browser checks on Firebase and Azure.
10. Create and verify the Git bundle, then handle private visibility and history cleanup.

## Failure handling and rollback

- Hosting changes are deployed before data changes and can be rolled back through Firebase Hosting release history.
- Database cleanup uses batched writes with bounded batch sizes and is idempotent.
- The pre-migration typed JSON export is the authoritative rollback source for removed fields.
- Index documents are derived and can be rebuilt without altering source records.
- Reader code retains a temporary fallback to the current collection queries for one release; the fallback is removed only after live verification.
- Git history cleanup begins only after the clean branch, remote state, and backup bundle hashes are verified.

## Verification

- Static tests assert deploy allowlisting, lazy loading, index usage, targeted session queries, and removal of dead SDK/code paths.
- Firestore emulator tests verify permissions for new settings documents and `facultyIds` updates.
- Migration tests cover equal DOE values, mismatches, missing values, idempotency, reference preservation, and audit generation.
- Browser checks compare navigation, Lookup search, selected Faculty details, DOE override display, all calendar views, Swap highlight, AFC flow, history visibility, exports, and role restrictions.
- Live HTTP checks verify both hosts serve the same release assets and reject forbidden paths.
- Final read estimates are calculated from the actual queries and verified with a controlled login/navigation pass.
