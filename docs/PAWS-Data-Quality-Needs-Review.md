# PAWS Data Quality — Needs Review

**Environment:** live Beta, `VetMed-Ops`
**Academic year in source:** `2026-27`
**Audit date:** 2026-10-04
**Method:** read-only aggregate queries. No session, faculty, role, DOE, or AFC rows were changed.

## Review queue

| Area | Count | Finding | Required source/decision |
|---|---:|---|---|
| Session timing | 35 | Missing start/end time; no date, reversed interval, before-grid, or after-grid rows were found in the aggregate check. | Source timetable owner must provide the intended interval or explicitly keep it unknown. |
| Session identity | 1 group | A duplicate normalized session identity group exists. | Compare the source workbook/session identifiers and choose the canonical record. Do not delete either row based only on the duplicate key. |
| Session assignment identity | 1 group | A duplicate `(SessionId, FacultyId)` group exists. | Review the source rows and DOE attribution before consolidating. |
| Teaching assignment DOE | 91 rows | 26 OSCE and 65 Quiz/Midterm rows have no `TeachingRole`; DOE credit, rate, and unit are all absent. | Supply the source teaching role and authoritative DOE rule/rate; session type alone is insufficient. |
| Role DOE | 78 rows | 64 `Course Coordinator / HICC (legacy ambiguous)` and 14 `CCC` rows lack both mapped DOE and override. | Provide an approved role mapping and academic-year scope. The legacy HICC label is ambiguous. |
| Role temporal/category fields | 162 rows | `RoleCategory`, `EffectiveDate`, and `ExpirationDate` are absent across the current role-assignment rows. | Provide category and effective/expiration dates from the approved role source. |
| Faculty FTE | 108 faculty | FTE is null. Four rows also have blank rank and four have blank stream; overlap is not inferred. | HR/contract source for FTE, rank, and stream. |
| Joint appointments | 10 of 14 rows | One or both FTE values are missing. | Approved joint-appointment allocation source. |
| Professional profile | 4 active faculty | No profile row exists. | Optional profile source/owner review; the audit does not assume every active faculty record requires one. |
| Course display casing | 1 course row | `1-Intern Training` is mixed case, but it is not a duplicate key. The four sessions previously flagged by an uppercase-only heuristic exactly match their linked Course value. | Keep the source display as supplied; uppercase conversion is not justified. |
| UserProfile coverage | 119 active faculty | Only one active faculty row has an active UserProfile link; all three current profiles have required fields, valid Faculty links, and unique normalized email. | Confirm which faculty are expected to have application accounts; roster membership alone does not authorize creating profiles. |

## Additional checks

- 1,937 sessions across one canonical academic-year value; 4,970 session assignments.
- No missing session dates, reversed/zero intervals, or before/after-grid time intervals were found. The 35 Check Needed rows are missing-time cases.
- No orphan course, faculty, session, or alias references were found in the reviewed joins; alias target names resolve to a Faculty row. Session.CourseCode matches its linked Course in every joined row.
- Five `SessionType` values are present. No whitespace-only type variant was found.
- Role assignment vocabulary: 14 CCC, 64 `Course Coordinator / HICC (legacy ambiguous)`, 11 Designated Rotation Coordinator, 38 Rotation Participant, and 35 VISC. Only VISC directly matched a RoleDefinition database-role name; RoleType is not assumed to be identical to DatabaseRole.
- 120 active faculty; 5 aliases with no blank, duplicate-normalized, missing-Faculty, or unmatched-target issue.
- 43 courses; no blank, duplicate normalized, or whitespace-variant course codes. One mixed-case display value is retained for review, not normalized.
- No exact duplicate JointAppointment or RoleAssignment identity groups were found. One duplicate normalized session identity group and one duplicate `(SessionId, FacultyId)` group remain unresolved.
- 791 imported legacy AFC records; no manual AFC rows, requests, approvals, or artifacts yet.
- Three SQL user profiles passed the aggregate required-field and duplicate-email checks.
- `FacultyResolutionStatus` is a resolution-method vocabulary (`hr_name`, `placeholder`, `preferred_name`, `alias`), not a resolved/unresolved boolean. It was not counted as an unresolved-reference flag.

## Normalization result

No deterministic, source-backed normalization was identified in this audit. **Applied: 0 rows.** The uppercase-only Course/Session heuristic was replaced by a reference-integrity comparison: the four mixed-case session values match their linked Course exactly, so no Session update is appropriate. The follow-up audit therefore has the same business-data counts as the before audit. The aggregate-only query pack is in `docs/sql/paws-beta-stabilization-readonly-audit.sql`.

Do not trim or case-fold identifiers, choose among duplicate sessions/assignments, fill FTE/rank/stream, or derive DOE values until the source owner confirms the intended value. Do not delete historical rows to make duplicate counts zero.
