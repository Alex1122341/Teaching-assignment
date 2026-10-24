# Phase A — Shared Foundation

Status: **partially implemented** (foundation primitives only)
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
`firebase/`, `deploy/`. All Phase A work below is written against the **post-#88
layout**. Work started against the pre-#88 flat root layout would have needed a
wholesale relocation.

Note: `Alex1122341/Teaching-assignment` and
`UCVM-Teaching-Assignment/Teaching-assignment` are the **same repository** (the
former redirects to the latter; branch SHAs are identical). There is no third
repository.

---

## 2. Implemented in this phase

All paths are relative to the target repository root.

| File | Origin | Treatment |
|---|---|---|
| `server/src/data/academic-year.js` | Beta `server/src/data/academic-year.js` | Ported verbatim |
| `server/src/data/write-gates.js` | Beta `server/src/data/write-gates.js` | Ported verbatim |
| `server/src/perf/request-timing.js` | Beta `server/src/perf/request-timing.js` | Ported verbatim |
| `server/src/domain/person-name.js` | Beta `server/src/domain/person-name.js` | Ported verbatim (path matches `PAWS_CONSTITUTION.md`) |
| `server/src/auth/role-policy.js` | Beta `server/src/auth/role-policy.js` | **Adapted** — see §3 |
| `server/src/http/errors.js` | existing | Extended: fixed status mapping |
| `server/src/routes/data-routes.js` | existing | Extended: optional academic-year filter |
| `server/src/data/sql-connection.js` | Beta `server/src/data/sql-connection.js` | **Rewritten for this repository's auth mode** — see §3.4 |
| `server/src/data/sql-session-repository.js` | existing | Migrated onto the shared connection |
| `server/src/data/sql-user-repository.js` | existing | Migrated onto the shared connection |
| `server/test/foundation.test.js` | new | 15 contract tests |
| `server/test/sql-connection.test.js` | new | 9 contract tests |

### What each piece buys

- **Academic year.** The stored SQL vocabulary is `YYYY-YY` (`2026-27`).
  `2026-2027` previously matched nothing while still returning `200`. One
  function now decides the value: omitted → default, `2026-2027` → `2026-27`,
  malformed → `400 INVALID_ACADEMIC_YEAR`. Malformed input is never silently
  replaced by the default.
- **Write gates.** 27 per-domain capability flags, each closed unless its own
  environment variable is the literal `true`. Enabling AFC writes cannot enable
  Teaching Assignment publication.
- **Person name.** `Last name, First name` with idempotency, compound-surname
  preservation, placeholder protection, and semicolon-delimited list handling.
- **Request timing.** Allow-listed `Server-Timing` metrics; unknown names are
  dropped rather than escaped into a header.
- **Role policy.** Server-side counterpart to `web/js/core/faculty-access.js`.

---

## 3. Deliberate divergences from the Beta source

### 3.1 `other_office` — a security regression avoided

Beta's `server/src/auth/role-policy.js` builds `SUPPORTED_ROLES` from its
administrator, self-service and office sets. `other_office` appears in **none**
of them, so `normalizeBaseRole('other_office')` returns `null` and the account is
treated as having no role.

That is inconsistent with Beta's own `AGENTS.md`, which lists `other_office` as a
formal role, and with Beta's `faculty-access.js`, which labels it
`'Other Office'`. It is also directly incompatible with this repository, where
`AGENTS.md` lists `other_office` as formal and
`server/src/data/sql-user-repository.js` issues it.

Ported verbatim, every `other_office` account would silently fall through to the
least-privileged branch. This port therefore classifies it explicitly as an
**office role**: recognised as an identity, but holding no administrator, general
or self-service capability — matching Beta's documented intent that
`other_office` "must fail closed at this explicit capability boundary".

### 3.2 Alias roles were unreachable — a latent bug in the Beta source

Beta normalises `owner → adfa_general`, `administrator → adfa_regular`,
`admin → adfa_regular`, but then checks membership in `SUPPORTED_ROLES`, which
does not contain the alias spellings. In Beta this is masked because
`ADMINISTRATOR_ROLES` happens to list `owner`, `administrator` and `admin`
literally. `editor` and `viewer` are mapped by this repository's shared frontend
helper but appear nowhere in Beta's table at all, so they were unreachable.

`ALIAS_ROLES` is derived from `Object.keys(NORMALIZED_ROLE)` so the alias
spellings are recognised as inputs before normalisation. A legacy `editor`
account now collapses onto `faculty` instead of losing its role.

### 3.3 Academic year is opt-in on the existing route

