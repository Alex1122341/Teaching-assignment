# Session SWAP release preparation — 2026-10-09

## Scope and review

SQL remains the business authority. New independent SWAP request, decision and apply gates control the additive workflow. Faculty self replacement is a suggestion. Notified candidates consent through their linked in-app inbox; unnotified faculty suggestions require explicit scoped VISC routing. Schedule and topic proposals follow relevant ADC → LAB → ADFA stages. Revisions restart approvals and consent. No account or office assignments are inferred.

Inline review repaired idempotent retries, field ownership on revisions, persistent origin routing, candidate/assignment list preservation, stale-version handling, missing office warnings, SQL JSON routing compilation, and the timetable template syntax. Unknown identities and session dates/times cannot be overridden; explicit Owner/Developer reasons may override office/conflict stages but never replacement consent. Existing source DOE is preserved on assignment replacement; incompatible course/type or duration provenance blocks application.

Independent agents stopped after partial implementation because their workspace reported no credits. Additional independent review was unavailable. The primary agent continued the review inline; no claim of an independent reviewer approval is made.

## Evidence before release

Reviewed product anchor: `404e3bdf6a2cf3947ab76f41bb13ea9120c833a0`. Governance promotion protects all65 static assets and65 API runtime files plus3 repository/build inputs. The immutable comparison still reads Git blobs; no drift exceptions were added. Existing fixture inventory counts are synchronized to the expanded manifests.

- All changed JavaScript parsed with `node --check`.
- `node tools/build-static.js`: 65 shipped static files.
- `node tools/build-swa-api.js`: 65 runtime files.
- SQL030 compiled on ITAPPVETOPSDB01 / VetMed-Ops inside a transaction terminated with ROLLBACK; SQLCMD exit0. No requests or persistent schema from this diagnostic.
- Chrome saved sign-in accessed the reference site and its approval queue. Reference data is explicitly synthetic; no request was submitted or decision taken there.
- No new tests or local test suites, following the developer restriction. Existing automatic CI remains a release requirement.

## Data and deployment order

Apply030,031,032 only from the accepted release after exact-main CI. Bind the existing reviewed University runtime identity to the narrow SWAP procedure roles. Stage runtime and recovery launcher on P: because server C: is full. Activate three independent gates and deploy Firebase Hosting only. Preserve the current live version until release gates pass.

Master SHA256 `a834d571a25942a1242c9ae3d4f56f975525dfa48658c76883a92dac6bb1d1b4` supplies exact HR FULL Name values. Private reviewed crosswalk:97 exact matches,24 unresolved. Guard source hash and faculty before-images during import; retain unresolved HR fields blank. No private crosswalk or credentials belong in Git or public candidate DTOs.

LAB group/roster data is absent in current SQL and shown as None available. Current live profiles have no ADC/LAB accounts and most sessions lack explicit VISC ownership; affected routing reports this absence. Assignment of real office users is outside this implementation and is not fabricated.

## Recovery

Restore the previous University launcher and Hosting release if activation fails. Leave additive SQL objects and real request audit intact. Rollback030 may run only with zero request rows; rollback031 revokes procedure grants. HR schema columns remain additive; a private import recovery script must restore only guarded before-images.


