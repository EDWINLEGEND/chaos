import type http from 'node:http';
import { parseJsonBody, sendJson, sendError, HttpError } from '../utils/http.js';
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
 * 5. Returns structured JSON with HTTP 200.
 * 6. Propagates errors into HTTP 500 without swallowing.
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
    const paymentId = body['paymentId'];
    const amount = body['amount'];
    const eventId = body['id'];

    if (
      typeof userId !== 'string' ||
      typeof paymentId !== 'string' ||
      typeof amount !== 'number' ||
      typeof eventId !== 'string'
    ) {
      sendError(
        res,
        400,
        'INVALID_PAYLOAD',
        'Missing or invalid required fields: id, userId, paymentId, amount'
      );
      return;
    }

    const input: ValidatedWebhookInput = {
      eventId,
      userId,
      paymentId,
      amount,
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
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Internal server error';
    console.error(`[webhook] payment-confirmed handler error: ${message}`);
    sendError(
      res,
      500,
      'WEBHOOK_PROCESSING_ERROR',
      `Failed to process payment-confirmed webhook: ${message}`
    );
  }
}
