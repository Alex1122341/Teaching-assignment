# GitHub Pages Test + Gated Azure Production Design

Date: 2026-09-15
Status: Approved in chat; pending written-spec review
Supersedes: `docs/superpowers/specs/2026-09-15-azure-pr-preview-deployment-design.md`

## Goal

Change the web delivery model so GitHub hosts the fixed test site and Azure hosts production only.

A pull request should be automatically verified and then published to one fixed GitHub Pages test URL. The user tests that site manually. After the pull request is merged to `main`, the exact production candidate is verified and built again, but Azure deployment must pause until the user explicitly approves the `production` deployment in GitHub.

Firebase remains the single shared backend for Authentication, Firestore, and Firestore Security Rules.

## Current State

The repository currently has:

- `.github/workflows/test.yml`, which runs static/unit tests plus Firestore/Auth emulator tests on pull requests and pushes to `main`.
- `.github/workflows/azure-static-web-apps.yml`, which currently deploys both pull-request previews and `main` production releases to Azure Static Web Apps.
- `tools/build-static.js`, which builds the deployable 35-file site into `.deploy-static`.
- `staticwebapp.config.json`, which contains the Azure-only redirect `/faculty-dashboard.html -> /index.html`.
- `tools/deploy_azure_static_web.ps1`, which remains the manual Azure fallback.
- Firebase project `tester-teaching`, which remains the application backend.

The repository is public. The existing Azure production URL remains:

```text
https://red-cliff-04871ca0f.5.azurestaticapps.net
```

## Chosen Architecture

Use GitHub Pages as one fixed shared test host and Azure Static Web Apps as production only.

Routine flow:

```text
feature branch
    -> pull request targeting main
    -> existing Test workflow runs
    -> GitHub Pages test workflow runs its own deploy-gating verification
    -> build .deploy-static
    -> publish fixed GitHub Pages test site
    -> user manually validates the test site
    -> merge pull request
    -> push to main
    -> production workflow verifies and builds again
    -> production deploy job waits for GitHub Environment approval
    -> user clicks Approve and deploy
    -> deploy exact tested artifact to Azure production
```

The fixed GitHub Pages test URL is expected to be:

```text
https://alex1122341.github.io/Teaching-assignment/
```

There is only one test site. The newest successful same-repository pull request deployment replaces the previously hosted test version.

## Pull Request Test-Site Workflow

Add a dedicated workflow for the fixed GitHub Pages site, for example:

```text
.github/workflows/github-pages-test.yml
```

It will trigger for pull requests targeting `main` on:

```yaml
pull_request:
  types: [opened, synchronize, reopened]
  branches: [main]
```

Only same-repository pull requests may deploy the test site. Forked pull requests should still be able to use normal CI where GitHub permits, but must not receive Pages write permissions through a privileged deployment path.

The Pages workflow is self-gating and does not rely only on the separate `Test` workflow result. It should:

1. Check out the pull-request integration revision that GitHub is testing against `main`.
2. Set up Node.js 22.
3. Set up Java 21 for Firebase emulators.
4. Run `npm ci`.
5. Run `npm test`.
6. Run `npm run test:emulator`.
7. Run `node tools/build-static.js`.
8. Stage GitHub-Pages-specific compatibility files and the test-environment marker.
9. Upload the prebuilt `.deploy-static` directory as a Pages artifact.
10. Deploy that artifact to the fixed GitHub Pages site.

If verification fails, the Pages deployment job must not run. The previous successful Pages test version remains online.

## GitHub Pages Deployment Mechanism

Use GitHub's official Pages Actions path rather than a generated `gh-pages` branch.

Expected components are the official equivalents of:

```text
actions/configure-pages
actions/upload-pages-artifact
actions/deploy-pages
```

The Pages deployment job needs the minimum Pages permissions required by GitHub, including `pages: write` and `id-token: write`, while source checkout remains read-only.

The Pages deployment environment should be the standard:

```text
github-pages
```

Repository setup must set **Settings -> Pages -> Build and deployment -> Source** to **GitHub Actions**.

The `github-pages` environment is the automatically deployed test target, not a manual approval gate. It must not be restricted to `main` only, because same-repository PR branches need to publish the fixed test site. Do not add required reviewers to this environment. Safety comes from the workflow's same-repository PR condition plus successful automated verification before the deploy job.

## Fixed-Site Concurrency

Because only one GitHub Pages test site exists, use one fixed concurrency group for Pages testing, with superseded runs cancelled.

Conceptually:

```text
group: github-pages-test
cancel-in-progress: true
```

This means the latest pull-request update wins. If PR A is still deploying and PR B or a newer update arrives, the older Pages deployment can be cancelled.

If an older PR already finished deploying and a newer PR later succeeds, the newer PR replaces the fixed test site.

## Test-Site Identity and Stale-Version Protection

