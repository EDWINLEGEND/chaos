import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import { InMemoryPaymentStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import type { PaymentProviderConfig } from '../src/config.js';

describe('Fake Payment Provider Service', () => {
  let providerServer: http.Server;
  let providerBaseUrl: string;

  let mockCheckoutServer: http.Server;
  let mockCheckoutUrl: string;
  let mockCheckoutHandler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string
  ) => void;

  let store: InMemoryPaymentStore;
  let config: PaymentProviderConfig;

  beforeAll(async () => {
    // 1. Setup mock checkout receiver server
    mockCheckoutServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (mockCheckoutHandler) {
          mockCheckoutHandler(req, res, body);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockCheckoutServer.listen(0, () => {
        const addr = mockCheckoutServer.address();
        if (addr && typeof addr === 'object') {
          mockCheckoutUrl = `http://127.0.0.1:${addr.port}/webhooks/payment-confirmed`;
        }
        resolve();
      });
    });

    // 2. Setup payment provider server
    config = {
      nodeEnv: 'test',
      port: 0,
      checkoutWebhookUrl: mockCheckoutUrl,
    };

    store = new InMemoryPaymentStore();
    const app = createApp(config, store);
    providerServer = http.createServer(app);

    await new Promise<void>((resolve) => {
      providerServer.listen(0, () => {
        const addr = providerServer.address();
        if (addr && typeof addr === 'object') {
          providerBaseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await store.clear();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => providerServer.close(() => resolve()));
    await new Promise<void>((resolve) => mockCheckoutServer.close(() => resolve()));
  });

  describe('Health Endpoint', () => {
    it('returns HTTP 200 with service health report', async () => {
      const res = await fetch(`${providerBaseUrl}/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ok');
      expect(json.service).toBe('fake-payment-provider');
      expect(typeof json.uptimeSeconds).toBe('number');
    });
  });

  describe('Payment Creation: POST /v1/test/payments', () => {
    it('creates a new payment event with unique IDs and returns 201', async () => {
      const res = await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user_test_101',
          amount: 4999,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();

      expect(json.id).toMatch(/^evt_[a-f0-9]{16}$/);
      expect(json.paymentId).toMatch(/^pay_[a-f0-9]{16}$/);
      expect(json.type).toBe('payment-confirmed');
      expect(json.userId).toBe('user_test_101');
      expect(json.amount).toBe(4999);
      expect(typeof json.created).toBe('number');
      expect(json.created).toBeGreaterThan(1700000000); // Valid recent Unix seconds timestamp
    });

    it('generates unique payment and event IDs for consecutive payments', async () => {
      const res1 = await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_1', amount: 1000 }),
      });
      const res2 = await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_2', amount: 2000 }),
      });

      const json1 = await res1.json();
      const json2 = await res2.json();

      expect(json1.paymentId).not.toBe(json2.paymentId);
      expect(json1.id).not.toBe(json2.id);
    });

    it('stores created payment in internal store', async () => {
      const res = await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_store_check', amount: 3500 }),
      });
      const json = await res.json();

      const stored = await store.findById(json.paymentId);
      expect(stored).not.toBeNull();
      expect(stored?.paymentId).toBe(json.paymentId);
      expect(stored?.id).toBe(json.id);
      expect(stored?.userId).toBe('user_store_check');
      expect(stored?.amount).toBe(3500);
      expect(stored?.delivered).toBe(false);
    });

    it('rejects missing or empty userId with 400', async () => {
      const res = await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_USER_ID');
    });

    it('rejects invalid amounts (negative, zero, float, non-number) with 400', async () => {
      const invalidAmounts = [-500, 0, 19.99, '5000', null];

      for (const amount of invalidAmounts) {
        const res = await fetch(`${providerBaseUrl}/v1/test/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user_1', amount }),
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.code).toBe('INVALID_AMOUNT');
      }
    });

    it('rejects malformed JSON with 400', async () => {
      const res = await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ malformed json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_JSON');
    });
  });

  describe('Event Listing & Filtering: GET /v1/events', () => {
    it('returns empty array and count 0 when no payments exist', async () => {
      const res = await fetch(`${providerBaseUrl}/v1/events`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ data: [], count: 0 });
    });

    it('returns all payment events with canonical fields', async () => {
      await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_list_1', amount: 1200 }),
      });
      await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_list_2', amount: 2400 }),
      });

      const res = await fetch(`${providerBaseUrl}/v1/events`);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.count).toBe(2);
      expect(json.data.length).toBe(2);

      const first = json.data[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('type', 'payment-confirmed');
      expect(first).toHaveProperty('paymentId');
      expect(first).toHaveProperty('userId');
      expect(first).toHaveProperty('amount');
      expect(first).toHaveProperty('created');
      // Verify internal fields are omitted
      expect(first).not.toHaveProperty('delivered');
      expect(first).not.toHaveProperty('lastDeliveryStatus');
    });

    it('correctly filters events with created[gt] timestamp', async () => {
      // Create event 1 with timestamp 1700000000
      await store.create({
        userId: 'user_filter_1',
        amount: 1000,
        created: 1700000000,
      });

      // Create event 2 with later timestamp 1700000100
      const payment2 = await store.create({
        userId: 'user_filter_2',
        amount: 2000,
        created: 1700000100,
      });

      // Filter created[gt]=1700000050 -> should only return event 2
      const filterRes = await fetch(`${providerBaseUrl}/v1/events?created[gt]=1700000050`);
      expect(filterRes.status).toBe(200);
      const filterJson = await filterRes.json();
      expect(filterJson.count).toBe(1);
      expect(filterJson.data[0].paymentId).toBe(payment2.paymentId);

      // Filter created[gt]=1700000200 -> should return 0 events
      const emptyRes = await fetch(`${providerBaseUrl}/v1/events?created[gt]=1700000200`);
      const emptyJson = await emptyRes.json();
      expect(emptyJson.count).toBe(0);
      expect(emptyJson.data).toEqual([]);
    });

    it('rejects malformed created[gt] values with 400', async () => {
      const invalidTimestamps = ['invalid', '-100', '12.34', 'null'];

      for (const val of invalidTimestamps) {
        const res = await fetch(`${providerBaseUrl}/v1/events?created[gt]=${val}`);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.code).toBe('INVALID_TIMESTAMP');
      }
    });
  });

  describe('Webhook Delivery: POST /v1/test/payments/:paymentId/deliver', () => {
    it('returns 404 for unknown paymentId', async () => {
      const res = await fetch(`${providerBaseUrl}/v1/test/payments/pay_nonexistent/deliver`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('PAYMENT_NOT_FOUND');
    });

    it('delivers payment event to real HTTP receiver and records success on 200', async () => {
      let receivedWebhookPayload: Record<string, unknown> | null = null;

      mockCheckoutHandler = (_req, res, body) => {
        receivedWebhookPayload = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { orderId: 'ord_123' } }));
      };

      // 1. Create test payment
      const createRes = await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_deliver_success', amount: 5500 }),
      });
      const payment = await createRes.json();

      // 2. Deliver payment
      const deliverRes = await fetch(
        `${providerBaseUrl}/v1/test/payments/${payment.paymentId}/deliver`,
        { method: 'POST' }
      );
      expect(deliverRes.status).toBe(200);
      const deliverJson = await deliverRes.json();

      expect(deliverJson.delivered).toBe(true);
      expect(deliverJson.statusCode).toBe(200);
      expect(deliverJson.paymentId).toBe(payment.paymentId);

      // 3. Verify payload delivered to mock checkout server
      expect(receivedWebhookPayload).not.toBeNull();
      expect(receivedWebhookPayload?.['id']).toBe(payment.id);
      expect(receivedWebhookPayload?.['type']).toBe('payment-confirmed');
      expect(receivedWebhookPayload?.['paymentId']).toBe(payment.paymentId);
      expect(receivedWebhookPayload?.['userId']).toBe('user_deliver_success');
      expect(receivedWebhookPayload?.['amount']).toBe(5500);

      // 4. Verify internal delivery state updated
      const stored = await store.findById(payment.paymentId);
      expect(stored?.delivered).toBe(true);
      expect(stored?.lastDeliveryStatus).toBe(200);
      expect(stored?.lastAttemptAt).toBeInstanceOf(Date);
    });

    it('handles checkout non-2xx (500) failure and records delivery failure', async () => {
      mockCheckoutHandler = (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error' }));
      };

      const createRes = await fetch(`${providerBaseUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_deliver_fail', amount: 7700 }),
      });
      const payment = await createRes.json();

      const deliverRes = await fetch(
        `${providerBaseUrl}/v1/test/payments/${payment.paymentId}/deliver`,
        { method: 'POST' }
      );
      expect(deliverRes.status).toBe(200);
      const deliverJson = await deliverRes.json();

      expect(deliverJson.delivered).toBe(false);
      expect(deliverJson.statusCode).toBe(500);

      const stored = await store.findById(payment.paymentId);
      expect(stored?.delivered).toBe(false);
      expect(stored?.lastDeliveryStatus).toBe(500);

      // Canonical event data remains intact for reconciliation
      const eventsRes = await fetch(`${providerBaseUrl}/v1/events`);
      const eventsJson = await eventsRes.json();
      expect(eventsJson.count).toBe(1);
      expect(eventsJson.data[0].paymentId).toBe(payment.paymentId);
    });

    it('handles network connection error gracefully with 502', async () => {
      // Point config to unreachable port
      const brokenConfig: PaymentProviderConfig = {
        nodeEnv: 'test',
        port: 0,
        checkoutWebhookUrl: 'http://127.0.0.1:19', // Dead port
      };
      const brokenApp = createApp(brokenConfig, store);
      const tempServer = http.createServer(brokenApp);

      let tempBaseUrl = '';
      await new Promise<void>((resolve) => {
        tempServer.listen(0, () => {
          const addr = tempServer.address();
          if (addr && typeof addr === 'object') {
            tempBaseUrl = `http://127.0.0.1:${addr.port}`;
          }
          resolve();
        });
      });

      try {
        const createRes = await fetch(`${tempBaseUrl}/v1/test/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user_net_err', amount: 1000 }),
        });
        const payment = await createRes.json();

        const deliverRes = await fetch(
          `${tempBaseUrl}/v1/test/payments/${payment.paymentId}/deliver`,
          { method: 'POST' }
        );
        expect(deliverRes.status).toBe(502);
        const deliverJson = await deliverRes.json();
        expect(deliverJson.error.code).toBe('DELIVERY_FAILED');
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });
  });
});
