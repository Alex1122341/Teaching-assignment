# P3B4 — Approved AFC PDF Artifact Implementation Plan

**Status:** Owner-approved candidate implemented; local validation and Azure Beta Build accepted; branch-only, unmerged, and undeployed.
**Specification:** docs/superpowers/specs/2026-10-04-p3b4-afc-approved-artifact.md
**Branch:** feature/p3b4-afc-approved-artifact
**Plan commit before P3B3 integration:** 730f01fbec0b1634267ef6d8142a99b04761392c
**P3B4 head after P3B3 integration and baseline:** dbd7b84 (local merge commit; not yet pushed)
**Current P3B3 source head:** 7eb0514976e0c09caa070dd7455266b541b1984a

## Global constraints

- The owner approved implementation through Architect #5; work is branch-only.
- Merge P3B3 7eb0514976e0c09caa070dd7455266b541b1984a into this branch with a normal merge. Do not rebase or force-push.
- Do not apply SQL migrations, grant SQL permissions, mutate live SQL/Firebase/Firestore/Azure/Cloudflare/DNS/IIS/firewall/services/certificates, deploy, merge to main, or cut over the frontend.
- Use the existing /api/v1/afc-requests/{uuid} route namespace. Do not add /api/v1/afc/requests.
- GET is authenticated read-only retrieval of an existing artifact. POST is authenticated create-if-absent with an empty body and idempotent persisted-byte response.
- In SQL mode, the UI offers Download Approved PDF only for finally approved requests, does GET first and POST when an authorized approved request has no artifact, and never changes workflow status. Legacy Firestore mode remains guarded and untouched.
- POST can replay at most once following one forced Firebase refresh on 401. Do not automatically replay POST on 403/404/409/5xx/network failure. GET also permits at most one forced-refresh replay on 401.
- Keep test-first order. For each behavior: write a focused test, run it and observe the expected failure, implement the minimum, rerun focused tests, then run the task's complete test command before marking it complete.

## Goal

Implement the approved artifact design as a review-only candidate on the P3B4 feature branch. For one finally approved AFC request, the authenticated University API will render a PDF from SQL-authoritative request and approval evidence, atomically store it once in SQL, and return those stored bytes only to an authorized caller. Retrying or racing requests returns the same immutable artifact.

## Approval and scope gates

- Owner approval of this plan was reported by Architect #5 before implementation began. Keep the work within the branch-only limits below.
- After plan approval, the first implementation action is to synchronize the latest P3B3 branch into P3B4 with a normal history-preserving merge; do not rebase or rewrite shared history.
- All implementation and SQL migration files remain on feature/p3b4-afc-approved-artifact. Migration 011 is never applied to VetMed-Ops in this plan.
- No live SQL reads or writes, SQL grants, runtime-identity changes, Firebase/Firestore/Azure/Cloudflare changes, deployment, merge to main, frontend cutover, or PR merge is included.
- Do not add test identities, production sample data, public storage, signed URLs, or a second AFC workflow authority.
- Never log PDF bytes, signatures, signature images, AFC reasons, or source snapshots.
- Use no browser-supplied user identity, FacultyId, role, status, approval, template, or PDF bytes as authority.

## Contracts fixed by the approved specification

