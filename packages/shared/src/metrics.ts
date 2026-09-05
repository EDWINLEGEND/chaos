import client from 'prom-client';

export const prometheusRegistry = new client.Registry();

// Collect default Node.js runtime metrics (memory, CPU, event loop, handles)
client.collectDefaultMetrics({
  register: prometheusRegistry,
  prefix: 'chaos_',
});

// Generic HTTP Telemetry Metrics
export const httpRequestsTotal = new client.Counter({
  name: 'chaos_http_requests_total',
  help: 'Total number of HTTP requests handled',
  labelNames: ['service', 'method', 'route', 'status_code'],
  registers: [prometheusRegistry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'chaos_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['service', 'method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2, 5],
  registers: [prometheusRegistry],
});

// Domain & Incident Metrics: Order Processing & Silent Drop Divergence
export const ordersCreatedTotal = new client.Counter({
  name: 'chaos_orders_created_total',
  help: 'Total number of orders successfully created and persisted in MongoDB',
  registers: [prometheusRegistry],
});

export const webhookEventsReceivedTotal = new client.Counter({
  name: 'chaos_webhook_events_received_total',
  help: 'Total number of inbound payment-confirmed webhook events',
  labelNames: ['status'], // 'created', 'duplicate', 'timeout_dropped'
  registers: [prometheusRegistry],
});

export const silentOrderLossTotal = new client.Counter({
  name: 'chaos_silent_order_loss_total',
  help: 'Total number of orders silently dropped due to unindexed COLLSCAN duplicate query timeouts',
  registers: [prometheusRegistry],
});

export const estimatedRevenueLossCents = new client.Gauge({
  name: 'chaos_estimated_revenue_loss_cents',
  help: 'Total dollar amount in cents of silently dropped orders (financial loss ticker)',
  registers: [prometheusRegistry],
});

export const databaseQueryDurationSeconds = new client.Histogram({
  name: 'chaos_db_query_duration_seconds',
  help: 'MongoDB query execution duration in seconds',
  labelNames: ['collection', 'operation'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8, 1.2, 2.5],
  registers: [prometheusRegistry],
});

/**
 * Returns Prometheus metrics formatted for scraping.
 */
export async function getPrometheusMetrics(): Promise<{ contentType: string; metrics: string }> {
  return {
    contentType: prometheusRegistry.contentType,
    metrics: await prometheusRegistry.metrics(),
  };
}
