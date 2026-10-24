# Role / Appointment effective periods — 2026-10-11

Owner approved date-based Active / Inactive / Dates needed, as-of filtering and editing within Edit Faculty. One appointment supports up to 12 inclusive non-overlapping start/end periods; a null end means open-ended. No periods means inactive. Legacy dates remain fallback until explicitly saved; unknown dates and Alfredo's narrative month references are not converted into guessed days.

Scope: Faculty Dashboard role table, profile role display and Edit Faculty -> Edit periods. Add/remove/edit/end-today are draft changes until Save periods. Role status is separate from Faculty Active and annual/manual DOE. No automatic prorating, original role fields/DOE facts remain unchanged.

Storage: additive paws.RoleAppointmentSchedule keyed by existing RoleAssignmentId; JSON periods, rowversion optimistic concurrency, audit actual verified UID. API administrator + existing facultyAdmin gate, SQL rechecks role/account and row lock. Existing support transaction captures new schedule table; Undo excludes rowversion and therefore regenerates concurrency version.

Source SQL roles and personal detail reads join schedule metadata; existing authorized scope remains. Static module calculates as-of display/filter in University timezone. Manual DOE adjustments are explicitly Not applicable and not editable as appointments.

Schema035 compiled in a rollback transaction on ITAPPVETOPSDB01/VetMed-Ops, exit0. JS syntax checks and static69-file build completed. No newly added or locally run tests; existing automatic CI will verify updated fixture script dependency and runtime freeze. Release needs exact-main CI, schema035, attested server cutover and Hosting-only deployment.

