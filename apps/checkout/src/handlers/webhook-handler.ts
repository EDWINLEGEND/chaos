import type http from 'node:http';
import { parseJsonBody, sendJson, sendError, HttpError } from '../utils/http.js';
import {
  processPaymentConfirmedWebhook,
  type ValidatedWebhookInput,
} from '../services/webhook-service.js';

/**
 * Handles POST /webhooks/payment-confirmed
 *
 * Normal behavior (baseline before intentional vulnerability):
 * 1. Validates payload structure at HTTP boundary.
 * 2. Persists inbound event to `webhook_events`.
 * 3. Performs duplicate-order lookup using { userId, status: "pending" } (now indexed).
 * 4. Creates order if no duplicate exists.
 * 5. Returns structured JSON with HTTP 200 on success.
 * 6. Returns HTTP 502 when order creation fails so payment providers retry.
 * 7. Returns HTTP 500 on unexpected errors.
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
    const eventId = body['id'] as string | undefined;
    const paymentId = body['paymentId'] as string | undefined;
    const userId = body['userId'] as string | undefined;
    const amount = body['amount'] as number | undefined;

    if (!eventId || !paymentId || !userId || amount == null) {
      sendError(
        res,
        400,
        'MISSING_FIELDS',
        'Required fields: id, paymentId, userId, amount'
      );
      return;
    }

    const validatedInput: ValidatedWebhookInput = {
      eventId,
      paymentId,
      userId,
      amount: Number(amount),
    };

    // Process the webhook — this performs the order lookup and creation
    const result = await processPaymentConfirmedWebhook(validatedInput);

    sendJson(res, 200, {
      success: true,
      data: result,
    });
  } catch (err) {
    // If the error is already an HttpError (from validation), re-throw
    if (err instanceof HttpError) {
      sendError(res, err.statusCode, err.code, err.message);
      return;
    }

    // Order lookup/creation failure — return 502 so payment provider retries
    const message = err instanceof Error ? err.message : String(err);

    // Distinguish between order-related failures (502 → retry) and
    // unexpected errors (500 → alerting)
    const isOrderFailure =
      message.includes('Order creation failed') ||
      message.includes('insertOne') ||
      message.includes('duplicate key');

    if (isOrderFailure) {
      sendError(
        res,
        502,
        'ORDER_CREATION_FAILED',
        `Order creation failed: ${message}`
      );
      return;
    }

    sendError(res, 500, 'INTERNAL_ERROR', `Webhook processing failed: ${message}`);
  }
}
