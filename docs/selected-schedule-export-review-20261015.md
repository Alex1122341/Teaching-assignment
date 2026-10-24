# Task03 — Selected schedule export: repository review

Status: owner approved the bounded design and TDD seams on2026-10-15. Initial local implementation and responsive interaction slice are present on feat/selected-schedule-export-20261015 from6ab3a52 (Task02 candidate a356df1 plus documentation-only acceptance records). The review below records the pre-implementation findings. Whole-feature acceptance, independent review and freeze promotion remain pending; this is not a release.

## 1. Existing functionality

Timetable already supports multiple selected course filters, CSV/ICS download, date/academic/all-date scopes and chronological export sorting. A pure selection module stores session IDs and counts, toggles/clears them and enforces a supplied bound. Its existing screen is a batch-editor workflow requiring session-write permission and Faculty Directory access; it is deliberately hidden in the current SQL UI. It must not become the read-only export entry point.

## 2. Responsible files, APIs and SQL

- index.html: current CSV/Calendar export toolbar and hidden administrative edit-selection controls.
- timetable.js: openExportDialog, exportFilteredRows, exportCsv, downloadFile, selectedCourses/course filters, azureSessionRow, fetchAzureSessions and ensureAllSessions. Current200-record edit selection is separate state.
- timetable-selection.js: create(max), IDs/counts, selectedRows and edit validation/audit helpers. Reuse only the pure selection functions for export; edit code requires unrelated writes/private faculty data.
- paws-data-client.js: listSessions makes authenticated University API reads; existing GET /api/v1/sessions routes through server/src/data/data-api.js and sql-session-repository.js.
- SQL paws.vCalendarSession, paws.Session, paws.SessionAssignment, paws.Course and existing instructor-name joins are authoritative. API verifies current token/profile and passes server-resolved FacultyId scope and assignment-target capability to the repository. No new source or Firestore access is needed.
- Tests: timetable-views-export.test.js and timetable-selection.test.js; existing API/repository/scope tests support authorization regression.

## 3. Already satisfied requirements

Multiple courses, CSV format, complete authorized reads, course/instructor/room/timing fields, chronological ordering and pure ID selection/counting already exist. Requirement accepts Excel or CSV, so CSV needs no new spreadsheet dependency. Working-activity ranges remain their own Calendar data; existing teaching export is the correct flow to extend.

## 4. Gaps

Current export immediately exports filtered rows, without an explicit session checklist or exact selected-record preview. Administrative selection is editing-only, hidden and capability-gated; using it for download would broaden the wrong workflow. Legacy CSV contains internal ID/source/raw assignment JSON; selected-report output needs an explicit public-field projection rather than spreading source objects. CSV quoting alone does not prevent spreadsheet formula execution. VISC is not supplied by the current session DTO/mapping and must remain unavailable until an approved source is connected. Export/account-switch/loading/failure behaviors require actual browser acceptance.

## 5. Reuse and boundaries

Extend the current export modal with read-only course/session selection and count/preview; use authenticated fresh scope, existing timing/filter helpers, stable IDs and download infrastructure. Preview and CSV use the same selected snapshot with deterministic chronological order and safe scalar fields. Gate completion on current account and fully successful authorized load; never substitute stale or failed reads. Course membership selection must cover all matching authorized sessions and explicitly reject an exceeded bound instead of silently truncating. Keep edit-selection permissions and its200-row limit separate. No API/SQL mutation, new authority, private directory enrichment or DOE/AFC fields are needed.

## 6. Necessary changes and verification

Implement only after the short design is approved: modal course/session controls, select-all/individual selection, count, exact preview, safe selected-report CSV serialization and original download helper reuse. Use course code/name, session date, start/end, topic/type, authorized instructor display and room; VISC marked Not provided when absent. Tests first: pure selection/projection/order/escaping, role/scope and absent-data regression, real UI multi-course/individual/all/preview/download/account-change/error flows. Then full root/server/emulator, build, independent review, separate freeze governance and artifact verification for the new feature. Task02 PR100 remains a separately accepted draft dependency; this review adds no Task03 runtime there.
