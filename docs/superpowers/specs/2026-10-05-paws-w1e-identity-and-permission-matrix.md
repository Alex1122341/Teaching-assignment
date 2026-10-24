# P0 W1E — Identity authority and SQL permission contract

**Status:** W1E local implementation proposal; no production policy/configuration change.
**Source branch/base:** `feature/beta-w1e-identity-runtime-least-privilege` from W1D `2d40117eb34ce309826a0e0d357b694fcf86801a`.
**Authority decision:** SQL API business authority is `paws.UserProfile.BaseRole`; Firebase Auth proves identity only. Firestore user role fields can support separate Firestore/account/UI features, never SQL API authorization.

## 1. Identity fields and mismatch behavior

| Input/evidence | Authority | SQL API effect |
|---|---|---|
| Firebase ID token `uid` | Firebase Authentication after Admin SDK `verifyIdToken(token, true)` and expected project/issuer checks | Identifies the row looked up in SQL `paws.UserProfile.FirebaseUid`. Invalid/expired/revoked/wrong-project token returns 401. |
| SQL `UserProfile.BaseRole` | VetMed-Ops | Sole role input to API role allowlists. Normalized with trim + lowercase in application authorization. |
| SQL `Active` | VetMed-Ops | False, missing profile, or absent row denies protected business access. |
| SQL `MustChangePassword` | VetMed-Ops | True denies protected routes with 403. |
| SQL `FacultyId` | VetMed-Ops | Server-side self-scope for `faculty`, `hicc`, `visc`; missing link denies. Client/token/Firestore faculty ID is ignored. |
| Firebase custom claims such as `role`, `baseRole`, `facultyRoles`, `facultyId` | Untrusted for SQL authorization | Ignored by SQL API authorization. |
| Firestore `users.role`, `facultyRoles` | Separate account/UI and Firestore-rule capability only | Cannot grant/alter SQL API role, SQL scope, or SQL grants. No browser-side synchronization is permitted. |

W1E tests exercise mismatches A/B, absent/inactive profile, password-change-required, invalid token, forged client/token role, and a forged other-faculty target. Existing API behavior already follows the locked rule; W1E adds regression coverage rather than introducing a second role mapping.

## 2. Protected API route authority matrix

All protected routes call the same Firebase token verifier and look up `UserProfile` by verified UID. `findUser` SQL errors fail closed with 503. No University API path reads Firestore for authorization or falls back to Firestore after SQL failure.

