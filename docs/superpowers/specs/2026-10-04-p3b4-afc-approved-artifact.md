# P3B4 — Approved AFC PDF Artifact

**Status:** Owner-approved design and implementation plan; branch-only implementation in progress under Architect #5's delegated direction.
**Repository:** Alex1122341/Teaching-assignment-azure
**Base:** feature/p3b3-afc-frontend-api @ 1454934473d2e1431402f22c8b02d9584b8be4d0
**Scope:** Branch-only specification and later branch implementation. No live activation is authorized.

## 1. Decision

Store one immutable, server-generated approved AFC PDF artifact per approved request in VetMed-Ops SQL using varbinary(max), served only through the authenticated University API. This follows the existing locked decision in agent.Ai/DECISIONS.md that SQL binary storage is preferred at the observed artifact size. No new storage service, public object URL, or Firestore authority is introduced.

The artifact is evidence attached to the existing AFC request. It does not create a second absence request or replace paws.AfcRequest, paws.AfcApproval, or paws.AuditEvent as workflow truth.

## 2. Evidence and gap

- Legacy afc-actions.js renders the approved PDF in the browser, computes SHA-256 and byte length, then stores 350,000-byte base64 chunks under the Firestore request.
- The saved Firestore inventory records one approved AFC PDF as four chunks.
- SQL 009_afc_request_foundation.sql and 010_afc_approval_foundation.sql store request and decision signatures and state, but define no PDF artifact table or retrieval procedure.
- The current University HTTP adapter emits JSON responses only; binary PDF responses need an explicit, tested response path.
- The locked AFC decisions require immutable final documents and prefer SQL binary storage.

## 3. Architecture and request flow

1. In SQL/VetMed-Ops mode, an approved AFC request exposes a Download Approved PDF action. Legacy Firestore mode remains behind its existing backend guard.
2. The UI first calls authenticated GET /api/v1/afc-requests/{afcRequestId}/approved-artifact. GET returns only an existing artifact and never renders, inserts, or writes an audit event.
3. If the authorized caller receives ARTIFACT_NOT_FOUND for an approved request, the UI calls authenticated, idempotent POST /api/v1/afc-requests/{afcRequestId}/approved-artifact with an empty body. The endpoint accepts no caller-supplied business data or PDF bytes.
4. The API verifies the Firebase ID token and resolves the active SQL UserProfile; actor UID comes only from the verified token.
5. SQL confirms the request is finally approved and its required approval stages are approved. The request's authoritative fields and stored signatures come only from SQL.
6. The server renders the existing AFC form template with a pinned, server-local PDF renderer. It does not call a browser renderer, remote CDN, Firestore, or public storage.
7. SQL atomically inserts the PDF if no artifact exists for this request. Repeated or concurrent POST calls return the already stored bytes and metadata; they never replace the immutable artifact.
8. Both endpoints return the stored PDF bytes only through the authenticated University API. No public link or bearer-free download route is created. Artifact generation/download never changes AFC workflow status.

The GET endpoint is read-only; it returns an existing artifact or a fixed JSON error. For an authorized caller with an approved request but no artifact, use ARTIFACT_NOT_FOUND; nonexistent, unapproved, or out-of-scope requests remain indistinguishable to unrelated callers. The POST endpoint is create-if-absent and idempotent. Both may return application/pdf on success and use the existing fixed JSON error envelope for failures. PDF responses must set Content-Length, Cache-Control: private, no-store, X-Content-Type-Options: nosniff, and an attachment filename derived only from the validated request ID. Enforce a bounded artifact size before persistence and before sending the response.

## 4. Authorization

- Require a valid Firebase ID token and an active SQL profile that does not require a password change.
- Permit access only to the request's authenticated requester, the Firebase UIDs recorded on its actual approved AfcApproval stages, or an active administrator role.
- SQL must re-check final approval and actor scope when reading source data and when persisting/returning the artifact. A browser-supplied FacultyId, requester UID, approver UID, role, status, template, or artifact bytes is never trusted.
- Return no artifact bytes to unauthenticated or out-of-scope callers. Avoid exposing request existence to an unrelated caller.
- Do not place signature images or raw signature data in ordinary AFC list responses.
- The browser client handles PDF bytes without passing success responses through its JSON parser. A 401 may trigger at most one forced Firebase token refresh and replay; 403/404/409/5xx/network failures do not automatically replay the create POST.
- Guard duplicate in-flight POST creation per request in one UI instance. The download action is visible only for finally approved SQL-backed requests and does not modify request state.

## 5. SQL evidence record and immutability

Proposed additive table: paws.AfcArtifact.

Minimum columns:

- AfcArtifactId primary key and AfcRequestId unique foreign key;
- ContentType constrained to application/pdf;
- PDF bytes in varbinary(max), SHA-256, and byte length;
- canonical authoritative source snapshot SHA-256;
- renderer/version and template SHA-256;
- creation time and creating Firebase UID.

