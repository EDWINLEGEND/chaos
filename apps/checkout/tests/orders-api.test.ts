import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import { ObjectId } from 'mongodb';
import {
  initDatabase,
  getOrdersCollection,
  closeDatabase,
  checkDatabaseConnectivity,
} from '@chaos/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('Checkout HTTP API', () => {
  let server: http.Server;
  let baseUrl: string;
  let isConnected = false;
  const createdOrderIds: ObjectId[] = [];

  beforeAll(async () => {
    const config = loadConfig();
    try {
      await initDatabase({
        uri: process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme',
        dbName: 'acme',
        serverSelectionTimeoutMS: 2000,
        connectTimeoutMS: 3000,
      });
      const health = await checkDatabaseConnectivity(2000);
      isConnected = health.status === 'ok';
    } catch {
      isConnected = false;
    }

    const app = createApp(config, Date.now());
    server = http.createServer(app);

    await new Promise<void>((resolve) => {
      // Listen on ephemeral port for tests
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (isConnected && createdOrderIds.length > 0) {
      const collection = getOrdersCollection();
      await collection.deleteMany({ _id: { $in: createdOrderIds } });
      createdOrderIds.length = 0;
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
  });

  describe('POST /orders', () => {
    it('creates an order and returns 201 with structured JSON', async () => {
      if (!isConnected) return;

      const payload = {
        userId: 'cust_api_1',
        paymentId: 'pay_api_1',
        amount: 3500, // $35.00
      };

      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
      expect(json.data.id).toBeDefined();
      expect(json.data.userId).toBe('cust_api_1');
      expect(json.data.paymentId).toBe('pay_api_1');
      expect(json.data.amount).toBe(3500);
      expect(json.data.status).toBe('pending');
      expect(new Date(json.data.createdAt).getTime()).not.toBeNaN();

      createdOrderIds.push(new ObjectId(json.data.id));
    });

    it('rejects missing userId with 400', async () => {
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay_1', amount: 1000 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_USER_ID');
    });

    it('rejects missing paymentId with 400', async () => {
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_1', amount: 1000 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_PAYMENT_ID');
    });

    it('rejects non-integer, negative, or zero amount with 400', async () => {
      const badAmounts = [-500, 0, 12.34, '1000', null];

      for (const amount of badAmounts) {
        const res = await fetch(`${baseUrl}/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user_1', paymentId: 'pay_1', amount }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.code).toBe('INVALID_AMOUNT');
      }
    });

    it('rejects malformed JSON with 400', async () => {
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"invalid_json: true',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_JSON');
    });
  });

  describe('GET /orders/:id', () => {
    it('retrieves an existing order with 200 OK', async () => {
      if (!isConnected) return;

      // First create an order
      const createRes = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'cust_get_1', paymentId: 'pay_get_1', amount: 5000 }),
      });
      const created = await createRes.json();
      const orderId = created.data.id;
      createdOrderIds.push(new ObjectId(orderId));

      // Now retrieve it
      const getRes = await fetch(`${baseUrl}/orders/${orderId}`);
      expect(getRes.status).toBe(200);
      const retrieved = await getRes.json();
      expect(retrieved.success).toBe(true);
      expect(retrieved.data.id).toBe(orderId);
      expect(retrieved.data.userId).toBe('cust_get_1');
      expect(retrieved.data.amount).toBe(5000);
    });

    it('returns 404 for a valid ObjectId that does not exist', async () => {
      const nonExistentId = new ObjectId().toString();
      const res = await fetch(`${baseUrl}/orders/${nonExistentId}`);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('returns 400 for a malformed order ID string', async () => {
      const res = await fetch(`${baseUrl}/orders/not-a-valid-hex-id`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_ORDER_ID');
    });
  });

  describe('GET /health', () => {
    it('returns health status with database ok when connected', async () => {
      if (!isConnected) return;

      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ok');
      expect(json.service).toBe('acme-checkout');
      expect(json.database).toBe('ok');
    });
  });
});
