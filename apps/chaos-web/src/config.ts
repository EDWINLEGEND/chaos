export interface ChaosWebConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  checkoutUrl: string;
  paymentProviderUrl: string;
}

/**
 * Loads and validates Chaos Web frontend/control-panel configuration from environment variables.
 */
export function loadConfig(): ChaosWebConfig {
  const nodeEnv = (process.env['NODE_ENV'] ?? 'development') as ChaosWebConfig['nodeEnv'];
  const port = parseInt(process.env['CHAOS_WEB_PORT'] ?? '3000', 10);

  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid CHAOS_WEB_PORT: ${process.env['CHAOS_WEB_PORT']}`);
  }

  const checkoutUrl = process.env['CHECKOUT_SERVICE_URL'] ?? 'http://localhost:3001';
  const paymentProviderUrl = process.env['PAYMENT_PROVIDER_URL'] ?? 'http://localhost:3002';

  return {
    nodeEnv,
    port,
    checkoutUrl,
    paymentProviderUrl,
  };
}
