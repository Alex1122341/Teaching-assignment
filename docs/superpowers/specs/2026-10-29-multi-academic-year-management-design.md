# PAWS Multi-Academic-Year Management — Product and Technical Design

**Status:** Proposed — requires Owner review before product implementation  
**Date:** 2026-10-29  
**First implementation target:** UCVM-Teaching-Assignment/Teaching-assignment (Testing repository)  
**Later integration target, only after Owner manual acceptance:** Alex1122341/Teaching-assignment-azure (Beta SQL)  
**Selected long-term storage approach:** one existing SQL Server database, strongly separated academic-year business records, common master data, immutable publication and archive history.

> This is a design, not authorization to change production data, deploy Firebase Lab, merge application code, or perform a Beta migration. The Testing site's default PAWS Frontend Demo uses browser-local synthetic records; that is not the University SQL runtime.

## 1. Purpose and acceptance outcome

PAWS must support concurrent work on the current and following academic years, while keeping annual teaching assignments and DOE independent; carrying forward only the correct kinds of master data, historical references, and eligible annual roles; publishing courses individually; keeping confidential planning drafts away from faculty; and allowing the Owner to archive and restore completed years without data loss.

The primary scenario is to continue normal 2026-27 use while ADFAD and authorized course offices plan 2027-28. Faculty must not lose previously visible assignments or DOE in the migration. They may look up their historical Published Teaching and DOE, but not a retired year's Calendar.

A successful implementation proves:
1. Each relevant API, UI query, write, report and export uses an explicit authorized academic-year and publication scope.
2. New years can be prepared without altering the prior year or automatically copying sessions or faculty assignments.
3. Publication is per course, with revisioned Working and immutable Published histories; only an expressly authorized course publisher can publish.
4. Working and Published DOE are separately calculated; initial DOE publication is independent; approved Published assignment changes thereafter refresh the published calculation while preserving manual overrides.
5. Archived years are read-only at the trusted data boundary. Historical Faculty DOE and Teaching remain available; archived Calendar is not exposed to Faculty.
6. Exact synthetic 2026-27 migration leaves Faculty-visible data unchanged.
7. The Testing implementation and evidence remain isolated; Beta SQL work starts only after Owner acceptance.

## 2. Agreed business decisions

### Academic year and master data
- Canonical academic-year key: YYYY-YY; 2026-27 is 2026-05-01 through 2027-04-30 inclusive; 2027-28 is 2027-05-01 through 2028-04-30. Date ranges should use inclusive starts and exclusive next-May-1 ends internally.
- A global Faculty master record and one shared Course Catalog serve all years. A Catalog edit changes future-created annual Course snapshots, never an already-created year's Course Code/Title snapshot.
- Shared AFC absence/availability and identity data support current conflict checks across all open years.
- Year-specific Course rows are created manually by selecting the shared Catalog; do not auto-create the next year's Course, Session or Faculty Assignment.
- DOE policy from a prior year is copied into the new year as an unapproved Draft. No automatic activation or carry-over of calculated DOE, manual overrides, annual allocations or annual teaching.
- ADFAD may view last year's Published teachers at Course level and Session-matching level, and may copy a historical Published assignment after confirmation. Unpublished Working changes remain internal reference only, never the default copy source. Copy does not mutate history and must flag ineligible faculty/conflicts.

### Visibility and publication
- While a new year is being planned, its unpublished content is visible only to authorized planning roles.
- A Faculty user can see the new year's own and otherwise authorized Published course records, not unpublished drafts.
- Course publication is independently controlled for each annual Course. A Published Course can accumulate new Working changes. Faculty continue seeing the last Published version until Publish Changes.
- An authorized Course owner/lead may publish their explicitly scoped Course. Broad titles (ADC, LAB, HICC, VISC) or a simulated Demo role switch do not themselves grant every Course's publication right. The existing final-assignment approval workflow is not bypassed by publication authority.
- DOE initial release is separate from Course publication and requires an approved annual DOE Rule Book. Before DOE publication, Faculty see DOE Pending even if a Course is Published.
- ADFAD can compare Working and Published DOE; Faculty see only their Published DOE.
- Once initial annual DOE has been released and the active annual policy is approved, a newly Published assignment causes the corresponding Published DOE to recalculate and synchronize automatically, with an immutable calculation receipt.
- Manual DOE overrides are never deleted or silently changed by recalculation. Recompute the base amount, retain the existing effective override, and flag Needs ADFAD Review.

