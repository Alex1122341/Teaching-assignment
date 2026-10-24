# PAWS Beta — 25-task architecture and gap assessment

Date: 2026-10-14 (America/Edmonton). Status: initial repository/source audit; product implementation has not started.
Repository: Alex1122341/Teaching-assignment-azure. Exact main: 0d4b4d9ea2e658719e87f16ef5132b82544bc6c1.
Working branch: docs/paws-directive-assessment-20261014, in the existing isolated worktree.

## Owner requirements and current evidence

The full directive is the implementation brief. The subsequent owner instruction supplies AFC Tracker Lookup (2).xlsx and prioritizes moving actual working activities into Calendar and permanently removing their exact AFC counterparts. University Travel, Vacation, RSL, every kind of leave, and owner-confirmed OPA remain AFC. Ordinary AFC cancellation continues retaining history. Course Calendar replacement is capability development only; its current data must not be replaced yet.

Fresh public API runtime and SQL health are ok. Deployed API/Hosting release remains ca465bf1401b457ca3b74048cfaf170bedc7694a; trust anchor fb2c625745957fa7d9990033f15a7b1ef91974a5. Main0d4b4d9 is documentation only, with successful push CI38586679589. AFC single/cancel gates are enabled; approved artifact generation gate is closed. No new merge or deployment. One subsequently owner-authorized Faculty deactivation was completed; see Archive evidence below.

Initial SELECT-only University SQL inventory: Session1937, all in2026-27; active imported AFC803. Subject0; TeachingResponsibility2; Assignee2; Scope1; Group1; GroupHicc1; TeachingSessionOwnership1; RoleAppointmentSchedule0. Two responsibility assignees are current under the existing UTC contract; zero calendar sessions have subject ownership. Presence of these foundation rows does not prove owner-approved full directory/subject coverage. Later AFC observations and refreshed source matching are recorded below.

Historical ARCHITECTURE/DATA_MODEL/MODULE_MAP prose still describes pre-R1 Firestore/SWA states. Those sections are historical, not current runtime authority. Exact source, recent release evidence and this fresh inventory take precedence.

## Status convention

Partial means some reused foundation exists, not that the requested task is accepted. Blocked indicates an identified source/authority dependency; independent code/design can still progress. Deployment and authenticated live acceptance are separate from implementation. Earlier narrow releases are not full-directive acceptance.

## Task matrix

Paths are repository-relative. Tests below are required acceptance plans, not claims of newly implemented features.

