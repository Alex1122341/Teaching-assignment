# PAWS Beta Azure SQL via Static Web Apps Managed Functions

Date: 2026-09-25  
Status: Approved in chat; written-spec review required before implementation  
Repository: `Alex1122341/Teaching-assignment`  
Related migration repository: `Alex1122341/Teaching-assignment-azure`

## 1. Decision

For the PAWS beta, do not require a separate Azure App Service before Azure SQL can be used.

Instead, use the existing Azure Static Web App `ucvm-teaching-lab-web` and its managed Azure Functions support as a thin same-origin server-side bridge between the browser and Azure SQL.

The browser must not open a SQL connection directly and must not receive SQL credentials.

The beta runtime becomes:

```text
PAWS browser
   |
   | Firebase Authentication / ID token
   | same-origin HTTPS /api/*
   v
Azure Static Web Apps Managed Functions
   |
   | server-side Azure SQL connection
   v
Azure SQL
  paws.*       beta business data
  staging.*    migration evidence only
```

The existing App Service + managed-identity design from the 2026-09-24 Azure SQL cutover remains the preferred later production-grade target. This design changes the beta hosting path, not the database model or the long-term trust boundary.

## 2. Why this change is needed

The current Azure subscription is a Free Trial subscription with spending limit enabled.

Observed App Service quota evidence shows:
- the attempted F1 Linux App Service Plan creation failed because F1 quota is 0;
- Canada Central has F1/B1/B2/B3/S1 quota 0;
- the reviewed F1-capable regions produced no region with F1 limit greater than 0;
- the existing Static Web App is already present, is on the Free SKU, and is healthy enough to retain as the beta frontend host.

The beta goal is functional testing and continued product development. It is acceptable for the beta to use a lower-security server-side database credential model than the eventual managed-identity runtime, provided:
- credentials remain server-side only;
- the browser cannot query SQL directly;
- the SQL principal is least-privilege;
- Firestore remains available as a rollback/fallback path during the transition;
- the migration evidence and Azure SQL schema remain unchanged.

## 3. Repository responsibilities

### `Teaching-assignment`

This remains the PAWS product source of truth.

It owns:
- frontend behavior;
- Firebase Authentication integration;
- PAWS business logic;
- server-side route/auth/repository code;
- Static Web Apps build/deploy configuration;
- managed-function adapter code;
- browser and integration tests;
- beta routing between Firestore and Azure SQL.

### `Teaching-assignment-azure`

This remains the Azure migration/integration/acceptance repository.

It owns:
- workbook-to-SQL migration tooling;
- raw and typed staging preservation;
- canonical normalization;
- schema/migration acceptance;
- loader/reset safety;
- import validation evidence;
- migration-specific runbooks.

The two repositories must not diverge into separate PAWS products.

The relationship is:

```text
Teaching-assignment-azure
  proves migration correctness
          |
          v
Teaching-assignment
  consumes the accepted Azure SQL model
  and runs the beta application
```

## 4. Existing Azure resources to retain

Do not create replacement copies of existing resources merely to implement this beta path.

Retain:
- Static Web App: `ucvm-teaching-lab-web`
- Static Web App host: `red-cliff-04871ca0f.5.azurestaticapps.net`
- SQL server: `ucvm-teaching-lab-xz-20260911.database.windows.net`
- SQL database: `teaching-assignment-lab`

The existing SQL migration result remains valid.

The runtime application must use `paws.*` only. It must not use `staging.*`.

## 5. Authentication and authorization

Firebase Authentication remains the user-authentication provider.

Browser flow:

1. User signs in with Firebase Authentication.
2. Browser obtains the Firebase ID token.
3. Browser calls same-origin `/api/*` on the Azure Static Web App.
4. Managed Function verifies the Firebase ID token.
5. Function resolves the PAWS user/profile and role.
6. Function performs the authorized Azure SQL operation.
7. Function returns only the allowed response fields.

The browser cannot select or elevate its own PAWS role.

Existing SQL-backed identity code from PR #78 should be reused where practical rather than reimplemented with different semantics.

## 6. Database connection model for beta

The managed-function runtime cannot rely on the App Service managed-identity path that was designed in PR #77-#81.

For the beta only, use a dedicated least-privilege Azure SQL credential stored in Static Web Apps server-side Application Settings.

Recommended configuration contract:

```text
PAWS_SQL_CONNECTION_STRING=<server-side only>
PAWS_SQL_READS=on
PAWS_SQL_AUTH=on
FIREBASE_PROJECT_ID=<approved project>
```

Rules:
- never emit the SQL connection string into frontend JavaScript;
- never commit it to GitHub;
- never place it in public build artifacts;
- never use an administrator-level database login;
- grant only the minimum `paws.*` permissions required by the beta functions;
- grant no access to `staging.*`;
- rotate the credential when moving away from this beta architecture.

If the credential cannot be configured with least privilege, implementation must stop and revisit the connection model rather than embedding broader credentials.

