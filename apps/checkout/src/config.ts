export interface CheckoutConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  mongoUri: string;
  mongoDatabase: string;
  paymentProviderUrl: string;
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

  const mongoUri = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/acme';
  const mongoDatabase = process.env['MONGODB_DATABASE'] ?? 'acme';
  const paymentProviderUrl = process.env['PAYMENT_PROVIDER_URL'] ?? 'http://localhost:3002';

  return {
    nodeEnv,
    port,
    mongoUri,
    mongoDatabase,
    paymentProviderUrl,
  };
}
