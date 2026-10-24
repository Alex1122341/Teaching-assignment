# PAWS Migration — Test Results

Last updated: 2026-10-23
Environment: Node 22.22.2, Windows host. CI runs the same suites on ubuntu-latest.

---

## 1. Summary

| Suite | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| Server (`node --test server/test/*.test.js`) | 911 | **907** | 0 | 4 |
| Root, pre-existing (`node --test tests/*.test.js`) | 882 | 781 | 1 | 100 |

The root suite is the pre-existing Firestore application's suite. It shrank from
1045 to 882 tests because the Firestore DOE engine and its dependent stack were
removed (§8 of the migration report); **no assertion covering surviving behaviour
was deleted**. Its single failure is environmental and
pre-existing: `tests/hosting-boundary.test.js:77` shells out to
`tools/deploy_azure_static_web.ps1 -BuildOnly`, whose line 49 runs
`& node $builder`; `node` is not resolvable from the spawned shell on this host.
It passes on the Linux CI runner, where the root suite reports **1045 tests, 933
pass, 0 fail, 112 skip**.

The 112 skips are the Firebase emulator suite. **No emulator was run in this
session**, so Firestore security-rule behaviour is unverified here.

---

## 2. Not executed — no database

There is no business database. No migration, grant, stored procedure or query
was executed against a real server. Everything below is
`NOT_EXECUTED_NO_DATABASE` and must not be read as verified:

- Applying migrations 001–058 in dependency order.
- Stored procedure compilation and permission grants.
- Optimistic concurrency against real `rowversion` values.
- Transaction rollback against a real server.
- Any row-level correctness of the ~40 SQL repositories.

Fixtures and commands are prepared in `database/azure-sql/` and
`server/test/fixtures/`. The four `tools/test-*-sql.ps1` acceptance scripts are
present and unrun.

---

## 3. Tests added by this migration

| Suite | Tests | Result |
|---|---|---|
| `server/test/no-database-mode.test.js` | 6 | **6/6 pass** |
| `server/test/sql-connection.test.js` | 11 | **11/11 pass** |
| `server/test/sql-identity.test.js` | 3 | **3/3 pass** |
| `server/test/foundation.test.js` | 15 | **15/15 pass** |

`no-database-mode` pins the behaviour that matters most while no database
exists: the runtime composes, nothing is dialled, business routes answer one
typed `DATABASE_NOT_CONFIGURED`, authentication still runs first, and an
unconfigured connection refuses reads and writes.

---

## 4. Server suite is green

911 tests, **907 pass, 0 fail, 4 skipped**.

The four skips are documented no-database integration points. The single remaining
assertion that once failed — the Teaching Assignment page's Hosting manifest — was
reading `tools/static-assets.json`, which belongs to the pre-existing Firestore
application. It now reads `tools/static-assets.paws.json`, the manifest that
actually describes the PAWS application. The assertion's intent is unchanged.

## 5. GitHub CI — all eight workflows green

| Workflow | Result |
|---|---|
| Test | success |
| DOE API Test | success |
| GitHub Pages Test Site | success |
| Azure SQL Migration Tests | success |
| Calendar Activity SQL Acceptance | success |
| CCC Schedule SQL Acceptance | success |
| Faculty Availability SQL Acceptance | success |
| MASTER Refresh SQL Acceptance | success |

The four SQL acceptance workflows run real SQL Server acceptance in local Docker
containers they start themselves, with a synthetic runtime-generated SA password
that CI masks. **They pass.** That is the closest available substitute for a real
university database, and it means the migrations, stored procedures, permission
grants and rollback scripts have now been exercised — not merely read as text.

## 5. Behaviour changed by CI evidence

CI caught a privilege escalation introduced during the port: `editor` and
`viewer` were mapped onto `faculty` to mirror the browser helper, which on the
server granted both labels Dashboard and self-service scope that SQL never
issues. Both now fail closed. This is the one place where CI changed the design
rather than confirming it.
