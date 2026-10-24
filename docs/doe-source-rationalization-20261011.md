# DOE source rationalization — 2026-27

Owner approved the all-anomaly design and confirmed on 2026-10-11 that the 14 conflicting VISC/Zoo-rotation allocations must use the explicit MASTER values.

## Source rules and current-year mappings

- Existing candidate Draft updated from revision1 to2; 58 rules,56 course mappings,25 literal subject groups,25 assignment-scoped source allocations.
- MASTER SHA256 a834d571a25942a1242c9ae3d4f56f975525dfa48658c76883a92dac6bb1d1b4.
- Exact source-name/scope association matched185 CC/HICC/VISC/Rotation/CCC records. No fuzzy identity matching.
- Clinical course aliases retain both Vet Med and VTMD labels with confirmed units. Full-label resolution precedes code resolution; duplicate mappings are rejected.
- Each literal MASTER VISC Subject Area is one group; slash separators do not imply multiple subjects. Stable keys and original aliases are retained.
- 36 explicit rotation Weeks quantities are documented in source-scoped formula rules; two allocations without numeric Weeks retain explicit source DOE through exceptions.
- CCC formula is shifts ×0.5 minus explicit source half-day deduction. Cached MASTER S values already include the deduction; never subtract it twice.
- Source-specific FTE, leave, split and other allocated values are preserved by assignment/faculty-scoped exceptions. No automatic month/day prorating.
- One rotation has blank source DOE but explicit16Weeks and a matching existing40% allocation; its formula is confirmed from the quantity, not filled with zero.

## Live data correction and acceptance

Fourteen owner-confirmed allocations updated through one guarded transaction. Existing overrides were required absent; identity, role, scope and before values were rechecked under locks. Immutable DoeAuditEvent entries and private before/after snapshots retain recovery evidence. No target, supervision count, identity, period or timetable fields were changed.

Full source audit at revision2 covers5282 records:4970 teaching,196 roles,116 supervision snapshots. Every candidate result matched the corrected recorded allocation, including owner-confirmed supervision zeros. Formal Impact Preview45a5d49b-aa1d-4e2f-852d-13f9776a6ce7 reported0 changed,0 Needs Review,0 mapping gaps,0 delta.

This evidence comes from staged candidate modules reading actual authorized SQL sources. It is not a runtime deployment or publication claim. Re-run with the exact accepted release before conditional publication.

## Lifecycle changes

Impact Preview now includes recorded teaching, roles and supervision plus negotiated manual adjustments, in addition to normalized annual facts. It fingerprints the full relevant source records and inputs. Publication checks the latest fingerprint and zero unresolved projections within a SERIALIZABLE transaction. The UI's500faculty limit is checked with501fetch and overflow rejection; partial results cannot produce publication evidence.

Lookup retains same-year source reference evidence when a normalized Active policy replaces a snapshot-only policy. The retained rows expose their real source version rather than being relabelled as candidate rules.

Approved annual source exceptions clear old-calculator discrepancy flags only when their fixed allocation agrees with the recorded value. Unknown targets or supervision data stay unavailable.

## Review and limits

Independent review found the500faculty truncation risk; explicit overflow rejection fixes it. Closure review reported no remaining findings. Syntax/diff checks passed; no additional tests run or added. Existing automated CI remains the release gate.

Private receipts are on the authorized server under Acceptance/RuleBookRationalization-20261011; personal source records are not repository content. Do not rerun revision1 Draft import or14-role corrections. They are guarded against repeat application.
