# PAWS Azure SQL Cutover Design

Date: 2026-09-24
Status: Approved architecture; implementation gated by written-spec review
Repositories:
- Primary application: `Alex1122341/Teaching-assignment`
- Azure release line: `Alex1122341/Teaching-assignment-azure`

## 1. Goal

Move the PAWS Azure beta from Firestore-backed business persistence to Azure SQL while keeping Firebase Authentication only.

The three workbooks supplied on 2026-09-24 are the sole authoritative initialization source for this cutover:

1. `PAWS_Faculty_Workload_Normalized.xlsx`
2. `AFC Tracker Lookup (1).xlsx`
3. `Partial Faculty Master List - September 21, 2026.xlsx`

No Firestore comparison, reconciliation, or backfill is part of this migration. Existing Azure business data must be removed before the authoritative import so stale mirror data cannot contaminate the new database.

The target runtime is:

```text
Azure Static Web App
        |
        | Firebase ID token
        v
Azure App Service / PAWS Node API
        |
        | Microsoft Entra / managed identity
        v
Azure SQL
  staging.*   full import provenance/raw rows
  paws.*      authoritative application data
```

Firebase remains responsible for sign-in, sign-out, password reset, user UID, and ID-token issuance. Firestore is not used for PAWS business reads or writes after cutover.

## 2. Scope and delivery decomposition

This migration is intentionally divided into four independently reviewable subprojects.

### Phase 1 — Azure SQL clean rebuild and authoritative workbook import

Owned primarily by `Teaching-assignment-azure`.

Deliverables:
- deterministic workbook parser and import manifest;
- full raw preservation of every non-empty workbook row;
- typed staging tables for business-source sheets;
- relational `paws.*` schema foundation;
- controlled clean reset of existing PAWS user-created database objects;
- transform/validation pipeline;
- import count, FK, checksum, and anomaly reports;
- no application cutover yet.

### Phase 2 — PAWS Node API Azure SQL adapter

Owned primarily by `Teaching-assignment`.

Deliverables:
- Azure SQL connection layer using App Service managed identity;
- Firebase Admin used only to verify ID tokens;
- `paws.UserProfile` lookup replaces Firestore `users/{uid}`;
- Azure SQL repository implementations for identity, faculty, scheduling, AFC, roles, workflow, audit, and DOE;
- existing DOE calculation semantics remain unchanged.

### Phase 3 — Frontend Firestore removal

Owned by `Teaching-assignment`, promoted to the Azure release repository after complete test acceptance.

Deliverables:
- shared authenticated PAWS API client;
- all business `firebase.firestore()` / collection/document reads and writes removed;
- UI behavior preserved or improved;
- Calendar derived from canonical Session data;
- My Changes uses unified API audit results;
- automated shipped-runtime guard forbids Firestore business access.

### Phase 4 — Azure cutover and baseline promotion

Owned by both repositories.

Deliverables:
- API deployed and health/auth/data smoke tests pass;
- authoritative SQL import is current;
- Azure frontend runtime promoted through a reviewed frozen-baseline move;
- browser acceptance succeeds;
- zero Firestore business access confirmed;
- rollback evidence retained.

No phase may silently bypass the Azure beta freeze or deploy unreviewed runtime changes.

## 3. Current Azure resources and safety boundary

The existing lab resources are retained:

- SQL server: `ucvm-teaching-lab-xz-20260911.database.windows.net`
- database: `teaching-assignment-lab`
- Azure Static Web App: existing PAWS Azure beta host

The clean rebuild applies only inside the `teaching-assignment-lab` database to PAWS user-created application objects.

The migration must not delete or modify:
- the Azure SQL logical server resource;
- Azure subscription/resource group;
- Microsoft Entra administrator configuration;
- server-level firewall/network configuration;
- Azure system databases;
- system schemas or system objects.

The database reset must remove old PAWS application/mirror objects, including legacy `dbo.FirestoreDocument` and `dbo.FirestoreImportRun`, after preflight has proven the import package is complete.

## 4. Source workbook inventory

