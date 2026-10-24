# ADFA SWAP preview — implementation and acceptance

## Scope and existing foundations

Owner selected the Beta repository and requested the existing SWAP interface to show current DOE, projected DOE and Check availability in the reference table layout. The owner approved UI, authenticated API and actual SQL test seams. Later instruction: finish and verify this task, proceed directly to the next task, do not invoke grilling, and skip missing-input questions.

The existing SQL030/039 request, revision, consent, approval and apply state machine remains authoritative. Existing SQL UserProfile role helpers, opaque SwapCandidate mapping, Calendar activity availability, real DOE workflow preview/worksheet/calculation services, authenticated data client, and SWAP dialog are reused. The missing part was a bounded read projection and its ADFA table. No second SWAP workflow or browser workload calculator is introduced.

## Implementation

- SQL042 adds an execute-only, read-only ADFA resolver to the existing read role. It checks actor permission, current session snapshot, exact active outgoing assignment and active opaque candidate; reuses Calendar/AFC/timetable availability and returns only public timetable conflicts.
- GET `/api/v1/swaps/faculty-preview` derives privileges from SQL profile, resolves IDs privately, runs the real existing DOE services, rechecks session/identity and returns an allowlisted DTO. It persists neither preview evidence nor audit/business writes. Unknown amounts remain null/Needs Review. DOE change is derived by the server in percentage points.
- ADFA panel displays assignment/role/persisted credit, current/projected DOE, target/remaining, availability and allowed timetable conflicts. Name search and six-row pages bound preview requests. Missing specialty/teaching-area metadata is skipped; no invented metadata or UID search/labels.
- Selection and submission recheck availability. Needs Review blocks selection; known Unavailable can still enter the existing approval/override workflow. This change grants no apply authority. Saved-session replacement preview is separate from the existing standard schedule-edit form.
- Dialog close, mode switch and obsolete requests ignore late responses. Preview failure clears selection and projected outgoing values; stale/permission failure clears cached values and offers a fresh session reload.

## Evidence to date

- RED→GREEN observed for role denial, strict query input, real calculation/wiring, public capability, permission inventory, candidate rendering, fresh selection, bounded pages/search, unknown availability denial, selection feedback, clear assignment, mode-switch cancellation, stale preview and server-derived DOE change. Logs are outside the repository in the task Temp directory.
- Node22 server suite:597 total,596 pass,1 SQL-environment skip,0 failures. Focused UI/client/static graph/hosting tests:50/50. Full root and final candidate CI remain pending at this checkpoint.
- Actual disposable SQL acceptance at product f0c1acf: run38676486384 SUCCESS; SQL042 accept/rollback plus existing Calendar foundation/races/rollback. Migration validation38676486395 SUCCESS. This is synthetic disposable SQL, not University migration acceptance.
- Chrome local synthetic acceptance uses actual product UI/client/router/repository/DOE modules with synthetic SQL/policy sources and a stub authentication boundary. Both ADFA aliases show calculated totals; ordinary faculty have no DOE panel. Search, next/previous, selection, timing change before submit (blocked), service outage, refresh and standard form switch were checked. No real request was submitted.
- Responsive DOM at390px: dialog353px wide, table container305px with780px horizontal content; viewport override reset. Desktop table rendering inspected. No JavaScript exception in captured console. Injected503 is expected.

## Independent review and executor rulings

Fresh-context whole-feature review covered a60aa98..a234672 and the subsequent small fix pass. No Critical findings. Two Important issues and one Minor were reproduced and resolved:

- Initial-context Needs Review blocked a freshly checked Available candidate. An observed failing public-dialog regression now passes; panel mode uses its fresh server check and updates the notification display, while standard mode retains the original guard.
- Mode switch dropped the note, notification and replacement draft (Minor). The draft overlay preserves current values without turning a new request into a revision or changing a revision's version.
- The draft fix exposed schedule-only requests retaining an automatic outgoing assignment without a replacement (Important), and cleared revision candidates being restored (Minor edge). Two observed failing public-dialog regressions now pass; explicit empty selection is retained and schedule-only mode carries no assignment change.

Reviewer re-inspected the complete fix pass and returned Ready with all findings resolved. Final focused SWAP/client/panel/old-guard tests18/18 pass. Chrome rechecked preservation of actual select values, note and checked notification through the real mode switch. Full local root before this final small fix:844 total,807 pass,32 emulator skips,5 old-freeze failures only. Separate freeze-governance review and final full CI are still required; no drift exemption is permitted.

## Release and data boundary

Draft PR99 depends on unmerged Calendar PR98 and must be reviewed from parent a60aa98. No merge, deployment, live SQL migration, role binding, write-gate change, account creation or permanent AFC operation is performed. The dedicated least-privilege service-account prerequisite remains unresolved. Skipping questions does not supply missing identities or release authorization.

## Final candidate acceptance — 2026-10-15

Product0f81c3e0b7e63a9b9357755b7e957406018894fd; separate independently accepted governance/head c6dab5d39ba3e15fad825c587327dabf51974665. Beta Build38678006715 SUCCESS: root849 total/817 pass/32 skips, Linux server597/595 pass/2 environment skips, full Auth/Firestore emulator849/849 zero skips, container build, repository/artifact static+API freezes, governance57/57. Local Windows server597/596 pass/1 SQL-environment skip; final local root849/817 pass/32 emulator skips/0fail.

Actual SQL run38678006632 SUCCESS includes thirteen observed two-connection races, populated/empty guarded rollback and ADFA_SWAP_PREVIEW_SQL_ACCEPTANCE_OK / ADFA_SWAP_PREVIEW_ROLLBACK_OK. Migration validation38678007053 SUCCESS. All three runs are associated with exact PR headc6dab5d (PR merge test artifact uses merge SHAc20beef615c61e41f0d781717a86e15ffeaea2dd).

Downloaded artifact11947096027 SHA256a7504ea380c102594fd96cb80e9e27db28e28a9d7af7fca737fa287e52623ff6 matches GitHub's digest; expiry2026-10-22T03:49:52Z. Candidate static/API artifact blobs were checked separately against product0f81. Canonical Beta artifact contains76 app files (75 shipped runtime plus host config),74 API files (73 runtime plus artifact inventory), no repository/test/workbook/recovery/credential paths. The separate build-static output has only75 runtime assets and intentionally omits Azure host config; use canonical Beta app for the CLI artifact freeze check.

Implementation, product review, governance review and synthetic acceptance are complete for this ADFA UI extension. Live release and the broader original Task01 transition-coverage audit are separate; no live acceptance is claimed. Continue full-directive Task02 in the existing Tasks interface. Owner now permits essential questions but still prohibits grilling.
