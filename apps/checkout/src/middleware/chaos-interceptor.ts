import type http from 'node:http';
import type { FailureType, ExperimentParams, ChaosControlCommand } from '@chaos/shared';
import { sendJson, sendError, parseJsonBody } from '../utils/http.js';

interface ActiveFailure {
  type: FailureType;
  params: ExperimentParams;
  enabledAt: number;
}

class ChaosInterceptor {
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
    // Enforce safety limits
    const safeParams: ExperimentParams = {
      delayMs: Math.min(Math.max(params.delayMs ?? 0, 0), 5000), // Max 5s
      percentage: Math.min(Math.max(params.percentage ?? 100, 0), 100), // 0 - 100%
      statusCode: params.statusCode ?? 500,
      malformedPayload: params.malformedPayload ?? false,
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

  public isDbOutageActive(): boolean {
    const failure = this.activeFailures.get('db_outage');
    if (!failure) return false;
    const pct = failure.params.percentage ?? 100;
    return Math.random() * 100 <= pct;
  }

  public async applyDbLatency(): Promise<void> {
    const failure = this.activeFailures.get('db_latency');
    if (failure && failure.params.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, failure.params.delayMs));
    }
  }

  /**
   * Main HTTP middleware interceptor.
   * Returns true if request was handled (interrupted or answered), false to continue normal pipeline.
   */
  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // 1. Localhost Control Endpoint: POST /_chaos/control
    if (pathname === '/_chaos/control') {
      if (!this.isLocalhost(req)) {
        sendError(res, 403, 'FORBIDDEN', 'Chaos control endpoint is only accessible via localhost');
        return true;
      }

      if (method === 'GET') {
        sendJson(res, 200, {
          target: 'acme-checkout',
          activeFailures: this.getActiveFailures(),
        });
        return true;
      }

      if (method === 'POST') {
        try {
          const body = await parseJsonBody<ChaosControlCommand>(req);
          if (body.action === 'CLEAR') {
            this.clearAll();
            sendJson(res, 200, { success: true, message: 'All chaos failures cleared' });
            return true;
          }

          if (body.action === 'ENABLE' && body.failureType) {
            this.enableFailure(body.failureType, body.params);
            sendJson(res, 200, {
              success: true,
              message: `Chaos failure "${body.failureType}" enabled`,
              active: this.getActiveFailures(),
            });
            return true;
          }

          if (body.action === 'DISABLE' && body.failureType) {
            this.disableFailure(body.failureType);
            sendJson(res, 200, {
              success: true,
              message: `Chaos failure "${body.failureType}" disabled`,
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

    // Health check and root info bypass failure injection to preserve monitorability
    if (pathname === '/health' || pathname === '/') {
      return false;
    }

    // 2. Injected Latency (api_latency)
    const latencyFailure = this.activeFailures.get('api_latency');
    if (latencyFailure && latencyFailure.params.delayMs) {
      const pct = latencyFailure.params.percentage ?? 100;
      if (Math.random() * 100 <= pct) {
        await new Promise((resolve) => setTimeout(resolve, latencyFailure.params.delayMs));
      }
    }

    // 3. Injected Timeout (timeout)
    const timeoutFailure = this.activeFailures.get('timeout');
    if (timeoutFailure) {
      // Hold the request until connection closes or 30s timeout
      await new Promise((resolve) => setTimeout(resolve, 30000));
      return true;
    }

    // 4. Injected HTTP 500 / Status Code (http_500)
    const http500Failure = this.activeFailures.get('http_500');
    if (http500Failure) {
      const pct = http500Failure.params.percentage ?? 100;
      if (Math.random() * 100 <= pct) {
        const statusCode = http500Failure.params.statusCode ?? 500;
        sendError(
          res,
          statusCode,
          'CHAOS_INJECTED_ERROR',
          `Simulated HTTP ${statusCode} failure injected by Chaos experiment`
        );
        return true;
      }
    }

    // 5. Injected Random Failure (random_failure)
    const randomFailure = this.activeFailures.get('random_failure');
    if (randomFailure) {
      const pct = randomFailure.params.percentage ?? 50;
      if (Math.random() * 100 <= pct) {
        sendError(res, 500, 'CHAOS_RANDOM_FAILURE', 'Random request failure injected by Chaos experiment');
        return true;
      }
    }

    // 6. Injected Bad Response (bad_response)
    const badResponseFailure = this.activeFailures.get('bad_response');
    if (badResponseFailure) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end('{"corrupted": true, "missing_fields": ['); // Malformed JSON
      return true;
    }

    // 7. Injected Database Outage (db_outage)
    if (this.isDbOutageActive()) {
      sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Database connection unavailable (Simulated DB Outage)');
      return true;
    }

    return false;
  }
}

export const chaosInterceptor = new ChaosInterceptor();