Observed source counts are:

| Workbook / sheet | Non-empty data rows |
| --- | ---: |
| Workload / Faculty Overview | 118 |
| Workload / Teaching Assignments | 4,974 |
| Workload / Role Assignments | 162 |
| Workload / Courses | 43 |
| Workload / DOE Rules | 24 |
| Workload / Account Roles | 14 |
| Workload / PAWS Schema | 20 |
| Workload / README | 14 |
| AFC / AFC records | 798 |
| AFC / Lookup | 86 |
| AFC / CODE | formula/helper sheet |
| AFC / Data | 222 |
| AFC / KK duplicate Lookup (2) | 100 |
| Faculty Master / Key | 116 business rows (+ 1 formula summary row preserved in raw staging) |
| Faculty Master / Education & Experience | 116 |
| Faculty Master / Joint Appointments | 14 |

The importer must preserve every non-empty row from every sheet, including helper/documentation sheets, in generic raw staging. Only the named business-source sheets feed `paws.*` transformation.

### Known source anomalies

Faculty Master:
- 116 Faculty records;
- `Key!A119` is a workbook summary formula (`=COUNTA(A2:A117)`), not a Faculty record; it remains preserved in generic raw staging;
- all 116 Faculty records have a UCID;
- all 116 Faculty records have an email.

Teaching Assignments:
- 4,974 assignment rows;
- 1,937 canonical sessions using:
  `academic_year + curriculum_year + course + topic + session_type + date + start + end`;
- 106 distinct assignment names;
- 87 exact source Preferred Names;
- additional source names may be resolved through HR-name crosswalk or an explicit approved alias, but the resulting canonical identity always uses the Faculty Master Preferred Name;
- source names that cannot be tied to a Preferred Name without guessing remain unresolved.

Teaching Assignments:
- the four non-person values (`TBD - New Clin Path Hire - AG`, `TBD - New Clin Path Hire - CW`, `Z-Sessional`, `Z-Other`) are intentionally modeled as vacancy/pool records;
- `Haddad Pinho, Renata`, `Petersen Dias, Angelica`, `Juarez Davila, Manuel`, and `de Anhaia Camargo, Vinicius` resolve only through explicit approved aliases to their Faculty Master Preferred Names;
- `Zachar, Erin` is confirmed former Faculty. Her 4 Teaching Assignment source rows remain in raw/typed staging evidence but are explicitly excluded from canonical `paws.SessionAssignment` data.

Role Assignments:
- 162 rows;
- 75 distinct source names;
- all rows resolve after the intentional pool records and explicit `Petersen Dias, Angelica` alias are applied.

AFC:
- 798 records;
- 1 missing Faculty Member;
- 1 missing Purpose;
- 2 have End earlier than Start;
- `Zachar, Erin` is confirmed former Faculty; her 4 AFC source rows remain in raw/typed staging evidence but are explicitly excluded from canonical `paws.AfcRecord` data;
- all other observed name variants resolve to Faculty Master Preferred Names through exact/HR/explicit-alias matching.

All anomalous rows remain preserved in staging even when excluded from normalized `paws.*` tables.

## 5. Import provenance model

Every import is represented by `staging.ImportBatch` with at least:

- `ImportBatchId uniqueidentifier`
- `StartedAtUtc datetime2`
- `CompletedAtUtc datetime2 null`
- `Status nvarchar(32)`
- `SourceManifestSha256 char(64)`
- `ImporterVersion nvarchar(64)`
- `ActorUpn nvarchar(256)`
- `ValidationSummaryJson nvarchar(max)`

Each workbook is represented by `staging.ImportWorkbook`:

- `ImportWorkbookId uniqueidentifier`
- `ImportBatchId`
- `FileName`
- `FileSha256`
- `FileByteLength`

Each sheet is represented by `staging.ImportSheet`:

- `ImportSheetId uniqueidentifier`
- `ImportWorkbookId`
- `SheetName`
- `SheetIndex`
- `MaxRow`
- `MaxColumn`

