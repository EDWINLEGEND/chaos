import type http from 'node:http';
import { parseJsonBody, sendJson, sendError } from '../utils/http.js';
import {
  processPaymentConfirmedWebhook,
  type ValidatedWebhookInput,
} from '../services/webhook-service.js';

/**
 * Handles POST /webhooks/payment-confirmed
 *
 * 1. Validates payload structure at HTTP boundary.
 * 2. Persists inbound event to `webhook_events`.
 * 3. Performs duplicate-order lookup using { userId, status: "pending" }.
 * 4. Creates order if no duplicate exists.
 * 5. On timeout or database error: logs the error, queues async retry,
 *    and returns HTTP 202 Accepted.
 */
export async function handlePaymentConfirmedWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(req);

    // Validate event type
    if (body['type'] !== 'payment-confirmed') {
      sendError(
        res,
        400,
        'INVALID_EVENT_TYPE',
        `Expected event type "payment-confirmed", received "${String(body['type'])}"`
      );
      return;
    }

    // Validate required fields
    const userId = body['userId'];
    if (typeof userId !== 'string' || userId.length === 0) {
      sendError(res, 400, 'MISSING_USER_ID', 'Request must include a valid "userId" string.');
      return;
    }

    const input: ValidatedWebhookInput = {
      eventId: String(body['id'] ?? ''),
      type: String(body['type']),
      paymentId: String(body['paymentId'] ?? ''),
      userId,
      amount: typeof body['amount'] === 'number' ? body['amount'] : 0,
    };

    const result = await processPaymentConfirmedWebhook(input);

    sendJson(res, 200, {
      success: true,
      data: {
        eventId: result.eventId,
        orderId: result.orderId,
        created: result.created,
        duplicate: result.duplicate,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[webhook-handler] Payment-confirmed processing failed: ${message}`);

    // Queue an async retry so the order can still be created
    setImmediate(async () => {
      try {
        const body = await parseJsonBody<Record<string, unknown>>(
          Object.assign(Object.create(req), { headers: req.headers }) as http.IncomingMessage
        );
        const input: ValidatedWebhookInput = {
          eventId: String(body['id'] ?? ''),
          type: String(body['type']),
          paymentId: String(body['paymentId'] ?? ''),
          userId: String(body['userId'] ?? ''),
          amount: typeof body['amount'] === 'number' ? body['amount'] : 0,
        };
        await processPaymentConfirmedWebhook(input);
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error(`[webhook-handler] Async retry also failed: ${retryMsg}`);
      }
    });

    // Return 202 to indicate accepted for background processing
    sendJson(res, 202, { received: true });
  }
}
