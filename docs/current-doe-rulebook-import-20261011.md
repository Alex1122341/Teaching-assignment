# Current 2026-27 DOE rules transcribed into Rule Book

Owner request: enter the rules currently used this academic year into Annual DOE Rule Book.

## Saved result

- New policy Draft: `ef8506ff-cb21-e5f8-42c0-9fff24327e49`.
- Label: `2026-27 Current Rules - Guidelines 2025-12-23 + MASTER (Draft)`.
- Revision1, validated revision1;22 enabled rule definitions,7 structured source references,56 exact source course mappings.
- Validation checksum: `e5fab149a7a2399149a2f68705c19bb1c635c821346d2c2731aa957a726714cc`; no errors/warnings.
- Current Active policy remains the Faculty Master List DOE/FTE snapshot. Existing Drafts are preserved. This transcription has not been published as a calculation policy or recalculated faculty records.

## Coverage

| Group | Rules / source |
| --- | --- |
| Teaching | Lecture0.30%, SRL0.30%, Lab Primary0.21%, Lab Secondary0.19% per hour; Quiz/Midterm and OSCE no-credit behavior already used by accepted calculator |
| Course coordination | Five lookup tiers: under3units1.75%,3-5units3.5%,6-9units7%,10-14units10%,15+units15%; tier quantity comes from confirmed course units |
| HICC | Explicitly eligible development2% per unit; finalized development0%; unknown eligibility remains unmapped |
| VISC | 2026-27 only:5% per confirmed subject; subject mapping and count required |
| Clinical / CCC | Rotation participation2.5% per week; designated coordination+2% per unique rotation type; CCC0.5% per confirmed shift |
| Supervision | Undergraduate1%, 4th-year preceptor0.75%, graduate primary3%, graduate co-supervisor2%, postdoctoral1.5%; VETM506/IM existing Master count formulas0/0.5/1% |
| Reserve | Existing accepted parameters35%,0.5 split,15% high-teaching ceiling,7.5% teaching-stream ceiling,3-year graduate-history window with current-year fallback when unavailable |
| Manual | Signed approved manual DOE, including reductions; applied once after source reserve; no automatic case-by-case proration |

Guidelines references use the supplied UCVM Workload Guidelines updated2025-12-23/effective2025-04-01, sections6.2/6.3/6.4, Tables1/2/3, pages3/4/5. Master and manual references retain their own provenance and have no guessed effective date. Course mappings use the accepted runtime's exact Master catalogue; curriculum stage is left unknown. VISC subject mappings remain unfilled where no canonical source mapping has been confirmed. Reference-only ceilings, individual Research/Service/PPVM contracts and discretionary career-development/special-activity allocations are not converted into invented defaults.

## Execution and recovery

`tools/populate-current-doe-rulebook.cjs` defaults to read-only Plan, reuses the frozen runtime SQL adapter/policy repository with encrypted configured Windows authentication, validates the structure, and atomically creates/saves a NEW Draft with an explicit automation audit actor. Existing-ID guard prevents repeated import. Apply never publishes, recalculates or changes an existing version. The initial oversized label attempt rolled back; the subsequent62-character label succeeded.

Server receipts: `P:\PAWS\Runtime\Acceptance\CurrentRuleBook-20261011\plan.json`, `before.json`, `saved.json`, `after.json`, `validation.json`. Before/after Active policy identity and business-record counts are identical. Read-only SQL confirms22rules/7references/56mappings andDraft status. To undo this addition, archive this new Draft through the existing Rule Book lifecycle after checking subsequent edits; preserve audit evidence.

No new/local tests requested or run. Existing policy validation and SQL readback are the data acceptance evidence. No runtime changes, server restart, Hosting/Firestore/Functions deployment or business-data recalculation.
