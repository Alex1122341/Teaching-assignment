# Firestore rules publication and rollback runbook

## Historical W1G audit — 2026-10-06

This runbook records a read-only W1G audit. It does not authorize or perform a
publication. The main commit audited on that date was
`156d2e5f60f7cd3afe40a6ad7972f10b0b7d0ffe`.
Beta's repository/runtime configuration identifies Firebase project
`tester-teaching` (`faculty-access.js`, `faculty-admin.js`, `timetable.js`, and
the University API's `FIREBASE_PROJECT_ID`). `firebase.json` maps Firestore
rules to `firestore.rules`.

The configured Firebase CLI OAuth session read the production Rules REST API:
GET the project's releases, then GET the source of the referenced ruleset. The
default database release at capture time referenced
`projects/tester-teaching/rulesets/7dcc6e4d-3b95-497d-a0d6-9cc51d00ad7e`.
Its release `updateTime` is `2026-10-06T04:52:51.800661Z`. The normalized live
rules SHA-256 is
`d82149400fad4bf910835bbdb951aabb16bd5660fbeded3010a344b56bce4740`.
That equals the normalized `firestore.rules` at the exact W1G main SHA. The
captured live rules and that candidate had no authorization delta; do not
publish an identical ruleset merely to complete this checklist.

Normalization is UTF-8, CRLF to LF, trailing spaces/tabs removed per line, and
exactly one terminal LF. The exact live source captured at
`2026-10-06T11:44:53.352Z` is preserved outside the repository at:

Private external evidence bundle
`paws-w1g-firestore-rollback-20261006T114453Z/firestore.rules` (the original
workstation-specific directory is intentionally omitted).

Its raw SHA-256 is
`7258aa2eaecab8936feb7aa450bee223a22d1c6798ddfe08964cb3358f358e6a`;
normalized SHA-256 is the value above. The capture metadata and retrieval
method are in the adjacent `metadata.json`. Before any future change, refresh
this capture immediately before publication and record the then-current
release, timestamp, raw and normalized hashes; never rely on this older capture
if live rules have changed.

### Review on 2026-10-16

This document was retained for its historical audit and future recovery procedure
after review against Beta main `21c2db7bc962c773d4863c03fa7f49b4d15120da`.
No fresh live Rules API read or verification of the external recovery file was
performed in this review. The dated ruleset, hash and machine-specific backup
path above are historical evidence, not current release or rollback authority.
The active application continues to use the University SQL API for business
data; Hosting-only releases do not publish these Firestore rules.

## Authorization behavior and impact

At the W1G capture, live and candidate sources had the same normalized hash,
so each path below had no live-to-candidate behavior change. The table describes
that dated candidate, not an attestation of today's live rules. Effects describe
the audited candidate behavior and the expected impact if it is published when it differs
from a future live ruleset. Rollback restores the exact pre-change ruleset;
that may restore weaker authorization if that is what the new preflight
capture contains, so compare and review it before use.

| Path | W1G live authority at capture | Candidate authority / change | Security purpose and expected user impact | Rollback impact |
| --- | --- | --- | --- | --- |
| `sessions/{id}` | Signed-in, active/eligible profiles may read; create/update/delete denied | Same; no delta | SQL remains canonical; timetable reads continue, browser writes fail closed | Exact pre-change source restores the captured session policy |
| `faculty/{id}` | Admin or linked faculty may read; create/update/delete denied | Same; no delta | SQL-canonical Faculty/DOE values cannot be browser-edited; reads remain scoped | Restores the captured Faculty policy |
| `settings/{id}` | Admin reads, with a scoped faculty-swap-index read; writes denied | Same; no delta | Derived settings cannot become browser-controlled authority | Restores captured settings policy |
| `public_schedule/{id}` | Eligible signed-in users read only `ccc_events`; all writes denied | Same; no delta | Browser cannot publish canonical schedule; public schedule reader remains available to eligible users | Restores captured publication policy |
| `session_change_log/{id}` | Eligible own/history reads; all writes denied | Same; no delta | Browser cannot forge canonical session history | Restores captured history policy |
| `faculty_change_log/{id}` | Eligible own/history reads; all writes denied | Same; no delta | Browser cannot forge canonical Faculty history | Restores captured history policy |
| `audit_events/{id}` | Eligible own/history reads; all writes denied | Same; no delta | Canonical audit remains server-owned | Restores captured audit policy |
| `afc_requests/{id}` | Scoped requester/reviewer reads; all writes denied | Same; no delta | AFC business submissions and decisions remain on SQL/API path | Restores captured AFC policy |
| `afc_requests/{id}/pdf_chunks/{part}` | Parent-scoped reads; all writes denied | Same; no delta | Browser cannot forge approved AFC artifacts | Restores captured artifact policy |
| `afc_audit/{id}` | Scoped own/history reads; all writes denied | Same; no delta | AFC audit remains server-owned | Restores captured AFC audit policy |
| `change_requests/{id}` | Requester/approver reads; validated faculty proposal create and constrained approver decision update while teaching data is open; delete denied | Same; no delta | Proposal state is noncanonical; direct session mutation remains denied and this path grants no SQL API authority | Restores captured proposal workflow, which may affect queued proposal UX |
| `users/{uid}` | Self/general/scoped faculty reads; validated role-authorized create/update and self password completion; delete denied | Same; no delta | Account UI works with field/role constraints; Firestore role claims do not authorize SQL API | Restores captured account UI policy |
| `faculty_groups/{id}` | Admin/owner/member scoped reads; validated general writes; constrained HICC owner member update; general delete | Same; no delta | Preserves previously accepted faculty-group behavior | Restores captured group policy and may affect group management |
| `account_audit/{id}` | Eligible own/history reads; constrained create only; update/delete denied | Same; no delta | Account audit remains append-only for clients | Restores captured append-only policy |
| `public_info/{id}` | Eligible read; validated general create/update; delete denied | Same; no delta | Notices remain available and maintainable by general administrators | Restores captured notice policy |
| `settings/system_state` and import metadata | Eligible read; narrowly validated general maintenance acquisition and owner/takeover/completion transitions; delete denied. Import-job subpaths are separately scoped to an active job/owner | Same; no delta | Supports accepted import recovery metadata only; missing/malformed/false/true lock state does not reopen canonical business writes | Restores captured maintenance workflow, potentially changing recovery operations |
| Fallback wildcard | All unmatched reads and writes denied | Same; no delta | Prevents unreviewed Firestore paths from becoming writable | Restores captured fallback policy; compare before use |

Firebase Authentication establishes identity/UID/token validity. SQL
`paws.UserProfile` (`BaseRole`, `Active`, `MustChangePassword`, `FacultyId`)
remains the server-side SQL API authority. Firestore `users.role` and
`facultyRoles` are not SQL API authority.

## Future separately authorized publication

Publication is a distinct live-change boundary. Require an approved change
window and an exact reviewed commit. Do not proceed if the project, release,
or source hash differs from the reviewed preflight. Refresh and preserve the
exact live rollback source first. Confirm the repository target is only
`firestore.rules`; no other Firebase resource may be included.

From that exact clean checkout, the only publication command is:

~~~powershell
npx firebase deploy --only firestore:rules --project tester-teaching
~~~

This targets Firestore rules only. Do not add Hosting, Functions, indexes,
Firebase Auth, Storage, or other resources. This command is documented for a
future separately authorized operation and has not been executed as part of
W1G.

After any separately authorized publication, use the read-only Rules REST API
to retrieve the default database release and referenced ruleset source again.
Record its ruleset name and `updateTime`; normalize the returned source and
compare its SHA-256 with the approved candidate. Do not prove denial by trying
to write a production business document.

No-business-write acceptance sequence:

1. Confirm normal Firebase login and account/UI reads still work.
2. Confirm approved user/group operations and public information reads using
   existing scoped paths; avoid creating synthetic users or groups in
   production.
3. Confirm SQL-backed timetable/dashboard reads with ordinary authenticated
   read routes.
4. Confirm exact release/ruleset identity and candidate normalized hash via
   the read-only Rules API.
5. Rely on the exact ruleset identity plus the emulator matrix for denied
   session, Faculty/DOE, AFC, audit/log, `public_schedule`, and fallback writes.
   Do not attempt production write probes or create business/audit documents.

## Future separately authorized rollback

Rollback must use the exact source captured immediately before the particular
authorized publication being reversed. The October 6 capture above must not be
used merely because it appears in this runbook. Preserve the new pre-change
project/release/ruleset identifiers, raw source and hash outside the repository.

Before rollback, read the current release and source, confirm the intended
project, and verify the saved pre-change source against that operation's
recorded hash. An unrelated intervening publication requires review; do not
replace it with an older capture. If the capture is missing or its hash differs,
stop without publishing.

After separate authorization, use a clean temporary checkout, preserve its
candidate `firestore.rules`, copy the verified pre-change source into that file,
and run only the rules publication command shown above. Retrieve the resulting
live release/source through the read-only Rules API and compare the raw and
normalized hashes to the intended rollback source. Restore the candidate in the
temporary checkout after verification. No rollback or rules publication was
performed by the W1G audit or the October 16 review.
