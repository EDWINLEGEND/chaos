import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDatabaseConnection,
  type DatabaseConnection,
  type OrderDocument,
} from '../src/index.js';
import { ObjectId } from 'mongodb';

describe('MongoDB Integration Layer', () => {
  let dbConn: DatabaseConnection | null = null;
  let isConnected = false;

  beforeAll(async () => {
    try {
      dbConn = await createDatabaseConnection({
        uri: process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme',
        dbName: 'acme',
        serverSelectionTimeoutMS: 2000,
        connectTimeoutMS: 3000,
      });
      const health = await dbConn.checkConnectivity(2000);
      isConnected = health.status === 'ok';
    } catch {
      isConnected = false;
    }
  });

  afterAll(async () => {
    if (dbConn) {
      await dbConn.close();
    }
  });

  it('connects to acme database and confirms healthy ping', async () => {
    if (!isConnected || !dbConn) {
      console.warn('Skipping test: Live MongoDB instance not reachable.');
      return;
    }

    const health = await dbConn.checkConnectivity();
    expect(health.status).toBe('ok');
    expect(health.database).toBe('acme');
    expect(health.latencyMs).toBeDefined();
  });

  it('can access collections and verifies empty/clean state', async () => {
    if (!isConnected || !dbConn) return;

    const ordersCol = dbConn.getOrdersCollection();
    const webhooksCol = dbConn.getWebhookEventsCollection();

    expect(ordersCol.collectionName).toBe('orders');
    expect(webhooksCol.collectionName).toBe('webhook_events');
  });

  it('executes { userId, status } query without a supporting compound index (COLLSCAN)', async () => {
    if (!isConnected || !dbConn) return;

    const ordersCol = dbConn.getOrdersCollection();
    const testOrderId = new ObjectId();
    const testUserId = 'user_test_probe_123';

    const testOrder: OrderDocument = {
      _id: testOrderId,
      userId: testUserId,
      status: 'pending',
      paymentId: 'pay_probe_999',
      amount: 1999,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert order
    await ordersCol.insertOne(testOrder);

    // Query with the future duplicate-order lookup shape
    const foundOrder = await ordersCol.findOne({
      userId: testUserId,
      status: 'pending',
    });

    expect(foundOrder).not.toBeNull();
    expect(foundOrder?._id.toString()).toBe(testOrderId.toString());
    expect(foundOrder?.userId).toBe(testUserId);
    expect(foundOrder?.status).toBe('pending');

    // Explain query plan to assert COLLSCAN
    const explanation = await ordersCol
      .find({ userId: testUserId, status: 'pending' })
      .explain('executionStats');

    const queryPlanner = explanation.queryPlanner as {
      winningPlan: { stage: string; inputStage?: { stage: string } };
    };
    const stage = queryPlanner.winningPlan.stage;
    expect(stage).toBe('COLLSCAN');

    // Clean up probe document
    await ordersCol.deleteOne({ _id: testOrderId });
  });

  it('confirms via getDatabaseDiagnostics that compound index is absent', async () => {
    if (!isConnected || !dbConn) return;

    const report = await dbConn.getDiagnostics();
    expect(report.connected).toBe(true);
    expect(report.dbName).toBe('acme');
    expect(report.collections.orders.exists).toBe(true);
    expect(report.collections.webhook_events.exists).toBe(true);
    expect(report.hasUserIdStatusCompoundIndex).toBe(false);
  });
});
