import http from 'node:http';
import { initDatabase, closeDatabase } from '@chaos/shared';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

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

// Create application request handler and server
const app = createApp(config, startTime);
const server = http.createServer(app);

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

export { server, config, app };