- Canonical route namespace: authenticated GET and POST /api/v1/afc-requests/{uuid}/approved-artifact, matching the existing AFC API routes. Do not create a parallel /api/v1/afc/requests namespace.
- GET retrieves an existing artifact only. It never renders, inserts, or audits creation. POST has an empty request body and creates if absent; repeats return the immutable stored bytes.
- In SQL mode, the approved AFC UI first attempts GET. If an authorized approved request has no artifact, POST creates it. Hide request existence from an unrelated caller. Never change AFC workflow status while downloading or creating an artifact.
- Only an active SQL profile with MustChangePassword = 0 may proceed. SQL rechecks that the request is finally approved and the caller is the requester, a Firebase UID on an actual approved paws.AfcApproval stage, or an active administrator. Hide request existence from unrelated callers.
- The authoritative snapshot includes only fields and stored signatures available from the approved SQL request and actual approval records. Browser data and Firestore are not consulted.
- The existing PDF template is copied to server/src/afc/assets/absence-from-campus-app.pdf; its SHA-256 must equal the reviewed source template hash 481677829217736B15CB3CBB010F49CB553A8664FE53F8604782093E99896547.
- Pin pdf-lib@1.17.1 exactly in both server/package.json and swa-api/package.json, with both lockfiles updated. The API artifact builder must include the template and resolve the pinned renderer package in its deployment bundle.
- Use an 8,388,608-byte maximum PDF size consistently in renderer, API, and SQL constraints/procedures. Enforce it before SQL persistence and before HTTP transmission.
- SQL persists PDF SHA-256, byte length, source snapshot SHA-256, template SHA-256, renderer version, creation time, and creating Firebase UID. Hash and length must match the actual bytes.
- Appointment Type and Expiry Date currently have no verified authoritative SQL source. Render those template fields blank; do not infer them or fall back to browser/Firestore data.
- Success is application/pdf with Cache-Control: private, no-store, X-Content-Type-Options: nosniff, and attachment filename afc-approved-{validated-request-uuid}.pdf. Errors keep the fixed JSON envelope.
- The artifact is insert-once and unique by AfcRequestId. No update, replace, or delete procedure is provided. Rollback 011 must refuse to drop the table when artifact rows exist.

## Ordered implementation tasks

### Task 1 — Synchronize and establish the test baseline

- Verify the P3B4 worktree is clean and on the expected branch; fetch the P3B3 source and verify its exact head is 7eb0514976e0c09caa070dd7455266b541b1984a.
- Merge origin/feature/p3b3-afc-frontend-api into P3B4 without rewriting history. Resolve only conflicts caused by continuity-document updates and preserve both histories.
- Record the new P3B4 parent/head and run the root suite, server suite, static/API freeze checks, and beta baseline/deployment/governance tests before feature edits. Stop if the merge changes protected runtime files unexpectedly or the baseline fails; investigate before proceeding.
- Expected baseline: root suite 666 total / 637 passed / 29 skipped / 0 failed; server 224/224; static freeze 49 paths/no drift; API freeze 27 paths/no drift; baseline/deployment suite 41/41. Record any exact-head variation rather than assuming.

### Task 2 — Add the template and pinned renderer dependency

- Add a template-integrity test that fails unless the server-local PDF exists and matches the approved SHA-256.
- Copy the reviewed PDF into server/src/afc/assets/absence-from-campus-app.pdf.
- Add exact pdf-lib@1.17.1 dependencies and lockfile entries to the server and SWA API workspaces.
- Add tests/p3b4-afc-artifact-bundle.test.js and a testable buildSwaApi({root}) helper in tools/build-swa-api.js. The helper must enforce its output remains exactly <root>/.azure-production/api; tests use a disposable self-created fixture root and assert package, lockfile, source code, and PDF template are copied. The CLI still writes only to the repository's fixed build output.
- Expected focused command: node --test test/p3b4-afc-artifact-renderer.test.js (server directory) and node --test tests/p3b4-afc-artifact-bundle.test.js (repository root). The template check must fail before adding the template; the fixture build check must fail before the helper/package/template changes and pass afterward.

### Task 3 — Define and test additive SQL migration 011

- First add static SQL contract tests for database/azure-sql/011_afc_approved_artifact.sql and rollback_011_afc_approved_artifact.sql.
- Add only the new paws.AfcArtifact table: one row per request, unique/foreign-key constrained AfcRequestId, PDF bytes, content type, SHA-256 values, byte length, template and renderer versions, UTC creation metadata, and the 8 MiB check.
- Add the three narrowly scoped procedures named in the specification:
  - paws_api.GetApprovedAfcArtifactSource
  - paws_api.CreateOrGetApprovedAfcArtifact
  - paws_api.GetApprovedAfcArtifact