`GET /api/data/sessions` previously had no academic-year filter at all. Making
`resolveAcademicYear` unconditional would have changed every existing response to
the default year's data. Instead the parameter is **opt-in**: omitted keeps the
current unfiltered semantics and the exact existing call shape
(`{start, end, facultyEmail}`), and a supplied value is canonicalised and passed
through. This is a deliberate deviation from Beta's defaulting behaviour, chosen
because silently narrowing an existing production read is worse than a missing
filter.

### 3.4 The SQL connection layer was rewritten, not ported

Beta's `sql-connection.js` resolves credentials through
`azure-active-directory-default` (a managed-identity client id) or
`msnodesqlv8` (Windows integrated auth). This repository authenticates with an
`azure-active-directory-access-token` fetched from the App Service local
identity endpoint. The two are not interchangeable, so the module was rewritten
around the existing token provider while keeping Beta's structural ideas:
one long-lived pool, serializable transactions, and validated configuration.

The defect being fixed: `sql-session-repository.js` and `sql-user-repository.js`
each constructed a `ConnectionPool`, ran one statement, and closed it in a
`finally`. Every request paid a full TCP + TLS + Azure AD handshake, and a
sign-in that issues four statements paid for four.

Two properties are load-bearing and tested:

- **One connection attempt, even under concurrency.** A shared in-flight promise
  means a burst of parallel requests produces one pool, not one per request.
- **The pool is rebuilt before its bound token expires.** The access token is
  baked into the pool at construction, so a long-lived pool would start failing
  every query once the token aged out. `expires_on` from the identity endpoint is
  tracked and the pool is replaced ahead of expiry. When the endpoint omits an
  expiry, a conservative 45-minute refresh is assumed rather than trusting the
  pool indefinitely.

Configuration is validated at composition time. A missing server or database now
fails when the service is assembled, not as a 500 on the first live read.

---

## 4. Test evidence

Run with Node 22.22.2 from the repository root.

| Suite | Result |
|---|---|
| `server/test/foundation.test.js` (new) | **15 / 15 pass** |
| `server/test/sql-connection.test.js` (new) | **9 / 9 pass** |
| `node --test server/test/*.test.js` | **160 / 160 pass** (136 pre-existing + 24 new) |
| `node --test tests/*.test.js` | 1045 tests: **932 pass, 112 skipped, 1 fail** |

The pre-existing `sql-user-repository.test.js` and `sql-session-repository.test.js`
suites pass **unmodified**, which is the evidence that migrating both
repositories onto the shared connection preserved their observable behaviour.

The single failure is `tests/hosting-boundary.test.js:77` — "Azure stages the
canonical config after the same generated lightweight build". It invokes
`pwsh.exe -File tools/deploy_azure_static_web.ps1 -BuildOnly`, whose line 49 calls
`& node $builder`; in this environment `node` is not resolvable from the spawned
PowerShell, so the script aborts.

**This failure is pre-existing and environmental.** It was reproduced on a clean
tree with all Phase A changes stashed, so it is not a regression. It was not
worked around by editing the script.

The 112 skips are the emulator-dependent suite; no Firebase emulator was run, so
**Firestore security-rule behaviour is unverified in this phase**.

---

## 5. Deferred, with reasons

| Item | Why deferred |
|---|---|
| Browser `PAWS_FACULTY_NAME` formatter + parity assertion | `PAWS_CONSTITUTION.md` requires the browser and server formatters to be identical and guarded by a parity assertion. Adding the browser file now would ship an asset no page references. It belongs with the frontend adoption, together with its `tools/static-assets.json` registration and the parity test. |
| `provision()` race in `sql-user-repository.js` | Read-then-insert; two concurrent first sign-ins can both pass the "email already linked" check. The connection now supports serializable transactions, which is the fix, but it alters the authentication path and cannot be validated without a reachable SQL instance. Left in place and documented in the code rather than silently changed. |
| Domain repositories (Faculty, Assignment, and the remaining domains) | The connection layer now exists; each domain repository still needs its SQL contract reviewed against live schema. |
| Write-gate enforcement inside route handlers | The gates exist and are tested, but no SQL write route exists yet in this repository to enforce them on. |
| API/SQL-level permission tests | Need a seeded database. |

---

## 6. Blockers

1. **No reachable Azure SQL instance.** All repository work so far is pure logic.
   No SQL query, migration, grant or stored procedure has been executed or
   verified.
2. **No Firebase emulator run**, so security-rule changes remain unverified.
3. **No deployment authorization.** Nothing here has been deployed; the branch is
   not a release candidate.

---

## 7. Next phase order (unchanged from the audit)

SQL/API and permission foundation → Teaching Assignment workflow → Calendar/CCC →
Dashboard/DOE → AFC/SWAP → History and remaining tools.
