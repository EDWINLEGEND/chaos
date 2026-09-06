import type http from 'node:http';
import { parseJsonBody, sendJson, sendError } from '../utils/http.js';
import {
  processPaymentConfirmedWebhook,
  type ValidatedWebhookInput,
  type WebhookTimeoutResult,
} from '../services/webhook-service.js';
import type { Db } from 'mongodb';
import type { CheckoutConfig } from '../config.js';

/**
 * Handles POST /webhooks/payment-confirmed
 *
 * Flow:
 * 1. Validates payload structure at HTTP boundary.
 * 2. Persists inbound event to `webhook_events`.
 * 3. Performs duplicate-order lookup using indexed { userId, status: "pending" }.
 * 4. Creates order if no duplicate exists.
 * 5. Returns structured JSON with HTTP 200.
 * 6. On timeout or error, returns HTTP 500 so the payment provider retries.
 */
export async function handlePaymentConfirmedWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: Db,
  config: CheckoutConfig
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
        'Required fields: id (string), paymentId (string), userId (string), amount (number)'
      );
      return;
    }

    const input: ValidatedWebhookInput = {
      eventId,
      paymentId,
      userId,
      amount,
      webhookTimeoutMs: config.webhookTimeoutMs,
    };

    const result = await processPaymentConfirmedWebhook(db, input);

    // Check if processing timed out — return error so payment provider retries
    if ('timeout' in result && result.timeout) {
      const timeoutResult = result as WebhookTimeoutResult;
      sendError(
        res,
        500,
        'WEBHOOK_TIMEOUT',
        timeoutResult.error || 'Webhook processing timed out'
      );
      return;
    }

    sendJson(res, 200, {
      success: true,
      data: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[webhook] Error handling payment-confirmed: ${message}`);
    sendError(res, 500, 'WEBHOOK_ERROR', message);
  }
}
