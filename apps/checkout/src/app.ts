import type http from 'node:http';
import type { CheckoutConfig } from './config.js';
import { handleHealthCheck } from './handlers/health-handler.js';
import {
  handleCreateOrder,
  handleGetOrderById,
  handleListOrders,
} from './handlers/order-handler.js';
import { handlePaymentConfirmedWebhook } from './handlers/webhook-handler.js';
import { chaosInterceptor } from './middleware/chaos-interceptor.js';
import { sendError } from './utils/http.js';

export function createApp(config: CheckoutConfig, startTime: number) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // Chaos failure interceptor & control endpoint
    const intercepted = await chaosInterceptor.handleRequest(req, res);
    if (intercepted) return;

    // Health check endpoint
    if ((method === 'GET' || method === 'HEAD') && pathname === '/health') {
      await handleHealthCheck(req, res, config, startTime);
      return;
    }

    // Root info endpoint
    if ((method === 'GET' || method === 'HEAD') && pathname === '/') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      if (method === 'HEAD') {
        res.end();
      } else {
        res.end(
          JSON.stringify({
            name: 'acme-checkout',
            version: '0.1.0',
            status: 'running',
            endpoints: [
              'GET /health',
              'POST /orders',
              'GET /orders',
              'GET /orders/:id',
              'POST /webhooks/payment-confirmed',
            ],
          })
        );
      }
      return;
    }

    // POST /webhooks/payment-confirmed
    if (method === 'POST' && pathname === '/webhooks/payment-confirmed') {
      await handlePaymentConfirmedWebhook(req, res, config);
      return;
    }

    // POST /orders
    if (method === 'POST' && pathname === '/orders') {
      await handleCreateOrder(req, res);
      return;
    }

    // GET /orders
    if (method === 'GET' && pathname === '/orders') {
      await handleListOrders(req, res);
      return;
    }

    // GET /orders/:id
    if (method === 'GET' && pathname.startsWith('/orders/')) {
      const orderId = pathname.slice('/orders/'.length);
      if (orderId.includes('/') || orderId.length === 0) {
        sendError(res, 404, 'NOT_FOUND', `Route not found: ${method} ${pathname}`);
        return;
      }
      await handleGetOrderById(req, res, orderId);
      return;
    }

    // 404 for unhandled routes
    sendError(res, 404, 'NOT_FOUND', `Route not found: ${method} ${pathname}`);
  };
}
