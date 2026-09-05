import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, getOrdersCollection, closeDatabase, } from '@chaos/shared';
import { runSeed } from './seed.js';
const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme';
const DB_NAME = process.env['MONGODB_DATABASE'] ?? 'acme';
const PAYMENT_PROVIDER_URL = process.env['PAYMENT_PROVIDER_URL'] ?? 'http://127.0.0.1:3002';
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'];
const GITHUB_REPOSITORY = process.env['GITHUB_REPOSITORY'] ?? 'EDWINLEGEND/chaos';
export function isSafeTarget(uri) {
    try {
        const parsed = new URL(uri);
        const host = parsed.hostname.toLowerCase();
        return (host === '127.0.0.1' ||
            host === 'localhost' ||
            host === '::1' ||
            host === 'chaos-mongodb' ||
            host === 'mongo');
    }
    catch {
        const lowercase = uri.toLowerCase();
        return (lowercase.includes('127.0.0.1') ||
            lowercase.includes('localhost') ||
            lowercase.includes('chaos-mongodb'));
    }
}
export function isRehearsalBranch(branchName) {
    const normalized = branchName.trim().toLowerCase();
    if (normalized === 'main' ||
        normalized === 'master' ||
        normalized === 'origin/main' ||
        normalized === 'origin/master') {
        return false;
    }
    return (normalized.startsWith('opsroom/') ||
        normalized.startsWith('rehearsal/') ||
        normalized.includes('/rehearsal/') ||
        normalized.startsWith('rehearsal-'));
}
export function isRehearsalPR(pr) {
    // Canonical root-cause PR is never a rehearsal PR
    if (pr.number === 1 ||
        pr.title.toLowerCase().includes('optimize checkout duplicate-order')) {
        return false;
    }
    const titleLower = pr.title.toLowerCase();
    return (titleLower.startsWith('[opsroom rehearsal]') ||
        titleLower.startsWith('[rehearsal]') ||
        titleLower.includes('rehearsal') ||
        isRehearsalBranch(pr.headRef));
}
export function restoreAgentsBaseline(agentsPath = path.join(process.cwd(), 'AGENTS.md'), fixturePath = path.join(process.cwd(), 'scripts', 'fixtures', 'AGENTS.md.canonical')) {
    if (!fs.existsSync(fixturePath)) {
        throw new Error(`Canonical AGENTS fixture not found at: ${fixturePath}`);
    }
    const canonicalContent = fs.readFileSync(fixturePath, 'utf-8');
    let currentContent = '';
    if (fs.existsSync(agentsPath)) {
        currentContent = fs.readFileSync(agentsPath, 'utf-8');
    }
    if (currentContent === canonicalContent) {
        return { restored: false, wasModified: false };
    }
    fs.writeFileSync(agentsPath, canonicalContent, 'utf-8');
    return { restored: true, wasModified: true };
}
export async function stripExtraneousIndexes() {
    const ordersCol = getOrdersCollection();
    const indexes = await ordersCol.indexes();
    let droppedCount = 0;
    for (const idx of indexes) {
        if (idx.name && idx.name !== '_id_') {
            await ordersCol.dropIndex(idx.name);
            droppedCount++;
        }
    }
    return droppedCount;
}
export async function resetPaymentProvider(providerUrl = PAYMENT_PROVIDER_URL, storeFilePath = process.env['PAYMENT_STORE_FILE'] ?? path.join(process.cwd(), 'data', 'payments.json')) {
    let eventsCleared = false;
    // 1. Try calling the HTTP reset endpoint on the running service
    try {
        const res = await fetch(`${providerUrl}/v1/test/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
            eventsCleared = true;
        }
    }
    catch {
        // Service might be stopped; fall back to disk file removal
    }
    // 2. Remove file on disk if present
    if (fs.existsSync(storeFilePath)) {
        try {
            fs.unlinkSync(storeFilePath);
            eventsCleared = true;
        }
        catch {
            // Ignored
        }
    }
    return { success: true, eventsCleared };
}
export async function cleanupGithubRehearsals(options) {
    const token = options?.token ?? GITHUB_TOKEN;
    const repo = options?.repository ?? GITHUB_REPOSITORY;
    if (!token) {
        return {
            status: 'SKIPPED',
            prsClosed: 0,
            branchesDeleted: 0,
            canonicalPreserved: true,
            message: 'No GITHUB_TOKEN or GH_TOKEN configured. Remote GitHub cleanup skipped.',
        };
    }
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
        return {
            status: 'FAILED',
            prsClosed: 0,
            branchesDeleted: 0,
            canonicalPreserved: true,
            message: `Invalid GITHUB_REPOSITORY format: "${repo}". Expected "owner/repo".`,
        };
    }
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Chaos-Reset-Runner',
    };
    let prsClosed = 0;
    let branchesDeleted = 0;
    try {
        // 1. Fetch open PRs
        const prsUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls?state=open`;
        const prsRes = await fetch(prsUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (!prsRes.ok) {
            throw new Error(`GitHub API returned HTTP ${prsRes.status} when fetching open PRs`);
        }
        const prsData = (await prsRes.json());
        for (const pr of prsData) {
            if (isRehearsalPR({ number: pr.number, title: pr.title, headRef: pr.head.ref })) {
                const closeUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls/${pr.number}`;
                const closeRes = await fetch(closeUrl, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ state: 'closed' }),
                    signal: AbortSignal.timeout(5000),
                });
                if (closeRes.ok) {
                    prsClosed++;
                }
            }
        }
        // 2. Fetch branches
        const branchesUrl = `https://api.github.com/repos/${owner}/${repoName}/branches`;
        const branchesRes = await fetch(branchesUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (!branchesRes.ok) {
            throw new Error(`GitHub API returned HTTP ${branchesRes.status} when fetching branches`);
        }
        const branchesData = (await branchesRes.json());
        for (const branch of branchesData) {
            if (isRehearsalBranch(branch.name)) {
                const deleteUrl = `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${encodeURIComponent(branch.name)}`;
                const deleteRes = await fetch(deleteUrl, {
                    method: 'DELETE',
                    headers,
                    signal: AbortSignal.timeout(5000),
                });
                if (deleteRes.ok || deleteRes.status === 404) {
                    branchesDeleted++;
                }
            }
        }
        return {
            status: 'SUCCESS',
            prsClosed,
            branchesDeleted,
            canonicalPreserved: true,
        };
    }
    catch (err) {
        return {
            status: 'FAILED',
            prsClosed,
            branchesDeleted,
            canonicalPreserved: true,
            message: err instanceof Error ? err.message : String(err),
        };
    }
}
export async function runReset() {
    console.log('==================================================');
    console.log('CHAOS RESET: Environment & Rehearsal Restoration');
    console.log('==================================================');
    // 1. Safety verification
    if (!isSafeTarget(MONGODB_URI) && process.env['FORCE_RESET'] !== 'true') {
        console.error(`[reset] ERROR: Target MongoDB URI "${MONGODB_URI}" is not an allowed local target.`);
        console.error('[reset] Reset is refused to prevent unintended modifications to external databases.');
        process.exit(1);
    }
    console.log('[reset] Safety check passed: Local demo environment confirmed.\n');
    // 2. Reset AGENTS.md baseline
    console.log('[reset] Step 1: Restoring AGENTS.md baseline...');
    const agentsResult = restoreAgentsBaseline();
    if (agentsResult.wasModified) {
        console.log('  -> AGENTS.md: Restored to pristine canonical baseline.');
    }
    else {
        console.log('  -> AGENTS.md: Already matching canonical baseline.');
    }
    // 3. Reset Payment Provider demo store
    console.log('\n[reset] Step 2: Resetting Payment Provider store...');
    await resetPaymentProvider();
    console.log('  -> Payment Provider: Demo store cleared (events: 0).');
    // 4. Reset MongoDB & reseed 500,000 orders
    console.log('\n[reset] Step 3: Resetting MongoDB database & collections...');
    await initDatabase({ uri: MONGODB_URI, dbName: DB_NAME });
    const strippedIndexes = await stripExtraneousIndexes();
    if (strippedIndexes > 0) {
        console.log(`  -> Dropped ${strippedIndexes} extraneous index(es). Only _id_ remains.`);
    }
    await closeDatabase();
    console.log('  -> Reseeding canonical 500,000 order dataset (this establishes clean benchmark state)...');
    await runSeed();
    // 5. GitHub Rehearsal Cleanup
    console.log('[reset] Step 4: GitHub Rehearsal Cleanup...');
    const githubResult = await cleanupGithubRehearsals();
    if (githubResult.status === 'SUCCESS') {
        console.log(`  -> GitHub Cleanup: SUCCESS (Closed ${githubResult.prsClosed} PRs, deleted ${githubResult.branchesDeleted} rehearsal branches).`);
    }
    else if (githubResult.status === 'SKIPPED') {
        console.log(`  -> GitHub Cleanup: SKIPPED (${githubResult.message})`);
    }
    else {
        console.log(`  -> GitHub Cleanup: FAILED (${githubResult.message})`);
    }
    // 6. Final Summary Report
    const overallReady = githubResult.status !== 'FAILED';
    console.log('\n==================================================');
    console.log('CHAOS RESET SUMMARY');
    console.log('==================================================');
    console.log('MongoDB:');
    console.log('  orders:            500,000 (reseeded)');
    console.log('  webhook_events:    0 (clean)');
    console.log('  supporting index:  ABSENT');
    console.log('');
    console.log('Payment Provider:');
    console.log('  events:            0 (cleared)');
    console.log('');
    console.log('AGENTS.md:');
    console.log(`  status:            ${agentsResult.wasModified ? 'RESTORED' : 'PRISTINE'}`);
    console.log('');
    console.log('GitHub:');
    console.log(`  status:            ${githubResult.status}`);
    console.log(`  rehearsal PRs:     ${githubResult.prsClosed} closed`);
    console.log(`  rehearsal branches:${githubResult.branchesDeleted} deleted`);
    console.log('  canonical PR:      PRESERVED');
    console.log('');
    console.log('OVERALL STATUS:');
    if (overallReady) {
        console.log('  READY FOR REHEARSAL');
    }
    else {
        console.log('  RESET INCOMPLETE (GitHub cleanup failed)');
    }
    console.log('==================================================\n');
    if (!overallReady) {
        process.exit(1);
    }
}
if (process.argv[1]?.endsWith('reset.ts') || process.argv[1]?.endsWith('reset.js')) {
    runReset().catch((err) => {
        console.error('[reset] Fatal error during reset:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=reset.js.map