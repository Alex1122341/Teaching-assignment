# Session SWAP Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Owner explicitly adopts recommended brainstorming choices; execute continuously.

**Goal:** SQL-backed scoped SWAP requests and readable preferred names.
**Architecture:** New request API/repository and additive SQL objects; use existing Auth identity and SQL role/scope. Dedicated frontend dialog/inbox consumes capability contract. Preserve TA and DOE provenance.
**Tech:** Vanilla JS/CSS, Node, SQL Server, Firebase Hosting.
**Spec:** ../specs/2026-10-09-session-swap-design.md

## Constraints

No new/local tests (developer instruction); use syntax/build and existing CI. No private data in faculty DTOs. No guessing HR name or office mapping. No Firestore writes, role elevation, annual-policy activation or bulk recalc. No fabricated live acceptance records.

## Tasks and interfaces

- [x] Backend: new server/src/swap/swap-api.js, swap-domain.js, server/src/data/sql-swap-repository.js and server/src/runtime/swa-swap-functions.js. Add migrations030+ after checking unused numbers, rollback/permissions. Wire swa-sql-runtime.js and write-gates.js. API prefix /api/v1/swaps: GET capabilities; GET context?sessionId; GET queue; GET /:id; POST root create; PUT /:id revise; POST /:id/decisions; POST /:id/withdraw. New independent swapRequest/swapDecision/swapApply gates. Domain and SQL enforce exact role/scope, consent, serial routing, idempotency/version checks and apply audit.
- [x] Frontend: swap-workflow-sql.js/css, paws-data-client.js methods, index.html assets and timetable.js entry. Backend contract agreed with implementer before integration; render server-defined fields/candidates/offices, revisioned requests, consent, queue and scoped decisions. No client business writes or fabricated lists. Missing capability fail closed.
- [x] Names: centralized display formatter and preferred display projection in faculty lookup and timetable; separate HR metadata only from source. Inspect Master sheet metadata for actual HR fields. Minimal schema/read contract support for distinct HR identity; no guessed import. Keep public candidate HR-free.
- [x] Review each component and whole branch, repair load-bearing findings. Do not merge before review.
- [x] Commit product; reviewed static/API freeze promotion and established manifest-count fixture synchronization; PR and existing CI; merge exact-main CI; directed additive SQL deployment and guarded API/Hosting release with rollback. Read-only live acceptance and final durable checkpoint.

## Review focus

Cross-office escalation, VISC ownership mismatch, notified target replaced after consent, stale session/candidate race, multi-instructor line preservation, DOE source drift, private identity leaks, duplicate final apply, missing HR source, disabled UI with clear reason, inactive/password-change accounts.
