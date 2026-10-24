# PAWS P3 Stage A / Beta Connection Runbook

This runbook is for the accepted P3B1–P3B4 source at product base
`b6e74ff5ff34ef5f3b2541f8a3528341ff38f943`. It preserves the Azure rollback
environment, Firebase authentication, SQL TLS validation, and the existing
DPAPI-protected University runtime configuration.

## Gate rules

- **PASS** only when the listed evidence is captured for the exact source and
  runtime candidate.
- **STOP** on unexpected live objects, failed guards, data-count drift,
  non-loopback API binding, invalid TLS, or any candidate hash mismatch.
- **ROLLBACK** only through the migration's guarded rollback while its workflow
  rows are empty; after an immutable approved artifact exists, use forward
  repair and preserve it.
- **Forward recovery** preserves all business rows and artifacts, fixes the
  failing layer, and reruns only the affected acceptance checks.
- Keep temporary Beta ingress separate from stable public ingress. A Quick
  Tunnel may expose only the PAWS API loopback origin and must be labeled
  temporary. Stable public ingress remains **HOLD** until an institutional
  hostname and named tunnel are authorized and validated.

## A0 — Preflight and rollback source

Confirm `ITAPPVETOPSDB01`, the currently authorized Windows identity,
`VetMed-Ops` `ONLINE`, Node 22, the previous runtime repository HEAD, the
existing launcher, and the latest full plus subsequent log-backup metadata.
Confirm the full-backup media file exists. `RESTORE VERIFYONLY` previously
stopped at SQL Server's `CREATE DATABASE` permission check in `master`; do not
change permissions to bypass it. Record this as an unverified-media limitation,
not as a successful restore test.

Record the pre-P3 view definition hash, `AfcRecord` count, `AfcManualRecord`
count, runtime listener, and protected configuration locations without
printing configuration values. Do not overwrite the existing repository,
launcher, or `C:\PAWS\Runtime\Secrets`.

## A1 — Apply 009 AFC request foundation

Apply only `database/azure-sql/009_afc_request_foundation.sql` using integrated
authentication, mandatory encryption, certificate-name validation, `-I`
(`QUOTED_IDENTIFIER ON`), and `-b`. Stop if `sqlcmd` returns nonzero.

Verify `paws.AfcRequest`, `paws.AfcApproval`,
`paws_api.SubmitAfcRequest`, and `paws_api.WithdrawAfcRequest`; expected indexes
and constraints are present and trusted; request/approval row counts are zero;
the existing `AfcRecord`/`AfcManualRecord` counts are unchanged. If this gate
fails before new workflow data exists, use the guarded 009 rollback, verify the
original state, correct the client SET options, and retry 009 only.

## A2 — Apply 010 AFC approval foundation

Apply only `database/azure-sql/010_afc_approval_foundation.sql` with the same
strict connection options. Verify the Recommend, Reject, and Approve
procedures; their constraints and indexes; and the new unified-view definition
hash. Confirm all 791 imported AFC records remain visible exactly once through
`paws.vAfcRecordUnified`, no manual AFC rows were added, and workflow rows remain
zero. If validation fails before approval data exists, use the guarded 010
rollback and confirm the exact recorded pre-P3 view hash before retrying.

## A3 — Apply 011 approved artifact foundation

Apply only `database/azure-sql/011_afc_approved_artifact.sql`. Verify
`paws.AfcArtifact`, the three approved-artifact procedures, the unique
`AfcRequestId` rule, trusted constraints, an initial artifact count of zero,
and no artifact trigger or update/delete procedure. Once acceptance creates an
artifact, never use destructive 011 rollback; preserve it and use forward
repair.

## A4 — Build the University runtime candidate

Run `tools/p3-stage-a/build-candidate.js` from the accepted source. The
candidate inventory must bind to the accepted base SHA, Node 22.x,
`pdf-lib@1.17.1`, exact lockfile, P3 request/approval/artifact source, and the
reviewed PDF. Reject `.env`, credentials, private keys, tests, and `node_modules`
from the source archive. Install production dependencies from the lockfile on
the target Node 22 runtime. Record the inventory digest and transport archive
SHA-256 separately.

