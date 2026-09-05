import http from 'node:http';
import {
  createHealthReport,
  initDatabase,
  checkDatabaseConnectivity,
  closeDatabase,
  type ServiceHealth,
} from '@chaos/shared';
import { loadConfig } from './config.js';
import { ensureIndexes } from './db/ensure-indexes.js';

const startTime = Date.now();
const config = loadConfig();

// Attempt non-blocking startup database connection
initDatabase({
  uri: config.mongoUri,
  dbName: config.mongoDatabase,
  serverSelectionTimeoutMS: 3000,
  connectTimeoutMS: 5000,
})
  .then(async () => {
    console.log(`[acme-checkout] Successfully connected to MongoDB at ${config.mongoDatabase}`);
    await ensureIndexes();
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[acme-checkout] Initial MongoDB connection not established (${msg}). Will connect on probe.`);
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  res.setHeader('Content-Type', 'application/json');

  // Health check endpoint with real lightweight MongoDB ping
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
    const baseHealth = createHealthReport('acme-checkout', startTime);

    // If client wasn't connected initially, attempt connection
    let dbHealth = await checkDatabaseConnectivity(2000);
    if (dbHealth.status !== 'ok') {
      try {
        await initDatabase({
          uri: config.mongoUri,
          dbName: config.mongoDatabase,
          serverSelectionTimeoutMS: 2000,
          connectTimeoutMS: 2000,
        });
        dbHealth = await checkDatabaseConnectivity(2000);
      } catch {
        // Handled below via dbHealth
      }
    }

    const isHealthy = dbHealth.status === 'ok';
    const statusCode = isHealthy ? 200 : 503;

    const responsePayload: ServiceHealth = {
      ...baseHealth,
      status: isHealthy ? 'ok' : 'degraded',
      database: dbHealth.status,
      databaseDetails: {
        status: dbHealth.status,
        database: config.mongoDatabase,
        latencyMs: dbHealth.latencyMs,
        ...(dbHealth.error ? { error: dbHealth.error } : {}),
      },
    };

    res.writeHead(statusCode);
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(JSON.stringify(responsePayload));
    }
    return;
  }

  // POST /webhooks/payment-confirmed
  // POST /orders
  // GET /orders/:id
  // GET /orders
  // Default 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
});

// Start listening
server.listen(config.port, () => {
  console.log(`[acme-checkout] Service listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`[acme-checkout] Configured database: ${config.mongoDatabase}`);
});

// Graceful shutdown handling
let isShuttingDown = false;
function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[acme-checkout] Received ${signal}, shutting down gracefully...`);
  server.close(async () => {
    console.log('[acme-checkout] HTTP server closed');
    await closeDatabase();
    console.log('[acme-checkout] Database connection closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
