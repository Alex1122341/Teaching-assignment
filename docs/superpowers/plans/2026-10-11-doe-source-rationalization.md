# DOE source rationalization implementation plan

**Goal:** Rationalize all audited DOE exceptions in the annual Rule Book, preserve documented source allocations, and make publication evidence cover current recorded sources.

**Architecture:** Reuse annual rules, course/subject mappings and assignment-scoped exceptions. No generic inference from names, dates or stored DOE. Current-year source quantities come from the exact owner-supplied MASTER. Projection includes recorded sources and preserves source-specific exceptions. Missing targets/history stay unavailable.

**Execution:** Native execution under the owner's standing delegation of implementation decisions, most recently confirmed by “按照你的建议来吧”. No additional approval checkpoint for routine implementation. Conditional policy application remains gated by full parity audit.

## Tasks

- [ ] Extract the exact MASTER course units, literal VISC scope groups, rotation weeks and existing allocation evidence. Verify source hash and canonical role associations. Avoid fuzzy name matching.
- [ ] Update only the existing candidate Draft using revision guards and a before snapshot: canonical subject mappings with original aliases, confirmed course mappings, CCC deduction rule, explicit rotation inputs, assignment-scoped source exceptions for documented special allocations. No target/supervision zero guesses.
- [ ] Add a recorded-source projection helper to the existing lifecycle Impact Preview. Preserve negotiated manual lines and supervision snapshot basis; report missing calculation inputs independently. Hash the complete source dataset and reject stale publication.
- [ ] Preserve same-year Lookup source reference rows when the normalized Active policy replaces a snapshot-only Active policy.
- [ ] Expose normalized subject facts and exceptions in existing Rule Book tables/editors with plain explanations; retain annual lifecycle and source identities.
- [ ] Audit all 4970 teaching,196 roles,116 supervision sources and current120 faculty totals. Investigate new mismatches against source evidence. Keep genuine missing target/supervision data unresolved.
- [ ] Product commit, explicit freeze promotion, reviewed PR, exact-main CI and controlled runtime/Hosting release as required. Reaudit live before conditional publication and verify totals/reference retention.

## Review focus

- Zero source facts must not become a misleading zero-change impact preview.
- CCC half-day deductions must be explicitly sourced, including deliberate zero.
- Slash-separated subject names are literal existing groups, never implicitly split.
- Documented prorated/source DOE takes precedence through scoped evidence, including zero.
- A complete source checksum must change when quantities or negotiated values change.
- Unknown targets/trainee history remain unknown.

## Ledger

2026-10-11: Created branch feat/doe-source-rulebook-rationalization-20261011 from exact origin/main b75f2bae7b33a3e765099f79ec0fcae1d01209f1. Preserved inherited continuity changes and line-ending-only test changes. Read original MASTER: explicit course units and rotation weeks exist and will be matched with exact recorded source names/scopes.
