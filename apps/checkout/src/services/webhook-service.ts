import { MongoDBClient } from '@chaos/shared';
import type { ObjectId } from 'mongodb';
import { withTimeout } from '../utils/async.js';
import type { CheckoutConfig } from '../config.js';

export interface ValidatedWebhookInput {
  eventId: string;
  type: 'payment-confirmed';
  paymentId: string;
  userId: string;
  amount: number;
}

interface WebhookProcessingResult {
  eventId: string;
  orderId: string;
  created: boolean;
  duplicate: boolean;
}

export async function processPaymentConfirmedWebhook(
  config: CheckoutConfig,
  input: ValidatedWebhookInput
): Promise<WebhookProcessingResult> {
  const client = MongoDBClient.getInstance();
  const db = client.db(config.mongoDatabase);
  const webhookEvents = db.collection('webhook_events');
  const orders = db.collection('orders');

  // 1. Persist inbound event to webhook_events
  await webhookEvents.insertOne({
    eventId: input.eventId,
    type: input.type,
    paymentId: input.paymentId,
    userId: input.userId,
    amount: input.amount,
    receivedAt: new Date(),
  });

  // 2. Duplicate-order lookup with timeout
  const duplicateCheck = withTimeout(
    orders.findOne({ userId: input.userId, status: 'pending' }),
    config.webhookTimeoutMs,
    'Duplicate-order lookup timed out'
  );

  const existingOrder = await duplicateCheck;

  if (existingOrder) {
    // 3a. Duplicate — no new order
    return {
      eventId: input.eventId,
      orderId: (existingOrder as { _id: ObjectId })._id.toHexString(),
      created: false,
      duplicate: true,
    };
  }

  // 3b. Create new order with timeout
  const orderInsert = withTimeout(
    orders.insertOne({
      userId: input.userId,
      status: 'pending',
      amount: input.amount,
      paymentId: input.paymentId,
      createdAt: new Date(),
    }),
    config.webhookTimeoutMs,
    'Order creation timed out'
  );

  const insertResult = await orderInsert;

  return {
    eventId: input.eventId,
    orderId: insertResult.insertedId.toHexString(),
    created: true,
    duplicate: false,
  };
}
