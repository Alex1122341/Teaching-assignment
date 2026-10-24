# BETA-R4D-10A — Dashboard Azure SQL read API foundation

**Branch:** `feature/beta-r4d10a-dashboard-api-read`
**Base:** `main` @ `7c0d857ed48ca5864aea78e58502066b568004d1` (post R4D-9J2 merge)
**Scope:** backend only. The Dashboard frontend is **not** switched in this change.

## 1. Why

The Dashboard currently reads Firestore. BETA-R4D-10A establishes the Azure SQL
read foundation the Dashboard will eventually sit on, without touching the
frontend. This step is deliberately additive: new routes, new repository, new
grants, new tests. Nothing that exists today changes behaviour.

## 2. Routes

All three are **GET only**, `authLevel: anonymous` at the Functions layer so the
API itself owns the 401 (an anonymous-layer bind is how every existing PAWS Beta
route is registered).

| Route | Authorization |
|---|---|
| `GET /api/v1/dashboard/summary` | administrator **or** faculty-scoped (self-scoped) |
| `GET /api/v1/dashboard/faculty` | administrator only |
| `GET /api/v1/dashboard/faculty/:facultyId` | administrator any id; faculty-scoped only its own id |

Any other method on any of these paths returns **405** with `Allow: GET`. An
unknown path returns 404, so the wrapper's ownership boundary is observable.

### Why the routes are bound to every common method

This is load-bearing, and it was found on the live deployment rather than in
review. Azure Functions' route matcher resolves a request whose method was not
bound to the function to **404**, before any handler executes. Binding the three
Dashboard routes to `GET` only therefore produced `POST /api/v1/dashboard/summary
→ 404` over the wire, which contradicts the reviewed contract.

The fix binds the Dashboard routes to `GET, POST, PUT, PATCH, DELETE, HEAD,
OPTIONS` and lets `swa-dashboard-functions.js` produce the 405 itself. The 405
verdict is now the runtime's, not the host's, and it carries the `Allow: GET`
header the host would never have set. The three timetable routes stay `GET`-bound
because their reviewed contract is unchanged and a 404 there is not a regression.

Test `N2` pins this binding so a future "tidy up to GET" edit cannot silently
reintroduce the 404.

Optional query string: `academicYear` (validated `YYYY-YYYY`, default
`2026-2027`), plus `search` and `limit` on the roster route (limit clamped
1–500).

## 3. Authorization model

| Role | Class | Behaviour |
|---|---|---|
| `owner` | administrator | full Dashboard read |
| `administrator` | administrator | full Dashboard read |
| `adfa_general` | administrator | full Dashboard read |
| `adfa_regular` | administrator | full Dashboard read |
| `admin` | administrator | full Dashboard read |
| `faculty` | self-service | own summary and own faculty record only |
| `hicc` | self-service | own summary and own faculty record only |
| `visc` | self-service | own summary and own faculty record only |
| `viewer` | denied | 403 `ROLE_DENIED` on every Dashboard route |
| anything else | denied | 403 `ROLE_DENIED` |

`other_office` is **not introduced**. It is asserted against explicitly so a
future addition cannot silently become a Dashboard role.

Additional gates, applied in order before any SQL is touched:

1. profile missing or `active !== true` → 403 `PROFILE_REQUIRED`
2. `mustChangePassword === true` → 403 `PASSWORD_CHANGE_REQUIRED`
3. role not in the supported set → 403 `ROLE_DENIED`
4. faculty-scoped role with no linked FacultyId → 403 `FACULTY_LINK_REQUIRED`
5. faculty-scoped caller requesting another FacultyId → 403 `ROLE_DENIED`
   (deliberately 403, not 404, so the response cannot confirm that an unrelated
   FacultyId exists)

Scope is enforced as a **server-side SQL predicate**
(`sa.FacultyId = @facultyId`), never by hiding fields in a response the caller
already received.

## 4. Repository

`server/src/data/sql-dashboard-repository.js` — new, read-only.

* reads `paws.vCalendarSession`, `paws.SessionAssignment`, `paws.Faculty`;
* never references `staging`;
* never emits a mutation verb (statically asserted);
* binds every caller-supplied value as a parameter (`@facultyId`,
  `@academicYear`, `@search`); no value is spliced into SQL text;
* returns `null` for a malformed or unknown FacultyId without querying.

Dashboard data comes **exclusively from Azure SQL**. There is no Firestore read
anywhere on this path, and that is statically asserted.

## 5. SQL permissions

### 5.1 Which principal actually connects

