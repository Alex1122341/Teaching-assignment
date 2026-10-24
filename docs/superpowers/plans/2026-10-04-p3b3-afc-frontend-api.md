# P3B3 AFC Frontend/API Implementation Plan

> **For agentic workers:** Execute inline in the isolated worktree. Use test-driven development for each behavior. Steps use checkbox syntax.

**Goal:** Route VetMed-Ops Beta AFC requests and approval decisions through the authenticated University API while preserving Firestore-mode behavior.

**Architecture:** Extend the existing bearer-token client for the six AFC routes. Use separate SQL-mode requester and approval modules, selected only when the backend is `vetmed-ops`; keep the legacy Firestore workflow behind its existing backend guard. Defer SQL-backed PDF transport until its API contract exists.

**Tech Stack:** Vanilla browser JavaScript, Firebase Auth ID tokens, existing PAWS University API, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-04-p3b3-afc-frontend-api-design.md`

## Global Constraints

- Do not send SQL credentials from the browser.
- Keep Firebase ID-token verification and the existing one-refresh/one-replay rule after explicit HTTP 401.
- Never replay a POST after 403, 404, 5xx, or transport failure.
- Do not let the browser choose FacultyId, requester UID, Reports-To UID, role, status, workdays, teaching evidence, or audit identity.
- SQL mode must not access Firestore AFC request/audit/PDF paths.
- Do not create a PDF artifact in Firestore; do not add a guessed SQL artifact route.
- No live SQL, IAM, Firebase, Azure, firewall, deployment, merge, or main-branch mutations.

## Review Focus

- Explicit 401 during submit: one forced token refresh and at most one replay; no replay for other failure classes.
- Untrusted/high-trust submit fields: server-derived identity and workflow fields are absent from the browser request.
- Request scoped visibility: requester/Reports-To/admin listing is returned by the server API without a Firestore fallback.
- Repeated or unauthorized decisions: UI reflects server state, while the SQL API remains authoritative and the client does not infer success.
- Approved requests without artifact service: no Firestore PDF read/write and a clear pending-artifact state.

---

### Task 1: AFC data-client API

**Files:**
- Modify: `paws-data-client.js`
- Test: `tests/paws-data-client.test.js`

**Interfaces:**
- Produces `listAfcRequests() -> Promise<Array<Request>>`.
- Produces submit/withdraw/recommend/reject/approve methods returning the API's `afcRequest` object.
- All calls use the existing `request(path, { method, body })` helper.

- [x] Write tests for exact paths, methods, JSON bodies, response shapes, and bearer headers.
- [x] Run `node --test tests/paws-data-client.test.js`; the new methods failed before implementation.
- [x] Implement the six AFC methods with encoded request IDs and no identity-field enrichment.
- [x] Add a POST retry test: explicit 401 refreshes once; 403/404/5xx/transport errors do not replay.
- [x] Run the focused client test; all 14 client tests passed.
- [x] Commit as `feat: add AFC request methods to PAWS data client` (`6f80ffe`).

### Task 2: SQL-mode AFC request form and server-scoped list

**Files:**
- Create: `afc-workflow-sql.js`
- Modify: `afc-workflow.js`, `index.html`, `tools/static-assets.json`
- Test: `tests/p3b3-afc-workflow.test.js`

**Interfaces:**
- SQL mode exposes the existing `UCVM_AFC.mount({ panelId, mode })` integration.
- Submission payload contains dates, reason/details, contact information, terms evidence, and applicant signature only.
- Listing and requester withdrawal use the Task 1 University API methods. Write outcomes that are ambiguous or missing a response ID tell the user to refresh before retrying.

- [x] Add tests proving SQL-mode mount/list/submit/withdraw use the University API, omit client identity/workflow fields, and render withdraw only for the requester in pending states.
- [x] Run the new focused test and verify it fails because the SQL workflow module is absent.
- [x] Implement the SQL-mode module and branch selection while preserving the existing Firestore workflow.
- [x] Escape request/user data and show approved-PDF delivery as pending without an artifact API.
- [x] Run focused requester tests and relevant legacy AFC regressions.

### Task 3: SQL-mode Reports-To/Admin decisions

**Files:**
- Extend: `afc-workflow-sql.js` (shared request list and panel)
- Test: `tests/p3b3-afc-workflow.test.js`

**Interfaces:**
- SQL workflow buttons are visible from current role/UID and server-returned status; API authorization and SQL state remain authoritative.
- Reports-To recommendation/rejection and Admin approval/rejection call the Task 1 methods with captured signature evidence.

- [x] Add tests for requester, Reports-To, and Admin affordances and API calls, plus a transport failure that must not be replayed.
- [x] Implement stage-appropriate buttons, signature capture, rejection reason, refresh/error feedback, and pending-artifact UI.
- [x] Run focused SQL-mode cases and legacy AFC containment regressions.

### Task 4: Freeze candidate, continuity, and final verification

**Files:**
- Modify: `tools/beta-freeze.js`, `tools/beta-api-freeze.js`, `tools/beta-baseline.json`, `tests/beta-baseline.test.js`, and only other freeze fixtures required by their tests.
- Modify: `agent.Ai/PROJECT_STATE.md`, `agent.Ai/TASK_CHAIN.md`.
- Create: `agent.Ai/updates/YYYY-MM-DD-HHMM-p3b3-afc-frontend-api.md`.

- [x] Verify the changed frontend assets are included in the protected static manifest.
- [x] Record the P3B3 product candidate as the frozen review candidate without implying deployment.
- [x] Run Node syntax checks for changed JavaScript.
- [x] Run `npm test` at repository root and `npm test` in `server/`; read and record exact totals.
- [x] Run static/API freeze verification; expected zero drift at the exact candidate commit.
- [x] Record no SQL, Firebase, Azure, or live deployment mutation; commit the governance/docs update separately.
- [x] Review the final branch diff against `a45d63a986e18808b02cd36599e35a6479ec574c`; do not merge or deploy.

## Review Boundary

The P3B3 code path will not read/write `afc_requests/{id}/pdf_chunks`. Approved-PDF storage/transport remains a separate artifact API design item and must be reported as pending if no concrete API contract is supplied.
