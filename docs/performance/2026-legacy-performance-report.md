# Project and Firestore performance report

Measured September 13, 2026 against Firebase project `tester-teaching`.

## Result

The September 15 runtime pass removed the remaining routine full-collection reads from timetable editing, role/database tabs, audit enrichment, and replacement-candidate startup. The deployed allowlist remains 33 files. Excluding the 1,042,973-byte AFC PDF template, runtime text assets fell from 514,566 to 499,743 bytes (14,823 bytes / 2.88%) and from 3,859 to 3,770 physical lines (89 lines / 2.31%) while retaining the same workflows.

The default Faculty Admin screen now reads two derived settings documents, one selected faculty document, and only that faculty member's sessions. The previous screen subscribed to all 116 faculty documents and all 1,861 session documents.

| Operation | Previous initial reads | Current estimated reads | Notes |
| --- | ---: | ---: | --- |
| Faculty Admin opened directly | about 1,978 | 7 for the current first faculty | Includes the user profile/watch, two settings documents, one faculty detail and two assigned sessions. |
| First administrator login and automatic landing | about 2,000+ | 8 | The timetable readers now abort before the redirect; one shared profile read occurs before the 7-read Faculty Admin load. |
| Select another faculty member | up to the whole 1,861-session collection | 1 + that person's session count | Current median is 24 reads total; mean is about 36; 90th percentile is 86. |
| User Management | 122+ | about 8 | Four user documents, one group, one faculty index, and profile verification/watch. |
| Approval queue hydration for the current three timetable requests | about 1,861 sessions | about 42 additional reads | Two referenced sessions, one faculty index, 12 involved faculty details, and 27 sessions on the two affected dates. |
| Faculty day view | all sessions in the visible day | only that faculty member's sessions in the day | Uses the deployed `facultyIds + date` composite index. |
| Open Roles or Faculty Database | about 1,977 | about 116 | These tabs load faculty records without also loading 1,861 sessions. Teaching Summary still loads both because it calculates cross-faculty teaching totals. |
| Save a session after its date is visible | about 1,998+ after the write | 2 | The old path rebuilt indexes from 116 faculty + 1,861 sessions and scanned up to 20 logs plus an actor profile. The new transaction reads only `faculty_index` and `schedule_stats`; audit details are included in the original write. |
| Open an admin session editor for the first time | about 1,977 | 117 + sessions on that date | The faculty directory and one index document support assignment/DOE choices; timetable conflict checking reads only the edited date. Later edits reuse both caches. |
| Initial Change History load | up to 150 | up to 60 | Three independent log collections now page 20 records each. “Load older changes” keeps the same pagination behavior. |
| Faculty/HICC/VISC login replacement directory | every eligible account | 0 until Swap is opened | Candidate accounts are fetched once on demand and cached for the login session. |
| Date or academic-period export | about 1,861 | sessions in the requested range | “All dates” and the complete Outlook invitation package intentionally remain full exports. |

Firestore listener reconnects, edits, newly created records, and cached/offline behavior can change billing. Empty queries can also incur a minimum read. The table is therefore a conservative planning estimate from the current document counts and query paths, not a billing guarantee.

At 8 reads for a clean administrator login, 50,000 reads represents roughly 6,250 clean logins in one day. A representative dashboard day with one login, ten median faculty selections, one User Management visit, one 60-record history page, and one current-size approval review is about 421 reads; 50,000 reads covers about 118 such administrator-days. A timetable-editing day is now driven mainly by the number of distinct edited dates: after the first 117 faculty/index reads, each new date reads only its sessions and each successful save reads two settings documents. Firebase's Spark quota resets daily; reconnects, live changes, empty-query minimums, and explicit full exports can change actual billing. An explicit full faculty/session export or bulk synchronization still costs roughly 1,977 source-document reads by design.

## Data cleanup

The audited migration retained every business, workflow, and history record. It performed these changes:

- Backfilled `facultyIds` on 1,861 sessions.
- Removed 5,580 repeated session provenance fields.
- Removed 1,018 regenerable faculty import-metadata fields.
- Removed 729 flat DOE compatibility fields only where they exactly matched the canonical `doe` map; no mismatch was deleted.
- Removed the completed `settings/migrations_assigned_ad_removed` marker.
- Created `settings/faculty_index` and `settings/schedule_stats`.
- Added one aggregate `account_audit` record.

Decoded faculty payload fell from 1,814,009 to 1,744,116 bytes (3.85%). Decoded session payload fell from 2,451,067 to 2,244,955 bytes (8.41%). The new derived settings index adds about 208 KB, so the main gain is lower query counts and smaller routine transfers rather than a large reduction in total stored bytes.

The rollback exports are outside the repository:

- Before: `tester-teaching-before-optimization-20260913.json` (stored outside the repository)
  - SHA-256: `ae1c2cd905cc72d2097cb005578f29aea9dd7255e6259449e39a2d5e586af2f0`
- After: `tester-teaching-after-optimization-20260913.json` (stored outside the repository)
  - SHA-256: `085074d4bac5e08281c469839ad5c92c06053789c8e871d5d1e240abc777fd14`

## Code and delivery cleanup

- Firebase and Azure publish the same 28-file allowlist instead of the repository root.
- Removed the undeployed Cloud Functions implementation, duplicate function dependencies/PDF, completed Assigned AD migration script, and browser Functions SDK.
- Moved test-only policy modules to `test-support/` and consolidated development dependencies at the repository root.
- Split the timetable and Faculty Admin pages into cacheable HTML, CSS, and JavaScript assets. The timetable HTML shell is 91.92% smaller and the Faculty Admin HTML shell is 89.82% smaller.
- PDF-lib, the AFC PDF renderer, and the one-megabyte PDF template load only when an AFC approval actually creates a PDF.
- Moved Sessional / Other workbook assignments into their own lazy-loaded tab.
- Consolidated faculty self-service into Timetable and renamed the administrative faculty page to Faculty Dashboard; the retired page redirects to Timetable on both hosts.
- Added cross-view selection for up to 200 sessions. Review and validation use cached visible rows plus exact-date conflict queries; entering selection mode reads the faculty directory once for assignment choices. A successful batch edit applies exact before/after deltas in a two-document index transaction.
- Session create, edit, delete, swap, and multi-session changes write concrete audit details in the original atomic batch. The browser no longer scans and patches recent logs after a save.
- Roles, Faculty Database, faculty directory import/export, AFC import, and workload import use a faculty-only loader. Teaching Summary and source replacement retain complete session reads where their calculations require them.
- AFC request contact address and phone fields are required for new submissions. PDF code and the PDF template remain lazy-loaded only during final approval.

Full-data reads remain behind explicit actions: complete faculty JSON/CSV export, Teaching Summary, bulk replacement/synchronization, all-date schedule/Outlook export, and an academic-year availability lookup.