Every non-empty source row is preserved in `staging.ImportRow`:

- `ImportRowId uniqueidentifier`
- `ImportSheetId`
- `SourceRowNumber int`
- `RawJson nvarchar(max)`
- `FormulaJson nvarchar(max) null`
- `ValidationStatus nvarchar(32)`
- `ValidationErrorsJson nvarchar(max)`

`RawJson` stores normalized serializable cell values by original column position/header. `FormulaJson` stores formula text where present. This allows the complete submitted workbooks to be represented in Azure without promoting helper formulas into application truth.

## 6. Typed staging tables

Typed staging is used only for business-source sheets and must retain source row references.

Required typed tables:

- `staging.FacultyRaw` ← Faculty Master / Key
- `staging.FacultyProfessionalRaw` ← Education & Experience
- `staging.JointAppointmentRaw` ← Joint Appointments
- `staging.FacultyOverviewRaw` ← Workload / Faculty Overview
- `staging.TeachingAssignmentRaw` ← Workload / Teaching Assignments
- `staging.RoleAssignmentRaw` ← Workload / Role Assignments
- `staging.CourseRaw` ← Workload / Courses
- `staging.DoeRuleRaw` ← Workload / DOE Rules
- `staging.AccountRoleRaw` ← Workload / Account Roles
- `staging.AfcRecordRaw` ← AFC / AFC records

Each typed row carries:
- `ImportBatchId`
- `ImportRowId`
- original business columns;
- `ValidationStatus`;
- `ValidationErrorsJson`.

The application identity must have no permission on `staging.*`.

## 7. Faculty identity and naming model

`paws.Faculty` uses a PAWS-generated GUID primary key rather than UCID.

### Canonical naming contract

The Faculty Master column `Preferred FULL Name (Last, First)` is the authoritative naming source for every real Faculty member.

The importer parses that source into:
- `PreferredFirstName`: the preferred given-name portion after the first comma;
- `PreferredLastName`: the preferred family-name portion before the first comma;
- `DisplayName`: exactly `PreferredFirstName + ", " + PreferredLastName`.

Examples:
- source `Alfajaro, Mia` → canonical `Mia, Alfajaro`;
- source `Baker, Tessa` → canonical `Tessa, Baker`;
- source `van der Meer, Frank` → canonical `Frank, van der Meer`.

All canonical PAWS business data, API responses, timetable/calendar instructor names, workflow displays, audit displays, and Faculty-linked user profiles use this preferred-name format. Source workload/AFC/role names are never allowed to become a competing canonical display name.

`HR FULL Name (Last, First)` is preserved in `staging.*` only. It may be used privately as a deterministic identity crosswalk during migration when it uniquely identifies a Faculty Master row, but after resolution the record is rewritten to that person's Preferred Name. HR name is not a canonical `paws.*` display field and is not exposed as the Faculty display name.

Minimum `paws.Faculty` fields:
- `FacultyId uniqueidentifier primary key`
- `RecordType nvarchar(32)`
- `PreferredFirstName nvarchar(128)`
- `PreferredLastName nvarchar(128)`
- `DisplayName nvarchar(260)`
- `Ucid nvarchar(64) null`
- `Email nvarchar(256) null`
- `Stream nvarchar(128) null`
- `Rank nvarchar(128) null`
- `Fte decimal(6,4) null`
- `ReportsToFacultyId uniqueidentifier null`
- `ReportsToRaw nvarchar(256) null`
- `Active bit`
- provenance/timestamps.

`Ucid` and normalized institutional email are unique when non-null.

`RecordType` distinguishes true Faculty from scheduling placeholders/pools. At minimum:
- `faculty`
- `sessional_pool`
- `other_pool`
- `vacancy`

`Z-Sessional`, `Z-Other`, and the two `TBD - New Clin Path Hire` values must be represented intentionally, without fabricated UCIDs. Their non-Faculty labels remain explicit pool/vacancy labels rather than being reformatted as human names.

### Identity crosswalk and alias resolution

