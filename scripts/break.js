import { initDatabase, getOrdersCollection, getWebhookEventsCollection, closeDatabase, } from '@chaos/shared';
const TOTAL_REQUESTS = parseInt(process.env['BREAK_TOTAL_REQUESTS'] ?? '1200', 10);
const CONCURRENCY = parseInt(process.env['BREAK_CONCURRENCY'] ?? '40', 10);
const CHECKOUT_URL = process.env['CHECKOUT_URL'] ?? 'http://127.0.0.1:3001';
const PAYMENT_PROVIDER_URL = process.env['PAYMENT_PROVIDER_URL'] ?? 'http://127.0.0.1:3002';
const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme';
const DB_NAME = process.env['MONGODB_DATABASE'] ?? 'acme';
function isSafeUrl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        const host = parsed.hostname.toLowerCase();
        return (host === '127.0.0.1' ||
            host === 'localhost' ||
            host === 'checkout' ||
            host === 'payment-provider');
    }
    catch {
        return false;
    }
}
export async function runBreak() {
    console.log('==================================================');
    console.log('CHAOS BREAK: Concurrent Webhook Load Generator');
    console.log('==================================================');
    console.log(`Target Checkout:         ${CHECKOUT_URL}`);
    console.log(`Payment Provider:        ${PAYMENT_PROVIDER_URL}`);
    console.log(`Total Requests:          ${TOTAL_REQUESTS}`);
    console.log(`Concurrency:             ${CONCURRENCY}`);
    // Safety check
    if ((!isSafeUrl(CHECKOUT_URL) || !isSafeUrl(PAYMENT_PROVIDER_URL)) &&
        process.env['FORCE_BREAK'] !== 'true') {
        console.error('[break] ERROR: Target URLs must be local (127.0.0.1 / localhost) to prevent unintended traffic.');
        process.exit(1);
    }
    // Verify services are reachable
    try {
        const healthCheckout = await fetch(`${CHECKOUT_URL}/health`);
        if (!healthCheckout.ok)
            throw new Error(`Checkout health check returned ${healthCheckout.status}`);
        const healthProvider = await fetch(`${PAYMENT_PROVIDER_URL}/health`);
        if (!healthProvider.ok)
            throw new Error(`Payment provider health check returned ${healthProvider.status}`);
    }
    catch (err) {
        console.error('[break] ERROR: Target services are not responding. Ensure checkout and payment-provider are running.');
        console.error(`Details: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
    console.log('[break] Target services confirmed online.');
    // Connect to MongoDB to observe exact starting counts
    await initDatabase({ uri: MONGODB_URI, dbName: DB_NAME });
    const ordersCol = getOrdersCollection();
    const webhooksCol = getWebhookEventsCollection();
    const initialOrdersCount = await ordersCol.countDocuments();
    const initialWebhooksCount = await webhooksCol.countDocuments();
    console.log(`[break] Baseline MongoDB orders: ${initialOrdersCount.toLocaleString()}`);
    console.log(`[break] Baseline MongoDB webhook_events: ${initialWebhooksCount.toLocaleString()}`);
    // 1. Generate payments on Payment Provider
    console.log(`\n[break] Step 1: Generating ${TOTAL_REQUESTS} payment events on Payment Provider...`);
    const paymentEvents = [];
    // Generate payments in parallel batches to be fast
    const creationBatchSize = 50;
    for (let i = 0; i < TOTAL_REQUESTS; i += creationBatchSize) {
        const batchCount = Math.min(creationBatchSize, TOTAL_REQUESTS - i);
        const batchPromises = Array.from({ length: batchCount }, async (_, idx) => {
            const globalIdx = i + idx;
            // Distinct users to ensure each duplicate check performs a full 500,000 document COLLSCAN
            const userId = `user_traffic_${String(globalIdx + 1).padStart(5, '0')}`;
            const amount = 1000 + (globalIdx % 50) * 100;
            const res = await fetch(`${PAYMENT_PROVIDER_URL}/v1/test/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, amount }),
            });
            if (!res.ok) {
                throw new Error(`Failed to create payment: ${res.status}`);
            }
            return (await res.json());
        });
        const createdBatch = await Promise.all(batchPromises);
        paymentEvents.push(...createdBatch);
    }
    console.log(`[break] Successfully registered ${paymentEvents.length} payment events on provider.`);
    // 2. Concurrently dispatch webhooks to Acme Checkout
    console.log(`\n[break] Step 2: Driving concurrent webhook deliveries (Concurrency: ${CONCURRENCY})...`);
    const metrics = {
        attempts: 0,
        http200: 0,
        httpNon200: 0,
        networkErrors: 0,
        silentTimeouts: 0,
        orderCreations: 0,
        duplicateDeliveries: 0,
    };
    const startTime = Date.now();
    let currentIndex = 0;
    async function worker() {
        while (currentIndex < paymentEvents.length) {
            const index = currentIndex++;
            const event = paymentEvents[index];
            if (!event)
                break;
            metrics.attempts++;
            try {
                const res = await fetch(`${CHECKOUT_URL}/webhooks/payment-confirmed`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: event.id,
                        type: 'payment-confirmed',
                        paymentId: event.paymentId,
                        userId: event.userId,
                        amount: event.amount,
                    }),
                });
                if (res.status === 200) {
                    metrics.http200++;
                    const json = (await res.json());
                    if (json['received'] === true) {
                        metrics.silentTimeouts++;
                    }
                    else if (json['data'] && typeof json['data'] === 'object') {
                        const data = json['data'];
                        if (data['created'] === true) {
                            metrics.orderCreations++;
                        }
                        else if (data['duplicate'] === true) {
                            metrics.duplicateDeliveries++;
                        }
                    }
                }
                else {
                    metrics.httpNon200++;
                }
            }
            catch {
                metrics.networkErrors++;
            }
        }
    }
    // Launch worker pool
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[break] Load generation finished in ${durationSec}s.`);
    // Allow a brief moment for any pending I/O settling
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // 3. Collect final counts from systems of record
    const finalOrdersCount = await ordersCol.countDocuments();
    const finalWebhooksCount = await webhooksCol.countDocuments();
    const newOrdersCreated = finalOrdersCount - initialOrdersCount;
    const newWebhooksRecorded = finalWebhooksCount - initialWebhooksCount;
    const paymentEventsCount = paymentEvents.length;
    const divergence = newWebhooksRecorded - newOrdersCreated;
    const incidentReproduced = divergence > 0 && metrics.silentTimeouts > 0;
    // Run a sample query explain to inspect current execution stats
    const sampleUser = paymentEvents[0]?.userId ?? 'user_00042';
    const explanation = await ordersCol
        .find({ userId: sampleUser, status: 'pending' })
        .explain('executionStats');
    const queryPlanner = explanation.queryPlanner;
    const executionStats = explanation.executionStats;
    console.log('\n==================================================');
    console.log('CHAOS BREAK RUN SUMMARY');
    console.log('==================================================');
    console.log(`Duration:              ${durationSec}s`);
    console.log(`Concurrency:           ${CONCURRENCY}`);
    console.log(`Webhook attempts:      ${metrics.attempts}`);
    console.log('');
    console.log(`HTTP 200:              ${metrics.http200}`);
    console.log(`HTTP non-200:          ${metrics.httpNon200}`);
    console.log(`Network errors:        ${metrics.networkErrors}`);
    console.log('');
    console.log(`Payment events:        ${paymentEventsCount}`);
    console.log(`Webhook events:        ${newWebhooksRecorded}`);
    console.log(`Orders created:        ${newOrdersCreated}`);
    console.log('');
    console.log(`Divergence:            ${divergence}`);
    console.log(`Silent timeouts:       ${metrics.silentTimeouts}`);
    console.log(`Normal creations:      ${metrics.orderCreations}`);
    console.log(`Duplicates detected:   ${metrics.duplicateDeliveries}`);
    console.log('');
    console.log('Mongo duplicate query:');
    console.log(`  Stage:               ${queryPlanner.winningPlan.stage}`);
    console.log(`  Execution time:      ${executionStats.executionTimeMillis} ms`);
    console.log('');
    console.log('Result:');
    if (incidentReproduced) {
        console.log('  INCIDENT REPRODUCED');
        console.log(`  (Payment Events: ${paymentEventsCount} >= Webhook Events: ${newWebhooksRecorded} > Orders: ${newOrdersCreated})`);
    }
    else {
        console.log('  INCIDENT NOT REPRODUCED');
        console.log('  (Divergence was 0. Increase concurrency or decrease WEBHOOK_TIMEOUT_MS)');
    }
    console.log('==================================================\n');
    await closeDatabase();
}
if (process.argv[1]?.endsWith('break.ts') || process.argv[1]?.endsWith('break.js')) {
    runBreak().catch((err) => {
        console.error('[break] Fatal error during break run:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=break.js.map