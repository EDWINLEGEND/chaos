import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme';
const MONGODB_DATABASE = process.env['MONGODB_DATABASE'] ?? 'acme';
const TOTAL_ORDERS = 500_000;
const USERS_COUNT = 25_000;
const CHUNK_SIZE = 10_000;

async function main(): Promise<void> {
  console.log('[seed] Connecting to MongoDB...');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const db = client.db(MONGODB_DATABASE);
  const orders = db.collection('orders');
  const webhookEvents = db.collection('webhook_events');

  // Clear existing data
  console.log('[seed] Clearing existing orders and webhook_events...');
  await orders.deleteMany({});
  await webhookEvents.deleteMany({});

  // Create compound index for the duplicate-order lookup query shape
  // This eliminates the COLLSCAN that caused the webhook timeout incident
  console.log('[seed] Ensuring compound index { userId: 1, status: 1 } exists on orders...');
  await orders.createIndex({ userId: 1, status: 1 }, { name: 'userId_status_idx' });
  console.log('[seed] Compound index created.');

  // Generate and insert orders in chunks
  console.log(`[seed] Seeding ${TOTAL_ORDERS} orders across ${USERS_COUNT} users in ${TOTAL_ORDERS / CHUNK_SIZE} chunks...`);
  const startTime = Date.now();

  for (let chunk = 0; chunk < TOTAL_ORDERS; chunk += CHUNK_SIZE) {
    const docs: Array<{
      userId: string;
      paymentId: string;
      amount: number;
      status: string;
      createdAt: Date;
    }> = [];

    const end = Math.min(chunk + CHUNK_SIZE, TOTAL_ORDERS);
    for (let i = chunk; i < end; i++) {
      const userId = `user_${String((i % USERS_COUNT) + 1).padStart(5, '0')}`;
      docs.push({
        userId,
        paymentId: `pay_seed_${i}`,
        amount: Math.floor(Math.random() * 10000) + 100,
        status: 'pending',
        createdAt: new Date(),
      });
    }

    await orders.insertMany(docs, { ordered: false });
    const pct = Math.round((end / TOTAL_ORDERS) * 100);
    process.stdout.write(`\r[seed] Progress: ${pct}% (${end}/${TOTAL_ORDERS})`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[seed] Seeding complete in ${elapsed}s.`);

  // Verify index
  console.log('[seed] Verifying index configuration...');
  await orders.dropIndex('userId_status_idx').catch(() => {
    /* ignore if not present */
  });
  await orders.createIndex({ userId: 1, status: 1 }, { name: 'userId_status_idx' });
  console.log('[seed] Compound index { userId: 1, status: 1 } confirmed on orders.');

  // Verify query plan
  const explain = await orders
    .find({ userId: 'user_00001', status: 'pending' })
    .explain('executionStats');
  const plan = explain.queryPlanner?.winningPlan?.stage ?? 'UNKNOWN';
  const docsExamined = explain.executionStats?.totalDocsExamined ?? 0;
  console.log(`[seed] Duplicate-check query plan: ${plan} (${docsExamined} docs examined)`);

  await client.close();
  console.log('[seed] Done. Database seeded with 500,000 orders and compound index.');
}

main().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