`paws.FacultyAlias` stores explicit approved source-name variants keyed to a Faculty identity. Alias rows are matching evidence only; canonical display still comes from the Faculty Master Preferred Name.

Resolution order:
1. UCID;
2. institutional email;
3. exact normalized Faculty Master Preferred Name in source `Last, First` form;
4. exact normalized HR-name crosswalk when it uniquely maps to one Faculty Master row;
5. explicit approved alias;
6. unresolved.

No fuzzy match may create a Faculty relationship automatically.

The first import may add deterministic aliases only where the target is unambiguous and explicitly encoded in the migration mapping. Examples include accent/surname-form variants such as `Juarez Davila, Manuel` → Preferred `Manuel, Juárez Davila`, and `Rancourt, Derrick E.` → Preferred `Derrick, Rancourt`.

## 8. Faculty professional data

`paws.FacultyProfessionalProfile` stores the current Education & Experience record with a one-to-one `FacultyId` relationship.

Source-derived ages/years such as years of service or total years of experience are not treated as immutable authoritative values. Store the dates and base experience inputs needed to derive them.

`paws.JointAppointment` stores zero-to-many joint appointments per Faculty with:
- home faculty;
- joint faculty;
- UCVM FTE;
- other-faculty FTE;
- expiry date;
- notes.

## 9. Scheduling model

`paws.Session` is the only canonical session record.

A session is built from the observed natural grouping:
- Academic Year
- Curriculum Year
- Course
- Topic
- Session Type
- Date
- Start
- End

The importer must prove that this grouping yields 1,937 canonical sessions for the supplied Teaching Assignment workbook before database mutation.

`paws.SessionAssignment` stores 4,970 canonical Faculty/role assignment rows and links each to its canonical Session. The 4 source rows for former Faculty `Zachar, Erin` remain in staging/validation evidence and are not published as canonical assignments.

Session fields include:
- `SessionId uniqueidentifier`
- academic year/curriculum year;
- course FK;
- topic;
- session type;
- date;
- start/end;
- room when available;
- import provenance;
- created/updated timestamps.

Assignment fields include:
- `SessionAssignmentId uniqueidentifier`
- `SessionId`
- `FacultyId null` only when unresolved source identity is intentionally retained outside authoritative assignment publication;
- teaching role;
- lab lead;
- credited hours;
- DOE source fields/evidence;
- source row.

Rows whose Faculty identity cannot be safely resolved stay in staging and are reported. They do not silently point at another Faculty. Resolved SessionAssignments store FacultyId; all displayed instructor names are derived from `paws.Faculty.DisplayName` and therefore use the canonical `First, Last` Preferred Name format.

### Calendar projection

There is no duplicate writable `calendar_sessions` table.

`paws.vCalendarSession` is a SQL view or API projection over canonical Session/Assignment data and exposes only public/session-display fields.

This makes Calendar and Timetable consistent by construction.

## 10. AFC model

Historical/imported availability records live in `paws.AfcRecord`.

Minimum fields:
- `AfcRecordId uniqueidentifier`
- `FacultyId`
- `StartDate date`
- `EndDate date`
- `Purpose nvarchar(... ) null`
- `SourceImportBatchId`
- `Active bit`

Constraint:
`EndDate >= StartDate`.

The two known invalid date-range rows remain in `staging.AfcRecordRaw` and are excluded from `paws.AfcRecord` until corrected.

Workflow/application records use separate `paws.AfcRequest` and `paws.AfcApproval` tables so historical imported AFC does not become indistinguishable from live requests.

## 11. Role assignments and temporary responsibilities

`paws.RoleAssignment` supports HICC/VISC and other temporary academic responsibilities.

Minimum fields:
- `RoleAssignmentId`
- `FacultyId`
- `AcademicYear`
- `RoleCategory`
- `RoleType`
- `CourseId null`
- `SubjectOrRotation null`
- `EffectiveDate`
- `ExpirationDate null`
- `DoeMappedValue null`
- `DoeOverrideValue null`
- `DoeOverrideReason null`
- `EffectiveDoe` derived by application/repository logic
- `SpecialNotes null`
- provenance/timestamps.

