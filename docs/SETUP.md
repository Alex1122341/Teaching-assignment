# PAWS Testing setup (current)

**Default site:** PAWS Frontend Demo — synthetic data stored in the browser, simulated roles, **no cloud writes**, no real Firebase Auth/Firestore or University SQL connection. This replaces the old Spark/Azure activation walkthrough; only current workflow files govern deployment.

## Current GitHub Pages Frontend Demo

**Fixed TEST SITE:** https://ucvm-teaching-assignment.github.io/Teaching-assignment/

The **latest successful PR** deployment replaces the single shared website. Check the banner's mode, PR and SHA before testing.

Requirements: Node 22 and project dependencies. Build and serve an independent local preview:

```bash
npm ci
npm ci --prefix server
npm run test:all
npm run test:emulator
node tools/build-static.js
node tools/build-paws-pages.js
node tools/stage-github-pages.js --directory .deploy-static --mode paws --pr 1 --head-sha <40-character-commit-SHA> --build-sha <same-SHA>
python -m http.server 19069 --bind 127.0.0.1 --directory .deploy-static
```

The PR1 label is an example, **not deployment evidence**. `frontend/` provides PAWS pages; `tools/pages-demo-api/` implements synthetic browser-local API behavior. Published files are restricted by `tools/static-assets.paws.json`.

`.github/workflows/github-pages-test.yml` performs unit, server, emulator and browser smoke verification and then publishes the Demo. `.github/workflows/test.yml` also validates PR changes. Both require that each PR updates its own public `CHANGELOG.json` entry. Testing credentials and role switching do not verify actual cloud authentication or permissions. **Authoritative DOE disabled** for the default Demo; calculated demo quantities do not certify the University's DOE.

## Firebase Lab — separately selected and manual

Firebase Lab is **not** the default Testing site. Explicit workflow: `.github/workflows/firebase-lab-pages.yml`, only for `vista-teaching-lab`. It uses real Firebase Auth and Firestore under separate approval and synthetic fixtures. Consult [environment map](architecture/testing-environments.md), [configuration](database/CONFIGURATION.md), [schema](database/SCHEMA.md), [security matrix](security/role-matrix.md), and [rules publication runbook](operations/Firestore-rules-publication-runbook.md) before a lab operation.

Never aim an optional lab action at `tester-teaching`, infer permission from a browser role selector, or use a Demo result to authorize an actual database migration.

## Legacy user account setup (historical `web/` flow)

The following preserves legacy User Management acceptance requirements; it is **not** a real account-provisioning procedure for the browser-local Frontend Demo.

- Select the existing **faculty profile** for the account's identity, name and email.
- For bulk account changes, use **Preview changes**, then review before Apply. Leave **Require password change on next dashboard sign-in** enabled for new accounts unless explicitly approved otherwise.
- **Link existing ADC/LAB Authentication users**: in the old account management UI, choose **ADC** or **LAB**, enter the **Existing Firebase Authentication UID**, and verify the matching real identity. **Do not recreate the Authentication user** when linking an existing UID.
- **Do not store the UID or temporary password** in this repository, documentation, screenshots, issue comments or application logs. Preserve access audit and recheck scope in the separately authorized environment.

## Paused production release — historical control, not a current task

The old Azure Static Web Apps production Environment workflow required a required reviewer, **Prevent self-review**, and a separate **Approve and deploy** action after merging a reviewed `main` commit. The old `AZURE_STATIC_WEB_APPS_API_TOKEN` was held as an **environment secret** and is a historical reference; it is not used by the normal Pages Frontend Demo workflow. **Do not recreate that deployment path from this guide.**

University SQL Beta belongs to a different repository/service and requires its own authenticated data migration, acceptance and explicit authorization. Historical Firebase/Azure commands here have deliberately been removed from the active setup guide.
