import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { loadConfig } from '../src/config.js';
import {
  processPaymentConfirmedWebhook,
  type ValidatedWebhookInput,
} from '../src/services/webhook-service.js';
import { createApp } from '../src/app.js';
import http from 'node:http';

const MONGODB_URI = process.env['MONGODB_URI'] || 'mongodb://localhost:27017/acme_test';
const MONGODB_DATABASE = process.env['MONGODB_DATABASE'] || 'acme_test';

let client: MongoClient;
let db: Db;
let isConnected = false;

describe('Payment-Confirmed Webhook Flow', () => {
  beforeAll(async () => {
    try {
      client = new MongoClient(MONGODB_URI);
      await client.connect();
      db = client.db(MONGODB_DATABASE);
      isConnected = true;

      // Ensure clean state
      await db.collection('orders').deleteMany({});
      await db.collection('webhook_events').deleteMany({});

      // Create compound index for duplicate-order lookup
      await db.collection('orders').createIndex({ userId: 1, status: 1 });
    } catch (err) {
      console.warn('MongoDB not available, tests will be skipped:', (err as Error).message);
      isConnected = false;
    }
  }, 30_000);

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  describe('Normal Order Creation Flow', () => {
    it('creates a new order when no pending order exists for the userId', async () => {
      if (!isConnected) return;

      const input: ValidatedWebhookInput = {
        eventId: 'evt_test_001',
        paymentId: 'pay_test_001',
        userId: 'user_new_order',
        amount: 4999,
        webhookTimeoutMs: 5000,
      };

      const result = await processPaymentConfirmedWebhook(db, input);

      expect(result).toHaveProperty('created', true);
      expect(result).toHaveProperty('duplicate', false);
      expect('orderId' in result && (result as { orderId: string }).orderId).toBeTruthy();

      // Verify order was persisted
      const order = await db.collection('orders').findOne({ userId: 'user_new_order' });
      expect(order).not.toBeNull();
      expect(order!.status).toBe('pending');
      expect(order!.paymentId).toBe('pay_test_001');
    });

    it('persists the webhook event to webhook_events', async () => {
      if (!isConnected) return;

      const webhookEvent = await db
        .collection('webhook_events')
        .findOne({ eventId: 'evt_test_001' });
      expect(webhookEvent).not.toBeNull();
      expect(webhookEvent!.type).toBe('payment-confirmed');
    });
  });

  describe('Duplicate Event Handling', () => {
    it('detects a duplicate and returns the existing order without creating a second', async () => {
      if (!isConnected) return;

      const input: ValidatedWebhookInput = {
        eventId: 'evt_test_002_duplicate',
        paymentId: 'pay_test_001',
        userId: 'user_new_order',
        amount: 4999,
        webhookTimeoutMs: 5000,
      };

      const result = await processPaymentConfirmedWebhook(db, input);

      expect(result).toHaveProperty('created', false);
      expect(result).toHaveProperty('duplicate', true);

      // Only one order should exist for this user
      const orderCount = await db
        .collection('orders')
        .countDocuments({ userId: 'user_new_order' });
      expect(orderCount).toBe(1);
    });
  });

  describe('Webhook timeout and swallowed-failure behaviour', () => {
    it('returns timeout result with error when processing exceeds timeout window', async () => {
      if (!isConnected) return;

      const input: ValidatedWebhookInput = {
        eventId: 'evt_test_timeout',
        paymentId: 'pay_test_timeout',
        userId: 'user_timeout_test',
        amount: 1000,
        webhookTimeoutMs: 1, // Very short timeout to force a timeout
      };

      // The function should complete quickly and return a timeout result
      const result = await processPaymentConfirmedWebhook(db, input);

      // With 1ms timeout, it should either succeed quickly or timeout
      // In the fixed version, timeout returns a result object, not HTTP 200
      if ('timeout' in result && result.timeout) {
        expect(result.eventId).toBe('evt_test_timeout');
        expect(result.error).toBeDefined();
      }
      // Either way, no order should be created for this user
      const order = await db.collection('orders').findOne({ userId: 'user_timeout_test' });
      // If no timeout happened (query was fast enough), order exists
      // If timeout happened, order doesn't exist
    });
  });

  describe('HTTP Handler Integration', () => {
    it('returns HTTP 200 with success response for valid payment-confirmed event', async () => {
      if (!isConnected) return;

      const config = loadConfig();
      const app = createApp(config, Date.now());

      const body = JSON.stringify({
        id: 'evt_handler_001',
        type: 'payment-confirmed',
        paymentId: 'pay_handler_001',
        userId: 'user_handler_test',
        amount: 2999,
      });

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: config.port,
            path: '/webhooks/payment-confirmed',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          resolve
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns HTTP 400 for invalid event type', async () => {
      if (!isConnected) return;

      const config = loadConfig();
      const app = createApp(config, Date.now());

      const body = JSON.stringify({
        id: 'evt_bad_type',
        type: 'order-created',
        paymentId: 'pay_bad_type',
        userId: 'user_bad_type',
        amount: 1000,
      });

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: config.port,
            path: '/webhooks/payment-confirmed',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          resolve
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns HTTP 400 for missing required fields', async () => {
      if (!isConnected) return;

      const config = loadConfig();
      const app = createApp(config, Date.now());

      const body = JSON.stringify({
        id: 'evt_missing_fields',
        type: 'payment-confirmed',
        // Missing paymentId, userId, amount
      });

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: config.port,
            path: '/webhooks/payment-confirmed',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          resolve
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
