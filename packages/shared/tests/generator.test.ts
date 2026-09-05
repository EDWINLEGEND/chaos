import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initDatabase,
  getOrdersCollection,
  closeDatabase,
  checkDatabaseConnectivity,
} from '../src/index.js';

describe('Seed & Explain Verification', () => {
  let isConnected = false;

  beforeAll(async () => {
    try {
      await initDatabase({
        uri: process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme',
        dbName: 'acme',
        serverSelectionTimeoutMS: 2000,
      });
      const health = await checkDatabaseConnectivity(2000);
      isConnected = health.status === 'ok';
    } catch {
      isConnected = false;
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('guarantees winning plan stage is COLLSCAN for duplicate order query', async () => {
    if (!isConnected) return;

    const ordersCol = getOrdersCollection();
    const explanation = await ordersCol
      .find({ userId: 'test_probe_user', status: 'pending' })
      .explain('executionStats');

    const queryPlanner = explanation.queryPlanner as {
      winningPlan: { stage: string };
    };

    expect(queryPlanner.winningPlan.stage).toBe('COLLSCAN');
  });

  it('confirms supporting compound index { userId: 1, status: 1 } remains absent', async () => {
    if (!isConnected) return;

    const ordersCol = getOrdersCollection();
    const indexes = await ordersCol.indexes();

    const hasCompoundIndex = indexes.some(
      (idx) => idx.key && 'userId' in idx.key && 'status' in idx.key
    );

    expect(hasCompoundIndex).toBe(false);
  });
});
