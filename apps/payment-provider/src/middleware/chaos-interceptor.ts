import type http from 'node:http';
import type { FailureType, ExperimentParams, ChaosControlCommand } from '@chaos/shared';
import { sendJson, sendError, parseJsonBody } from '../utils/http.js';

interface ActiveFailure {
  type: FailureType;
  params: ExperimentParams;
  enabledAt: number;
}

class PaymentChaosInterceptor {
  private readonly activeFailures = new Map<FailureType, ActiveFailure>();

  public isLocalhost(req: http.IncomingMessage): boolean {
    const remote = req.socket.remoteAddress ?? '';
    return (
      remote === '127.0.0.1' ||
      remote === '::1' ||
      remote.startsWith('127.') ||
      remote.startsWith('::ffff:127.') ||
      remote === 'localhost'
    );
  }

  public enableFailure(type: FailureType, params: ExperimentParams = {}): void {
    const safeParams: ExperimentParams = {
      delayMs: Math.min(Math.max(params.delayMs ?? 0, 0), 5000),
      percentage: Math.min(Math.max(params.percentage ?? 100, 0), 100),
      statusCode: params.statusCode ?? 500,
    };

    this.activeFailures.set(type, {
      type,
      params: safeParams,
      enabledAt: Date.now(),
    });
  }

  public disableFailure(type: FailureType): void {
    this.activeFailures.delete(type);
  }

  public clearAll(): void {
    this.activeFailures.clear();
  }

  public getActiveFailures(): ActiveFailure[] {
    return Array.from(this.activeFailures.values());
  }

  public shouldFailDelivery(): boolean {
    const failure = this.activeFailures.get('payment_failure');
    if (!failure) return false;
    const pct = failure.params.percentage ?? 100;
    return Math.random() * 100 <= pct;
  }

  public async applyDeliveryLatency(): Promise<void> {
    const failure = this.activeFailures.get('payment_latency');
    if (failure && failure.params.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, failure.params.delayMs));
    }
  }

  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    if (pathname === '/_chaos/control') {
      if (!this.isLocalhost(req)) {
        sendError(res, 403, 'FORBIDDEN', 'Chaos control endpoint is only accessible via localhost');
        return true;
      }

      if (method === 'GET') {
        sendJson(res, 200, {
          target: 'fake-payment-provider',
          activeFailures: this.getActiveFailures(),
        });
        return true;
      }

      if (method === 'POST') {
        try {
          const body = await parseJsonBody<ChaosControlCommand>(req);
          if (body.action === 'CLEAR') {
            this.clearAll();
            sendJson(res, 200, { success: true, message: 'All payment provider chaos failures cleared' });
            return true;
          }

          if (body.action === 'ENABLE' && body.failureType) {
            this.enableFailure(body.failureType, body.params);
            sendJson(res, 200, {
              success: true,
              message: `Payment failure "${body.failureType}" enabled`,
              active: this.getActiveFailures(),
            });
            return true;
          }

          if (body.action === 'DISABLE' && body.failureType) {
            this.disableFailure(body.failureType);
            sendJson(res, 200, {
              success: true,
              message: `Payment failure "${body.failureType}" disabled`,
              active: this.getActiveFailures(),
            });
            return true;
          }

          sendError(res, 400, 'INVALID_ACTION', 'Action must be ENABLE, DISABLE, or CLEAR');
          return true;
        } catch (err) {
          sendError(res, 400, 'BAD_REQUEST', `Failed to parse chaos command: ${err instanceof Error ? err.message : String(err)}`);
          return true;
        }
      }

      sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed on /_chaos/control');
      return true;
    }

    return false;
  }
}

export const paymentChaosInterceptor = new PaymentChaosInterceptor();
