export interface PaymentProviderConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  checkoutWebhookUrl: string;
  storeFilePath?: string;
}

/**
 * Loads and validates payment provider configuration from environment variables.
 */
export function loadConfig(): PaymentProviderConfig {
  const nodeEnv = (process.env['NODE_ENV'] ?? 'development') as PaymentProviderConfig['nodeEnv'];
  const port = parseInt(process.env['PAYMENT_PROVIDER_PORT'] ?? '3002', 10);

  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PAYMENT_PROVIDER_PORT: ${process.env['PAYMENT_PROVIDER_PORT']}`);
  }

  const checkoutWebhookUrl =
    process.env['CHECKOUT_WEBHOOK_URL'] ?? 'http://127.0.0.1:3001/webhooks/payment-confirmed';

  const storeFilePath = process.env['PAYMENT_STORE_FILE'];

  return {
    nodeEnv,
    port,
    checkoutWebhookUrl,
    storeFilePath,
  };
}
