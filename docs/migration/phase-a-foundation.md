# Phase A — Shared Foundation and Server/Database Port

Status: **server and database layer ported; browser layer not started**
Last updated: 2026-10-23

---

## 1. Baseline actually inspected

| Item | Value |
|---|---|
| Source repository (read-only) | `Alex1122341/Teaching-assignment-azure` |
| Source `main` | `8bb40c60370bcce3d0135efd4327d42fba657903` |
| Target repository | `UCVM-Teaching-Assignment/Teaching-assignment` |
| Target `main` at audit time | `fb9a0b1039099e15933fcc0a11bc499a391dd993` |
| Target `main` now | `eaa5ce26d63f1180a76476b8a347853ccbe49f0e` |
| Working branch | `feat/paws-phase-a-foundation` |

Target `main` advanced because **PR #88 ("restructured the codebase") merged** on
2026-10-24T00:09:38Z, moving 203 files into `web/`, `server/`, `shared/`,
`firebase/`, `deploy/`. All work below is written against the **post-#88 layout**.

`Alex1122341/Teaching-assignment` and `UCVM-Teaching-Assignment/Teaching-assignment`
are the **same repository** (the former redirects; branch SHAs are identical).
There is no third repository.

---

## 2. What was ported

| Area | Scope |
|---|---|
| `server/src/` | All 18 Beta domains: afc, auth, availability, calendar, ccc, data, doe, domain, history, master-refresh, perf, roles, runtime, scheduling, support, swap, teaching-assignment, trainees. 126 modules. |
| `server/foundation/` | Teaching-assignment authority and repository. |
| `server/tools/` | AFC import planner and source refresh. |
| `server/test/` | 128 Beta test suites plus 9 fixtures. |
| `database/azure-sql/` | Migrations **001–058** plus rollback scripts: 119 files. |
| `tools/` | `build/`, `master-refresh/`, and the four SQL acceptance scripts. |
| `swa-api/` | University API entry shim. |
| `server/package.json` | Added exceljs, jszip, pdf-lib, unzipper; pinned firebase-admin 13.10.0. |

Migration integrity: `001_foundation.sql`, `002_calendar_view.sql` and
`003_app_permissions.sql` remain **byte-identical** to the Beta blobs
(`9b3edebe`, `74a30b33`, `3ecb08da`). Nothing overwrote the pre-existing three.

---

## 3. The connection layer was rewritten, not ported

Beta's `sql-connection.js` resolves credentials through
`azure-active-directory-default` (managed-identity client id) or `msnodesqlv8`
(Windows integrated auth). This repository authenticates with an
`azure-active-directory-access-token` from the App Service local identity
endpoint. The credential paths are not interchangeable.

The **call convention**, however, is preserved exactly: the ported repositories
call `db.query(text, params)` and `db.transaction(() => ...)`, relying on
`AsyncLocalStorage` so a query issued anywhere inside the callback joins the open
transaction. Rewriting that across ~40 repository modules would have been a far
larger and riskier change than adapting this one file.

Properties added on top of Beta's behaviour, all tested:

- **One connection attempt even under concurrency.** A shared in-flight promise
  means a burst of parallel requests produces one pool, not one per request.
- **The pool is rebuilt before its bound token expires.** The access token is
  baked into the pool at construction, so a long-lived pool would fail every
  query once the token aged out. `expires_on` is tracked and the pool replaced
  ahead of it; with no expiry reported, a conservative 45-minute refresh is
  assumed.
- **Configuration is validated at composition time**, so a missing server or
  database fails at assembly instead of as a 500 on the first live read.

Not ported: `resolveSqlDriver`, `buildSqlConnectionConfig` and the ODBC /
managed-identity-client-id credential modes. They support deployment shapes this
repository does not use, and shipping dead credential paths would be worse than
documenting their absence. Their two test suites were removed accordingly.

---

## 4. Deliberate divergences from the Beta source

### 4.1 `other_office` — a security regression avoided

Beta's `server/src/auth/role-policy.js` builds `SUPPORTED_ROLES` from its
administrator, self-service and office sets. `other_office` is in **none** of
them, so `normalizeBaseRole('other_office')` returns `null` and the account is
treated as having no role at all.

That contradicts Beta's own `AGENTS.md`, which lists `other_office` as a formal
role, and it is directly incompatible with this repository, where `AGENTS.md`
lists it as formal and `sql-user-repository.js` issues it.

Ported verbatim, every `other_office` account would fall through to the
least-privileged branch. This port classifies it explicitly as an **office role**:
recognised as an identity, holding no administrator, general or self-service
capability.

