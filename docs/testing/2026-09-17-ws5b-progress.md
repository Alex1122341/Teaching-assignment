# WS5B implementation checkpoint

Baseline: `86bd5aa2c8a25259f3f708e49b322220ff43a147` (merged WS5A).
Plan: `docs/superpowers/plans/2026-09-17-approval-routing-roles-privacy.md`
on `design/workstream-5-scheduling-approval-routing`, including the self-review amendments.

## Implemented in the foundation checkpoint

- Explicit ADC/LAB capability policy, without expanding `UCVM.admin` or history access.
- Owner account form supports office name/email and links an existing Authentication UID without creating another login. Linking refuses to overwrite an existing profile. New profiles require password change.
- ADC/LAB profiles cannot carry Faculty identity fields. Existing ADFA permissions are preserved.
- Allowlisted `calendar_sessions` converter, with no private assignment/Faculty/AFC properties copied.
- Read rules deny ADC/LAB private sessions, Faculty, swap availability indexes, CCC/AFC data and legacy private request/audit records, including records bearing a previous matching actor/requester UID.
- Calendar reads require active, password-complete accounts. Calendar writes remain disabled until the paired-write and repair implementation is complete.

## Source display invariant

The calendar converter preserves the source's existing public `instructor` string and derives display names only from that string. It does not reconstruct it from private assignments. This implements the normative source/calendar equality requirement in the self-review amendments; a stale source display string must be fixed at the source writer, not silently diverge during calendar repair.

## Validation

Unit tests cover the capability matrix, denial for unknown roles, office identity isolation, UID linking without Auth creation, refusal to overwrite an existing profile, unknown-time preservation and sanitizer allowlists. Emulator tests cover the server-side privacy boundaries and Owner-only profile creation.

Local full-suite baseline has an environment limitation: PowerShell (`pwsh`) is not installed, so the existing Azure BuildOnly test cannot run locally. This test is not skipped or weakened in CI. GitHub Actions runs the full unit/static and Auth/Firestore emulator suites.

## Still required before WS5B release

- [ ] ADC/LAB timetable entry and field-scoped editors; all private reads avoided in office UI.
- [ ] All session writers and import/restore paths pair source/calendar writes; rules enforce consistency.
- [ ] Calendar verify/repair maintenance and backfill rollout.
- [ ] Multi-office routing, privacy-separated requests, decision queues and atomic final apply.
- [ ] Push Back / Resubmit / Withdraw and workflow notifications.
- [ ] AFC requester withdrawal and race tests.
- [ ] Complete emulator, browser and release checks.

This is **not** a deployable WS5B release. Do not merge, deploy live Firestore rules, backfill live data, or activate office accounts at this checkpoint. Pages and Azure share live Firebase data.
