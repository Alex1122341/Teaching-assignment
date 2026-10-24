# Task 02 — Scheduling conflicts in PAWS Tasks

Status: written design approved by owner on 2026-10-15, including ADFA-only review authority. Approval permits implementation planning; no release authorization.

Repository: Alex1122341/Teaching-assignment-azure (Beta). Branch: feat/scheduling-conflict-tasks-20261015. Starting commit: b53c23e1621c6a98c2d9b4c62198fdefdebeaf0f, stacked on PR99 and PR98.

## 1. Intended outcome

Extend the existing Tasks sidebar so users can find scheduling problems across their authorized academic-year scope, open the affected session, and track administrative review. Detect instructor overlaps, AFC unavailability, duplicate assignments, invalid times and incomplete scheduling information. Provide date, faculty, course, type and review-status filters. Reviewing or closing a task must never make a still-existing conflict disappear from the default queue.

The owner requested automatic continuation after the ADFA SWAP extension, sequential implementation and independent review. Essential questions are now allowed; do not invoke grilling. The current work prepares and tests a candidate. Live release, data migration and service-account provisioning remain separate prerequisites.

## 2. Repository review before implementation

### Existing functionality

`workspace-tasks.js` already creates the sidebar, opens sessions, retains the panel-open preference, guards asynchronous refreshes and lists out-of-grid/invalid-time sessions plus pending SWAP requests. `timetable.js` provides the all-session cache and navigation adapter. No separate Tasks page is needed.

### Responsible components

- UI: `workspace-tasks.js`, `workspace.css`, `timetable.js`, `paws-data-client.js`.
- Timing semantics: `scheduling-core.js` and SQL `039_calendar_activity_swap.sql`.
- Session scope/data: `server/src/data/data-api.js`, `sql-session-repository.js`, `server/src/auth/role-policy.js`, `paws.Session`, `paws.SessionAssignment`, `paws.Course`, `paws.vCalendarSession`.
- Availability: `paws.vAfcRecordUnified`, `paws.CalendarActivity`, `paws.CalendarActivityDayTime` and the existing Calendar/SWAP SQL routines.
- Runtime registration, static/API manifests, synthetic SQL acceptance and independently reviewed freezes follow the existing Beta deployment pipeline.

### Already satisfied

The existing sidebar, session navigation, request queue, authenticated SQL path, shared role normalization, canonical assignment identity, audited write conventions, default-off write gates and generation guards can be retained. Session writes already reject duplicate faculty entries; existing imported/legacy data still needs detection.

### Missing

There is no scheduling-conflict projection or durable task-review table in the current SQL/API implementation. The sidebar lacks faculty-overlap/AFC detection, structured filters, severity and persistent review status. Error refresh can leave previous rows in memory. Existing session information alone does not provide enough authorized assignment identity for browser-side detection.

### Reuse with limits

Reuse the server authorization and range-validation contracts, existing session/open-detail adapter, shared interval conventions, safe error handling and audit pattern. `availability-lookup.js` contains a legacy Firestore fallback and name-based matching; it is not a suitable Beta authority. Do not copy that path.

`CalendarActivityAvailability` is conservative for SWAP: invalid target times and undated/invalid other sessions can return Unavailable. Task02 must distinguish confirmed conflict from insufficient evidence, so it cannot directly translate that scalar result into confirmed queue items. Reuse the same canonical sources and half-open overlap predicates in a dedicated typed conflict projection; preserve existing SWAP behavior.

### Necessary changes and why

Add a scoped SQL conflict projection, a small review-state store, authenticated API methods and sidebar controls. SQL owns canonical identity and private AFC reads; the browser receives only the safe task fields it needs. Review persistence is independent of timetable mutations, so acknowledging a finding cannot alter the underlying schedule.

## 3. Approaches considered

1. **Recommended: derive current issues from SQL, persist review metadata only.** Current source data determines whether a conflict exists. Avoids a duplicate conflict database and a background synchronization job; requires bounded queries and source-aware stale checks.
2. Persist every detected conflict through a scheduled scanner. Supports extensive history but adds a job, lag, reconciliation and operational maintenance beyond this task.
3. Compute in the browser. Quick for visual warnings, but requires private assignment/AFC data and cannot provide authoritative shared review state. Unsuitable for Beta.

## 4. Proposed authorization

Use the existing session-read contract rather than the broader SWAP ownership contract:

| Actor | Read scope | Mark reviewed / reopen |
| --- | --- | --- |
| ADFA/general/regular and existing administrator aliases/developer | Authorized academic-year sessions | Yes |
| ADC / LAB | Existing broad session-read scope | No in this first version |
| Faculty / HICC / VISC | Their own assignments and their own issues | No |
| Unknown/inactive/unlinked required profile | Denied | Denied |

For a faculty-scoped user, shared sessions must not reveal another instructor's AFC or assignment-quality issue. A personal overlap may show the conflicting course and time. Do not broaden HICC/VISC group authority. Re-evaluate the actor's current SQL profile on every read and write.

DTO fields are allowlisted: opaque issue/faculty keys, display names, course code, session IDs, authorized session date/time, conflict type, severity, review status, safe summary, version and navigation targets. Exclude UCID, email, canonical Faculty GUID, DOE, HR data, raw SQL/source payloads and AFC reasons/date ranges. An AFC item shows the affected session's date/time and `Unavailable`; it exposes no source absence detail. Filter options and counts obey the same scope.

**Owner decision:** ADFA-only review authority approved. ADC/LAB retain read access but cannot mark reviewed or reopen review.

## 5. Detection contract

Use canonical FacultyId internally; never match instructor names heuristically. Deduplicate mirrored pair findings using ordered source IDs. Multiple assignments to a session must not create a self-overlap or multiply a pair finding.

