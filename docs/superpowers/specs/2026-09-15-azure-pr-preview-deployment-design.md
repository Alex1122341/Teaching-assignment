# Azure PR Preview Deployment Design

Date: 2026-09-15
Status: Approved in chat; pending written-spec review

## Goal

Move web hosting/deployment away from Firebase Hosting and make Azure Static Web Apps the only web host for this project. GitHub Actions should automatically create a temporary Azure preview environment for every pull request targeting `main`, then deploy the merged result to the production Azure Static Web App when `main` is updated.

Firebase remains the backend for Authentication, Firestore, and Firestore Security Rules.

## Current State

The repository currently has:

- `.github/workflows/test.yml`, which runs static/unit tests plus Firestore/Auth emulator tests on pull requests and pushes to `main`.
- `tools/build-static.js`, which builds the deployable static site into `.deploy-static`.
- `tools/deploy_azure_static_web.ps1`, which manually builds `.deploy-static`, obtains an Azure deployment token, and uploads the site to the existing Azure Static Web App.
- Firebase Hosting configuration, which has been used as a manual test host.

The production Azure Static Web App is the existing `ucvm-teaching-lab-web` resource. The current Azure production URL remains unchanged.

## Chosen Architecture

Use Azure Static Web Apps' native GitHub pull-request preview environments.

Flow:

```text
feature branch
    -> pull request targeting main
    -> existing Test workflow runs
    -> Azure deployment workflow runs its own deploy-gating verification
    -> build .deploy-static
    -> deploy temporary Azure PR environment
    -> user validates Preview URL
    -> merge PR
    -> push to main
    -> verify + build again
    -> deploy production Azure environment
    -> PR preview environment is closed/removed
```

Azure preview environments are temporary and are associated with the pull request. Each PR keeps the same preview URL while it remains open. Closing or merging the PR triggers cleanup.

## Workflow Structure

Add a dedicated workflow:

```text
.github/workflows/azure-static-web-apps.yml
```

It will trigger on:

```yaml
push:
  branches: [main]

pull_request:
  types: [opened, synchronize, reopened, closed]
  branches: [main]
```

The existing `.github/workflows/test.yml` remains in place as the normal CI signal.

The Azure deployment workflow will also run the same verification commands before an upload. This intentionally duplicates a small amount of CI work so deployment is self-gating and does not rely on branch-protection settings or fragile cross-workflow status plumbing.

Deploy-gating verification:

1. Check out the exact commit being deployed.
2. Set up Node.js 22.
3. Set up Java 21 for Firebase emulators.
4. Run `npm ci`.
5. Run `npm test`.
6. Run `npm run test:emulator`.
7. Run `node tools/build-static.js`.
8. Prepare Azure Static Web Apps configuration in `.deploy-static`.
9. Upload the prebuilt `.deploy-static` directory.

The deployment job runs only after all verification/build steps succeed.

## Azure Static Web Apps Deployment

Use the official `Azure/static-web-apps-deploy` GitHub Action, pinned to a reviewed commit rather than a floating mutable tag.

For upload jobs:

- `production_branch` is `main`.
- `app_location` is the prebuilt `.deploy-static` directory.
- App build is skipped inside the Azure action because `tools/build-static.js` already produced the artifact.
- No Azure Functions API is deployed.
- `repo_token` uses GitHub's built-in `GITHUB_TOKEN` for PR integration.
- `azure_static_web_apps_api_token` comes from a GitHub Actions repository secret.

For a pull request `closed` event, run a separate cleanup job using Azure's `action: close` behavior.

## Repository Secret

Create one Actions repository secret:

```text
AZURE_STATIC_WEB_APPS_API_TOKEN
```

The value is the deployment token for the existing Azure Static Web App.

Do not commit the deployment token, Azure access token, or ARM token to the repository.

The workflow must not use `pull_request_target` to deploy pull-request code. Regular `pull_request` events are used instead.

For forked pull requests, secrets are not available. The deployment job should explicitly skip preview deployment when the PR head repository is not the same repository. Same-repository PRs continue to receive previews.

## Permissions

Use least-privilege GitHub Actions permissions needed for deployment integration:

```yaml
contents: read
pull-requests: write
issues: write
```

No GitHub personal access token is required.

## Azure Configuration File

The current local PowerShell deployment script writes Azure Static Web Apps configuration into `.deploy-static` after the static build, including the legacy redirect:

```text
/faculty-dashboard.html -> /index.html
```

Move that Azure configuration to one committed source file:

```text
staticwebapp.config.json
```

