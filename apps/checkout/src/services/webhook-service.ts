import { setTimeout as sleep } from 'node:timers/promises';
import type { Db } from 'mongodb';
import type { Order, WebhookEvent } from '@chaos/shared';

export interface ValidatedWebhookInput {
  eventId: string;
  paymentId: string;
  userId: string;
  amount: number;
  webhookTimeoutMs: number;
}

export interface WebhookResult {
  eventId: string;
  orderId: string;
  created: boolean;
  duplicate: boolean;
}

export interface WebhookTimeoutResult {
  timeout: true;
  eventId: string;
  error?: string;
}

export type ProcessWebhookResponse = WebhookResult | WebhookTimeoutResult;

/**
 * Processes a payment-confirmed webhook event.
 *
 * 1. Persists the inbound event to webhook_events (durable record).
 * 2. Checks for an existing pending order for this userId (idempotency).
 * 3. If no duplicate exists, creates a new order.
 *
 * The duplicate-order lookup uses { userId, status: "pending" } against
 * the orders collection. With the compound index on {userId, status},
 * this query uses IXSCAN and completes in single-digit milliseconds.
 */
export async function processPaymentConfirmedWebhook(
  db: Db,
  input: ValidatedWebhookInput
): Promise<ProcessWebhookResponse> {
  const { eventId, paymentId, userId, amount, webhookTimeoutMs } = input;
  const webhookEvents = db.collection<WebhookEvent>('webhook_events');
  const orders = db.collection<Order>('orders');

  // 1. Persist the inbound webhook event (durable audit trail)
  const webhookDoc: WebhookEvent = {
    eventId,
    paymentId,
    userId,
    amount,
    type: 'payment-confirmed',
    receivedAt: new Date(),
    status: 'processed',
  };
  await webhookEvents.insertOne(webhookDoc);

  // 2. Timeout-bounded duplicate check + order creation
  const deadline = Date.now() + webhookTimeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      // Check for existing pending order (duplicate delivery protection)
      const existingOrder = await orders.findOne({
        userId,
        status: 'pending',
      });

      if (existingOrder) {
        return {
          eventId,
          orderId: existingOrder._id!.toString(),
          created: false,
          duplicate: true,
        };
      }

      // No duplicate — create the order
      const newOrder: Omit<Order, '_id'> = {
        userId,
        paymentId,
        amount,
        status: 'pending',
        createdAt: new Date(),
      };

      const result = await orders.insertOne(newOrder as Order);

      return {
        eventId,
        orderId: result.insertedId.toString(),
        created: true,
        duplicate: false,
      };
    } catch (err) {
      lastError = err;
      // Retry on transient errors within the timeout window
      await sleep(10);
    }
  }

  // 3. Timeout expired — propagate error so the caller (and payment provider)
  //    sees a failure and can retry delivery.
  const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(
    `[webhook] Timeout after ${webhookTimeoutMs}ms processing event ${eventId} for user ${userId}: ${errorMsg}`
  );

  return {
    timeout: true as const,
    eventId,
    error: `Webhook processing timed out after ${webhookTimeoutMs}ms: ${errorMsg}`,
  };
}
