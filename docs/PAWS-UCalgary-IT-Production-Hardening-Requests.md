# PAWS — UCalgary IT Production / Hardening Requests

> **Historical draft, not an approved IT ticket or a current deployment plan.** Confirm the present University SQL Beta/SSO/hosting architecture before sending requests. The public Testing Pages Frontend Demo is browser-local, not a production host.

**Status:** Draft for post-Beta acceptance. No requests have been sent to UCalgary IT.
**Current Beta ingress:** temporary Cloudflare Quick Tunnel to loopback `127.0.0.1:18787`; not production infrastructure.

## Required before production

1. **Production identity and SQL mapping.** Provision an institutional PAWS Windows service identity, preferably a managed service account if supported, and map its SQL login to `VetMed-Ops`. Confirm ownership, lifecycle, and service-logon requirements.
2. **Reviewed least-privilege database access.** Replace temporary broad permissions with the reviewed exact `SELECT` views/objects and exact `paws_api` procedure `EXECUTE` permissions required by the deployed API. Do not grant `db_owner`, `db_datawriter`, or schema-wide `EXECUTE`.
3. **Institutional API hostname and ingress.** Allocate a stable UCalgary hostname, DNS record, trusted server certificate, and approved reverse-proxy or ingress route for HTTPS only. Replace Quick Tunnel; keep SQL 1433, RDP, SMB, and administrative ports private.
4. **Production host and change approval.** Confirm whether university policy requires a dedicated PAWS API host rather than the current database host. Obtain the applicable service-account, firewall/proxy, certificate, and production change approvals before cutover.
5. **Supported service operation.** Define the approved Windows service startup identity, recovery behavior, patching/restart ownership, and change window for the PAWS runtime.

## Recommended hardening

1. **Institutional secret management.** Replace temporary DPAPI/manual protected configuration handling with the university-approved secret store and documented rotation/recovery ownership.
2. **Backup and restore assurance.** Document VetMed-Ops backup/retention SLA, restore objectives, and a tested recovery procedure for the new AFC request, approval, and immutable artifact data.
3. **Monitoring and audit operations.** Set availability, SQL connectivity, certificate/tunnel replacement, authentication failure, and API error alerts; define log retention, access, escalation, and incident ownership.
4. **Access review.** Schedule periodic review of the PAWS service identity, SQL grants, Firebase project administrators, and release/deployment approvers.

## Optional later

1. **Ingress resilience.** Add redundant approved ingress or a documented failover route if the Beta/production availability objective requires it.
2. **Operational dashboards.** Add aggregate service and workflow health views that exclude AFC reasons, signatures, PDF bytes, tokens, and other sensitive payloads.

## Information to include in the IT request

- Application name: PAWS (Azure Beta currently; production target must be confirmed).
- SQL database: `VetMed-Ops`; request a dedicated service principal mapped to the runtime service identity.
- API exposure: HTTPS through an institutional endpoint only; SQL remains private.
- Requested grants: attach the reviewed object/procedure list from the final runtime inventory; do not ask for blanket database ownership.
- Hosting decision: confirm whether `ITAPPVETOPSDB01` is an approved long-term API host or whether a separate application host is required.
- Operational owners: identify the teams responsible for DNS/certificate renewals, firewall/proxy, Windows service lifecycle, SQL access review, backup/restore, and incident response.

This list is a planning artifact only. It does not authorize account creation, permission changes, infrastructure configuration, or production cutover.
