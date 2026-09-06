import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { getMongoClient } from '@chaos/shared';

const config = loadConfig();
const startTime = Date.now();
const app = createApp(config, startTime);

const PORT = config.port;

async function main(): Promise<void> {
  // Connect to MongoDB
  const client = await getMongoClient();
  const db = client.db(config.database);

  // Ensure compound index on orders for the duplicate-check query
  await db.collection('orders').createIndex(
    { userId: 1, status: 1 },
    { name: 'idx_orders_userId_status' }
  );

  app.listen(PORT, () => {
    console.log(`[${config.serviceName}] listening on port ${PORT}`);
    console.log(`[${config.serviceName}] MongoDB connected to ${config.database}`);
    console.log(`[${config.serviceName}] Index idx_orders_userId_status ensured on orders`);
  });
}

main().catch((err) => {
  console.error('[checkout] Fatal startup error:', err);
  process.exit(1);
});
