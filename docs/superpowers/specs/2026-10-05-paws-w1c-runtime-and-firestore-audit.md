# PAWS W1C — Runtime, Firestore, and SQL parity audit

**Evidence date:** 2026-10-05. All inspections below were read-only.

## Runtime path and provenance

- Public Beta static app returned HTTP 200. Its live `index.html` loaded the
  Firebase compat SDK, `paws-api-origin.js`, `paws-data-client.js`, and the
  legacy workflow scripts listed in the repository manifest.
- The live `paws-api-origin.js` labels its configured endpoint `TEMPORARY
  BETA INGRESS`; the origin is a Cloudflare HTTPS tunnel. The reviewed
  University host is `ITAPPVETOPSDB01`, where PID 788 runs
  `node src/runtime/university-api.js` as `UC\\sa-xinyu.zhu1`. The registered
  `PAWSApi` service is stopped/disabled and its command is a placeholder, so
  it is not the process serving this API.
- An interactive read-only SQL connection on that host reached
  `ITAPPVETOPSDB01` / `VetMed-Ops` as `UC\\sa-xinyu.zhu1`; this identity has
  `db_owner`, `CONTROL DATABASE`, and `CONNECT`. No API-owned SQL session was
  active during the inspection, and the API process exposed no live TCP
  connection at the sample time. Thus the SQL identity is strongly indicated
  by the process owner and the Windows-integrated host context, but a
  contemporaneous API-owned SQL session could not be independently observed.
- The configured browser path is Cloudflare ingress → University Node API →
  VetMed-Ops. Azure SQL `teaching-assignment-lab` is a separate existing
  parity/reference source. A deployable ACA/API source path is not evidence
  that the current Beta browser is served by it. No API-owned SQL session or
  open API-process TCP connection was observed at the inspection sample, so
  a single authenticated browser request was not traced end-to-end.
- Exact-main runtime attestation: **NO**. The live API does not expose a
  signed build SHA; inspected source files are not all byte-identical to the
  frozen main snapshot, and no build manifest bridges the API process to the
  current main SHA. The static shell/API origin evidence identifies the
  configured path, not an exact release commit.

## Minimum future University runtime privilege model

Provision a dedicated non-personal University runtime identity through
University IT. Require `CONNECT`, only the enumerated column/object reads the
API actually needs, and `EXECUTE` only on individually approved
`paws_api` procedures. Do not grant `db_owner`, `CONTROL DATABASE`, schema-wide
`EXECUTE`, or use a personal SA login as the long-term application identity.
The current broad identity is `UNSAFE_FOR_WRITE_ACTIVATION`. Identity creation
and least-privilege permission provisioning are external dependencies; this
audit made no permission change.

## Firestore rules and maintenance lock

- Deployed Rules tab version selected in Firebase Console: 2026-09-16
  publication. After CRLF→LF normalization and trailing-whitespace trim, the
  deployed and repository rules content hashes match:
  `315f494e4692968a8dea92a29ba35aed4df412d37cd4b2ffe6539c8eb45b353a`.
- The `settings` collection contains `faculty_index`,
  `faculty_summary_2026_27`, `faculty_swap_index`, `faculty_swap_map`, and
  `schedule_stats`; `settings/system_state` is absent. Rules default a missing
  `teachingDataWriteLocked` field to false, so the current teaching write lock
  is **not active** and `teachingWritesOpen()` evaluates true.
- The Beta SQL data client uses authenticated API requests and has no
  Firestore fallback. Separate client scripts shipped by the static app still
  contain direct Firestore mutation callsites:

| Client module / operation | Firestore paths | Rule outcome in current lock state | Classification |
|---|---|---|---|
| `timetable.js`: session create/update/delete and change/audit batches | `sessions`, `session_change_log`, derived `settings` | Admin writes pass when the required actor/time/audit constraints hold and teaching writes are open | Reachable legacy route; allowed; overlaps canonical SQL sessions |
| `approval-workflow.js`: change-request submit/decision and session application | `change_requests`, `sessions`, `session_change_log` | Valid signed-in request/approver/admin predicates pass while teaching writes are open | Reachable legacy route; allowed; session application overlaps canonical SQL timetable authority |
| `afc-workflow.js`: AFC request submission | `afc_requests` | Valid requester-owned request can be created | Reachable legacy route; allowed; overlaps SQL AFC-request authority |
| `afc-actions.js`: recommend/reject/approve, PDF chunks, audit; approved Faculty AFC projection | `afc_requests`, `afc_requests/{id}/pdf_chunks`, `afc_audit`, `faculty` | Role/history rules allow valid transitions and approved chunks; admin Faculty updates pass while writes are open | Reachable legacy route; allowed; overlaps SQL AFC workflow and Faculty authority |
| `faculty-admin-enhancements.js`: DOE role/override save | `faculty`, `faculty_change_log` | Admin updates/create pass while teaching writes are open | Reachable admin route; allowed; overlaps canonical Faculty data |
| `index-maintenance.js`: derived-index write/repair | `settings/faculty_index`, `schedule_stats`, `faculty_swap_index`, `faculty_swap_map` | Admin writes pass while open; selected maintenance-owner paths remain narrowly allowed when locked | Reachable derived-data route; allowed; not itself canonical SQL authority |
| `bulk-import-firestore.js`: import, restore, stale deletes, lock/job/events | `faculty`, `sessions`, `settings`, `bulk_import_jobs` and nested batch/event collections | Atomic maintenance-owner predicates authorize matching import/restore transactions; unrelated writes denied | Reachable admin maintenance route; conditional allow; overlaps Faculty/session business data |
| `user-management.js`: users, group membership, audits, role cleanup | `users`, `faculty_groups`, `faculty`, `faculty_change_log`, `account_audit` | General/HICC/member-specific rules allow valid scoped actions | Reachable admin route; allowed; identity/group scopes remain Firestore-backed |
| `account_audit` and `afc_audit` append paths | respective audit collections | Authenticated actor/timestamp and role conditions permit valid creates | Reachable audit side effects; allowed by design |
| `public_info` / `public_schedule/ccc_events` client update surface | those collections | General-role, shape-limited rules permit valid writes | Reachability from current page handlers not proven by the observed script inventory; `UNKNOWN` |

