# Role & Appointment active-period version compatibility — 2026-10-23

## Observed error

The administrator Role & Appointment dialog surfaced **“Reload this appointment before editing.”**. In `server/src/data/dashboard-api.js` that is HTTP 400 `INVALID_ROLE_VERSION`: the request reached server authorization but its `expectedVersion` did not match the API's exact `0x` + 16 hexadecimal characters. It is **not** the SQL optimistic-lock conflict, which returns HTTP 409 `STALE_ROLE_PERIODS`.

The UI previously copied `current.scheduleVersion` directly from a cached roles/detail DTO, while the API accepted only prefixed version text. SQL rowversion is eight bytes; current SQL queries serialize it with `CONVERT(varchar(18), ScheduleVersion, 1)`, but previous data-client/transport representations may be an unprefixed 16-character string or JSON-serialized Node Buffer. The precise production request body has **not** been independently captured; this patch addresses that verified contract mismatch without claiming a specific observed malformed value.

## Change

Both editor and server normalize only unambiguous eight-byte representations to `0x` + uppercase 16-digit hex:

- canonical SQL-style hex, including harmless surrounding whitespace;
- bare 16-digit hex;
- JSON Buffer with `type: "Buffer"` and exactly 8 integer bytes in [0,255].

Null is preserved for a record with no existing schedule row. **Malformed non-null values are always rejected**; the editor blocks submission and keeps its unsaved dates. No malformed version is coerced to null. The SQL stored procedure still checks the exact expected rowversion under lock; stale edits remain HTTP 409 and never silently overwrite another update.

No changes to inclusive dates, 12-period bound, DOE, role assignment, faculty identity, authorization, Firestore, SQL schema, SQL grant, stored procedure, or write gate.

## Tests

`node --test server/test/role-period-version.test.js tests/role-period-version.test.js` covered 11 passing tests after the initial RED reproduction (5 failures from strict unprefixed/Buffer and invalid UI behavior).

`node --test server/test/role-period-version.test.js server/test/dashboard-api-r4d10a2.test.js server/test/w1e-permission-contract.test.js tests/role-period-version.test.js tests/faculty-admin-role-policy-parity.test.js tests/faculty-admin-management-ui.test.js tests/paws-data-client.test.js` passed 113/113.

Freeze validation deliberately reports drift until a separate reviewed governance promotion anchors the product commit. Do not merge or deploy based only on this local test.

## Verification and release

An exact-PR-head GitHub CI build, emulator, SQL acceptance and static/API freezes must pass. Subsequent live acceptance requires a coordinated University API update and Firebase Hosting-only update, with no SQL mutations. Then reproduce the original edited Appointment in the browser, confirm HTTP 200 and period persistence, and confirm a genuinely stale version still receives HTTP 409. Production reproduction remains pending until explicitly completed.