- The source procedure returns a deterministic, null-inclusive SQL-built JSON snapshot and its SHA-256, with approved request and actual approval-stage signatures only. SQL hashes `CONVERT(varbinary(max), @SourceSnapshotJson)` (UTF-16LE NVARCHAR code units without BOM); Node hashes the exact string with `Buffer.from(sourceSnapshotJson, 'utf16le')` and never parse/re-serializes before comparing. UTF-8 must not be substituted because it encodes different bytes and produces a different SHA-256.
- Every procedure checks active profile, MustChangePassword = 0, final approval, and actor scope from SQL tables. The API passes only the verified Firebase UID; it does not pass a trusted role or approval flag.
- The create/get procedure serializes concurrent creation per request inside a transaction, re-forms the source snapshot under locks, compares its hash, verifies PDF hash and DATALENGTH, inserts once, and writes exactly one afc_artifact_created audit event without PII. Repeat calls return the stored row unchanged.
- Provide no update/delete path. The rollback script checks for existing artifact rows and throws without dropping data; otherwise it drops only objects created by migration 011.
- Tests inspect only the migration text and mocked procedure contracts. Do not connect to any live database or execute the migration.
- Expected focused command: node --test test/p3b4-afc-artifact-migration.test.js. Contract tests fail before implementation and pass afterward. Live SQL is never a test target.

### Task 4 — Implement the SQL repository behind procedure-only calls

- Add repository contract tests first in server/test/p3b4-afc-artifact-repository.test.js.
- Add server/src/data/sql-afc-artifact-repository.js using parameterized stored-procedure calls only. Assert exact procedure names, parameter names/types, and byte/hash mapping; no ad hoc table DML or text-built SQL.
- Test that SQL authorization/conflict/not-found outcomes map to bounded domain errors and never leak source JSON, signature data, or PDF bytes on failure.
- Expected focused command: node --test test/p3b4-afc-artifact-repository.test.js. Procedure/parameter contract tests fail before repository implementation and pass afterward.

### Task 5 — Implement deterministic server-side PDF rendering

- Add renderer tests first in server/test/p3b4-afc-artifact-renderer.test.js for known form fields, embedded PNG/JPEG signatures, missing optional fields, malformed signature data, template hash mismatch, deterministic output, and both sides of the 8 MiB bound.
- Add server/src/afc/afc-approved-artifact-renderer.js using the pinned local PDF library and local reviewed template only. Do not fetch a CDN or accept caller-supplied template/PDF.
- Map confirmed SQL snapshot fields and actual stage signatures to the existing form. Keep Appointment Type and Expiry Date blank until an authoritative SQL source is verified and separately reflected in the plan.
- Return bytes plus SHA-256, byte length, renderer version, and template hash. Reject malformed or oversized input before persistence. Do not log rendered content or signatures.
- Expected focused command: node --test test/p3b4-afc-artifact-renderer.test.js. Renderer behavior fails before implementation and passes for valid output, literal hash/length, malformed signatures, and size boundaries afterward.

### Task 6 — Implement authorization and idempotent orchestration

- Add API behavior tests first in server/test/p3b4-afc-artifact-api.test.js for missing/invalid token, inactive profile, password-change-required profile, requester, each real approved-stage approver, active administrator, unrelated caller, missing request, unapproved request, invalid UUID, non-empty body, oversized PDF, and source-hash conflict.
- Add server/src/afc/afc-approved-artifact-api.js. Verify Firebase identity, resolve active SQL profile, and call the repository using only token UID. The renderer runs only after approved source retrieval succeeds.
- Use insert-once storage and return the stored artifact on retries. Add a concurrent-call test proving there is one insert/audit outcome and every response has byte-identical stored content. No regeneration or replacement may occur after an artifact exists.
- Return the same not-found class for absent, unapproved, and out-of-scope requests where needed to prevent existence disclosure. No PDF bytes on any denial or failure.
- If an artifact already exists, return it without rendering. Only authorized approved-but-missing requests may receive ARTIFACT_NOT_FOUND for the UI creation flow; unauthorized, unapproved, and absent requests remain indistinguishable to unrelated callers.
- Expected focused command: node --test test/p3b4-afc-artifact-api.test.js. Authorization, state, empty-body, idempotence, retry, and concurrency behavior fails before implementation and passes afterward.

### Task 7 — Wire the University API GET/POST routes and exact binary response