Because the live app ships legacy scripts and the lock is absent, direct
Firestore writes for `sessions`, AFC requests, and Faculty remain an allowed
parallel business authority. This is a **P0 SQL-authority bypass** despite the
new SQL client itself having no Firestore fallback. Rules were not modified.

## Azure SQL source ↔ University VetMed-Ops

The following deterministic hashes are SHA-256 over SQL Server `FOR JSON
PATH, INCLUDE_NULL_VALUES` output ordered by the table primary key. Hash inputs
use the same listed common columns on both databases; no row values were
printed or stored. Matching counts alone do not imply matching content.

| Dataset | Azure rows / SHA-256 | VetMed-Ops rows / SHA-256 | Result |
|---|---|---|---|
| `paws.Faculty` (17 shared source columns) | 120 / `63DCFF762AD90FA118EA2539F1D9C8008DC53974685D49DD8B5EB27FB33ACD0B` | 120 / `B8E8F363185650841ADA3B2FBCC44AFBB5CF9E383805726A719B085360A3002E` | Same count; content differs. Target also has three FTE-provenance columns. |
| `paws.Session` (15 shared columns) | 1,937 / `FE0D19D7B0799CB701EDFF672E31ABCB8E2A825D7DC2479EACD714CC3B46DFF0` | 1,937 / `23E52BEEE61376D5D4DC26C6E2CC47BB6F559A488B77F09D8EA82254FA78B661` | Same count; content differs. |
| `paws.SessionAssignment` (15 columns) | 4,970 / `20C7CF8648E76B52CCFDC982C8D29B9315274943DD5D8E0164DC4D88B6CE64D2` | 4,970 / same | Exact rowset fingerprint match. |
| `paws.RoleAssignment` (19 shared columns) | 162 / `E856CAF65BB2FB8E1CAD8BB42FF7D8ED3C381FEDC3A95DA217B00E1B1D4E849F` | 162 / `F8029D74E92736125AE440818C06DE5B718127259B3977D1087D15BED9F2456C` | Same count; content differs; target columns are wider. |
| `paws.AfcRecord` (8 columns) | 791 / `1D5C5A79A98C0D26DDC32EDA56D54C989018EAECB527B91286916555D1D13220` | 803 / `1DFDC80B348F876A7CC7774CC3F639DC4E140C5D6487F82E0E00CBA6E1854E00` | Target has 12 additional rows; preserve pending source reconciliation. |
| `paws.DoeRuleSeed` (13 shared columns) | 24 / `73F7D1AE503E155D08F3FE74A4AA3F27E262B58D0D3B36EE8388E13AF05370B4` | 57 / `AC6930CE6995096BE163D7E2345E53F91ECFDE9B5E68126D648A312E94647D36` | Target has 33 additional rows and `PolicyVersionId`; reconcile provenance, do not delete. |

VetMed-Ops contains target-only `DoeFacultyAllocation` (229 rows),
`DoeFacultyTarget` (109 rows), and `DoePolicyVersion` (1 row), plus the
University API tables/procedures for AFC requests, approvals, artifacts,
manual AFC, audit, and user profiles. These are target architecture objects,
not automatically missing Azure migrations or cleanup candidates. DOE seed,
Faculty, Session, RoleAssignment, and AFC differences remain data/provenance
drift requiring an accepted mapping/reconciliation; no data was changed.

This comparison is a scoped parity check of the six named canonical datasets
and the target-only objects found in the reviewed API/DOE areas, not a claim
that every object in the two databases is identical or that a full migration
ledger has no omissions. No missing object dependency was identified in the
reviewed W1C route/migration surface; broader source-to-target object
inventory completeness remains unverified.
