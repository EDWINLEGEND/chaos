import type { PaymentWebhookPayload, ServiceHealth } from './types.js';

/**
 * Validates if a webhook payload represents a successful payment event.
 */
export function isPaymentSuccessWebhook(payload: unknown): payload is PaymentWebhookPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as Partial<PaymentWebhookPayload>;
  return (
    candidate.eventType === 'payment.succeeded' &&
    candidate.status === 'succeeded' &&
    typeof candidate.orderId === 'string' &&
    candidate.orderId.length > 0 &&
    typeof candidate.amount === 'number' &&
    candidate.amount >= 0
  );
}

/**
 * Creates a standard healthcheck payload.
 */
export function createHealthReport(serviceName: string, startTime: number): ServiceHealth {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  return {
    status: 'ok',
    service: serviceName,
    uptimeSeconds,
    timestamp: new Date().toISOString(),
  };
}
