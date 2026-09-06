import type http from 'node:http';
import { parseJsonBody, sendJson, sendError, HttpError } from '../utils/http.js';
import {
  processPaymentConfirmedWebhook,
  type ValidatedWebhookInput,
} from '../services/webhook-service.js';

/**
 * Handles POST /webhooks/payment-confirmed
 *
 * Normal behavior:
 * 1. Validates payload structure at HTTP boundary.
 * 2. Persists inbound event to `webhook_events`.
 * 3. Performs duplicate-order lookup using indexed { userId, status: "pending" }.
 * 4. Creates order if no duplicate exists.
 * 5. Returns structured JSON with HTTP 200.
 * 6. Propagates errors into HTTP 500 with logging.
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
    const eventId = body['id'];
    const paymentId = body['paymentId'];
    const userId = body['userId'];
    const amount = body['amount'];

    if (
      typeof eventId !== 'string' ||
      typeof paymentId !== 'string' ||
      typeof userId !== 'string' ||
      typeof amount !== 'number'
    ) {
      sendError(
        res,
        400,
        'INVALID_PAYLOAD',
        'Missing or invalid required fields: id, paymentId, userId, amount'
      );
      return;
    }

    const input: ValidatedWebhookInput = {
      eventId,
      paymentId,
      userId,
      amount,
    };

    const result = await processPaymentConfirmedWebhook(input);

    sendJson(res, 200, {
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('webhook-handler error:', err);
    sendError(
      res,
      500,
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : 'An unexpected error occurred'
    );
  }
}
