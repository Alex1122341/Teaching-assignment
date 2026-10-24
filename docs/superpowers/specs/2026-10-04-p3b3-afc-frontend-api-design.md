# P3B3 AFC Frontend/API Design

**Status:** Implementation brief from the owner's delegated Architect #5 direction.

## Goal

Move AFC request and approval interactions in the VetMed-Ops Beta path from Firestore to the existing University API while preserving the legacy Firestore path for users whose business backend is Firestore.

## User and security contract

- Firebase Authentication remains the browser identity provider.
- The browser uses `paws-data-client.js` and the University API only; it sends no direct SQL credentials.
- The API derives requester Faculty, Reports-To, role, status, workdays, teaching evidence, and audit identity. The UI must not submit those fields.
- The API scopes request listing to requester and assigned Reports-To, or to administrator roles. SQL procedures remain authoritative for every transition.
- Keep the existing API client's retry rule: on an explicit first 401, force-refresh the Firebase ID token and replay once. Do not replay after 403, 404, 5xx, or transport failure, including non-idempotent POSTs.
- Keep `Encrypt=true` and `TrustServerCertificate=false`; this work does not change SQL, IAM, firewall, Azure, Firebase, or deployment state.

## API surface

Expose these methods from the data client:

- `listAfcRequests()` — GET `/api/v1/afc-requests`, returns `afcRequests`.
- `submitAfcRequest(payload)` — POST `/api/v1/afc-requests`.
- `withdrawAfcRequest(id)` — POST `/api/v1/afc-requests/{id}/withdraw`.
- `recommendAfcRequest(id, payload)` — POST `/api/v1/afc-requests/{id}/recommend`.
- `rejectAfcRequest(id, payload)` — POST `/api/v1/afc-requests/{id}/reject`.
- `approveAfcRequest(id, payload)` — POST `/api/v1/afc-requests/{id}/approve`.

The submission preserves the accepted applicant signature and terms evidence. Report-To/Admin decisions send only signature evidence and, for rejection, a reason.

## UI behavior

- SQL mode renders the existing AFC request form, lists API-scoped requests, permits requester withdrawal only in `pending_report_to` or `pending_admin`, and exposes Report-To/Admin decisions for the corresponding server-returned requests.
- Admin and Reports-To on-behalf authority is enforced by the server; UI role checks only decide which controls to display.
- Firestore mode retains its existing AFC behavior.
- SQL mode must not read Firestore `afc_requests`, `afc_audit`, or `afc_requests/{id}/pdf_chunks`.

## PDF artifact boundary

The current API has no SQL-backed PDF artifact route or storage contract. SQL-mode approval will persist the workflow decision and availability through the existing API; the UI will clearly indicate that PDF delivery is pending a separate artifact API. It will not render/write an approved PDF into Firestore or read old Firestore PDF chunks. Designing and provisioning a durable artifact API is a separate follow-up.

## Out of scope

No live SQL migration/apply, runtime SQL grant, Firebase IAM/Auth or Firestore mutation, live deployment, merge, network/firewall change, or change to the approved AFC workflow state machine.
