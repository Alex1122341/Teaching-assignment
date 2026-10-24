# DOE Worksheet source recovery — 2026-10-08

## Authorized scope and evidence

Owner requests recovery of unavailable Worksheet lines, complete totals and accurate calculation status, with no guessed values. Owner supplies UCVM_Workload_Guidelines.pdf and identifies `# Trainees` in Teaching Assignments 2026 27 MASTER (8).xlsx. Owner confirms five missing faculty trainee counts are zero and authorizes missing DOE formula rows to be calculated using the existing sheet formulas, including VETM 506 / IM: one trainee 0.5%, more than one capped at 1%.

PDF SHA256: `e1b3261e268b43b14e474051a8fd68fe3910d45cf2179c72fd118bc8f7a005b5`. Workbook SHA256: `a834d571a25942a1242c9ae3d4f56f975525dfa48658c76883a92dac6bb1d1b4`. Identity crosswalk comes from the existing Faculty Master List's exact preferred/HR name bindings. No fuzzy matching. Raw faculty data and private plans remain outside Git.

Section 6.3, p. 4 establishes threshold 35%, equal initial split, >35% trainee ceiling 15%, Teaching-Focused ceiling 7.5%, and three-year graduate supervision averaging with current-year fallback when history is unavailable. This source contains only current-year trainee counts, so no historical counts are invented.

## Root cause and implementation

Worksheet read repository discarded every legacy teaching/role DOE by setting resultDoe=null, even while Teaching Summary correctly resolved the same stored/approved values. Reuse that resolver, retain meaningful zero and not-applicable semantics, and separate known amounts from nonblocking calculator discrepancies. Real unknown amounts remain unavailable.

Add two source evidence tables via migration 028: approved workload source parameters and per-faculty supervision snapshots. Import 116 uniquely matched/owner-confirmed snapshots, 42 explicit zeros, raw aggregate 569.25 percentage points. Preserve source counts, source/cached/formula evidence, hashes, actor and time. Annual immutable calculation records and draft Annual Rule Book remain independent of this recovered source view; no policy publication or gate change is implied. Prefer current annual supervision facts when present to avoid duplicate credit. Existing active annual reserve parameters take precedence; explicitly supplied PDF parameters fill only missing ones.

Worksheet totals use the same reserve service; recognize the exact live Teaching-Focused spelling. UI labels calculated values as `Calculated from recorded sources`, shows the workload source and target snapshot separately, and reports the latest real calculation evidence date. It never fabricates annual policy publication or timestamps. Missing source coverage/contract targets stays explicit, including non-person placeholders.

## Execution order

1. Review product changes and source preparation/import scripts.
2. Commit product, separately promote static/API frozen anchor to that exact product, review governance, open PR and await normal CI. No manual test suites or new tests were requested/run; existing contract assertions are updated to match the repaired API semantics.
3. Apply schema 028, run default transaction/rollback import preview, then `-Apply` once. Replay/identity/source/count guards stop drift. Import keeps existing target, role and session records intact.
4. Merge reviewed PR, await exact-main CI, deploy exact API and Firebase Hosting static-only, preserving configured credentials and all write gates.
5. Confirm the live Worksheet and DOE List values/source status. Preserve private before/after evidence.

Recovery: restore the previous API/static release. To remove imported snapshots, require all 116 current Faculty/year/id/raw/evidence rows and workload parameters to equal the private approved plan before a transaction deletes only those source snapshots and workload source row. Do not drop source tables or alter annual evidence, targets, roles, sessions or user edits. Reuse the preserved plan for re-import if recovery is reversed.

## Explicit frozen runtime promotion

Product anchor `0e6f7a20dae9f0ba86f4157aabefda0a1fa8fb5f` promotes previous anchor `6b859ca63810dac7a34f31053cd651e735dbd653`. Protected delta: faculty-admin-doe-worksheet.js, sql-doe-worksheet-repository.js, doe-worksheet-service.js, doe-reserve-service.js. No protected path removed; static manifest and package inputs unchanged. The separate governance commit updates the shared Git-object anchor, current assertion pins and reporting together; historical commits remain immutable. Independent product/governance review precedes release.

