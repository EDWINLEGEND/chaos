import type http from 'node:http';
import {
  parseJsonBody,
  sendJson,
  sendError,
  HttpError,
} from '../utils/http.js';
import {
  processPaymentConfirmedWebhook,
  type ValidatedWebhookInput,
} from '../services/webhook-service.js';

/**
 * Handles POST /webhooks/payment-confirmed
 *
 * Normal behavior:
 * 1. Validates payload structure at HTTP boundary.
 * 2. Persists inbound event to webhook_events.
 * 3. Performs duplicate-order lookup using indexed { userId, status: "pending" }.
 * 4. Creates order if no duplicate exists.
 * 5. Returns structured JSON with HTTP 200.
 * 6. On timeout/error: logs the error and queues order creation for async retry.
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
      sendError(res, 400, 'INVALID_PAYLOAD', 'Missing or invalid userId');
      return;
    }

    const amount = body['amount'];
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      sendError(res, 400, 'INVALID_PAYLOAD', 'Missing or invalid amount');
      return;
    }

    const input: ValidatedWebhookInput = {
      eventId: String(body['id'] ?? `evt_${Date.now()}`),
      paymentId: String(body['paymentId'] ?? ''),
      userId,
      amount,
    };

    // Process webhook: persist event, check for duplicate order, create if needed
    const result = await processPaymentConfirmedWebhook(input);

    sendJson(res, 200, {
      success: true,
      data: {
        eventId: input.eventId,
        orderId: result.orderId,
        created: result.created,
        duplicate: !result.created,
      },
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    const body = await safeParseBody(req);
    const userId = body?.userId ?? 'unknown';
    const eventId = body?.id ?? 'unknown';

    console.error(
      `[webhook:error] Payment-confirmed webhook failed for eventId=${eventId} userId=${userId}: ${error.message}`
    );

    // Queue order creation for async retry to prevent silent data divergence
    if (body) {
      const retryInput: ValidatedWebhookInput = {
        eventId: String(body.id ?? `evt_${Date.now()}`),
        paymentId: String(body.paymentId ?? ''),
        userId: String(body.userId),
        amount: Number(body.amount),
      };
      setImmediate(() => {
        processPaymentConfirmedWebhook(retryInput).catch((retryErr) => {
          console.error(
            `[webhook:retry-failed] Async retry failed for eventId=${retryInput.eventId} userId=${retryInput.userId}: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
          );
        });
      });
    }

    sendJson(res, 202, {
      received: true,
      retryQueued: Boolean(body),
    });
  }
}

/**
 * Safely parse request body for error context. Returns null on failure.
 */
async function safeParseBody(
  req: http.IncomingMessage
>): Promise<Record<string, unknown> | null> {
  try {
    return await parseJsonBody<Record<string, unknown>>(req);
  } catch {
    return null;
  }
}
