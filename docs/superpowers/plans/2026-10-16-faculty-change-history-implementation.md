# Faculty change history implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Owner selected inline sequential execution and one independent whole-branch review.

**Goal:** Deliver09–11 with shared authorized SQL history, complete filtered CSV/XLSX exports and Dashboard Lookup/AFC/Rule Book history.

**Architecture:** Existing durable audits plus additive event-time context feed a closed server projection. Three UI scopes consume bounded authorization-bound snapshots; exports reuse those exact sanitized rows.

**Tech Stack:** SQL Server, Node22/CommonJS, existing ExcelJS4.4.0, vanilla JavaScript/HTML/CSS, Firebase Authentication.

**Spec:** docs/superpowers/specs/2026-10-16-faculty-change-history-design.md

## Global constraints

* University SQL is authoritative; no Firestore fallback or raw audit JSON to browsers.
* Public timetable changes exclude private AFC/DOE/workflow notes and other faculty working ranges.
* Existing540 migration and all write gates/calculation semantics stay untouched.
* Snapshot bounds:10,000rows/6MiB, TTL10minutes,2/actor,8global/48MiB; no silent truncation.
* Every request validates current token/profile and binds role and linked faculty.
* Separate product and reviewed immutable freeze promotion commits; no deployment claim before exact-main release evidence.

## Review focus

* Removed faculty still receive the event; legacy missing membership is never inferred from today's roster.
* Mixed-person assignment and DOE snapshots cannot leak other people's private fields.
* Role/link changes, expired/evicted handles and competing requests cannot reuse stale authorized data.
* CSV formulas, Unicode and genuine XLSX preserve every filtered row and column.
* Old audits with missing context, deleted entities and unknown VISC/year remain honest and searchable without invention.

### Task1: SQL event evidence and safe projection

**Files:** create database/azure-sql/047_change_history.sql,047_change_history_acceptance.sql; server/src/history/change-history-projection.js; server/test/change-history-projection.test.js. Modify server/src/data/sql-doe-policy-repository.js only for atomic recorded rule details.

**Interfaces:** projector consumes `{source,eventId,eventType,entityType,entityId,occurredAtUtc,beforeJson,afterJson,contextJson,actorName,academicYear}` and authorization `{uid,role,facultyId,admin,scope}`; produces closed DTO rows with internal filter evidence, never arbitrary JSON.

- [x] Write failing projection tests for public allowlist, own affected/removal, private scopes, old context gaps and old/new filter context.
- [x] Run `node --test server/test/change-history-projection.test.js`, record meaningful RED.
- [x] Implement closed domain-specific projection; additive SQL event context captures current session/assignment evidence only on new events. Read procedure rechecks role/link and scopes raw audit rows server-side. Add rollback preserving captured evidence.
- [x] Add synthetic SQL acceptance for multirow trigger, removed faculty, old backfill absence, unauthorized profiles, no business-data change and trigger rollback atomicity. Record actual rules before/after in existing draft save transaction.
- [x] Run targeted projection/repository/SQL assertions and inspect outputs before committing task.

### Task2: Authorized snapshot API and real exports

**Files:** create server/src/history/change-history-api.js,change-history-export.js; server/src/data/sql-change-history-repository.js; server/src/runtime/swa-change-history-functions.js; server/test/change-history-api.test.js,change-history-export.test.js,change-history-routes.test.js. Modify server/src/runtime/swa-sql-runtime.js.

**Interfaces:** `createChangeHistoryApi({verifyToken,findUser,repository,clock,randomId})` exposes `query(token,filters)`, `page(token,{snapshot,offset})`, `export(token,{snapshot,format})`; GET `/api/v1/change-history`, `/page`, `/export`. Repository `list({actorFirebaseUid,start,end,scope})` returns consistent bounded event evidence. Export returns `{fileName,contentType,fileBase64,rowCount}`.

- [x] Write/run failing tests for authentication, closed filters, cross-actor handle theft, changed role/link, expiry/limits, same snapshot pages and all-row export, sanitized errors.
- [x] Implement per-process bounded DTO snapshots, current authorization on every request and fixed error contracts. Query SQL in a serializable read transaction; never mix later data into an existing handle.
- [x] Implement lazy CSV/XLSX renderer and compare parsed outputs for Unicode, formulas, nulls and>100rows. Reject oversize exports explicitly.
- [x] Wire strict GET routes rejecting duplicate/unknown fields; run targeted server tests and commit.

### Task3: Shared frontend and three entry points

**Files:** create change-history.js,change-history.css; test/change-history.test.js (or repository test directory discovered before creation). Modify paws-data-client.js,afc-timetable-panel.js,index.html,faculty-admin.html,faculty-admin.js,tools/static-assets.json.

**Interfaces:** `PAWS_CHANGE_HISTORY.mount(host,{api,scope})` owns filters/query/pages/download lifecycle and returns `{destroy,refresh}`. Client exposes `changeHistory(filters)`, `changeHistoryPage(snapshot,offset)`, `changeHistoryExport(snapshot,format)`.

- [x] Add/run failing tests for closed client parameters, filter edits disabling export, stale response rejection, sign-out cleanup, safe DOM values and>100-row pagination/export parity.
- [x] Implement accessible component and scoped entry points; retain modal focus handling and self-mode Dashboard access. Add no Firestore read path.
- [x] Run targeted tests and read-only browser acceptance where feasible; leave real-account/manual-only checks pending without inventing credentials.
- [x] Commit product changes after targeted verification.

### Task4: Whole-branch review, governance, acceptance and release

**Files:** update runtime freeze documentation/tools only in separate governance commit, workflow SQL acceptance registration, continuity docs and original progress workbook.

- [ ] Run root `npm test`, server tests and build checks; run synthetic SQL suite in available controlled CI environment. No real business fixture writes.
- [x] Request one independent whole-branch standards/spec/privacy/transaction review, address findings with failing tests first and verify.
- [x] Promote immutable freeze anchored to accepted product commit in a separately reviewed governance commit; create/attach PR with exact evidence.
- [ ] After candidate acceptance merge under existing owner authorization, verify exact-main CI, apply additive schema before API, publish accepted API/Hosting artifact, verify scoped authenticated history read/export without changing business records.
- [ ] Update Excel09–11 and manual acceptance list, continuity checkpoint and any source/credential-dependent skipped steps. Never label unavailable/manual evidence passed.
