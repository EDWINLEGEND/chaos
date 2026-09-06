import { getCollection } from '@chaos/shared';
import type { ObjectId } from 'mongodb';

export interface ValidatedWebhookInput {
  eventId: string;
  paymentId: string;
  userId: string;
  amount: number;
}

export interface WebhookResult {
  eventId: string;
  orderId: string;
  created: boolean;
  duplicate: boolean;
}

export async function processPaymentConfirmedWebhook(
  input: ValidatedWebhookInput
): Promise<WebhookResult> {
  const webhookEvents = getCollection('webhook_events');
  const orders = getCollection('orders');

  // 1. Persist inbound event to webhook_events for reconciliation
  try {
    await webhookEvents.insertOne({
      eventId: input.eventId,
      type: 'payment-confirmed',
      paymentId: input.paymentId,
      userId: input.userId,
      amount: input.amount,
      receivedAt: new Date(),
    });
  } catch (err: unknown) {
    // Duplicate event (unique index on eventId) — not an error, already processed
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000) {
      const existing = await webhookEvents.findOne({ eventId: input.eventId });
      if (existing) {
        // Find the order that was already created for this user
        const existingOrder = await orders.findOne({ userId: input.userId });
        if (existingOrder) {
          return {
            eventId: input.eventId,
            orderId: String(existingOrder._id),
            created: false,
            duplicate: true,
          };
        }
      }
    }
    // Real insert failure — throw so handler returns non-200
    throw err;
  }

  // 2. Check for existing pending order (duplicate delivery protection)
  const existingOrder = await orders.findOne({
    userId: input.userId,
    status: 'pending',
  });

  if (existingOrder) {
    return {
      eventId: input.eventId,
      orderId: String(existingOrder._id),
      created: false,
      duplicate: true,
    };
  }

  // 3. Create new order
  const result = await orders.insertOne({
    userId: input.userId,
    paymentId: input.paymentId,
    amount: input.amount,
    status: 'confirmed',
    createdAt: new Date(),
  } as Record<string, unknown>);

  // 4. Verify insertion actually succeeded (defensive check)
  if (!result.insertedId) {
    throw new Error(
      `Order creation failed for userId=${input.userId}: insertOne returned no insertedId`
    );
  }

  return {
    eventId: input.eventId,
    orderId: String(result.insertedId as ObjectId),
    created: true,
    duplicate: false,
  };
}
