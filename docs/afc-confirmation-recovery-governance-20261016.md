# AFC confirmation recovery retained from PR73

The owner directed review of PR #73 / #55 after PR103 acceptance: close obsolete
work, improve and merge valuable work. Both independent review axes found
PR #73's AFC confirmation protection still missing in current main. Its DOE
recovery is superseded by later approved implementations. In particular the
old stream hunk rejects the evidenced `Teaching-Focused` spelling and is not
retained.

Current main `21c2db7` was integrated while restoring its runtime and tests,
retaining only the two dated October 8 evidence notes. Product `5d3a7e8` then
ported the bounded AFC behavior into the current controller/workflow. PR #55's
accepted docs/test main `d75d8eb` was integrated as product anchor
`9898266d842912eed8dc95016fa881fa90ba13c4`. This last integration changes no
protected bytes from the independently reviewed AFC product.

## Accepted product behavior

- A manual AFC create sends one POST. Before success/reset, the returned record
  ID must appear in the AFC list, using at most two GET-only attempts.
- An incomplete response or ambiguous transport/server failure preserves the
  form and blocks create replay. A 4xx or exact 503 / WRITE_DISABLED rejection
  permits a deliberate later retry. No automatic POST retry is introduced.
- Calendar dates use the existing strict Gregorian helper.
- AFC request workflow 5xx outcomes become unconfirmed, preserving its existing
  refresh/retry lock. Visible decision signer fallback is readable; the
  authenticated UID remains internal to signing.
- Current naming, cancellation/version checks, capabilities, authorization,
  Working Activities and DOE UI remain in place. No server/API/DOE code changed.

Tests exercise registered Dashboard DOM events after authentication and the
public AFC workflow interface; no new source-transform/private-function seam.
Missing-ID, matching/nonmatching readback, invalid date, numeric5xx and signer
fallback were each observed RED before their fix, then GREEN. Focused 25/25
passed with zero skips. Independent final Standards and Spec reviews returned
Ready/no remaining findings. No live AFC write was used to manufacture evidence.

## Separate immutable promotion

The corrected proposed anchor `d049fe0` follows released layout product `3cd51ca`. It protects
the same 75 static paths and 76 API runtime / 79 API-build-package inputs. The exact
protected static delta is only `afc-workflow-sql.js`, `faculty-admin.js` and
`faculty-admin-afc-records.js`;
all 79 API-protected files remain byte-identical. The new test was observed RED
before anchor promotion, then GREEN (1/1, zero skips). Both separate
governance reviewers returned Ready with no blocking findings. The prior CSS-only promotion is
independently pinned at governance `4082c625`, the original DOE UI at `7a903318`,
and all earlier historical anchors remain intact. Reporting JSON changes only
sourceCommit and the three accepted file hashes, not protection coverage.

Full suite, exact candidate/main CI, package comparison, Hosting-only release
and public/read-only UI verification remain pending at this checkpoint. The
already accepted #103 / #106 release and workbook status are not undone. No API
rollout, SQL mutation/import, rules publication, policy publication/recalculation
or permission/gate change is part of this candidate.

## Corrective review after CI407

Local root and candidate CI407 both reported 911 total, 861 passed, 49 skipped
and one failure: the existing controller limit was exceeded (60,938 canonical
LF bytes versus a limit below 60,000). That gate was preserved. Corrective
product `d049fe0fb4fb51e9fcefab3a4151c2600d3cc074` moves the manual form
validation, confirmation and uncertainty state into the existing AFC records
module. The controller is 58,397 bytes; date normalization remains lazy.

Standards review additionally found that the final button update could override
a refreshed closed write capability. A public DOM-event regression was observed
RED then GREEN; the button now preserves both the capability and uncertainty
lock while leaving the saved success message visible. The orphaned controller
flag was removed. Both corrective product reviews returned Ready, and the 52
focused public-flow/controller-contract checks passed with zero skips. The
corrected three-file promotion was observed RED before the new anchor, then
GREEN (1/1). Its separate governance review and fresh full CI remain required.
The old candidate was neither merged nor released.
