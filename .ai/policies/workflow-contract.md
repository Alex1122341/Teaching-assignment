# Workflow contract

Issue -> architecture -> implementation -> review -> verification -> final_review
-> ready_for_human -> human merge outside these utilities.

STATUS.json tracks coordination, not proof. spec.json is the machine-readable
requirements contract; numbered Markdown files carry explanations. review.json,
verification.json and final-review.json are strict evidence records. Each review
must cover every acceptance ID exactly once and bind to head_sha, source_digest
and spec_digest from ai:collect. Final review uses Sol; adversarial review uses a
different builder alias. NOT APPLICABLE requires written justification.

ai:advance only permits the next stage. A valid independent review with findings
may enter verification so Codex can repair them; final_review and readiness
require clean, fresh review evidence. Open questions, blockers, incomplete
specifications, mismatched criteria, stale review/verification records and
missing required tests prevent readiness. Editing implementation after review
invalidates review evidence. Run ai:status again after every change. Git commits
also change head_sha: evidence-only commits remain valid when the reviewed SHA
is an ancestor and source/spec digests are unchanged. Source digests omit
task/generated/example artifacts to avoid content-hash recursion.

Evidence records are attestations stored in Git, not cryptographic proof of who
reviewed them. A human must compare logs and CI against the PR before merging.
No command applies GitHub labels or auto-merges. A human may apply ai-reviewed or
ready-for-human after checking the report and current CI.

Required verification profiles are explicitly enumerated in spec.json. They do
not come from arbitrary shell text. A skipped unit security suite is NOT RUN:
run the emulator profile and use that complete profile in required_tests when
security coverage is required. Browser/role scenarios need actual evidence;
available owner smoke does not prove ADC, LAB, ADFA and Faculty workflows.

For corrections, edit the task specification/evidence in a reviewed commit and
reset STATUS stage/status fields to the first incomplete stage; validate again.
Stage advancement never repairs a failed test by changing its reported result.
Tasks older than seven days are flagged as stale; age alone does not erase work.