### Role and appointment rollover
- Annual roles terminate at the academic-year boundary. They are separate per-year records.
- A role held continuously for the entire preceding year qualifies for automatic continuation into the next full year only when the linked Faculty's employment/appointment standing and next-year eligibility are valid.
- A partial-year, irregular, special, expired, missing or ambiguous appointment produces a proposed next-year Draft requiring ADFAD confirmation.
- Annual role DOE is calculated under that year's approved DOE policy. No previous-year DOE number is silently reused.

### Archive and restore
- Only the explicit Owner authority may Retire or Restore an academic year. The Technical Developer role and ADFAD General alias are not automatically equivalent to Owner for these two actions.
- Retire displays outstanding/unpublished matters; Owner can confirm anyway. Published records are the official archived result; unpublished Working Drafts are preserved as restricted internal evidence.
- Archived year is strictly read-only for all roles, including Owner, across API, import, bulk replacement, scripts and background jobs, until Restore.
- Retire creates an immutable conflict-check snapshot with relevant source identities, times, result statuses and review evidence. Shared AFC remains editable for other years, and subsequent AFC changes do not rewrite archived conflicts.
- Restore re-enables permitted work and recalculates Conflict Check against the latest AFC; original archived snapshots remain immutable and accessible to authorized auditors.
- Faculty retain access to their own historical Published Teaching and DOE, but **not the archived Calendar**. Authorized ADFAD, ADC and LAB may view archived Calendar read-only and within their scope.

### Default landing and year selector
- Calendar remains the normal home screen for everyone.
- Faculty default to the current real-world academic year. Planning roles remember their last authorized selection, otherwise use a safe current-year fallback.
- One clearly visible year selector is shared by Calendar, Assignment, DOE and Dashboard. A Faculty selecting a retired year must be offered Teaching/DOE history but no archived Calendar.
- Server authorization, not the year selector or hidden UI buttons, decides read/write eligibility.

### Initial 2026-27 migration
- Take an immutable snapshot of the exact teaching assignments already visible to Faculty as the initial 2026-27 Published release, plus a separate initial Working version. Do not change Faculty-visible assignment content.
- Treat currently visible DOE as initial Published DOE, preserve manual overrides, and keep non-public DOE internal.
- Preserve existing change history and source provenance; distinguish a migration receipt from a user-made assignment change.

## 3. Approaches and selection

| Option | Benefit | Cost / reason not selected |
| --- | --- | --- |
| **A — One SQL database with shared masters, year-owned records and immutable releases** | Existing University SQL operational model; strong relational constraints; simpler cross-year history/reporting and shared AFC | Requires a consistent year key, backend authorization checks, immutable release data and migration |
| B — Separate SQL schema per year | Physically clearer namespace | Repeated DDL, cross-year queries/migrations and catalog synchronization become complex |
| C — Separate database per year | Maximum administrative database separation | Cross-database transactions, shared AFC, reporting, versioning and maintenance burden |

**Owner selected A.** This is the target Beta architecture, *not* an instruction to connect the Testing website to VetMed-Ops SQL.

## 4. Existing Testing repository and compatibility observations

This design builds on, rather than replaces, current mechanisms:

| Component | Current location / observation | Required change |
| --- | --- | --- |
| PAWS Testing UI | frontend/, scripts/timetable.js, dashboard pages | Global academic-year selector, per-year views, Course publication states, historical access |
| Default PAWS Demo | tools/pages-demo-api/, repos/core.js, store.js | v2 synthetic multi-year store; enforce equivalent domain checks; persist only in the local browser |
| Existing year handling | server/src/data/academic-year.js has a default of 2026-27; various UI and scripts embed it | Replace runtime defaults with explicit year context; retain input normalization and reject malformed years |
| TA workflow API | server/src/teaching-assignment/teaching-assignment-api.js currently publishes by academicYear and requires ADMIN | Extend to course-scoped publication and authenticated exact course publisher capability; retain finalization/approval checks |
| Ported SQL publication foundation | database/azure-sql/020_teaching_assignment_workflow.sql and sql-teaching-assignment-workflow-repository.js use current release state by academic year | Beta migration should extend to per-course pointers/releases; do not destroy old releases |
| DOE lifecycle | server/src/doe/doe-api.js, policy service, Demo DOE repositories | Explicit Working/Published calculation source, policy approval, initial release and automatic subsequent recalculation |
| Firestore Lab | firebase/firestore.rules, docs/database/SCHEMA.md | Separate optional real-Firebase acceptance lane; avoid client-authoritative DOE policy or published snapshots |
| Existing test guidance | docs/architecture/testing-environments.md, docs/security/role-matrix.md, docs/acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md | Add multi-year cases with Demo vs trusted-backend evidence separated |

