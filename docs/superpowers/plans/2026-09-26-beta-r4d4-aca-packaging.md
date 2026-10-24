# BETA-R4D-4 ACA Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare a locally testable Azure Functions Node.js 22 container package with a fail-closed UAMI SQL adapter, without any Azure deployment or live data mutation.

**Architecture:** Reuse the existing deterministic `.azure-production/api` artifact inside a minimal `mcr.microsoft.com/azure-functions/node:4-node22` image. Extend the SQL connection factory with explicit UAMI/legacy modes while preserving Firebase authentication and public routes.

**Tech Stack:** Node.js 22, Azure Functions v4, CommonJS, `mssql` 11.0.1/Tedious, Dockerfile, Node test runner, GitHub Actions.

**Spec:** owner-provided BETA-R4D-4 task prompt

## Global Constraints

- Operate only in `Alex1122341/Teaching-assignment-azure`.
- No Azure deployment, ACR push, Container App/Function App creation, SQL/Firebase/SWA/GitHub live mutation, or merge.
- Use `mcr.microsoft.com/azure-functions/node:4-node22` and `npm ci --omit=dev`.
- Never commit real IDs, credentials, tokens, storage keys, or service-account JSON.
- Preserve Firebase `verifyIdToken(token, true)`, existing routes, and frozen frontend assets.

## Review Focus

- MI mode with missing or malformed endpoint configuration must fail closed; test explicit errors.
- Setting `PAWS_SQL_MI_CLIENT_ID` must never silently fall back to password auth; test configuration shape.
- Legacy connection-string mode must remain unchanged; test existing constructor behavior.
- Docker context must exclude private/local artifacts; test `.dockerignore` and Dockerfile paths.
- Existing Firebase and route contracts must remain unchanged; run targeted runtime/API tests.

### Task 1: Branch and failing contract tests

**Files:**
- Create: `tests/beta-r4d4-packaging.test.js`
- Create: `server/test/sql-connection-mi.test.js`

- [ ] Create feature branch `task/beta-r4d4-aca-packaging` from `ffd870e`.
- [ ] Add failing tests for Dockerfile/base image/build reuse, `.dockerignore`, MI config shape, fail-closed endpoint validation, legacy mode, Firebase verification, and public routes.
- [ ] Run the targeted tests and confirm they fail for missing artifacts/behavior.

### Task 2: SQL adapter implementation

**Files:**
- Modify: `server/src/data/sql-connection.js`
- Modify: `server/src/runtime/swa-sql-runtime.js`
- Test: `server/test/sql-connection-mi.test.js`

- [ ] Define a pure configuration builder that requires `PAWS_SQL_CONNECTION_STRING`, selects `azure-active-directory-default` when `PAWS_SQL_MI_CLIENT_ID` is present, passes the client ID, sets `encrypt: true` and `trustServerCertificate: false`, and rejects ambiguous/malformed MI input.
- [ ] Preserve legacy connection-string mode when no MI client ID is supplied.
- [ ] Pass both environment values from `createSwaSqlRuntime` without hard-coding identifiers.
- [ ] Run the adapter tests through a red-green cycle.

### Task 3: ACA packaging artifacts

**Files:**
- Create: `deploy/aca/Dockerfile`
- Create: `.dockerignore`
- Create: `docs/beta-r4d4-aca-packaging.md`

- [ ] Package `.azure-production/api` under `/home/site/wwwroot` with `AzureWebJobsScriptRoot` set.
- [ ] Use deterministic `npm ci --omit=dev`, exclude local/private files, and document the PAWS → SQL and host-identity boundaries as `NOT YET DEPLOYED`.
- [ ] Add only narrowly scoped CI validation if repository conventions support it; no Azure login or push.
- [ ] Run packaging tests and the existing API build.

### Task 4: Full verification and handoff

- [ ] Run targeted tests, `npm test`, and any available emulator/API checks.
- [ ] Run a local Docker build and startup smoke test if Docker is already available; otherwise report `NOT RUN — Docker unavailable` without installing Docker.
- [ ] Update `agent.Ai/updates/` with the exact branch, commit, tests, and no-live-mutation evidence.
- [ ] Commit, push the feature branch, and open a Draft PR only after fresh verification; do not merge.
