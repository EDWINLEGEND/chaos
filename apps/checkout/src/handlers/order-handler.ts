import type http from 'node:http';
import type { OrderDocument, OrderStatus } from '@chaos/shared';
import {
  createOrder,
  getOrderById,
  listRecentOrders,
  isValidObjectId,
} from '../services/order-service.js';
import { parseJsonBody, sendJson, sendError, HttpError } from '../utils/http.js';

const VALID_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'pending',
  'paid',
  'cancelled',
  'failed',
]);

/**
 * Serializes an OrderDocument into a JSON-friendly API response.
 */
export function serializeOrder(order: OrderDocument) {
  return {
    id: order._id.toString(),
    _id: order._id.toString(),
    userId: order.userId,
    paymentId: order.paymentId,
    amount: order.amount,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/**
 * Handles POST /orders
 */
export async function handleCreateOrder(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(req);

    // Validate userId
    if (typeof body['userId'] !== 'string' || body['userId'].trim().length === 0) {
      sendError(res, 400, 'INVALID_USER_ID', 'Field "userId" is required and must be a non-empty string');
      return;
    }
    const userId = body['userId'].trim();

    // Validate paymentId
    if (typeof body['paymentId'] !== 'string' || body['paymentId'].trim().length === 0) {
      sendError(res, 400, 'INVALID_PAYMENT_ID', 'Field "paymentId" is required and must be a non-empty string');
      return;
    }
    const paymentId = body['paymentId'].trim();

    // Validate amount (minor currency units, positive integer)
    const amount = body['amount'];
    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      sendError(
        res,
        400,
        'INVALID_AMOUNT',
        'Field "amount" must be a positive integer in minor currency units (e.g. 4999 for $49.99)'
      );
      return;
    }

    // Optional status validation
    let status: OrderStatus | undefined;
    if (body['status'] !== undefined) {
      if (typeof body['status'] !== 'string' || !VALID_STATUSES.has(body['status'] as OrderStatus)) {
        sendError(
          res,
          400,
          'INVALID_STATUS',
          `Field "status" must be one of: ${Array.from(VALID_STATUSES).join(', ')}`
        );
        return;
      }
      status = body['status'] as OrderStatus;
    }

    const order = await createOrder({
      userId,
      paymentId,
      amount,
      status,
    });

    sendJson(res, 201, {
      success: true,
      data: serializeOrder(order),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(res, err.statusCode, err.code, err.message);
      return;
    }
    console.error('[acme-checkout] Unexpected error in handleCreateOrder:', err);
    sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Failed to create order');
  }
}

/**
 * Handles GET /orders/:id
 */
export async function handleGetOrderById(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  if (!isValidObjectId(id)) {
    sendError(
      res,
      400,
      'INVALID_ORDER_ID',
      `Order identifier "${id}" is not a valid 24-character hexadecimal ObjectId`
    );
    return;
  }

  try {
    const order = await getOrderById(id);
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', `Order with ID "${id}" was not found`);
      return;
    }

    sendJson(res, 200, {
      success: true,
      data: serializeOrder(order),
    });
  } catch (err) {
    console.error(`[acme-checkout] Error retrieving order ${id}:`, err);
    sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Failed to retrieve order');
  }
}

/**
 * Handles GET /orders (lists recent orders for development / inspection)
 */
export async function handleListOrders(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const orders = await listRecentOrders(20);
    sendJson(res, 200, {
      success: true,
      data: orders.map(serializeOrder),
    });
  } catch (err) {
    console.error('[acme-checkout] Error listing orders:', err);
    sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Failed to list orders');
  }
}