The code locations above are current design inputs, not proof that the full requested capabilities already exist. In particular, the default PAWS Demo has no production SQL, and its simulated role picker is not secure authorization. Existing workflow and SQL references must be re-reviewed at actual implementation SHA.

## 5. Conceptual architecture

### Components
1. **Common domain services:** AcademicYearService, AnnualCourseService, PublicationService, AnnualRoleRolloverService, DoeProjectionService, ArchiveService, HistoricalTeachingService, ConflictSnapshotService.
2. **Scoped capability resolver:** Given verified actor + annual Course + appointment/effective responsibility, decide exact permissions. UI receives authorized capabilities, not raw private role directories.
3. **Repository adapters:** Testing Demo adapter (synthetic browser-local), optional restricted Lab/trusted test adapter, and later Beta SQL adapter. Domain inputs/outputs and failure types are shared.
4. **Immutable publication/archival journal:** Revision, data content/version, actor, timestamp, source provenance and hashes; pointers select active Published release without rewriting older releases.
5. **Read projections:** Separate Faculty, office and Owner projections, each narrowing years, Course scope, privacy and draft visibility at the server/trusted boundary. Demo implements the *same behavior* for UX testing but is not security proof.

### Data flow

~~~mermaid
flowchart TD
  U[Verified role and exact course scope] --> Y[Academic-year context and lifecycle]
  Y --> W[Working sessions and assignments]
  W --> F[Approved finalization gate]
  F --> P[Publish course transaction]
  P --> R[Immutable published course release]
  R --> D[Published DOE calculation on approved policy]
  W --> DW[Working DOE projection]
  A[Shared AFC facts] --> C[Live conflicts for open years]
  A --> S[Snapshot at year retirement]
  S --> H[Immutable archived evidence]
  R --> T[Faculty historical teaching]
  D --> DH[Faculty historical published DOE]
~~~

A Course publication must not expose a half-updated snapshot/DOE combination. In Beta SQL, version pointer, released lines, DOE recalculation receipt, overrides/review flag and audit commit atomically where possible. If a requested publication cannot satisfy its approved source or idempotent receipt, reject without partially publishing.

## 6. State machines

### Academic-year lifecycle
- **Planning**: editable by authorized staff; unpublished annual Course content hidden from Faculty. A specifically Published Course may be shown to Faculty even before the academic year starts.
- **Active**: editable by authorized staff; same per-Course publication semantics. Active is a work lifecycle marker, not a shortcut that publishes all Courses.
- **Archived**: all year-owned writes denied; historical Published and restricted Draft reference available under role policy.
- **Restored**: returns to Active (unless a later Owner-defined Planning restoration policy is introduced); restore is a new journal event, not a deletion of Archive evidence.

Year lifecycle is independent of individual Course publish state and of DOE policy version status. Archive is Owner-controlled; never automatically archive solely because the date crossed May 1.

### Annual Course
- Draft: never published; only authorized planners see it.
- Published: has a current immutable published release. Working content may diverge. Status is **Published / Changes Pending** where appropriate.
- Publish Changes creates a new release and atomically advances that specific Course's published pointer.
- No arbitrary Session-level public releases; publication is at the annual Course level and includes all approved published teaching data necessary for a self-consistent course view.

### DOE
- New-year policy Draft copied from prior year, with distinct new-year policy identity and provenance.
- Working DOE is a recalculated preview from Working assignments and the applicable draft/approved annual policy; never a Faculty-facing official value.
- First Published DOE requires approved rules and explicit ADFAD release.
- After first release, Course Publish Changes triggers recalculation only from the newly Published assignment and approved policy. If no approved active policy is present, do not invent DOE; leave Faculty DOE Pending and flag an exception to the publisher.
- Recalculation preserves manual override amount, reason, actor and validity. The calculated/base value changes, effective override remains, and review becomes Needs ADFAD Review.
- Each calculation record stores year, published course release inputs, policy version, calculation engine version, result, override disposition and audit data.
- A change to Draft DOE rules never changes Published DOE.

