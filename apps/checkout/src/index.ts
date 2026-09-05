import http from 'node:http';
import {
  createHealthReport,
  initDatabase,
  checkDatabaseConnectivity,
  closeDatabase,
  type ServiceHealth,
} from '@chaos/shared';
import { loadConfig } from './config.js';

const startTime = Date.now();
const config = loadConfig();

// Attempt non-blocking startup database connection
initDatabase({
  uri: config.mongoUri,
  dbName: config.mongoDatabase,
  serverSelectionTimeoutMS: 3000,
  connectTimeoutMS: 5000,
})
  .then(() => {
    console.log(`[acme-checkout] Successfully connected to MongoDB at ${config.mongoDatabase}`);
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
  console.log(`[acme-checkout] Configured database: ${config.mongoDatabase}`);
});

// Graceful shutdown handling
let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[acme-checkout] Received ${signal}. Starting graceful shutdown...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[acme-checkout] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref();

  // Close HTTP server
  server.close(async (err) => {
    if (err) {
      console.error('[acme-checkout] Error during server close:', err);
    } else {
      console.log('[acme-checkout] Server closed cleanly.');
    }

    // Close MongoDB connection pool
    try {
      await closeDatabase();
      console.log('[acme-checkout] MongoDB connection pool closed.');
    } catch (dbErr) {
      console.error('[acme-checkout] Error closing MongoDB connection:', dbErr);
    }

    process.exit(err ? 1 : 0);
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

export { server, config };
