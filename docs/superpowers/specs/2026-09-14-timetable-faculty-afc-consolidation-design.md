# Timetable, Faculty Dashboard, and AFC Consolidation Design

## Goal

Consolidate faculty self-service into the timetable, rename the administrative Faculty Directory to Faculty Dashboard, complete the AFC form-to-PDF mapping, remove the timetable UI editor, and add a responsive multi-session editing workflow.

## Current constraints

- The site remains a Firebase Authentication and Firestore client application hosted from the same allowlisted static build on Firebase Hosting and Azure Static Web Apps.
- Existing role boundaries remain in force: faculty, HICC, and VISC can read their own faculty-facing data; ADFA and administrative roles retain their existing management and approval powers.
- Every timetable mutation must retain an actor identity and a corresponding `session_change_log` entry.
- AFC approval continues to create one immutable PDF represented by Firestore `pdf_chunks`; no Firebase Storage or server API is introduced.
- Existing AFC requests and approved PDF records must remain readable without data migration.

## Page architecture

### Timetable

`index.html` becomes the only faculty self-service page. Faculty, HICC, and VISC accounts continue to land on their own teaching in Day view. The timetable adds three actions:

- **My Teaching** restores the account's own filtered Day/List teaching view.
- **AFC Request** opens the request form and the user's request history in a modal or integrated panel.
- **My Change History** opens the existing self-filtered audit log.

The timetable supplies the signed-in profile, linked faculty record, and already scoped sessions to the AFC module through a small page-data interface. The AFC module must not start a second listener for the same visible timetable data.

### Faculty Dashboard

`faculty-admin.html` and its visible copy are renamed from **Faculty Directory** or **Faculty Admin Dashboard** to **Faculty Dashboard**. Its current lookup, teaching summary, roles, DOE, database, change history, AFC approval link, and user-management access remain available according to role.

### Removed page

`faculty-dashboard.html` and `faculty-dashboard.js` are deleted from the repository and hosting allowlist. All runtime links to those files are replaced. The legacy `/faculty-dashboard.html` route redirects to `/index.html` on both Firebase and Azure so saved bookmarks do not expose a dead page.

## AFC request and PDF behavior

### Request form

The timetable AFC form collects the existing fields plus two required contact fields:

- `contactAddress`: non-empty string, maximum 500 characters.
- `contactPhone`: non-empty string, maximum 50 characters.

New requests store both fields on `afc_requests/{requestId}`. Firestore creation rules validate their type, length, applicant identity, faculty identity, signatures, timestamps, and existing workflow status. Older requests without these fields remain readable and approvable; the generated PDF leaves missing legacy contact fields blank.

Teaching assignments found in the requested period render as a vertical list. Each row displays date, start/end time when known, course, and topic. Coverage remains required whenever one or more assignments are found.

### Canonical PDF values

The source PDF is `absence-from-campus-app.pdf`. Its SHA-256 is `481677829217736B15CB3CBB010F49CB553A8664FE53F8604782093E99896547`, matching the deployed repository copy.

The renderer fills:

- `AddressRow1` from `contactAddress`.
- `PhoneRow1` from `contactPhone`.
- `Primary Department` with the exact dropdown value `30060 - Faculty of Veterinary Medicine`, regardless of a faculty record's stored department.

Rank uses only exact values accepted by the PDF dropdown:

| Database value | PDF value |
| --- | --- |
| Assistant Professor | Assistant Professor - AC0003 |
| Assistant Professor (Teaching) | Assistant Professor (Teaching) - AC0004 |
| Associate Professor | Associate Professor - AC0002 |
| Associate Professor (Teaching) | Associate Professor (Teaching) - AC0007 |
| Professor | Professor - AC0001 |
| Professor (Teaching) | Professor (Teaching) - AC0008 |
| Blank or Unknown | Blank dropdown option |

Appointment type uses only exact values accepted by the PDF dropdown:

| Database value | PDF value |
| --- | --- |
| Tenure | With Tenure |
| Tenure Track | Tenure-track |
| Limited Term | Limited Term |
| Contingent Term | Contingent Term |
| Blank | Blank dropdown option |

