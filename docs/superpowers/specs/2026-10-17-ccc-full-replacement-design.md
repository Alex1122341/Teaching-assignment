# Task14 — full CCC Calendar replacement

## Intent / discovery

Task13 already moved540 working activities including161 CCC and permanently removed their exact AFC counterparts. Do not replay that operation. Existing CalendarActivity, date-only availability, source provenance, actor checks, faculty locks, import pool, workbook worker limits and recovery patterns are reused. Existing CCC RoleAssignment/DOE evidence is not the scheduled CCC dataset and must remain unchanged.

Build a true full replacement capability, with explicit `ccc-calendar` dataset and canonical academic year, not append/merge or a second calendar. Owner's standing recommendation/inline/no-question instruction applies to design/plan sequencing; actual deletion still needs a fresh exact preview and source completeness confirmation. No approved complete CCC-year workbook has yet been established: existing AFC tracker is historical migration evidence, not automatic authorization to delete a whole year.

## Scope and source

Academic year uses repository vocabulary YYYY-YY, May1 through April30. The selected scope contains every Category=ccc CalendarActivity overlapping that year. Existing targets crossing its boundary block replacement; dates are never clipped, split or invented. Other categories, years, AFC, sessions, roles, DOE, approvals and original migration receipts are preserved.

Accept a strict template:one visible `CCC` data worksheet, six headers `Faculty ID`, `Faculty Name`, `Start Date`, `End Date`, `Course Code`, `Label`. Each row supplies a canonical faculty GUID or an unambiguous exact current display/preferred full name. When both supplied, both must agree. No fuzzy identity. Optional course code must resolve to an existing course; missing course remains unprovided. Label defaults CCC; dates are real Excel dates or YYYY-MM-DD, no formulas, times or unknown fields. Workbook <=512KiB,5000 rows,16MiB bounded ZIP expansion,10s worker/128MiB/max2 workers. Empty dataset cannot be confirmed in this version: deliberate clear-all needs separate explicit design, preventing accidental blank-file wipe.

Use existing deterministic XML/ZIP/date safety utilities extracted without semantic changes. New parser is separate from immutable approved AFC migration policy; never broaden the old source allowlist. SQL resolves current identities/courses again at every preview and commit. Invalid, duplicate, ambiguous, inactive or out-of-year rows block the entire replacement. Duplicate detection uses resolved faculty/date/course/normalized label so name-vs-ID aliases cannot bypass it.

## Flow and transaction

Existing AFC Records import area gains Bulk Upload / Replace CCC, year picker, template instructions, file metadata, row errors, old/new counts, full old/new row preview, expiry and explicit complete-dataset confirmation. This is an administrator workflow and explains scope clearly. Date-only imports retain missing-time/Needs Review semantics. No claimed year completeness based on filename/hash alone.

Separate default-off gates `cccReplaceStage` and `cccReplaceCommit`. Endpoints under `/api/v1/ccc-replacements`:capabilities, POST stage, GET batch, POST preview refresh, POST commit. Commit payload binds batch/version/source/manifest/idempotency key plus dataset/year and explicit completeness confirmation. Stage/preview write only staging; no Calendar/AFC changes. Unknown actor fields/row injection rejected. UI preserves same keys after ambiguous responses and discards stale results on auth changes.

New staging.CccReplacement plus existing ImportBatch/Workbook/Sheet/Row preserve source lineage; no parallel activity store. Snapshot includes resolved rows/current identities, old IDs/versions/dates/source/time evidence and every blocking issue. Preview expiry15min. Serializable commit locks per CCC year plus canonical faculty locks shared with SWAP; rechecks live admin profile, expiry, exact snapshot/hash/version and protected references. Any existing day-time evidence or unexpected FK to CalendarActivity blocks deletion. Whole target set changes -> stale preview, including phantom insertions. Foreign key failures roll back everything.

One transaction captures complete old rows into private receipt, deletes exactly the scoped old CCC rows, inserts the full validated new set into CalendarActivity with new IDs and existing staging provenance, writes private per-faculty durable history and receipt, marks batch committed. No AFC/role/DOE write or automatic recalculation. Idempotent retries return the original receipt only for identical actor/batch/source/preview bindings; never repeat deletion.

Receipts preserve before rows and inserted IDs/versions privately. An admin recovery procedure (no browser route, separate empty execute-only recovery role) restores the old set only if the entire new scope, versions and references still match and old IDs are free; otherwise refuses. Runtime browser receipt responses exclude recovery payload. Before real replacement, export receipt-bound private recovery evidence on school storage and verify hash/ACL under the established process.

## Acceptance / release

Synthetic workbook tests, SQL identity/course/duplicate/zero/year/range checks, stale/expiry/race/role-revocation, injected audit failure rollback, repeat-key and guarded recovery; verify all unrelated data hashes unchanged. UI real browser exercises year/file/preview/confirmation and stale auth, no invented live working sessions. Existing work filters/individual schedules/availability still use CalendarActivity and must show only the new CCC scope after synthetic replacement.

Independent whole-branch review and separate immutable promotion follow implementation. Exact-main CI/artifact checks and coherent SQL/API/Hosting release under existing authorization. Stage may be opened after technical acceptance; live destructive commit stays closed until approved complete source plus exact target preview are confirmed. Course Calendar remains untouched. Update original Excel with capability/deployment/actual-data/acceptance separately, then prepare every outstanding acceptance item from all25 tasks.
