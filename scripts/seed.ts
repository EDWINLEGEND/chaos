import { initDatabase, getDb, closeDatabase } from '@chaos/shared';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';

// Load .env from project root
dotenvConfig({ path: resolve(import.meta.dirname ?? '.', '..', '.env') });

const MONGODB_URI = process.env['MONGODB_URI'] || 'mongodb://localhost:27017/acme';
const MONGODB_DATABASE = process.env['MONGODB_DATABASE'] || 'acme';
const TOTAL_ORDERS = 500_000;
const BATCH_SIZE = 10_000;
const TOTAL_USERS = 25_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log('[seed] Connecting to MongoDB...');

  await initDatabase({
    uri: MONGODB_URI,
    dbName: MONGODB_DATABASE,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });

  const db = getDb();
  const ordersCol = db.collection('orders');
  const webhookEventsCol = db.collection('webhook_events');

  // Clear existing data
  console.log('[seed] Clearing existing orders and webhook_events...');
  await ordersCol.drop().catch(() => {});
  await webhookEventsCol.drop().catch(() => {});

  // ──────────────────────────────────────────────────────────────
  // Compound index: eliminates COLLSCAN on { userId, status }
  // used by the payment-confirmed duplicate-order lookup.
  // ──────────────────────────────────────────────────────────────
  console.log('[seed] Creating compound index { userId: 1, status: 1 } on orders...');
  await ordersCol.createIndex({ userId: 1, status: 1 }, { background: true });
  console.log('[seed] Compound index created.');

  // Generate and insert orders in batches
  const startTime = Date.now();
  let inserted = 0;

  console.log(`[seed] Seeding ${TOTAL_ORDERS.toLocaleString()} orders across ${TOTAL_USERS.toLocaleString()} users in batches of ${BATCH_SIZE.toLocaleString()}...`);

  for (let batchStart = 0; batchStart < TOTAL_ORDERS; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL_ORDERS);
    const docs: Array<{
      userId: string;
      status: string;
      amount: number;
      paymentId: string;
      eventId: string;
      createdAt: Date;
    }> = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const userId = `user_${String((i % TOTAL_USERS) + 1).padStart(5, '0')}`;
      const amount = Math.floor(1000 + Math.random() * 9000);
      const paymentId = `pay_${String(i + 1).padStart(7, '0')}`;
      const eventId = `evt_${String(i + 1).padStart(7, '0')}`;

      docs.push({
        userId,
        status: 'completed',
        amount,
        paymentId,
        eventId,
        createdAt: new Date(),
      });
    }

    await ordersCol.insertMany(docs, { ordered: false });
    inserted += docs.length;

    if (inserted % 50_000 === 0 || inserted === TOTAL_ORDERS) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[seed] Inserted ${inserted.toLocaleString()}/${TOTAL_ORDERS.toLocaleString()} orders (${elapsed}s)`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[seed] Seeding complete: ${inserted.toLocaleString()} orders in ${totalTime}s`);

  // Verify index
  const indexes = await ordersCol.listIndexes().toArray();
  console.log('[seed] Orders collection indexes:');
  for (const idx of indexes) {
    console.log(`  - ${JSON.stringify(idx.key)}${idx.name !== '_id_' ? ' (compound)' : ''}`);
  }

  // Verify query plan uses IXSCAN
  const explainResult = await ordersCol
    .find({ userId: 'user_00001', status: 'pending' })
    .explain('executionStats');

  const winningPlan = explainResult.queryPlanner.winningPlan;
  const planType = winningPlan.stage;
  const docsExamined = explainResult.executionStats.totalDocsExamined;

  console.log(`[seed] Query plan for {userId, status}: ${planType}`);
  console.log(`[seed] Documents examined: ${docsExamined.toLocaleString()}`);

  if (planType === 'COLLSCAN') {
    console.warn('[seed] WARNING: Query still uses COLLSCAN — index may not have been created correctly.');
  } else {
    console.log('[seed] ✓ Query uses index scan (IXSCAN) — no COLLSCAN bottleneck.');
  }

  await closeDatabase();
  console.log('[seed] Done.');
}

main().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
