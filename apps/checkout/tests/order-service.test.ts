import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  initDatabase,
  getOrdersCollection,
  closeDatabase,
  checkDatabaseConnectivity,
} from '@chaos/shared';
import {
  createOrder,
  getOrderById,
  isValidObjectId,
} from '../src/services/order-service.js';

describe('Acme Checkout Order Domain', () => {
  let isConnected = false;
  const createdOrderIds: ObjectId[] = [];

  beforeAll(async () => {
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
  });

  afterEach(async () => {
    // Data isolation: Clean up created orders to avoid database pollution
    if (isConnected && createdOrderIds.length > 0) {
      const collection = getOrdersCollection();
      await collection.deleteMany({ _id: { $in: createdOrderIds } });
      createdOrderIds.length = 0;
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('ObjectId Validation', () => {
    it('accurately identifies valid 24-character hexadecimal ObjectIds', () => {
      expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
      expect(isValidObjectId(new ObjectId().toString())).toBe(true);
    });

    it('rejects invalid or malformed strings', () => {
      expect(isValidObjectId('')).toBe(false);
      expect(isValidObjectId('123')).toBe(false);
      expect(isValidObjectId('not-a-valid-hex-id-123456')).toBe(false);
      expect(isValidObjectId('507f1f77bcf86cd79943901z')).toBe(false); // Non-hex 'z'
      expect(isValidObjectId('507f1f77bcf86cd799439011a')).toBe(false); // 25 chars
    });
  });

  describe('createOrder()', () => {
    it('creates an order with pending status and valid timestamps', async () => {
      if (!isConnected) {
        console.warn('Skipping test: MongoDB offline');
        return;
      }

      const input = {
        userId: 'user_test_100',
        paymentId: 'pay_test_200',
        amount: 4999, // $49.99 in minor units
      };

      const order = await createOrder(input);
      createdOrderIds.push(order._id);

      expect(order._id).toBeInstanceOf(ObjectId);
      expect(order.userId).toBe('user_test_100');
      expect(order.paymentId).toBe('pay_test_200');
      expect(order.amount).toBe(4999);
      expect(order.status).toBe('pending');
      expect(order.createdAt).toBeInstanceOf(Date);
      expect(order.updatedAt).toBeInstanceOf(Date);

      // Verify direct database read
      const collection = getOrdersCollection();
      const inDb = await collection.findOne({ _id: order._id });
      expect(inDb).not.toBeNull();
      expect(inDb?.userId).toBe('user_test_100');
      expect(inDb?.amount).toBe(4999);
    });

    it('respects explicitly provided order status', async () => {
      if (!isConnected) return;

      const order = await createOrder({
        userId: 'user_test_101',
        paymentId: 'pay_test_201',
        amount: 1500,
        status: 'paid',
      });
      createdOrderIds.push(order._id);

      expect(order.status).toBe('paid');
    });
  });

  describe('getOrderById()', () => {
    it('retrieves an existing order by string ID', async () => {
      if (!isConnected) return;

      const order = await createOrder({
        userId: 'user_lookup_test',
        paymentId: 'pay_lookup_test',
        amount: 8900,
      });
      createdOrderIds.push(order._id);

      const retrieved = await getOrderById(order._id.toString());
      expect(retrieved).not.toBeNull();
      expect(retrieved?._id.toString()).toBe(order._id.toString());
      expect(retrieved?.userId).toBe('user_lookup_test');
      expect(retrieved?.amount).toBe(8900);
    });

    it('retrieves an existing order by ObjectId instance', async () => {
      if (!isConnected) return;

      const order = await createOrder({
        userId: 'user_oid_test',
        paymentId: 'pay_oid_test',
        amount: 2500,
      });
      createdOrderIds.push(order._id);

      const retrieved = await getOrderById(order._id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?._id.toString()).toBe(order._id.toString());
    });

    it('returns null when the order ID does not exist in database', async () => {
      if (!isConnected) return;

      const nonExistentId = new ObjectId().toString();
      const result = await getOrderById(nonExistentId);
      expect(result).toBeNull();
    });

    it('throws an error when provided a malformed ObjectId string', async () => {
      await expect(getOrderById('invalid-hex-id')).rejects.toThrow(/Invalid ObjectId format/);
    });
  });
});