## 7. Logical data model (SQL target; adapt to existing table schema)

These are conceptual names/relationships, **not executable DDL**; inspect existing paws.* objects and create additive migrations rather than dropping canonical tables.

| Entity | Scope / keys | Required properties |
| --- | --- | --- |
| AcademicYear | unique AcademicYear | StartDate, EndExclusive, State, Created/Retired/Restored actor/times, RowVersion |
| Faculty / User identity | global FacultyId / verified UID | Active status, employment and scoped appointments, role resolution |
| CourseCatalog | global CatalogCourseId, unique canonical CourseCode | Current Title, catalog metadata, audit/revision |
| AnnualCourse | unique (AcademicYear, CatalogCourseId) | Frozen Code/Title snapshot, annual configuration, CurrentWorkingRevision, CurrentPublishedReleaseId |
| AnnualSession / SessionAssignment | annual Course + SessionId | Working fields, exact AcademicYear and annual Course FK, assignment evidence, revisions |
| CoursePublicationRelease | immutable ReleaseId and (AcademicYear, AnnualCourseId, ReleaseNumber) | Source Working revision, approved finalization reference, actor/time, hash and content/source metadata |
| PublishedSession / PublishedInstructor | immutable ReleaseId children | Session identity, complete published time/topic/type, instructor and teaching credit at release |
| DoePolicyVersion / DoeCalculation | year + version | Draft/Approved state, policy hash, Working/Published source kind, input release references |
| DoePublicationState / DoePublicationReceipt | year and faculty/publication scope | Initial DOE release marker, current published result, source receipts; no public Draft fallback |
| DoeOverride | (AcademicYear, FacultyId, OverrideId) | Manual value, reason/notes, version, actor/time, review state |
| AnnualRole | (AcademicYear, RoleAssignmentId) | Dated role/appointment, status Draft/Confirmed, rollover source, eligibility evidence |
| AfcRecord | global FacultyId and effective dates | Privacy-protected source, revisions; no annual duplication |
| ConflictArchiveSnapshot | immutable Year + ArchiveEventId | Sanitized exact result and evidence refs, source revision hashes, created timestamp |
| AnnualArchiveEvent / AuditEvent | immutable event id | Actor, year, operation id, prior/new state, release/draft inventories, changes/provenance |
| UserYearPreference | UID | Last authorized year, revision; never treated as access permission |

**SQL invariants:**
- Use canonical YYYY-YY at boundaries. Reject wrong/missing year on year-mutating APIs rather than silently falling back to 2026-27.
- Composite year-aware foreign keys or authoritative year equality verification protect Session, Course, Assignment, finalization, DOE, publication and report joins.
- One current published pointer per AnnualCourse, referencing only a matching-year immutable release. Historical releases are append-only.
- Unique operation/request IDs provide idempotent Retire, Restore, Publish, DOE publication, rollover and migration. Expected revisions reject stale clients (409).
- SQL database denies updates to immutable release, snapshot and audit rows by application roles. Scoped stored procedures/API transactions enforce archived read-only at write boundary, including imports and background jobs.
- Authorized Faculty reads select their own Published projection and omit archived Calendar, private AFC, other Faculty DOE and Working Draft fields. Do not rely on front-end hiding.
- Selective indexes on (AcademicYear, AnnualCourseId), (AcademicYear, FacultyId), publication pointers, effective dates and archive history; test plans under realistic dataset sizes.
- Do not duplicate full AFC or Faculty records per annual Course. Historic values needed to substantiate audit/conflict evidence are captured in minimal immutable snapshots with access policy.

## 8. Testing repository adapter plan

### PAWS Frontend Demo (first fully interactive review)
- Increment browser-local store schema from v1 to a separately versioned v2; provide a deterministic, idempotent synthetic-v1 upgrade and Reset control. Avoid overwriting existing demo state silently.
- Keep synthetic users, faculty, courses, sessions and AFC. Add Years, AnnualCourses, publication release history and pointers, DOE policy/release state, role rollover proposals, immutable archive events and conflict results.
- Seed at least 2026-27 with Published snapshots and 2027-28 with no annual Courses/Sessions/Assignments; catalog is shared. Create synthetic eligibility anomalies and a course with pending publication changes.
- Expose role-conditioned Calendar / Dashboard / Teaching History / DOE views. A role toggle is a presentation simulation only.
- Use the existing PAWS Demo API/repository boundary and test suites. No direct calls to University SQL, production Firebase, privileged APIs or real accounts.
- Preserve other current demo features and the approved role/scope policies. Tests must cover simultaneous years, switching in all pages, refresh, local storage upgrade and Reset.

