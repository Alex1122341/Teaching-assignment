# PAWS SWA Managed Functions Azure SQL Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the first PAWS beta Azure SQL slice through the existing Azure Static Web App by adding same-origin Managed Functions for authenticated identity and session reads, while keeping SQL credentials server-side and preserving Firestore as the rollback path.

**Architecture:** Reuse the SQL repositories and Firebase-token authorization already merged in PR #77/#78, but replace the App Service-only managed-identity connection assumption with a shared SQL pool runner that can use either managed identity or a server-side connection string. Package the same server modules into a Static Web Apps Managed Functions artifact, route `/api/v1/me`, `/api/v1/sessions`, and `/api/health/sql` through that artifact, then let the Azure beta frontend opt into SQL session reads through one shared browser data client. The initial SQL session slice is deliberately read-only: when the session backend is `azure-sql`, session mutation controls fail closed until a later reviewed SQL-write slice exists.

**Tech Stack:** Vanilla browser JavaScript, Node.js 22, Azure Static Web Apps Free, Azure Functions Node.js programming model v4, `@azure/functions@4.16.5`, `firebase-admin@14.4.0`, `mssql@12.7.2`, Firebase Authentication, Azure SQL, Node `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-25-swa-managed-functions-azure-sql-beta-design.md`

## Global Constraints

- Keep `Alex1122341/Teaching-assignment` as the PAWS product source of truth.
- Keep `Alex1122341/Teaching-assignment-azure` as the Azure SQL migration/acceptance source of truth.
- Reuse the existing Static Web App `ucvm-teaching-lab-web`; do not create a new App Service for this beta slice.
- Reuse Azure SQL server `ucvm-teaching-lab-xz-20260911.database.windows.net` and database `teaching-assignment-lab`.
- Firebase Authentication remains the browser authentication provider.
- Browser JavaScript must never receive SQL credentials or `FIREBASE_SERVICE_ACCOUNT_JSON`.
- Managed Functions may access only the reviewed `paws.*` objects required by this slice; they receive no `staging.*` access.
- `PAWS_SQL_CONNECTION_STRING` and `FIREBASE_SERVICE_ACCOUNT_JSON` are Static Web Apps server-side Application Settings only.
- Do not add generic SQL/query endpoints and do not accept arbitrary SQL from browser requests.
- No automatic SQL/Firestore dual write.
- When session backend is `azure-sql`, session mutation controls fail closed until a later SQL-write slice is implemented.
- Firestore data and rules remain intact as rollback/fallback; do not delete collections or weaken rules.
- Static Web Apps API runtime is `node:22`.
- The first slice includes only `GET /api/health/sql`, `GET /api/v1/me`, `GET /api/v1/sessions`, frontend session reads, deployment wiring, and explicit read-only session guards.
- Do not migrate AFC, workflow, DOE writes, or bulk-remove Firestore access in this plan.

## Review Focus

- **Missing/invalid server secrets:** missing SQL connection string or Firebase Admin service-account JSON must fail closed with a controlled configuration error.
- **Firebase project mismatch:** `FIREBASE_SERVICE_ACCOUNT_JSON.project_id` must match `FIREBASE_PROJECT_ID`; mismatch stops runtime initialization before SQL access.
- **SQL read/write split:** when `UCVM_PAWS_SESSION_BACKEND === 'azure-sql'`, Add/Edit/Delete/Swap/multi-edit entry points must not write Firestore or present stale editable state.
- **API deployment handoff:** the manually deployed artifact must contain both the exact tested frontend and exact tested Managed Functions source; deployment must not rebuild the frontend from mutable repository state.
- **Backend outage:** failed SQL/API reads surface a controlled unavailable state and never silently fall back to Firestore.

---

## File Structure

### New shared server/runtime files
- `server/src/data/sql-connection.js` — shared SQL pool runner supporting connection-string and managed-identity modes.
- `server/src/data/data-api.js` — transport-neutral SQL health/current-user/session API.
- `server/src/auth/firebase-admin.js` — shared Firebase Admin parsing/initialization.
- `server/src/runtime/swa-sql-runtime.js` — constructs Auth + SQL repositories + data API.
- `server/src/runtime/swa-functions.js` — Azure Functions v4 route registration adapter.

### New SWA API packaging files
- `swa-api/package.json`
- `swa-api/package-lock.json`
- `swa-api/host.json`
- `swa-api/index.js`
- `tools/build-swa-api.js`

### New frontend boundary
- `paws-data-client.js`
- `tests/paws-data-client.test.js`