| ID | Status | Existing files / authoritative source | Required change / reuse | Dependencies | Risk | Acceptance plan |
|---|---|---|---|---|---|---|
| 01 | Partial | swap-workflow-sql.js; server/src/swap; SQL030 SwapRequest/Revision/Decision/Candidate and canonical SessionAssignment | Searchable candidates and dedicated automated SQL/API/transition acceptance; extend current SWAP | Real scoped reviewers, synthetic transition fixtures; future Calendar activities in availability | High | Self/scope denial, consent, notes, revisions, duplicate decisions, stale facts, live availability and concurrent apply rollback |
| 02 | Partial | workspace-tasks.js; scheduling-core.js; timetable.js; Session/SessionAssignment/vAfcRecordUnified | Add server-derived overlapping/AFC/duplicate/review issues to existing Tasks, structured filters and durable review state | Canonical IDs, sanitized availability, date-only work-activity integration | High | Adjacent/overlap, unknown time/date/identity, duplicate semantics, privacy, filters, stale review and persistent unresolved conflicts |
| 03 | Partial | timetable-selection.js; timetable.js:1307,2287; authorized Session reads | Separate read-only selection/export from edit capability; export selected IDs with count/preview and chronology | Existing selection state; no write activation needed | Medium | Selected subset only, cross-course select-all, empty selection, counts and chronological CSV |
| 04 | Blocked for complete data coverage | Subject/TR/Assignee/Scope/Group/TeachingSessionOwnership; sql-session-repository.js | VISC search/multiselect plus confirmed session mappings; identify unmapped records | Subject0, subject ownership0; verify/import approved authority mappings | Medium | Verified mappings, multiple subjects, reset and other-filter parity; no keyword/DOE-category inference |
| 05 | Partial foundation; coverage blocked | SQL responsibility/assignee/group objects; server/foundation/sql-teaching-assignment-repository.js | Timetable button and sanitized HICC/VISC directory over current authority | Only2 responsibilities/1 ownership observed; provenance/currentness unresolved | High | Temporal/concurrent assignees, scope/group joins, missing mappings, no UCID/email/DOE/notes |
| 06 | Partial | faculty-role-periods.js; SQL035 RoleAppointmentSchedule; Dashboard role renderer | Calendar read-only public-role tab and safe server projection | Current period table0; preserve two distinct temporal contracts | High | Calgary inclusive appointment ends/open ends/empty saved list; responsibility exclusive expiry; role privacy and all supported authenticated users |
| 07 | Partial lookup; VISC association blocked | faculty-admin.js:552; existing authority relations | Sanitized VISC-associated lookup, with multiselect | Same verified mappings as04/05; full faculty profiles remain scoped | High | Every association justified, multiselect, privacy and no specialty/rank inference |
| 08 | Missing | Existing Lookup cards and export patterns | Copyable VISC-result table, selected/all copy, CSV/XLSX, sorting/status | 07; approved public fields | Medium | Display/export permission parity, selected/all scope, dates and formula-safe cells |
| 09 | Partial legacy shell | afc-timetable-panel.js:57; faculty-access.js:95; SQL AuditEvent/domain audit | Replace actor-only Firestore history with sanitized SQL affected-faculty history and export | Captured immutable affected IDs are incomplete historically | High | Outgoing/incoming instructor scope, admin changes affecting faculty, unrelated denial, coverage notice and export parity |
| 10 | Missing | SQL016/019/030 teaching audit evidence | Calendar Changes tab using a shared allowlisted durable SQL projection | Historical snapshots have incomplete affected-faculty evidence | High | Authorized public teaching fields only, added/removed where captured, no raw audit JSON/private DOE |
| 11 | Partial legacy filtering | Existing search/type history shell | Server course/topic/VISC/faculty/date/type/year filtering and bounded CSV/XLSX | 09/10, verified VISC mapping | High | Combined filters, stable paging/export scope, bounds, null/unmapped coverage and permissions |
| 12 | Partial artifact foundation | faculty-admin-afc-records.js; afc-approved-artifact-api.js; SQL011 AfcArtifact | Separate authenticated audited gated form-attachment upload, metadata preview and download | Decide uploaded document ownership/readers/lifecycle/limits; generated approved artifact is a different type | High | Synthetic PDF validation/integrity/size, ownership/RBAC/gate denial, audit and generated-artifact regression |
| 13 | Partial source audit; destructive implementation missing | AFC provenance + supplied workbook + exact read-only reconciliation | Permanent removal of exactly mapped working-activity AFC after atomic Calendar insertion; extend CCC-only scope to owner-confirmed working categories | Written migration design/review, version-bound target preview, unresolved source rows | High | 541 exact targets, stale map/version denial, ordinary absence/document preservation, failure rollback and recovery |
| 14 | Missing CCC replacement; existing display only | Legacy CCC Firestore read model; canonical SQL catalogs; new supplied CCC source | SQL-authoritative CCC range events and staged .xlsx full replacement | Shared typed activity/import design, explicit dataset/year scope, source exceptions | High | Exact mappings, complete incoming dataset, no append, cross-year safety, idempotency, concurrency and atomic rollback |
| 15 | Partial import foundations | bulk-import-* JSON/Firestore helpers; SQL019 create/batch; canonical Session/Assignment | SQL staged .xlsx Course Calendar full replacement; reuse validators/preview where applicable | Explicit scope, stable keys, assignment/ownership/published/SWAP/DOE dependencies; owner says no actual replacement yet | High | Multiple faculty, duplicate/conflict validation, protected references, no DOE recalculation/publish, rollback and unrelated data unchanged |
| 16 | Partial calendar foundation; confirmed source supplied | Existing Calendar/Faculty schedule;41 Rotation Participant rows in supplied tracker | Add confirmed rotation/special-activity ranges without invented course/time/group; owner identifies fourth-year rotation domain | Canonical identity exceptions and reviewed source/category/range mapping | High | Source dates/assignees reconciled, optional fields truthful, filters/schedules, unknown time availability |
| 17 | Missing transactional operation; source audit partial | Session/AFC provenance and shared import/audit foundations | Full rotation replacement plus exact AFC-source cleanup in one transaction | 16/shared staging model, exact two-sided mapping, scope and recovery | High | Insert/delete failure injection, no obsolete target ranges, unrelated AFC preserved and complete rollback |
| 18 | Partial | SQL028 supervision snapshots; doe-worksheet-service.js; faculty-admin-doe-worksheet.js | Category/count/year/source table in existing profile/worksheet | Exact approved snapshot layout; total-zero confirmations lack category arrays | Medium | Explicit zero vs absent category, own/admin privacy, source reconciliation and no fabricated individual trainees |
| 19 | Prototype foundations; authoritative format blocked | Approved # Trainees snapshots and all-worksheet aggregate API | Bounded admin consolidated category report and CSV/XLSX prototype | Tosin source/category/format confirmation; original source access for reconciliation | High | Verified counts, source labels, missing history, authorized filters and export parity |
| 20 | Partial; full workload source coverage blocked | RoleAssignment/DoePolicyException/AssignmentFact/ManualDoeAssignment; supplied tracker for scheduling only | Report approved allocations/activities/exceptions over existing evidence | Approved MASTER special-workload fields; tracker dates are not DOE amounts/approval evidence | High | Effective vs draft exceptions, missing values, source/period labels and confidential-field denial |
| 21 | Partial | Existing target/role overrides, signed manual adjustment and exception repositories | Unified read-only source-discriminated override report/export | Preserve replacement versus additive semantics and authorized notes | High | Positive/zero/negative/decimal values, once-only overrides, original/effective source values and RBAC |
| 22 | Partial | Existing calculators/worksheet/recorded-source projection; approved policy/reference objects | SELECT-only discrepancy report across requested screens; fix confirmed presentation/logic defects | Current effective policy/source verification; original approved references | High | Source/stored/API/UI scope comparisons, supervision/reserve, override once, missing targets and proof of no audit/policy/recalc writes |
| 23 | Missing | Existing controlled domain fields; rule editor is not reporting UI | Server field registry, typed AND/OR AST, bounded parameterized approved queries | Sanitized report adapters and security design | High | Nested logic, invalid field/operator/joins, row-scope AND isolation, hidden-field/filter/count denial and bounds |
| 24 | Partial readers; unified registry missing | Existing SQL domain repositories | Approved report-type registry and source/provenance adapters | 04–11/16/18–22 for coverage; unavailable categories explicit | High | Approved join paths, no fan-out/duplicate authority, absent-source handling and row/field scope |
| 25 | Missing builder output | Existing timetable CSV patterns; exceljs root development dependency | Matching preview/count/columns/reorder/sort/copy/CSV/XLSX on same authorized query | 23/24; reviewed runtime export dependency/bundle | High | Preview/export parity, formula-safe cells, empty results, stable sort and timeout/row/export limits |