Both GitHub Actions and the manual PowerShell fallback will copy this file into `.deploy-static` after `tools/build-static.js` runs.

This avoids maintaining the Azure routing configuration in two different places.

## Manual Deployment Fallback

Keep:

```text
tools/deploy_azure_static_web.ps1
```

It remains an emergency/manual fallback.

Update it to consume the committed `staticwebapp.config.json` instead of generating the configuration inline. It should continue to:

- build `.deploy-static`;
- copy the Azure config into the staging directory;
- authenticate through the existing Azure device flow;
- upload with the installed Static Web Apps deployment client.

Normal development should no longer require this script.

## Firebase Responsibilities After This Change

Firebase continues to provide:

- Firebase Authentication;
- Firestore;
- Firestore Security Rules;
- Firestore/Auth emulator tests.

Firebase Hosting is no longer part of the normal deployment flow.

Do not remove `firebase.json` or Firebase CLI support because Firestore rules still need to be deployed.

For now, Firestore rules deployment remains manual when a PR changes `firestore.rules`:

```text
npx firebase deploy --project tester-teaching --only firestore:rules
```

Automatic Firestore-rule deployment is explicitly out of scope for this change.

## Preview and Production Backend

Azure PR previews and Azure production continue to use the same Firebase project configuration currently embedded in the application (`tester-teaching`). This change separates web hosting environments, not backend data environments.

Consequences:

- Authentication behavior should match production.
- Preview pages can read/write the same backend data according to the signed-in user's Firestore permissions.
- Testing actions that mutate application data should continue to be done deliberately.

Creating a separate Firebase backend for previews is out of scope and can be designed later if needed.

## Preview Privacy

Azure Static Web Apps preview URLs are externally reachable URLs. Application data remains protected by the existing Firebase Authentication and Firestore rules, but the existence of a preview URL itself is not a security boundary.

Do not put secrets, credentials, or private source data into static files merely because they are deployed only to a PR preview.

## Production Behavior

A successful push to `main` deploys to the existing Azure production environment.

No manual Firebase Hosting deploy and no local Azure PowerShell deploy should be required for routine releases.

Expected routine workflow:

```text
create branch -> PR -> CI -> Azure Preview URL -> user validation -> merge -> Azure production
```

## Failure Behavior

If static/unit tests fail, emulator tests fail, the static build fails, or Azure upload fails:

- the deployment workflow is marked failed;
- the new preview/production version is not considered successfully deployed;
- the previous Azure production deployment remains the rollback reference;
- the PR should not be merged until the problem is understood.

A failed preview deployment must not trigger production deployment.

## Concurrency

Use workflow concurrency so rapid pushes to the same PR cancel superseded preview deployment runs. Production deployment runs for `main` must not be cancelled by unrelated PR activity.

The concurrency key should distinguish PR number from the production branch.

## Files Expected to Change During Implementation

Primary files:

```text
.github/workflows/azure-static-web-apps.yml   # new
staticwebapp.config.json                     # new canonical Azure config
tools/deploy_azure_static_web.ps1            # consume canonical config
tests/...                                    # workflow/config regression tests as appropriate
SETUP.md or deployment documentation         # document new routine deployment flow
```

`.github/workflows/test.yml` should retain its existing pull-request and `main` test coverage unless implementation reveals a concrete reason to adjust it.

## Verification Plan

Before enabling this as the routine deployment path:

1. Static/unit tests pass.
2. Firestore/Auth emulator tests pass.
3. Static build succeeds and produces the expected site files.
4. Azure configuration is present in `.deploy-static`.
5. Open a test PR and verify an Azure preview environment is created.
6. Confirm the preview URL loads the timetable and Faculty Dashboard correctly.
7. Confirm Firebase login and Firestore reads still work from the Azure preview origin.
8. Push another commit to the same PR and confirm the same preview environment updates.
9. Merge the PR and confirm `main` deploys to the existing production Azure URL.
10. Confirm the PR preview environment is cleaned up after close/merge.
11. Confirm the local PowerShell script still works as a manual fallback.

## Out of Scope

This change does not:

- create a second Firebase project;
- automatically deploy Firestore rules;
- remove Firebase Hosting configuration as an emergency fallback;
- change application authentication or Firestore authorization logic;
- create branch-based permanent Azure test environments;
- change the production Azure Static Web App resource.

## Success Criteria

The change is successful when routine development no longer requires downloading a ZIP or manually running Firebase Hosting/Azure deployment commands, every same-repository PR to `main` receives a temporary Azure preview environment after verification passes, merging to `main` automatically deploys production, and the existing manual Azure script remains available for recovery.
