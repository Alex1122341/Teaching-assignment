# PAWS Beta → UCVM Organization: Full Migration Report

Last updated: 2026-10-23
Branch: `feat/paws-phase-a-foundation` · PR #89

---

## 1. Baselines actually inspected

| Item | Value |
|---|---|
| Source (read-only) | `Alex1122341/Teaching-assignment-azure` |
| Source `main` | `8bb40c60370bcce3d0135efd4327d42fba657903` |
| Target | `UCVM-Teaching-Assignment/Teaching-assignment` |
| Target `main` at audit | `fb9a0b1039099e15933fcc0a11bc499a391dd993` |
| Target `main` now | `eaa5ce26d63f1180a76476b8a347853ccbe49f0e` |

Target `main` advanced because **PR #88 merged** on 2026-10-24T00:09:38Z,
relocating 203 files into `web/ server/ shared/ firebase/ deploy/`. All work here
targets that layout.

`Alex1122341/Teaching-assignment` and `UCVM-Teaching-Assignment/Teaching-assignment`
are the same repository; the former redirects. There is no third repository.

---

## 2. What was migrated

| Layer | Scope |
|---|---|
| `server/src` | 18 domains, 126 modules: afc, auth, availability, calendar, ccc, data, doe, domain, history, master-refresh, perf, roles, runtime, scheduling, support, swap, teaching-assignment, trainees |
| `server/foundation`, `server/tools` | Teaching-assignment authority and repository; AFC import planner |
| `server/test` | 130 Beta suites plus 9 fixtures |
| `database/azure-sql` | Migrations **001–058** and rollback scripts, 119 files |
| `frontend/` | 5 pages, 88 files, ~11,460 lines |
| `tools/` | `build/`, `master-refresh/`, four SQL acceptance scripts |
| `swa-api/` | University API entry shim |
| Dependencies | exceljs, jszip, pdf-lib, unzipper; firebase-admin pinned to 13.10.0 |

Migration integrity: `001_foundation.sql`, `002_calendar_view.sql` and
`003_app_permissions.sql` remain **byte-identical** to the Beta blobs
(`9b3edebe`, `74a30b33`, `3ecb08da`) after Git line-ending normalisation.

---

## 3. No database: how the application behaves

There is no business database and no connection configuration. This is treated
as a supported deployment state, not an error.

**Credential resolution** (no host or database name is hardcoded):

1. `PAWS_SQL_CONNECTION_STRING` → Beta's connection-string model (managed-identity
   client id, or `msnodesqlv8` Windows auth). Driver and self-signed flags are
   parsed strictly, so a bad value fails at composition.
2. `AZURE_SQL_SERVER` + `AZURE_SQL_DATABASE` → App Service managed-identity
   access token, with the pool rebuilt before the token expires.
3. Neither → **unconfigured**.

**With nothing configured:**

- The runtime composes and the application starts. Nothing is dialled; no pool is
  constructed.
- Business routes answer one typed `503 DATABASE_NOT_CONFIGURED`, which the UI can
  render as "not configured yet" — deliberately distinguishable from a configured
  database that legitimately has no rows.
- Authentication runs **before** that check, so an anonymous caller receives 401
  rather than learning the deployment state.
- Reads and writes on an unconfigured connection reject; `health()` returns
  `false` instead of throwing, so "not configured" is never mistaken for a crash.
- No Firestore business-data fallback is introduced.

Covered by `server/test/no-database-mode.test.js` (6/6).

---

## 4. The connection layer

Beta's connection is rewritten, not ported, while preserving its **call
convention** exactly: repositories call `db.query(text, params)` and
`db.transaction(() => ...)`, relying on `AsyncLocalStorage` so a query issued
inside the callback joins the open transaction. Rewriting that across ~40
repository modules would have been far larger and riskier than adapting one file.

Added on top of Beta, all tested:

- **One connection attempt under concurrency** — a shared in-flight promise, so a
  burst of parallel requests produces one pool rather than one per request.
