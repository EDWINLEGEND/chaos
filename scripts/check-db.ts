/**
 * MongoDB Diagnostic Script
 *
 * Checks connection to the `acme` database, inspects the `orders` and `webhook_events` collections,
 * lists current indexes on `orders`, and verifies that the compound index on { userId: 1, status: 1 }
 * is ABSENT (as required for the future Chaos incident).
 *
 * NOTE: This script inspects the database. It does NOT create any indexes or documents.
 */

import {
  initDatabase,
  getDatabaseDiagnostics,
  closeDatabase,
  DEFAULT_DB_NAME,
  DEFAULT_MONGO_URI,
} from '@chaos/shared';

async function runDiagnostics(): Promise<void> {
  const uri = process.env['MONGODB_URI'] ?? DEFAULT_MONGO_URI;
  const dbName = process.env['MONGODB_DATABASE'] ?? DEFAULT_DB_NAME;

  console.log('================================================================');
  console.log('Chaos Database Diagnostic Tool');
  console.log('================================================================');
  console.log(`Connecting to: ${uri}`);
  console.log(`Target Database: ${dbName}`);
  console.log('----------------------------------------------------------------');

  try {
    await initDatabase({
      uri,
      dbName,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 5000,
    });

    const report = await getDatabaseDiagnostics();

    if (!report.connected) {
      console.error(`[FAILURE] Unable to connect to MongoDB: ${report.error}`);
      process.exit(1);
    }

    console.log(`[OK] MongoDB Connection: SUCCESS (Ping Latency: ${report.latencyMs}ms)`);
    console.log(`[OK] Database Name: ${report.dbName}`);

    console.log('\n--- Collections Overview ---');
    console.log(
      `  • orders: ${report.collections.orders.exists ? 'EXISTS' : 'NOT FOUND'} (Count: ${report.collections.orders.count} documents)`
    );
    console.log(
      `  • webhook_events: ${report.collections.webhook_events.exists ? 'EXISTS' : 'NOT FOUND'} (Count: ${report.collections.webhook_events.count} documents)`
    );

    console.log('\n--- Orders Index Analysis ---');
    if (report.ordersIndexes.length === 0) {
      console.log('  No indexes found on `orders` (collection may be empty or newly created).');
    } else {
      for (const idx of report.ordersIndexes) {
        console.log(`  • Index "${idx.name}": ${JSON.stringify(idx.key)}`);
      }
    }

    console.log('\n--- Intentional Vulnerability Audit ---');
    if (report.hasUserIdStatusCompoundIndex) {
      console.warn(
        '  [WARNING - UNEXPECTED] Compound index on { userId: 1, status: 1 } IS PRESENT!'
      );
      console.warn('  The Chaos incident relies on this query executing a COLLSCAN without a supporting index.');
    } else {
      console.log(
        '  [VERIFIED - EXPECTED] Supporting compound index on { userId: 1, status: 1 } is ABSENT.'
      );
      console.log('  This ensures queries like { userId: ..., status: "pending" } will perform a full COLLSCAN.');
    }

    console.log('================================================================');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] Diagnostic execution failed: ${message}`);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

runDiagnostics()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error in check-db:', err);
    process.exit(1);
  });