The reviewed contract originally named a contained database user
`paws_swa_beta`. **Live verification showed that principal does not exist in
`teaching-assignment-lab`.** The database contains only `dbo`, `guest`,
`INFORMATION_SCHEMA`, `sys` and **`paws-sql-beta-mi`**, and the deployed runtime
authenticates as that application managed identity (an `EXTERNAL_USER`).

This matters because a `GRANT … TO [paws_swa_beta]` would have been **inert**:
the grant would have applied to nobody, and every `/dashboard/faculty` route
would have failed at runtime with a permission error rather than returning data.

The permission file is therefore **parameterised** rather than renamed:

```sql
:setvar PAWS_API_PRINCIPAL "paws_swa_beta"
```

and every principal reference in the file and in the read-only proof now uses
`$(PAWS_API_PRINCIPAL)`. Apply against the live runtime principal with:

```
sqlcmd -v PAWS_API_PRINCIPAL="paws-sql-beta-mi" -i 004_swa_beta_permissions.sql
```

The default value is unchanged, so an unparameterised run behaves exactly as
reviewed. The Node and Python contract tests now **require** the parameter
binding and reject a hardcoded principal, so the file cannot silently drift back.

### 5.2 The grant

`database/azure-sql/004_swa_beta_permissions.sql` is extended, not relaxed:

```sql
GRANT SELECT ON OBJECT::paws.Faculty
    (FacultyId, RecordType, PreferredFirstName, PreferredLastName, DisplayName,
     Ucid, Email, Stream, Rank, Fte, ReportsToFacultyId, Active)
    TO [$(PAWS_API_PRINCIPAL)];
```

The 12 granted columns were verified against the live `paws.Faculty` definition
(17 columns total). `ReportsToRaw`, `SourceImportBatchId`, `SourceRow`,
`CreatedAtUtc` and `UpdatedAtUtc` are deliberately excluded, and the repository
proves it never selects them.

The reviewed-contract guard in the same script is extended with the matching
allow-list, so **any** unreviewed permission on this principal still throws
`51002`. In particular `SourceImportBatchId` and `SourceRow` are deliberately
excluded from the `Faculty` grant, and DOE / creditable-hour columns on
`SessionAssignment` remain unreadable.

The schema-wide `DENY INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::paws` and
`DENY SELECT, … ON SCHEMA::staging` remain in force, so the change widens the
read surface without widening the mutation surface.

### 5.3 Live apply wrapper

`database/azure-sql/apply-dashboard-grant.ps1` — new. This is the reviewed
operator path for the additive grant, because it must run as a *different*
principal (database owner / sysadmin) than the runtime MI it grants to.

It is additive-only and fails closed:

* refuses if the principal is missing, is an `EXTERNAL_GROUP`, owns the database,
  owns schemas/objects, or inherits any database role;
* refuses if the principal already holds **any** permission outside the reviewed
  allowed sets — a grant is never stacked on an unreviewed surface;
* prints the full before/after effective permission set with added/removed deltas;
* supports `-WhatIf` and `-SkipConnection -SnapshotPath <csv>` so the entire
  effect can be rehearsed offline against a recorded live snapshot;
* supports `-EmitSql` to emit the exact transactional T-SQL for review;
* re-checks the post-apply state against the full expected set and fails if
  anything is missing or unexpected.

The parameter block must precede any statement in the file: PowerShell 5.1
cannot parse `[CmdletBinding()] param(...)` once an executable statement has
already appeared, so `Set-StrictMode` follows the block rather than leading the
file.

### Read-only proof

`database/azure-sql/004_swa_beta_permissions_readonly_proof.sql` — new. Run as
`db_owner` after applying the grant script, binding the runtime principal:

```
sqlcmd -v PAWS_API_PRINCIPAL="paws-sql-beta-mi" -i 004_swa_beta_permissions_readonly_proof.sql
```

It throws on the first violation and prints `READ_ONLY_PROOF_OK` only when:

* the principal holds no `INSERT/UPDATE/DELETE/MERGE/EXECUTE/ALTER/CONTROL`
  grant anywhere;
* there is no `SELECT` grant of any kind on `staging`;
* all four `paws` mutation `DENY` rows and the `staging` `SELECT` `DENY` row are
  present (counted per verb, so one missing `DENY` cannot hide behind its
  siblings);
* the principal holds no database role;
* **no mutation verb is effectively permitted** — expressed as a
  principal-scoped, DENY-aware probe over the runtime principal's own rows;
* every granted whole-object `SELECT` is the single reviewed view.

The file itself performs no mutation.

#### Why not `HAS_PERMS_BY_NAME`

