# Workstream 5B Addendum — Spark Finalization Constraint & Future Database Migration Marker

**Date:** 2026-09-17  
**Repository:** `Alex1122341/Teaching-assignment`  
**Status:** Approved in chat; normative addendum to `2026-09-17-approval-routing-roles-privacy-design.md`

## 1. Why this addendum exists

The current deployment is Firebase Spark-compatible and has no trusted server-side Cloud Function or application server. At the same time, ADC/LAB must not receive Faculty UCIDs, DOE data, AFC details, private assignment identifiers, or other confidential Faculty information.

That combination creates one important finalization constraint for mixed requests that include an Instructor/Faculty assignment change.

## 2. Spark-era finalizer rule

If a timetable change request includes an Instructor/Faculty assignment change, **ADFA is the final applying approver**.

ADC/LAB may review and approve their own scopes first, but the request must not apply until:

1. every other required office has approved its current scope;
2. ADFA has the full authorized Faculty context;
3. ADFA performs the current DOE/AFC/availability/timetable-conflict checks;
4. any required conflict override is deliberately confirmed and audited;
5. ADFA approves the exact current revision;
6. the full patch is applied once through the guarded finalization transaction/batch.

Example:

```text
Date change        -> ADC approved
Lab Topic change   -> LAB approved
Faculty change     -> ADFA pending

ADFA approves last
-> recheck Faculty assignment
-> atomically apply Date + Lab Topic + Faculty
-> mark request Approved / applied
-> notify participating offices
```

If ADC or LAB is still pending, ADFA may inspect the request but cannot complete `Approve & Apply` yet.

## 3. Requests without Faculty assignment changes

When a request contains no Instructor/Faculty assignment change, the last required office to approve may finalize the request.

Examples:

```text
Date + Room       -> ADC may be finalizer
Lab Topic only    -> LAB may be finalizer
Date + Lab Topic  -> whichever of ADC/LAB approves last may finalize
```

The same stale-base, revision, idempotency, withdrawal-race, audit, and sanitized-calendar synchronization requirements still apply.

## 4. Push-back compatibility

The existing approved push-back rules remain unchanged.

If ADC/LAB scopes were already approved and ADFA pushes back only the Faculty assignment scope, the requester may revise and resubmit that returned scope without reopening the unrelated approvals.

If Date/Start/End changes while a Faculty assignment exists, the prior ADFA approval is invalidated and reopens, as defined in the primary WS5B specification.

## 5. Required implementation marker

This ADFA-last behavior is an **architecture-specific compatibility rule for the current Spark/client-side deployment**, not a permanent business-policy requirement.

Implementation must leave an explicit searchable marker in the finalization code, using this exact tag:

```text
UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer
```

The marker comment must explain that when the application moves to the future University of Calgary database / trusted application-service architecture, final apply should be moved to a trusted backend transaction/service so approval order no longer needs to depend on which office has access to private Faculty data.

The marker must not weaken current privacy controls and must not expose private data merely to avoid the temporary ordering constraint.

## 6. Future UCalgary database target

When the project is migrated to a UCalgary-managed database plus trusted backend/API layer, revisit this area and replace the client finalizer with a server-authoritative workflow, conceptually:

```text
Office approvals -> trusted workflow service
                 -> server loads private assignment context
                 -> server validates all required approvals + current revision
                 -> server runs final conflict/integrity checks
                 -> one database transaction applies the full patch
                 -> server writes audit + notifications
```

At that point, ADC/LAB may remain completely sanitized while approval order can become fully parallel because no office browser needs to possess the private data required to perform final apply.

## 7. Test requirement

WS5B tests must prove both current and future-facing intent:

- mixed request with Faculty change cannot be finalized by ADC/LAB;
- ADFA cannot finalize while another required office remains pending;
- ADFA can finalize after all required non-ADFA scopes are approved;
- non-Faculty requests can finalize when their last required office approves;
- the source contains the exact `UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer` marker so the temporary architectural constraint is discoverable during a future database migration.
