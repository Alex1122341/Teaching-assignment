# Azure PR Preview Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Azure Static Web Apps the routine web host, automatically create one temporary Azure preview environment per same-repository pull request to `main`, deploy `main` to the existing production Azure Static Web App, and keep Firebase only for Authentication, Firestore, rules, and emulator testing.

**Architecture:** Keep the existing static allowlist/build pipeline (`tools/static-assets.json` + `tools/build-static.js`) and add a dedicated GitHub Actions deployment workflow. The workflow independently runs the same static/unit and Firebase emulator checks as CI, copies one committed `staticwebapp.config.json` into `.deploy-static`, then deploys that prebuilt directory with the official Azure Static Web Apps action pinned to an exact reviewed commit. Pull-request close events run Azure's `action: close` cleanup, while the existing local PowerShell script remains a manual fallback and consumes the same committed Azure config.

**Tech Stack:** GitHub Actions, Node.js 22, Java 21, Firebase CLI/emulators, Azure Static Web Apps, PowerShell, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-15-azure-pr-preview-deployment-design.md`

## Global Constraints

- Azure Static Web Apps becomes the only routine web host; Firebase Hosting is not part of the normal deployment path.
- Firebase project `tester-teaching` remains the backend for Authentication, Firestore, and Firestore Security Rules.
- Same-repository pull requests targeting `main` receive temporary Azure PR preview environments; forked pull requests must not receive repository secrets or deploy previews.
- Pushes to `main` deploy the existing Azure production Static Web App.
- `firestore.rules` deployment remains manual and is not added to GitHub Actions in this change.
- Keep `.github/workflows/test.yml` as the existing CI workflow.
- Keep `tools/deploy_azure_static_web.ps1` as an emergency/manual fallback.
- Use regular `pull_request`, never `pull_request_target`, for preview deployments.
- Use repository secret name `AZURE_STATIC_WEB_APPS_API_TOKEN`; never commit the deployment token, ARM token, or Azure access token.
- Pin `Azure/static-web-apps-deploy` to reviewed commit `4d27395796ac319302594769cfe812bd207490b1` rather than a floating tag/branch.
- Azure preview and production deployments continue to use the same Firebase backend; a preview URL is not a security boundary.

---

### Task 1: Make Azure routing configuration canonical and keep the local fallback aligned

**Files:**
- Create: `staticwebapp.config.json`
- Modify: `tools/deploy_azure_static_web.ps1`
- Create: `tests/azure-deployment.test.js`

**Interfaces:**
- Consumes: `tools/build-static.js`, which writes the allowlisted frontend bundle to `.deploy-static` and rejects any alternate output directory.
- Produces: root `staticwebapp.config.json` as the single Azure routing source; the local PowerShell fallback copies it to `.deploy-static/staticwebapp.config.json` after the shared static build.

- [ ] **Step 1: Write the failing regression tests for canonical Azure config and local fallback behavior**

Create `tests/azure-deployment.test.js` with the first tests:

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('Azure Static Web Apps routing config is committed at repository root',()=>{
  const config=JSON.parse(read('staticwebapp.config.json'));
  assert.deepEqual(config.routes,[{
    route:'/faculty-dashboard.html',
    redirect:'/index.html',
    statusCode:301
  }]);
});

test('manual Azure fallback copies the canonical config instead of generating a second copy',()=>{
  const script=read('tools/deploy_azure_static_web.ps1');
  assert.match(script,/Join-Path \$SitePath 'staticwebapp\.config\.json'/);
  assert.match(script,/Copy-Item .*staticwebapp\.config\.json/);
  assert.doesNotMatch(script,/\$azureConfig\s*=\s*@\{/);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test tests/azure-deployment.test.js
```

Expected: FAIL because `staticwebapp.config.json` does not exist and the PowerShell script still builds `$azureConfig` inline.

- [ ] **Step 3: Add the canonical Azure config**

Create `staticwebapp.config.json` exactly as:

```json
{
  "routes": [
    {
      "route": "/faculty-dashboard.html",
      "redirect": "/index.html",
      "statusCode": 301
    }
  ]
}
```

Do **not** add this file to `tools/static-assets.json`; it is Azure deployment metadata, not an application asset. The deployment workflow and fallback script will copy it after `tools/build-static.js` completes.

- [ ] **Step 4: Replace inline PowerShell config generation with a canonical-file copy**

In `tools/deploy_azure_static_web.ps1`, keep the existing shared static build:

```powershell
$stagingPath = Join-Path $SitePath '.deploy-static'
$builder = Join-Path $SitePath 'tools\build-static.js'
& node $builder --output $stagingPath
if ($LASTEXITCODE -ne 0) { throw "Static asset builder exited with code $LASTEXITCODE." }
```

Replace the existing `$azureConfig = @{ ... }` / `ConvertTo-Json` block with:

```powershell
$azureConfigSource = Join-Path $SitePath 'staticwebapp.config.json'
if (-not (Test-Path -LiteralPath $azureConfigSource -PathType Leaf)) {
    throw 'staticwebapp.config.json is missing from the repository root.'
}
Copy-Item -LiteralPath $azureConfigSource -Destination (Join-Path $stagingPath 'staticwebapp.config.json') -Force
if ($BuildOnly) { return }
```

Leave the existing Azure device authorization, deployment-token retrieval, and StaticSitesClient upload path unchanged.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/azure-deployment.test.js
```

Expected: both Task 1 tests PASS.

- [ ] **Step 6: Run the shared static build and inspect the staged Azure config**

Run:

```bash
node tools/build-static.js
cp staticwebapp.config.json .deploy-static/staticwebapp.config.json
node -e "const fs=require('node:fs'); const p=JSON.parse(fs.readFileSync('.deploy-static/staticwebapp.config.json','utf8')); if(p.routes?.[0]?.route!=='/faculty-dashboard.html') process.exit(1); console.log('Azure config staged');"
```

Expected: the static builder reports the current allowlist count (`35` at plan-writing time), then prints `Azure config staged`.

- [ ] **Step 7: Commit Task 1**

```bash
git add staticwebapp.config.json tools/deploy_azure_static_web.ps1 tests/azure-deployment.test.js
git commit -m "build: centralize Azure static web app config"
```

---

### Task 2: Add self-gating GitHub Actions deployment for PR previews and production

**Files:**
- Create: `.github/workflows/azure-static-web-apps.yml`
- Modify: `tests/azure-deployment.test.js`

**Interfaces:**
- Consumes: root `staticwebapp.config.json`; `.deploy-static` from `node tools/build-static.js`; repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN`; built-in `GITHUB_TOKEN`.
- Produces: Azure PR preview deployment on `pull_request` opened/synchronize/reopened, Azure production deployment on `push` to `main`, cleanup on `pull_request` closed, and a job-summary link from the action output `static_web_app_url`.

- [ ] **Step 1: Add failing static assertions for the deployment workflow**

Append to `tests/azure-deployment.test.js`:

```js
test('Azure deployment workflow gates uploads and separates PR preview from production',()=>{
  const workflow=read('.github/workflows/azure-static-web-apps.yml');

  assert.match(workflow,/push:\s*[\s\S]*branches:\s*\[?main\]?/);
  assert.match(workflow,/pull_request:\s*[\s\S]*opened[\s\S]*synchronize[\s\S]*reopened[\s\S]*closed/);
  assert.doesNotMatch(workflow,/pull_request_target/);

  assert.match(workflow,/npm ci/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run test:emulator/);
  assert.match(workflow,/node tools\/build-static\.js/);
  assert.match(workflow,/cp staticwebapp\.config\.json \.deploy-static\/staticwebapp\.config\.json/);

  const pinned=/Azure\/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1/g;
  assert.equal((workflow.match(pinned)||[]).length,2);
  assert.match(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(workflow,/repo_token:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow,/app_location:\s*['"]?\.deploy-static['"]?/);
  assert.match(workflow,/output_location:\s*['"]{2}/);
  assert.match(workflow,/skip_app_build:\s*true/);
  assert.match(workflow,/production_branch:\s*['"]?main['"]?/);
  assert.match(workflow,/action:\s*['"]?upload['"]?/);
  assert.match(workflow,/action:\s*['"]?close['"]?/);

  assert.match(workflow,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow,/cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(workflow,/static_web_app_url/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/azure-deployment.test.js
```