The first version of this proof used `HAS_PERMS_BY_NAME(..., 'UPDATE') = 0` as
its effective-permission check. **That check can never work here.**
`HAS_PERMS_BY_NAME` evaluates the **caller's** effective permissions and ignores
its principal argument entirely, so when the script runs as a `db_owner` it
reports the *db_owner's* rights. Verified live: it returned `1` for
`paws.Session`/`UPDATE` even though the runtime principal holds an explicit
`DENY UPDATE ON SCHEMA::paws`.

The live run caught this — a static test could not, because the SQL was valid
and simply meant something different from what it read as. The replacement
probe joins the principal's own grant rows against its deny rows at database,
schema and object scope, honouring `DENY`-over-`GRANT`, and is paired with a
positive control (`THROW 51108`) so it cannot pass vacuously.

### Live proof result

Applied to the live runtime principal, the corrected proof returns:

| Field | Value |
|---|---|
| Result | `READ_ONLY_PROOF_OK` |
| Principal | `paws-sql-beta-mi` |
| GrantCount | **22** |
| DenyCount | **9** |

Independent post-apply verification:

| Check | Result |
|---|---|
| `paws.Faculty` rows readable | **120** |
| `paws.Faculty` columns granted | **exactly the 12 reviewed** |
| Effective mutation verbs | **none** |
| `staging` access | **none** |
| Totals | **22 grants / 9 denies / 0 roles** |

## 6. Tests

`server/test/dashboard-api.test.js` — new, 18 cases labelled A–P matching the
task acceptance matrix: admin access, the exact administrator role set,
self-service scoping, `viewer` denial, `other_office` denial, the
`FACULTY_LINK_REQUIRED` gate, predicate-not-filter scoping, roster
administrator-only, own-record-only detail access, 404/400 handling without SQL,
401 before SQL, inactive and password-change gates, 503 without leakage, 405 with
`Allow: GET` for six methods on three routes, static read-only/staging/Firestore
scanning, and the permission-script contract.

`tests/python/test_beta_sql_runtime_contract.py` gains five contract cases:
repository read-only/SQL-only, column-scoped grant, proof-script shape, the
no-mutation-verb scan, and — added with the principal parameterization — the
live-apply wrapper contract (additive only, no `REVOKE`/`DROP`/DML, every guard
present, param block precedes any statement, `-SkipConnection`/`-EmitSql`
present, binds `[...$Principal]` and never a literal principal).

`tests/beta-runtime-artifact.test.js` gains assertions that the three new routes
ship in the release artifact and that no non-GET method is registered.

### Results

| Suite | Result |
|---|---|
| `server` (`node --test test/*.test.js`) | **40 pass / 0 fail** |
| root (`node --test tests/*.test.js`) | **357 pass / 1 fail / 29 skipped** |
| Python (`unittest`) | **68 pass / 0 fail** |
| `tests/beta-baseline.test.js` | **11 pass / 0 fail** |

The single root failure is the pre-existing environment-only
`spawnSync pwsh.exe ENOENT` in `tests/hosting-boundary.test.js`; `pwsh` is
verified absent from this machine (not on `PATH` and not present at
`C:\Program Files\PowerShell\7\pwsh.exe`). That test file is **not touched by
this branch** — the branch changes only the four files listed above — and the
failure reproduces on the base commit.

### Offline rehearsal evidence

The wrapper was rehearsed against a recorded live snapshot of the runtime
principal before any live change:

| Step | Result |
|---|---|
| Live permission rows (before) | **19** |
| Contract guard | `unexpected_count=0` → `OK` |
| `faculty_grant_present` before | `0/12` |
| Expected rows after | **31** |
| Added | **12** |
| Removed | **0** |
| Post-apply contract | `OK total=31 expected=31` |
| Overall | `RESULT=OK` |

This proves the guard logic and the exact 12-row delta **without opening a
connection**, so the live apply is a formality rather than an experiment.

The frozen-baseline check (`tools/verify-beta-candidate.js`) still reports zero
protected drift: no protected frontend asset was touched.

## 6A. Live deployment

