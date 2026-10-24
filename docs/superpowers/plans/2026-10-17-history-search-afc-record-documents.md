# History Search and AFC Record Originals Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans sequentially; one independent whole-branch review at the end.

**Goal:** Make year-scoped history easy to scan/search, supply a usable CCC template and tie optional archived AFC PDFs to records with own-faculty downloads.

**Architecture:** Extend existing History/API/SQL authorization, CCC API and manual AFC workflow. Use an additive linking table and transactional create wrapper; reuse bounded upload/parser and download protections.

**Tech Stack:** Vanilla JS, Node22, ExcelJS, SQL Server, existing Firebase Authentication/University API.

**Spec:** docs/superpowers/specs/2026-10-17-history-search-afc-record-documents-design.md

## Global constraints

- Current base main27d339b; isolated branch feat/history-year-afc-record-pdfs-20261017.
- Existing immutable freeze anchor9eb2daf remains until separately reviewed product promotion.
- Never replay540 migration or write synthetic fixtures in University SQL; CCC commit remains false.
- Preserve actual business dates, optional unknowns, actor-name privacy, existing approval/cancellation and24 gates.
- Existing school identity authorized; no new account prerequisite or repeated human approval steps.

## Review focus

- Date/year boundaries in Calgary, cross-year moves and missing/contradictory evidence.
- Keyword results/exact export covering matches after the first100 records without confidential search text.
- Long/zero/false values remain readable and available despite compact row summaries.
- PDF success followed by AFC failure/retry, faculty changes/logout during upload, and cross-owner link attempts.
- Faculty get/list IDOR, deactivation/relinking and expired identity during binary read.

## Task1: Compact year-bound searchable history

Files: change-history.js/css; server/src/history/change-history-{api,projection,export}.js; relevant history tests; later SQL history actor-label update.

- [ ] Add failing tests for mandatory selected year/default/boundaries/ranges, keyword AND matching across authorized fields and >100-row complete snapshots, compact escaping/expansion and new export columns.
- [ ] Run targeted tests and record expected failures.
- [ ] Implement explicit year attribution/filtering and immutable snapshot binding; compact six-column UI plus Search/advanced disclosure and corresponding CSV/XLSX columns.
- [ ] Correct only intentionally changed old contracts, run relevant suites and commit.

## Task2: Download CCC .xlsx template

Files: existing CCC API/runtime/client/UI and tests; template generator module if needed.

- [ ] Fail a real downloaded ExcelJS workbook inspection and header-only parser contract; check nonadmin denial, no repository writes and UI download path.
- [ ] Add authenticated GET template, binary response/client validation, download button and format instructions. Do not require stage/commit writes for download.
- [ ] Run tests/parser readback and commit.

## Task3: Atomic AFC document link and own-faculty read

Files: new database/azure-sql/050_afc_record_documents.sql (+acceptance/guarded rollback), afc-form API/repository, sql-afc-write and Dashboard repositories/API; SQL runner/workflow; runtime permission tests.

- [ ] Fail tests for same-owner linked create, cross-faculty/spoofed/used document rejection, own list/get and wrong-owner refusal; SQL tests for rollback under failure and preserved old records.
- [ ] Add FK linking table and scoped create wrapper using existing create procedure. Recheck identity/faculty/document inside transaction; preserve old create with no document.
- [ ] Add document metadata to exact admin/profile rows without exposing binary. Extend SQL list/get authorization with self-service ownership checks and actor-only label availability on permitted history.
- [ ] Run targeted API/repository/SQL suites and commit.

## Task4: Integrated create/upload and downloads

Files: faculty-admin-{afc-forms,afc-records}.js,faculty-admin.js/html/css,paws-data-client.js and behavior tests.

- [ ] Fail tests for optional attachment, upload then create/link readback, no-PDF N/A, uncertainty/retry/key/faculty changes, row download and faculty own-only page.
- [ ] Place optional PDF input under Single Entry, share selected faculty, preserve confirmed upload for retry and make record-link confirmation explicit. Add admin/profile Download PDF or N/A plus own archive list.
- [ ] Run full npm test/server tests and synthetic browser desktop/narrow QA. Commit.

## Task5: Review, freeze, release and progress

- [ ] One independent fixed-range product review; important fixes test-first. Record remaining minor items.
- [ ] Separate exact product freeze promotion with independent governance review, no drift exceptions or removed paths.
- [ ] PR/exact-head CI, downloaded artifact hashes, merge under standing authorization, exact-main CI/artifact, additive SQL and attested API/Hosting release; preserve business hashes/gates and recovery config.
- [ ] Update original progress Excel/manual acceptance and chronological continuity. Report actual release and limitations only.