Expected: FAIL because `.github/workflows/azure-static-web-apps.yml` does not exist.

- [ ] **Step 3: Create the Azure deployment workflow**

Create `.github/workflows/azure-static-web-apps.yml` with this structure:

```yaml
name: Azure Static Web Apps

on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: [main]

permissions:
  contents: read
  pull-requests: write
  issues: write

concurrency:
  group: azure-static-web-apps-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || 'production-main' }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  build_and_deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed' && github.event.pull_request.head.repo.full_name == github.repository)
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Set up Java for Firebase emulators
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'

      - name: Install dependencies
        run: npm ci

      - name: Run static and unit tests
        run: npm test

      - name: Run Firestore and Auth emulator tests
        run: npm run test:emulator

      - name: Build static site
        run: node tools/build-static.js

      - name: Stage Azure configuration
        run: cp staticwebapp.config.json .deploy-static/staticwebapp.config.json

      - name: Deploy to Azure Static Web Apps
        id: azure-deploy
        uses: Azure/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: .deploy-static
          api_location: ''
          output_location: ''
          skip_app_build: true
          skip_api_build: true
          production_branch: main

      - name: Publish Azure URL in job summary
        run: |
          echo '### Azure Static Web Apps deployment' >> "$GITHUB_STEP_SUMMARY"
          echo '${{ steps.azure-deploy.outputs.static_web_app_url }}' >> "$GITHUB_STEP_SUMMARY"

  close_pull_request:
    if: github.event_name == 'pull_request' && github.event.action == 'closed' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Close Azure PR preview environment
        uses: Azure/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: close
```

Do not add a branch-preview trigger for arbitrary branch pushes. PR previews are created only through the `pull_request` event, so each PR gets Azure's PR-number environment and closes with the PR.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/azure-deployment.test.js
```

Expected: all Azure deployment static tests PASS.

- [ ] **Step 5: Run the full non-emulator test suite**

Run:

```bash
npm test
```

Expected: PASS with zero failing tests.

- [ ] **Step 6: Commit Task 2**

```bash
git add .github/workflows/azure-static-web-apps.yml tests/azure-deployment.test.js
git commit -m "ci: deploy Azure previews from pull requests"
```

---

### Task 3: Rewrite deployment documentation around GitHub -> Azure

**Files:**
- Modify: `SETUP.md`
- Modify: `tests/azure-deployment.test.js`

**Interfaces:**
- Consumes: workflow from Task 2 and secret name `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- Produces: operator instructions for routine PR previews/production, one-time GitHub secret setup, manual Firestore rules deployment, and emergency manual Azure fallback.

- [ ] **Step 1: Add failing documentation assertions**

Append to `tests/azure-deployment.test.js`:

```js
test('setup docs describe GitHub-to-Azure as the routine web deployment path',()=>{
  const setup=read('SETUP.md');
  assert.match(setup,/AZURE_STATIC_WEB_APPS_API_TOKEN/);
  assert.match(setup,/pull request/i);
  assert.match(setup,/preview/i);
  assert.match(setup,/push to `main`|merge.*`main`/i);
  assert.match(setup,/firestore:rules/);
  assert.match(setup,/manual fallback|emergency\/manual fallback/i);
  assert.doesNotMatch(setup,/Publish the frontend to Firebase Hosting/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/azure-deployment.test.js
```

