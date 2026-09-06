import type http from 'node:http';
import { parseJsonBody, sendJson, sendError } from '../utils/http.js';
import {
  processPaymentConfirmedWebhook,
  type ValidatedWebhookInput,
} from '../services/webhook-service.js';
import { loadConfig } from '../config.js';

/**
 * Handles POST /webhooks/payment-confirmed
 *
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
      type: 'payment-confirmed',
      paymentId,
      userId,
      amount,
    };

    const config = loadConfig();
    const result = await processPaymentConfirmedWebhook(config, input);

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
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] payment-confirmed processing failed: ${errorMessage}`);
    sendError(
      res,
      500,
      'WEBHOOK_PROCESSING_ERROR',
      `Webhook processing failed: ${errorMessage}`
    );
  }
}