### Existing files touched
- `server/src/data/sql-session-repository.js`
- `server/src/data/sql-user-repository.js`
- `server/src/server.js`
- `server/src/app.js`
- `firebase-config.js`
- `tools/build-firebase-config.js`
- `tools/static-assets.json`
- `index.html`
- `timetable.js`
- `staticwebapp.config.json`
- `.github/workflows/azure-static-web-apps.yml`
- `.github/workflows/azure-production-deploy.yml`
- `tests/azure-deployment.test.js`
- `SETUP.md`

---

### Task 1: Add a shared SQL connection runner with beta connection-string support

**Files:**
- Create: `server/src/data/sql-connection.js`
- Modify: `server/src/data/sql-session-repository.js`
- Modify: `server/src/data/sql-user-repository.js`
- Test: `server/test/sql-connection.test.js`
- Test: `server/test/sql-session-repository.test.js`
- Test: `server/test/sql-user-repository.test.js`

**Interfaces:**
- Produces: `createSqlPoolRunner({sqlModule, connectionString, tokenProvider, server, database}) -> async run(work)`
- Produces: `appServiceManagedIdentityToken({env, fetchImpl}) -> Promise<string>`
- Consumed by both SQL repositories.
- Preserves managed identity when `connectionString` is empty.

- [ ] **Step 1: Write the failing connection-string tests**

Create `server/test/sql-connection.test.js` with:

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSqlPoolRunner}=require('../src/data/sql-connection.js');

test('SQL pool runner uses server-side connection string without managed identity',async()=>{
  const seen=[];
  class ConnectionPool{
    constructor(config){seen.push(config)}
    async connect(){return this}
    async close(){}
  }
  const run=createSqlPoolRunner({
    sqlModule:{ConnectionPool},
    connectionString:'Server=tcp:example.database.windows.net,1433;Database=teaching-assignment-lab;User ID=paws_swa_beta;Password=secret;Encrypt=True;TrustServerCertificate=False;',
    tokenProvider:async()=>{throw Error('managed identity must not run')}
  });
  await run(async()=>true);
  assert.equal(typeof seen[0],'string');
  assert.match(seen[0],/^Server=tcp:/);
});