Expected: FAIL because `SETUP.md` still documents Firebase Hosting + local PowerShell as the normal publish sequence.

- [ ] **Step 3: Update the activation/deployment section in `SETUP.md`**

Keep the existing Firebase account/data activation steps, but replace routine frontend deployment instructions with these exact operational concepts:

```markdown
## Web deployment

Azure Static Web Apps is the routine web host. Firebase remains the Authentication / Firestore backend; Firebase Hosting is not used for normal preview or production releases.

### One-time GitHub setup

Create the Actions repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN` with the deployment token for the existing Azure Static Web App `ucvm-teaching-lab-web`. Never commit the token.

### Routine pull-request flow

1. Create a feature branch and open a same-repository pull request targeting `main`.
2. The normal `Test` workflow runs.
3. The `Azure Static Web Apps` workflow independently runs `npm ci`, `npm test`, `npm run test:emulator`, and the shared static build.
4. When verification passes, Azure creates/updates the pull request's temporary preview environment and the workflow exposes the preview URL.
5. Validate the preview before merging.
6. Merging to `main` triggers a production deployment to the existing Azure Static Web App.
7. Closing/merging the pull request triggers preview cleanup.

Forked pull requests do not receive the Azure deployment secret and are not preview-deployed.

### Firestore rule changes

If a pull request changes `firestore.rules`, deploy the rules separately after review:

```bash
npx firebase deploy --project tester-teaching --only firestore:rules
```

Automatic Firestore-rule deployment is intentionally not part of the Azure workflow.

### Emergency/manual Azure fallback

`tools/deploy_azure_static_web.ps1` remains available for recovery/manual deployment. It rebuilds `.deploy-static` from the same allowlist and copies the committed `staticwebapp.config.json` before uploading.
```

Also revise the numbered `Activation order` so it no longer instructs users to publish to Firebase Hosting or run the PowerShell script for every normal frontend release. Preserve the administrator initialization and user-management steps that follow deployment.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/azure-deployment.test.js
```

Expected: all Azure deployment/documentation tests PASS.

- [ ] **Step 5: Run all static/unit tests**

Run:

```bash
npm test
```

Expected: PASS with zero failing tests.

- [ ] **Step 6: Commit Task 3**

```bash
git add SETUP.md tests/azure-deployment.test.js
git commit -m "docs: document Azure preview deployment flow"
```

---

### Task 4: Verify the complete deployment gate before opening the activation PR

**Files:**
- No new production files.
- Verify all files created/modified by Tasks 1-3.

**Interfaces:**
- Consumes: completed implementation branch with workflow/config/docs/tests.
- Produces: a branch that is locally and emulator-verified and ready for the one-time secret/real Azure preview activation checkpoint.

- [ ] **Step 1: Run full static/unit verification**

Run:

```bash
npm test
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run full Firestore/Auth emulator verification**

Run:

```bash
npm run test:emulator
```

Expected: Firebase emulators start, the complete test suite runs, and the command exits successfully with zero failures.

- [ ] **Step 3: Rebuild the exact deployable directory and stage Azure metadata**

Run:

```bash
node tools/build-static.js
cp staticwebapp.config.json .deploy-static/staticwebapp.config.json
```

Expected: `tools/build-static.js` reports a successful build from `tools/static-assets.json`; `.deploy-static/staticwebapp.config.json` exists.

- [ ] **Step 4: Verify no credentials or accidental Firebase Hosting deployment were added**

Run:

```bash
git grep -n -E 'AZURE_STATIC_WEB_APPS_API_TOKEN[^}]|DEPLOYMENT_TOKEN=|Bearer [A-Za-z0-9._-]+' -- ':!docs/superpowers/*' || true
git grep -n 'firebase deploy.*hosting' .github tools SETUP.md || true
```

Expected: no literal Azure secret/token value is present; no GitHub workflow invokes Firebase Hosting. A historical/manual reference is acceptable only if clearly documented as non-routine fallback, not as the normal path.

- [ ] **Step 5: Review the branch diff against the spec**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff main...HEAD -- .github/workflows/azure-static-web-apps.yml staticwebapp.config.json tools/deploy_azure_static_web.ps1 tests/azure-deployment.test.js SETUP.md
```

