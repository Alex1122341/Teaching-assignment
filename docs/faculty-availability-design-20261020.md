# Faculty Availability — single-faculty read-only lookup

**Owner approval:** 2026-10-20. **Repository:** controlled Beta, Teaching-assignment-azure. **Scope:** new Dashboard Availability tab; no business writes.

## Reuse inspection

- Legacy \`availability-lookup.js\` is Firestore/name-match based and must not be reused as Beta authority.
- \`paws_api.SchedulingTaskIssues\` has overlapping session/AFC/activity conflict logic, but it emits only issues and is not a complete availability inventory.
- Canonical sources: \`paws.Session\` + \`SessionAssignment\`, \`CalendarActivity\` + \`CalendarActivityDayTime\`, \`vAfcRecordUnified\` (approved request included), pending \`AfcRequest\`, \`RoleAssignment\` + \`RoleAppointmentSchedule\`.
- This new bounded SQL read-only procedure is **not** a duplicate persistent table and is separate from write gates.

## User contract

- One faculty selected with a name-search datalist. The selected internal FacultyId is never shown as the visible label.
- No dates: all ongoing/future records as of *Calgary* date/time; past ended teaching sessions removed, past completed AFC/working activities/role windows excluded.
- Start only: all records overlapping \`[start,+infinity)\`; includes older records if start is historical.
- Both: records intersecting inclusive \`[start,end]\`; includes historical AFC.
- End without start: invalid.
- Categories: teaching, work beyond teaching, AFC/approved leave, pending AFC, roles/appointments.
- Teaching: timed Busy when intervals valid, otherwise Time Unconfirmed.
- Work: retains full original date range and verified per-day times; incomplete time evidence explicitly Time Unconfirmed.
- AFC: active imported/manual/approved-request unified records, availability only (no reasons, medical details or private notes).
- Pending AFC: Tentative only, not confirmed absence.
- Roles: Ongoing Responsibility, not hard-blocking days. Appointment periods inclusive; legacy ExpirationDate exclusive is transformed to displayed last inclusive day.
- A record may intersect the query even when its source startDate is earlier than the selected start date; return original full source dates.
- Result is a paged chronological Agenda; \`nextCursor\` and \`total\` are distinct from number loaded. Coverage warning counts undated session/role evidence rather than claiming all data is complete.
- No Outlook/Teams free-busy integration in v1. \`No PAWS commitments found\` is not \`available\`.

## Security and persistence

- Firebase verifies the bearer token; API checks SQL UserProfile, and the SQL stored procedure revalidates actor role / own Faculty.
- ADFA/developer can query authorized Faculty; Faculty/HICC/VISC only own linked FacultyId. Inactive and password-reset-required users denied; ADC/LAB excluded from Dashboard tab.
- SQL execute permission on single \`paws_api.ListFacultyAvailability\` for existing runtime read role. No direct browser DB access.
- No direct table grants, no secrets/logged JWTs, no new write gates, no DOE/Published changes.
- Source keys in API responses are technical stable keys for pagination/interaction only; medical/AFC reason, DOE, contacts and UCID excluded.
- Future phase: authorize Outlook Graph free/busy separately if university approves.

## Release requirements

1. Test module/unit, full root/server, canonical source SQL fixture, own/cross faculty authorization and historical range; live SQL read-only acceptance.
2. Independent product review, separate immutable static/API freeze governance promotion. Preserve all historical trust anchors and protect new shipped paths.
3. Exact-main CI + artifact hash verification; DBA approval for **only** migration 056 DDL/GRANT; verify prior SQL business rows untouched.
4. Coherent University API cutover and Firebase Hosting-only deployment, no Firestore rules/functions changes.
5. Authenticated ADFA & Faculty UI and API acceptance, check default/one-sided/historical filters, times, paging, cancelled/approved/pending AFC, no false availability, rollback plan.
6. Do not claim live or launch-ready until these receipts exist.