test('SQL pool runner keeps managed identity when connection string is absent',async()=>{
  const seen=[];
  class ConnectionPool{
    constructor(config){seen.push(config)}
    async connect(){return this}
    async close(){}
  }
  const run=createSqlPoolRunner({
    sqlModule:{ConnectionPool},
    connectionString:'',
    tokenProvider:async()=> 'entra-token',
    server:'server.database.windows.net',
    database:'db'
  });
  await run(async()=>true);
  assert.equal(seen[0].authentication.type,'azure-active-directory-access-token');
  assert.equal(seen[0].authentication.options.token,'entra-token');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test server/test/sql-connection.test.js
```

Expected: FAIL because `sql-connection.js` does not exist.

- [ ] **Step 3: Implement `sql-connection.js`**

```js
'use strict';

const DEFAULT_SERVER='ucvm-teaching-lab-xz-20260911.database.windows.net';
const DEFAULT_DATABASE='teaching-assignment-lab';
const SQL_RESOURCE='https://database.windows.net/';
const text=value=>String(value??'').trim();

async function appServiceManagedIdentityToken({env=process.env,fetchImpl=globalThis.fetch}={}){
  const endpoint=text(env.IDENTITY_ENDPOINT),header=text(env.IDENTITY_HEADER);
  if(!endpoint||!header||typeof fetchImpl!=='function'){
    throw Object.assign(Error('Azure App Service managed identity is not available.'),{code:'SQL_IDENTITY_UNAVAILABLE',statusCode:503});
  }
  const url=new URL(endpoint);
  url.searchParams.set('resource',SQL_RESOURCE);
  url.searchParams.set('api-version','2019-08-01');
  const response=await fetchImpl(url,{method:'GET',headers:{'X-IDENTITY-HEADER':header}});
  if(!response.ok)throw Object.assign(Error('Azure managed identity token request failed.'),{code:'SQL_IDENTITY_TOKEN_FAILED',statusCode:503});
  const payload=await response.json();
  const token=text(payload?.access_token);
  if(!token)throw Object.assign(Error('Azure managed identity returned no SQL access token.'),{code:'SQL_IDENTITY_TOKEN_MISSING',statusCode:503});
  return token;
}

function createSqlPoolRunner({
  sqlModule=null,
  connectionString='',
  tokenProvider=appServiceManagedIdentityToken,
  server=DEFAULT_SERVER,
  database=DEFAULT_DATABASE
}={}){
  const secret=text(connectionString),serverName=text(server)||DEFAULT_SERVER,databaseName=text(database)||DEFAULT_DATABASE;
  return async function run(work){
    const sql=sqlModule||require('mssql');
    const config=secret?secret:{
      server:serverName,
      database:databaseName,
      port:1433,
      options:{encrypt:true,trustServerCertificate:false,enableArithAbort:true},
      authentication:{type:'azure-active-directory-access-token',options:{token:await tokenProvider()}}
    };
    const pool=new sql.ConnectionPool(config);
    await pool.connect();
    try{return await work(pool,sql)}
    finally{try{await pool.close()}catch{}}
  };
}

module.exports={DEFAULT_SERVER,DEFAULT_DATABASE,SQL_RESOURCE,appServiceManagedIdentityToken,createSqlPoolRunner};
```

- [ ] **Step 4: Refactor both SQL repositories to use `poolRunner`**

Keep all existing SQL text/mapping unchanged. Constructor pattern:

```js
function createSqlSessionRepository({poolRunner=null,sqlModule=null,tokenProvider,connectionString='',server=DEFAULT_SERVER,database=DEFAULT_DATABASE}={}){
  const run=poolRunner||createSqlPoolRunner({sqlModule,tokenProvider,connectionString,server,database});
  // ping/listSessions use run(async(pool,sql)=>...)
}
```

Apply the same pattern to `createSqlUserRepository`.

- [ ] **Step 5: Run GREEN**

```bash
node --test server/test/sql-connection.test.js server/test/sql-session-repository.test.js server/test/sql-user-repository.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/data/sql-connection.js server/src/data/sql-session-repository.js server/src/data/sql-user-repository.js server/test/sql-connection.test.js server/test/sql-session-repository.test.js server/test/sql-user-repository.test.js
git commit -m "refactor: share Azure SQL connection runner"
```

---

### Task 2: Extract transport-neutral PAWS data API and Auth-only Firebase Admin initialization

**Files:**
- Create: `server/src/auth/firebase-admin.js`
- Create: `server/src/data/data-api.js`
- Modify: `server/src/server.js`
- Modify: `server/src/app.js`
- Test: `server/test/firebase-admin.test.js`
- Test: `server/test/data-api.test.js`
- Test: `server/test/app.test.js`
- Test: `server/test/server-wiring.test.js`

**Interfaces:**
- Produces: `firebaseAdminOptionsFromEnv(env)`
- Produces: `createFirebaseAdminClients({adminModule, env, includeFirestore}) -> {adminAuth, firestore}`
- Produces: `createDataApi({authProvider, sessionReadService}) -> {handle}`
- `handle({method,path,headers,query}) -> {statusCode,body}`.

- [ ] **Step 1: Write failing Firebase project/secret tests**

```js
test('Firebase Admin config rejects service account from another project',()=>{
  const env={
    FIREBASE_PROJECT_ID:'tester-teaching',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
      project_id:'vista-teaching-lab',
      client_email:'svc@example.test',
      private_key:'-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n'
    })
  };
  assert.throws(()=>firebaseAdminOptionsFromEnv(env),error=>error.code==='FIREBASE_PROJECT_MISMATCH');
});
```

Also test missing `client_email`/`private_key` gives `FIREBASE_CONFIG_INVALID`.

- [ ] **Step 2: Write failing data API tests**

Cover:
1. `/api/health/sql` skips Auth;
2. `/api/v1/me` returns verified SQL-shaped actor;
3. `/api/v1/sessions` preserves Faculty email scoping;
4. SQL exception with `{code:'SQL_UNAVAILABLE',statusCode:503}` returns 503 and never falls back.

- [ ] **Step 3: Run RED**

```bash
node --test server/test/firebase-admin.test.js server/test/data-api.test.js
```

Expected: FAIL because modules are missing.

- [ ] **Step 4: Extract Firebase Admin setup**

Move the existing parsing/init logic from `server.js` to `firebase-admin.js`. Add:

```js
if(serviceAccount&&projectId&&String(serviceAccount.project_id||'').trim()!==projectId){
  throw Object.assign(
    Error('Firebase Admin service account project does not match FIREBASE_PROJECT_ID.'),
    {code:'FIREBASE_PROJECT_MISMATCH'}
  );
}
```

`includeFirestore:false` must create Auth without requiring Firestore.

- [ ] **Step 5: Implement transport-neutral `data-api.js`**

Reuse `statusFor`/`errorPayload`. Preserve exact existing semantics for:
- SQL health;
- bearer token verification;
- current user;
- `createDataRoutes` session routing.

- [ ] **Step 6: Make `app.js` delegate these routes to `data-api.js`**

Keep CORS/body parsing/DOE routing in the Node transport. Do not alter DOE behavior.

- [ ] **Step 7: Make `server.js` use the extracted Firebase Admin helper**

Preserve App Service managed-identity behavior when no SQL connection string is provided.

- [ ] **Step 8: Run focused and full server tests**

```bash
node --test server/test/firebase-admin.test.js server/test/data-api.test.js server/test/app.test.js server/test/server-wiring.test.js server/test/data-routes.test.js
npm --prefix server test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/auth/firebase-admin.js server/src/data/data-api.js server/src/server.js server/src/app.js server/test/firebase-admin.test.js server/test/data-api.test.js server/test/app.test.js server/test/server-wiring.test.js
git commit -m "refactor: share authenticated PAWS data API"
```

---

### Task 3: Add SWA Managed Functions runtime and deterministic API staging

**Files:**
- Create: `server/src/runtime/swa-sql-runtime.js`
- Create: `server/src/runtime/swa-functions.js`
- Create: `server/test/swa-sql-runtime.test.js`
- Create: `server/test/swa-functions.test.js`
- Create: `swa-api/package.json`
- Create: `swa-api/package-lock.json`
- Create: `swa-api/host.json`
- Create: `swa-api/index.js`
- Create: `tools/build-swa-api.js`
- Create: `tests/swa-api-build.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `createSwaSqlRuntime({env,adminModule,sqlModule}) -> {handle}`
- Produces: `registerSwaFunctions({app,runtimeFactory})`
- Staged output: `.deploy-swa-api`.

