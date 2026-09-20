# Firebase + GitHub Pages test architecture

## Active path

```text
Browser
  |
  v
GitHub Pages
https://alex1122341.github.io/Teaching-assignment/
  |
  +--> Firebase Authentication (vista-teaching-lab)
  |
  +--> Firestore ordinary application data (vista-teaching-lab)
  |
  +--> pending DOE recalculation requests (non-authoritative)
  |
  X--> no DOE API URL
  X--> no browser authoritative DOE results/evidence

GitHub Actions: Firebase DOE Admin Job
  |
  +--> recalculate-queue re-reads current session facts
  |
  +--> test-only Firebase Admin credential
  |
  +--> existing DOE service layer
  |
  v
Firestore authoritative DOE collections (vista-teaching-lab)
```

## Why this is the current development architecture

- It removes Azure quota/deployment dependencies from feature development.
- The public fixed Pages URL can exercise real Firebase Authentication and Firestore behavior against isolated synthetic data.
- DOE remains server-authoritative because client Security Rules continue to deny authoritative DOE mutations.
- Existing DOE calculation/service code is reused by a short-lived trusted job instead of a continuously hosted API.
- The same design can later be migrated to a production backend without changing the canonical DOE model.

## Firestore collection groups

- Identity: `users`
- Faculty source: `faculty`
- Timetable source/projection: `sessions`, `calendar_sessions`
- Workflow/audit: change-request, approval and append-only log collections documented in `docs/database/SCHEMA.md`
- DOE policy: `doe_policies`, `doe_policy_versions`, `doe_rules`, selectors, inputs, parameters, tiers, references, mappings and exceptions
- DOE facts/evidence: `doe_assignments`, `doe_calculation_records`, `doe_faculty_targets`
- DOE request queue: `doe_recalculation_requests` (non-authoritative; browser can only create a strict pending request)
- DOE operations/evidence: `doe_impact_runs`, `doe_impact_rows`, `doe_publications`, `doe_recalculation_batches`, `doe_audit_log`

## GitHub configuration

Pinned public client configuration:

- `tools/lab-firebase-web-config.json` — public Web SDK JSON for `vista-teaching-lab`
- refresh with `npm run config:pin:lab` after an authenticated `firebase login`
- this file contains client metadata only; it must never contain a service-account credential or private key

GitHub Environment `firebase-lab-admin`:

- secret `FIREBASE_LAB_SERVICE_ACCOUNT_JSON` — test-only Admin SDK credential

Do not place the service-account JSON in repository variables, source files, issues or workflow logs.

## Test-site deployment behavior

`.github/workflows/github-pages-test.yml` runs only for same-repository pull requests targeting `main`. It checks out the exact PR head, runs root/server tests plus the Firebase emulator suite, generates the lab runtime configuration, verifies the project boundary, builds `.deploy-static`, injects the test banner and deploys the single fixed Pages environment.

A newer successful PR replaces the previous test build at the same URL.


## Firebase-only timetable mutation flow

1. An authorized timetable/admin workflow edits the source session.
2. If the session contains faculty assignments, the browser removes any prior DOE result/provenance fields from those edited assignments. It never calculates replacement DOE.
3. The source `sessions/{id}`, matching `calendar_sessions/{id}`, and a strict `pending` `doe_recalculation_requests/{requestId}` document are committed together.
4. Until recalculation runs, derived views treat those assignments as missing/needs-review rather than as authoritative DOE.
5. An operator runs **Firebase DOE Admin Job > recalculate-queue** with confirmation `PROCESS-QUEUE`.
6. The job re-reads each current session, resolves the current Active policy for the Academic Year, and runs the existing server-side DOE recalculation scoped to the current session assignments.
7. The trusted writer stores DOE provenance/calculation evidence and marks the request completed. Failed requests remain pending for retry.

This queue is a command/request channel, not a result channel. Firestore Security Rules still deny browser mutation of authoritative DOE policy, calculation, publication, batch and audit collections.
