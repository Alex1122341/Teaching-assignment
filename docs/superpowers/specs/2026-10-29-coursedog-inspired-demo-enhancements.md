# PAWS Demo — Coursedog-inspired multi-year enhancement

**Approved:** 2026-10-29, by request to implement the preceding comparison in existing PR #96.
**Scope:** Only the synthetic, browser-local PAWS Testing Demo. All SQL, Firestore, shared staff data, Beta migration, and security enforcement remain deferred.

## Intent
Improve usability of the existing interactive multi-year Demo, borrowing useful patterns from Coursedog but **not** reproducing Coursedog's unrelated SIS workflows.

## Selected implementation (one shared Demo engine)
1. **Academic year navigation:** Show a visible year selector and phase badge in the PAWS Testing pages' header. It selects the exact same academic year used by the Demo Calendar, Courses/Sessions, Teaching and DOE panels. Faculty defaults to the real May-Apr academic year; planning roles remember their last authorized year.
2. **Selective rollover:** After the Owner creates a blank new academic year, a planner may *manually* copy one previous year's last Published Course to an otherwise empty target annual Course. Preview the source, destination and selected fields: Course details (required), Session structure (optional), Faculty assignments (optional, requires Sessions), Schedule dates/times/rooms (optional, requires Sessions). Default: basic Course information only. Copy **never** brings across previous Working Drafts, approval/finalization, Published status, DOE policy or Override, exception approvals or audit history. Invalid/inactive Faculty are excluded with warnings. Abort rather than overwrite an existing annual Course.
3. **Shared year context:** Calendar, Course, Session and DOE tabs within the Demo use one selected year and one underlying state model; switching years resets stale course selections. The main legacy Calendar's existing data remain untouched. For any non-default year, header selection opens the Demo Calendar so the user cannot mistake old single-year data for new-year data.
4. **Phases:** Show Planning, Review, Active and Archived states with clear explanatory labels. Changing phase requires explicit ADFAD/Owner authority. The Course's Draft, Finalized, Published and Changes Pending statuses remain independent of year phase. Archived is always read-only.
5. **Publish review:** Before a Course Publish / Publish Changes, show a deterministic comparison against the last Published release: added/removed/modified sessions, teaching assignment differences and DOE credit changes. Validate dates, duplicate/conflicting times, room use, AFC overlap, unassigned instructors, inactive Faculty, required ADFAD finalization, and publication scope. **Block** invalid dates, inactive Faculty, missing finalization and permission; flag other conflicts for explicit review, not silent approval.
6. **Cross-year comparison:** Authorized staff can compare teachers' Published session counts and DOE across years; Faculty can compare only their own Published teaching/DOE, never colleagues' private values. Pending DOE is distinctly labeled and not inferred from Working.

## Boundary / non-goals
- No real SIS term rollover; no auto-copy on Year creation.
- No re-parenting or replacement of the original Beta/PAWS Calendar; all new calendar previews remain Testing-only.
- No database or backend API changes; front-end role checks are simulations, not security assurances.
- Keep existing PR #96 and preserve its existing tests and demo workflows.

## Acceptance
- Deterministic Node tests exercise rollover options, no overwrite and no Draft/Override copying; dates/limits; comparison and publication validation; phase transitions; Faculty historical privacy.
- GitHub PAWS Pages CI runs bundle and browser smoke; Demo SHA/provenance visible. Maintain Manual Acceptance checklist and PR description; leave PR open Draft for Owner testing.
