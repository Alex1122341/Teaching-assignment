# Task12 AFC Form Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, inline sequentially; independent whole-branch review at end.

**Goal:** Add authenticated confidential PDF upload and retrieval on AFC Records without changing absence/approval state.
**Architecture:** Reuse existing roster, SQL binary-storage and PDF HTTP adapter patterns. Separate immutable uploaded originals from approved generated artifacts; independent default-off write gate.
**Tech Stack:** Vanilla JS, Node22, worker_threads, installed pdf-lib, SQL Server, node:test.
**Spec:** docs/superpowers/specs/2026-10-17-afc-form-upload-design.md

## Global constraints

- Beta SQL remains authoritative; no Firestore business fallback or new service identity prerequisite.
- PDF only,2097152 bytes maximum,1–100 pages, worker128MiB/5s/max2concurrent.
- Administrator-only live API+SQL authorization; independent `afcFormUpload` defaults false.
- Preserve540 migration, approved artifacts, DOE and all unrelated gates/data.

## Review focus

- Password/role changes between display and download must revoke access:Task2 SQL recheck.
- PDF compressed object actions bypass plain-string scan:Task1 decoded dictionary inspection.
- Timeout after commit must not duplicate a document:Task2 exact idempotency;Task3 same-key retry.
- Login account changes during pending request must discard stale UI:Task3 generation/uid checks.
- File size expansion must not increase every endpoint's body limit:Task2 explicit route allowlist tests.

### Task1: PDF validation boundary

Files:new server/src/afc/afc-form-pdf.js, afc-form-pdf-worker.js; test server/test/afc-form-pdf.test.js.
Produces `validateAfcFormPdf(buffer)` -> `{pageCount,byteLength,sha256}` or fixed code error. Worker internal `inspectAfcFormPdf` parses without mutation.
- [ ] Synthetic real PDF, active/encrypted/corrupt/oversized/page-limit tests; run RED.
- [ ] Implement bounded worker and decoded PDF object safety checks; run GREEN; commit.

### Task2: SQL/API/HTTP and client transport

Files:new database/azure-sql/048_afc_form_upload.sql,048_afc_form_upload_acceptance.sql,rollback_048_afc_form_upload.sql; server/src/data/sql-afc-form-repository.js;server/src/afc/afc-form-api.js;server/src/runtime/swa-afc-form-functions.js. Modify write-gates.js,swa-sql-runtime.js,university-http-server.js,paws-data-client.js. Tests:server/test/afc-form-api.test.js,afc-form-repository.test.js,afc-form-runtime.test.js;tests/afc-form-client.test.js.
Consumes validator; produces create/list/get repository and API methods, capabilities, strict attachment response and shared authenticated client methods.
- [ ] API unauth/role/default-gate denial, strict payload, upload retry, SQL mapping and real HTTP tests RED.
- [ ] Implement narrow SQL transactions with live actor/faculty check, immutable original/integrity, exact request replay, upload/download audits and paged metadata. Execute-only role; no memberships. Add rollback refusing nonempty storage.
- [ ] Isolated SQL acceptance:denied actor/revocation/replay/content-conflict/forced audit failure and protected tables unchanged.
- [ ] Wire explicit paths and bounded JSON upload transport; safe download headers; existing artifact path still works. Client allowlists exact payload.
- [ ] Run GREEN/API regression; commit.

### Task3: existing AFC page integration

Files:new faculty-admin-afc-forms.js; modify faculty-admin.html,faculty-admin.js,faculty-admin.css,tools/static-assets.json. Tests:tests/afc-form-ui.test.js and affected script inventory expectations.
Consumes shared client/authorized roster; produces controller open/clear/selectFile/upload/list/download.
- [ ] Test PDF metadata preview/type/size/no OCR, required faculty, exact success, same-key uncertain retry and account-switch clearing RED.
- [ ] Add small separate section using existing design; generated approved documents remain distinct. Mount only admin AFC tab and clear on logout/profile reload.
- [ ] Verify synthetic real Chrome UI, narrow/mobile layout, keyboard and no console error. No live upload fixture.
- [ ] Run GREEN; commit.

### Task4: review and release preparation

- [ ] Run npm test and server suite; SQL isolated CI; review whole branch independently and correct concrete findings test-first.
- [ ] Separately promote immutable runtime to accepted product commit; preserve full union and adversarial freeze checks.
- [ ] PR/exact-main CI/package comparison; stage reviewed SQL/API/Hosting under existing release authorization. Update recovery configuration only for changed accepted runtime after cutover, never silently bypass pinning.
- [ ] Update original Excel and continuation docs; preserve human verification fields. Do not upload an invented live form. Continue Task13 remaining read-only acceptance and Task14 capability implementation; permanent replacement requires fresh exact preview.
