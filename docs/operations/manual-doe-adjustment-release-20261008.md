# Manual DOE adjustment release

Owner confirmed manual signed additive DOE entries, canonical existing scope suggestions, negative notes, and separate helper entry. Product anchor: 33f1742a938702643cdec946352db05875641929. Previous anchor: 0e6f7a20dae9f0ba86f4157aabefda0a1fa8fb5f.

Separate governance promotion protects 60 shipped static assets (+faculty-admin-doe-manual.js),60 API runtime files (+sql-manual-doe-repository.js and manual-doe-service.js), and the unchanged build/package inputs (63 API protected paths). No drift exceptions.

New scoped gate PAWS_DOE_MANUAL_ASSIGNMENT_WRITE_ENABLED=true also requires existing facultyAdmin gate and administrator identity. Broad doeAdmin,policy publish,recalculate remain false. Migration029 creates a signed manual table and audited revision-guarded procedure with only EXECUTE granted to paws_runtime_manual_doe_write; deploy membership explicitly. Existing source role/trainee DOE stays unchanged. Manual signed credits apply after baseline supervision reserve; summaries,detail and worksheets include active manual rows. Known tags are resolved from existing identities; ambiguous name matches keep editable scope without guessing.

Deployment: reviewed PR, exact-main CI, apply029 using authorized integrated SQL connection, versioned API source attestation/cutover with rollback to current d423137 release, then Firebase Hosting only. Reuse configured DPAPI authentication, never read secrets. Read-only UI acceptance; no invented real negotiated entries.

Prior data recovery remains: role196, supervision116/raw569.25, formal targets111; five targets intentionally deferred by owner. Do not rerun imports.


## 2026-10-08 — Manual DOE release complete
- Owner-confirmed signed additive DOE and editable Course / Subject / Scope published via PR76. Live source e1005a909eca0c18df19f3a8f23b722d01084896; runtime anchor33f1742a938702643cdec946352db05875641929.
- Exact-main build37874892141 and migration37874892158 SUCCESS; existing emulator799/799 and governance53/53. No new tests or local test execution.
- Migration029 applied; scoped procedure EXECUTE membership and CourseCode/CourseName reads. Pre-existing db_owner unchanged; broad DOE roles empty. Runtime60-file attestation and API/SQL health passed; existing gates unchanged, manual gate enabled.
- Hosting60 assets released, version c81a9c4ffcc263d5, release1791513302939000. CLI release succeeded before debug-log cleanup EBUSY/exit1; no repeated release. Public manual script equals source SHA256992ff87c3a9e13c455d0e2a2cd8a9e43dd4256de610f38d6cb8cee9cb9f992de.
- Live editor verified editable scope/174 suggestions, enabled Save assignment, signed DOE input without min/step any, existing source DOE visible. Read-only acceptance; no invented negotiated entries.
- Postflight manual records0, role records196, supervision snapshots116. Prior111 formal targets and five deferred targets preserved. Do not rerun imports.
- Screenshot: C:/Users/xinyu/Documents/Codex/2026-08-31/outputs/manual-doe-20261008/manual-doe-editor.png.
- Rollback: C:/PAWS/Runtime/Acceptance/WorksheetDOE-20261008/Start-WorksheetDOE-Live.ps1. New launcher: C:/PAWS/Runtime/Acceptance/ManualDOE-20261008/Start-ManualDOE-Live.ps1.
- Breakpoint: published. Administrators enter actual negotiated values case by case; helper positive credit remains separate; negative adjustment requires Notes. No automatic paired allocations.
