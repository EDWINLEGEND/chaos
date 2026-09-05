import { getDb } from '@chaos/shared';

/**
 * Ensure all required indexes exist on application collections.
 *
 * Called once at startup after the database connection is established.
 * Uses createIndex (idempotent) so it is safe to call on every start.
 */
export async function ensureIndexes(): Promise<void> {
  const db = getDb();

  // Compound index for the duplicate-order lookup in webhook-service.ts
  // Query: db.collection('orders').findOne({ userId, status: 'pending' })
  // Without this index, every webhook delivery triggers a COLLSCAN
  // over the entire orders collection (500k+ documents).
  await db
    .collection('orders')
    .createIndex({ userId: 1, status: 1 }, { name: 'idx_orders_userId_status' });

  console.log('[acme-checkout] Database indexes ensured');
}