- Add runtime/route tests before implementation in server/test/p3b4-afc-artifact-runtime.test.js and extend server/test/university-http-server.test.js.
- Add server/src/runtime/swa-afc-artifact-functions.js and wire it through server/src/runtime/swa-sql-runtime.js under /api/v1/afc-requests/{uuid}/approved-artifact.
- GET must call the authorized read-existing-artifact procedure only and must never render, insert, or write an audit event. POST must call create-if-absent using an empty body.
- Extend server/src/runtime/university-http-server.js with a narrow Buffer response path that writes bytes unchanged, exact content length, the specified private headers, and the UUID-derived attachment name; keep JSON error serialization unchanged.
- Test exact response bytes, Content-Length, success headers, GET read-only behavior, POST empty-body behavior, authentication before repository access, safe filename, and fixed JSON errors without PDF bytes.
- Expected focused command: node --test test/p3b4-afc-artifact-runtime.test.js test/university-http-server.test.js. Missing-route/binary assertions fail before implementation; afterward GET/POST pass and existing JSON adapter behavior stays green.

### Task 8 — Add binary client methods and the approved-download UI

- Add tests first in tests/paws-data-client.test.js for authenticated PDF GET/POST, exact returned bytes, fixed JSON error parsing, one forced-token refresh/replay on 401 only, and no POST replay on 403/404/409/5xx/network failure.
- Add SQL-mode UI regression tests first in tests/p3b3-afc-workflow.test.js for showing Download Approved PDF only for finally approved requests, using GET for an existing artifact, falling back to POST only when creation is required, duplicate in-flight POST suppression, and no status mutation. Add a focused P3B4 test file if the existing test organization cannot express these behaviors cleanly.
- Extend paws-data-client.js with binary methods that return bytes and response metadata without passing application/pdf through the JSON parser. Preserve bearer-token handling and the single forced 401 refresh/replay behavior.
- Extend afc-workflow-sql.js with the approved-only Download Approved PDF action. GET first; on authorized ARTIFACT_NOT_FOUND, POST create-if-absent; download using a Blob/object URL and safe server-provided filename with UUID fallback; revoke the URL. Never read or write Firestore or alter request status.
- Keep the P3B3 duplicate-submit guard and all legacy Firestore backend-guard behavior intact.
- Expected focused command: node --test tests/paws-data-client.test.js tests/p3b3-afc-workflow.test.js. New PDF byte/retry/UI behavior fails first, then passes without regressing P3B3 or legacy Firestore cases.

### Task 9 — Review migration and rollback contracts

- Run the migration text tests and perform a human diff review against migrations 009/010 and existing AFC approval procedures.
- Confirm every new object is additive, schema-qualified, idempotently guarded as appropriate, least-privilege-ready, and absent from all live execution scripts/workflows.
- Confirm rollback is guarded against existing rows and does not alter 009/010 objects.
- Do not execute either script against VetMed-Ops, a shared database, or another external SQL environment.
- Expected: local SQL contract/static checks pass. No SQL endpoint is contacted.

### Task 10 — Promote the runtime freezes and verify the candidate

- Extend tools/beta-api-freeze.js and tests/beta-api-freeze.test.js to protect server/package.json and server/package-lock.json as runtime inputs. Preserve every prior protected path.
- Expected API freeze count is 34: the existing 27 plus the five new server/src artifacts (four JS modules and the PDF template) plus the two server package files. Confirm the actual full path delta and do not force the count if the implementation differs.
- The static protected path count should remain 49. The SQL-mode binary download may intentionally change paws-data-client.js and afc-workflow-sql.js; record and review the exact content delta and promote those shipped static bytes through the static freeze governance. Do not report zero static drift when UI/client bytes changed.
- Run focused P3B4 tests, the complete server suite, root suite, SQL-runtime authorization tests, beta baseline/deployment/governance tests, static/API freeze checks, syntax checks, and secret/scope scans. Record exact counts and outcomes.
- Build the SWA API artifact and verify the new route, package, and PDF asset are present. Do not deploy it.
- Separate product and governance commits so immutable API and static freeze anchors point to the tested product candidate while preserving every prior path. Run Azure Beta Build only for the exact reviewed candidate head and record its run ID/result. Do not use a whitelist or unexplained drift.

### Task 11 — Final candidate review and handoff

