import { initDatabase, getOrdersCollection, getWebhookEventsCollection, closeDatabase, ObjectId, } from '@chaos/shared';
const TOTAL_ORDERS = parseInt(process.env['SEED_TOTAL_ORDERS'] ?? '500000', 10);
const BATCH_SIZE = parseInt(process.env['SEED_BATCH_SIZE'] ?? '10000', 10);
const USER_POOL_SIZE = parseInt(process.env['SEED_USER_POOL_SIZE'] ?? '25000', 10);
const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme';
const DB_NAME = process.env['MONGODB_DATABASE'] ?? 'acme';
function isSafeTarget(uri) {
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
function getRandomStatus() {
    const rand = Math.random();
    if (rand < 0.75)
        return 'paid';
    if (rand < 0.90)
        return 'cancelled';
    if (rand < 0.95)
        return 'failed';
    return 'pending'; // 5% pending (~25,000 pending orders across dataset)
}
function getRandomDateWithin(daysBack) {
    const now = Date.now();
    const past = now - daysBack * 24 * 60 * 60 * 1000;
    return new Date(past + Math.random() * (now - past));
}
function generateBatch(batchIndex, count) {
    const batch = [];
    const baseOffset = batchIndex * count;
    for (let i = 0; i < count; i++) {
        const globalIndex = baseOffset + i;
        // Map to a user in the user pool to model multi-order users
        const userNum = (globalIndex % USER_POOL_SIZE) + 1;
        const userId = `user_${String(userNum).padStart(5, '0')}`;
        const paymentId = `pay_seed_${batchIndex}_${i}`;
        const status = getRandomStatus();
        // Amounts between 500 ($5.00) and 50000 ($500.00) cents
        const amount = 500 + Math.floor(Math.random() * 49500);
        const createdAt = getRandomDateWithin(90);
        const updatedAt = new Date(createdAt.getTime() + Math.floor(Math.random() * 3600000));
        batch.push({
            _id: new ObjectId(),
            userId,
            paymentId,
            status,
            amount,
            createdAt,
            updatedAt,
        });
    }
    return batch;
}
export async function runSeed() {
    console.log('====================================================');
    console.log('Chaos Environment: Database Seeder');
    console.log('====================================================');
    console.log(`Target Database: ${DB_NAME} (${MONGODB_URI})`);
    console.log(`Target Order Count: ${TOTAL_ORDERS.toLocaleString()}`);
    console.log(`Batch Size: ${BATCH_SIZE.toLocaleString()}`);
    console.log(`User Pool Size: ${USER_POOL_SIZE.toLocaleString()}`);
    if (!isSafeTarget(MONGODB_URI) && process.env['FORCE_SEED'] !== 'true') {
        console.error(`[seed] ERROR: Target URI "${MONGODB_URI}" does not appear to be a local demo database.`);
        console.error('[seed] Set FORCE_SEED=true to override this safety check.');
        process.exit(1);
    }
    console.log('[seed] Safety check passed: local demo database confirmed.');
    const startTime = Date.now();
    await initDatabase({ uri: MONGODB_URI, dbName: DB_NAME });
    const ordersCol = getOrdersCollection();
    const webhookCol = getWebhookEventsCollection();
    // 1. Safely clear current demo collections
    console.log('[seed] Purging existing orders and webhook_events...');
    await ordersCol.deleteMany({});
    await webhookCol.deleteMany({});
    console.log('[seed] Collections successfully purged.');
    // 2. Generate and bulk insert in chunks
    const totalBatches = Math.ceil(TOTAL_ORDERS / BATCH_SIZE);
    console.log(`[seed] Beginning insertion across ${totalBatches} batches...`);
    let insertedCount = 0;
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const currentBatchCount = Math.min(BATCH_SIZE, TOTAL_ORDERS - insertedCount);
        const batch = generateBatch(batchIndex, currentBatchCount);
        await ordersCol.insertMany(batch, { ordered: false });
        insertedCount += currentBatchCount;
        if ((batchIndex + 1) % 5 === 0 || batchIndex === totalBatches - 1) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const percent = ((insertedCount / TOTAL_ORDERS) * 100).toFixed(1);
            console.log(`[seed] Progress: ${insertedCount.toLocaleString()} / ${TOTAL_ORDERS.toLocaleString()} (${percent}%) [${elapsed}s]`);
        }
    }
    const seedElapsedMs = Date.now() - startTime;
    console.log(`[seed] Insertion complete in ${(seedElapsedMs / 1000).toFixed(2)}s.`);
    // 3. Verify counts
    const finalOrderCount = await ordersCol.countDocuments();
    const finalWebhookCount = await webhookCol.countDocuments();
    console.log('\n--- Seeding Verification ---');
    console.log(`• Final orders count: ${finalOrderCount.toLocaleString()} (Target: ${TOTAL_ORDERS.toLocaleString()})`);
    console.log(`• Final webhook_events count: ${finalWebhookCount} (Target: 0)`);
    // 4. Verify indexes
    const indexes = await ordersCol.indexes();
    console.log(`• Indexes on orders (${indexes.length}):`);
    for (const idx of indexes) {
        console.log(`    - ${idx.name}: ${JSON.stringify(idx.key)}`);
    }
    const hasCompoundIndex = indexes.some((idx) => idx.key && 'userId' in idx.key && 'status' in idx.key);
    if (hasCompoundIndex) {
        console.error('[seed] VIOLATION: Compound index on { userId: 1, status: 1 } was detected! It must be ABSENT.');
        process.exit(1);
    }
    console.log('• [OK] Verified: Supporting compound index { userId: 1, status: 1 } is ABSENT.');
    // 5. Run explain on known seeded user
    const probeUser = 'user_00042';
    console.log(`\n--- Real Explain Diagnostic Probe (${probeUser}) ---`);
    const explanation = await ordersCol
        .find({ userId: probeUser, status: 'pending' })
        .explain('executionStats');
    const queryPlanner = explanation.queryPlanner;
    const executionStats = explanation.executionStats;
    const winningStage = queryPlanner?.winningPlan?.stage ?? 'UNKNOWN';
    console.log(`• Winning Plan Stage: ${winningStage}`);
    console.log(`• Total Documents Examined: ${executionStats?.totalDocsExamined?.toLocaleString() ?? 'N/A'}`);
    console.log(`• Total Keys Examined: ${executionStats?.totalKeysExamined ?? 'N/A'}`);
    console.log(`• Matching Documents Returned: ${executionStats?.nReturned ?? 'N/A'}`);
    console.log(`• Execution Time: ${executionStats?.executionTimeMillis ?? 'N/A'} ms`);
    if (winningStage !== 'COLLSCAN') {
        console.error(`[seed] VIOLATION: Expected COLLSCAN but got ${winningStage}`);
        process.exit(1);
    }
    console.log('• [VERIFIED] Real MongoDB COLLSCAN confirmed.');
    console.log('====================================================\n');
    await closeDatabase();
}
// Run directly when invoked as a script
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
    runSeed().catch((err) => {
        console.error('[seed] Fatal error during seeding:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=seed.js.map