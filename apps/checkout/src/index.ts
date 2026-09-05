import http from 'node:http';
import { createHealthReport } from '@chaos/shared';
import { loadConfig } from './config.js';

const startTime = Date.now();
const config = loadConfig();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // Set standard JSON headers
  res.setHeader('Content-Type', 'application/json');

  // Health check endpoint
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
    const health = createHealthReport('acme-checkout', startTime);
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
          name: 'acme-checkout',
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

// Start listening
server.listen(config.port, () => {
  console.log(`[acme-checkout] Service listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`[acme-checkout] MongoDB configured at: ${config.mongoUri}`);
});

// Graceful shutdown handling
let isShuttingDown = false;
function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[acme-checkout] Received ${signal}. Starting graceful shutdown...`);

  // Force exit if shutdown hangs
  const forceExitTimer = setTimeout(() => {
    console.error('[acme-checkout] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref();

  server.close((err) => {
    if (err) {
      console.error('[acme-checkout] Error during server close:', err);
      process.exit(1);
    }
    console.log('[acme-checkout] Server closed cleanly.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { server, config };