- Review the full diff, SQL forward/rollback pair, route exposure, auth scope, privacy behavior, package-lock changes, bundle contents, freeze path delta, and test/CI evidence.
- Commit only the approved P3B4 branch work; push the feature branch if remote authentication is already configured. Open a PR only if Architect #5 explicitly requests it.
- Append a new continuity update and refresh the current-state/task files with the exact implementation breakpoint and test/CI evidence.
- Stop after branch review. No merge to main, live SQL apply/grants, Azure/Firebase/Cloudflare/IIS/firewall/service/certificate changes, deployment, or frontend cutover.

## Shared interfaces / preflight

- Task 3 produces exact stored-procedure names/parameters, the SQL-built authoritative snapshot, and one documented byte encoding/hash consumed by Task 4 and Task 5. SQL and Node must hash identical bytes.
- Task 5 produces PDF bytes, SHA-256, length, renderer version, and template hash consumed by Task 6. Tests use literal, hand-verified hash/length fixtures.
- Task 6 consumes the repository and renderer and returns stored immutable bytes or bounded JSON errors consumed by Task 7. A stale source hash fails before persistence.
- Task 7 produces authenticated GET/POST binary responses under the existing AFC namespace; Task 8 consumes bytes and response metadata without JSON parsing. GET never writes; POST accepts only an empty body.
- Task 8 consumes those client methods and exposes only an approved SQL-mode download action. Preserve the P3B3 single-flight submit guard and legacy Firestore isolation.
- Task 10 promotes runtime paths from Tasks 2–8. Preserve all 49 static paths and previous API paths. Static content drift on paws-data-client.js and afc-workflow-sql.js is intentional only if edited; the API count 34 is a forecast to verify, not a target to force.

## Review focus

- Browser body/query values cannot select actor identity, source fields, signatures, or PDF bytes.
- GET is read-only across success, absent artifact, denials, and failures; concurrent POST cannot replace an artifact or double-audit.
- Unrelated callers cannot distinguish nonexistent, unapproved, or out-of-scope requests. Authorized approved-but-missing is distinguishable only to drive creation.
- PDF bytes, Content-Length, headers, and filename are exact; all errors remain fixed JSON with no partial binary data.
- 401 replay limit, no POST retries on other failures, UI in-flight dedupe, and Firestore separation have observable tests.
- Template hash, renderer version, 8 MiB limit, source hash encoding, SQL constraints, and built artifact contents agree end to end.

## Acceptance criteria

1. All authorization, approval, GET-read-only, POST-empty-body/create-if-absent, concurrency, source-hash, byte-integrity, privacy, client-retry, UI duplicate-guard, and fixed-error tests pass.
2. One approved request maps to at most one immutable SQL artifact and one creation audit event. Retries/races return identical persisted PDF bytes.
3. Every accepted PDF is rendered from the reviewed local template plus SQL-authoritative fields/signatures; unavailable fields remain blank.
4. SQL rechecks current source hash, final approval, and actor scope at persistence/retrieval. The API never trusts caller identity fields or PDF bytes.
5. Success is an exact-byte private PDF attachment; failures remain fixed JSON with no partial PDF.
6. API freeze protects the full runtime dependency and template inputs; record the exact verified path count/delta. Static freeze preserves all 49 paths and records the intentional P3B4 AFC UI/client byte delta with zero unexplained drift.
7. The candidate is branch-only and unmerged/undeployed; migration 011 is unapplied and no live database or cloud changes occurred.

## Stop conditions and rollback limits

- This plan has been approved through Architect #5; stop only if a later direct owner instruction withdraws approval or a stop condition below is reached.
- Stop if the P3B3 merge cannot be made without unexplained runtime changes or if its verified baseline fails.
- Stop if the source snapshot cannot be reconstructed deterministically from current SQL fields, if an AFC PDF field would require guessing, or if actual approved approver identities cannot be proven from SQL.
- Stop if SQL procedure permissions/behavior cannot enforce actor scope without expanding live grants; record the branch-only requirement for later DBA review.
- Stop if the renderer is nondeterministic, signature encoding is unsupported, the template hash differs, size limits disagree, or the binary response path changes existing JSON behavior.
- Migration rollback must refuse to destroy any persisted artifact. Any request to remove real artifacts or apply/undo the migration on live VetMed-Ops is outside this plan and requires a separate explicit owner task.