## 7. No browser-to-SQL direct connection

"Frontend uses Azure SQL" means the browser's application data comes from Azure SQL through same-origin managed functions.

It does not mean:

```text
browser JavaScript -> SQL TCP/TDS connection
```

The following are prohibited:
- SQL usernames/passwords in frontend code;
- SQL connection strings in `firebase-config.js` or other public config;
- generic SQL/query endpoints that accept arbitrary SQL from the browser;
- direct browser access to `staging.*`;
- exposing an administrative SQL endpoint for convenience.

The managed function is a thin server-side boundary, even though it is hosted inside the Static Web Apps deployment rather than as a separate App Service.

## 8. Reuse of current server code

PR #77 and PR #78 already added important reusable logic:
- Firebase token verification;
- SQL-backed session repository;
- SQL-backed user/profile repository;
- `/api/v1/me`;
- `/api/v1/sessions`;
- role-aware session filtering;
- SQL mapping and query boundaries.

The managed-function implementation should reuse those services and repositories rather than create a parallel second implementation.

The hosting adapter changes; the domain/repository semantics should not.

The implementation plan should prefer one of these patterns:
1. shared environment-neutral service modules consumed by both Node server and SWA function entrypoints; or
2. a staging/build step that packages the existing server modules into the managed-function API artifact.

Do not copy/paste large service implementations into a second tree.

## 9. Beta endpoint scope

The first accepted managed-function slice should be deliberately small.

Minimum initial endpoints:

```text
GET /api/v1/me
GET /api/v1/sessions?start=YYYY-MM-DD&end=YYYY-MM-DD
GET /api/health/sql
```

Acceptance for the first slice:
- authenticated user identity resolves correctly;
- SQL session reads match the expected canonical rows;
- Faculty-shaped roles receive only their permitted data;
- the function can connect to Azure SQL;
- no Firestore write is required for these endpoints.

After that slice is proven, add business domains in reviewable increments:
- faculty directory/profile;
- timetable/session writes;
- role assignments;
- AFC;
- workflow/work queue;
- audit/My Changes;
- DOE persisted data.

## 10. Primary-vs-fallback rule during beta

Azure SQL becomes primary only for a domain after that domain's SQL path passes acceptance.

Firestore may remain available as rollback/fallback during migration, but do not dual-write the same business mutation to both stores.

For each domain, runtime mode must be explicit:

```text
firestore
or
azure-sql
```

A domain must never silently write to SQL and Firestore in the same normal operation.

This avoids partial-success consistency failures.

A temporary beta may therefore be hybrid by domain while migration is in progress, for example:

```text
Identity/profile      -> Azure SQL
Session reads         -> Azure SQL
Session writes        -> Firestore until accepted
AFC                   -> Firestore until accepted
DOE                   -> current approved path until accepted
```

This supersedes the "no hybrid Azure release" restriction from the 2026-09-24 cutover design for the beta only.

The final production cutover target still requires one authoritative persistence path per released business domain.

## 11. Frontend adapter requirement

The browser should not spread storage-specific conditionals throughout feature files.

Introduce or extend a shared data-access boundary so UI modules call domain operations rather than Firestore directly.

Example conceptual interface:

```text
PAWS_DATA.currentUser()
PAWS_DATA.listSessions(range)
PAWS_DATA.updateSession(change)
PAWS_DATA.listFaculty()
PAWS_DATA.listAfc(...)
```

The adapter chooses the configured beta backend for that domain.

This gives:
- one controlled migration switch;
- easier browser smoke testing;
- easier rollback;
- a path to later remove Firestore business access;
- no requirement to rewrite all UI behavior at once.

## 12. Error handling and rollback behavior

If a managed-function SQL request fails:
- do not silently write to Firestore as an automatic fallback;
- surface a controlled backend-unavailable error;
- log a server-side diagnostic without secrets;
- keep retry behavior bounded;
- allow an operator-controlled configuration rollback to the Firestore implementation if necessary.

Rollback is configuration/release based, not per-request dual persistence.

No SQL error response may expose:
- connection strings;
- database credentials;
- raw SQL;
- protected UCIDs/emails beyond the caller's authorization;
- stack traces in normal browser responses.

## 13. Firestore role during this beta

Firestore is not deleted.

It remains useful for:
- rollback while SQL domain coverage is incomplete;
- comparison/acceptance where explicitly authorized;
- existing beta workflows that have not yet migrated;
- backup/recovery support already maintained by the user.

Do not delete Firestore collections or weaken Firestore rules as part of this managed-function work.

Once a domain is accepted on Azure SQL, new feature development for that domain should target the SQL-backed data boundary rather than add new direct Firestore dependencies.

## 14. Azure SQL role

Azure SQL is no longer only a passive migration target once the first managed-function slice is accepted.

For accepted beta domains, it becomes the live beta source of truth.

