# AGENTS.md

## Repository and deployment source of truth

- Production repository: `Alex1122341/Teaching-assignment`.
- `main` is the only production source of truth.
- Do not commit feature work directly to `main`; use a feature branch / worktree and open a PR.
- Firebase Hosting and Microsoft Azure Static Web Apps must publish the same static asset set from `tools/static-assets.json`.
- Build the shared static bundle with `node tools/build-static.js`.
- Azure practice deployment uses `tools/deploy_azure_static_web.ps1` and must not maintain a separate copy of frontend files.

## Application architecture

- Frontend: vanilla HTML, CSS and JavaScript.
- Authentication: Firebase Authentication.
- Database: Cloud Firestore project `tester-teaching`.
- The current production architecture is Spark-compatible and does not depend on deployed Cloud Functions.
- Security decisions must be enforced by Firestore rules and by minimizing what data is delivered to the browser.
- Do not weaken Firestore rules merely to make a UI feature work.

## Roles

Formal roles:
- `owner`
- `administrator`
- `other_office`
- `hicc`
- `visc`
- `faculty`

Legacy compatibility remains in place for `adfa_general`, `adfa_regular`, `admin`, `editor`, and `viewer` until migration is complete. Use the shared role helpers in `faculty-access.js` instead of inventing new role checks.

## Faculty privacy rules

For faculty-facing workflows involving other faculty members:
- Never expose another faculty member's UCID.
- Never expose another faculty member's email, DOE values, HR fields, AFC purpose/reason, or other confidential Faculty Directory data unless the user is authorized for those fields.
- AFC may be exposed to another faculty member only as binary availability: `Available` / `Unavailable`.
- Do not reveal why AFC makes a person unavailable.
- A timetable conflict may show the conflicting course and time because timetable data is already visible to authorized timetable users.
- Prefer sanitized derived documents over granting ordinary faculty read access to `/faculty`.

## Swap-request rules

- Faculty self-replacement requests list active faculty from a sanitized directory, not from login accounts alone.
- Candidate availability combines sanitized AFC availability with live timetable conflicts.
- `Sessional` and `Other` are valid replacement categories.
- `Sessional` and `Other` require a non-blank reason/note before submission.
- ADFA approval must resolve sanitized candidate keys through an admin-only mapping and re-check live availability before applying a change.
- Existing HICC group-swap behavior should not be broadened unless the task explicitly requests it.

## Testing and change discipline

- Add or update tests before implementation for behavior changes where practical.
- Run `npm test` before claiming a change is complete.
- Run the Firestore/Auth emulator suite for security-rule changes when the environment is available.
- Preserve existing audit logging, stale-request protection, DOE calculations, and approval checks.
- Avoid unrelated refactors in a feature PR.
