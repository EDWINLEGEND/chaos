import { MongoClient, type Db, type Collection, type MongoClientOptions } from 'mongodb';
import type { OrderDocument, WebhookEventDocument, DatabaseHealth } from './types.js';

export const DEFAULT_DB_NAME = 'acme';
export const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/acme';

export interface DatabaseConfig {
  uri: string;
  dbName?: string;
  serverSelectionTimeoutMS?: number;
  connectTimeoutMS?: number;
  maxPoolSize?: number;
  minPoolSize?: number;
}

export interface CollectionStats {
  exists: boolean;
  count: number;
}

export interface DatabaseDiagnosticReport {
  dbName: string;
  connected: boolean;
  latencyMs?: number;
  collections: {
    orders: CollectionStats;
    webhook_events: CollectionStats;
  };
  ordersIndexes: Array<{ name: string; key: Record<string, number | string> }>;
  hasUserIdStatusCompoundIndex: boolean;
  error?: string;
}

export interface DatabaseConnection {
  client: MongoClient;
  db: Db;
  dbName: string;
  checkConnectivity(timeoutMs?: number): Promise<DatabaseHealth>;
  getOrdersCollection(): Collection<OrderDocument>;
  getWebhookEventsCollection(): Collection<WebhookEventDocument>;
  getDiagnostics(): Promise<DatabaseDiagnosticReport>;
  close(): Promise<void>;
}

/**
 * Creates and connects an independent database connection instance.
 */
export async function createDatabaseConnection(config: DatabaseConfig): Promise<DatabaseConnection> {
  const dbName = config.dbName ?? DEFAULT_DB_NAME;
  const options: MongoClientOptions = {
    serverSelectionTimeoutMS: config.serverSelectionTimeoutMS ?? 3000,
    connectTimeoutMS: config.connectTimeoutMS ?? 5000,
    maxPoolSize: config.maxPoolSize ?? 20,
    minPoolSize: config.minPoolSize ?? 1,
  };

  const client = new MongoClient(config.uri, options);
  await client.connect();
  const db = client.db(dbName);

  const checkConnectivity = async (timeoutMs: number = 2000): Promise<DatabaseHealth> => {
    const start = Date.now();
    try {
      await db.command({ ping: 1, maxTimeMS: timeoutMs });
      return {
        status: 'ok',
        database: dbName,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'down',
        database: dbName,
        latencyMs: Date.now() - start,
        error: message,
      };
    }
  };

  const getOrdersCollection = (): Collection<OrderDocument> => {
    return db.collection<OrderDocument>('orders');
  };

  const getWebhookEventsCollection = (): Collection<WebhookEventDocument> => {
    return db.collection<WebhookEventDocument>('webhook_events');
  };

  const getDiagnostics = async (): Promise<DatabaseDiagnosticReport> => {
    const connectivity = await checkConnectivity();
    if (connectivity.status !== 'ok') {
      return {
        dbName,
        connected: false,
        error: connectivity.error,
        collections: {
          orders: { exists: false, count: 0 },
          webhook_events: { exists: false, count: 0 },
        },
        ordersIndexes: [],
        hasUserIdStatusCompoundIndex: false,
      };
    }

    const existingCollections = await db.listCollections().toArray();
    const collectionNames = new Set(existingCollections.map((c) => c.name));

    const ordersExists = collectionNames.has('orders');
    const webhooksExists = collectionNames.has('webhook_events');

    let ordersCount = 0;
    let webhooksCount = 0;
    let ordersIndexes: Array<{ name: string; key: Record<string, number | string> }> = [];
    let hasUserIdStatusCompoundIndex = false;

    if (ordersExists) {
      const ordersCol = getOrdersCollection();
      ordersCount = await ordersCol.countDocuments({}, { maxTimeMS: 5000 });
      const rawIndexes = await ordersCol.indexes();
      ordersIndexes = rawIndexes.map((idx) => ({
        name: idx.name ?? 'unnamed',
        key: idx.key as Record<string, number | string>,
      }));

      hasUserIdStatusCompoundIndex = rawIndexes.some((idx) => {
        const keys = Object.keys(idx.key);
        return (
          (keys[0] === 'userId' && keys[1] === 'status') ||
          (keys[0] === 'status' && keys[1] === 'userId')
        );
      });
    }

    if (webhooksExists) {
      const webhooksCol = getWebhookEventsCollection();
      webhooksCount = await webhooksCol.countDocuments({}, { maxTimeMS: 5000 });
    }

    return {
      dbName,
      connected: true,
      latencyMs: connectivity.latencyMs,
      collections: {
        orders: { exists: ordersExists, count: ordersCount },
        webhook_events: { exists: webhooksExists, count: webhooksCount },
      },
      ordersIndexes,
      hasUserIdStatusCompoundIndex,
    };
  };

  const close = async (): Promise<void> => {
    await client.close(false);
  };

  return {
    client,
    db,
    dbName,
    checkConnectivity,
    getOrdersCollection,
    getWebhookEventsCollection,
    getDiagnostics,
    close,
  };
}

/**
 * Singleton state for application-level lifecycle (checkout service).
 */
let singletonConnection: DatabaseConnection | null = null;

/**
 * Initializes the application-level singleton database connection.
 */
export async function initDatabase(config: DatabaseConfig): Promise<{ client: MongoClient; db: Db }> {
  if (singletonConnection) {
    return { client: singletonConnection.client, db: singletonConnection.db };
  }
  singletonConnection = await createDatabaseConnection(config);
  return { client: singletonConnection.client, db: singletonConnection.db };
}

export function getDb(): Db {
  if (!singletonConnection) {
    throw new Error('Database has not been initialized. Call initDatabase() before accessing collections.');
  }
  return singletonConnection.db;
}

export function getMongoClient(): MongoClient | null {
  return singletonConnection?.client ?? null;
}

export function getOrdersCollection(): Collection<OrderDocument> {
  if (!singletonConnection) {
    throw new Error('Database has not been initialized. Call initDatabase() before accessing collections.');
  }
  return singletonConnection.getOrdersCollection();
}

export function getWebhookEventsCollection(): Collection<WebhookEventDocument> {
  if (!singletonConnection) {
    throw new Error('Database has not been initialized. Call initDatabase() before accessing collections.');
  }
  return singletonConnection.getWebhookEventsCollection();
}

export async function checkDatabaseConnectivity(timeoutMs: number = 2000): Promise<DatabaseHealth> {
  if (!singletonConnection) {
    return {
      status: 'down',
      database: DEFAULT_DB_NAME,
      error: 'Client not connected',
    };
  }
  return singletonConnection.checkConnectivity(timeoutMs);
}

export async function getDatabaseDiagnostics(): Promise<DatabaseDiagnosticReport> {
  if (!singletonConnection) {
    return {
      dbName: DEFAULT_DB_NAME,
      connected: false,
      error: 'Client not connected',
      collections: {
        orders: { exists: false, count: 0 },
        webhook_events: { exists: false, count: 0 },
      },
      ordersIndexes: [],
      hasUserIdStatusCompoundIndex: false,
    };
  }
  return singletonConnection.getDiagnostics();
}

export async function closeDatabase(): Promise<void> {
  if (singletonConnection) {
    try {
      await singletonConnection.close();
    } finally {
      singletonConnection = null;
    }
  }
}
