# P3 Stage A Activation Preparation

**Status:** preparation only; no Stage A activation is authorized by this task.

## Goal

Prepare a branch-only, reviewable package that closes the technical Stage A readiness gates for P3B4 on ITAPPVETOPSDB01/VetMed-Ops, without applying database migrations, changing SQL permissions, installing or copying runtime files on the server, starting/stopping services, creating test identities/data, or changing Firebase, Cloudflare, DNS, or Azure.

## Scope and inputs

- Base: `feature/p3b4-afc-approved-artifact` at `b6e74ff5ff34ef5f3b2541f8a3528341ff38f943`.
- Preparation branch: `feature/p3-stage-a-activation-prep`.
- Product source is the accepted P3B4 state already in this repository, including 009/010/011 SQL, AFC runtime, approved PDF template, and `pdf-lib@1.17.1` lockfile.
- Live inspection is read-only and restricted to PAWSApi/VetMed-Ops facts needed to determine service identity, effective runtime settings, backup recoverability, and schema baseline. Do not print secrets, full connection strings, unrelated database metadata, or row data.

## Required deliverables

1. Determine whether the existing `NT SERVICE\\PAWSApi` identity is a viable least-privilege Beta runtime candidate. Inspect the service definition, SQL principal/mapping/permissions, and whether its same-host integrated-auth path can be proven without impersonation or starting the service. Do not enable it, create a login/user, or grant rights.
2. Author a narrow permission script and fail-closed read-only verifier. Derive the exact required SELECT columns and `paws_api` procedure EXECUTE rights from the accepted runtime. No `db_owner`, `db_datawriter`, schema-wide EXECUTE, broad CONTROL/ALTER, or direct AFC-table DML.
3. Inspect only VetMed-Ops backup metadata and validate the selected latest valid full backup with `RESTORE VERIFYONLY` when permitted. Identify the required log chain and continuity. Clearly distinguish media verification from a proven restore. Do not restore a database or create a backup.
4. Capture a schema-only baseline contract for AFC objects/view, relevant procedures, constraints/indexes and schemas. Do not capture row data or secrets. Commit only a safe inventory/hash and reconstruction/verification source if exact environment-specific definitions should not be stored in the repository.
5. Search repository evidence for an already-approved acceptance-data strategy. Do not create identities or live data. If none exists, report exactly two choices: isolated non-production VetMed-Ops-compatible acceptance database (preferred), or an explicitly authorized live marked AFC request whose immutable artifact remains permanently as test evidence.
6. Build a deterministic, secret-free local University runtime package candidate from accepted P3 product state. Include P3B1/B2/B3/B4 runtime, reviewed PDF template, locked `pdf-lib@1.17.1`, exact server dependency lock and launcher/runtime files. Record package inventory and SHA-256 evidence.
7. Author, but do not execute, a guarded Stage A deployment script/runbook. It must validate exact candidate hash, Node 22, recoverable runtime backup/copy, locked dependency installation, preserved config/secrets, expected source/runtime state, and refuse unsafe overwrite. It must provide a defined restore of the previous package if smoke checks fail.
8. Document deterministic A0-A8 gates with PASS, STOP, rollback and forward-recovery criteria. Stage A acceptance must work through loopback/internal VPN and must not require stable public ingress. Hold public frontend cutover at A8.

## Verification and safety invariants

- Run local tests/builds under Node 22; do not claim Node 24 verifies the Node 22 requirement.
- Do not execute any 009/010/011 apply/rollback, permission script, deployment script, or end-to-end live AFC operation.
- Do not change service identity/state, filesystem runtime contents, firewall, certificates, Azure, Firebase, Cloudflare, DNS, or public UI.
- Do not put credentials, secret environment values, live record data, or unnecessary internal object definitions in committed files.
- Once workflow or artifact business state exists, prefer forward repair/restore. Never prescribe deletion of immutable AFC artifact evidence.
- No merge. Feature-branch commit and non-force push are allowed only after checks; create no PR unless explicitly required in a later instruction.

## Acceptance

Report exact base and final branch SHAs, files, Node/test evidence, candidate package digest, identity viability, least-privilege rights, backup/log chain and `VERIFYONLY` result, actual restore-proof status, schema baseline form, acceptance-data options, A0-A8 runbook status, remaining blockers, and explicit non-actions. Use exactly one verdict: `P3 STAGE A = READY FOR OWNER-AUTHORIZED ACTIVATION`, `P3 STAGE A = READY EXCEPT OWNER TEST-DATA DECISION`, or `P3 STAGE A = BLOCKED TECHNICAL`.
