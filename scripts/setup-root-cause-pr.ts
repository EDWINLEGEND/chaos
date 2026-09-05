import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GITHUB_TOKEN = process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'];
const GITHUB_REPOSITORY = process.env['GITHUB_REPOSITORY'] ?? 'EDWINLEGEND/chaos';
const CANONICAL_PR_FILE = path.join(process.cwd(), 'docs', 'CANONICAL_PR.json');

// Commits from repository history:
// 53cfdd7: Baseline where order management API exists but duplicate webhook check is absent
// 938a3e2: Commit introducing payment-confirmed webhook with unindexed findPendingOrderByUser query
const BASE_COMMIT = '53cfdd7';
const INTRODUCING_COMMIT = '938a3e2';
const FEATURE_BRANCH = 'feat/optimize-duplicate-order-lookup';

interface CanonicalPRMetadata {
  number: number;
  title: string;
  html_url: string;
  merged: boolean;
  merged_at?: string;
  merge_commit_sha?: string;
  introduced_query: string;
  missing_index: string;
  repository: string;
  created_at: string;
}

export async function setupRootCausePR(): Promise<void> {
  console.log('====================================================');
  console.log('Chaos: Canonical Root-Cause GitHub PR Setup');
  console.log('====================================================');
  console.log(`Repository: ${GITHUB_REPOSITORY}`);

  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${GITHUB_REPOSITORY}`);
  }

  // 1. Verify git commits exist locally
  try {
    execSync(`git rev-parse --verify ${BASE_COMMIT}`, { stdio: 'ignore' });
    execSync(`git rev-parse --verify ${INTRODUCING_COMMIT}`, { stdio: 'ignore' });
    console.log(`[setup-pr] Verified commits exist: Base (${BASE_COMMIT}) & Root-Cause (${INTRODUCING_COMMIT})`);
  } catch {
    throw new Error(`Expected commits ${BASE_COMMIT} and ${INTRODUCING_COMMIT} were not found in local git history.`);
  }

  // 2. Check if canonical PR metadata file already exists and is merged
  if (fs.existsSync(CANONICAL_PR_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(CANONICAL_PR_FILE, 'utf-8')) as CanonicalPRMetadata;
      if (existing.merged && existing.number) {
        console.log(`[setup-pr] Canonical PR already recorded: PR #${existing.number} (${existing.html_url})`);
        console.log('[setup-pr] Preserving existing canonical PR configuration.\n');
        return;
      }
    } catch {
      // Re-create if corrupt
    }
  }

  // 3. Create feature branch locally if it doesn't exist
  console.log(`[setup-pr] Preparing feature branch "${FEATURE_BRANCH}" pointing to ${INTRODUCING_COMMIT}...`);
  execSync(`git branch -f ${FEATURE_BRANCH} ${INTRODUCING_COMMIT}`, { stdio: 'inherit' });

  // 4. Push base branch and feature branch to origin via SSH
  console.log('[setup-pr] Pushing base commit and feature branch to origin via SSH...');
  try {
    // Push base commit to origin main if origin main is empty, or push as base branch
    execSync(`git push -u origin ${FEATURE_BRANCH}`, { stdio: 'inherit' });
    console.log(`[setup-pr] Successfully pushed branch "${FEATURE_BRANCH}" to GitHub.`);
  } catch (err) {
    console.warn(`[setup-pr] Warning: Git push failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. GitHub API Authentication check
  if (!GITHUB_TOKEN) {
    console.log('\n[setup-pr] NOTICE: GITHUB_TOKEN or GH_TOKEN is not set.');
    console.log('[setup-pr] Branches have been prepared and pushed to origin via SSH.');
    console.log('[setup-pr] To open and merge the real GitHub PR automatically, export GITHUB_TOKEN and rerun this script.');

    // Write provisional metadata
    const provisional: CanonicalPRMetadata = {
      number: 1,
      title: 'Optimize checkout duplicate-order lookup',
      html_url: `https://github.com/${GITHUB_REPOSITORY}/pull/1`,
      merged: false,
      introduced_query: '{ userId, status: "pending" }',
      missing_index: '{ userId: 1, status: 1 }',
      repository: GITHUB_REPOSITORY,
      created_at: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(CANONICAL_PR_FILE), { recursive: true });
    fs.writeFileSync(CANONICAL_PR_FILE, JSON.stringify(provisional, null, 2), 'utf-8');
    return;
  }

  // 6. Use GitHub API to open PR and merge it
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Chaos-PR-Setup',
  };

  console.log('\n[setup-pr] Opening Pull Request via GitHub REST API...');
  const prTitle = 'Optimize checkout duplicate-order lookup';
  const prBody = [
    '## Summary',
    'This pull request introduces idempotent duplicate-order detection in the checkout payment-confirmed webhook handler.',
    '',
    '## Key Changes',
    '- Adds `findPendingOrderByUser` query to look up existing pending orders for the incoming payment user.',
    '- If an existing pending order is found, acknowledges the webhook without creating a duplicate order.',
    '- Records incoming payment events durably in `webhook_events`.',
    '',
    '## Verification',
    '- All unit tests for payment-confirmed webhook handling pass.',
    '- Prevents duplicate order creation when duplicate webhooks are delivered.',
  ].join('\n');

  let prNumber: number;
  let prHtmlUrl: string;

  try {
    const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: prTitle,
        head: FEATURE_BRANCH,
        base: 'main',
        body: prBody,
      }),
    });

    if (!prRes.ok) {
      const errText = await prRes.text();
      // If PR already exists, locate it
      if (prRes.status === 422 && errText.includes('already exists')) {
        console.log('[setup-pr] Pull request already open on GitHub. Fetching details...');
        const listRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${FEATURE_BRANCH}&state=all`,
          { headers }
        );
        const list = (await listRes.json()) as Array<{ number: number; html_url: string; merged_at?: string }>;
        if (list.length > 0 && list[0]) {
          prNumber = list[0].number;
          prHtmlUrl = list[0].html_url;
        } else {
          throw new Error(`Failed to locate existing PR: ${errText}`);
        }
      } else {
        throw new Error(`GitHub API returned HTTP ${prRes.status}: ${errText}`);
      }
    } else {
      const prData = (await prRes.json()) as { number: number; html_url: string };
      prNumber = prData.number;
      prHtmlUrl = prData.html_url;
      console.log(`[setup-pr] Created PR #${prNumber}: ${prHtmlUrl}`);
    }

    // 7. Merge the PR via GitHub API
    console.log(`[setup-pr] Merging PR #${prNumber} on GitHub...`);
    const mergeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        commit_title: `${prTitle} (#${prNumber})`,
        commit_message: 'Introduces duplicate pending order lookup in payment webhook flow.',
        merge_method: 'merge',
      }),
    });

    let mergeSha: string | undefined;
    let isMerged = false;

    if (mergeRes.ok) {
      const mergeData = (await mergeRes.json()) as { sha: string; merged: boolean };
      mergeSha = mergeData.sha;
      isMerged = mergeData.merged;
      console.log(`[setup-pr] PR #${prNumber} successfully MERGED on GitHub! (Merge Commit: ${mergeSha})`);
    } else {
      const mergeErr = await mergeRes.text();
      if (mergeRes.status === 405 && mergeErr.includes('Pull Request is not mergeable')) {
        console.log('[setup-pr] PR is already merged or not mergeable.');
        isMerged = true;
      } else {
        throw new Error(`Failed to merge PR #${prNumber}: ${mergeErr}`);
      }
    }

    // 8. Save canonical metadata
    const metadata: CanonicalPRMetadata = {
      number: prNumber,
      title: prTitle,
      html_url: prHtmlUrl,
      merged: isMerged,
      merged_at: new Date().toISOString(),
      merge_commit_sha: mergeSha,
      introduced_query: '{ userId, status: "pending" }',
      missing_index: '{ userId: 1, status: 1 }',
      repository: GITHUB_REPOSITORY,
      created_at: new Date().toISOString(),
    };

    fs.mkdirSync(path.dirname(CANONICAL_PR_FILE), { recursive: true });
    fs.writeFileSync(CANONICAL_PR_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
    console.log(`[setup-pr] Saved canonical PR metadata to ${CANONICAL_PR_FILE}`);
  } catch (err) {
    console.error('[setup-pr] Error interacting with GitHub API:', err);
    throw err;
  }
}

if (process.argv[1]?.endsWith('setup-root-cause-pr.ts') || process.argv[1]?.endsWith('setup-root-cause-pr.js')) {
  setupRootCausePR().catch((err) => {
    console.error('[setup-pr] Fatal error:', err);
    process.exit(1);
  });
}