The GitHub Pages host must be visually distinguishable from Azure production.

The Pages artifact should display a clear non-production notice such as:

```text
TEST SITE - GitHub Pages
Not Production - Live Firebase Backend
```

Where practical, the marker should also expose the tested PR number and short commit SHA so the user can confirm which version is currently hosted.

This is especially important because a failed newer PR does not replace the previous successful Pages deployment. The visible build identity prevents the user from accidentally validating a stale test version.

The marker is Pages-only staging behavior; the Azure production site must not display it.

## GitHub Pages Subpath Compatibility

The Pages site is a project site hosted below:

```text
/Teaching-assignment/
```

Application assets and internal navigation therefore must work from a subpath, not only from a domain root.

The current application primarily uses relative static references. Implementation should add regression coverage that protects Pages-compatible relative navigation and prevents accidental root-absolute application links from breaking the test host.

Do not change Firebase project configuration per environment; only the browser origin differs.

## Azure-Only Routing Compatibility

GitHub Pages does not interpret `staticwebapp.config.json`. Azure production must continue to use the committed Azure config unchanged.

The current Azure config contains one legacy redirect:

```text
/faculty-dashboard.html -> /index.html
```

Pages staging should create a lightweight static redirect shim for `faculty-dashboard.html` so the test host behaves equivalently for this known route. This compatibility file is generated only in the Pages artifact and must not replace the canonical Azure routing configuration.

If Azure routing rules expand later, route parity should be reviewed explicitly rather than assuming Pages implements Azure configuration semantics.

## Existing Test Workflow

Keep:

```text
.github/workflows/test.yml
```

as the normal independent CI signal on pull requests and pushes to `main`.

The Pages workflow intentionally repeats the deploy-gating verification so that a Pages publish cannot occur unless the exact workflow that creates the Pages artifact has passed the required checks.

This duplicates some CI work but keeps the deployment boundary simple and trustworthy.

## Production Workflow

Refactor:

```text
.github/workflows/azure-static-web-apps.yml
```

so it no longer deploys pull-request previews and no longer handles PR-close cleanup.

It should trigger only on:

```yaml
push:
  branches: [main]
```

The production workflow should use two jobs with a tested-artifact handoff.

### Job 1: Validate and Build

This job runs before any production approval is requested:

1. Check out the exact `main` commit.
2. Set up Node.js 22.
3. Set up Java 21.
4. Run `npm ci`.
5. Run `npm test`.
6. Run `npm run test:emulator`.
7. Run `node tools/build-static.js`.
8. Copy `staticwebapp.config.json` into `.deploy-static`.
9. Upload `.deploy-static` as an Actions artifact identified with the production commit SHA.

If any step fails, no production approval should be requested and Azure remains unchanged.

### Job 2: Deploy Production

This job depends on the successful build job and references:

```yaml
environment:
  name: production
```

The GitHub `production` environment has a required reviewer. The deployment job therefore waits in GitHub until the user explicitly approves it.

After approval, the job downloads the exact artifact created by Job 1 and uploads that artifact to Azure Static Web Apps. It must not rebuild different source after approval.

This guarantees that the production bytes are the same bytes that passed the post-merge verification.

## Production Environment Configuration

Create a GitHub Environment named:

```text
production
```

Configure:

- Required reviewer: the repository owner / user who performs production approval.
- Deployment branch policy: only `main` may deploy to `production`.
- **Prevent self-review must remain disabled** because the same user who merges the pull request must still be able to approve the resulting production deployment.

The normal release UI becomes:

```text
Actions -> waiting production deployment -> Review deployments
-> select production -> Approve and deploy
```

The repository is public, so GitHub's required-reviewer environment protection is available under current GitHub plan rules for public repositories.

## Azure Deployment Secret

Use the existing secret name:

```text
AZURE_STATIC_WEB_APPS_API_TOKEN
```

For least privilege, move this value from a repository-wide Actions secret into the `production` environment as an environment secret with the same name.

The production deployment job gains access to that secret only after the `production` environment protection rules pass.

After the environment secret has been created and verified, the duplicate repository-level secret should be removed manually.

Never print or commit the token.

## Production Concurrency and Superseded Approvals

Use one production concurrency group with cancellation enabled, conceptually:

```text
group: azure-production-main
cancel-in-progress: true
```

If one `main` commit is waiting for production approval and a newer merge reaches `main`, the older pending deployment is cancelled. The newer commit runs verification and becomes the only current candidate awaiting approval.

This prevents accidentally approving a production build that has already been superseded by a newer `main` revision.

## Firebase Backend

Both hosts continue to use the same Firebase project:

```text
tester-teaching
```

GitHub Pages test and Azure production therefore share:

- Firebase Authentication accounts;
- Firestore data;
- Firestore Security Rules.

No separate test database is introduced.

Because the test frontend points at live backend data, manual testing that writes application data must be deliberate. The Pages banner should explicitly warn that the backend is live.