The current candidate inventory digest is
`3dd3e4aa39f5da0e0ee2d82d46f20479501b6da9aa80e5f655464e2cf10f06a4` for source
base `b6e74ff5ff34ef5f3b2541f8a3528341ff38f943`.

## A5 — Versioned University runtime activation

Use `Deploy-UniversityRuntimeStageA.ps1` only on the named server and current
authorized identity. It validates the inventory, Node 22, prior runtime HEAD,
launcher hash, and an existing SQL health response before creating a new
versioned directory. It records a rollback copy of the old source and launcher,
leaves the old repository and DPAPI-protected configuration in place, changes
only a copied launcher's source-root path, and does not alter the Windows
service. The copied launcher must continue to enforce
`PAWS_SQL_ALLOW_SELF_SIGNED=false`; the existing encrypted SQL/Firebase values
must not be printed or rewritten.

After restart, require `GET /api/health/sql` = 200, anonymous `/api/v1/me` =
401, anonymous `/api/v1/afc-requests` = 401, and anonymous approved-artifact GET
= 401. All listeners must remain on `127.0.0.1:18787`. If a smoke check fails,
stop only the new listener, restart the untouched previous launcher, verify old
SQL health = 200, and diagnose before retrying. Keep both version directories
and the rollback evidence.

## A6 — Authenticated internal AFC acceptance

First run non-mutating checks with already-approved test identities. Never
request passwords, MFA codes, recovery codes, or tokens in chat. If no approved
test identity can authenticate through the normal Firebase sign-in flow, stop
at this gate and report the exact owner action needed; do not impersonate a real
user or create an arbitrary account.

Once an approved test identity is available, perform the explicitly marked AFC
acceptance: requester submission, Reports-To decision when required, Admin
approval, immutable PDF artifact creation, and retrieval. Record only synthetic
identifiers and status/count/hash evidence. Retain the marked test request and
artifact; do not delete either. Verify one artifact and one creation audit,
byte/hash match, idempotent repeated POST, read-only GET, SQL-authoritative
availability, and absence of a public PDF URL or Firestore workflow authority.

## A7 — Temporary Beta API ingress and frontend candidate

Do not expose SQL, RDP, or SMB. If a named institutional tunnel/domain is not
available, a new Quick Tunnel may temporarily forward only
`http://127.0.0.1:18787`, using HTTP/2 if QUIC fails. Record its exact temporary
URL, confirm external SQL health = 200 and anonymous protected routes = 401,
and test OPTIONS/CORS from the exact Azure Beta origin.

Build the frontend from the accepted P3B3/P3B4 branch. Integrate only the
required University API origin and preserve Firebase sign-in, the one-401
refresh rule, no replay after 403/5xx/network failures, PDF binary download,
and no Firestore AFC fallback. Keep the temporary API origin isolated so it can
be replaced without a broad frontend rewrite.

## A8 — Beta connection delivery; stable ingress remains held

Deploy only the reviewed frontend/runtime source SHAs through the established
Beta mechanism after local tests, static/API freezes, production build, secret
scan, and origin/CORS checks pass. Capture exact SHA/build/deployment evidence.
From outside the University server, validate site load, Firebase login, `/me`,
dashboard SQL read, AFC list, and approved PDF download where the authenticated
acceptance identity is available. Confirm no VPN requirement for the browser
when the temporary tunnel is active and no SQL direct exposure.

The temporary Quick Tunnel and Beta API origin may be used for this acceptance,
but must be labeled temporary and replaceable. Stable institutional public
ingress and any non-Beta production cutover remain **HOLD** until a named
institutional domain/tunnel and its ownership are verified. Do not merge `main`
unless the established reviewed Beta release mechanism requires it; never
force-push or retire the Azure rollback environment.
