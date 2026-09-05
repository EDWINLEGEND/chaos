import type http from 'node:http';
import {
  createHealthReport,
  getPrometheusMetrics,
  httpRequestsTotal,
  httpRequestDurationSeconds,
} from '@chaos/shared';
import type { PaymentProviderConfig } from './config.js';
import type { PaymentStore } from './store.js';
import { parseJsonBody, sendJson, sendError, HttpError } from './utils/http.js';
import { paymentChaosInterceptor } from './middleware/chaos-interceptor.js';

export function createApp(
  config: PaymentProviderConfig,
  store: PaymentStore,
  startTime: number = Date.now()
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const method = req.method ?? 'GET';

      const reqStartTime = process.hrtime.bigint();
      res.on('finish', () => {
        const durationSeconds = Number(process.hrtime.bigint() - reqStartTime) / 1e9;
        const statusStr = String(res.statusCode);
        httpRequestsTotal.inc({
          service: 'fake-payment-provider',
          method,
          route: url.pathname,
          status_code: statusStr,
        });
        httpRequestDurationSeconds.observe(
          {
            service: 'fake-payment-provider',
            method,
            route: url.pathname,
            status_code: statusStr,
          },
          durationSeconds
        );
      });

      // Prometheus metrics endpoint for Grafana
      if ((method === 'GET' || method === 'HEAD') && url.pathname === '/metrics') {
        const { contentType, metrics } = await getPrometheusMetrics();
        res.setHeader('Content-Type', contentType);
        res.writeHead(200);
        res.end(metrics);
        return;
      }

      // Chaos failure interceptor & control endpoint
      const intercepted = await paymentChaosInterceptor.handleRequest(req, res);
      if (intercepted) return;

      // 1. Health check endpoint
      if ((method === 'GET' || method === 'HEAD') && url.pathname === '/health') {
        const health = createHealthReport('fake-payment-provider', startTime);
        sendJson(res, 200, health);
        return;
      }

      // 2. Root service info
      if ((method === 'GET' || method === 'HEAD') && url.pathname === '/') {
        sendJson(res, 200, {
          name: 'fake-payment-provider',
          version: '0.1.0',
          status: 'running',
          endpoints: [
            '/health',
            '/v1/events',
            '/v1/test/payments',
            '/v1/test/payments/:paymentId/deliver',
            '/v1/test/reset',
          ],
        });
        return;
      }

      // 3. GET /v1/events
      if (method === 'GET' && url.pathname === '/v1/events') {
        const createdGtRaw = url.searchParams.get('created[gt]');
        let createdGt: number | undefined;

        if (createdGtRaw !== null) {
          const parsed = Number(createdGtRaw);
          if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
            sendError(
              res,
              400,
              'INVALID_TIMESTAMP',
              'Query parameter "created[gt]" must be a non-negative integer Unix timestamp in seconds'
            );
            return;
          }
          createdGt = parsed;
        }

        const events = await store.listEvents(createdGt !== undefined ? { createdGt } : undefined);
        sendJson(res, 200, {
          data: events,
          count: events.length,
        });
        return;
      }

      // 4. POST /v1/test/payments
      if (method === 'POST' && url.pathname === '/v1/test/payments') {
        const body = await parseJsonBody<Record<string, unknown>>(req);

        // Validate userId
        if (typeof body['userId'] !== 'string' || body['userId'].trim().length === 0) {
          sendError(
            res,
            400,
            'INVALID_USER_ID',
            'Field "userId" is required and must be a non-empty string'
          );
          return;
        }
        const userId = body['userId'].trim();

        // Validate amount
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

        const record = await store.create({ userId, amount });
        sendJson(res, 201, {
          id: record.id,
          type: record.type,
          paymentId: record.paymentId,
          userId: record.userId,
          amount: record.amount,
          created: record.created,
        });
        return;
      }

      // 5. POST /v1/test/payments/:paymentId/deliver
      const deliverMatch = url.pathname.match(/^\/v1\/test\/payments\/([^/]+)\/deliver$/);
      if (method === 'POST' && deliverMatch && deliverMatch[1]) {
        const paymentId = decodeURIComponent(deliverMatch[1]);
        const record = await store.findById(paymentId);

        if (!record) {
          sendError(res, 404, 'PAYMENT_NOT_FOUND', `Payment with ID "${paymentId}" was not found`);
          return;
        }

        const webhookPayload = {
          id: record.id,
          type: 'payment-confirmed',
          paymentId: record.paymentId,
          userId: record.userId,
          amount: record.amount,
        };

        // Apply chaos latency if enabled
        await paymentChaosInterceptor.applyDeliveryLatency();

        // Simulate delivery failure if chaos failure enabled
        if (paymentChaosInterceptor.shouldFailDelivery()) {
          await store.updateDelivery(paymentId, { delivered: false, statusCode: 500 });
          sendJson(res, 200, {
            success: false,
            delivered: false,
            paymentId,
            statusCode: 500,
            error: 'Simulated payment delivery failure injected by Chaos experiment',
          });
          return;
        }

        try {
          const response = await fetch(config.checkoutWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload),
            signal: AbortSignal.timeout(5000),
          });

          const statusCode = response.status;
          const isDelivered = response.ok;

          await store.updateDelivery(paymentId, { delivered: isDelivered, statusCode });

          let responseData: unknown = null;
          try {
            responseData = await response.json();
          } catch {
            // Non-JSON response is permitted
          }

          if (isDelivered) {
            sendJson(res, 200, {
              success: true,
              delivered: true,
              paymentId,
              statusCode,
              response: responseData,
            });
          } else {
            sendJson(res, 200, {
              success: false,
              delivered: false,
              paymentId,
              statusCode,
              error: `Checkout webhook responded with non-2xx status code: ${statusCode}`,
              response: responseData,
            });
          }
        } catch (err) {
          await store.updateDelivery(paymentId, { delivered: false, statusCode: 0 });
          sendError(
            res,
            502,
            'DELIVERY_FAILED',
            `Failed to connect to checkout webhook endpoint: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
        return;
      }

      // 6. POST /v1/test/reset
      if (method === 'POST' && url.pathname === '/v1/test/reset') {
        await store.clear();
        sendJson(res, 200, {
          reset: true,
          count: 0,
        });
        return;
      }

      // 7. Route not found
      sendError(res, 404, 'NOT_FOUND', `Route not found: ${method} ${url.pathname}`);
    } catch (err) {
      if (err instanceof HttpError) {
        sendError(res, err.statusCode, err.code, err.message);
        return;
      }
      sendError(
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        `Internal server error: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  };
}