## Firebase Authorized Domain

Add this hostname once in Firebase Authentication Authorized domains:

```text
alex1122341.github.io
```

The project path `/Teaching-assignment/` is not part of the authorized-domain entry.

Adding the hostname only permits Firebase Authentication to operate from that browser origin; it does not bypass Firestore Security Rules.

## Public Test URL and Security Boundary

The GitHub Pages URL is public because the repository is public. It is a test frontend, not a private staging network.

Application data remains protected by Firebase Authentication and Firestore rules. Do not put secrets, privileged tokens, or private server-side data into the static Pages artifact.

Same-repository PR gating must remain in place so untrusted fork code cannot use the Pages deployment permission path.

## Firebase Hosting and Firestore Rules

Firebase Hosting remains outside the normal web deployment flow.

Keep Firebase configuration and CLI support because Firestore/Auth emulators and Firestore Security Rules are still required.

Firestore rules deployment remains manual when `firestore.rules` changes:

```text
npx firebase deploy --project tester-teaching --only firestore:rules
```

Automatic rules deployment is out of scope for this change.

## Manual Azure Fallback

Keep:

```text
tools/deploy_azure_static_web.ps1
```

as an emergency/manual production fallback.

Routine releases should not require local Azure deployment or Firebase Hosting deployment.

## Failure Behavior

### Pull Request

If PR static/unit tests, emulator tests, static build, Pages staging, artifact upload, or Pages deployment fails:

- the Pages workflow is failed;
- the previous successful fixed test site remains online;
- the visible Pages build identity must make stale content detectable;
- the PR should not be considered manually validated until the intended revision is confirmed on the test site.

### Production

If post-merge verification or build fails:

- no production approval is requested;
- Azure production remains unchanged.

If production approval is rejected or left pending:

- Azure production remains unchanged.

If Azure upload fails after approval:

- the workflow fails;
- the previous Azure deployment remains the production reference;
- retry or rollback decisions should be made from the exact failed commit/run, not from an untracked local build.

## Expected Routine Developer Workflow

```text
create feature branch
-> open/update PR
-> CI
-> fixed GitHub Pages test URL updates after successful verification
-> manually test Pages version
-> merge PR
-> main verification + exact production artifact build
-> GitHub waits for production approval
-> user clicks Approve and deploy
-> Azure production updates
```

No Azure PR preview is created in the new model.

## Files Expected to Change During Implementation

Primary files are expected to include:

```text
.github/workflows/github-pages-test.yml       # new fixed test-site workflow
.github/workflows/azure-static-web-apps.yml   # production-only, approval-gated Azure workflow
tools/...                                     # Pages staging helper if needed
tests/...                                     # workflow, Pages compatibility, banner, and routing tests
SETUP.md                                      # new deployment and one-time setup instructions
```

Likely retained without functional change:

```text
.github/workflows/test.yml
tools/build-static.js
staticwebapp.config.json
tools/deploy_azure_static_web.ps1
firebase.json
firestore.rules
```

If implementation reveals that a retained file needs a small compatibility change, it must stay within this deployment design rather than expanding into unrelated refactoring.

## Verification Plan

Before treating the new flow as complete:

1. Existing static/unit tests pass.
2. Firestore/Auth emulator tests pass.
3. Pages deployment regression tests pass.
4. Azure production workflow regression tests pass.
5. Repository Pages source is configured to GitHub Actions.
6. Firebase Auth includes `alex1122341.github.io` in Authorized domains.
7. Open a same-repository test PR and confirm the fixed Pages site deploys only after its own verification passes.
8. Confirm the Pages URL loads the application correctly under `/Teaching-assignment/`.
9. Confirm Firebase sign-in and authorized Firestore reads work from Pages.
10. Confirm the visible test-site marker identifies the site as non-production and warns that Firebase data is live.
11. Confirm `faculty-dashboard.html` reaches the intended timetable behavior on Pages through the Pages compatibility shim.
12. Push another commit to the same PR and confirm the fixed Pages site updates.
13. Confirm a failed PR build does not replace the last successful Pages site.
14. Merge the test PR and confirm the Azure workflow completes post-merge verification/build but pauses before Azure deployment.
15. Confirm the pending deployment is visibly waiting on the `production` environment.
16. Approve the production deployment in GitHub and confirm the existing Azure production URL updates successfully.
17. Create a newer `main` candidate while an older one is pending in a controlled test if practical, and confirm the older production run is cancelled rather than remaining approvable.
18. Confirm Azure no longer creates PR preview environments.

## Out of Scope

This change does not introduce:

- a second Firebase project;
- a separate test Firestore database;
- automatic Firestore Security Rules deployment;
- automatic merge after Pages validation;
- GitHub Pages access control or private staging;
- a replacement for the local Azure emergency deployment script.
