import { ObjectId } from 'mongodb';
import {
  getWebhookEventsCollection,
  getOrdersCollection,
  type WebhookEventDocument,
  type OrderDocument,
  type WebhookProcessResult,
} from '@chaos/shared';
import { createOrder } from './order-service.js';

export interface ValidatedWebhookInput {
  eventId: string;
  paymentId: string;
  userId: string;
  amount: number;
}

/**
 * Persists an incoming payment-confirmed event into the `webhook_events` collection.
 * Must be executed before duplicate lookup to guarantee durable audit trails for OpsRoom reconciliation.
 */
export async function persistWebhookEvent(input: ValidatedWebhookInput): Promise<WebhookEventDocument> {
  const collection = getWebhookEventsCollection();

  const eventDocument: WebhookEventDocument = {
    _id: new ObjectId(),
    eventId: input.eventId,
    paymentId: input.paymentId,
    userId: input.userId,
    type: 'payment-confirmed',
    createdAt: new Date(),
  };

  const result = await collection.insertOne(eventDocument);
  if (!result.acknowledged) {
    throw new Error('Database insertion of webhook_event was not acknowledged by MongoDB');
  }

  return eventDocument;
}

/**
 * Queries for an existing pending order for the given user.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Must use the exact query shape { userId, status: "pending" }.
 * 2. There is intentionally NO supporting compound index on { userId: 1, status: 1 }.
 * 3. In subsequent prompts, this exact query performs a COLLSCAN and will be the target of the OpsRoom investigation.
 */
export async function findPendingOrderByUser(userId: string): Promise<OrderDocument | null> {
  const collection = getOrdersCollection();
  return collection.findOne({
    userId,
    status: 'pending',
  });
}

/**
 * Processes a validated payment-confirmed webhook.
 * 
 * Flow:
 * 1. Durably records event in `webhook_events`
 * 2. Checks for existing pending order for this user (unindexed COLLSCAN)
 * 3. If duplicate found: returns existing order reference without creating a new order
 * 4. If no pending order found: creates a new pending order
 */
export async function processPaymentConfirmedWebhook(
  input: ValidatedWebhookInput
): Promise<WebhookProcessResult> {
  // Step 1: Record received event durably in webhook_events
  await persistWebhookEvent(input);

  // Step 2: Check for existing duplicate pending order (unindexed COLLSCAN query)
  const existingOrder = await findPendingOrderByUser(input.userId);

  if (existingOrder) {
    // Duplicate detected - return reference to existing order without creating a duplicate
    return {
      eventId: input.eventId,
      orderId: existingOrder._id.toString(),
      created: false,
      duplicate: true,
    };
  }

  // Step 3: No duplicate exists - create order normally
  const newOrder = await createOrder({
    userId: input.userId,
    paymentId: input.paymentId,
    amount: input.amount,
    status: 'pending',
  });

  return {
    eventId: input.eventId,
    orderId: newOrder._id.toString(),
    created: true,
    duplicate: false,
  };
}
