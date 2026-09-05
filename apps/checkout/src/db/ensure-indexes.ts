import { getDb } from '@chaos/shared';

/**
 * Ensures required indexes exist on the orders collection.
 *
 * The duplicate-order lookup in webhook-service.ts queries
 * { userId, status: "pending" } on every inbound webhook event.
 * Without a compound index this triggers a COLLSCAN over the
 * entire orders collection (500k+ docs), causing latency spikes
 * and timeouts under load.
 *
 * Called once at startup after the database connection is established.
 */
export async function ensureIndexes(): Promise<void> {
  const db = getDb();
  const orders = db.collection('orders');

  await orders.createIndex(
    { userId: 1, status: 1 },
    { background: true, name: 'idx_orders_userId_status' },
  );

  console.log('[acme-checkout] Verified compound index on orders { userId, status }');
}