The source snapshot is formed by SQL from the approved request and actual approval records. The API hashes and renders that returned snapshot. Before insertion, SQL re-forms the current snapshot under a request/approval lock and requires the source hash to match. This prevents persisting a PDF built from stale or caller-modified values without storing another full copy of sensitive source JSON.

The canonical source snapshot is a null-inclusive, deterministically ordered SQL `FOR JSON PATH` NVARCHAR value. SQL hashes `CONVERT(varbinary(max), @SourceSnapshotJson)`, which represents the NVARCHAR code units as UTF-16LE bytes without a BOM. Node must hash the exact returned string using `Buffer.from(sourceSnapshotJson, 'utf16le')`; it must not parse and re-serialize JSON before comparing the source hash. UTF-8 must not be substituted because it encodes different bytes and produces a different SHA-256.

Add stored procedures for approved-source retrieval and insert-once artifact persistence/retrieval. They must enforce approval state and actor scope, serialize concurrent creation, return the existing immutable artifact on repeat calls, and append an afc_artifact_created AuditEvent on first insertion. The unique request constraint is the final duplicate guard. Do not provide update, replace, or delete behavior.

Migration 011, tests, and procedures may exist on the feature branch only in this stage. Do not apply 009, 010, 011, grants, or new procedures to live VetMed-Ops. Runtime permission activation is a later, separately authorized step.

## 6. Integrity, failure, and privacy

- The PDF is generated from SQL-authoritative fields and signatures only after final approval.
- Persist PDF SHA-256, exact byte length, source snapshot hash, template hash, and renderer version. SHA-256 establishes byte integrity; it is not by itself a claim of legal non-repudiation.
- Artifact creation is idempotent by AfcRequestId. A lost response and retry return the same stored artifact. A source hash mismatch fails closed and requires a fresh SQL read/render.
- A not-finally-approved request has no downloadable artifact. Authorization, SQL, renderer, size-limit, or integrity failures return bounded errors and no partial PDF.
- Successful downloads are private, non-cacheable attachments. No signed public URL, public bucket, or CDN cache is used. SQL remains the only artifact authority.
- The PDF and embedded signatures contain sensitive personal data; do not log binary content, signature images, or request details.

## 7. Alternatives not selected

- Firestore chunks: rejected because Firestore must not regain authority for VetMed-Ops workflow documents.
- Client-rendered PDF: rejected because the browser can alter content and the generated file cannot serve as authoritative SQL evidence.
- Cloud object storage or signed URLs: deferred; they add a new service and public-link lifecycle when the existing locked SQL decision already covers the observed size.

## 8. Acceptance criteria

1. Unauthenticated requests return 401 and no PDF bytes.
2. An inactive, password-change-required, unrelated, or unapproved identity cannot create or retrieve the PDF.
3. The requester and actual approver(s), plus active administrators, can retrieve an artifact only after SQL reports final approval.
4. The PDF fields and signatures match one authoritative SQL snapshot; altered request-body identities or client PDF bytes are ignored/rejected.
5. First creation stores exactly one artifact and one creation audit event. Concurrent and repeated calls return byte-identical stored content without replacing it.
6. Stored SHA-256 and byte length match the returned bytes; stale-source and renderer/size failures fail closed.
7. The HTTP adapter returns private, no-store PDF attachments and preserves JSON error responses.
8. No Firestore access, SQL browser access, public URL, unauthenticated endpoint, live SQL mutation, Firebase mutation, or frontend origin cutover is introduced.
9. Regression tests cover authorization, approval-state gates, idempotence/concurrency, source-hash conflict, exact bytes/hash, GET read-only behavior, POST create behavior, binary client handling, response headers, UI duplicate guard, and error behavior. Existing 401-only retry behavior remains bounded to one forced Firebase refresh/replay; 403/404/409/5xx/network errors do not replay the create POST.
10. In SQL mode, Download Approved PDF uses the University API. Legacy Firestore mode remains isolated; no Firestore artifact reads/writes or fallback is introduced.
11. Any P3B4 static runtime changes for the download client/UI are explicitly reviewed and promoted through the static freeze governance; they are not described as zero static drift.

## 9. Explicit non-goals and rollout boundary

This specification authorizes branch-only runtime, client, UI, test, and SQL migration file work under the separately approved implementation plan. It does not authorize applying a live SQL migration, creating production tables/procedures/grants, runtime permission activation, Firebase/Firestore/Azure/Cloudflare changes, DNS/tunnel changes, real-user changes, deployment, merge to main, or a live frontend origin cutover. Feature code remains unmerged and undeployed pending review.

The implementation plan is docs/superpowers/plans/2026-10-04-p3b4-approved-afc-artifact.md. The owner approved the plan through Architect #5 before implementation began. The canonical AFC route namespace is /api/v1/afc-requests/{afcRequestId}; do not create a parallel /api/v1/afc/requests namespace.
