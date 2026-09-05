import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createDatabaseConnection,
  type EnvironmentStatus,
} from '@chaos/shared';
import { experimentRegistry } from './experiment-registry.js';
import { logActivity } from './activity-logger.js';
import { getRepoRoot } from '../utils/paths.js';

const execAsync = promisify(exec);

const CHECKOUT_URL =
  process.env['CHECKOUT_URL'] || process.env['CHECKOUT_SERVICE_URL'] || 'http://127.0.0.1:3001';
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
    const conn = await createDatabaseConnection({ uri: MONGODB_URI, dbName: DB_NAME });
    try {
      const connectivity = await conn.checkConnectivity(2000);
      if (connectivity.status === 'ok') {
        mongodbStatus = 'healthy';
        const ordersCol = conn.getOrdersCollection();
        const webhookCol = conn.getWebhookEventsCollection();

        ordersCount = await ordersCol.countDocuments();
        webhookEventsCount = await webhookCol.countDocuments();

        const indexes = await ordersCol.indexes();
        supportingIndexPresent = indexes.some(
          (idx) => idx.key && 'userId' in idx.key && 'status' in idx.key
        );
      }
    } finally {
      await conn.close();
    }
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

export async function getExplainProbe(): Promise<{
  stage: string;
  totalDocsExamined: number;
  keysExamined: number;
  executionTimeMillis: number;
  supportingIndexPresent: boolean;
  filter: Record<string, unknown>;
}> {
  const conn = await createDatabaseConnection({ uri: MONGODB_URI, dbName: DB_NAME });
  try {
    const ordersCol = conn.getOrdersCollection();
    const explainResult = (await ordersCol
      .find({ userId: 'user_traffic_00001', status: 'pending' })
      .explain('executionStats')) as Record<string, unknown>;

    const stats = (explainResult['executionStats'] ?? {}) as Record<string, unknown>;
    const executionStages = (stats['executionStages'] ?? {}) as Record<string, unknown>;
    const stage = String(executionStages['stage'] ?? 'UNKNOWN');
    const totalDocsExamined = Number(stats['totalDocsExamined'] ?? 0);
    const keysExamined = Number(stats['totalKeysExamined'] ?? 0);
    const executionTimeMillis = Number(stats['executionTimeMillis'] ?? 0);

    const indexes = await ordersCol.indexes();
    const supportingIndexPresent = indexes.some(
      (idx) => idx.key && 'userId' in idx.key && 'status' in idx.key
    );

    return {
      stage,
      totalDocsExamined,
      keysExamined,
      executionTimeMillis,
      supportingIndexPresent,
      filter: { userId: 'user_traffic_00001', status: 'pending' },
    };
  } finally {
    await conn.close();
  }
}

export async function getReconciliationReport(): Promise<{
  paymentEventsCount: number;
  webhookEventsCount: number;
  ordersCount: number;
  ordersCreatedFromTraffic: number;
  silentLossCount: number;
  lossRatePercentage: number;
  recentLedger: Array<{
    eventId: string;
    paymentId: string;
    userId: string;
    amount: number;
    recordedInWebhooks: boolean;
    orderCreatedInDb: boolean;
    status: 'FULFILLED' | 'SILENTLY_DROPPED';
  }>;
}> {
  let paymentEvents: Array<{ id: string; paymentId: string; userId: string; amount: number }> = [];
  try {
    const res = await fetch(`${PAYMENT_PROVIDER_URL}/v1/events?limit=2000`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ id: string; paymentId: string; userId: string; amount: number }>;
      };
      if (Array.isArray(json.data)) {
        paymentEvents = json.data;
      }
    }
  } catch {}

  const conn = await createDatabaseConnection({ uri: MONGODB_URI, dbName: DB_NAME });
  try {
    const ordersCol = conn.getOrdersCollection();
    const webhookCol = conn.getWebhookEventsCollection();

    const ordersCount = await ordersCol.countDocuments();
    const webhookEventsCount = await webhookCol.countDocuments();

    // Baseline seeded orders are 500,000
    const ordersCreatedFromTraffic = Math.max(0, ordersCount - 500000);
    const silentLossCount = Math.max(0, paymentEvents.length - ordersCreatedFromTraffic);
    const lossRatePercentage =
      paymentEvents.length > 0 ? Math.round((silentLossCount / paymentEvents.length) * 100) : 0;

    // Check last 20 events against orders collection
    const sampleEvents = paymentEvents.slice(-20).reverse();
    const paymentIds = sampleEvents.map((e) => e.paymentId);

    const existingOrders = await ordersCol
      .find({ paymentId: { $in: paymentIds } })
      .project({ paymentId: 1 })
      .toArray();
    const foundPaymentIds = new Set(existingOrders.map((o) => String(o['paymentId'])));

    const existingWebhooks = await webhookCol
      .find({ paymentId: { $in: paymentIds } })
      .project({ paymentId: 1 })
      .toArray();
    const foundWebhookIds = new Set(existingWebhooks.map((w) => String(w['paymentId'])));

    const recentLedger = sampleEvents.map((evt) => {
      const orderCreated = foundPaymentIds.has(evt.paymentId);
      const webhookRecorded = foundWebhookIds.has(evt.paymentId);
      return {
        eventId: evt.id,
        paymentId: evt.paymentId,
        userId: evt.userId,
        amount: evt.amount,
        recordedInWebhooks: webhookRecorded,
        orderCreatedInDb: orderCreated,
        status: orderCreated ? ('FULFILLED' as const) : ('SILENTLY_DROPPED' as const),
      };
    });

    return {
      paymentEventsCount: paymentEvents.length,
      webhookEventsCount,
      ordersCount,
      ordersCreatedFromTraffic,
      silentLossCount,
      lossRatePercentage,
      recentLedger,
    };
  } finally {
    await conn.close();
  }
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