The mapping helper normalizes surrounding whitespace and common hyphen/case variants, then returns only a value in the PDF's option allowlist. An unrecognized value selects the blank option rather than writing an invalid choice.

## Multi-session selection and editing

Only accounts with timetable edit permission see **Select Sessions**. Activating it adds selection controls to rendered calendar blocks and List rows without changing the current filters.

- Clicking a session or its checkbox toggles selection and updates a visible count.
- **Cancel** clears selection and restores the previous view.
- **Review selected** requires at least one selection, switches to List view, and shows only selected sessions.
- The selected list provides spreadsheet-style editing for date, year, course, type, start, end, topic, room, and assigned faculty.
- **Save selected changes** validates every row first and commits the session updates plus one `session_change_log` record per changed session in a single Firestore batch.
- The workflow supports at most 200 sessions, keeping at most 400 writes below Firestore's 500-write batch limit.
- Unchanged rows produce no database write or audit entry.
- The derived `facultyIds`, faculty index, and schedule statistics are refreshed through the existing maintenance layer after a successful save.

Selection remains tied to session IDs, so switching among Day, Week, Month, and List views does not lose checked sessions. A session hidden by a normal course/year/type/date filter is not silently removed from the selection; the review screen is the authoritative selected set.

## Responsive filters

The Year, Semester, and Week area becomes one collapsible **Schedule filters** section with an always-visible chevron control and accurate `aria-expanded` state.

- At desktop widths it starts expanded.
- At viewport widths of 900 pixels or less it starts collapsed unless the user expanded it during the current tab session.
- Collapsing moves the panel upward and leaves the search/month/course/type row and expand control available.
- Controls wrap cleanly and remain keyboard accessible at narrow widths.
- The existing small-screen filter behavior is consolidated into this single state instead of maintaining two competing expand/collapse controls.

## Removed timetable UI editor

The **Edit UI** button, editor panel, editing CSS, event bindings, and layout-edit persistence are removed. Static layout defaults remain in CSS. This removal must not affect timetable session editing or the new multi-session editor.

## Copy and navigation

All user-visible references use these names consistently:

- **Faculty Dashboard** for `faculty-admin.html`.
- **Timetable** for `index.html`.
- **AFC Request** for faculty request creation and request history.
- **ADFA approval queue** for administrative decisions.

Messages that previously instructed users to open Faculty Dashboard for source synchronization now point specifically to **Faculty Dashboard > Teaching Summary**.

## Error handling

- The AFC form explains missing address, phone, signature, purpose/destination, or coverage before submitting.
- PDF option mapping never throws because of a database label; unsupported labels become the form's blank dropdown value.
- Multi-session validation lists row-specific errors and performs no writes if any row fails.
- A failed Firestore batch keeps the selected rows and edits visible for retry.
- Redirects from the removed page preserve the original URL only long enough to navigate to the timetable; no duplicate application code remains.

## Verification

Automated checks cover:

- absence of `faculty-dashboard.html/js` from the tree, runtime links, and static manifest;
- the legacy route redirect on Firebase and Azure;
- Faculty Dashboard naming and retained administrative tabs;
- timetable AFC self-service wiring without duplicate session subscriptions;
- required contact fields, vertical teaching rows, Firestore create rules, and legacy-request compatibility;
- every Rank, Appointment, Primary Department, Address, and Phone PDF mapping;
- removal of all UI editor markup, code, styles, and storage keys;
- multi-session selection, 200-row limit, selected-only List view, validation, atomic write shape, audit entries, and derived-index refresh;
- desktop and small-screen collapse behavior and accessibility attributes.

After static and emulator tests pass, build the 28-file allowlist, deploy it to Firebase and Azure, compare production asset hashes to the local build, verify blocked development paths, and perform live Chrome QA for the renamed dashboard, AFC form, vertical assignment list, responsive filter, and multi-session review flow. No AFC request is submitted and no live timetable session is modified during QA.
