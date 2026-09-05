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

/**
 * Checks for duplicate pending orders and creates the order if absent.
 * Checks signal.aborted before creating order to prevent late writes after timeout.
 */
export async function lookupAndCreateOrder(
  input: ValidatedWebhookInput,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<WebhookProcessResult> {
  const existingOrder = await webhookService.findPendingOrderByUser(
    input.userId,
    timeoutMs ? { maxTimeMS: timeoutMs } : undefined
  );

  if (signal?.aborted) {
    throw new Error('Operation aborted: duplicate lookup timed out');
  }

  if (existingOrder) {
    return {
      eventId: input.eventId,
      orderId: existingOrder._id.toString(),
      created: false,
      duplicate: true,
    };
  }

  if (signal?.aborted) {
    throw new Error('Operation aborted: duplicate lookup timed out');
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
 * Bounded by timeoutMs. If the processing operation times out or encounters an error,
 * the failure is caught and an acknowledgment response is returned.
 * An AbortController guarantees that background execution cannot create an order after timeout.
 */
export async function processPaymentConfirmedWebhook(
  input: ValidatedWebhookInput,
  timeoutMs: number = 2000
): Promise<WebhookExecutionResult> {
  await persistWebhookEvent(input);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await withTimeout(
      lookupAndCreateOrder(input, controller.signal, timeoutMs),
      timeoutMs
    );
  } catch {
    controller.abort();
    return { received: true };
  } finally {
    clearTimeout(timer);
  }
}

export const webhookService = {
  persistWebhookEvent,
  findPendingOrderByUser,
  lookupAndCreateOrder,
  processPaymentConfirmedWebhook,
};
