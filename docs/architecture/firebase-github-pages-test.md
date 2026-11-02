# Firebase + GitHub Pages: historical Lab proposal

> **Historical Firebase Lab architecture, not the default PAWS Testing site.** This dated proposal once treated GitHub Pages as a Firebase Auth/Firestore client for `vista-teaching-lab`. It does not describe the current publicly deployed Frontend Demo.

## Current Frontend Demo

The normal same-repository PR workflow runs `tools/build-paws-pages.js` and `tools/stage-github-pages.js --mode paws`. It publishes the PAWS `frontend/` app with the synthetic `tools/pages-demo-api/` browser adapter, simulated authentication and browser-local state. No real Firebase/SQL writes occur.

Site: https://ucvm-teaching-assignment.github.io/Teaching-assignment/ (verify the banner's latest PR and commit SHA).

## Optional, separately controlled Firebase Lab

`.github/workflows/firebase-lab-pages.yml` is a manual workflow targeting only `vista-teaching-lab`; it may use real Auth and Firestore but no authoritative client-side DOE writer. Read [testing environments](testing-environments.md), [database configuration](../database/CONFIGURATION.md), [Firestore schema](../database/SCHEMA.md), and [rules runbook](../operations/Firestore-rules-publication-runbook.md).

The earlier proposal for `doe_recalculation_requests`, a trusted queue consumer, DOE recalculation evidence and lab service credentials is **historical design**, not a claim that a cloud queue, rule set, secret or University production service is currently deployed.

**Do not use this archived proposal as an authorization to publish Firebase rules, run an Admin job or configure an Azure origin.**
