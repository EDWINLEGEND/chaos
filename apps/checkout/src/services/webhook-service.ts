import { getDb } from '@chaos/shared';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

export interface ValidatedWebhookInput {
  eventId: string;
  type: string;
  paymentId: string;
  userId: string;
  amount: number;
}

export interface WebhookProcessingResult {
  eventId: string;
  orderId: string | null;
  created: boolean;
  duplicate: boolean;
}

const WEBHOOK_TIMEOUT_MS = Number(process.env['WEBHOOK_TIMEOUT_MS'] || '2000');

/**
 * Ensure the compound index exists on the orders collection.
 * Called lazily on first webhook invocation to guarantee the index is
 * present even if `pnpm seed` was skipped or the collection was dropped.
 */
let indexEnsured = false;

async function ensureCompoundIndex(): Promise<void> {
  if (indexEnsured) return;
  try {
    const db = getDb();
    await db.collection('orders').createIndex(
      { userId: 1, status: 1 },
      { background: true }
    );
    indexEnsured = true;
  } catch {
    // Non-fatal: the index may already exist or be created by the seed script.
  }
}

export async function processPaymentConfirmedWebhook(
  input: ValidatedWebhookInput
): Promise<WebhookProcessingResult> {
  const db = getDb();

  // Ensure compound index exists (idempotent, no-op after first call)
  await ensureCompoundIndex();

  // 1. Persist the inbound webhook event to webhook_events
  const webhookEvent = {
    _id: new ObjectId(),
    eventId: input.eventId,
    type: input.type,
    paymentId: input.paymentId,
    userId: input.userId,
    amount: input.amount,
    createdAt: new Date(),
  };

  await db.collection('webhook_events').insertOne(webhookEvent);

  // 2. Duplicate-order lookup with timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Duplicate-order lookup exceeded ${WEBHOOK_TIMEOUT_MS}ms timeout`));
    }, WEBHOOK_TIMEOUT_MS);
  });

  const existingOrder = await Promise.race([
    db.collection('orders').findOne({ userId: input.userId, status: 'pending' }),
    timeoutPromise,
  ]);

  if (existingOrder) {
    // Duplicate: an order for this user is already pending
    return {
      eventId: input.eventId,
      orderId: existingOrder._id.toString(),
      created: false,
      duplicate: true,
    };
  }

  // 3. Create the new order
  const order = {
    _id: new ObjectId(),
    userId: input.userId,
    paymentId: input.paymentId,
    eventId: input.eventId,
    amount: input.amount,
    status: 'pending' as const,
    createdAt: new Date(),
  };

  await db.collection('orders').insertOne(order);

  return {
    eventId: input.eventId,
    orderId: order._id.toString(),
    created: true,
    duplicate: false,
  };
}
