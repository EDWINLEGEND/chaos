import { ObjectId } from 'mongodb';
import {
  getOrdersCollection,
  type OrderDocument,
  type CreateOrderInput,
} from '@chaos/shared';

/**
 * Validates whether a string is a valid 24-character hexadecimal MongoDB ObjectId.
 */
export function isValidObjectId(id: string): boolean {
  if (typeof id !== 'string' || id.length !== 24) {
    return false;
  }
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Creates and persists a new Order in MongoDB.
 * Uses atomic insertion with default 'pending' status and timestamps.
 */
export async function createOrder(input: CreateOrderInput): Promise<OrderDocument> {
  const collection = getOrdersCollection();

  const now = new Date();
  const orderDocument: OrderDocument = {
    _id: new ObjectId(),
    userId: input.userId,
    paymentId: input.paymentId,
    amount: input.amount,
    status: input.status ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.insertOne(orderDocument);
  if (!result.acknowledged) {
    throw new Error('Database insertion was not acknowledged by MongoDB');
  }

  return orderDocument;
}

/**
 * Retrieves an order by its primary key `_id`.
 * Returns null if the order does not exist.
 * Throws an Error if the provided identifier is not a valid ObjectId.
 */
export async function getOrderById(id: string | ObjectId): Promise<OrderDocument | null> {
  let objectId: ObjectId;

  if (typeof id === 'string') {
    if (!isValidObjectId(id)) {
      throw new Error(`Invalid ObjectId format: "${id}"`);
    }
    objectId = new ObjectId(id);
  } else {
    objectId = id;
  }

  const collection = getOrdersCollection();
  return collection.findOne({ _id: objectId });
}

/**
 * Lists the most recent orders for development inspection and testing.
 */
export async function listRecentOrders(limit: number = 20): Promise<OrderDocument[]> {
  const collection = getOrdersCollection();
  return collection
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
