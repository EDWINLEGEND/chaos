import http from 'node:http';
import { loadConfig } from './config.js';
import { InMemoryPaymentStore } from './store.js';
import { createApp } from './app.js';

const startTime = Date.now();
const config = loadConfig();
const store = new InMemoryPaymentStore(config.storeFilePath);

const app = createApp(config, store, startTime);
const server = http.createServer(app);

server.listen(config.port, () => {
  console.log(`[fake-payment-provider] Service listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`[fake-payment-provider] Webhook target configured: ${config.checkoutWebhookUrl}`);
});

let isShuttingDown = false;
function shutdown(signal: string): void {
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

export { server, config, store, app };
