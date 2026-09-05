export interface CheckoutConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  mongoUri: string;
  mongoDatabase: string;
  paymentProviderUrl: string;
  webhookTimeoutMs: number;
}

/**
 * Loads and validates checkout service configuration from environment variables.
 */
export function loadConfig(): CheckoutConfig {
  const nodeEnv = (process.env['NODE_ENV'] ?? 'development') as CheckoutConfig['nodeEnv'];
  const port = parseInt(process.env['CHECKOUT_PORT'] ?? '3001', 10);

  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid CHECKOUT_PORT: ${process.env['CHECKOUT_PORT']}`);
  }

  const mongoUri = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/acme';
  const mongoDatabase = process.env['MONGODB_DATABASE'] ?? 'acme';
  const paymentProviderUrl = process.env['PAYMENT_PROVIDER_URL'] ?? 'http://127.0.0.1:3002';
  const webhookTimeoutMs = parseInt(process.env['WEBHOOK_TIMEOUT_MS'] ?? '800', 10);

  if (isNaN(webhookTimeoutMs) || webhookTimeoutMs <= 0) {
    throw new Error(`Invalid WEBHOOK_TIMEOUT_MS: ${process.env['WEBHOOK_TIMEOUT_MS']}`);
  }

  return {
    nodeEnv,
    port,
    mongoUri,
    mongoDatabase,
    paymentProviderUrl,
    webhookTimeoutMs,
  };
}
