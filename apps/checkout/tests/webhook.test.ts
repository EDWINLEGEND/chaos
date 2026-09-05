import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'node:http';
import { ObjectId } from 'mongodb';
import {
  initDatabase,
  getOrdersCollection,
  getWebhookEventsCollection,
  closeDatabase,
  checkDatabaseConnectivity,
} from '@chaos/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { webhookService } from '../src/services/webhook-service.js';

describe('Payment-Confirmed Webhook Flow', () => {
  let server: http.Server;
  let baseUrl: string;
  let isConnected = false;

  const testOrderIds: ObjectId[] = [];
  const testEventIds: string[] = [];

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
    vi.restoreAllMocks();
    // Data isolation: Clean up only records created by this test suite
    if (isConnected) {
      if (testOrderIds.length > 0) {
        const ordersCol = getOrdersCollection();
        await ordersCol.deleteMany({ _id: { $in: testOrderIds } });
        testOrderIds.length = 0;
      }
      if (testEventIds.length > 0) {
        const eventsCol = getWebhookEventsCollection();
        await eventsCol.deleteMany({ eventId: { $in: testEventIds } });
        testEventIds.length = 0;
      }
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
  });

  describe('Happy Path: Webhook Processing & Persistence', () => {
    it('records event in webhook_events and creates a new order', async () => {
      if (!isConnected) {
        console.warn('Skipping test: MongoDB offline');
        return;
      }

      const eventId = 'evt_test_success_1';
      const paymentId = 'pay_test_success_1';
      const userId = 'user_test_success_1';
      const amount = 4999;
      testEventIds.push(eventId);

      const res = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment-confirmed',
          paymentId,
          userId,
          amount,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.eventId).toBe(eventId);
      expect(json.data.created).toBe(true);
      expect(json.data.duplicate).toBe(false);
      expect(json.data.orderId).toBeDefined();

      const orderOid = new ObjectId(json.data.orderId);
      testOrderIds.push(orderOid);

      // Verify webhook_events contains the persisted document
      const eventsCol = getWebhookEventsCollection();
      const eventInDb = await eventsCol.findOne({ eventId });
      expect(eventInDb).not.toBeNull();
      expect(eventInDb?.eventId).toBe(eventId);
      expect(eventInDb?.paymentId).toBe(paymentId);
      expect(eventInDb?.userId).toBe(userId);
      expect(eventInDb?.type).toBe('payment-confirmed');
      expect(eventInDb?.createdAt).toBeInstanceOf(Date);

      // Verify orders contains the new order with correct fields
      const ordersCol = getOrdersCollection();
      const orderInDb = await ordersCol.findOne({ _id: orderOid });
      expect(orderInDb).not.toBeNull();
      expect(orderInDb?.userId).toBe(userId);
      expect(orderInDb?.paymentId).toBe(paymentId);
      expect(orderInDb?.amount).toBe(amount);
      expect(orderInDb?.status).toBe('pending');
      expect(orderInDb?.createdAt).toBeInstanceOf(Date);
    });

    it('handles duplicate webhook for the same user without creating a second order', async () => {
      if (!isConnected) return;

      const userId = 'user_test_duplicate_1';
      const firstEventId = 'evt_dup_first';
      const secondEventId = 'evt_dup_second';
      testEventIds.push(firstEventId, secondEventId);

      // 1. Send first webhook
      const res1 = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: firstEventId,
          type: 'payment-confirmed',
          paymentId: 'pay_dup_1',
          userId,
          amount: 5000,
        }),
      });
      const json1 = await res1.json();
      expect(json1.data.created).toBe(true);
      expect(json1.data.duplicate).toBe(false);
      const initialOrderId = json1.data.orderId;
      testOrderIds.push(new ObjectId(initialOrderId));

      // 2. Send second webhook for the same user while order is pending
      const res2 = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: secondEventId,
          type: 'payment-confirmed',
          paymentId: 'pay_dup_2',
          userId,
          amount: 5000,
        }),
      });
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.success).toBe(true);
      expect(json2.data.eventId).toBe(secondEventId);
      expect(json2.data.created).toBe(false);
      expect(json2.data.duplicate).toBe(true);
      expect(json2.data.orderId).toBe(initialOrderId);

      // 3. Confirm both events are recorded in webhook_events
      const eventsCol = getWebhookEventsCollection();
      const eventsCount = await eventsCol.countDocuments({
        eventId: { $in: [firstEventId, secondEventId] },
      });
      expect(eventsCount).toBe(2);

      // 4. Confirm orders collection still only has exactly 1 order for this user
      const ordersCol = getOrdersCollection();
      const ordersCount = await ordersCol.countDocuments({ userId });
      expect(ordersCount).toBe(1);
    });

    it('allows different users to create their own orders independently', async () => {
      if (!isConnected) return;

      const userA = 'user_independent_A';
      const userB = 'user_independent_B';
      const eventA = 'evt_user_A';
      const eventB = 'evt_user_B';
      testEventIds.push(eventA, eventB);

      const resA = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: eventA,
          type: 'payment-confirmed',
          paymentId: 'pay_A',
          userId: userA,
          amount: 1200,
        }),
      });
      const jsonA = await resA.json();
      expect(jsonA.data.created).toBe(true);
      testOrderIds.push(new ObjectId(jsonA.data.orderId));

      const resB = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: eventB,
          type: 'payment-confirmed',
          paymentId: 'pay_B',
          userId: userB,
          amount: 2400,
        }),
      });
      const jsonB = await resB.json();
      expect(jsonB.data.created).toBe(true);
      expect(jsonB.data.orderId).not.toBe(jsonA.data.orderId);
      testOrderIds.push(new ObjectId(jsonB.data.orderId));
    });
  });

  describe('Validation & Client Error Handling', () => {
    it('rejects invalid JSON with 400', async () => {
      const res = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"invalid": json',
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_JSON');
    });

    it('rejects invalid event type with 400', async () => {
      const res = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          type: 'order-created', // Invalid type
          paymentId: 'pay_1',
          userId: 'user_1',
          amount: 1000,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_EVENT_TYPE');
    });

    it('rejects missing eventId/id with 400', async () => {
      const res = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'payment-confirmed',
          paymentId: 'pay_1',
          userId: 'user_1',
          amount: 1000,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_EVENT_ID');
    });

    it('rejects missing paymentId with 400', async () => {
      const res = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          type: 'payment-confirmed',
          userId: 'user_1',
          amount: 1000,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_PAYMENT_ID');
    });

    it('rejects missing userId with 400', async () => {
      const res = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          type: 'payment-confirmed',
          paymentId: 'pay_1',
          amount: 1000,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_USER_ID');
    });

    it('rejects invalid amounts (negative, zero, float) with 400', async () => {
      const invalidAmounts = [-100, 0, 19.99, '5000', null];

      for (const amount of invalidAmounts) {
        const res = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: 'evt_1',
            type: 'payment-confirmed',
            paymentId: 'pay_1',
            userId: 'user_1',
            amount,
          }),
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.code).toBe('INVALID_AMOUNT');
      }
    });
  });

  describe('COLLSCAN Execution Plan Verification', () => {
    it('proves { userId, status: "pending" } executes a COLLSCAN on orders', async () => {
      if (!isConnected) return;

      const ordersCol = getOrdersCollection();

      // Explain query plan on the exact duplicate check query
      const explanation = await ordersCol
        .find({ userId: 'probe_collscan_user', status: 'pending' })
        .explain('executionStats');

      const queryPlanner = explanation.queryPlanner as {
        winningPlan: { stage: string };
      };

      // In MongoDB explain, winningPlan.stage must be COLLSCAN
      expect(queryPlanner.winningPlan.stage).toBe('COLLSCAN');
    });
  });

  describe('Deliberate Production Incident: Timeout & Swallowed Failure Flow', () => {
    it('swallows duplicate-order query failure, returns HTTP 200 { received: true }, records webhook_event, skips order creation, and logs no errors', async () => {
      if (!isConnected) return;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const eventId = 'evt_deliberate_swallowed_1';
      const paymentId = 'pay_deliberate_swallowed_1';
      const userId = 'user_deliberate_swallowed_1';
      testEventIds.push(eventId);

      // Simulate a database timeout/error during duplicate-order lookup
      vi.spyOn(webhookService, 'findPendingOrderByUser').mockRejectedValueOnce(
        new Error('MongoServerSelectionError: operation timed out')
      );

      const res = await fetch(`${baseUrl}/webhooks/payment-confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment-confirmed',
          paymentId,
          userId,
          amount: 4999,
        }),
      });

      // 1. HTTP 200 returned with exact { received: true } payload
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ received: true });
      expect(json).not.toHaveProperty('error');
      expect(json).not.toHaveProperty('success');

      // 2. Webhook event is recorded in webhook_events collection
      const eventsCol = getWebhookEventsCollection();
      const eventInDb = await eventsCol.findOne({ eventId });
      expect(eventInDb).not.toBeNull();
      expect(eventInDb?.eventId).toBe(eventId);
      expect(eventInDb?.paymentId).toBe(paymentId);
      expect(eventInDb?.userId).toBe(userId);

      // 3. Order is NOT created in orders collection
      const ordersCol = getOrdersCollection();
      const ordersCount = await ordersCol.countDocuments({ userId });
      expect(ordersCount).toBe(0);

      // 4. No internal error is logged or leaked to console
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('times out when duplicate query exceeds timeoutMs and silently returns { received: true }', async () => {
      if (!isConnected) return;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const eventId = 'evt_deliberate_timeout_2';
      const paymentId = 'pay_deliberate_timeout_2';
      const userId = 'user_deliberate_timeout_2';
      testEventIds.push(eventId);

      // Simulate a slow database query exceeding the configured timeout
      vi.spyOn(webhookService, 'findPendingOrderByUser').mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      // Execute with a small 20ms timeout
      const result = await webhookService.processPaymentConfirmedWebhook(
        {
          eventId,
          paymentId,
          userId,
          amount: 8500,
        },
        20
      );

      // 1. Webhook result returns swallowed { received: true }
      expect(result).toEqual({ received: true });

      // 2. Webhook event is durably recorded
      const eventsCol = getWebhookEventsCollection();
      const eventInDb = await eventsCol.findOne({ eventId });
      expect(eventInDb).not.toBeNull();
      expect(eventInDb?.eventId).toBe(eventId);

      // 3. Order is NOT created
      const ordersCol = getOrdersCollection();
      const ordersCount = await ordersCol.countDocuments({ userId });
      expect(ordersCount).toBe(0);

      // 4. No error logged
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
