# Calendar import timeout correction

**Goal:** Execute the already approved bounded source preview without the native SQL driver's15-second default cancellation.

**Evidence:** The unchanged real Preview procedure succeeded inside a rollback with a90-second SqlClient budget; unchanged native mssql/msnodesqlv8 canceled at15008ms with `Query timeout expired`. Installed mssql11.0.1 reads `pool.config.requestTimeout` and ignores request.timeout. A native pool90-second rollback comparison is running. No business migration occurred.

**Scope:** Existing approved Calendar import design and transactions only. No SQL/procedure/permission/gate changes, new retry, guessed target or automatic deletion. A distinct lazy SQL connection gives only stage/preview/commit a fixed90000ms budget. All identity, ordinary Calendar list/get/time evidence and other domain requests retain the ordinary pool. Close both pools at shutdown. Never mutate shared pool configuration per request.

## Steps

- [ ] Add failing tests in `server/test/calendar-import-timeout.test.js`: bounded constructor option reaches native pool config before connect; ordinary/shared config stays unchanged; invalid/zero/unbounded budgets reject; repository uses dedicated connection for only three imports; real runtime preview authorization/gate and both-pool shutdown.
- [ ] Add optional validated `requestTimeoutMs` to `createSqlConnection`, applied once to that private pool before connect; preserve default behavior.
- [ ] Add optional import connection to `createSqlCalendarActivityRepository`, route only three import commands to it. Wire a dedicated90000ms connection in runtime and close it with the ordinary one.
- [ ] Run focused existing authorization/repository/runtime/connection suites and native rollback comparison. Obtain independent product review. Commit product before a separately reviewed immutable promotion; protect the existing75 static/79 API inputs and historical assertions.
- [ ] Full tests, exact candidate/main CI and artifact checks, then authorized API release with gates unchanged. Refresh the one staged batch through authenticated API, preserve private manifest/recovery preparation, seek exact operation confirmation before commit.

The UI filter PR108 remains a separate accepted static release. This correction does not certify source migration or full Course Calendar/CCC replacement.
