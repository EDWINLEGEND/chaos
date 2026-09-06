import { MongoClient } from 'mongodb';
import { generateOrders } from '@chaos/shared';
import { loadSharedConfig } from '@chaos/shared';

const MONGODB_URI = process.env['MONGODB_URI'] || 'mongodb://localhost:27017/acme';
const MONGODB_DATABASE = process.env['MONGODB_DATABASE'] || 'acme';
const TOTAL_ORDERS = 500_000;
const CHUNK_SIZE = 10_000;

async function main() {
  const config = loadSharedConfig();
  const client = new MongoClient(MONGODB_URI || config.mongodbUri);

  try {
    await client.connect();
    console.log('[seed] Connected to MongoDB');

    const db = client.db(MONGODB_DATABASE || config.mongodbDatabase);
    const orders = db.collection('orders');
    const webhookEvents = db.collection('webhook_events');

    // Clear existing data
    console.log('[seed] Clearing existing orders and webhook_events...');
    await orders.deleteMany({});
    await webhookEvents.deleteMany({});

    // Drop any non-_id indexes to ensure clean baseline
    const existingIndexes = await orders.indexes();
    for (const index of existingIndexes) {
      if (index.name !== '_id_') {
        console.log(`[seed] Dropping index: ${index.name}`);
        await orders.dropIndex(index.name!);
      }
    }

    console.log(`[seed] Seeding ${TOTAL_ORDERS} orders in chunks of ${CHUNK_SIZE}...`);
    const totalChunks = Math.ceil(TOTAL_ORDERS / CHUNK_SIZE);

    for (let chunk = 0; chunk < totalChunks; chunk++) {
      const offset = chunk * CHUNK_SIZE;
      const batchSize = Math.min(CHUNK_SIZE, TOTAL_ORDERS - offset);
      const batch = generateOrders(batchSize, offset);
      await orders.insertMany(batch, { ordered: false });
      process.stdout.write(`\r[seed] Inserted ${Math.min(offset + batchSize, TOTAL_ORDERS)} / ${TOTAL_ORDERS}`);
    }

    console.log('\n[seed] Order seeding complete.');

    // Create compound index for the duplicate-order lookup query
    // This fixes the COLLSCAN that was causing timeout-related silent order loss
    console.log('[seed] Creating compound index {userId: 1, status: 1} on orders...');
    await orders.createIndex({ userId: 1, status: 1 });
    console.log('[seed] Compound index created successfully.');

    // Verify index exists
    const finalIndexes = await orders.indexes();
    console.log('[seed] Current indexes:', finalIndexes.map(i => i.name).join(', '));

    // Verify the index supports the query (should use IXSCAN, not COLLSCAN)
    const explain = await orders
      .find({ userId: 'user_00001', status: 'pending' })
      .explain('executionStats');
    const plan = explain.queryPlanner.winningPlan;
    console.log(`[seed] Query plan for {userId, status}: ${plan.stage}`);
    if (plan.stage === 'FETCH' && plan.inputStage?.stage === 'IXSCAN') {
      console.log('[seed] ✓ Index scan confirmed - query is now covered by compound index.');
    } else if (plan.stage === 'COLLSCAN') {
      console.warn('[seed] ✗ WARNING: Query still uses COLLSCAN despite index!');
    }

    console.log('[seed] Done.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