| Type | Evidence | Severity / display |
| --- | --- | --- |
| Instructor overlap | Same faculty, same valid date, two valid intervals with a.start < b.end and b.start < a.end | Conflict |
| AFC unavailable | Active unified AFC range contains the known session date | Conflict; safe Unavailable label |
| Duplicate assignment | Same non-null faculty appears more than once in a session | Conflict; retain separate source rows |
| Duplicate session assignment | Same faculty assigned to distinct sessions with the existing normalized session-duplicate key | Conflict; one duplicate finding replaces the generic overlap for that pair |
| Invalid or missing schedule | Null/invalid date or interval; end <= start; missing course or unresolved/unassigned faculty | Needs Review |
| Calendar working-activity overlap | Same faculty and day, verified per-day activity interval overlaps a valid session | Conflict |
| Calendar working time missing | Activity covers session date without verified per-day time | Needs Review |

Adjacent intervals are not overlaps. Missing/invalid times cannot establish a timed overlap. They produce a quality item, not a fabricated confirmed conflict. Independent evidence can coexist: a known AFC absence may still be a confirmed issue while that session also needs time review. Unknown dates are retained as undated quality issues within the selected academic year; do not invent dates or silently remove them through the default dated query.

Tasks remains a session-centered queue. This first version does not create activity-versus-activity tasks or change existing SWAP rules. Existing valid out-of-grid warnings remain as navigation warnings, clearly distinct from confirmed conflicts, and duplicate invalid-time cards are removed from the local legacy list.

## 6. Review state and concurrency

Current issues have two independent dimensions: evidence severity (Conflict / Needs Review) and review status (Unreviewed / Reviewed). A reviewed active issue remains in the default All/Active results, count and affected-session warnings. There is no dismiss/delete operation that suppresses it. The panel Close button only closes the panel.

Provide `Mark reviewed` and `Reopen review` for authorized administrators. Review does not mean resolved. Once source changes fix an issue it disappears from the active projection automatically. No resolved-history screen is required in this increment; the audit retains review actions.

Persist issue identity, source-evidence fingerprint, status, revision, actor and UTC timestamps in a narrow SQL table. Issue identity is deterministic from type and canonical source keys; public keys are opaque. Evidence fingerprints cover all relevant source revisions/values, including assignments and availability facts. A changed fingerprint resets the displayed status to Unreviewed. Fixing and later recreating an issue must not inherit an old acknowledgement: include relevant source version/change markers, not only the equal displayed values.

A review command supplies the issue key, expected evidence fingerprint and review version. In one transaction, reauthorize, rederive the issue against current source facts, compare versions, save review metadata and append an audit event. Appropriate source/key-range locks serialize against concurrent source mutation. A stale, resolved, missing or out-of-scope issue cannot be marked reviewed using an old screen; return a safe stale response and refresh. Concurrent review commands cannot overwrite one another silently.

Review writes use a dedicated default-off gate and narrow stored-procedure execution permission. No browser SQL writes, new runtime role membership, live gate enablement or db_owner exception is implied.

## 7. API and UI flow

Add a focused scheduling-task repository/API/runtime adapter following existing domain patterns. A read request requires an academic-year scope and supports bounded date/faculty/course/type/status filters, a page limit and opaque cursor. Validate all filter fields and limits; SQL filters/counts/pages after authorization. Undated items have an explicit filter option. Deterministic ordering uses severity, date and issue key. A changed source between pages requires refresh rather than claiming a complete stable snapshot.

Review POST performs the guarded command above. The response returns refreshed safe state and capabilities, never the underlying AFC or faculty record. Error responses are generic; stale responses explicitly ask the user to refresh.

Extend the existing All/Schedule/Requests sidebar. Add collapsible structured filters, severity/status badges and affected-session links; preserve SWAP detail navigation and all-week navigation. Keep the original pending-request list independent of schedule filters where appropriate and label which filters apply to scheduling issues. The Tasks count reports the authorized total, not only loaded page rows; expose pagination and partial-loading states honestly.

Refresh after session edits, assignment changes, SWAP application and review commands. Clear stale data on failed refresh, account change or logout; ignore late responses using request generations. An unavailable API must show Retry and cannot show a misleading conflict-free state. Keyboard operation, narrow-screen layout and readable labels remain part of acceptance.

## 8. Acceptance and delivery

Public-seam tests cover UI workflow, authenticated API policy/DTOs and actual disposable SQL behavior. Cases include overlap/adjacency, mirrored-pair deduplication, duplicate assignment, independent AFC evidence, cancelled AFC, missing/invalid/undated timing, unresolved identity, Calendar unknown/known times, filter/count/pagination scope, ordinary-faculty privacy, ADFA aliases, unauthorized review, stale source, concurrent review, source fix/recreation and logout/late responses.

Use synthetic fixtures only. Exercise real SQL source-change races and rollback in the disposable acceptance runner. Run root and server suites, browser acceptance and existing security regression lanes before completion claims. Do not modify unrelated UI, DOE policy, existing SWAP permissions or business data to make tests pass.

After implementation, obtain fresh independent product review, resolve findings, then separately review any immutable freeze promotion. Build and verify the same deployment artifact through existing tooling. PR99/98 must be accounted for when choosing review base and integration order. No merge or deployment is included in design approval.

## 9. Review checkpoint

Self-review: checked for complete requirements, separation of review from resolution, missing-data classification, privacy scope, concurrency, obsolete SWAP scalar reuse and live-operation boundaries. No implementation plan or product code has been created for Task02 yet.

Next: review the concrete sequential implementation plan in `docs/superpowers/plans/2026-10-15-scheduling-conflict-tasks-implementation.md` under the architectural workflow.
