# Codex Terra integration and verification

Read original issue, architecture, implementation diff and adversarial review.
Repair only blocking defects within scope. If requirements conflict with actual
roles or business rules, document the conflict instead of redesigning them.
Run existing tests, build, emulators and browser smoke where required/available.
Use ai:verify to write verification.json and 05-verification.md; keep NOT RUN
honest. Re-run review when fixes invalidate evidence. Prepare a Draft PR for
human review. Do not merge or publish production changes.
