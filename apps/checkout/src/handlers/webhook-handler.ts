import type http from 'node:http';
import {
  webhookEventsReceivedTotal,
  ordersCreatedTotal,
  silentOrderLossTotal,
  estimatedRevenueLossCents,
} from '@chaos/shared';
import { parseJsonBody, sendJson, sendError, HttpError } from '../utils/http.js';
import {
  processPaymentConfirmedWebhook,
  type ValidatedWebhookInput,
} from '../services/webhook-service.js';
import type { CheckoutConfig } from '../config.js';

/**
 * Handles POST /webhooks/payment-confirmed
 */
export async function handlePaymentConfirmedWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
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

    // Validate eventId (accepts either 'eventId' or 'id')
    const rawEventId = body['eventId'] ?? body['id'];
    if (typeof rawEventId !== 'string' || rawEventId.trim().length === 0) {
      sendError(res, 400, 'INVALID_EVENT_ID', 'Field "eventId" (or "id") is required and must be a non-empty string');
      return;
    }
    const eventId = rawEventId.trim();

    // Validate paymentId
    if (typeof body['paymentId'] !== 'string' || body['paymentId'].trim().length === 0) {
      sendError(res, 400, 'INVALID_PAYMENT_ID', 'Field "paymentId" is required and must be a non-empty string');
      return;
    }
    const paymentId = body['paymentId'].trim();

    // Validate userId
    if (typeof body['userId'] !== 'string' || body['userId'].trim().length === 0) {
      sendError(res, 400, 'INVALID_USER_ID', 'Field "userId" is required and must be a non-empty string');
      return;
    }
    const userId = body['userId'].trim();

    // Validate amount (minor currency units, positive integer)
    const amount = body['amount'];
    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      sendError(
        res,
        400,
        'INVALID_AMOUNT',
        'Field "amount" must be a positive integer in minor currency units (e.g. 4999 for $49.99)'
      );
      return;
    }

    const validatedInput: ValidatedWebhookInput = {
      eventId,
      paymentId,
      userId,
      amount,
    };

    const result = await processPaymentConfirmedWebhook(validatedInput, config.webhookTimeoutMs);

    if ('received' in result && result.received === true) {
      webhookEventsReceivedTotal.inc({ status: 'timeout_dropped' });
      silentOrderLossTotal.inc();
      estimatedRevenueLossCents.inc(validatedInput.amount);
      sendJson(res, 200, { received: true });
      return;
    }

    if ('created' in result && result.created === true) {
      webhookEventsReceivedTotal.inc({ status: 'created' });
      ordersCreatedTotal.inc();
    } else if ('duplicate' in result && result.duplicate === true) {
      webhookEventsReceivedTotal.inc({ status: 'duplicate' });
    }

    sendJson(res, 200, {
      success: true,
      data: result,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(res, err.statusCode, err.code, err.message);
      return;
    }

    sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Failed to process webhook event');
  }
}
