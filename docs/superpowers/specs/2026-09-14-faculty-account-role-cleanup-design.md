# Faculty Account and DOE Role Cleanup Design

## Scope

This change aligns Change History, Timetable DOE labels, User Management, faculty workload roles, and Firebase Authentication account provisioning. It preserves the existing UCalgary visual language and the current single-primary-role authorization checks while recording every faculty-facing role separately.

## Change History

The Change History tab will use the same panel, toolbar, table, spacing, and red/gold theme as the other Faculty Dashboard tabs. The history panel will use the full dashboard width. Long values remain readable through wrapping and expandable detail rows instead of forcing narrow columns or horizontal clipping.

## Effective DOE in Timetable

Every Timetable faculty selector and faculty list will display an effective DOE target. `doeOverride2026_27.value` wins when present; otherwise the value comes from the contract teaching DOE. An override is labeled visibly so administrators can distinguish it from a contract value. Assigned DOE remains a separate workload value and is not replaced.

## User Management Flow

For faculty-facing accounts, the administrator selects a faculty record first. Name and email are copied from that faculty profile and shown read-only. A new account does not request a UID: Firebase Authentication creates the login and returns the UID, after which the application writes `users/{uid}`. Existing accounts keep their UID.

Owner, Administrator, and Other Office records can still be edited without changing their existing UID. Existing privileged accounts are never overwritten by the bulk faculty provisioning flow.

Account creation uses a secondary Firebase Auth app so creating another user does not replace the administrator's current browser session. The user-supplied temporary password is supplied only at execution time and is never stored in source, generated reports, console output, or Git history. New profiles set `mustChangePassword: true`; Session Guard continues to require a password change before normal dashboard use.

## DOE-linked Role Cleanup

The migration reads source workload roles and imports supported operational roles into `managedRoles2026_27`:

- Course Coordinator
- HICC
- VISC
- Course Coordinator / HICC
- Rotation / Week Lead
- CCC
- Trainee / Supervision
- Special Project
- Other

Each imported record retains the source role type, assignment, DOE credit, year, and a migration marker for audit. A stable normalized key makes the migration idempotent. Existing managed additions and removals remain intact. Source workbook data remains unchanged.

After migration, these roles appear in Edit Faculty under DOE-linked Faculty Roles and can be added, changed, or removed through the existing audited save flow.

## Access Role Mapping

The `users` profile keeps its current primary `role` for compatibility and adds `facultyRoles` for the complete faculty-facing role set. The primary role is selected in this order:

1. HICC
2. VISC
3. Faculty

This prevents a faculty member with both HICC and VISC workload roles from losing either classification while retaining the current security-rule contract. Workload roles never grant Owner, Administrator, or Other Office access.

## Bulk Provisioning

The provisioning tool processes active faculty records with a valid unique email. Before writing, it produces a dry-run result containing create, update, skip, duplicate-email, and missing-email counts. Execution then:

1. skips faculty already linked to an Authentication/profile record;
2. skips duplicate or invalid emails;
3. creates the Firebase Authentication login;
4. writes `users/{uid}` with the faculty profile identity, primary role, all faculty roles, `active: true`, and `mustChangePassword: true`;
5. writes an `account_audit` record for every successful profile creation or role update;
6. reports partial failures without undoing successful independent accounts.

The process never demotes, disables, or overwrites an existing privileged account.

## Error Handling and Security

The UI shows per-account errors without including passwords. Authentication responses such as duplicate email, disabled password sign-in, or rate limiting are translated into clear administrative messages. Firestore writes occur only after Authentication returns a UID. If profile creation fails after Authentication succeeds, the result is flagged for manual reconciliation instead of silently retrying account creation.

The shared temporary password is treated only as an initial credential. The application-level password-change gate prevents access to the rest of the application until it is replaced.

## Testing and Verification

Automated tests will cover effective DOE precedence, role normalization/deduplication, primary-role selection, account form identity derivation, dry-run classification, privileged-account protection, and required audit data. Existing Firestore/Auth emulator tests will verify the rules remain compatible.

Rendered QA will cover Change History at desktop width, Timetable override display, User Management new/edit flows, responsive layout, and one account-provisioning dry run. Production writes will be preceded by the dry-run count comparison and followed by Authentication/profile/audit reconciliation.
