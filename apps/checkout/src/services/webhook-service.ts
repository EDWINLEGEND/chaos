import { ObjectId } from 'mongodb';
import {
  getWebhookEventsCollection,
  getOrdersCollection,
  type WebhookEventDocument,
  type OrderDocument,
  type WebhookProcessResult,
} from '@chaos/shared';
import { createOrder } from './order-service.js';
import { withTimeout } from '../utils/async.js';

export interface ValidatedWebhookInput {
  eventId: string;
  paymentId: string;
  userId: string;
  amount: number;
}

export type WebhookExecutionResult = WebhookProcessResult | { received: true };

/**
 * Persists an incoming payment-confirmed event into the `webhook_events` collection.
 * Executed prior to duplicate checks to maintain durable audit records for reconciliation.
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
 * Performs lookup using query shape { userId, status: "pending" }.
 */
export async function findPendingOrderByUser(
  userId: string,
  options?: { maxTimeMS?: number }
): Promise<OrderDocument | null> {
  const collection = getOrdersCollection();
  return collection.findOne(
    {
      userId,
      status: 'pending',
    },
    options?.maxTimeMS ? { maxTimeMS: options.maxTimeMS } : undefined
  );
}

export async function lookupAndCreateOrder(
  input: ValidatedWebhookInput,
  timeoutMs?: number
): Promise<WebhookProcessResult> {
  const existingOrder = await webhookService.findPendingOrderByUser(
    input.userId,
    timeoutMs ? { maxTimeMS: timeoutMs } : undefined
  );

  if (existingOrder) {
    return {
      eventId: input.eventId,
      orderId: existingOrder._id.toString(),
      created: false,
      duplicate: true,
    };
  }

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

/**
 * Processes a validated payment-confirmed webhook.
 * Bounded by timeoutMs on the unindexed duplicate-order lookup query.
 * If the duplicate lookup times out or encounters a database error:
 * the failure is caught, swallowed without logging, and an acknowledgment { received: true } is returned.
 * Order creation is strictly unreachable when a timeout occurs.
 */
export async function processPaymentConfirmedWebhook(
  input: ValidatedWebhookInput,
  timeoutMs: number = 800
): Promise<WebhookExecutionResult> {
  await persistWebhookEvent(input);

  try {
    // 1. Bound duplicate-order query by timeoutMs
    const existingOrder = await withTimeout(
      webhookService.findPendingOrderByUser(input.userId, { maxTimeMS: timeoutMs }),
      timeoutMs
    );

    // 2. Handle duplicate order if found within timeout
    if (existingOrder) {
      return {
        eventId: input.eventId,
        orderId: existingOrder._id.toString(),
        created: false,
        duplicate: true,
      };
    }

    // 3. Lookup succeeded within timeoutMs with no pending order found - create order
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
  } catch {
    // Swallowed timeout / database error
    return { received: true };
  }
}

export const webhookService = {
  persistWebhookEvent,
  findPendingOrderByUser,
  lookupAndCreateOrder,
  processPaymentConfirmedWebhook,
};

