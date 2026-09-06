import type http from 'node:http';
import { MongoDBClient } from '@chaos/shared';
import {
  handleCreateOrder,
  handleGetOrderById,
  handleListOrders,
} from './handlers/order-handler.js';
import { handlePaymentConfirmedWebhook } from './handlers/webhook-handler.js';
import { sendError } from './utils/http.js';
import type { CheckoutConfig } from './config.js';

export async function startupIndexCreation(config: CheckoutConfig): Promise<void> {
  try {
    const client = MongoDBClient.getInstance();
    const db = client.db(config.mongoDatabase);
    const orders = db.collection('orders');
    const indexes = await orders.indexes();
    const hasCompoundIndex = indexes.some(
      (idx) =>
        idx.name !== '_id_' &&
        idx.key['userId'] === 1 &&
        idx.key['status'] === 1
    );
    if (!hasCompoundIndex) {
      await orders.createIndex({ userId: 1, status: 1 }, { background: true });
      console.log('[checkout] Created compound index { userId: 1, status: 1 } on orders');
    }
  } catch (err) {
    console.error('[checkout] Failed to create compound index on orders:', err);
  }
}

export function createApp(config: CheckoutConfig, startTime: number) {
  return async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    const { method } = req;
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // GET /health
    if (method === 'GET' && pathname === '/health') {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // GET /routes (for debugging)
    if (method === 'GET' && pathname === '/routes') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          service: 'acme-checkout',
          routes: [
            'GET /health',
            'GET /routes',
            'POST /orders',
            'GET /orders',
            'GET /orders/:id',
            'POST /webhooks/payment-confirmed',
          ],
        })
      );
      return;
    }

    // POST /webhooks/payment-confirmed
    if (method === 'POST' && pathname === '/webhooks/payment-confirmed') {
      await handlePaymentConfirmedWebhook(req, res);
      return;
    }

    // POST /orders
    if (method === 'POST' && pathname === '/orders') {
      await handleCreateOrder(req, res);
      return;
    }

    // GET /orders/:id
    if (method === 'GET' && pathname.startsWith('/orders/')) {
      await handleGetOrderById(req, res);
      return;
    }

    // GET /orders
    if (method === 'GET' && pathname === '/orders') {
      await handleListOrders(req, res);
      return;
    }

    // 404
    sendError(res, 404, 'NOT_FOUND', `Route not found: ${method} ${pathname}`);
  };
}