## Key integration findings

- Current Tasks contains out-of-grid/missing-time records plus SWAP requests; it is not a complete faculty-overlap/AFC conflict work queue.
- DOE MASTER VISC labels are calculation provenance, not proof of timetable authority. Do not generate a specialty catalog or map sessions from topic keywords.
- Role appointments use Calgary date with inclusive end and saved empty periods inactive. Responsibility assignments use inclusive start, exclusive nullable end under current SQL authority. Legacy nonnullable-expiry helpers cannot be reused unchanged.
- Existing My History reads Firestore actor-only logs. SQL audit projections must use captured affected IDs where available, expose incomplete history where absent, and never return raw JSON containing DOE/HR.
- Existing approved-artifact POST renders an approved request and rejects uploaded bodies. Uploaded forms need a separate document type/endpoint.
- Current bulk importer is JSON/Firestore phased recovery; looping current SQL create commands would trigger DOE recalculation and cannot implement atomic replacement.
- Deleting Sessions has assignment, ownership, contribution, revision/finalization, Published and SWAP dependencies. DOE facts can retain Session IDs even without declared FKs. Block unsafe references rather than cascade them.
- Existing DOE Impact Preview persists runs/rows, policy revision/checksum and audits. Task22 must not call it as a read-only audit.
- Current Worksheet and Overview aggregate different components. Compare their stated scope before declaring a difference a defect.
- Dedicated least-privilege runtime is a documented prerequisite for broad write expansion. New permanent-delete/upload permissions need reviewed proof or a concrete owner-approved temporary exception; this audit changes none.
- New work activities must participate in timetable availability checks before corresponding AFC deletion. Date-only work is incomplete time evidence, not proven timed overlap or proven availability.

## Supplied source and concrete preview

Source: AFC Tracker Lookup (2).xlsx, SHA2564FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF,80154 bytes.
AFC records!A1:D1135 contains812 populated records; Lookup/duplicate Lookup are derived availability interfaces, Data contains external/formula-driven lookup content, CODE helper cells are not events. Only A–D are approved event fields. Trailing formatting and an unheaded auxiliary cell are excluded.

Raw treatment after owner confirms OPA:264 retained AFC rows,547 working candidates,1 blank-purpose row. Working categories: CCC161, Rotation Participant41, Clinical Day259, VETM581 activity57,571 activity6, VETM591 activity17, Teaching Excellence4, approved Remote Work2. These are source category counts, not final committed record counts.

