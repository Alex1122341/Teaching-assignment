# Role & Appointment rowversion: confirmed production root cause (2026-10-23)

## Symptom and evidence

The owner retried editing an active period after PR #137 and saw **"Appointment version is unavailable. Close and reload this appointment before editing."** The previous PR #137 made the browser fail closed when `scheduleVersion` was malformed; it did not correct the malformed value at the database source.

A production **read-only** SQL inspection on ITAPPVETOPSDB01 / VetMed-Ops showed 198 role assignments in academic year 2026–27, including 148 with existing `paws.RoleAppointmentSchedule` rows and 50 without. The existing SQL projection `CONVERT(varchar(18), ScheduleVersion, 1)` did not produce hexadecimal for the `timestamp/rowversion` column: its length was 7–8 and it included nonprinting binary bytes. Explicitly casting first to `varbinary(8)` produced the correct 18-character uppercase/lowercase-agnostic string, e.g. `0x0000000000009C57`. The column type was confirmed to be `timestamp` and 8 bytes. No identifiable faculty or schedule data was printed.

The API SQL projections in `sql-dashboard-repository.js` had the defective conversion in **both** faculty detail and administrative Roles list. The SQL stored procedure `paws_api.SetRoleAppointmentPeriods` originally created in immutable migration 035 had **the same defect twice**, for the version used in its SQL optimistic-lock comparison and for the returned version. Thus client-only acceptance of more hex forms did not repair live editing; the previous front-end guard correctly refused the invalid token, but its wording was misleading.

## Minimum corrective code

- Use `CONVERT(varchar(18),CONVERT(varbinary(8),rs.ScheduleVersion),1)` for both read projections.
- Append migration `058_role_appointment_rowversion_hex.sql`, changing only the two conversions in the accepted `SetRoleAppointmentPeriods` stored procedure, with `CREATE OR ALTER PROCEDURE` so existing grants remain attached.
- Leave the original applied 035 migration unchanged. No table schema, row data, SQL permissions, DOE, dates, audit insert, role scope, Firestore, API write gate, authentication, or version-lock logic is modified.
- Keep the PR #137 fail-closed front-end and API version parsing rules. Do not bypass version locks or silently send null for populated schedules.

## Verification and release boundary

The new `server/test/role-appointment-sql-rowversion.test.js` test failed 3/3 before implementation and passed 3/3 after. It also asserts the new stored procedure is byte-for-byte the original accepted procedure except for the two proven hex-conversion expressions. `058_role_appointment_rowversion_hex_acceptance.sql` is a **read-only** post-migration check of hex conversion and procedure guards.

An independent freeze promotion, exact-HEAD CI, live SQL change review and a controlled API release are required **before** production changes. This is a database procedure change: the previous CI / Hosting success does not prove it is live. Do not run `058` against VetMed-Ops, merge, or deploy without the owner's explicit approval for this corrective database deployment. Maintain current production on PR #137 until accepted.

After an authorized release, refresh Roles & Appointments and retry the originally affected record with a real authorized user; confirm save + reload persists the correct periods and a stale version still produces HTTP 409. Avoid changing any real appointment solely for a synthetic smoke test. Preserve a rollback copy of the old procedure definition before DDL.