Rules:
- ExpirationDate, when present, must be later than EffectiveDate.
- DoeOverrideValue may be negative.
- date-effective status is computed as future/active/expired; roles are not destructively toggled when dates change.
- DOE override is case-by-case and does not overwrite the mapped value.

## 12. Identity and authorization

Firebase Authentication is retained.

`paws.UserProfile` replaces Firestore `users/{uid}`.

Minimum fields:
- `FirebaseUid nvarchar(128) primary key`
- `Email`
- `DisplayName`
- `BaseRole`
- `FacultyId null`
- `Active`
- `MustChangePassword`
- `OfficeName null`
- timestamps.

Runtime:
1. browser signs in with Firebase Authentication;
2. browser obtains Firebase ID token;
3. API verifies the ID token with Firebase Admin;
4. API loads `paws.UserProfile` by UID;
5. API authorizes the requested business action;
6. API accesses only `paws.*`.

Firebase Admin credentials are for token verification only. They do not authorize Firestore persistence after cutover.

## 13. DOE relational model

The current server-side DOE calculation semantics remain authoritative. The storage adapter changes; the engine is not rewritten.

Relational tables include the existing domain concepts:
- `paws.DoePolicy`
- `paws.DoePolicyVersion`
- `paws.DoeRule`
- `paws.DoeRuleSelector`
- `paws.DoeRuleParameter`
- `paws.DoeRuleTier`
- `paws.DoeCourseMapping`
- `paws.DoeSubjectMapping`
- `paws.DoeException`
- `paws.DoeFacultyTarget`
- `paws.DoeAssignment`
- `paws.DoeCalculation`

Academic years are rows, not year-specific columns.

The supplied `DOE Rules` workbook sheet seeds the initial policy/rule evidence. The importer must preserve its 24 rows even when a row is documentary rather than directly executable.

## 14. Workflow and audit

Workflow state is relational:
- `paws.ChangeRequest`
- `paws.ChangeRequestScope`
- `paws.ChangeRequestApproval`
- `paws.WorkflowNotification`

Multi-table transitions execute in SQL transactions.

Audit is unified in append-only `paws.AuditEvent` with:
- Event ID/type;
- entity type/id;
- actor UID/name;
- timestamp;
- before JSON;
- after JSON;
- metadata JSON;
- request/import batch linkage.

Corrections create new events; existing audit events are not updated/deleted by normal application roles.

The API exposes role-appropriate projections such as My Changes, Session History, Faculty History, AFC History, and DOE Audit.

## 15. Database reset contract

The reset is destructive and must be fail-safe.

Before any DROP/DELETE:
1. all three source files must exist;
2. file SHA-256 values must be computed;
3. every sheet must parse;
4. generic raw-row counts must be known;
5. typed business-source counts must match the source inventory;
6. canonical Teaching grouping must equal 1,937 Sessions and 4,974 assignment rows;
7. migration SQL must compile in a disposable/local SQL test target or equivalent schema test;
8. a reset plan must enumerate the user-created objects that will be removed.

The production/lab database mutation then:
1. begins a controlled migration window;
2. removes old PAWS user-created application/mirror objects;
3. creates `staging` and `paws` schemas/tables/views;
4. imports all generic raw workbook rows;
5. imports typed staging rows;
6. transforms validated rows into `paws.*`;
7. verifies counts, constraints, uniqueness, and foreign keys;
8. records the completed ImportBatch and manifest;
9. commits only if every required invariant passes.

If a required invariant fails, the operation must fail closed. The implementation must not leave a successful-looking partially imported authoritative database.

Because DDL transaction behavior and client/tool behavior can differ, the implementation plan must use an explicit restore/rollback strategy rather than assuming every Azure SQL DDL statement is safely reversible by one transaction.

## 16. Application database permissions

The PAWS App Service uses a system-assigned managed identity.

The API principal:
- receives the minimum required permissions on `paws.*`;
- receives no permissions on `staging.*`;
- does not use a SQL administrator password;
- does not receive broad `db_owner` privileges.

