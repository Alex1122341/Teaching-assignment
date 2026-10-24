# PAWS FACULTY AVAILABILITY — FINAL ACCEPTANCE & RELEASE REPORT

Latest cloud follow-up reports Node22, complete Git objects, PowerShell, Java and Docker now available, root964pass/0fail/52skip and static build/freeze pass. One server recovery test remains unresolved; SQL image, emulator and GitHub access remain blocked. These are user-reported cloud results. The pasted SHA is still39 characters; verified local target remains32f3dd0fc06ba07aaa875f2e65838d7cf14b1931. See the cloud-return sections below.

Date: 2026-10-21 (America/Edmonton). This is a blocked-release evidence record; it is not a deployment receipt.

## Release decision

**FACULTY AVAILABILITY RELEASE BLOCKED — GitHub Actions billing/spending limit prevents required CI; real authenticated Admin/Faculty acceptance remains outstanding.**

The Owner confirmed that Actions billing cannot currently be resolved and directed completion of local checks. No merge, production API cutover or Firebase Hosting release is authorized by a local test pass alone.

## Evidence register

| # | Required evidence | Actual result |
|---|---|---|
| 1 | Repository, branch, PR | Alex1122341/Teaching-assignment-azure; feature/faculty-availability-single-20261020; existing Draft [PR124](https://github.com/Alex1122341/Teaching-assignment-azure/pull/124), unmerged. |
| 2 | Initial main/candidate | main6addfb9125066c5dd14ca7a3d7c38be6a01a870a; candidate10e9e1d8dc0d6fa26fffb72d2453e2d3f0b3a5c1. Latest integrated main33c4e9f4506e4632e673c2e8a462bc9987ce7e51 includes independently accepted History PR129. |
| 3 | Final product | 370c30a21d99ae7227f97f1e0cb781864c674768. All12 Availability runtime/SQL paths match accepted23e35c8bd0d107a22fcea6f00c88e9f221f0fa53 exactly. |
| 4 | Final governance | Promotion09e5c122c88e819070017837daf048f852fa95a3, completed by four preserved historical receipt assertions atad2493629420fe66e107f95a75c222e3457f60f4. Runtime anchor370c30a; no protected runtime changed by governance. |
| 5 | Independent reviews | Product370c30a READY,85 affected tests pass. Governancead24936 READY:193 protected paths,247 Git-blob hashes,7 independently run mutation/enforcement tests pass; historical receipt correction1/1 and governance5/5 inspected. |
| 6 | Exact changed paths | Five static, five API and two SQL paths listed below; no other protected runtime differs from latest accepted main. |
| 7 | Corrections | Actual SQL responseJson/array contract; canonical session view; approved-request identity deduplication; missing/partial/remote time semantics; independent effective authority windows; malformed periods; preferred-name search; inactive Faculty lookup; duplicate names; UUID/date validation; stale result/search/sign-out lifecycle; hidden-control CSS; guarded rollback. No guesses of DOE or meeting time. |
| 8 | SQL056 execution | Applied once at2026-10-21T02:41:48.2179706Z. Installed definition SHA25619DFE7553D354A004CBBEBD6AF311D3D269C56CC4AAB7839359AC2887228E1DE. Earlier PS5.1 preflight stopped before SQLCMD and is retained. Do not replay. |
| 9 | SQL reconciliation | Actual Node repository parsed responseJson and completed241 canonical teaching records without duplicate paging. Separate real samples:143 work(2026/2027),37 AFC(2025/2026),5 effective role periods. Teaching/work/AFC source counts agree; effective-window edge cases also passed isolated SQL acceptance. Maximum initial query3140ms,60 queries in first live source check. |
| 10 | Authorization/privacy | SQL current runtime principal EXECUTE works; existing SQL Faculty actor own allowed and cross denied55603. Actual staged HTTP anonymous/invalid token401. Allowlist, roles, malformed/nonexistent IDs, SQL503, dates/DST and stale privacy covered by affected and prior full tests. Real authenticated Admin200, Faculty-own200 and cross-Faculty403 through complete API/browser remain outstanding; SQL actor tests do not replace them. |
| 11 | Root/server/emulator totals | Local root1016 total/964pass/52skip/0fail; restored historical receipt targeted1/1pass; current server802 total/798pass/4skip/0fail; current emulator1016 total/997pass/19skip/0fail, exit0. Emulator reran the complete suite including the four restored assertions. Prior273 CI totals remain prior-head evidence only. |
| 12 | Freeze | Current governance independently preserves83 static plus107 API runtime and3 build/package inputs=193 protected paths, historical manifest unions, Git-object authority and attack defenses. Local combined build, static artifact freeze and API artifact freeze all pass. |
| 13 | Exact-head/exact-main CI | Prior273 Azure Build39533088104, Availability SQL39533088127, migration39533088141, Calendar SQL39533088164, MASTER39533088271 passed. MASTER's first attempt hit an external sqlcmd allocator crash after business acceptance; failed job rerun succeeded. Current09e5 runs39535532305(build),39535532222(migration),39535532501(Calendar),39535532707(Availability),39535532333(MASTER) never started tests: GitHub explicitly reports payment/spending limit. No Availability exact-main run exists because PR124 is unmerged. |
| 14 | Artifacts | Prior273 CI artifact12316715457 SHA25625c3e454385ae90cbfd2adcf58e5b6055dc35f16f995c2dd2b52bff696b4404e; checkout3321e79004dffbc394d79b68bb6585e9393a2f18 parents1b4c3fb+273. Current local ad24936 ZIP SHA2566fe1dbac84852bad0d3f751ba2027b71a59b4e915fc60dbc311549c9f524ed91: all191 files individually verified,83 static/107 API runtime plus inventory,105 University server sources separately verified. Local inventory digestebb52ea2700bc0455911067397f1c2c9ad46ef1d22a7cca1268f14043c67ebce. This local bundle is explicitly review-only, not a CI artifact or authorized release package. No current CI artifact exists while billing blocks jobs. |
| 15 | API identity/health | Fresh Oct21 live33c4e9f4506e4632e673c2e8a462bc9987ce7e51 / anchora3317b1d30b1caa66c81ee5f4be2932f941b565b healthy, University SQL healthy. No Availability production post-release identity exists. Old accepted273/a0c stage only127.0.0.1:18793 healthy; contains older History and must never be cut over as current release. |
| 16 | Hosting | No Availability Hosting deployment performed. Existing [Beta](https://tester-teaching.web.app) remains previous accepted release. Feature requires coordinated API then Hosting-only release; static-only compatibility mode prohibited. |
| 17 | Write gates | All27 before/after SQL056 gates identical. Stage27 match current live. No gate enable/disable operation; existing DOE gate values preserved without performing DOE publication/recalculation. |
| 18 | Business fingerprints | All106 paws/staging tables with original full columns, row counts and aggregate hashes unchanged immediately across SQL056 apply. Original schema, existing permissions and memberships unchanged. Only new read procedure and intended paws_runtime_read EXECUTE added. Private receipts retained on University storage. |
| 19 | Browser acceptance | Prior synthetic Chrome UI:65 rows50+15, three date modes, historical/empty states, duplicate names, keyboard, sign-out/stale cleanup and390px narrow layout passed; explicitly synthetic. Real Admin/Faculty feature acceptance not completed. Current Chrome control times out; no browser token/storage extraction, fabricated login or authorization bypass. |
| 20 | Limitations | Required CI billing, authenticated acceptance and current CI artifact unresolved. All requested local test/build checks completed with zero failures; local results cannot substitute required GitHub CI. No Outlook/Teams coverage promised. No-conflict is not a guarantee; undated/time-unconfirmed coverage remains explicit. |
| 21 | Rollback readiness | Exact installed definition persisted immediately after SQLCMD, hash-bound rollback verified in isolated SQL; refuse edited definitions/unrelated grants. Existing live33 API remains untouched. Additive unused056 can remain pending acceptance; never restore business rows or drop a proc used by a live service. Re-read latest live launcher and identity before any future cutover/restore. |
| 22 | URLs/verified release | Public Beta https://tester-teaching.web.app; no public Availability candidate URL. Verified live University loopback18787 release33c4e9f. Private stage18793 release2731631. No Availability feature LIVE claim. |

## Changed protected and SQL paths

Static:

- faculty-admin.html
- faculty-admin.js
- faculty-availability.css
- faculty-availability.js
- paws-data-client.js

University API:

- server/src/availability/faculty-availability-api.js
- server/src/data/sql-dashboard-repository.js
- server/src/data/sql-faculty-availability-repository.js
- server/src/runtime/swa-faculty-availability-functions.js
- server/src/runtime/swa-sql-runtime.js

SQL:

- database/azure-sql/056_faculty_availability_read.sql
- database/azure-sql/rollback_056_faculty_availability_read.sql

## Resume order

1. Local checks, deterministic build and complete inventory are retained. Original progress workbook updated in task39 / MP-REL-01 evidence only, with12 cells and2 fitted row heights changed. Original task statuses, other tasks, all formulas/native parts and human signoffs preserved.
2. Restore required GitHub Actions execution through the account owner; obtain current exact-head green CI and artifact.
3. Complete real authenticated Admin and Faculty API/browser acceptance using normal sign-in. Never request passwords or tokens in chat.
4. Refresh main and reconcile any further independently released changes. Obtain separate review if runtime changes.
5. Merge existing PR124 only after all required gates; exact-main CI/artifact; stage exact-main API, coordinated University API then Firebase Hosting-only release.
6. Recheck real users, privacy, source counts, health, CORS, unchanged gates and business fingerprints; issue a new live acceptance receipt only when verified.

## Cloud check returned by Owner — 2026-10-21

This is a user-supplied cloud execution report, not independently retrieved GitHub Actions evidence. The cloud environment reported Node24.19.0, no complete historical Git objects, no PowerShell/disposable SQL target, Firestore emulator download HTTP403 Domain forbidden, and GitHub API403. Root901pass/63fail/52skip and server792pass/5fail/5skip were reported; the identified environment failures make these unsuitable as supported-environment acceptance. No product regression has been independently established by that report. Cloud build191 files passed, but has no GitHub artifact ID/digest.

The pasted target SHA `32f3dd0fc06ba07aaa8752f65838d7cf14b1931` is39 characters. Local Git verifies the40-character target `32f3dd0fc06ba07aaa875f2e65838d7cf14b1931`, parent `ad2493629420fe66e107f95a75c222e3457f60f4`. The cloud claim of exact PR-ref equality needs correction or an untruncated immutable checkout receipt. Do not silently normalize the cloud report into verified exact-head CI.

Existing local supported-environment pass evidence is retained; no code, freeze, permission, SQL, merge or deployment change is warranted merely to accommodate the limited cloud environment. Next cloud check must begin with prerequisite verification and stop unsupported suites before running them. Report cloud execution, GitHub Actions status and unavailable components separately. Keep the same PR target; these record updates remain local and do not advance the checked branch.

## Cloud follow-up and recovery fixture diagnosis — 2026-10-21

Owner's second cloud report says Node22.14.0, PowerShell7.4.7, Java21, Docker daemon and1103-commit full Git clone are now available. Root964pass/0fail/52skip; server796pass/1fail/5skip. Static repository freeze, combined191-file build and static artifact freeze pass. SQL Server image pull403, emulator download403 and invalid cloud GH_TOKEN/API403 remain blockers. No current cloud API artifact freeze result was supplied. The pasted target still has39 characters; obtain raw `git rev-parse --verify HEAD` output before certifying exact-head identity. No token was requested or inspected locally.

The remaining server test `recovery verifies UTF-16LE content hash before any SQL connection` assumes `os.tmpdir()` is accepted as a recovery-artifact location. The production module first rejects source-tree paths, any ancestor with .git, Hosting artifact locations, links/reparse points. The reported path rejection occurs before the intended hash check.

Local paired reproduction on Node22/Windows PowerShell: set TEMP/TMP to an ignored directory inside this worktree and run only that test:1fail with the exact reported outside-repository message. Restore normal external TEMP/TMP and run the same unchanged test:1pass/0fail. The fixed invalid expected hash prevents SQL connection. No runtime source or security check was changed.

This reproduces a sufficient cause, not the cloud filesystem layout itself. Next cloud step: print actual temporary/repository paths, verify a private external temporary directory through Get-PrivateCalendarRecoveryPath, then rerun the single test and server suite. Preserve path restrictions and the hash-before-SQL assertion. If no acceptable external directory exists, retain an environment blocker rather than weakening the guard or skipping the test silently. Leave PR target32f3dd0 unchanged; these evidence notes remain local/uncommitted.
