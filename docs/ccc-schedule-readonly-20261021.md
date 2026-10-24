# PAWS Beta CCC Schedule read-only viewer

Source: existing `paws.CalendarActivity` category `ccc`, date/time evidence, current names and block information. Academic year is May 1–April 30.

The new `/api/v1/ccc-schedule` is actor-verified and sanitized for supported active signed-in users. It does not widen the existing self-only Calendar Activity list, publish DOE, or write availability/sessions. Blank times are not inferred; half-day appears for a single-day record with explicit half-day label or verified 1–300-minute duration.

SQL migration `057_ccc_schedule_read.sql` adds only a stored procedure with an execute grant to `paws_runtime_read`; guarded rollback is provided. No data migration/replay.

The header viewer refreshes on open, every 60 seconds while visible, on tab return and on Refresh. It never caches a separate persistent schedule or requests DOE.

Acceptance still requires Node22 local tests, SQL 057 real transaction/permissions verification, separate immutable static/API freeze promotion, code review, exact-head CI and coordinated University API/Hosting release. No production update is implied by this source change.
