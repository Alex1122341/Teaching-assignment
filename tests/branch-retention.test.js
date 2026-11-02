'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const moduleReady = import('../tools/maintenance/prune-merged-branches.mjs');
const REPO = 'UCVM-Teaching-Assignment/Teaching-assignment';
const b = (name, sha = name, protectedBranch = false) =>
  ({name, commit: {sha}, protected: protectedBranch});
const merged = (name, sha, timestamp, base = 'main', fromRepo = REPO) => ({
  state: 'closed', merged_at: timestamp, base: {ref: base, repo: {full_name: REPO}},
  head: {ref: name, sha, repo: {full_name: fromRepo}}
});
const open = name => ({state: 'open', head: {ref: name, repo: {full_name: REPO}}});

test('branch policy: total cap includes main, does not delete when at most ten exist', async () => {
  const {planBranchCleanup, BRANCH_LIMIT} = await moduleReady;
  assert.equal(BRANCH_LIMIT, 10);
  const branches = [b('main'), ...Array.from({length: 9}, (_, i) => b('feat-' + i))];
  const plan = planBranchCleanup({branches, openPulls: [], closedByBranch: {}});
  assert.equal(plan.total, 10);
  assert.equal(plan.toDelete.length, 0);
  assert.equal(plan.achievable, true);
});

test('branch policy: remove only oldest merged PR head and preserve nine latest refs', async () => {
  const {planBranchCleanup} = await moduleReady;
  const branches = [b('main')];
  const closedByBranch = {};
  for (let i = 1; i <= 11; i++) {
    const name = 'feat/' + i, sha = 'sha-' + i;
    branches.push(b(name, sha));
    closedByBranch[name] = [merged(name, sha, '2026-10-' +
      String(i).padStart(2, '0') + 'T08:00:00Z')];
  }
  const plan = planBranchCleanup({branches, openPulls: [], closedByBranch});
  assert.equal(plan.total, 12);
  assert.deepEqual(plan.toDelete.map(x => x.name), ['feat/1', 'feat/2']);
  assert.equal(plan.projectedRemaining, 10);
  assert.equal(plan.achievable, true);
});

test('branch policy: open PRs and protected branches are never eligible', async () => {
  const {planBranchCleanup, reservedName} = await moduleReady;
  const branches = [b('main'), b('feat/open'), b('feat/protected','p',true),
    b('release/v1'), b('backup/restore'), b('feat/eligible','e')];
  const closedByBranch = {
    'feat/open': [merged('feat/open','feat/open','2026-10-01T10:00:00Z')],
    'feat/protected': [merged('feat/protected','p','2026-10-01T10:00:00Z')],
    'feat/eligible': [merged('feat/eligible','e','2026-10-01T10:00:00Z')],
    'release/v1': [merged('release/v1','release/v1','2026-10-01T10:00:00Z')]
  };
  const plan = planBranchCleanup({branches, openPulls: [open('feat/open')],
    closedByBranch, limit: 3});
  assert.deepEqual(plan.toDelete.map(x => x.name), ['feat/eligible']);
  assert.equal(plan.achievable, false);
  assert.equal(reservedName('main','main'), true);
  assert.equal(reservedName('hotfix/critical','main'), true);
  assert.equal(reservedName('feat/task','main'), false);
});

test('branch policy: moved branch tips, unmerged work and PR to another base are retained', async () => {
  const {planBranchCleanup} = await moduleReady;
  const branches = [b('main'), b('feat/moved', 'new-sha'),
    b('feat/unmerged'), b('feat/other-base'), b('feat/no-pr')];
  const closedByBranch = {
    'feat/moved': [merged('feat/moved','old-sha','2026-10-01T10:00:00Z')],
    'feat/unmerged': [{...merged('feat/unmerged','feat/unmerged',
      '2026-10-01T10:00:00Z'), merged_at: null}],
    'feat/other-base': [merged('feat/other-base','feat/other-base',
      '2026-10-01T10:00:00Z', 'develop')]
  };
  const plan = planBranchCleanup({branches, openPulls: [], closedByBranch, limit: 1});
  assert.deepEqual(plan.toDelete, []);
  assert.equal(plan.projectedRemaining, 5);
  assert.equal(plan.achievable, false);
});

test('branch policy: forks and unrelated repository PR evidence cannot authorize deletion', async () => {
  const {planBranchCleanup} = await moduleReady;
  const branches = [b('main'), b('feat/1')];
  const closedByBranch = {
    'feat/1': [merged('feat/1','feat/1','2026-10-01T10:00:00Z',
      'main','outside/other-repo')]
  };
  const plan = planBranchCleanup({branches, openPulls: [], closedByBranch, limit: 1});
  assert.equal(plan.toDelete.length, 0);
});

test('branch policy: malformed records fail closed rather than selecting unknown SHA', async () => {
  const {planBranchCleanup} = await moduleReady;
  assert.throws(() => planBranchCleanup({branches: [b('main'), {name: 'unknown'}],
    openPulls: [], closedByBranch: {}}), /SHA/);
  assert.throws(() => planBranchCleanup({branches: null, openPulls: [],
    closedByBranch: {}}), /arrays/);
});