Expected: `git diff --check` exits 0; diff scope is limited to the approved deployment change plus spec/plan docs.

- [ ] **Step 6: Commit any verification-only correction if required**

If Task 4 exposes a concrete defect, fix only that defect, rerun Steps 1-5, then commit with a specific message. If there is no defect, do not create an empty commit.

---

### Task 5: Activate and prove Azure PR preview -> production end to end

**Files:**
- No additional source files unless real deployment evidence exposes a defect.
- GitHub repository setting: Actions secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.

**Interfaces:**
- Consumes: implementation branch passing Task 4; deployment token for the existing Azure Static Web App `ucvm-teaching-lab-web`.
- Produces: real Azure PR preview evidence, production deployment evidence after user-approved merge, and preview cleanup evidence.

- [ ] **Step 1: Operator creates the repository secret before opening the implementation PR**

In GitHub repository settings, create Actions repository secret:

```text
AZURE_STATIC_WEB_APPS_API_TOKEN
```

Set its value to the deployment token for the existing Azure Static Web App `ucvm-teaching-lab-web`. Do not paste the token into chat, commit history, PR text, issue comments, or workflow logs.

- [ ] **Step 2: Open a pull request targeting `main`**

The PR should include the approved spec, this plan, workflow/config/script/tests/docs implementation, and no unrelated code changes.

Expected: both `Test` and `Azure Static Web Apps` workflows start. The Azure deployment job runs only for this same-repository PR.

- [ ] **Step 3: Verify GitHub workflow results**

Expected:

- existing `Test` workflow: success;
- Azure workflow static/unit step: success;
- Azure workflow Firestore/Auth emulator step: success;
- static build: success;
- Azure upload: success;
- workflow job summary contains `static_web_app_url`.

Do not merge if any required step fails.

- [ ] **Step 4: Validate the real PR preview URL**

Open the Azure preview URL and verify at minimum:

```text
Timetable loads
Firebase sign-in works
Faculty Dashboard opens
Faculty self-mode still shows only the signed-in faculty profile
Admin mode still shows the full dashboard
Firestore-backed reads succeed
/faculty-dashboard.html redirects to /index.html
```

Because preview and production use `tester-teaching`, avoid test actions that intentionally mutate production-like Firestore data unless the change itself requires that mutation.

- [ ] **Step 5: Prove synchronize updates the same PR environment**

Make one harmless documentation-only commit on the same PR (for example, a wording correction that is genuinely needed; do not create meaningless production churn solely for this check) or use a required code correction if one exists.

Expected: the PR `synchronize` event reruns verification and updates the same PR-number preview environment rather than creating a permanent branch environment.

If no legitimate follow-up commit exists, document this check as deferred rather than adding noise solely to force an event.

- [ ] **Step 6: Merge only after the user approves the preview**

Expected after merge:

- push-to-`main` `Test` workflow succeeds;
- push-to-`main` Azure workflow independently verifies/builds and deploys the production environment;
- production URL remains the existing Azure Static Web Apps URL;
- Firebase Hosting is not invoked.

- [ ] **Step 7: Verify preview cleanup**

Expected: the pull-request `closed` event runs `close_pull_request`, Azure removes the PR preview environment, and the production environment remains available.

- [ ] **Step 8: Record final deployment evidence in the PR**

Add a concise PR comment containing only non-secret evidence:

```text
Azure PR preview: verified
Test workflow: passed
Azure deploy workflow: passed
Production Azure deployment after merge: verified
PR preview cleanup: verified
Firestore rules: unchanged / deployed manually as applicable
```

Do not include deployment tokens or authentication material.
