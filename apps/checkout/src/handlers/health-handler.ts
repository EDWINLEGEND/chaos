import type http from 'node:http';
import {
  createHealthReport,
  checkDatabaseConnectivity,
  initDatabase,
  type ServiceHealth,
} from '@chaos/shared';
import type { CheckoutConfig } from '../config.js';

/**
 * Handles GET /health and HEAD /health with real lightweight MongoDB ping.
 */
export async function handleHealthCheck(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: CheckoutConfig,
  startTime: number
): Promise<void> {
  const baseHealth = createHealthReport('acme-checkout', startTime);

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
      // Ignored; reflected in dbHealth
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

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(statusCode);
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(JSON.stringify(responsePayload));
  }
}