| Route | Auth source | Authorization source / roles | SQL lookup / data | Scope source | Client-trusted authority fields | Fail-closed behavior |
|---|---|---|---|---|---|---|
| `GET /api/v1/me` | Firebase ID token | SQL `BaseRole` in timetable supported-role allowlist | `UserProfile` | SQL profile | None; decoded UID only identifies row | Invalid token 401; SQL unavailable 503; absent/inactive/unsupported/password-change profile 403 |
| `GET /api/v1/sessions` | Firebase ID token | SQL role in timetable supported-role allowlist (`owner`, `administrator`, `adfa_general`, `adfa_regular`, `admin`, `faculty`, `hicc`, `visc`, `viewer`) | `UserProfile`, `vCalendarSession`, `SessionAssignment` | SQL `FacultyId` for `faculty`/`hicc`/`visc`; these receive only assigned rows. Other accepted roles, including the current office `viewer`, receive unscoped timetable rows per existing policy. | Range only; forged role/baseRole/facultyId ignored | Invalid token 401; absent/inactive/no-link/unsupported 403; SQL read failure 503 |
| `PATCH /api/v1/sessions/:id` | Firebase ID token | SQL `BaseRole` in edit allowlist (`owner`, `administrator`, `adfa_general`, `adfa_regular`, `admin`) AND `PAWS_SESSION_EDIT_WRITE_ENABLED === 'true'` | `UserProfile`; only `paws_api.UpdateCalendarSession` performs the write | SQL role; the proc validates mutation against canonical records | Only validated patch fields; actor identity from verified UID / SQL display name | Gate defaults off; failed SQL/procedure call does not grant alternate write path |
| `GET /api/v1/dashboard/summary` | Firebase ID token | SQL administrator set: `owner`, `administrator`, `adfa_general`, `adfa_regular`, `admin` | `UserProfile`, Dashboard read objects | Admin/general | academicYear is a filter only | 401/403/503 as above |
| `GET /api/v1/dashboard/faculty` | Firebase ID token | Admin set gets roster; self-service SQL roles `faculty`, `hicc`, `visc` get one linked profile | `UserProfile`, `Faculty`, dashboard joins | Self-service `FacultyId` bound server-side | Search/limit/year filters do not set authority | Missing SQL link denies before data query; query error 503 |
| `GET /api/v1/dashboard/faculty/:id` | Firebase ID token | Admin set may request any FacultyId; self-service SQL roles only exact own SQL FacultyId | `UserProfile`, `Faculty` and profile/assignment joins | SQL `FacultyId`, case-insensitive equality; no client override | Path id is target only, not a grant | Other FacultyId returns 403 without confirming target existence |
| `GET /api/v1/dashboard/teaching-summary` | Firebase ID token | Admin set only | `UserProfile`, Faculty, session/assignment/role and DOE read sources | Admin/general | Academic year is filter only | Non-admin 403; SQL failure 503 |
| `GET /api/v1/dashboard/roles` | Firebase ID token | Admin set only | `UserProfile`, `RoleAssignment`, Faculty | Admin/general | Academic year is filter only | 403/503 |
| `GET /api/v1/dashboard/doe-targets` | Firebase ID token | Admin set only | `UserProfile`, `DoeFacultyTarget` | Admin/general | Academic year is filter only | 403/503 |
| `GET /api/v1/dashboard/doe-overview` | Firebase ID token | Admin set only | `UserProfile`, SessionAssignment, vCalendarSession, RoleAssignment, Faculty, DoeFacultyTarget, DoeFacultyAllocation | Admin/general | Academic year is filter only | 403/503 |
| `GET /api/v1/dashboard/afc-records` | Firebase ID token | Admin set only | `UserProfile`, `vAfcRecordUnified`, Faculty | Admin/general | Search/reason/active/limit are filters only | 403/503 |
| `POST /api/v1/dashboard/afc-records` | Firebase ID token | SQL admin set AND `PAWS_AFC_SINGLE_WRITE_ENABLED === 'true'` | `UserProfile`; `paws_api.CreateAfcRecord` | Admin | Actor UID/name and record ID are server generated; request fields are validated | Gate defaults off; no direct table DML route |
| `POST /api/v1/dashboard/afc-records/batch` | Firebase ID token | SQL admin set AND `PAWS_AFC_BATCH_WRITE_ENABLED === 'true'` | `UserProfile`; `paws_api.CreateAfcManualBatch` | Admin | Actor identity is server-derived; batch input validated | Gate defaults off; one stored procedure call |
| `GET /api/v1/afc-requests` | Firebase ID token | SQL `BaseRole` from shared AFC allowlist; all allowed profiles may list, SQL procedure parameters scope rows to actor/report-to unless admin | `UserProfile`, `AfcRequest` | SQL BaseRole chooses admin boolean; verified UID is row-scope key | Requester/routing fields rejected in writes; query has no authority selector | Invalid token 401; absent/inactive/password-change/unsupported/missing faculty-link 403; SQL failure 503 |
| `POST /api/v1/afc-requests` | Firebase ID token | SQL self-service `faculty`/`hicc`/`visc` only | `UserProfile`; `paws_api.SubmitAfcRequest` | Procedure derives role/faculty/routing from SQL and verified actor; application rejects identity/routing fields in body | Client cannot set FacultyId/requester/report-to/status/workflow timestamps | Validated body, 401/403/422/503; exact procedure required |
| `POST /api/v1/afc-requests/:id/withdraw` | Firebase ID token | SQL self-service role | `UserProfile`; `paws_api.WithdrawAfcRequest` | Verified UID and SQL role | Actor/routing/status not client-controlled | Invalid token/profile/id or SQL failure fails closed |
| `POST /api/v1/afc-requests/:id/recommend` / `reject` | Firebase ID token | Shared SQL profile allowlist; procedure performs decision-stage actor/role/state validation | `UserProfile`; `paws_api.RecommendAfcRequest` / `RejectAfcRequest` | SQL procedure derives current decision authority | Signature actor UID must match verified UID; unsupported fields rejected | SQL procedure errors map to denial/conflict; infrastructure failure 503 |
| `POST /api/v1/afc-requests/:id/approve` | Firebase ID token | API requires SQL admin role and procedure rechecks role/state | `UserProfile`; `paws_api.ApproveAfcRequest` | SQL BaseRole | Signature actor UID must match verified UID | Non-admin 403; procedure/failure fails closed |
| `GET /api/v1/afc-requests/:id/approved-artifact` | Firebase ID token | Shared SQL AFC profile checks, then procedure checks approved/requester/report-to authorization | `UserProfile`; read proc `GetApprovedAfcArtifact` | Stored procedure checks SQL and request ownership | Request ID selects target only | Invalid token/profile or unauthorized/missing artifact denied/not found |
| `POST /api/v1/afc-requests/:id/approved-artifact` | Firebase ID token | Shared SQL AFC profile checks, then source/read/create stored procedures | `UserProfile`; read procedures plus `CreateOrGetApprovedAfcArtifact` | Stored procedure checks approved request and actor; document integrity validated | Request ID target only; actor is verified UID | Create proc unavailable/denied fails closed; no in-memory or Firestore fallback |

