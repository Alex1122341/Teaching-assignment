# Project and Firestore performance report

Measured September 13, 2026 against Firebase project `tester-teaching`.

## Result

The default Faculty Admin screen now reads two derived settings documents, one selected faculty document, and only that faculty member's sessions. The previous screen subscribed to all 116 faculty documents and all 1,861 session documents.

| Operation | Previous initial reads | Current estimated reads | Notes |
| --- | ---: | ---: | --- |
| Faculty Admin opened directly | about 1,978 | 7 for the current first faculty | Includes the user profile/watch, two settings documents, one faculty detail and two assigned sessions. |
| First administrator login and automatic landing | about 2,000+ | 8 | The timetable readers now abort before the redirect; one shared profile read occurs before the 7-read Faculty Admin load. |
| Select another faculty member | up to the whole 1,861-session collection | 1 + that person's session count | Current median is 24 reads total; mean is about 36; 90th percentile is 86. |
| User Management | 122+ | about 8 | Four user documents, one group, one faculty index, and profile verification/watch. |
| Approval queue hydration for the current three timetable requests | about 1,861 sessions | about 42 additional reads | Two referenced sessions, one faculty index, 12 involved faculty details, and 27 sessions on the two affected dates. |
| Faculty day view | all sessions in the visible day | only that faculty member's sessions in the day | Uses the deployed `facultyIds + date` composite index. |

Firestore listener reconnects, edits, newly created records, and cached/offline behavior can change billing. Empty queries can also incur a minimum read. The table is therefore a conservative planning estimate from the current document counts and query paths, not a billing guarantee.

At 8 reads for a clean administrator login, 50,000 reads represents roughly 6,250 clean logins in one day. A representative day with one login, ten median faculty selections, one User Management visit, and one current-size approval review is about 361 reads; 50,000 reads covers about 138 such administrator-days. Firebase's Spark read quota resets daily, so this workload has substantial headroom. An explicit full export or bulk synchronization still reads the full faculty/session data by design and costs roughly 1,977 source-document reads.

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

- Firebase and Azure publish the same 27-file allowlist instead of the repository root.
- Removed the undeployed Cloud Functions implementation, duplicate function dependencies/PDF, completed Assigned AD migration script, and browser Functions SDK.
- Moved test-only policy modules to `test-support/` and consolidated development dependencies at the repository root.
- Split the timetable and Faculty Admin pages into cacheable HTML, CSS, and JavaScript assets. The timetable HTML shell is 91.92% smaller and the Faculty Admin HTML shell is 89.82% smaller.
- PDF-lib, the AFC PDF renderer, and the one-megabyte PDF template load only when an AFC approval actually creates a PDF.
- Moved Sessional / Other workbook assignments into their own lazy-loaded tab.

Full-data reads remain behind explicit actions: full JSON/CSV export, bulk replacement/synchronization, the full-data Summary/Roles/Database tabs, and an academic-year availability lookup.
