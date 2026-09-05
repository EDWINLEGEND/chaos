import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHealthReport, type FailureType, type ExperimentTarget } from '@chaos/shared';
import { loadConfig } from './config.js';
import { sendJson, sendError, parseJsonBody } from './utils/http.js';
import { experimentRegistry } from './controller/experiment-registry.js';
import { listScenarios, getScenario, startScenario, stopScenario } from './controller/scenarios.js';
import { getEnvironmentStatus, triggerEnvironmentReset } from './controller/environment.js';
import { getActivityLogs } from './controller/activity-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const startTime = Date.now();
const config = loadConfig();
const publicDir = path.resolve(__dirname, '../public');

export function createChaosServer() {
  return http.createServer(async (req, res) => {
    // CORS headers for local development flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // 1. Health check endpoint: GET /api/health or /health
      if ((method === 'GET' || method === 'HEAD') && (pathname === '/health' || pathname === '/api/health')) {
        const health = createHealthReport('chaos-web', startTime);
        sendJson(res, 200, health);
        return;
      }

      // 2. Environment status: GET /api/environment
      if (method === 'GET' && pathname === '/api/environment') {
        const status = await getEnvironmentStatus();
        sendJson(res, 200, status);
        return;
      }

      // 3. Environment reset: POST /api/environment/reset
      if (method === 'POST' && pathname === '/api/environment/reset') {
        const resetResult = await triggerEnvironmentReset();
        sendJson(res, 200, resetResult);
        return;
      }

      // 4. Experiments collection: GET /api/experiments & POST /api/experiments
      if (pathname === '/api/experiments') {
        if (method === 'GET') {
          const experiments = experimentRegistry.listExperiments();
          sendJson(res, 200, {
            data: experiments,
            activeCount: experimentRegistry.getActiveCount(),
          });
          return;
        }

        if (method === 'POST') {
          const body = await parseJsonBody<{
            name?: string;
            target?: string;
            failureType?: string;
            type?: string;
            params?: Record<string, unknown>;
            durationSeconds?: number;
          }>(req);

          if (!body.target || (body.target !== 'acme-checkout' && body.target !== 'fake-payment-provider')) {
            sendError(res, 400, 'INVALID_TARGET', 'Target must be "acme-checkout" or "fake-payment-provider"');
            return;
          }

          const validFailureTypes: FailureType[] = [
            'api_latency',
            'http_500',
            'payment_failure',
            'payment_latency',
            'db_outage',
            'db_latency',
            'random_failure',
            'timeout',
            'traffic_surge',
            'bad_response',
          ];

          const failureType = (body.failureType || body.type) as FailureType;
          if (!failureType || !validFailureTypes.includes(failureType)) {
            sendError(res, 400, 'INVALID_FAILURE_TYPE', `Failure type must be one of: ${validFailureTypes.join(', ')}`);
            return;
          }

          const experiment = await experimentRegistry.createExperiment({
            name: body.name,
            target: body.target as ExperimentTarget,
            failureType,
            params: body.params,
            durationSeconds: body.durationSeconds,
          });

          sendJson(res, 201, { success: true, data: experiment });
          return;
        }
      }

      // 5. Individual experiment: GET /api/experiments/:id & POST /api/experiments/:id/stop
      const expMatch = pathname.match(/^\/api\/experiments\/([^/]+)(\/stop)?$/);
      if (expMatch && expMatch[1]) {
        const experimentId = decodeURIComponent(expMatch[1]);
        const isStop = expMatch[2] === '/stop';

        if (method === 'GET' && !isStop) {
          const exp = experimentRegistry.getExperiment(experimentId);
          if (!exp) {
            sendError(res, 404, 'NOT_FOUND', `Experiment "${experimentId}" not found`);
            return;
          }
          sendJson(res, 200, { data: exp });
          return;
        }

        if (method === 'POST' && isStop) {
          const exp = await experimentRegistry.stopExperiment(experimentId);
          if (!exp) {
            sendError(res, 404, 'NOT_FOUND', `Experiment "${experimentId}" not found`);
            return;
          }
          sendJson(res, 200, { success: true, message: 'Experiment stopped', data: exp });
          return;
        }
      }

      // 6. Scenarios collection: GET /api/scenarios
      if (method === 'GET' && pathname === '/api/scenarios') {
        const scenarios = listScenarios();
        sendJson(res, 200, { data: scenarios });
        return;
      }

      // 6b. Individual scenario: GET /api/scenarios/:id
      const scGetMatch = pathname.match(/^\/api\/scenarios\/([^/]+)$/);
      if (method === 'GET' && scGetMatch && scGetMatch[1]) {
        const scenarioId = decodeURIComponent(scGetMatch[1]);
        const sc = getScenario(scenarioId);
        if (!sc) {
          sendError(res, 404, 'NOT_FOUND', `Scenario "${scenarioId}" not found`);
          return;
        }
        sendJson(res, 200, { data: sc });
        return;
      }

      // 7. Scenario start / stop: POST /api/scenarios/:id/start & POST /api/scenarios/:id/stop
      const scMatch = pathname.match(/^\/api\/scenarios\/([^/]+)\/(start|stop)$/);
      if (method === 'POST' && scMatch && scMatch[1] && scMatch[2]) {
        const scenarioId = decodeURIComponent(scMatch[1]);
        const action = scMatch[2];

        if (action === 'start') {
          const result = await startScenario(scenarioId);
          sendJson(res, 200, { success: true, message: result.message, data: result.scenario });
          return;
        }

        if (action === 'stop') {
          const sc = await stopScenario(scenarioId);
          if (!sc) {
            sendError(res, 404, 'NOT_FOUND', `Scenario "${scenarioId}" not found`);
            return;
          }
          sendJson(res, 200, { success: true, message: 'Scenario stopped', data: sc });
          return;
        }
      }

      // 8. Activity log: GET /api/activity
      if (method === 'GET' && pathname === '/api/activity') {
        const logs = getActivityLogs(50);
        sendJson(res, 200, { data: logs });
        return;
      }

      // 9. Static UI serving: GET / or GET /index.html
      if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
        const indexPath = path.join(publicDir, 'index.html');
        fs.readFile(indexPath, (err, data) => {
          if (err) {
            sendError(res, 500, 'SERVER_ERROR', 'Failed to read index.html');
            return;
          }
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.writeHead(200);
          if (method === 'HEAD') {
            res.end();
          } else {
            res.end(data);
          }
        });
        return;
      }

      // 10. 404 for unhandled routes
      sendError(res, 404, 'NOT_FOUND', `Route not found: ${method} ${pathname}`);
    } catch (err) {
      if (err instanceof Error && (err.message.includes('Invalid JSON payload') || err.message.includes('Payload Too Large'))) {
        sendError(res, 400, 'BAD_REQUEST', err.message);
        return;
      }
      console.error('[chaos-web] Uncaught API error:', err);
      sendError(
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        `Internal server error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}

const server = createChaosServer();

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  server.listen(config.port, () => {
    console.log(`[chaos-web] Chaos Control Panel & API listening on port ${config.port} (${config.nodeEnv})`);
    console.log(`[chaos-web] Dashboard URL: http://localhost:${config.port}`);
    console.log(`[chaos-web] Target Checkout: ${config.checkoutUrl}`);
  });
}

let isShuttingDown = false;
function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[chaos-web] Received ${signal}. Starting graceful shutdown...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[chaos-web] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref();

  server.close((err) => {
    if (err) {
      console.error('[chaos-web] Error during server close:', err);
      process.exit(1);
    }
    console.log('[chaos-web] Server closed cleanly.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { server, config };