`GET /api/health/sql` is an unauthenticated availability probe. It runs the SQL health check and reveals only health status, not user/profile data. Unsupported methods and unknown routes return 405/404.

### Routes that are outside the three W1C write gates

The current runtime also contains AFC request submit/withdraw, recommendation/rejection/approval, and approved-artifact creation routes. They invoke their own narrow stored procedures but are **not** governed by the three W1C environment flags in the checked-in runtime. W1E grants none of their write procedures. Therefore the proposed W1E read identity would cause these SQL operations to fail closed if the identity were switched without another reviewed control design. Before any future identity cutover, Architect/owner must separately decide whether to add independent fail-closed gates or a dedicated application principal/route isolation for these workflows. W1E neither changes their availability nor grants their write authority.

## 3. SQL runtime permission inventory

Source: every `server/src/data/sql-*.js` repository plus the runtime dependency wiring. The inventory contract is also checked by `server/test/w1e-permission-contract.test.js`.

### Base read role candidate

`paws_runtime_read` in local-only `database/azure-sql/017_w1e_runtime_least_privilege.sql` includes CONNECT, column-scoped SELECT on the listed objects, and EXECUTE only on the two artifact GET procedures.

| SQL object | Operation | Used by route(s) | Permission in candidate |
|---|---|---|---|
| `paws.UserProfile` | SELECT exact six identity columns | Every protected route; `/api/health/sql` uses only `FirebaseUid` | Column-scoped SELECT |
| `paws.vCalendarSession` | SELECT timetable + filter/join columns | Sessions; dashboard summary/faculty/teaching/DOE | Column-scoped SELECT on view |
| `paws.SessionAssignment` | SELECT timetable link/teaching/DOE fields | Sessions self-scope; dashboard, DOE overview | Column-scoped SELECT |
| `paws.Faculty` | SELECT roster/detail fields + Active/FacultyId predicates | Dashboard and DOE | Column-scoped SELECT |
| `paws.FacultyProfessionalProfile` | SELECT approved profile projection | Dashboard faculty detail | Column-scoped SELECT |
| `paws.JointAppointment` | SELECT approved appointment projection | Dashboard faculty detail | Column-scoped SELECT |
| `paws.RoleAssignment` | SELECT roles/DOE/filter fields | Dashboard summary, role, DOE outputs | Column-scoped SELECT |
| `paws.vAfcRecordUnified` | SELECT AFC projection/filter fields | Dashboard AFC reads | Column-scoped SELECT on view |
| `paws.AfcRequest` | SELECT actor-scoped list projection | AFC request GET | Column-scoped SELECT; row scope is currently API query logic, not SQL row-level security |
| `paws.DoeFacultyTarget` | SELECT target, source and policy fields | DOE targets/overview/faculty detail | Column-scoped SELECT |
| `paws.DoePolicyVersion` | SELECT label/source/year/active join fields | Faculty DOE detail/rules | Column-scoped SELECT |
| `paws.DoeFacultyAllocation` | SELECT category/DOE/source/year/active fields | Faculty DOE detail and DOE overview | Column-scoped SELECT |
| `paws.DoeRuleSeed` | SELECT rule projection and stable source-row ordering key | Faculty DOE rules | Column-scoped SELECT |
| `paws_api.GetApprovedAfcArtifactSource` | EXECUTE; procedure enforces SQL profile + request/approval scope | Approved-artifact GET and create flow | Read role EXECUTE |
| `paws_api.GetApprovedAfcArtifact` | EXECUTE; procedure enforces actor scope | Approved-artifact GET and create flow | Read role EXECUTE |

No direct SELECT is needed on the tables reached only inside same-owner SQL views/procedures; SQL ownership chaining must be confirmed when the artifact is separately reviewed. If ownership differs or dynamic SQL is used, the required grants must be reviewed from live definitions before any application.

The `Faculty` projection also includes `FteSourceReference`, `FteSourceRow`, and `FteSourceUpdatedAtUtc` because the dashboard repository selects them. The unified AFC view grant includes `Purpose` because the repository selects it. A read-only catalog check on the current VetMed-Ops instance confirmed those four columns are present. No SQL artifact was executed.

