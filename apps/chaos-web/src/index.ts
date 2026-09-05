import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHealthReport } from '@chaos/shared';
import { loadConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const startTime = Date.now();
const config = loadConfig();
const publicDir = path.resolve(__dirname, '../public');

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // Health check endpoint
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    const health = createHealthReport('chaos-web', startTime);
    res.writeHead(200);
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(JSON.stringify(health));
    }
    return;
  }

  // Root or HTML requests
  if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
    const indexPath = path.join(publicDir, 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Failed to read index.html' } }));
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(data);
      }
    });
    return;
  }

  // 404 for unhandled routes
  res.setHeader('Content-Type', 'application/json');
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
  console.log(`[chaos-web] Control panel running on port ${config.port} (${config.nodeEnv})`);
  console.log(`[chaos-web] Target checkout URL: ${config.checkoutUrl}`);
});

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