### Firebase Lab (optional separate later validation)
- Only the explicitly selected vista-teaching-lab project; no staff originals.
- Consider year-path and release-collection projections but do not put authoritative DOE policy publication or high-privilege archive mutations in browser-accessible rules. Use reviewed trusted admin tooling for such actions.
- Test Firestore rules with emulator identities, negative cross-year and archived-write cases. Where a trusted path does not yet exist, label acceptance **Blocked**, not Passed.
- Do not automatically publish Firebase Lab or alter manual workflow configuration as part of the default Demo implementation.

### Beta SQL (after signed-off Testing manual acceptance)
- Reinspect live schema, published release mechanics and current write gates. Prefer additive SQL migrations and compatible API changes.
- Maintain release/runbook discipline, data backup and row-count/hash preservation. No direct data copy from synthetic Testing fixtures into VetMed-Ops.
- Prove SQL constraints, transactional publication/DOE, role authorization, archive restrictions, version conflict, recovery and Beta UI parity in isolated Stage before Live.
- Beta's current TeachingAssignmentPublicationState is year-wide; evolve to Course-scope pointers without deleting prior year-wide release evidence. Establish an explicit compatibility/migration rule for older releases before cutover.

## 9. API/capability contract (design-level)

Actual routes may follow the existing HTTP adapter naming; semantics are normative:

| Operation | Actor / guard | Behavior |
| --- | --- | --- |
| GET years/capabilities | All ready authenticated actors | Return only authorized years and per-year read/write/publication capabilities, not raw access tables |
| POST years | Owner / explicit year-create capability | Create one Planning year, draft DOE rules, eligible annual roles; never auto-copy Course/Session/Assignment |
| GET catalog and annual-courses | Authorized roles | Global catalog plus year-specific title snapshots; Faculty sees Published only |
| POST annual-courses | Scoped planning role | Explicitly select Catalog ID, create one annual Course snapshot |
| GET course / GET course/diff | Scoped planning publisher | Working vs current Published, pending approvals, affected Faculty/DOE, conflicts |
| POST course/publish | Verified exact Course publisher; current finalization; expected revision | Create full immutable annual Course release, advance pointer, trigger published DOE recalc if already enabled; idempotent |
| GET teaching/history | Faculty self or scoped office | Authorized Published teaching and archived year reference; no Working leakage |
| GET doe/compare | ADFAD only | Working and Published calculations, source policy/release, override and review differences |
| POST doe/initial-publish | ADFAD DOE authority + approved policy | Establish first official published DOE and records |
| POST years/{year}/retire | Explicit Owner only, expected revision and confirmation receipt | Present issues, freeze immutable year state and conflict snapshot; no draft promotion |
| POST years/{year}/restore | Explicit Owner only, expected revision | Reactivate year, recompute live conflicts, preserve all archive snapshots |
| GET archived/calendar | Authorized office only | Archived view is read-only; Faculty receives 403/hidden projection, including export paths |
| POST years/{year}/roles/rollover | Owner or explicitly authorized ADFAD year-creation process | Idempotent next-year proposals, only full-year + validated status auto-confirmed |

Publisher behavior:
- Authentication alone is insufficient. Resolve actor's exact annual Course responsibility/effective dates; a Lab-wide or HICC-wide label cannot publish arbitrary Courses.
- Publishing is **not** permission to bypass ADFAD final teaching assignment decisions. A proposed assignment not yet finalized via its required approval path is not an eligible publish input.
- Explicit approval evidence and source fingerprints must still be current at commit time; recheck AFC and conflicts and surface warnings or blocking business rules consistently with existing governance.
- A published release may contain no assigned Faculty only when that outcome is knowingly permitted by the existing finalization rules; never invent a faculty identifier.
- Return published release ID, revision, date, affected scope, DOE sync status and audit receipt.

Recommended stable failures: invalid year (400), unauthenticated (401), forbidden/wrong course/archived Calendar (403), missing year/course (404), stale revision / archived write / policy not ready (409), invalid approval or conflicts (422), source unavailable / trusted DOE job blocked (503). Map these to existing HTTP conventions.