### Independent W1C procedure grants

| Domain | Gated route | Required environment gate (default off) | Exact procedure | Candidate role |
|---|---|---|---|---|
| AFC single | `POST /api/v1/dashboard/afc-records` | `PAWS_AFC_SINGLE_WRITE_ENABLED` | `paws_api.CreateAfcRecord` | `paws_runtime_afc_single_write` |
| AFC batch | `POST /api/v1/dashboard/afc-records/batch` | `PAWS_AFC_BATCH_WRITE_ENABLED` | `paws_api.CreateAfcManualBatch` | `paws_runtime_afc_batch_write` |
| Session edit | `PATCH /api/v1/sessions/:id` | `PAWS_SESSION_EDIT_WRITE_ENABLED` | `paws_api.UpdateCalendarSession` | `paws_runtime_session_edit_write` |

Eligibility requires the server gate **and** the corresponding SQL EXECUTE grant, followed later by separate activation approval. One side alone is insufficient. The base read role receives no DML and no schema-wide EXECUTE.

### Other current AFC write procedures — intentionally ungranted

| Current route(s) | Procedure(s) | W1E status |
|---|---|---|
| AFC request submit/withdraw | `SubmitAfcRequest`, `WithdrawAfcRequest` | No grant; separate architecture/gate decision required before runtime identity cutover |
| AFC approval recommend/reject/approve | `RecommendAfcRequest`, `RejectAfcRequest`, `ApproveAfcRequest` | No grant; separate architecture/gate decision required before runtime identity cutover |
| Approved artifact creation | `CreateOrGetApprovedAfcArtifact` | No grant; GET procedures only are in base read role; creation remains separate write domain |

Other W1E-unsupported domains (Faculty/user management, imports/staging, migration/DDL, direct business table DML, future assignment/DOE/Change Request writes) receive no runtime role/grant.

## 4. Identity/runtime read-only attestation (2026-10-05)

- Host: `ITAPPVETOPSDB01`; API listens only on `127.0.0.1:18787`.
- Running API process: Node `C:\Program Files\nodejs\node.exe`, command `src/runtime/university-api.js`, parent PowerShell launcher under `C:\PAWS\Runtime\Acceptance\2026-10-04\Start-PAWSApi-StageA.ps1`.
- API process owner: personal `UC\sa-xinyu.zhu1`.
- API connection contract from current source tree: Windows-integrated ODBC (`msnodesqlv8`, `Trusted_Connection=Yes`), encrypted TCP to `ITAPPVETOPSDB01.uc.ucalgary.ca:1433`, database `VetMed-Ops`, certificate validation enabled (`TrustServerCertificate=No`). `/api/health/sql` returned 200 `ok` during this read-only inspection.
- SQL Server service: `MSSQLSERVER`, Running/Automatic, service identity `UC\srv-vetmedPBIEngine`.
- `PAWSApi` Windows service: Stopped/Disabled placeholder, `NT SERVICE\PAWSApi`, command `cmd.exe /c exit 0`; it is not hosting the running API.
- Read-only SQL metadata confirms runtime process Windows owner maps to database user `UC\sa-xinyu.zhu1`, member of `db_owner`; a direct permission row also shows CONNECT. Membership supplies broad effective database authority including CONTROL-level capability. This is **UNSAFE_FOR_WRITE_ACTIVATION** and violates least privilege.
- API source directory is under immutable-looking path suffix `4767a55e…`, but it is not a Git worktree and exposes no commit SHA. Exact `main`/release-source identity is **NOT ATTESTED**. Process working directory was not independently proven from running process metadata. Do not claim exact-main or source hash correspondence.

No permission/configuration/service changes were made. Shell SQL metadata access proved the current SQL identity mapping, not future runtime identity permissions.

## 5. Future Windows identity recommendation and exact University IT request

**Preferred target:** organization-managed gMSA if University IT confirms the host/domain supports it, can authorize the service logon, and can map it to SQL on the same host using Windows integrated authentication. This fits the observed Windows-auth SQL driver and avoids an application-held password. The host and SQL listener are the same server, although the API targets its FQDN over TCP; confirm SPN/Kerberos behavior for the actual SQL service and whether any other network resources are required.

**Alternatives (in order):**

