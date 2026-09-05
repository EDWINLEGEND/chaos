import { describe, it, expect, afterEach } from 'vitest';
import {
  isPaymentSuccessWebhook,
  createHealthReport,
  checkDatabaseConnectivity,
  getDb,
  closeDatabase,
} from '../src/index.js';

describe('@chaos/shared foundation', () => {
  afterEach(async () => {
    await closeDatabase();
  });

  it('correctly validates valid payment success webhook payload', () => {
    const validPayload = {
      eventId: 'evt_123',
      eventType: 'payment.succeeded' as const,
      paymentId: 'pay_456',
      orderId: 'ord_789',
      amount: 4999,
      currency: 'USD',
      status: 'succeeded' as const,
      timestamp: '2026-09-05T08:30:00Z',
    };

    expect(isPaymentSuccessWebhook(validPayload)).toBe(true);
  });

  it('rejects invalid or incomplete webhook payload', () => {
    expect(isPaymentSuccessWebhook(null)).toBe(false);
    expect(isPaymentSuccessWebhook({})).toBe(false);
    expect(
      isPaymentSuccessWebhook({
        eventType: 'payment.failed',
        status: 'failed',
        orderId: 'ord_1',
      })
    ).toBe(false);
  });

  it('generates well-formed health report', () => {
    const startTime = Date.now() - 5000;
    const report = createHealthReport('checkout', startTime);

    expect(report.status).toBe('ok');
    expect(report.service).toBe('checkout');
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(5);
    expect(new Date(report.timestamp).getTime()).not.toBeNaN();
  });

  it('reports database down when client is not initialized', async () => {
    const health = await checkDatabaseConnectivity();
    expect(health.status).toBe('down');
    expect(health.error).toBe('Client not connected');
  });

  it('throws an error if getDb() is invoked prior to initDatabase()', () => {
    expect(() => getDb()).toThrow(/Database has not been initialized/);
  });
});
