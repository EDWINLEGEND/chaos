import type { Db, Collection, ObjectId } from 'mongodb';
import type { CheckoutConfig } from '../config.js';

export interface ValidatedWebhookInput {
  eventId: string;
  paymentId: string;
  userId: string;
  amount: number;
}

export interface WebhookResult {
  eventId: string;
  orderId?: string;
  created: boolean;
  duplicate: boolean;
}

let ordersCollection: Collection;
let webhookEventsCollection: Collection;
let indexInitialized = false;

export function initWebhookService(db: Db, config: CheckoutConfig): void {
  ordersCollection = db.collection('orders');
  webhookEventsCollection = db.collection('webhook_events');
}

async function ensureIndex(): Promise<void> {
  if (indexInitialized) return;
  await ordersCollection.createIndex({ userId: 1, status: 1 });
  indexInitialized = true;
}

export async function processPaymentConfirmedWebhook(
  input: ValidatedWebhookInput
 ): Promise<WebhookResult> {
  await ensureIndex();

  // Persist the inbound event
  await webhookEventsCollection.insertOne({
    eventId: input.eventId,
    paymentId: input.paymentId,
    userId: input.userId,
    amount: input.amount,
    receivedAt: new Date(),
  });

  // Duplicate-order lookup using indexed { userId, status: "pending" }
  const existingOrder = await ordersCollection.findOne({
    userId: input.userId,
    status: 'pending',
  });

  if (existingOrder) {
    return {
      eventId: input.eventId,
      orderId: existingOrder._id.toString(),
      created: false,
      duplicate: true,
    };
  }

  // Create new order
  const orderResult = await ordersCollection.insertOne({
    userId: input.userId,
    paymentId: input.paymentId,
    amount: input.amount,
    status: 'pending',
    createdAt: new Date(),
  });

  return {
    eventId: input.eventId,
    orderId: orderResult.insertedId.toString(),
    created: true,
    duplicate: false,
  };
}