1. **Local virtual service account/service SID (`NT SERVICE\PAWSApi`)** — viable only if Windows service hosting is activated and SQL accepts that local service identity on the same host/connection path. For remote resources it presents the computer account. Confirm SQL authentication/SPN behavior and network dependencies; currently a disabled placeholder only, so support is unproved.
2. **Dedicated domain service account managed by University IT** — fallback if gMSA and the virtual service identity are not viable. Dedicated, nonpersonal, logon-as-service only as needed, no interactive logon, password stored/rotated only by approved Windows Service Control Manager/secret-management procedure; never in source or plaintext file.

**Minimal IT ticket:**

> Please provision or confirm an organization-managed, nonpersonal Windows identity for the PAWS University API service on `ITAPPVETOPSDB01`. Prefer an IT-managed gMSA/passwordless model that supports Windows integrated SQL authentication for the local `VetMed-Ops` instance reached through `ITAPPVETOPSDB01.uc.ucalgary.ca:1433`. Confirm permitted service logon, SPN/Kerberos requirements for the SQL service, and whether the identity needs any network-resource access for Firebase Admin. Do not grant SQL `db_owner`, `sysadmin`, `CONTROL DATABASE`, or database grants; those belong to the separately reviewed DBA process. Do not enable interactive logon unless an operational requirement is documented. No service account or AD change is requested by this W1E branch.

University IT provisioning is **required** before a production nonpersonal identity can be selected if the organization-managed gMSA is not already available. Current available identities were not enumerated; no account absence is claimed. A separate Google/Firebase credential design may also be needed: current code supports `FIREBASE_SERVICE_ACCOUNT_JSON` or Admin SDK default credentials; no credential values were inspected. Prefer a managed/federated credential path that avoids long-lived private-key files; validate it with IT/security before runtime activation.

## 6. Future `PAWSApi` service contract / safe order

1. Select and provision a dedicated nonpersonal service identity; keep the personal administrative DBA path separate.
2. Install a deterministic service wrapper and a signed/controlled immutable application release under `C:\PAWS\Runtime\Versions\<verified-release>`; record its source commit and artifact hash. Never point a production service at a mutable user checkout.
3. Configure explicit working directory and entry point `node.exe src/runtime/university-api.js`; no interactive user session, no manual console dependency. Use Automatic (Delayed Start only if approved dependency sequencing requires it).
4. Supply nonsecret config by service environment/approved machine configuration; obtain Firebase Admin credentials from a managed/federated secretless mechanism where supported. No credentials in source, command-line arguments, logs, or plaintext repository file. Restrict config and runtime directory ACLs to the service identity and administrators.
5. Bind API to loopback only; keep SQL TLS encryption and certificate validation enabled. Do not expose SQL/RDP/SMB or broaden firewall rules.
6. Configure service recovery to restart on first/second failure with bounded delay and a documented reset interval; log structured sanitized start/stop/error and request audit events with rotation/ACLs, never bearer tokens or secrets.
7. Health check: local `GET /api/health/sql`; monitor process/service state and the expected listener. Test restart/recovery without enabling business writes.
8. During identity migration, keep all W1C gates false. Prove authenticated read routes, SQL login mapping, exact role membership, `fn_my_permissions` and explicit grants under the final runtime identity, plus a rollback rehearsal, before removing application dependence on the personal SA. Remove any broad application permission only in a separately approved DBA operation after rollback is proven.

## 7. W1E SQL artifact

`database/azure-sql/017_w1e_runtime_least_privilege.sql` is a proposal only. Migration/artifact 017 is the next number after 016. It is VetMed-Ops-name guarded, transaction-wrapped, rerunnable via stable role existence checks, contains a read-only role-permission postflight, contains three separate single/batch/session EXECUTE role sets, and documents role-drop rollback. It creates no user/login, binds no principal, includes no broad DML/DDL/schema grants, and is **NOT EXECUTED**. Review exact live view/procedure definitions and column existence before any future DBA application.

## 8. Gate and W1D non-regression

- All three W1C gates remain default disabled and were not changed.
- SQL write role grants alone do not enable API writes; route gates remain independent.
- No schema-wide `EXECUTE` or direct INSERT/UPDATE/DELETE grant appears in the W1E artifact.
- W1D Firestore rules remain local/unpublished; no Firestore business fallback or Firebase/Firestore mutation was added.
- Static/API immutable-freeze gates were not changed or weakened. Strict known drift from accepted W1D remains a recorded baseline condition, not a waiver.
- Regression tests prove a callable mock procedure is not invoked while its W1C gate is off, and a simulated SQL permission-denied error under a true gate is returned as fail-closed `SQL_UNAVAILABLE`. This models the two independent controls; it does not test a real SQL role grant or authorize enabling a gate.