## 10. Detailed workflows

### Create 2027-28
1. Owner selects Create Academic Year 2027-28.
2. Server validates normalized year range and uniqueness, and creates Planning year.
3. Clone current/reference prior-year DOE Rule Book into an unapproved **Draft** with provenance.
4. Evaluate 2026-27 Role intervals and next-year Faculty eligibility. Confirm full-year valid entries; put all partial/anomalous entries into Draft ADFAD queue with reasons.
5. Do not create annual Courses, Sessions or Assignment records; Catalog and AFC remain shared.
6. Return creation/rollover counts and actionable Draft queue, with an idempotent receipt.

### Plan and publish VTMD 306
1. Authorized planner selects annual year 2027-28 and VTMD 306 from shared Catalog; annual Code/Title snapshot is created.
2. Add sessions and proposed assignment. Historical reference defaults to previous year's Published Course/Session teacher and provides a confirm-first copy action.
3. Scope-specific edit/review/finalization workflow remains in force.
4. Verified Course publisher sees Working vs current Published diff, latest approvals and conflicts.
5. Publish commits entire Course's approved snapshot and creates release R1. Faculty now see R1 only. If 2027-28 DOE Rules remain Draft, DOE displays Pending.
6. A later Working edit does not change Faculty view. Publish Changes commits R2, and if DOE already initially published with an approved policy, its calculation updates automatically (manual override preserved and flagged).
7. ADFAD compares Working and Published DOE and verifies release history.

### Retire 2026-27
1. Owner opens retire preview: current release pointers, unpublished changes, missing DOE/policy, outstanding approvals, conflicts, and affected data counts.
2. Preview includes expected Year revision and a digest of its evidence; Owner acknowledges any outstanding issues.
3. Retire transaction verifies preview still current, records immutable archival event and AFC/conflict snapshot, changes year state to Archived and blocks all year-owned mutations.
4. Faculty can access own historical published teaching/DOE, but archived Calendar is blocked. Authorized offices can read archived Calendar and internal Draft for audit.
5. Shared AFC continues changing for open years; archived conflict result remains exact.
6. Owner Restore writes a new event, returns year to editable state, recalculates current conflict against latest AFC and retains original archive event intact.

### Initial 2026-27 migration in Testing
1. Inventory synthetic v1 visible Faculty records and record sorted, privacy-safe hashes of user-visible Teaching and DOE projections.
2. Build initial Published Course release(s) matching *exactly* those records; create independent Working records. Preserve historical identity, manually overridden DOE and audit.
3. Record one idempotent migration receipt and preserve legacy-compatible read API responses until all views switch.
4. Compare Faculty output before and after by actor and content; no newly visible private fields, dropped rows or altered DOE.
5. If validation fails, keep previous version active and allow deterministic rollback of the testing adapter without deleting historical audit; no partial switch.
6. Repeat full migration strategy under an approved, backed-up SQL Stage procedure for Beta; do not treat a Demo run as proof of real migration safety.

## 11. UI and access contract

- Header/global Year Selector displays readable labels, e.g. 2026-27 Current, 2027-28 Planning, 2026-27 Archived, subject to the user's permitted views.
- Work roles may remember last selected year. Revalidate the remembered value on every session; inaccessible/removed/archived-for-Calendar values must fall back safely.
- Faculty default Calendar always targets the current May-Apr academic year. A future Published Course may be reached through the authorized year selector, but an empty Draft future year is not presented as an available Faculty planning view.
- Annual Course list displays Draft / Published / Published with Changes Pending status. Publish Changes is visible only for exact scoped publishers, after mandatory review conditions.
- DOE worksheet for ADFAD has Working vs Published selector and differences. Faculty's DOE is always their own Published value or Pending, never a fallback to Working.
- Historical Teaching and DOE have a year-filtered entry from the Faculty profile/dashboard; archived Calendar is unavailable to Faculty via navigation, direct URL, API or export.
- Owner-only Archive and Restore dialog previews consequences and request ID; controls cannot trigger accidental archival on a normal form submission.
- Explicit source versions and approval statuses must be visible where decisions are made, without exposing other Faculty's private DOE/AFC reasons.
- Screen changes preserve PAWS Constitution: Calendar home, last-name-first-name formatting and existing navigation accessibility.