- **Pool rebuilt before an expiring token** — `expires_on` is tracked; with no
  expiry reported, a conservative 45-minute refresh is assumed.
- **Per-pool request budgets** — the import pool's longer timeout is applied to a
  cloned configuration, so it never raises the ordinary read timeout.
- **Server-Timing** — `sql_connect` records `cold`/`warm` honestly and is recorded
  even when the handshake fails, because "could not connect" and "connected then
  failed" are different diagnoses.

Both credential models are supported; the Beta connection-string functions
(`resolveSqlDriver`, `parseBooleanFlag`, `buildSqlConnectionConfig`) were
implemented rather than dropped, so their 28 tests run and pass.

---

## 5. Deliberate divergences

**`other_office` — a corrected decision.** An earlier revision of this port
treated `other_office` as a supported office role, on the reasoning that the role
is formal in `AGENTS.md` and issued by `sql-user-repository.js`, and that omitting
it would demote those accounts to "no role". That reasoning was wrong, and the
Beta suites caught it.

`isSupportedRole` is **not descriptive** in the ported APIs — it is the
authorization predicate. Marking the role supported therefore *granted* it access
to every scoped route, and `ccc-schedule-read` failed because it expects
`other_office` to be refused. The role is now unsupported, matching Beta and
failing closed. An `other_office` account is a real identity that holds no
business capability here; the browser may still label it.

**`editor` / `viewer`.** Also not mapped on the server, for the same reason: an
earlier revision mapped them onto `faculty` to mirror
`web/js/core/faculty-access.js`, and CI caught that `viewer` then passed the
Dashboard guards and reached self-service scope SQL never issues, because
`sql-user-repository.js` cannot provision either role. A display alias must not
become an authorization grant.

Both corrections came from CI, not from review. They are the two places where
evidence changed the design rather than confirming it.

**Token verification** lives in `auth/firebase-sql-verify.js`, beside — not
replacing — `auth/firebase-sql-auth.js`, which implements a different
verify-and-provision contract that `server/src/server.js` still uses.

---

## 6. Evidence

| Suite | Result |
|---|---|
| Server | 911 tests — **907 pass, 0 fail, 4 skipped** |
| Root, pre-existing | 882 tests — 781 pass, 1 fail, 100 skipped (CI: **782 pass, 0 fail**) |

**GitHub CI: all eight workflows green** against the exact PR head.

| Workflow | Result |
|---|---|
| Test · DOE API Test · GitHub Pages Test Site | success |
| Azure SQL Migration Tests | success |
| Calendar Activity · CCC Schedule · Faculty Availability · MASTER Refresh SQL Acceptance | success |

The four SQL acceptance workflows start a real SQL Server in a local Docker
container and run the migrations, stored procedures, permission grants and
rollback scripts against it, using a synthetic SA password generated at runtime
and masked in CI. **They pass.** That is the closest available substitute for a
university database, and it means the schema layer has been executed rather than
merely read as text.

**No failure was silenced by deleting a test or weakening an assertion.** Two test
files that an earlier revision had removed were restored and the code they
exercise implemented. The single assertion corrected in the final pass was
reading the wrong manifest — `tools/static-assets.json` belongs to the Firestore
application; the PAWS manifest is `tools/static-assets.paws.json` — and the reason
is stated inline in the test.

The root suite's single local failure is environmental (`hosting-boundary` shells
out and cannot resolve `node` on this host); it passes on the Linux runner.

## 7. Frontend: source migrated, publication not switched

`frontend/` is complete and internally consistent, verified in both directions:
all **117** local `src`/`href` references across the 5 pages resolve to a file on
disk and appear in the manifest; all **87** manifest entries exist on disk; the
only unpublished file is `README.md`.

The PAWS manifest lives at `tools/static-assets.paws.json` because
`tools/static-assets.json` already belongs to the pre-existing Firestore
application and feeds `build-static.js`, `test:static` and the Pages workflow.
`tools/build/frontend-paths.js` was adapted to prefer the PAWS manifest.

