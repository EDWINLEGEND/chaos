import { getDb } from '@chaos/shared';
import type { ObjectId } from 'mongodb';

export interface ValidatedWebhookInput {
  eventId: string;
  paymentId: string;
  userId: string;
  amount: number;
}

export interface WebhookProcessingResult {
  orderId: ObjectId;
  created: boolean;
}

/**
 * Process a payment-confirmed webhook event.
 *
 * 1. Persist inbound event to webhook_events collection.
 * 2. Check for existing pending order (duplicate-order detection).
 * 3. If no duplicate, create a new order.
 */
export async function processPaymentConfirmedWebhook(
  input: ValidatedWebhookInput
): Promise<WebhookProcessingResult> {
  const db = getDb();
  const orders = db.collection('orders');
  const webhookEvents = db.collection('webhook_events');

  // Ensure compound index exists for duplicate-order lookup
  await orders.createIndex({ userId: 1, status: 1 }, { background: true });

  // Persist inbound webhook event
  await webhookEvents.insertOne({
    eventId: input.eventId,
    type: 'payment-confirmed',
    paymentId: input.paymentId,
    userId: input.userId,
    amount: input.amount,
    receivedAt: new Date(),
  });

  // Duplicate-order check: look for existing pending order for this user
  const existingOrder = await orders.findOne({
    userId: input.userId,
    status: 'pending',
  });

  if (existingOrder) {
    // Duplicate delivery — order already exists
    return {
      orderId: existingOrder._id,
      created: false,
    };
  }

  // No duplicate found — create new order
  const insertResult = await orders.insertOne({
    userId: input.userId,
    paymentId: input.paymentId,
    amount: input.amount,
    status: 'pending',
    createdAt: new Date(),
  });

  return {
    orderId: insertResult.insertedId,
    created: true,
  };
}
