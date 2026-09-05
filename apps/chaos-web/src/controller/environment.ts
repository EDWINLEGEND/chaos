import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  initDatabase,
  getOrdersCollection,
  getWebhookEventsCollection,
  checkDatabaseConnectivity,
  closeDatabase,
  type EnvironmentStatus,
} from '@chaos/shared';
import { experimentRegistry } from './experiment-registry.js';
import { logActivity } from './activity-logger.js';
import { getRepoRoot } from '../utils/paths.js';

const execAsync = promisify(exec);

const CHECKOUT_URL = process.env['CHECKOUT_URL'] ?? 'http://127.0.0.1:3001';
const PAYMENT_PROVIDER_URL = process.env['PAYMENT_PROVIDER_URL'] ?? 'http://127.0.0.1:3002';
const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme';
const DB_NAME = process.env['MONGODB_DATABASE'] ?? 'acme';

export async function getEnvironmentStatus(): Promise<EnvironmentStatus> {
  let checkoutStatus: 'healthy' | 'degraded' | 'down' = 'down';
  let paymentProviderStatus: 'healthy' | 'degraded' | 'down' = 'down';
  let mongodbStatus: 'healthy' | 'degraded' | 'down' = 'down';
  let ordersCount = 0;
  let webhookEventsCount = 0;
  let supportingIndexPresent = false;

  // 1. Probe Checkout service
  try {
    const res = await fetch(`${CHECKOUT_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const json = (await res.json()) as { status: string };
      checkoutStatus = json.status === 'ok' ? 'healthy' : 'degraded';
    }
  } catch {
    checkoutStatus = 'down';
  }

  // 2. Probe Payment Provider service
  try {
    const res = await fetch(`${PAYMENT_PROVIDER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const json = (await res.json()) as { status: string };
      paymentProviderStatus = json.status === 'ok' ? 'healthy' : 'degraded';
    }
  } catch {
    paymentProviderStatus = 'down';
  }

  // 3. Probe MongoDB database
  try {
    await initDatabase({ uri: MONGODB_URI, dbName: DB_NAME });
    const connectivity = await checkDatabaseConnectivity(2000);
    if (connectivity.status === 'ok') {
      mongodbStatus = 'healthy';
      const ordersCol = getOrdersCollection();
      const webhookCol = getWebhookEventsCollection();

      ordersCount = await ordersCol.countDocuments();
      webhookEventsCount = await webhookCol.countDocuments();

      const indexes = await ordersCol.indexes();
      supportingIndexPresent = indexes.some(
        (idx) => idx.key && 'userId' in idx.key && 'status' in idx.key
      );
    }
    await closeDatabase();
  } catch {
    mongodbStatus = 'down';
  }

  return {
    checkout: checkoutStatus,
    paymentProvider: paymentProviderStatus,
    mongodb: mongodbStatus,
    activeExperiments: experimentRegistry.getActiveCount(),
    ordersCount,
    webhookEventsCount,
    supportingIndexPresent,
    timestamp: new Date().toISOString(),
  };
}

export async function triggerEnvironmentReset(): Promise<{
  success: boolean;
  status: string;
  mongo: string;
  paymentProvider: string;
  agentsBaseline: string;
  githubCleanup: string;
}> {
  logActivity('warn', 'Environment reset triggered via Chaos API...');

  try {
    // Clear all active chaos experiments before reset
    await experimentRegistry.clearAll();

    // Invoke trusted reset machinery via pnpm reset
    await execAsync('pnpm reset', { cwd: getRepoRoot() });

    logActivity('success', 'Environment reset completed successfully. 500,000 orders reseeded.');

    return {
      success: true,
      status: 'ready',
      mongo: 'reset (500,000 orders reseeded)',
      paymentProvider: 'reset (events: 0)',
      agentsBaseline: 'restored',
      githubCleanup: 'processed',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logActivity('error', `Environment reset failed: ${msg}`);
    throw err;
  }
}
