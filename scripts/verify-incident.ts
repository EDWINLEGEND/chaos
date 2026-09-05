import {
  initDatabase,
  getOrdersCollection,
  getWebhookEventsCollection,
  closeDatabase,
  type PaymentProviderEvent,
} from '@chaos/shared';

const PAYMENT_PROVIDER_URL = process.env['PAYMENT_PROVIDER_URL'] ?? 'http://127.0.0.1:3002';
const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme';
const DB_NAME = process.env['MONGODB_DATABASE'] ?? 'acme';

export async function runIncidentVerification(): Promise<void> {
  console.log('====================================================');
  console.log('Chaos Environment: Incident Verification Diagnostic');
  console.log('====================================================');

  // 1. Fetch total payment events from Payment Provider
  let paymentEventsCount = 0;
  try {
    const res = await fetch(`${PAYMENT_PROVIDER_URL}/v1/events`);
    if (!res.ok) {
      throw new Error(`Payment provider returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data: PaymentProviderEvent[]; count: number };
    paymentEventsCount = json.count;
  } catch (err) {
    console.error(`[verify] Warning: Could not reach Payment Provider at ${PAYMENT_PROVIDER_URL}:`, err);
  }

  // 2. Query MongoDB counts
  await initDatabase({ uri: MONGODB_URI, dbName: DB_NAME });
  const ordersCol = getOrdersCollection();
  const webhooksCol = getWebhookEventsCollection();

  const webhookEvents = await webhooksCol.find({}, { projection: { paymentId: 1 } }).toArray();
  const paymentIds = webhookEvents.map((w) => w.paymentId);
  const totalWebhooks = webhookEvents.length;
  const ordersFromWebhooks = paymentIds.length > 0
    ? await ordersCol.countDocuments({ paymentId: { $in: paymentIds } })
    : 0;
  const totalOrders = await ordersCol.countDocuments();

  // Calculate gaps
  const paymentToWebhookGap = paymentEventsCount - totalWebhooks;
  const webhookToOrderGap = totalWebhooks - ordersFromWebhooks;

  console.log('\n--- Systems of Record Comparison ---');
  console.log(`Payment events (Provider):       ${paymentEventsCount.toLocaleString()}`);
  console.log(`Webhook events (MongoDB):        ${totalWebhooks.toLocaleString()}`);
  console.log(`Orders created (from Webhooks):  ${ordersFromWebhooks.toLocaleString()}`);
  console.log(`Total orders in DB (with seed):  ${totalOrders.toLocaleString()}`);
  console.log('');
  console.log(`Payment → Webhook Gap:           ${paymentToWebhookGap.toLocaleString()}`);
  console.log(`Webhook → Order Gap:             ${webhookToOrderGap.toLocaleString()}`);
  console.log('----------------------------------------------------');

  if (totalWebhooks > 0 && totalWebhooks > ordersFromWebhooks) {
    console.log('[VERIFIED] INCIDENT CONFIRMED:');
    console.log('  Evidence shows silent webhook divergence where recorded webhook events');
    console.log(`  exceed orders created (${totalWebhooks} webhooks vs ${ordersFromWebhooks} orders, gap: ${webhookToOrderGap}).`);
  } else if (totalWebhooks === 0) {
    console.log('[INFO] No webhook events recorded yet. Run "pnpm break" to trigger traffic.');
  } else {
    console.log('[INFO] No divergence detected (Webhooks == Orders).');
  }

  console.log('====================================================\n');
  await closeDatabase();
}

if (process.argv[1]?.endsWith('verify-incident.ts') || process.argv[1]?.endsWith('verify-incident.js')) {
  runIncidentVerification().catch((err) => {
    console.error('[verify] Error during verification:', err);
    process.exit(1);
  });
}
