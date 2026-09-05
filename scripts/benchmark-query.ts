import {
  initDatabase,
  getOrdersCollection,
  closeDatabase,
} from '@chaos/shared';

const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme';
const DB_NAME = process.env['MONGODB_DATABASE'] ?? 'acme';
const ITERATIONS = parseInt(process.env['BENCHMARK_ITERATIONS'] ?? '5', 10);

export async function runQueryBenchmark(): Promise<void> {
  console.log('====================================================');
  console.log('Chaos Environment: Unindexed Query Benchmark');
  console.log('====================================================');
  console.log(`Connecting to: ${MONGODB_URI}`);
  console.log(`Database: ${DB_NAME}`);

  await initDatabase({ uri: MONGODB_URI, dbName: DB_NAME });
  const ordersCol = getOrdersCollection();

  // Find a realistic user with a pending order from the seeded dataset
  const samplePending = await ordersCol.findOne({ status: 'pending' });
  if (!samplePending) {
    console.error('[benchmark] Error: No pending order found in the orders collection. Please run "pnpm seed" first.');
    await closeDatabase();
    process.exit(1);
  }

  const targetUserId = samplePending.userId;
  console.log(`\nTarget Query: db.orders.find({ userId: "${targetUserId}", status: "pending" })`);
  console.log(`Running ${ITERATIONS} benchmark iterations with explain("executionStats")...\n`);

  const latencies: number[] = [];
  let winningStage = 'UNKNOWN';
  let totalDocsExamined = 0;
  let totalKeysExamined = 0;
  let nReturned = 0;

  for (let i = 1; i <= ITERATIONS; i++) {
    const explanation = await ordersCol
      .find({ userId: targetUserId, status: 'pending' })
      .explain('executionStats');

    const queryPlanner = explanation.queryPlanner as {
      winningPlan: { stage: string };
    };
    const stats = explanation.executionStats as {
      executionTimeMillis: number;
      totalDocsExamined: number;
      totalKeysExamined: number;
      nReturned: number;
    };

    winningStage = queryPlanner?.winningPlan?.stage ?? 'UNKNOWN';
    totalDocsExamined = stats?.totalDocsExamined ?? 0;
    totalKeysExamined = stats?.totalKeysExamined ?? 0;
    nReturned = stats?.nReturned ?? 0;
    latencies.push(stats.executionTimeMillis);

    console.log(`  Iteration ${i}: ${stats.executionTimeMillis} ms (${winningStage}, ${stats.totalDocsExamined.toLocaleString()} docs examined, ${stats.nReturned} returned)`);
  }

  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1);

  console.log('\n--- Benchmark Summary ---');
  console.log(`User:                 ${targetUserId}`);
  console.log(`Status:               pending`);
  console.log(`Plan:                 ${winningStage}`);
  console.log(`Documents examined:   ${totalDocsExamined.toLocaleString()}`);
  console.log(`Keys examined:        ${totalKeysExamined}`);
  console.log(`Documents returned:   ${nReturned}`);
  console.log(`Execution time (min): ${minLatency} ms`);
  console.log(`Execution time (avg): ${avgLatency} ms`);
  console.log(`Execution time (max): ${maxLatency} ms`);
  console.log('====================================================\n');

  await closeDatabase();
}

if (process.argv[1]?.endsWith('benchmark-query.ts') || process.argv[1]?.endsWith('benchmark-query.js')) {
  runQueryBenchmark().catch((err) => {
    console.error('[benchmark] Error running benchmark:', err);
    process.exit(1);
  });
}
