import http from 'node:http';
import { createHealthReport } from '@chaos/shared';
import { loadConfig } from './config.js';

const startTime = Date.now();
const config = loadConfig();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  res.setHeader('Content-Type', 'application/json');

  // Health check endpoint
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
    const health = createHealthReport('fake-payment-provider', startTime);
    res.writeHead(200);
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(JSON.stringify(health));
    }
    return;
  }

  // Root endpoint info
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/') {
    res.writeHead(200);
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(
        JSON.stringify({
          name: 'fake-payment-provider',
          version: '0.1.0',
          status: 'running',
          endpoints: ['/health'],
        })
      );
    }
    return;
  }

  // 404 for unhandled routes
  res.writeHead(404);
  res.end(
    JSON.stringify({
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${req.method} ${url.pathname}`,
      },
    })
  );
});

server.listen(config.port, () => {
  console.log(`[fake-payment-provider] Service listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`[fake-payment-provider] Webhook target configured: ${config.checkoutWebhookUrl}`);
});

let isShuttingDown = false;
function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[fake-payment-provider] Received ${signal}. Starting graceful shutdown...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[fake-payment-provider] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref();

  server.close((err) => {
    if (err) {
      console.error('[fake-payment-provider] Error during server close:', err);
      process.exit(1);
    }
    console.log('[fake-payment-provider] Server closed cleanly.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { server, config };