The existing migration invariants remain:
- `paws.*` is canonical application data;
- `staging.*` is source/migration evidence;
- former-Faculty exclusions and source validation decisions stay intact;
- no normalization rule is changed merely to make runtime code easier.

The current canonical migration baseline remains:
- 120 Faculty/pool/vacancy records;
- 1,937 Sessions;
- 4,970 SessionAssignments;
- 791 AFC records;
- 162 RoleAssignments;
- 14 reviewed validation issues.

## 15. Static Web Apps deployment model

The current Static Web App remains the frontend host.

The implementation must configure the Static Web Apps build so the managed-function API artifact is deployed together with the accepted frontend artifact.

Requirements:
- normal frontend build behavior remains reproducible;
- API dependencies are installed deterministically;
- the function artifact contains only required server modules;
- no private workbook/import package is included;
- no SQL secret is written into the artifact;
- API and frontend are tested together before beta deployment.

The existing Azure frozen-runtime controls must be reviewed before changing protected shipped assets. Do not disable freeze checks merely to add the managed-function API.

## 16. Testing strategy

Implementation must use TDD for each migration step.

### Unit/contract tests
Cover:
- Firebase token verification;
- SQL credential/config loading without exposing secrets;
- user/profile authorization;
- session query filtering;
- SQL mapping;
- managed-function request/response adapter;
- explicit backend routing by domain.

### Integration tests
Use a testable SQL repository boundary and exercise:
- `/api/v1/me`;
- `/api/v1/sessions`;
- invalid/missing token behavior;
- unauthorized data requests;
- SQL-unavailable behavior.

### Build/deployment tests
Prove:
- the SWA artifact includes the API;
- frontend config contains no SQL secret;
- API settings are runtime-only;
- managed-function package can load its dependencies;
- static frontend build remains valid.

### Browser acceptance
At minimum:
- Firebase sign-in succeeds;
- current-user endpoint succeeds;
- timetable reads sessions from Azure SQL;
- role-restricted user sees the correct session scope;
- refresh/navigation remains functional;
- intentionally unavailable SQL produces a controlled UI error;
- switching a domain back to Firestore through reviewed configuration restores the previous beta behavior.

## 17. Security level for beta

This beta design intentionally accepts one reduced-security property:

- the function uses a server-side SQL credential instead of managed identity.

It does not accept:
- browser-visible database credentials;
- direct browser SQL access;
- broad database owner permissions;
- anonymous business endpoints;
- bypassing Firebase token verification;
- access to `staging.*`;
- automatic dual writes.

The future production-grade improvement remains:

```text
SWA frontend
   ->
App Service or independent Function App
   ->
Managed Identity
   ->
Azure SQL
```

The beta work should preserve interfaces so that later hosting change does not require another frontend/business-logic rewrite.

## 18. Superseded parts of the 2026-09-24 design

The following parts of `2026-09-24-azure-sql-cutover-design.md` are superseded for beta operation:

1. A separate Azure App Service is not required before beta SQL use.
2. App Service managed identity is not required for the beta SQL bridge.
3. A temporary hybrid-by-domain beta is allowed while migration coverage is incomplete.
4. Beta cutover can happen incrementally by domain rather than as one all-at-once Firestore exit.

The following parts remain authoritative:
- Firebase Authentication remains;
- browser does not connect directly to SQL;
- `paws.*` is the application schema;
- `staging.*` is inaccessible to application runtime;
- workbook migration/provenance rules;
- canonical identity/naming rules;
- DOE/business semantics;
- role-based authorization;
- eventual removal of Firestore business persistence from the final Azure runtime.

## 19. Initial implementation boundary

The first implementation PR after this spec is approved must not attempt the entire Firestore exit.

It should implement only:
- managed-function hosting skeleton;
- server-side configuration contract;
- Firebase token verification reuse;
- Azure SQL connection/repository reuse;
- `GET /api/health/sql`;
- `GET /api/v1/me`;
- `GET /api/v1/sessions`;
- a frontend read adapter sufficient to prove timetable/session reads through Azure SQL;
- tests and beta-only deployment wiring.

No AFC, workflow, DOE write migration, or mass Firestore removal belongs in the first implementation PR.

## 20. Success criteria for the first beta SQL slice

The first slice is accepted only when:

- the existing Free Static Web App deploys the managed-function API without creating a separate App Service;
- no App Service Plan quota is required for that deployment path;
- Firebase-authenticated browser requests reach the managed functions;
- managed functions can connect to `teaching-assignment-lab`;
- SQL credentials are absent from browser/runtime static assets and repository history;
- the SQL runtime identity cannot access `staging.*`;
- `/api/v1/me` resolves the authenticated PAWS profile;
- `/api/v1/sessions` returns authorized canonical session data;
- the beta timetable can read those sessions through the shared data adapter;
- Firestore remains intact and available for rollback;
- no automatic dual-write path exists;
- all new tests and existing repository CI pass.

Only after this slice is accepted should the next business domain be migrated.
