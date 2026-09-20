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
  X--> no DOE API URL
  X--> no browser authoritative DOE writes

GitHub Actions: Firebase DOE Admin Job
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
- DOE operations: `doe_impact_runs`, `doe_impact_rows`, `doe_publications`, `doe_recalculation_batches`, `doe_audit_log`

## GitHub configuration

Repository Actions variable:

- `LAB_FIREBASE_WEB_CONFIG_JSON` — public Web SDK JSON for `vista-teaching-lab`

GitHub Environment `firebase-lab-admin`:

- secret `FIREBASE_LAB_SERVICE_ACCOUNT_JSON` — test-only Admin SDK credential

Do not place the service-account JSON in repository variables, source files, issues or workflow logs.

## Test-site deployment behavior

`.github/workflows/github-pages-test.yml` runs only for same-repository pull requests targeting `main`. It checks out the exact PR head, runs root/server tests plus the Firebase emulator suite, generates the lab runtime configuration, verifies the project boundary, builds `.deploy-static`, injects the test banner and deploys the single fixed Pages environment.

A newer successful PR replaces the previous test build at the same URL.
