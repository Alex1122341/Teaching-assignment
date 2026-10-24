# Faculty change history 09–11

## Authorization and outcome

The owner requests inline sequential implementation of tasks09–11 plus Faculty Dashboard history for Lookup, AFC and DOE Rule Book. The owner explicitly delegates design choices and asks that no questions block progress. This concrete recommended design therefore proceeds without another approval question. Human-only acceptance remains listed separately. Repository is Teaching-assignment-azure / Beta, not the Desktop Experimental repository.

## One read service, three views

* **My Change History:** changes affecting the linked faculty member's teaching and schedule, including changes made by others and removal from an assignment. Accounts without a faculty link receive a clear explanation, not administrator-wide results labelled My.
* **Calendar Changes:** all authenticated timetable users can inspect sanitized teaching session changes across the timetable, regardless of their own assignment. Excludes private AFC, DOE, workflow comments and other faculty's working-activity ranges.
* **Dashboard History:** administrators see recorded Lookup, role, AFC and Rule Book changes. Faculty see only their own private Lookup/AFC/role history plus public Rule Book publication events. Draft rules and other people's private values are excluded. Office roles do not acquire administrator rights through this feature.

University SQL remains authoritative. Existing AuditEvent and DoeAuditEvent are durable sources. An additive event-context table and set-based AuditEvent insert trigger capture session context and affected faculty at the time of new events, without rewriting existing audits or changing business data. Historical membership is accepted only from recorded before/after IDs; current assignments are never used to backfill past membership. Existing names may be resolved for display, explicitly not claimed as historical names. No raw audit JSON is returned to the browser.

## Coverage and values

Each visible row is a recorded field change (or an explicitly labelled event summary when details were not recorded). Required columns: Change Date (UTC plus local display), Change Type, Course, Session, Previous Value, Updated Value, Change Status. Additional domain, academic year and affected faculty columns support filtering. Actor is shown to administrators only when actually recorded; no email/UID fallback. Same-event old/new course and topic both match filters. Faculty filters use opaque existing sanitized candidate keys, not UCIDs/emails. Academic year comes from recorded evidence, not the event date. VISC subject is only populated from recorded authoritative subject context; otherwise Not recorded, with a coverage notice. No guessed mapping from topics or DOE draft subject tables.

Lookup values are explicitly allowlisted from recorded snapshots; secrets, login/account metadata and other faculty private values cannot enter public timetable rows. AFC details are own/admin only. Rule Book faculty visibility is limited to publication and archival of a previously published version, with public policy fields only. Draft audit enrichment records actual rules/selectors/parameters/tiers/inputs and mappings in the existing transaction; private exceptions remain admin-only. Missing old details stay Not recorded.

## Stable filtering and export

Validated filters: scope, course number, topic, VISC subject, faculty candidate key, change date range, change type, domain and academic year. Query returns a random opaque snapshot handle, count and first100 rows. It materializes at most10,000 sanitized rows /6MiB once; additional pages and CSV/XLSX use exactly that snapshot. No silent truncation. Oversize queries require narrower filters. Snapshot TTL10minutes, at most2 per actor and8 globally /48MiB; eviction or restart requires refresh. Cache stores only authorized DTOs. Every page/export revalidates token and active SQL profile, binding handle to uid, normalized role and linked faculty. Changed authorization invalidates access.

CSV and genuine XLSX use the same columns and complete filtered row set, not just the visible page. Spreadsheet formula prefixes are neutralized. Existing server ExcelJS4.4.0 is loaded lazily; no browser CDN dependency. Export travels as bounded authenticated JSON base64 to preserve the existing tightly restricted PDF binary transport. Error responses contain no SQL/private data.

## UI and lifecycle

Shared accessible responsive history component: labelled filters, Apply/Reset, count, explicit empty/error/loading/expired states, paginated table and CSV/Excel download buttons. My Change History reuses its existing modal and focus trap. Calendar has a Changes entry for all authenticated users. Dashboard offers History even in faculty self mode. Filter edits disable downloads until applied; stale responses cannot replace newer requests. Signed-out/profile-changed state clears rows and snapshot handles.

No write gates or DOE calculations change. No Firestore fallback. No migration of the already committed540 rows. SQL schema is installed before the API runtime. Runtime product changes and immutable freeze promotion are separate reviewed commits; candidate CI, exact-main CI and authorized Beta release remain required. Manual acceptance and unavailable source mapping are recorded honestly rather than blocking independent work.
