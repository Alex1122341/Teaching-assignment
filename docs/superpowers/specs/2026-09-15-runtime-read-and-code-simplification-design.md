# Runtime Read and Code Simplification Design

## Goal

Reduce routine Firestore reads and JavaScript complexity without removing visible features, weakening audit records, changing role behavior, or reducing the accuracy of timetable and AFC decisions.

The optimization is measured with three baselines: Firestore documents read for each user action, shipped runtime bytes, and source complexity. Physical line count is recorded but is not treated as the primary code-quality measure because several existing source files are compressed onto one line.

## Current Baseline

The production allowlist contains 33 runtime files totaling approximately 515 KB and 3,859 physical lines. The largest runtime source is `timetable.js` at approximately 139 KB and 1,723 lines.

The audit identified these avoidable read paths:

- opening common administrator session tools calls `ensureAllSessions()` and can read the full timetable, currently about 1,861 documents;
- the form observer in `faculty-access.js` reads the latest 20 audit documents and the actor profile after a single save, then performs a second write to enrich the audit entry;
- Change History initially requests 50 documents from each of three collections, up to 150 reads;
- faculty-facing approval workflow subscribes to every eligible user before a replacement chooser is opened;
- Faculty Dashboard uses one combined full-faculty/full-session loader for tabs that only need faculty documents;
- date-scoped schedule exports first read the complete timetable;
- `approval-workflow.js` retains a full-session fallback subscription that is unreachable in the production timetable integration.

Full reads that are explicitly requested by the user remain valid: complete JSON/CSV exports, full-date Outlook packages, source imports, account-provisioning preview, and administrative data maintenance.

## Architecture

### Direct audit details

`audit-details.js` will expose pure helpers that compare session and faculty records and return the existing `{field,label,before,after}` array format. Timetable and Faculty Dashboard save/delete paths will calculate these details before committing and include them in the original audit document.

The form `MutationObserver`, delayed modal polling, actor re-read, recent-20-log scan, and follow-up log update will be removed from `faculty-access.js`. Existing legacy logs remain readable through the current recovery logic. Batch edits and approval actions already carrying concrete changes keep their current behavior.

### Scoped session reads

Routine timetable tools will consume the existing visible-range session cache. A new scoped loader will accept exact dates, deduplicate them, group them into Firestore `in` queries of at most 30 dates, merge the results into the page cache, and reuse already covered dates.

- Edit and swap load the current and newly selected session dates.
- Batch session creation loads only the distinct dates entered before availability validation.
- Session selection uses the already-rendered records and its stable selected-record map.
- Date and academic-period exports query their requested range.
- `All dates` exports and full Outlook packages may call the complete-session loader because their output requires the complete schedule.

No availability warning may be calculated until the required date queries have completed. A failed scoped query blocks the save and shows the existing error treatment; stale data must not be used.

### Incremental derived indexes

`index-maintenance.js` will add a pure function that applies a list of `{before, after}` session changes to the current `faculty_index` and `schedule_stats` documents. It will adjust:

- total session count;
- course counts;
- each affected faculty entry's session count;
- each affected faculty entry's assigned teaching DOE by the before/after assignment DOE delta;
- assigned faculty count derived from the updated faculty entries.

Single-session create/update/delete, swap, spreadsheet batch update, and multi-session create will update these two settings documents from their exact before/after changes. The update will use a Firestore transaction or equivalent conflict-safe read-modify-write step, so simultaneous administrators do not silently overwrite each other's totals.

Full source synchronization remains authoritative and continues rebuilding both derived documents from the complete imported data. If a session write succeeds but the derived-index update fails, the UI reports that the schedule saved but the index requires refresh; it must never claim the whole operation failed and invite a duplicate save.

### Split administrative datasets

Faculty Dashboard will maintain independent promises and loaded flags for full faculty data and full session data.

- Lookup continues with `settings/faculty_index` plus one selected faculty document and that faculty member's sessions.
- Roles and Faculty Database load full faculty only.
- Teaching Summary loads sessions only where its rendered calculations require them.
- Full imports and complete exports can explicitly request both datasets.

The split preserves the current tab content and authorization gates.

### Lazy replacement people

Approval workflow will not subscribe to all faculty-facing accounts at startup. HICC group records load first; required member profiles are fetched only for the relevant group. Faculty and VISC replacement candidates load when the replacement dialog is opened and are cached for the page session. The user's own profile continues to come from the shared profile snapshot.

Pending-request highlighting, approval badges, AFC queue behavior, and HICC scope must render without waiting for the candidate directory.

### History pagination

Each history collection will initially request 20 records. The merged table, filters, role-based visibility, and `Load older changes` control stay unchanged. Each subsequent load requests the next 20 documents per non-exhausted collection.

### Shared helpers and dead paths

Identical normalization, numeric conversion, HTML escaping, and audit comparison helpers will use existing shared modules where dependency order permits. Helpers with different business semantics remain separate even if their implementation looks similar.

The production-only `UCVM_PAGE_DATA` integration becomes the required session source for approval workflow. Its full-session fallback subscription is removed. No production asset is deleted unless the dependency graph and tests show it has no runtime consumer.

## Data and Security Boundaries

- Firestore Security Rules remain the source of authorization.
- `facultyRoles` never grants administrative access.
- Faculty HR records and AFC reasons are not copied into broadly readable settings documents.
- Scoped indexes contain only the fields already exposed by the current index schema unless a rule-protected field is explicitly added and tested.
- Audit entries remain immutable to ordinary users and retain actor UID, actor name/email where currently allowed, timestamp, action, target record, and before/after details.
- Legacy records and legacy history entries remain readable.

## User-visible Behavior

Timetable views, filters, session editing, multi-select editing, swap requests, availability checks, exports, Outlook packages, Faculty Dashboard tabs, Change History, AFC requests, signatures, account roles, and password behavior remain available.

Loading indicators may appear for a scoped date query. History initially displays fewer loaded rows when more than 20 records exist in a collection, while the existing button loads older records. No other deliberate visual or workflow change is included.

## Verification

Pure tests will cover audit diffs, exact-date query grouping, cache reuse, session delta application, course/faculty count changes, DOE deltas, and idempotence. Static boundary tests will reject routine full-collection reads in session editing, selection, date export, approval fallback, and faculty-only administrative tabs.

The full Node suite and Firebase Auth/Firestore emulator suite must pass. Browser checks will cover desktop and narrow layouts, Day/Week/Month/List switching, single and batch session editing, Change History pagination, Faculty Dashboard tabs, AFC queue, and date/all export choices.

The completion report will compare before and after runtime bytes, physical lines, full-collection call sites, and estimated reads for login, first administrator edit, ordinary save, history open, date export, and explicitly complete exports.

## Expected Result

The first ordinary administrator session edit should no longer read the full approximately 1,861-session collection. Its session reads should be limited to the visible or explicitly edited dates, plus the required faculty information and two derived settings documents. A normal audited save should eliminate approximately 21 follow-up reads and one follow-up write. Initial Change History reads should fall from at most 150 to at most 60.

The code change should reduce shipped JavaScript size and eliminate indirect observer/polling behavior. The target is a net reduction of 3–8 KB without minifying source or combining unrelated responsibilities merely to lower the visible line count.