Beta's own `server/test/role-policy.test.js` asserts that `other_office` is
unsupported. That assertion was **rewritten, with the reason stated inline in the
test**, rather than left failing or silently deleted.

### 4.2 Alias roles were unreachable in the Beta source

Beta maps `owner -> adfa_general`, `administrator -> adfa_regular`,
`admin -> adfa_regular`, but then checks membership in `SUPPORTED_ROLES`, which
does not contain the alias spellings. In Beta this is masked because
`ADMINISTRATOR_ROLES` happens to list `owner`, `administrator` and `admin`
literally. `editor` and `viewer` are mapped by this repository's shared frontend
helper and appear **nowhere** in Beta's table, so they were unreachable.

`ALIAS_ROLES` is derived from `Object.keys(NORMALIZED_ROLE)` so aliases are
recognised before normalisation. A legacy `editor` account collapses onto
`faculty` instead of losing its role.

### 4.3 Token verification lives in a second module

Beta's `createFirebaseSqlAuth({verifyIdToken, expectedProjectId})` returns decoded
claims and lets the caller resolve the SQL profile via `findUser(uid)`.

This repository's `auth/firebase-sql-auth.js` implements a different
"verify-and-provision-in-one-step" contract that `server/src/server.js` still
depends on. Beta's shape therefore lives in `auth/firebase-sql-verify.js` rather
than replacing it. Both are used; they are different contracts, not two versions
of one.

---

## 5. Test evidence

Run with Node 22.22.2 from the repository root.

| Suite | Result |
|---|---|
| `node --test server/test/*.test.js` | 981 tests: **946 pass, 31 fail, 4 skipped** |
| `node --test tests/*.test.js` (pre-existing repository suite) | 1045 tests: **932 pass, 112 skipped, 1 fail** — identical to before this work |

The root suite being unchanged is the evidence that the pre-existing Firestore
stack was not disturbed: `app.test.js`, `data-routes.test.js`,
`doe-routes.test.js`, `firebase-sql-auth.test.js` and `server-wiring.test.js` all
pass untouched.

The single root-suite failure is **pre-existing and environmental**:
`tests/hosting-boundary.test.js:77` shells out to
`tools/deploy_azure_static_web.ps1 -BuildOnly`, whose line 49 runs
`& node $builder`; in this environment `node` is not resolvable from the spawned
shell. Reproduced on a clean tree with these changes stashed.

### The 31 server failures, by cause

| Cause | Count | Detail |
|---|---|---|
| Needs a live SQL Server | ~20 | Migration acceptance, schema, and permission-grant assertions (`ccc-schedule-sql-acceptance`, `ccc-master-slots`, `scheduling-task-schema`, `faculty-admin-migration`, `p3b1/p3b2/p3b4-*`, `calendar-activity-runtime`, `calendar-activity-rollback`) |
| Needs the browser layer | 1 | `p2-teaching-assignment-ui-assets` reads `frontend/scripts/` |
| Server-Timing not wired | 5 | `sql-server-timing`, `me-server-timing` — the header is emitted by Beta's `university-http-server.js` entry, which this repository does not yet use |
| Other assertion mismatches | ~5 | `dashboard-api`, `trainee-api`, `adfa-swap-preview`, `calendar-import-timeout`, `calendar-activity-recovery-tools` |

**No failure was silenced by editing an assertion**, with the single documented
exception in §4.1, which is stated inline in the test itself.

---

## 6. Not ported

| Area | Size | Why |
|---|---|---|
| `frontend/` → browser application | 88 files, ~11,460 lines | Replacing `web/` wholesale would destroy the existing Firestore UI, which the migration brief requires preserving until each module is replaced and verified. This is the remaining major chunk and needs an explicit decision on page-by-page replacement versus wholesale swap. |
| `firestore.rules` / `firestore.indexes.json` | — | Beta's rules are a reduced set. `AGENTS.md` forbids replacing this repository's richer rules with them. |
| Beta connection-string credential modes | — | See §3. |

---

## 7. Blockers

1. **No reachable Azure SQL instance.** No migration, grant, stored procedure or
   query has been executed or verified. All SQL verification is against a fake
   driver, plus file-level assertions on the migration SQL text.
2. **No Firebase emulator run**, so security-rule behaviour is unverified.
3. **No deployment authorization.** Nothing here has been released or promoted.

---

## 8. Next phase order

Browser layer → Server-Timing wiring on the entry point → live SQL acceptance for
the ~20 migration/schema suites → then the DOE engine reconciliation (this
repository now carries both its own `shared/doe-policy/` engine and Beta's
`server/src/domain/` engine; they must be converged onto one, deliberately, with
the calculation policy reviewed rather than silently swapped).