| Item | Value |
|---|---|
| Merged `main` | `983e6ab577054162e1cbd0bc7de8c9c1d4443c24` (true merge commit, PR #22) |
| Main build run | `36369400775` SUCCESS |
| ACR image | `pawssqlbetaacr.azurecr.io/paws-sql-beta-api:983e6ab577054162e1cbd0bc7de8c9c1d4443c24` |
| Image digest | `sha256:e5488e2b1bd337ce5796fb91be2879db898ef70ae9473c3c0bc29243d32934bf` |
| ACR publish run | `36369556506` SUCCESS |
| ACA revision | new revision, `Healthy` / `Provisioned`, 100% traffic |
| SWA | **not deployed** (this step is backend-only) |

Live probes:

| Probe | Result |
|---|---|
| `GET /api/health/sql` | **200** `{"status":"ok","service":"paws-beta-sql-runtime"}` |
| `GET /api/v1/sessions` (no token) | **401** `UNAUTHENTICATED` |
| `GET /api/v1/dashboard/summary` (no token) | **401** `UNAUTHENTICATED` |
| `GET /api/v1/dashboard/faculty` (no token) | **401** `UNAUTHENTICATED` |

Cold-start note: the first `health/sql` call on the new revision returned 503
after a 15-second SQL pool handshake; the immediately following call returned 200
in 48 ms. This is the known Azure SQL cold-connection behaviour on a scaled-to-
zero ACA revision, not a regression — the second call is the steady state.

## 6B. Authenticated live acceptance

Both acceptance accounts are `adfa_general`, `Active=True`,
`MustChangePassword=False`, and carry no `FacultyId` — so they exercise the
**administrator** path, not the faculty-scoped gate.

| Probe | Account A `adfa@ucalgary.ca` | Account B `xinyu.zhu1@ucalgary.ca` |
|---|---|---|
| `GET /dashboard/summary` | **200** | **200** |
| `GET /dashboard/faculty?limit=3` | **200** | **200** |
| `GET /dashboard/faculty/:id` | **200** | **200** |
| `GET /dashboard/faculty/<unknown-uuid>` | **404** `FACULTY_NOT_FOUND` | **404** `FACULTY_NOT_FOUND` |
| `GET /api/v1/sessions` | **200**, 1937 sessions, `academicYear=2026-27` | **200**, same |

This is the step that proves the `paws.Faculty` grant works end-to-end: before
the grant in §5.2 the two `faculty` routes could only fail with a permission
error; they now return real roster rows.

Roster shape (exactly the reviewed projection — no DOE, creditable-hour or
source-provenance column):

```json
{"facultyId":"40364B66-…","displayName":"Alanna, Zantingh",
 "email":"alanna.zantingh@ucalgary.ca","ucid":"10201640",
 "recordType":"faculty","stream":"Teaching-Focused",
 "rank":"Assistant Professor (Teaching)","fte":null,"sessionCount":113}
```

## 6C. Live finding — a wrong academic-year format silently zeroed every aggregate

The first authenticated run returned **HTTP 200 with a well-formed payload that
was entirely zero**:

```json
{"academicYear":"2026-2027","sessionCount":0,"courseCount":0,
 "gridPositionableCount":0,"checkNeededCount":0,"assignmentCount":0}
```

while `/api/v1/sessions` returned **1937** sessions and
`paws.SessionAssignment` held **4970** rows.

Root cause: the stored academic year is **`2026-27`**, but the repository
defaulted to **`2026-2027`**. Two compounding defects:

1. `DEFAULT_ACADEMIC_YEAR = '2026-2027'` matched zero rows.
2. the validator `/^\d{4}-\d{4}$/` **rejected** the real `2026-27` form, so a
   caller could not even override it correctly.

This is the worst failure mode available: not an error, a **wrong answer**.
Every aggregate returned `0` with a 200 and a correctly shaped body, so no
contract test could see it, and the unauthenticated 401/405 probes could not see
it either. Only an authenticated run against real data could.

Verified side by side on live SQL:

| `@academicYear` | sessionCount | courseCount | grid | checkNeeded | assignments |
|---|---|---|---|---|---|
| **`2026-27`** | **1933** | **33** | **1386** | **547** | **4970** |
| `2026-2027` | 0 | 0 | 0 | 0 | 0 |

The fix sets the default to `2026-27`, widens the validator to
`/^\d{4}-\d{2,4}$/` so both the stored form and an explicit 4-4 override pass
through while malformed input still falls back, and adds two regression tests
(`G2`) pinning the format.

`1933` vs `1937` is expected and correct: the summary is scoped to sessions that
**have** an assignment, while `/sessions` lists all sessions. Four sessions
carry no `SessionAssignment`.

## 7. What this change does NOT do

* does not switch the Dashboard frontend to the SQL API;
* does not deploy SWA;
* does not add or use `other_office`;
* does not add a Firestore fallback;
* does not carry any Design or UI change;
* does not modify any protected runtime asset.

## 8. Follow-up

ACA deployment and live acceptance (health 200, unauthenticated 401, Account A
`adfa@ucalgary.ca`, Account B `xinyu.zhu1@ucalgary.ca`) follow the merge, on the
exact merged `main` SHA.