Migration/import is an administrative operation using an approved Entra administrator/operator identity, separate from the application identity.

## 17. API contract

The browser never connects directly to SQL.

Business endpoints are domain-specific, not generic table/query endpoints.

Required endpoint families include:
- `/api/v1/me`
- `/api/v1/users`
- `/api/v1/faculty`
- `/api/v1/faculty-directory`
- `/api/v1/sessions`
- `/api/v1/calendar`
- `/api/v1/role-assignments`
- `/api/v1/afc/*`
- `/api/v1/change-requests/*`
- `/api/v1/audit/*`
- existing DOE endpoint semantics adapted to Azure SQL.

The frontend uses a shared authenticated API client that obtains the current Firebase ID token and adds `Authorization: Bearer <token>`.

## 18. Repository ownership

`Teaching-assignment` remains source of truth for:
- PAWS feature development;
- Node API implementation;
- DOE engine/business semantics;
- API tests;
- normal test-site development.

`Teaching-assignment-azure` remains source of truth for:
- Azure release frontend line;
- Azure SQL import/migration tooling;
- Azure-specific deployment/runtime configuration;
- Azure release verification/freeze controls.

The backend engine is not duplicated into a second divergent implementation.

## 19. No hybrid Azure release

Development may migrate modules in stages, but an Azure user-facing release may not intentionally run a mixed business persistence model where some modules write Firestore and others write Azure SQL.

The release candidate must route all PAWS business persistence through the API/SQL boundary.

Firebase Authentication remains allowed.

## 20. Firestore-exit acceptance gate

Before declaring cutover complete, the shipped Azure runtime must pass an automated guard that rejects business uses of:
- `firebase.firestore()`
- Firestore collection/document reads/writes;
- known business collection names accessed through Firestore.

Allowed Firebase runtime use is limited to Authentication behavior such as:
- auth state;
- sign-in/sign-out;
- ID-token acquisition/refresh;
- password reset.

The acceptance suite must also prove:
- Calendar and Timetable read the same canonical Session data;
- API authorization prevents ordinary Faculty from seeing protected UCID/email/DOE/AFC details;
- workflow writes are transactional;
- My Changes returns events related to the signed-in user;
- DOE calculations use the same engine semantics with Azure SQL storage;
- App Service identity cannot read `staging.*`.

## 21. Azure beta frozen-runtime promotion

The current Azure beta freeze remains a safety control.

This migration requires an explicit baseline promotion after the new runtime is accepted. The implementation must update the trust anchor and protected shipped-file manifest in a reviewed change; it must not disable `tools/beta-freeze.js` or weaken artifact verification.

## 22. Cutover order

Final cutover order:

1. deploy API but do not point the accepted frontend release at it yet;
2. verify `/api/health`;
3. verify Firebase token authentication against `paws.UserProfile`;
4. run the clean authoritative SQL rebuild/import;
5. verify raw and normalized import evidence;
6. run API read/write authorization smoke tests;
7. build accepted Azure frontend with API base URL;
8. promote Azure frozen baseline;
9. manually deploy exact tested artifact;
10. run browser acceptance;
11. run zero-Firestore-business-access verification;
12. retain the import manifest, validation report, accepted SHA, and rollback evidence.

Only after step 11 is the migration called complete.

## 23. Phase 1 success criteria

The first executable subproject is complete only when:

- a deterministic import package can be generated from the three supplied workbooks;
- all non-empty rows from all workbook sheets are represented in generic raw staging;
- all business-source rows are represented in typed staging;
- the parser reproduces the documented counts, including 4,974 Teaching rows and 1,937 canonical Sessions;
- invalid/unresolved records are reported, not silently discarded or guessed;
- a clean database can be rebuilt from zero without Firestore;
- legacy mirror tables are absent after a successful rebuild;
- `paws.*` normalized constraints pass;
- a machine-readable import/validation report records file hashes, counts, anomalies, and completion status;
- no Azure frontend/runtime behavior is changed as part of Phase 1.

