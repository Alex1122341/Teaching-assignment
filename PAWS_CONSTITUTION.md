# PAWS Constitution

These rules govern current and future PAWS work. A policy change requires an explicit Owner decision recorded in the reviewed change. This document establishes the product contract; the [role matrix](docs/security/role-matrix.md) records implementation differences. Adding this document changes no runtime permission or stored data.

## 1. Calendar is home

Normal entry and successful sign-in lead to Teaching Schedule / Calendar for every supported role. Keep authorized direct links and deliberate navigation. Mandatory password change and inactive-account denial still apply. An administrator's Dashboard is an optional destination, not an automatic home. Test refresh, sign-in and direct-link behavior separately. The legacy web helper still contains a Dashboard redirect: record that as a gap, not as compliance.

## 2. Names use Last name, First name

Use preferred structured surname/given-name fields, then recorded structured fields. Preserve compound surnames, initials, accents, hyphens, apostrophes and capitalization. Use the existing `PAWS_FACULTY_NAME.format()` / `formatList()` in `frontend/scripts/faculty-name.js` and the matching server module `server/src/domain/person-name.js`. Check parity when changing either. A legacy web display without the formatter needs an explicit integration change; do not silently assume it is covered.

Format once at the display/export boundary before escaping. Already formatted names stay stable; separate multiple people with semicolons or newlines. Preserve truthful placeholders such as Locum, TBD, N/A and Not provided. Never guess a missing identity. Test compound names, repeated formatting, lists and placeholders.

Presentation must not rewrite IDs, UIDs, UCIDs, email, matching aliases, permission keys, DOE inputs or source hashes. Uploaded originals, signed PDFs, raw audit From/To values and recovery evidence retain recorded values/bytes; surrounding person labels follow this convention.

## 3. Identity, authority and privacy

Authentication identifies a person; the selected environment's trusted authority determines active status, role and scope. Enforce authorization at that boundary. Hidden controls and a Demo role selector are not security controls. Fail closed on missing/ambiguous identity, stale permissions, expired appointments or unavailable authorization.

Other faculty must not receive another person's UCID, email, DOE, HR attributes or confidential directory fields without explicit authorization. AFC exposed to colleagues is only Available / Unavailable; hide absence reason, purpose, notes and PDFs. Authorized timetable conflicts may show course and time. Use sanitized projections, not broad directory delivery followed by client hiding.

Academic year, course/area, appointment start/end and ownership constrain each action. Faculty membership, a collaboration group or a label such as HICC does not itself grant all courses, office approvals, DOE access or account administration. Multiple duties must retain their own scopes; never invent a package/ownership mapping to make a test pass.

## 4. Changes and SWAP require valid approval

Requested changes remain separate from the published timetable until required approvals complete. Derive office routing from the actual changed fields and reviewed workflow. Preserve revision checks, push-back/resubmission, rejection/cancellation, final approval rechecks and exactly-once application. Do not rename an office to simulate an unimplemented approval stage.

Replacement selection uses active sanitized faculty, binary AFC plus real timetable conflicts; uncertain availability stays Check needed. Sessional and Other are valid categories with required notes. Authorized DOE preview includes the removed instructor and replacement's current/projected values; colleagues do not receive private DOE. Recheck availability and source versions at approval/apply, not only when opening the form.

## 5. Truthful records and workload

Preserve source identity, academic year, effective dates, units, provenance and unknown values. Do not infer contract DOE, FTE, rank, identity or missing policy. Reconcile DOE against the approved source; report discrepancies before changing policy or source data.

Calendar holds actual work activities such as CCC, clinical duties and rotations. AFC holds absence/away categories, including Owner-approved Remote work and OPA treatment. Migration requires an exact approved preview and recovery evidence; never delete by fuzzy names or source-row guesses. Teaching is the Calendar's initial filter; work categories remain explicitly selectable. Rotation is a distinct year/filter option. Unspecified work time uses the Owner-approved08:30–16:30 display default with provenance, not an invented source timestamp. Date-only/malformed records remain visibly uncertain where required by availability policy.

## 6. Audit, originals and recovery

Record actor, time, academic-year context and before/after values for authorized changes. Preserve audit history, original AFC PDFs, import sources and historical signatures. Show N/A for legacy records without an original PDF. Faculty may retrieve only their own authorized documents.

Use versioned previews and idempotent operations for sensitive writes. On an ambiguous response, confirm the same operation before retrying; do not create a second intent. Full replacements and destructive migrations require approved exact scope, atomicity and verified recovery. Used operation/audit history is not erased to satisfy an empty-schema rollback.

## 7. Testing is isolated and evidence is explicit

Only synthetic/test records belong in this Testing repository and its fixtures. Keep production accounts, exports, staff PDFs, credentials and service keys outside Git, generated graphs and browser artifacts. Never point Testing reset/seed tooling at the University production database or tester-teaching.

Default Frontend Demo writes are browser-local simulations. Firebase Lab uses vista-teaching-lab only and must be explicitly selected. Browser DOE policy writes stay denied; authoritative publication/recalculation requires reviewed trusted admin tooling. A missing trusted job is Blocked, not permission to move writes into the browser.

Preserve the current stack, shared helpers, lazy loading and packaging boundaries. Build from the selected allowlist, not the raw repository. Publish only the intended generated artifact. A test result, build, deployed demo, role simulation and real backend acceptance are distinct evidence types. The [English manual checklist](docs/acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md) must retain that distinction.
