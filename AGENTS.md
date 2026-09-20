# AGENTS.md

## Repository and deployment source of truth

- Production repository: `Alex1122341/Teaching-assignment`.
- `main` is the only production source of truth.
- Do not commit feature work directly to `main`; use a feature branch / worktree and open a PR.
- The active development/test frontend is the fixed GitHub Pages site at `https://alex1122341.github.io/Teaching-assignment/`.
- Build `.deploy-static` with `node tools/build-static.js` from the source allowlist in `tools/static-assets.json` and the deterministic bundle map in `tools/runtime-bundles.json`.
- Do not publish the raw repository source tree or maintain a second frontend copy.
- Azure workflows and `tools/deploy_azure_static_web.ps1` are retained as paused production/fallback history; they are not part of the active Firebase lab development path.

## Application architecture

- Frontend: vanilla HTML, CSS and JavaScript.
- Authentication: Firebase Authentication.
- Active development/test database: Cloud Firestore project `vista-teaching-lab`, synthetic/test data only.
- Pull-request GitHub Pages browser testing must use `vista-teaching-lab` through repository variable `LAB_FIREBASE_WEB_CONFIG_JSON`. The Pages runtime must keep the DOE API endpoint blank.
- Ordinary application data continues to use Firebase Authentication + Firestore. Authoritative DOE policy publication, impact preview persistence and recalculation writes must run only through the manually dispatched `Firebase DOE Admin Job` GitHub Action (or equivalent trusted admin tooling), never directly from the browser.
- DOE browser writes remain denied by `firestore.rules`. Do not weaken that boundary to make an admin screen work.
- `tester-teaching` is reserved for future production work and must not be used by the active Pages test site.
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
- Preserve lazy/deferred boundaries for AFC PDF generation, approval workflow, swap compatibility, and Faculty Dashboard enhancements unless a reviewed build change explicitly replaces them.
- Avoid unrelated refactors in a feature PR.