## 12. Acceptance matrix and release gates

| ID | Human/automated scenario | Expected result | Lane |
| --- | --- | --- | --- |
| MY-01 | Create 2027-28 twice | One new Planning year, idempotent receipt | D; backend later |
| MY-02 | View Catalog after title edit | Old annual snapshot unchanged; new annual Course has latest name | D |
| MY-03 | Inspect initial next-year state | DOE policy Draft; Course/Session/Assignment empty; AFC shared | D |
| MY-04 | Course and Session historic copy | Published instructor suggested; explicit confirmation; Working-only instructor never auto-copied | D |
| MY-05 | Wrong Course publisher tries Publish | Denied; no visible release, no audit misattribution | D UI; B security |
| MY-06 | Scoped publisher with final approval | Publishes exactly their Course, not entire year | D; B transaction |
| MY-07 | Edit Published course without republishing | Faculty still sees prior release; Working diff visible only to planner | D |
| MY-08 | Course Published, DOE Rule Draft | Teaching visible to Faculty; DOE Pending; internal preview still works | D |
| MY-09 | Initial DOE publish after policy approval | Faculty published DOE appears only after explicit initial release | D; B policy |
| MY-10 | Later Published Assignment changes | Automatic published calculation refresh without deleting manual override | D; B transaction |
| MY-11 | Override and calculation disagree | New base and unchanged override, Needs ADFAD Review, correct published effective value | D |
| MY-12 | Annual role rollover | Eligible full-year/valid person auto-confirmed; partial/invalid goes to ADFAD Draft | D |
| MY-13 | Faculty opens archived Teaching and DOE | Own published historical data available; no private data leaked | D; B privacy |
| MY-14 | Faculty opens archived Calendar direct URL/export | Denied, including backend/export; authorized office read-only works | D; B security |
| MY-15 | Retire with unpublished changes | Owner warning; Published remains official; Working preserved internal | D; B archive |
| MY-16 | Non-owner Retire/Restore attempt | Denied; Year unchanged | D; B security |
| MY-17 | AFC changes after retirement | Archive snapshot unchanged; active year recalculates from latest AFC | D; B |
| MY-18 | Restore retired year | Live conflicts recomputed; archive snapshots immutable; drafts still drafts | D; B |
| MY-19 | Year selector for each role | Faculty current-year default; planning roles' last authorized year | D |
| MY-20 | 2026-27 migration parity | Faculty-visible Teaching and DOE (including overrides) identical before/after | D; B before Beta |
| MY-21 | Concurrent publish / replay | Stale revision rejected; retry with same operation id returns same release | D; B transaction |
| MY-22 | Year-spoofed queries and joins | No cross-year record leakage; malformed year rejected | D; B |
| MY-23 | Existing features and regressions | Calendar, Dashboard, AFC, SWAP, reports, history, export and source provenance unaffected | Existing suite |
| MY-24 | Tested artifact provenance | Exact PR/SHA and Demo/Lab/Backend lane recorded, with actual screenshot/evidence | Release |

All manual cases start Not Run. Maintain the existing JSON case catalog, Markdown and downloadable checklist in sync when implementing. Browser-local simulated access tests are *not* sufficient to mark SQL or Firebase rules as Passed.

### CI and test evidence required
- Root npm test plus npm run test:all, static build, exact PAWS Pages staging and browser smoke against the tested artifact.
- Targeted unit tests for state machines, year boundaries, course publisher scope, release pointer, DOE source version, override preservation and archive denial.
- Deterministic synthetic fixture and v1-to-v2 upgrade tests.
- When real Firebase rules/storage changes exist, run Auth/Firestore emulator tests. No temporary weakening of rules.
- Beta after Owner acceptance: isolated SQL transaction tests, permissions/denial tests, backup/restore rehearsal, data reconciliation and Stage end-to-end, then separately approved Live deployment.

## 13. Release sequence, dependencies and rollback

**Stage T0 — Design approval (this document).** Owner reviews intended semantics, explicit proposals and evidence. No product changes yet.

**Stage T1 — Testing domain / store migration.** Introduce canonical year lifecycle, annual entities, v2 synthetic upgrade and fixtures with no change to Beta.

**Stage T2 — Testing workflows and UI.** Global year selector; annual Course creation; historical teaching; course publication; Published/Working DOE; role rollover; archive/restore; role-protected historic views.

