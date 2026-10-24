# PAWS Migration — Test Results

Last updated: 2026-10-23
Environment: Node 22.22.2, Windows host. CI runs the same suites on ubuntu-latest.

---

## 1. Summary

| Suite | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| Server (`node --test server/test/*.test.js`) | 1018 | **1005** | 9 | 4 |
| Root, pre-existing (`node --test tests/*.test.js`) | 1045 | 932 | 1 | 112 |

The root suite is the pre-existing Firestore application's suite and is
**unchanged by this migration**. Its single failure is environmental and
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

## 4. The 9 remaining server failures

None was silenced by deleting a test or weakening an assertion. Two test files
that had been removed in an earlier revision of this work — the Beta
connection-string credential suites — were **restored**, and the code they
exercise was implemented instead.

| Failure | Cause | Classification |
|---|---|---|
| `recovery tools reject an artifact...`, `recovery verifies UTF-16LE content hash...`, `private export writes exact bytes with a protected Windows ACL`, `disposable rollback rehearsal...`, `review race runner rejects non-disposable targets`, `scheduling acceptance refuses a live server...` | Invoke a shell and assert on its exact refusal text; behaviour differs between this Windows host and the Linux runner | Shell/OS dependent |
| `unauthenticated, inactive, unsupported and unlinked faculty stop before SQL`, `ccc-schedule-sql-acceptance`, `authoritative snapshot JSON is deterministic...`, `local HTTP acceptance mounts the existing SQL health route` | Require a live SQL Server | `NOT_EXECUTED_NO_DATABASE` |
| `Teaching Assignment product page ships through Firebase Hosting` | Asserts the PAWS page is in the **published** Hosting manifest. Publication is deliberately not switched (see report §6). | Blocked on publication decision |

---

## 5. Behaviour changed by CI evidence

CI caught a privilege escalation introduced during the port: `editor` and
`viewer` were mapped onto `faculty` to mirror the browser helper, which on the
server granted both labels Dashboard and self-service scope that SQL never
issues. Both now fail closed. This is the one place where CI changed the design
rather than confirming it.
