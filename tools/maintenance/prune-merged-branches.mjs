/**
 * PAWS Testing: keep up to ten branches, including main.
 * Only verified merged-PR heads may be removed. Never delete active work.
 */
import fs from 'node:fs';

export const BRANCH_LIMIT = 10;
export const REPOSITORY = 'UCVM-Teaching-Assignment/Teaching-assignment';

export function reservedName(name, main) {
  return name === main
    || ['main', 'master', 'develop', 'development', 'production'].includes(name)
    || /^(?:release|hotfix|stable|archive|backup)\//i.test(name);
}

export function planBranchCleanup({
  branches, openPulls, closedByBranch, repository = REPOSITORY,
  defaultBranch = 'main', limit = BRANCH_LIMIT
}) {
  if (!Array.isArray(branches) || !Array.isArray(openPulls)) {
    throw new TypeError('Branch and open PR lists must be arrays.');
  }
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Invalid branch limit.');
  const openHeads = new Set(openPulls
    .filter(pr => pr?.head?.repo?.full_name === repository)
    .map(pr => pr.head.ref));
  const candidates = [], retained = [];
  for (const branch of branches) {
    const name = branch.name, sha = branch.commit?.sha;
    if (!name || !sha) throw new Error('Branch missing a name or SHA');
    if (branch.protected || reservedName(name, defaultBranch)) {
      retained.push({name, reason: 'protected-or-reserved'});
      continue;
    }
    if (openHeads.has(name)) {
      retained.push({name, reason: 'open-pr'});
      continue;
    }
    const matches = (closedByBranch?.[name] || []).filter(pr =>
      pr.merged_at
      && pr.base?.ref === defaultBranch
      && pr.base?.repo?.full_name === repository
      && pr.head?.repo?.full_name === repository
      && pr.head?.ref === name
      && pr.head?.sha === sha
    );
    if (!matches.length) {
      retained.push({name, reason: 'no-merged-main-pr-with-matching-tip'});
      continue;
    }
    candidates.push({name, sha, mergedAt: matches.map(pr => pr.merged_at).sort().at(-1)});
  }
  candidates.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt) || a.name.localeCompare(b.name));
  const overLimit = Math.max(0, branches.length - limit);
  const toDelete = candidates.slice(0, overLimit);
  return {
    limit, total: branches.length, overLimit, toDelete,
    keepMerged: candidates.slice(overLimit), retained,
    projectedRemaining: branches.length - toDelete.length,
    achievable: branches.length - toDelete.length <= limit
  };
}

function encodeBranch(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

async function run() {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY) {
    throw new Error('Refusing to change branches outside ' + REPOSITORY);
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const dryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
  const root = '/repos/' + REPOSITORY;
  async function api(path, method = 'GET') {
    const res = await fetch('https://api.github.com' + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'paws-testing-branch-retention'
      },
      signal: AbortSignal.timeout(20000)
    });
    const body = await res.text();
    if (!res.ok) throw new Error('GitHub ' + method + ' ' + path +
      ' returned HTTP ' + res.status + ': ' + body.slice(0, 250));
    return body ? JSON.parse(body) : null;
  }
  async function listPaged(path) {
    const out = [];
    for (let page = 1; page <= 100; page++) {
      const rows = await api(path + (path.includes('?') ? '&' : '?') +
        'per_page=100&page=' + page);
      if (!Array.isArray(rows)) throw new Error('GitHub API did not return a list');
      out.push(...rows);
      if (rows.length < 100) return out;
    }
    throw new Error('Incomplete pagination; no branches have been deleted');
  }

  const repo = await api(root);
  if (repo.default_branch !== 'main') throw new Error('Unexpected default branch');
  const branches = await listPaged(root + '/branches');
  console.log('Branch count: ' + branches.length + '/' + BRANCH_LIMIT +
    ' (main included); dryRun=' + dryRun);
  if (branches.length <= BRANCH_LIMIT) {
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      '### PAWS Testing branch retention\n\nWithin limit: ' +
      branches.length + '/' + BRANCH_LIMIT + ' branches. No deletion.\n'
    );
    return;
  }
  const openPulls = await listPaged(root + '/pulls?state=open');
  const openHeads = new Set(openPulls
    .filter(pr => pr.head?.repo?.full_name === REPOSITORY).map(pr => pr.head.ref));
  const closedByBranch = {};
  for (const b of branches) {
    if (b.protected || reservedName(b.name, repo.default_branch) || openHeads.has(b.name)) continue;
    closedByBranch[b.name] = await listPaged(root + '/pulls?state=closed&head=' +
      encodeURIComponent(REPOSITORY.split('/')[0] + ':' + b.name));
  }
  const plan = planBranchCleanup({
    branches, openPulls, closedByBranch, defaultBranch: repo.default_branch
  });
  for (const b of plan.toDelete) {
    console.log((dryRun ? 'WOULD DELETE: ' : 'ELIGIBLE: ') +
      b.name + ' @ ' + b.sha + '; merged: ' + b.mergedAt);
  }
  const deleted = [], skipped = [];
  if (!dryRun) for (const b of plan.toDelete) {
    const encoded = encodeBranch(b.name);
    // Re-read current tip and open PRs immediately before deletion.
    const fresh = await api(root + '/branches/' + encoded);
    const livePulls = await listPaged(root + '/pulls?state=open');
    const isOpen = livePulls.some(pr =>
      pr.head?.repo?.full_name === REPOSITORY && pr.head?.ref === b.name);
    if (fresh.protected || reservedName(fresh.name, repo.default_branch)
        || fresh.commit?.sha !== b.sha || isOpen) {
      console.warn('::warning::Retaining moved or active branch ' + b.name);
      skipped.push(b.name);
      continue;
    }
    const merged = await listPaged(root + '/pulls?state=closed&head=' +
      encodeURIComponent(REPOSITORY.split('/')[0] + ':' + b.name));
    if (!merged.some(pr => pr.merged_at && pr.base?.ref === repo.default_branch &&
      pr.base?.repo?.full_name === REPOSITORY &&
      pr.head?.repo?.full_name === REPOSITORY &&
      pr.head?.ref === b.name && pr.head?.sha === b.sha)) {
      console.warn('::warning::Merged PR evidence changed: ' + b.name);
      skipped.push(b.name);
      continue;
    }
    await api(root + '/git/refs/heads/' + encoded, 'DELETE');
    deleted.push(b.name);
    console.log('DELETED: ' + b.name);
  }
  const remaining = dryRun ? plan.projectedRemaining : branches.length - deleted.length;
  const summary = [
    '### PAWS Testing branch retention', '',
    '- Cap: 10 total (main + up to 9 other branches)',
    '- Count before: ' + branches.length,
    '- ' + (dryRun ? 'Planned removals: ' : 'Removed: ') +
      (dryRun ? plan.toDelete.length : deleted.length),
    '- ' + (dryRun ? 'Projected after: ' : 'Count after: ') + remaining,
    '- Open PR, unmerged, protected, release/hotfix/backup branches are retained.',
    '- Dry run: ' + dryRun, ''
  ];
  if (plan.toDelete.length) {
    summary.push('Oldest eligible merged branches:');
    for (const b of plan.toDelete) summary.push('- ' + b.name + ' (' + b.mergedAt + ')');
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n'
  );
  console.log(summary.join('\n'));
  if (skipped.length || remaining > BRANCH_LIMIT) {
    throw new Error('Branch cap cannot be reached safely: ' + remaining +
      ' branches remain; active/unmerged/protected branches need manual review.');
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  run().catch(error => {
    console.error('::error::' + error.message);
    process.exitCode = 1;
  });
}
