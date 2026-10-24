# Task12 — uploaded AFC forms

## Intent and current implementation

Continue Beta Tasks12–14, then prepare the full outstanding acceptance inventory. Owner previously directed recommended decisions, sequential execution, and skipping genuinely human-only steps. Apply that instruction to design/plan checkpoints; preserve the selected inline implementation method and independent whole-branch review. This is an architectural extension to existing AFC document infrastructure, not a second absence workflow.

Existing `faculty-admin.html` AFC Records tab, `faculty-admin-afc-records.js`, server AFC request/approved PDF APIs, `paws.AfcArtifact` and confidential SQL storage are reusable foundations. Existing artifacts are server-rendered approved requests, not arbitrary external forms. Their immutable approval provenance cannot represent an uploaded file. Signature images are not AFC form uploads.

## Chosen flow

Add an Upload AFC Form section to the existing AFC Records page. Administrator selects an active faculty member, selects a PDF, reviews filename/size/page count/status and uploads. Show recent documents for the selected faculty, authorized download, and clear success/failure/uncertain-response states. Metadata preview only; no PDF embedding, OCR or inferred AFC reasons, dates, absence or approval. Label documents as uploaded, not approved. Existing absence and approved-artifact flows stay separate.

Reuse SQL authority and binary-storage pattern with additive `paws.AfcFormDocument`:faculty foreign key, immutable original PDF bytes, SHA256, byte/page counts, sanitized original filename, actor, UTC creation, request UUID. No public bucket, raw disk path or Firebase storage. All endpoints administrator-only using existing shared role helpers and SQL live role checks. No faculty directory/UID/email delivered as document metadata. Select faculty via existing authorized roster.

PDF only, maximum2097152 bytes,1–100 pages. Server validates canonical base64 and hash; PDF parsing uses bounded worker (128MiB,5s,at most2 concurrent workers), rejects encrypted/malformed/active-action/embedded-file/XFA documents without rewriting originals. Browser performs preliminary type/size checks but is not authoritative. Auth and gate checks precede parsing. Gate `afcFormUpload` is independent and defaults false; reads require authorization even when writes disabled.

API:`GET /api/v1/afc-forms/capabilities`, `GET /api/v1/afc-forms?facultyId=&cursor=&limit=`, `POST /api/v1/afc-forms`, `GET /api/v1/afc-forms/{id}/document`. POST has requestId/facultyId/fileName/contentType/fileBase64; no arbitrary metadata. Retry same upload with same requestId; SQL transaction binds replay to identical faculty/filename/hash. Lists use bounded pagination, download rechecks roles/hash and audits access. Binary transport extends existing strict PDF route allowlist; attachment filename generated from document ID, no-store/nosniff and sandbox headers.

## Integrity, testing and delivery

Additive SQL048 creates immutable storage and narrow upload/list/get procedures plus execute-only role with direct-table DENY, no membership grants during migration. Upload and audit commit together; revoked/disabled/password-change actors denied in SQL as well as API. Uploaded bytes never enter audit JSON, logs, browser caches, Git or Hosting. Do not weaken approved-artifact gate or document approval rules.

Test first:real synthetic PDF parser/malicious PDF cases; API role/gate/field validation; SQL authorization/replay/rollback/integrity and audit; actual HTTP binary/body limits; UI selection/validation/upload retry/auth-switch/download; history only exposes safe metadata to authorized admin, no upload content. Full suites, independent review, separate immutable runtime promotion, exact-main CI/artifact and coherent SQL/API/Hosting release follow existing authorization. No live invented AFC document for acceptance; use isolated SQL fixtures. Human actual document acceptance remains explicit.

## Alternatives and boundaries

Reusing AfcArtifact rejected because it would mislabel unapproved originals. Public storage rejected because SQL is existing approved authority. PDF metadata preview avoids active-document rendering and keeps originals unchanged. Task13 migration remains complete, never replay. Task14 full CCC replacement is a separate design/plan/commit boundary. Course Calendar replacement remains outside this task.