- [ ] **Step 1: Write failing SWA runtime tests**

Require:
- missing `PAWS_SQL_CONNECTION_STRING`, `FIREBASE_PROJECT_ID`, or `FIREBASE_SERVICE_ACCOUNT_JSON` => `SWA_SQL_CONFIG_REQUIRED`;
- Firebase service-account project mismatch fails before SQL initialization.

- [ ] **Step 2: Write failing Functions registration tests**

With a fake `app.http`, require exact registrations:

```js
[
  ['pawsSqlHealth','health/sql',['GET']],
  ['pawsMe','v1/me',['GET']],
  ['pawsSessions','v1/sessions',['GET']]
]
```

Invoke fake `v1/sessions` handler and assert it forwards Authorization/start/end to `/api/v1/sessions`.

- [ ] **Step 3: Run RED**

```bash
node --test server/test/swa-sql-runtime.test.js server/test/swa-functions.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement `swa-sql-runtime.js`**

It must:
1. validate the three server-side settings;
2. create Firebase Admin Auth with `includeFirestore:false`;
3. create one shared connection-string SQL pool runner;
4. create SQL user/session repositories with that runner;
5. create `createFirebaseSqlAuthProvider`;
6. create `createDataApi`;
7. expose only `{handle}`.

Do not initialize Firestore DOE services.

- [ ] **Step 5: Implement `swa-functions.js`**

Register the three functions with `authLevel:'anonymous'`; PAWS itself verifies Firebase bearer tokens on protected routes.

Return:

```js
{
  status:result.statusCode,
  jsonBody:result.body,
  headers:{'cache-control':'no-store'}
}
```

- [ ] **Step 6: Add deterministic SWA package metadata**

`swa-api/package.json`:

```json
{
  "name": "paws-swa-api",
  "private": true,
  "version": "1.0.0",
  "main": "index.js",
  "engines": {"node": "22.x"},
  "dependencies": {
    "@azure/functions": "4.16.5",
    "firebase-admin": "14.4.0",
    "mssql": "12.7.2"
  }
}
```

`swa-api/host.json`:

```json
{"version":"2.0"}
```

`swa-api/index.js`:

```js
'use strict';
const {app}=require('@azure/functions');
const {registerSwaFunctions}=require('./server/src/runtime/swa-functions.js');
registerSwaFunctions({app});
```

Generate the lock only:

```bash
npm install --package-lock-only --ignore-scripts --prefix swa-api
```

- [ ] **Step 7: Write failing staged-artifact test**

`tests/swa-api-build.test.js` must assert:
- `index.js`, `host.json`, `package.json`, `package-lock.json` exist;
- no `server/src/doe/*` is staged;
- no private key, password value, or `PAWS_SQL_CONNECTION_STRING=` assignment is staged;
- dependency versions match the pinned versions.

- [ ] **Step 8: Run RED**

```bash
node --test tests/swa-api-build.test.js
```

Expected: FAIL.

- [ ] **Step 9: Implement `tools/build-swa-api.js`**

Use this exact allowlist:

```js
const runtimeFiles=[
  'server/src/auth/firebase-admin.js',
  'server/src/auth/firebase-sql-auth.js',
  'server/src/data/sql-connection.js',
  'server/src/data/sql-session-repository.js',
  'server/src/data/sql-user-repository.js',
  'server/src/data/data-api.js',
  'server/src/routes/data-routes.js',
  'server/src/http/errors.js',
  'server/src/runtime/swa-sql-runtime.js',
  'server/src/runtime/swa-functions.js'
];
```

Default output `.deploy-swa-api`; remove/recreate it each run.

- [ ] **Step 10: Ignore generated API/release folders**

Add:
- `.deploy-swa-api/`
- `.azure-production/`

to `.gitignore`.

- [ ] **Step 11: Run GREEN**

```bash
node --test server/test/swa-sql-runtime.test.js server/test/swa-functions.test.js tests/swa-api-build.test.js
npm --prefix server test
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add server/src/runtime server/test/swa-sql-runtime.test.js server/test/swa-functions.test.js swa-api tools/build-swa-api.js tests/swa-api-build.test.js .gitignore
git commit -m "feat: add Static Web Apps SQL managed functions"
```

---

### Task 4: Add explicit Azure SQL session-read configuration and browser client

**Files:**
- Create: `paws-data-client.js`
- Create: `tests/paws-data-client.test.js`
- Modify: `firebase-config.js`
- Modify: `tools/build-firebase-config.js`
- Modify: `tools/static-assets.json`
- Modify: `index.html`
- Modify/Test: the existing Firebase config and static build tests.

**Interfaces:**
- `window.UCVM_PAWS_SESSION_BACKEND` is exactly `firestore` or `azure-sql`.
- `window.UCVM_PAWS_DATA.listSessions({start,end})`
- `window.UCVM_PAWS_DATA.sessionWritesEnabled()`
- `window.UCVM_PAWS_DATA.sessionBackend()`.

- [ ] **Step 1: Write failing config tests**

Require:
- committed/default config => `firestore`;
- `--paws-session-backend azure-sql` => `azure-sql`;
- any other value throws.

Add helper contract:

```js
normalizePawsSessionBackend('azure-sql') === 'azure-sql'
normalizePawsSessionBackend('firestore') === 'firestore'
```

- [ ] **Step 2: Run RED**

Run the existing Firebase config test file directly with `node --test`.

- [ ] **Step 3: Extend config generator and committed template**

Generated config sets:

```js
root.UCVM_PAWS_SESSION_BACKEND = pawsSessionBackend;
```

Committed `firebase-config.js` sets:

```js
root.UCVM_PAWS_SESSION_BACKEND = 'firestore';
```

Never put SQL credentials/host/user/password into browser config.

- [ ] **Step 4: Write failing browser-client tests**

Test Azure mode sends current Firebase ID token:

```js
const client=create({
  backend:'azure-sql',
  tokenProvider:async()=> 'firebase-token',
  fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return{ok:true,status:200,json:async()=>({sessions:[{id:'s1'}]})};
  }
});
const rows=await client.listSessions({start:'2027-03-22',end:'2027-03-23'});
assert.equal(calls[0].url,'/api/v1/sessions?start=2027-03-22&end=2027-03-23');
assert.equal(calls[0].options.headers.Authorization,'Bearer firebase-token');
assert.equal(client.sessionWritesEnabled(),false);
```

Also test 503 error propagates with code `SQL_UNAVAILABLE` and does not invoke any Firestore fallback.

- [ ] **Step 5: Run RED**

```bash
node --test tests/paws-data-client.test.js
```

Expected: FAIL.

- [ ] **Step 6: Implement `paws-data-client.js`**

Requirements:
- current user comes from `firebase.auth().currentUser`;
- token via `getIdToken()`;
- validate dates as `YYYY-MM-DD`;
- same-origin `/api/v1/sessions`;
- non-2xx `{code,message}` becomes Error with `code` and `statusCode`;
- no internal Firestore fallback.

- [ ] **Step 7: Ship/load the client**

Add to `tools/static-assets.json`. Load after Firebase config/auth and before `timetable.js`.

- [ ] **Step 8: Run GREEN**

```bash
node --test tests/paws-data-client.test.js
npm test
```

- [ ] **Step 9: Commit**

```bash
git add paws-data-client.js tests/paws-data-client.test.js firebase-config.js tools/build-firebase-config.js tools/static-assets.json index.html tests
git commit -m "feat: add Azure SQL session read client"
```

---

### Task 5: Route timetable reads to Azure SQL and fail closed on session writes

**Files:**
- Modify: `timetable.js`
- Create: `tests/timetable-azure-sql-read.test.js`
- Test: `tests/timetable.test.js`
- Test: `tests/timetable-multi-edit-ui.test.js`

**Interfaces:**
- Consumes `window.UCVM_PAWS_DATA`.
- New schedule sources: `azure-sql`, `azure-sql-empty`, `azure-sql-error`.
- Firestore path remains unchanged when backend is `firestore`.

- [ ] **Step 1: Write failing SQL-read source-contract tests**

Assert `timetable.js`:
- checks `sessionBackend()`;
- calls `listSessions({start,end})` in Azure mode;
- sets `azure-sql` or `azure-sql-empty`;
- does not create Firestore `onSnapshot` in the Azure branch;
- retains the Firestore branch.

- [ ] **Step 2: Write failing mutation-guard tests**

Require one shared predicate such as:

```js
function sessionMutationsAllowed(){
  return !window.UCVM_PAWS_DATA || window.UCVM_PAWS_DATA.sessionWritesEnabled();
}
```

Test guards for:
- Add One;
- Add Sessions;
- single-session save;
- delete;
- Faculty swap;
- multi-session save.

Tests must prove write functions themselves fail closed, not only that buttons are hidden.

- [ ] **Step 3: Run RED**

```bash
node --test tests/timetable-azure-sql-read.test.js tests/timetable.test.js tests/timetable-multi-edit-ui.test.js
```

- [ ] **Step 4: Implement Azure range reads in `ensureSessionsForRange`**

Use:

```js
if(window.UCVM_PAWS_DATA?.sessionBackend?.()==='azure-sql'){
  const rows=await window.UCVM_PAWS_DATA.listSessions({start:range.start,end:range.end});
  cacheSessionRange(range,rows);
  sessions=rows;
  scheduleSource=rows.length?'azure-sql':'azure-sql-empty';
  publishPageData();
  return rows;
}
```

Visible-range refresh uses explicit API refresh; no `onSnapshot` in this branch.

- [ ] **Step 5: Extend connected-source UI**

`liveScheduleAvailable()` treats:
- `firestore`
- `firestore-empty`
- `azure-sql`
- `azure-sql-empty`

as connected.

Labels:
- `Azure SQL schedule`
- `Azure SQL schedule · No sessions in this view`

- [ ] **Step 6: Implement the shared write guard**

When Azure SQL mode is active:
- disable/hide session mutation controls;
- callable mutation functions throw with code `SQL_SESSION_WRITES_NOT_READY`;
- no Firestore write starts before the guard.

Do not alter AFC or DOE.

- [ ] **Step 7: Implement backend-unavailable state**

On SQL read error:
- set `scheduleSource='azure-sql-error'`;
- show controlled retryable message;
- never auto-switch to Firestore.

- [ ] **Step 8: Run GREEN**

```bash
node --test tests/timetable-azure-sql-read.test.js tests/timetable.test.js tests/timetable-multi-edit-ui.test.js
npm test
```

- [ ] **Step 9: Commit**

```bash
git add timetable.js tests/timetable-azure-sql-read.test.js tests/timetable.test.js tests/timetable-multi-edit-ui.test.js
git commit -m "feat: read beta timetable sessions from Azure SQL"
```

---

### Task 6: Package frontend + Managed Functions into one exact Azure release artifact

**Files:**
- Modify: `staticwebapp.config.json`
- Modify: `.github/workflows/azure-static-web-apps.yml`
- Modify: `.github/workflows/azure-production-deploy.yml`
- Modify: `tests/azure-deployment.test.js`

**Interfaces:**
- Release root: `.azure-production/`
- Frontend: `.azure-production/app`
- API source: `.azure-production/api`
- Manual deploy consumes only the downloaded handoff artifact.

- [ ] **Step 1: Write failing deployment-contract tests**

Require:
- `platform.apiRuntime === 'node:22'`;
- build workflow runs `node tools/build-swa-api.js --output .deploy-swa-api`;
- production browser config uses `--paws-session-backend azure-sql`;
- artifact contains `.azure-production/app` and `.azure-production/api`;
- no hard `test -n "$PRODUCTION_DOE_API_BASE_URL"`;
- no pre-build App Service DOE health gate;
- deploy workflow uses `app_location: .azure-production/app`;
- deploy workflow uses `api_location: .azure-production/api`;
- `skip_app_build: true`;
- `skip_api_build: false`;
- post-deploy checks `/api/health/sql`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/azure-deployment.test.js
```

- [ ] **Step 3: Set Node 22 API runtime**

Add:

```json
"platform":{"apiRuntime":"node:22"}
```

to `staticwebapp.config.json`, preserving current routes/cache headers.

- [ ] **Step 4: Update main-push Azure build**

Sequence:
1. install/test root;
2. run emulator tests;
3. install/test `server`;
4. generate production Firebase config with `--paws-session-backend azure-sql`;
5. inject DOE API URL only when variable is non-empty;
6. build static site;
7. copy `staticwebapp.config.json` to `.deploy-static`;
8. build `.deploy-swa-api`;
9. create `.azure-production/app` and `.azure-production/api`;
10. copy exact tested app/API source into them;
11. upload `.azure-production` as `azure-production-${{ github.sha }}`.

No server secrets in the build workflow.

- [ ] **Step 5: Update manual deploy**

Use:

```yaml
with:
  azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
  action: upload
  app_location: .azure-production/app
  api_location: .azure-production/api
  output_location: ''
  skip_app_build: true
  skip_api_build: false
  production_branch: main
```

Before deploy verify:
- app `index.html`;
- app `staticwebapp.config.json`;
- API `index.js`;
- API `package-lock.json`;
- API `host.json`.

- [ ] **Step 6: Add post-deploy SQL health gate**

```bash
curl --fail --silent --show-error --retry 5 --retry-delay 5 \
  "https://red-cliff-04871ca0f.5.azurestaticapps.net/api/health/sql"
```

Require JSON `ok === true` and `dependency === "azure-sql"`.

- [ ] **Step 7: Run GREEN**

```bash
node --test tests/azure-deployment.test.js tests/swa-api-build.test.js
npm test
npm --prefix server test
```

- [ ] **Step 8: Commit**

```bash
git add staticwebapp.config.json .github/workflows/azure-static-web-apps.yml .github/workflows/azure-production-deploy.yml tests/azure-deployment.test.js
git commit -m "ci: deploy SWA managed functions with Azure beta"
```

---

### Task 7: Add least-privilege beta SQL principal setup and SWA server-setting runbook

**Files:**
- Create: `database/azure-sql/004_swa_beta_permissions.sql`
- Create: `tools/configure_paws_swa_beta.ps1`
- Create: `tests/python/test_swa_beta_permissions_contract.py`
- Create: `tests/powershell/test_swa_beta_config_contract.ps1`
- Modify: `SETUP.md`
- Modify: `docs/azure-sql-migration.md`

**Interfaces:**
- Fixed contained database principal: `paws_swa_beta`
- Required SWA settings:
  - `PAWS_SQL_CONNECTION_STRING`
  - `PAWS_SQL_READS=on`
  - `PAWS_SQL_AUTH=on`
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_SERVICE_ACCOUNT_JSON`

- [ ] **Step 1: Write failing SQL-permission contract test**

Require `004_swa_beta_permissions.sql` to:
- target `paws_swa_beta`;
- grant SELECT only on `paws.UserProfile`, `paws.Faculty`, `paws.SessionAssignment`, `paws.vCalendarSession`;
- grant INSERT on `paws.UserProfile`;
- contain no `db_owner`, `GRANT CONTROL`, `ALTER ANY`, or staging grant;
- contain no password literal.

- [ ] **Step 2: Run RED**

```bash
python -m unittest tests.python.test_swa_beta_permissions_contract -v
```

- [ ] **Step 3: Implement SQLCMD-variable permission script**

Use a required SQLCMD variable `PawsSwaBetaPassword`, create the contained user only when absent, then:

```sql
GRANT SELECT ON OBJECT::paws.UserProfile TO [paws_swa_beta];
GRANT INSERT ON OBJECT::paws.UserProfile TO [paws_swa_beta];
GRANT SELECT ON OBJECT::paws.Faculty TO [paws_swa_beta];
GRANT SELECT ON OBJECT::paws.SessionAssignment TO [paws_swa_beta];
GRANT SELECT ON OBJECT::paws.vCalendarSession TO [paws_swa_beta];
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::staging TO [paws_swa_beta];
```

Do not grant UPDATE/DELETE for this read slice.

- [ ] **Step 4: Write failing PowerShell config contract test**

Require `configure_paws_swa_beta.ps1` to:
- have `-Preview` mode with no writes;
- never print SQL password or Firebase service-account JSON;
- use `az staticwebapp appsettings set`;
- verify setting names without listing values.

- [ ] **Step 5: Run RED**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\powershell\test_swa_beta_config_contract.ps1
```

- [ ] **Step 6: Implement preview-first operator script**

Sequence:
1. pin current subscription/resource group/SWA/SQL names;
2. verify Azure CLI login;
3. verify exact target SWA/database;
4. preview only resource names and required setting names;
5. apply mode reads Firebase service-account JSON from operator-supplied local file;
6. verify `project_id`;
7. securely prompt/generate SQL password in memory;
8. apply `004_swa_beta_permissions.sql` using approved DB operator identity;
9. build SQL connection string in memory;
10. set five SWA application settings;
11. clear secret variables;
12. verify only setting names are present.

Never save/print either secret.

- [ ] **Step 7: Document operator order**

In `SETUP.md` and migration docs:

```text
1. Run configure_paws_swa_beta.ps1 -Preview.
2. Review pinned resource names.
3. Run explicit apply mode.
4. Confirm required app-setting names only.
5. Merge/build exact main SHA.
6. Manually dispatch Azure Production Deploy with source_run_id + commit_sha.
7. Require /api/health/sql PASS.
8. Run authenticated /api/v1/me and /api/v1/sessions smoke.
```

State that `bootstrap_paws_azure_runtime.ps1` is not required for this beta path.

- [ ] **Step 8: Run security/config tests**

```bash
python -m unittest tests.python.test_swa_beta_permissions_contract -v
```

and:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\powershell\test_swa_beta_config_contract.ps1
```

- [ ] **Step 9: Commit**

```bash
git add database/azure-sql/004_swa_beta_permissions.sql tools/configure_paws_swa_beta.ps1 tests/python/test_swa_beta_permissions_contract.py tests/powershell/test_swa_beta_config_contract.ps1 SETUP.md docs/azure-sql-migration.md
git commit -m "ops: add SWA beta SQL access configuration"
```

---

### Task 8: Integrated acceptance and draft PR

**Files:** Modify only if verification exposes a real defect.

- [ ] **Step 1: Run complete tests**

```bash
npm test
npm --prefix server test
python -m unittest discover -s tests/python -p "test_*.py" -v
```

Also run the PowerShell contract tests on Windows.

- [ ] **Step 2: Build both release artifacts**

```bash
node tools/build-static.js
node tools/build-swa-api.js --output .deploy-swa-api
```

Verify expected app/API entry files exist.

- [ ] **Step 3: Scan tracked source for secret values**

```bash
git grep -n -E "BEGIN PRIVATE KEY|Password=[^;]+|PAWS_SQL_CONNECTION_STRING=.*[^[:space:]]|FIREBASE_SERVICE_ACCOUNT_JSON=.*\{" -- ':!docs/superpowers/plans/*'
```

Expected: no committed secret values.

- [ ] **Step 4: Scan static frontend artifact**

```bash
grep -R -n -E "BEGIN PRIVATE KEY|PAWS_SQL_CONNECTION_STRING|FIREBASE_SERVICE_ACCOUNT_JSON|User ID=paws_swa_beta|Password=" .deploy-static
```

Expected: no matches.

- [ ] **Step 5: Push branch and wait for exact-head CI**

Required green:
- Test;
- DOE API Test;
- Azure SQL Migration Tests;
- Azure Static Web Apps build artifact;
- new SWA API tests/contracts.

- [ ] **Step 6: Run operator configuration in preview only**

No live writes.

- [ ] **Step 7: After explicit operator approval, configure SWA settings and beta SQL principal**

This is the first live secret/database-principal write. Never run it implicitly from CI.

- [ ] **Step 8: Merge only after review, then manually deploy exact successful main artifact**

Use exact `source_run_id` and `commit_sha`.

- [ ] **Step 9: Verify live unauthenticated SQL health**

Require:

```json
{"ok":true,"service":"ucvm-doe-api","dependency":"azure-sql"}
```

- [ ] **Step 10: Verify authenticated live reads**

After Firebase sign-in:
- `/api/v1/me` returns the signed-in SQL profile;
- `/api/v1/sessions` returns canonical SQL sessions;
- Faculty/HICC/VISC remain email-scoped;
- timetable says Azure SQL;
- all session mutation controls are disabled/fail closed.

Never paste ID tokens, Firebase Admin JSON, SQL password, or connection strings into logs/chat.

- [ ] **Step 11: Verify rollback path**

Confirm Firestore is untouched and that a separately tested release with session backend set to `firestore` restores previous beta session behavior. No per-request fallback.

- [ ] **Step 12: Open or refresh the draft PR**

Record:
- exact head SHA;
- exact CI runs;
- SWA resource name;
- SQL database name;
- health result;
- authenticated smoke result;
- statement that no secrets are included;
- statement that SQL session writes remain disabled in this slice.

Keep Draft until live browser acceptance is complete.