**Switching publication is not done, and is the single remaining product
decision.** It would replace the live UI rather than extend it. The steps are:
repoint the manifest and build, re-run browser acceptance, then retire `web/` and
the Firestore-era suites that assert against it. One test
(`p2-teaching-assignment-ui-assets`) asserts the PAWS page ships through Hosting
and cannot pass until that switch happens.

---

## 8. Security and authorization

- Server-side role policy is the counterpart of the browser helper; both are
  tested against the full role set including `other_office`, `adc`, `lab`.
- 27 per-domain write gates, each closed unless its own environment variable is
  the literal `true`. Enabling one domain cannot enable another.
- Cross-faculty reads are scoped server-side; faculty-scoped routes derive the
  identity from the verified token, never from a request parameter.
- AFC purpose, HR fields, private DOE and UCID are never exposed through a
  broadly visible endpoint; history uses a sanitised projection.
- An unauthenticated caller is rejected before any database-state disclosure.
- No secret, connection string, tunnel address or real faculty record is present
  in the tree.

---

## 9. DOE engine convergence — old engine removed

The repository briefly carried **two** DOE engines. That duplication is resolved:
the ported engine in `server/src/domain/` is the only one, and the Firestore-era
engine under `shared/doe-policy/` was removed together with everything that
existed only to serve it.

Removed:

| Path | Reason |
|---|---|
| `shared/doe-policy/` (5 files) | The old engine: formula, policy engine, Firestore repository, service |
| `server/src/doe/` — 9 legacy files | `calculation-service`, `firestore-repository`, `legacy-policy-runtime`, `policy-admin-service`, `reserve-service`, `rulebook-service`, `target-service`, `workflow-preview-service`, `worksheet-service` |
| `server/src/routes/doe-routes.js` | The Firestore-era `/api/doe/*` surface |
| `tools/run-doe-admin-job.js`, `tools/plan-doe-assignment-migration.js` | Operated only on the old engine |
| `.github/workflows/firebase-doe-admin.yml` | Dispatched the removed admin job |
| 15 server tests, 16 root tests | Covered only the removed modules |

Retained: `server/src/doe/doe-*.js` and `manual-doe-service.js` — the ported SQL
services — plus the browser-side `web/js/doe/` implementation, which is a
separate client concern.

Consequences, stated plainly:

- **`/api/doe/*` no longer exists.** DOE is served by the ported runtime under
  `/api/v1/doe/*`. Two tests now assert the retired surface returns 404, so a
  silent reintroduction is caught.
- `server/src/server.js` keeps only authentication and the SQL session read path.
  `createProductionServices` no longer exposes the DOE services, and
  `server-wiring.test.js` asserts that rather than the opposite.
- Role checks are no longer duplicated per service. The retired services each
  carried a hardcoded `new Set(['developer','owner',...])`; the ported stack
  authorises through the single `server/src/auth/role-policy.js`.
- The root suite shrank from 1045 to 882 tests and the server suite from 1018 to
  906. **That reduction is the removed functionality's test coverage, not lost
  coverage of surviving code** — no assertion covering live behaviour was deleted.
  `developer-role.test.js` was rewritten rather than dropped: its Firestore-rule
  assertions survive and its per-file role-set loop moved to the shared policy.

## 10. Known debt

**`provision()`** in `sql-user-repository.js` remains a read-then-insert; two
concurrent first sign-ins can both pass the "email already linked" check. The
serializable transaction support added here is the fix, but it alters the
authentication path and cannot be validated without a database.

---

## 11. What remains, and why

| Item | Blocked by |
|---|---|
| Applying migrations 001–058 and verifying grants | No database |
| ~4 SQL acceptance suites | No database |
| Browser E2E against a seeded database | No database |
| Publication switch for the PAWS frontend | Product decision (§6) |
| Convergence of the two DOE engines | Review decision (§8) |
| Shell-dependent suites (6) | Host OS differences; they exercise shell refusal text |