**Stage T3 — Testing acceptance.** Run automated and human checklist. Fix all critical issues on Testing branch, verify exact SHA/site banner, collect Owner go/no-go. Do not auto-merge or port based only on a green demo build.

**Stage B1 — Beta design gap check.** Compare Testing domain contracts with the actual Beta SQL schema, current release tables and authorization version. Produce additive DDL/backfill/rollback plan and an exact existing Faculty-visibility snapshot.

**Stage B2 — Beta Stage.** Deploy SQL migrations/API/UI under guarded release; run real auth and scope denials, transactional publication, DOE and archive tests, and exact 2026-27 parity.

**Stage B3 — Beta Live.** Only after separate human authorization, take verified backups/snapshots, apply reversible compatibility-first changes, check gates/health and monitor. Freeze/roll forward safely on failure; never delete historical release evidence.

No automatic Beta transfer, SQL DDL execution, Firebase Lab publication or University production-data access is authorized by this design.

## 14. Risks, mitigations and compatibility notes

1. **Existing year-wide publication:** The ported teaching-assignment API and SQL publication state are year-based. Per-Course publication needs new capability and pointer semantics, not a superficial UI filter or overwrite of old releases.
2. **DOE source correctness:** Some calculators and mappings name 2026-27. Audit hard-coded year references and make the effective annual policy and source version explicit; do not reuse 2026-27 rule values for 2027-28.
3. **Owner versus privileged technical role:** Legacy owner aliases may normalize to adfa_general while Developer also has broad rights. Define Owner-only archive capability from the verified user authority, not generic isGeneralRole.
4. **Cross-year data privacy:** Global AFC and Faculty enable linked views, but must never let ordinary Faculty browse colleagues' DOE, identifiers, absence reasons or unapproved drafts.
5. **Atomic publication:** If DOE sync or a release-line insertion fails after advancing a public pointer, Faculty could see inconsistent published data. SQL needs transactional handoff and idempotent recovery.
6. **Year crossover:** May 1, leap dates, overnight/end-date sessions, imported year labels, academic-year omissions and effective appointments must be tested exactly.
7. **Archive versus audit:** No hard deletion, backdating or in-place rewrite of archived publications. If policy later requires corrections, Owner Restore creates new events; prior snapshots remain.
8. **Demo versus real storage:** The default demo can satisfy interface and deterministic business-logic acceptance, but cannot prove multi-user persistence, backend permissions, real email or SQL operations.
9. **Pre-existing UI differences:** Source trees web/ and frontend/ are not interchangeable; changing a legacy file alone may not change the active PAWS Pages site.
10. **Current data provenance:** Real 2026-27 Beta records have their own historical publication and DOE provenance; never assume synthetic testing identifiers or numbers are production identities.

## 15. Explicit design choices versus remaining implementation verification

**Owner-decided:** All product behavior in section 2; selected SQL approach A; Testing repository first, Owner tests, Beta only afterward.

**Proposed implementation choices to approve with this design:**
- A yearly lifecycle of Planning / Active / Archived, with per-Course releases independent of the year state.
- Immutable full Published Course release snapshots, revisioned course pointers and non-destructive retained Working.
- Strict Course publisher authority *subject to existing finalization and required approvals*; publication does not itself confer assignment final-approval authority.
- Historical self-service DOE/Teaching projections rather than exposing retired Calendar collections.
- Demo v2 synthetic adapter with a safe upgrade; optional later Lab lane only when trusted operations exist.
- Atomic Beta published assignment + DOE synchronization, immutable archive/release receipts and existing-version-preserving SQL migration.

**Verify during implementation, do not guess:**
- Exact current schema/table and API signatures for annual Course, working finalization, policy and scope membership.
- Existing formal Owner identity and Course publisher responsibility model; make capability resolver fail closed if absent.
- Which existing DOE fields are Faculty-visible, and their initial migration parity and provenance.
- Existing calendar/rotation/report/CCC entrypoints that could bypass the year and archive filter.
- Which trusted service can drive any optional Firebase Lab policy or archive operations.
- Operational export, source, backup and migration compatibility across the actual Beta SQL build.

## 16. Review and approval

This design is complete for review, but **not yet approved for implementation**. The next step is Owner approval of these named proposed design choices. Once approved, write a detailed implementation plan for the Testing repository and carry out application work in a feature PR; preserve Beta unchanged until Owner manual acceptance of the Testing build.