There are no separate course/academic-year/location/time columns. Some Purpose labels contain literal time/date hints; they are preserved as text and require a reviewed parsing rule before becoming clock/course fields. Excel midnight date values are not midnight appointments. Working dates range2026-01-11 to2027-08-31;20 working rows extend outside May2026–April2027. Preserve original ranges and explicitly resolve import scope rather than clipping or inventing academic years.

SELECT-only reconciliation uses exact formatting/case-normalized canonical names, registered aliases and the accepted AFC import batch/row lineage to recover historical source names. It uses no fuzzy matching or private contact/UCID keys. Faculty/date/purpose correspondences remain unique; ambiguous identities would be rejected.

Initial live active AFC category counts were541 working-category records,261 retained absence/OPA records,1 unclassified record. Every one of the541 live working records had a unique, nonquarantined exact source counterpart. Later authenticated Dashboard reads progressed804 then805 during concurrent application use. Refreshed SELECT-only source reconciliation still finds541 exact work targets; valid retained row812 now has an active counterpart. It is no longer proposed for insertion. Recreate the entire preview before any commit; neither803 nor805 is an immutable migration target count.

Unresolved:
- Owner resolved source rows267(retain),297/563/773(working) as one departed person. Explicitly exclude all four; do not create an active Faculty record.
- Reversed dates:256(2026-08-25 to2026-08-24),525(2026-12-15 to2017-01-03).
- Missing faculty307; missing purpose487. The existing unclassified AFC remains pending review.
- Exact duplicate source pairs57/58,273/276,346/351,463/813, all retained categories. Preserve existing absence history; do not silently purge it.
- Proposed immediate source scope remains541 uniquely mapped existing work records, with no valid unmatched retained row in the refreshed read. Exceptional rows remain quarantined and departed-person rows excluded. This is a preview, not a completed migration.

## Archive evidence and existing interface fault

The owner authorized archiving the existing uniquely matched Canton Faculty record. Existing Inactive Faculty/Restore is reused. UI Deactivate returned503 and SQL confirmed Active1 with no deactivation audit. Direct execution of the existing procedure returned1934: persisted QUOTED_IDENTIFIER is0, which rejects its Faculty UPDATE against indexed constraints. Both failed operations left the record active.

The authorized single operation then executed the reviewed unchanged stored-procedure body as a parameterized admin batch with the required SQL session options. Canonical target/actor uniqueness, existing SQL actor authorization, row locks, expected version, transaction and original audit logic were preserved. No procedure/schema/gate/role/account was changed. SQL proves the target Active0, Faculty119 active/2 inactive, one FacultyDeactivated audit, Session1937 and Assignment4970 unchanged. Chrome confirms the target in Inactive Faculty; screenshot output/full-directive/canton-archived-20261014.png.

The second departed person has no canonical Faculty record and is excluded from import rather than added as active. The generic Deactivate API remains defective pending a focused reviewed SQL metadata correction. Do not repeat the completed archive or silently repair live stored modules.

Written first-module design for owner review: docs/superpowers/specs/2026-10-14-calendar-working-activities-design.md. It recommends a narrow SQL range-activity domain integrated into Calendar/schedules and transactional availability before exact AFC cleanup.

## Modular sequence and release boundary

1. Review the written special-activity migration design and concrete source preview.
2. Implement/stage/test the SQL-authoritative range-activity integration and availability safeguards; prepare a focused product PR plus separate reviewed freeze promotion.
3. Obtain concrete merge/release/data-operation authorization after PR, rollback/recovery and scoped preview are reviewable; exact-main CI then coordinated SQL/API/Hosting release.
4. Extend Tasks02 against authorized Session and range-activity evidence.
5. Build CCC/rotation full replacements and Course Calendar replacement capability. Current Course Calendar data remains unchanged until a separate directed operation.
6. Deliver sanitized directories/export/SWAP tests, SQL history, workload reports/reconciliation and the bounded report builder as independent modules.

The full25-task objective remains active. No requested new task is marked complete merely because this audit has finished.

## Baseline validation

On the unchanged runtime tree at main0d4b4d9: root npm test813 total/781 pass/32 skipped/0 fail; server npm test509 pass/0 fail. Static build71 assets/2051653 bytes. Static and API repository freezes passed; proper Beta package static/API artifact freezes passed. A raw .deploy-static artifact check initially failed because it lacks the Beta ancillary staticwebapp.config.json; the documented Beta packager supplies that file. No source/freeze guard was changed to resolve this check.

No new module tests, SQL migration/rollback tests or authenticated new-feature acceptance have run because implementation has not started.
